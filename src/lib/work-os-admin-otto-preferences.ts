import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import type { FollowSettings } from "@/modules/work-os/admin-otto/contracts";

/** Stored following state for one admin membership. `personIds` is the saved
 * selection (retained across modes); All mode resolves the live active roster
 * separately so a new hire is followed without rewriting the saved list. */
type PreferenceRow = {
  organization_id: string;
  membership_id: string;
  mode: "all" | "selected";
  selected_person_ids: string[];
  revision: number;
  access_epoch: number;
  activated_sequence: string | number | bigint | null;
  active: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFERENCE_COLUMNS = `organization_id, membership_id, mode, selected_person_ids,
  revision, access_epoch, activated_sequence, active`;

function settings(row: PreferenceRow): FollowSettings {
  return {
    mode: row.mode,
    personIds: (row.selected_person_ids ?? []).map(String),
    revision: Number(row.revision),
    activated: row.active === true && row.activated_sequence !== null,
  };
}

function requireAdmin(access: WorkOsAccess) {
  if (access.role !== "admin" || access.featureFlags.employee_companion !== true) {
    throw new WorkOsConflictError("Admin Otto access is not active for this membership.", "otto_access_revoked");
  }
}

/** Re-read the membership and merged flags inside the transaction. Reads only:
 * the relevant member/org lifecycle trigger locks the org clock before deciding
 * and will correct a revoke that commits after this read; the opposite order is
 * visible here. Never lock the membership after the clock (that would invert the
 * lifecycle trigger's row-before-clock order). */
async function assertCurrentAccess(client: PoolClient, access: WorkOsAccess) {
  const { rows } = await client.query<{ allowed: boolean }>(`select
      work_admin_otto_effective_access(m.feature_flags, o.feature_flags, m.role, m.active) as allowed
    from work_org_members m
    join work_organizations o on o.id = m.organization_id
    where m.organization_id = $1 and m.id = $2 and m.user_id = $3`,
  [access.organizationId, access.membershipId, access.ctx.user.id]);
  if (rows[0]?.allowed !== true) {
    throw new WorkOsConflictError("Admin Otto access is not active for this membership.", "otto_access_revoked");
  }
}

async function transaction<T>(access: WorkOsAccess, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO work_admin_otto_clock (organization_id, sequence)
      VALUES ($1, 0) ON CONFLICT (organization_id) DO NOTHING`, [access.organizationId]);
    await client.query("SELECT sequence FROM work_admin_otto_clock WHERE organization_id = $1 FOR UPDATE",
      [access.organizationId]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

async function loadPreference(client: PoolClient, access: WorkOsAccess, lock = false) {
  const { rows } = await client.query<PreferenceRow>(`SELECT p.*
    FROM work_admin_otto_preferences p
    JOIN work_org_members m
      ON m.organization_id = p.organization_id AND m.id = p.membership_id
    WHERE p.organization_id = $1 AND p.membership_id = $2 AND m.user_id = $3
    ${lock ? "FOR UPDATE OF p" : ""}`,
  [access.organizationId, access.membershipId, access.ctx.user.id]);
  return rows[0];
}

/** Close windows that no longer cover an active person in the saved mode. The
 * epoch guard also retires any window left open by a missed lifecycle trigger. */
async function closeIneligibleWindows(
  client: PoolClient, access: WorkOsAccess, mode: "all" | "selected",
  personIds: string[], accessEpoch: number, boundary: string | number | bigint,
) {
  await client.query(`UPDATE work_admin_otto_follow_windows w
    SET end_sequence = $3
    WHERE w.organization_id = $1 AND w.membership_id = $2 AND w.end_sequence IS NULL
      AND (w.access_epoch <> $4 OR NOT EXISTS (
        SELECT 1 FROM work_people p
        WHERE p.organization_id = w.organization_id AND p.id = w.person_id AND p.active
          AND ($5 = 'all' OR p.id = ANY($6::uuid[]))
      ))`,
  [access.organizationId, access.membershipId, boundary, accessEpoch, mode, personIds]);
}

async function openEligibleWindows(
  client: PoolClient, access: WorkOsAccess, mode: "all" | "selected",
  personIds: string[], accessEpoch: number, boundary: string | number | bigint,
) {
  await client.query(`INSERT INTO work_admin_otto_follow_windows
      (organization_id, membership_id, person_id, access_epoch, start_sequence)
    SELECT $1, $2, p.id, $5, $6
    FROM work_people p
    WHERE p.organization_id = $1 AND p.active
      AND ($3 = 'all' OR p.id = ANY($4::uuid[]))
    ON CONFLICT (organization_id, membership_id, person_id) WHERE end_sequence IS NULL DO NOTHING`,
  [access.organizationId, access.membershipId, mode, personIds, accessEpoch, boundary]);
}

function normalizePersonIds(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !uuid.test(value)) {
      throw new WorkOsValidationError("personIds must be organization employee ids");
    }
    const id = value.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }
  return normalized;
}

/** Validate only newly submitted ids against this organization. Previously
 * saved inactive ids stay accepted so an admin can keep a choice across an
 * employee's inactive period; a foreign or missing new id is rejected. */
async function validateSelection(client: PoolClient, access: WorkOsAccess, personIds: string[], previous: string[]) {
  const known = new Set(previous.map(String));
  const added = personIds.filter((id) => !known.has(id));
  if (!added.length) return;
  const { rows } = await client.query<{ id: string }>(
    "SELECT id FROM work_people WHERE organization_id = $1 AND id = ANY($2::uuid[])",
    [access.organizationId, added]);
  const found = new Set(rows.map((row) => String(row.id)));
  if (added.some((id) => !found.has(id))) {
    throw new WorkOsValidationError("Every selected employee must belong to this organization.");
  }
}

/** Explicit POST context is the only first-use/lifecycle activation. A normal
 * reconnect keeps the epoch and watermark and writes nothing. */
export async function initializeAdminOtto(access: WorkOsAccess): Promise<FollowSettings> {
  requireAdmin(access);
  return transaction(access, async (client) => {
    await assertCurrentAccess(client, access);
    const current = await loadPreference(client, access, true);
    if (current?.active === true && current.activated_sequence !== null) return settings(current);

    const { rows } = await client.query<{ sequence: string | number | bigint }>(
      `UPDATE work_admin_otto_clock SET sequence = sequence + 1
       WHERE organization_id = $1 RETURNING sequence`, [access.organizationId]);
    const boundary = rows[0].sequence;
    const accessEpoch = Number(current?.access_epoch ?? 0) + 1;

    let saved: PreferenceRow;
    if (current) {
      const updated = await client.query<PreferenceRow>(`UPDATE work_admin_otto_preferences
        SET active = true, activated_sequence = $3, access_epoch = $4, updated_at = clock_timestamp()
        WHERE organization_id = $1 AND membership_id = $2
        RETURNING ${PREFERENCE_COLUMNS}`,
      [access.organizationId, access.membershipId, boundary, accessEpoch]);
      saved = updated.rows[0];
    } else {
      const inserted = await client.query<PreferenceRow>(`INSERT INTO work_admin_otto_preferences
        (organization_id, membership_id, mode, selected_person_ids, revision,
         access_epoch, activated_sequence, active)
        VALUES ($1, $2, 'all', '{}'::uuid[], 0, 1, $3, true)
        RETURNING ${PREFERENCE_COLUMNS}`,
      [access.organizationId, access.membershipId, boundary]);
      saved = inserted.rows[0];
    }

    await closeIneligibleWindows(client, access, saved.mode, saved.selected_person_ids, Number(saved.access_epoch), boundary);
    await openEligibleWindows(client, access, saved.mode, saved.selected_person_ids, Number(saved.access_epoch), boundary);
    return settings(saved);
  });
}

/** Read-only and scoped to the authenticated user: GET never creates a
 * preference, clock row or window and never activates first use. A revoked
 * membership returns `otto_access_revoked` rather than a silent default. */
export async function getAdminOttoPreferences(access: WorkOsAccess): Promise<FollowSettings> {
  requireAdmin(access);
  const client = await getPool().connect();
  try {
    await assertCurrentAccess(client, access);
    const current = await loadPreference(client, access);
    return current ? settings(current) : { mode: "all", personIds: [], revision: 0, activated: false };
  } finally { client.release(); }
}

/** Optimistic save. Clock first, then the preference row and windows; lifecycle
 * triggers lock the same clock before deciding and recheck follow state from
 * their own DML snapshot, so no employee-review transaction is blocked behind a
 * preference lock and a concurrent lifecycle change cannot be missed. */
export async function saveAdminOttoPreferences(access: WorkOsAccess, input: {
  mode: "all" | "selected"; personIds: string[]; expectedRevision: number;
}): Promise<FollowSettings> {
  requireAdmin(access);
  if (input.mode !== "all" && input.mode !== "selected") {
    throw new WorkOsValidationError("mode must be all or selected");
  }
  if (!Array.isArray(input.personIds)) throw new WorkOsValidationError("personIds must be an array");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new WorkOsValidationError("expectedRevision must be a non-negative integer");
  }
  const personIds = normalizePersonIds(input.personIds);

  return transaction(access, async (client) => {
    await assertCurrentAccess(client, access);
    const current = await loadPreference(client, access, true);
    if (!current || current.active !== true || current.activated_sequence === null) {
      throw new WorkOsConflictError("Otto context must be activated before saving follow preferences.",
        "otto_context_required");
    }
    if (Number(current.revision) !== input.expectedRevision) {
      throw new WorkOsConflictError("Follow preferences changed on another device. Reload before saving.",
        "preferences_conflict");
    }
    await validateSelection(client, access, personIds, current.selected_person_ids);

    const { rows } = await client.query<{ sequence: string | number | bigint }>(
      `UPDATE work_admin_otto_clock SET sequence = sequence + 1
       WHERE organization_id = $1 RETURNING sequence`, [access.organizationId]);
    const boundary = rows[0].sequence;
    const updated = await client.query<PreferenceRow>(`UPDATE work_admin_otto_preferences
      SET mode = $3, selected_person_ids = $4::uuid[], revision = revision + 1,
          updated_at = clock_timestamp()
      WHERE organization_id = $1 AND membership_id = $2
      RETURNING ${PREFERENCE_COLUMNS}`,
    [access.organizationId, access.membershipId, input.mode, personIds]);
    const saved = updated.rows[0];
    await closeIneligibleWindows(client, access, saved.mode, saved.selected_person_ids, Number(saved.access_epoch), boundary);
    await openEligibleWindows(client, access, saved.mode, saved.selected_person_ids, Number(saved.access_epoch), boundary);
    return settings(saved);
  });
}
