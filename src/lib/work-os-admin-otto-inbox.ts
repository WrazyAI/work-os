import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import type {
  DeliveryLease, InboxItem, InboxPage, ReviewedRecap,
} from "@/modules/work-os/admin-otto/contracts";

type PreferenceRow = {
  organization_id: string;
  membership_id: string;
  mode: "all" | "selected";
  selected_person_ids: string[];
  access_epoch: number | string;
  activated_sequence: string | number | bigint | null;
  active: boolean;
  materialized_through_sequence: string | number | bigint;
};

type ReviewEventRow = {
  id: string;
  interval_id: string;
  person_id: string;
  version: number | string;
  event_sequence: string | number | bigint;
  reviewed_at: Date | string;
};

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;
const RETENTION = "30 days";
const LEASE_SECONDS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COVERAGE = [
  "Reviewed recap arrivals from the last 30 days only; each item is one employee-confirmed or corrected recap, not task completion or attendance.",
];

/** Current visibility, independent of when the delivery was materialized. A
 * historical window at the review's committed sequence is required, but current
 * access, follow mode and person activity decide whether it still belongs here. */
const VISIBLE_FROM = `
  work_admin_otto_deliveries d
  JOIN work_recap_reviews r
    ON r.organization_id = d.organization_id AND r.id = d.event_id
  JOIN work_admin_otto_preferences p
    ON p.organization_id = d.organization_id AND p.membership_id = d.membership_id
  JOIN work_org_members m
    ON m.organization_id = p.organization_id AND m.id = p.membership_id
  JOIN work_organizations o ON o.id = p.organization_id
  JOIN work_people pe ON pe.organization_id = r.organization_id AND pe.id = r.person_id
`;
const VISIBLE_WHERE = `
  d.organization_id = $1 AND d.membership_id = $2 AND m.user_id = $3
  AND p.active AND p.activated_sequence IS NOT NULL
  AND work_admin_otto_effective_access(m.feature_flags, o.feature_flags, m.role, m.active)
  AND pe.active
  AND (p.mode = 'all' OR pe.id = ANY(p.selected_person_ids))
  AND r.arrival_eligible
  AND r.reviewed_at >= clock_timestamp() - interval '${RETENTION}'
  AND d.superseded_at IS NULL AND d.dismissed_at IS NULL
  -- Only a still-pending older version collapses into its correction. A version
  -- already presented (or explicitly dismissed) is not superseded; presented
  -- history keeps its own immutable payload and the newer version is a separate
  -- arrival.
  AND (
    d.presented_at IS NOT NULL
    OR NOT EXISTS (
      SELECT 1 FROM work_recap_reviews newer
      WHERE newer.organization_id = r.organization_id
        AND newer.interval_id = r.interval_id
        AND newer.version > r.version
        AND newer.arrival_eligible
    )
  )
  AND EXISTS (
    SELECT 1 FROM work_admin_otto_follow_windows w
    WHERE w.organization_id = d.organization_id
      AND w.membership_id = d.membership_id
      AND w.person_id = r.person_id
      AND w.access_epoch = p.access_epoch
      AND w.start_sequence <= r.event_sequence
      AND (w.end_sequence IS NULL OR r.event_sequence < w.end_sequence)
  )
`;

function requireAdmin(access: WorkOsAccess) {
  if (access.role !== "admin" || access.featureFlags.employee_companion !== true) {
    throw new WorkOsConflictError("Admin Otto access is not active for this membership.", "otto_access_revoked");
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function encodeCursor(sequence: string | number | bigint): string {
  return Buffer.from(JSON.stringify({ v: 1, s: String(sequence) }), "utf8").toString("base64url");
}

const MAX_CURSOR_LENGTH = 256;

function decodeCursor(value: string | undefined): bigint | null {
  if (value === undefined) return null;
  if (!value || value.length > MAX_CURSOR_LENGTH) {
    throw new WorkOsValidationError("cursor is invalid");
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { v?: unknown; s?: unknown };
    if (parsed.v !== 1 || typeof parsed.s !== "string" || !/^\d+$/.test(parsed.s)) {
      throw new WorkOsValidationError("cursor is invalid");
    }
    const sequence = BigInt(parsed.s);
    // Keep tampered cursors inside the signed bigint domain instead of failing
    // with a database cast error.
    if (sequence < BigInt(0) || sequence > BigInt("9223372036854775807")) {
      throw new WorkOsValidationError("cursor is invalid");
    }
    return sequence;
  } catch (error) {
    if (error instanceof WorkOsValidationError) throw error;
    throw new WorkOsValidationError("cursor is invalid");
  }
}

function boundedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new WorkOsValidationError(`limit must be between 1 and ${MAX_LIMIT}`);
  }
  return value;
}

function boundedText(value: unknown, field: string): string {
  if (typeof value !== "string") throw new WorkOsValidationError(`${field} is required`);
  const text = value.trim();
  if (!text || text.length > 200) {
    throw new WorkOsValidationError(`${field} must be between 1 and 200 characters`);
  }
  return text;
}

function normalizeEventIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_LIMIT) {
    throw new WorkOsValidationError(`eventIds must contain between 1 and ${MAX_LIMIT} events`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !UUID.test(value)) {
      throw new WorkOsValidationError("eventIds must be delivery event ids");
    }
    const id = value.toLowerCase();
    if (!seen.has(id)) { seen.add(id); ids.push(id); }
  }
  return ids;
}

function emptyPage(): InboxPage {
  return {
    items: [],
    nextCursor: null,
    total: 0,
    asOf: new Date().toISOString(),
    coverage: COVERAGE,
    unread: 0,
    catchupPending: false,
  };
}

async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

/** Per-admin lock. It intentionally never takes the organization clock, so
 * materialization cannot block an employee review or invert the lifecycle
 * trigger's clock→preference lock order. */
async function lockPreference(client: PoolClient, access: WorkOsAccess): Promise<PreferenceRow | undefined> {
  const { rows } = await client.query<PreferenceRow>(`SELECT p.*
    FROM work_admin_otto_preferences p
    JOIN work_org_members m
      ON m.organization_id = p.organization_id AND m.id = p.membership_id
    JOIN work_organizations o ON o.id = p.organization_id
    WHERE p.organization_id = $1 AND p.membership_id = $2 AND m.user_id = $3
      AND work_admin_otto_effective_access(m.feature_flags, o.feature_flags, m.role, m.active)
    FOR UPDATE OF p`,
  [access.organizationId, access.membershipId, access.ctx.user.id]);
  if (rows[0]) return rows[0];

  // Distinguish "never activated" from revoked access without writing.
  const { rows: allowed } = await client.query<{ allowed: boolean }>(`SELECT
      work_admin_otto_effective_access(m.feature_flags, o.feature_flags, m.role, m.active) AS allowed
    FROM work_org_members m
    JOIN work_organizations o ON o.id = m.organization_id
    WHERE m.organization_id = $1 AND m.id = $2 AND m.user_id = $3`,
  [access.organizationId, access.membershipId, access.ctx.user.id]);
  if (allowed[0]?.allowed !== true) {
    throw new WorkOsConflictError("Admin Otto access is not active for this membership.", "otto_access_revoked");
  }
  return undefined;
}

async function materialize(client: PoolClient, preference: PreferenceRow): Promise<boolean> {
  if (preference.active !== true || preference.activated_sequence === null) return false;
  // A fresh epoch starts at activated_sequence; older events cannot match a
  // current-epoch window. Clamp the scan there so a long inactive backlog stays
  // O(1) and cannot delay the first post-reactivation arrivals by many polls.
  const stored = BigInt(preference.materialized_through_sequence ?? 0);
  const activationFloor = BigInt(preference.activated_sequence) - BigInt(1);
  // Also skip the contiguous prefix that is already older than retention. The
  // NOT EXISTS guard keeps a sequence/timestamp inversion from skipping an
  // event that is still retained.
  const { rows: floored } = await client.query<{ floor: string | number | bigint }>(`SELECT
      coalesce(max(r.event_sequence), 0) AS floor
    FROM work_recap_reviews r
    WHERE r.organization_id = $1 AND r.arrival_eligible
      AND r.reviewed_at < clock_timestamp() - interval '${RETENTION}'
      AND NOT EXISTS (
        SELECT 1 FROM work_recap_reviews recent
        WHERE recent.organization_id = r.organization_id AND recent.arrival_eligible
          AND recent.event_sequence <= r.event_sequence
          AND recent.reviewed_at >= clock_timestamp() - interval '${RETENTION}'
      )`, [preference.organization_id]);
  const retentionFloor = BigInt(floored[0]?.floor ?? 0);
  const cursor = [stored, activationFloor, retentionFloor].reduce((left, right) => left > right ? left : right);
  if (cursor > stored) {
    await client.query(`UPDATE work_admin_otto_preferences
      SET materialized_through_sequence = $3
      WHERE organization_id = $1 AND membership_id = $2
        AND materialized_through_sequence < $3`,
    [preference.organization_id, preference.membership_id, cursor.toString()]);
  }
  const { rows: events } = await client.query<ReviewEventRow>(`SELECT
      id, interval_id, person_id, version, event_sequence, reviewed_at
    FROM work_recap_reviews
    WHERE organization_id = $1 AND arrival_eligible AND event_sequence > $2
    ORDER BY event_sequence ASC
    LIMIT ${MAX_LIMIT}`,
  [preference.organization_id, cursor.toString()]);
  if (!events.length) return false;

  // Set-based per batch: one supersede statement and one eligibility/insert
  // statement instead of up to 300 round trips for a 100-event catch-up page.
  // A correction supersedes an older version that has not reached the admin
  // yet; presented or dismissed items are already personal history.
  await client.query(`WITH batch(interval_id, version) AS (
      SELECT * FROM unnest($3::uuid[], $4::int[])
    )
    UPDATE work_admin_otto_deliveries d
    SET superseded_at = clock_timestamp(), lease_token = NULL, lease_until = NULL,
        device_id = NULL, window_id = NULL
    FROM work_recap_reviews prior
    JOIN batch b ON prior.interval_id = b.interval_id AND prior.version < b.version
    WHERE d.organization_id = $1 AND d.membership_id = $2
      AND prior.organization_id = $1 AND prior.id = d.event_id
      AND prior.arrival_eligible
      AND d.presented_at IS NULL AND d.dismissed_at IS NULL AND d.superseded_at IS NULL`,
  [preference.organization_id, preference.membership_id,
    events.map((event) => event.interval_id), events.map((event) => Number(event.version))]);

  await client.query(`WITH batch(id, person_id, event_sequence, reviewed_at) AS (
      SELECT * FROM unnest($3::uuid[], $4::uuid[], $5::bigint[], $6::timestamptz[])
    )
    INSERT INTO work_admin_otto_deliveries (organization_id, membership_id, event_id)
    SELECT $1, $2, b.id
    FROM batch b
    WHERE b.reviewed_at >= clock_timestamp() - interval '${RETENTION}'
      AND EXISTS (
        SELECT 1 FROM work_people pe
        WHERE pe.organization_id = $1 AND pe.id = b.person_id AND pe.active
          AND ($7 = 'all' OR pe.id = ANY($8::uuid[]))
      )
      AND EXISTS (
        SELECT 1 FROM work_admin_otto_follow_windows w
        WHERE w.organization_id = $1 AND w.membership_id = $2 AND w.person_id = b.person_id
          AND w.access_epoch = $9
          AND w.start_sequence <= b.event_sequence
          AND (w.end_sequence IS NULL OR b.event_sequence < w.end_sequence)
      )
    ON CONFLICT (organization_id, membership_id, event_id) DO NOTHING`,
  [preference.organization_id, preference.membership_id,
    events.map((event) => event.id), events.map((event) => event.person_id),
    events.map((event) => String(event.event_sequence)),
    events.map((event) => new Date(event.reviewed_at).toISOString()),
    preference.mode, preference.selected_person_ids, preference.access_epoch]);

  const through = events[events.length - 1].event_sequence;
  await client.query(`UPDATE work_admin_otto_preferences
    SET materialized_through_sequence = $3, updated_at = clock_timestamp()
    WHERE organization_id = $1 AND membership_id = $2
      AND materialized_through_sequence < $3`,
  [preference.organization_id, preference.membership_id, through]);
  const { rows: pending } = await client.query<{ pending: boolean }>(`SELECT EXISTS (
    SELECT 1 FROM work_recap_reviews
    WHERE organization_id = $1 AND arrival_eligible AND event_sequence > $2
  ) AS pending`, [preference.organization_id, String(through)]);
  return pending[0]?.pending === true;
}

/** Newest committed sequence first, bounded by the 30-day retention window and
 * the admin's current epoch/follow/active-person state. */
export async function listAdminRecapInbox(access: WorkOsAccess, input: {
  cursor?: string; limit?: number;
} = {}): Promise<InboxPage> {
  requireAdmin(access);
  const limit = boundedLimit(input.limit);
  const before = decodeCursor(input.cursor);
  return transaction(async (client) => {
    const preference = await lockPreference(client, access);
    if (!preference) return emptyPage();
    const catchupPending = await materialize(client, preference);
    if (preference.active !== true || preference.activated_sequence === null) {
      return { ...emptyPage(), catchupPending: false };
    }

    const params = [access.organizationId, access.membershipId, access.ctx.user.id];
    const counts = await client.query<{ total: number | string; unread: number | string }>(`SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE d.seen_at IS NULL)::int AS unread
      FROM ${VISIBLE_FROM}
      WHERE ${VISIBLE_WHERE}`, params);
    const { rows } = await client.query<{
      event_id: string; event_sequence: string | number | bigint; payload: ReviewedRecap;
      seen_at: Date | string | null; listened_at: Date | string | null;
    }>(`SELECT d.event_id, r.event_sequence, r.payload, d.seen_at, d.listened_at
      FROM ${VISIBLE_FROM}
      WHERE ${VISIBLE_WHERE}
        AND ($4::bigint IS NULL OR r.event_sequence < $4::bigint)
      ORDER BY r.event_sequence DESC
      LIMIT $5`,
    [...params, before === null ? null : before.toString(), limit + 1]);

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const items: InboxItem[] = visible.map((row) => ({
      deliveryId: row.event_id,
      recap: row.payload,
      seenAt: iso(row.seen_at),
      listenedAt: iso(row.listened_at),
    }));
    const last = visible[visible.length - 1];
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.event_sequence) : null,
      total: Number(counts.rows[0]?.total ?? 0),
      asOf: new Date().toISOString(),
      coverage: COVERAGE,
      unread: Number(counts.rows[0]?.unread ?? 0),
      catchupPending,
    };
  });
}

/** One counted batch for this admin. The preference row serializes claims for
 * the same member; row leases arbitrate across devices. */
export async function claimAdminRecapDelivery(access: WorkOsAccess, input: {
  deviceId: string; windowId: string;
}): Promise<DeliveryLease | null> {
  requireAdmin(access);
  const deviceId = boundedText(input.deviceId, "deviceId");
  const windowId = boundedText(input.windowId, "windowId");
  return transaction(async (client) => {
    const preference = await lockPreference(client, access);
    if (!preference) return null;
    await materialize(client, preference);
    if (preference.active !== true || preference.activated_sequence === null) return null;

    const params = [access.organizationId, access.membershipId, access.ctx.user.id];
    const { rows } = await client.query<{ event_id: string }>(`SELECT d.event_id
      FROM ${VISIBLE_FROM}
      WHERE ${VISIBLE_WHERE}
        AND d.presented_at IS NULL
        AND d.seen_at IS NULL AND d.listened_at IS NULL
        AND (d.lease_until IS NULL OR d.lease_until <= clock_timestamp())
      ORDER BY r.event_sequence ASC
      LIMIT ${MAX_LIMIT}
      FOR UPDATE OF d SKIP LOCKED`, params);
    if (!rows.length) return null;

    const eventIds = rows.map((row) => row.event_id);
    const token = randomUUID();
    const updated = await client.query<{ lease_until: Date | string }>(`UPDATE work_admin_otto_deliveries
      SET lease_token = $3, lease_until = clock_timestamp() + interval '${LEASE_SECONDS} seconds',
          device_id = $4, window_id = $5
      WHERE organization_id = $1 AND membership_id = $2 AND event_id = ANY($6::uuid[])
      RETURNING lease_until`,
    [access.organizationId, access.membershipId, token, deviceId, windowId, eventIds]);
    const pending = await client.query<{ pending: number | string }>(`SELECT count(*)::int AS pending
      FROM ${VISIBLE_FROM}
      WHERE ${VISIBLE_WHERE} AND d.presented_at IS NULL`, params);
    return {
      token,
      expiresAt: iso(updated.rows[0].lease_until)!,
      eventIds,
      pendingCount: Number(pending.rows[0]?.pending ?? 0),
    };
  });
}

/** Only an unexpired lease may confirm presentation or release; seen, listened
 * and dismissed are personal to this admin and never touch another recipient. */
export async function updateAdminRecapDelivery(access: WorkOsAccess, input: {
  eventIds: string[];
  action: "presented" | "seen" | "listened" | "dismissed" | "release";
  leaseToken?: string;
}): Promise<void> {
  requireAdmin(access);
  const action = input.action;
  if (!["presented", "seen", "listened", "dismissed", "release"].includes(action)) {
    throw new WorkOsValidationError("action must be presented, seen, listened, dismissed or release");
  }
  const eventIds = normalizeEventIds(input.eventIds);
  const leaseAction = action === "presented" || action === "release";
  const leaseToken = leaseAction ? boundedText(input.leaseToken, "leaseToken") : null;

  await transaction(async (client) => {
    const preference = await lockPreference(client, access);
    if (!preference) return;
    const [organizationId, membershipId] = [access.organizationId, access.membershipId];

    // Release is deliberately permissive: a client may always clear a lease it
    // still owns, even if it expired or the item later became ineligible. A
    // token re-issued to another device is never cleared by the old token.
    if (action === "release") {
      await client.query(`UPDATE work_admin_otto_deliveries
        SET lease_token = NULL, lease_until = NULL, device_id = NULL, window_id = NULL
        WHERE organization_id = $1 AND membership_id = $2
          AND event_id = ANY($3::uuid[]) AND lease_token = $4`,
      [organizationId, membershipId, eventIds, leaseToken]);
      return;
    }

    if (action === "presented") {
      // One atomic statement: current membership/org/role/feature, current
      // epoch follow window, active person, retention, latest eligible review,
      // token ownership and DB-clock expiry all gate the presentation receipt.
      const updated = await client.query<{ event_id: string }>(`UPDATE work_admin_otto_deliveries d
        SET presented_at = clock_timestamp(), lease_token = NULL, lease_until = NULL,
            device_id = NULL, window_id = NULL
        FROM work_recap_reviews r,
             work_admin_otto_preferences p,
             work_org_members m,
             work_organizations o,
             work_people pe
        WHERE r.organization_id = d.organization_id AND r.id = d.event_id
          AND p.organization_id = d.organization_id AND p.membership_id = d.membership_id
          AND m.organization_id = p.organization_id AND m.id = p.membership_id
          AND o.id = p.organization_id
          AND pe.organization_id = r.organization_id AND pe.id = r.person_id
          AND ${VISIBLE_WHERE}
          AND d.event_id = ANY($4::uuid[])
          AND d.lease_token = $5
          AND d.lease_until > clock_timestamp()
          AND d.presented_at IS NULL
        RETURNING d.event_id`,
      [organizationId, membershipId, access.ctx.user.id, eventIds, leaseToken]);
      if (updated.rows.length !== eventIds.length) {
        throw new WorkOsConflictError("The delivery is no longer eligible or its lease expired.",
          "delivery_lease_invalid");
      }
      return;
    }

    if (preference.active !== true) return;

    if (action === "seen") {
      await client.query(`UPDATE work_admin_otto_deliveries
        SET seen_at = COALESCE(seen_at, clock_timestamp())
        WHERE organization_id = $1 AND membership_id = $2 AND event_id = ANY($3::uuid[])`,
      [organizationId, membershipId, eventIds]);
    } else if (action === "listened") {
      await client.query(`UPDATE work_admin_otto_deliveries
        SET listened_at = COALESCE(listened_at, clock_timestamp())
        WHERE organization_id = $1 AND membership_id = $2 AND event_id = ANY($3::uuid[])`,
      [organizationId, membershipId, eventIds]);
    } else {
      await client.query(`UPDATE work_admin_otto_deliveries
        SET dismissed_at = COALESCE(dismissed_at, clock_timestamp()),
            lease_token = NULL, lease_until = NULL, device_id = NULL, window_id = NULL
        WHERE organization_id = $1 AND membership_id = $2 AND event_id = ANY($3::uuid[])`,
      [organizationId, membershipId, eventIds]);
    }
  });
}
