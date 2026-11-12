import { randomUUID } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { createGhlClient, type GhlClient } from "./work-os-ghl-client";
import { loadGhlCredential, loadGhlIdentities, ghlMappingRevision, persistGhlRecords } from "./work-os-ghl-store";
import { normalizeGhlAppointmentCoverage, normalizeGhlRecord } from "./work-os-ghl-normalize";
import { hydrateDueGhlEmailContent } from "./work-os-ghl-email";
import type { GhlCoverage, GhlKind, GhlRecord, GhlScope } from "./work-os-ghl-types";

export const GHL_BACKFILL_DAYS = 30;
export const GHL_RECENT_OVERLAP_MS = 24 * 60 * 60 * 1000;
export const GHL_DUE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_PAGES = 10;
const DEFAULT_DEADLINE_MS = 40_000;
const LOCATION_TIMEZONE = "America/New_York";

export class GhlCursorExpiredError extends Error {
  constructor() {
    super("GHL export cursor expired");
    this.name = "GhlCursorExpiredError";
  }
}

export class GhlRateLimitError extends Error {
  retryAfterSeconds: number;
  constructor(retryAfterSeconds = 60) {
    super("GHL rate limit reached");
    this.name = "GhlRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface GhlPage {
  items: unknown[];
  nextCursor: string | null;
  capped: boolean;
}

export interface GhlSyncSource {
  messages(input: { channel: "Call" | "SMS" | "Email"; from: string; through: string; cursor: string | null; limit: number }): Promise<GhlPage>;
  calendars(): Promise<string[]>;
  appointments(input: { calendarId: string; from: string; through: string; cursor: string | null; limit: number }): Promise<GhlPage>;
  contacts(input: { cursor: string | null; limit: number }): Promise<GhlPage>;
  notes(contactId: string): Promise<unknown[]>;
  tasks(contactId: string): Promise<unknown[]>;
  opportunities(input: { from: string; through: string; cursor: string | null; limit: number }): Promise<GhlPage>;
}

export interface GhlPartitionPlan {
  key: string;
  kind: GhlKind;
  channel?: "Call" | "SMS" | "Email";
  from: string;
  through: string;
  recurring: boolean;
  /** Minimum interval between refreshes for a non-message snapshot. */
  cadenceMs?: number;
}

type Json = Record<string, any>;

function dateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function localDate(value: Date, timeZone: string): string {
  const parts = dateParts(value, timeZone);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day + delta, 12));
  return at.toISOString().slice(0, 10);
}

/** Midnight for a local calendar date, independent of the host timezone and
 * correct across DST changes. */
export function ghlLocalMidnight(date: string, timeZone = LOCATION_TIMEZONE): string {
  const [year, month, day] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day, 0, 0, 0);
  let instant = target;
  for (let index = 0; index < 4; index += 1) {
    const parts = dateParts(new Date(instant), timeZone);
    const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offset = wallAsUtc - instant;
    const next = target - offset;
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant).toISOString();
}

/** The 30 local calendar dates the pilot backfills, oldest first. */
export function ghlBackfillDates(now: Date, timeZone = LOCATION_TIMEZONE): string[] {
  const today = localDate(now, timeZone);
  return Array.from({ length: GHL_BACKFILL_DAYS }, (_, index) => addDays(today, index - (GHL_BACKFILL_DAYS - 1)));
}

export function ghlBackfillWindow(now: Date, timeZone = LOCATION_TIMEZONE) {
  const dates = ghlBackfillDates(now, timeZone);
  return { from: ghlLocalMidnight(dates[0]!, timeZone), through: now.toISOString(), dates };
}

/** One-shot partitions: a 30-day backfill, a 24-hour reconciliation overlap,
 * and a daily 30-day reconciliation. Appointment discovery is a scheduled
 * snapshot window, never a changed-since audit feed. */
export function ghlPartitionPlan(now: Date): GhlPartitionPlan[] {
  const backfill = ghlBackfillWindow(now);
  const recentFrom = new Date(now.getTime() - GHL_RECENT_OVERLAP_MS).toISOString();
  const appointmentThrough = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const channels = ["Call", "SMS", "Email"] as const;
  return [
    ...channels.map((channel) => ({ key: `backfill:${channel}`, kind: pageKind(channel), channel, from: backfill.from, through: backfill.through, recurring: false })),
    ...channels.map((channel) => ({ key: `recent:${channel}`, kind: pageKind(channel), channel, from: recentFrom, through: now.toISOString(), recurring: true })),
    ...channels.map((channel) => ({ key: `reconcile:${channel}`, kind: pageKind(channel), channel, from: backfill.from, through: backfill.through, recurring: false, cadenceMs: GHL_RECENT_OVERLAP_MS })),
    { key: "appointments:snapshot", kind: "appointment", from: backfill.from, through: appointmentThrough, recurring: false, cadenceMs: GHL_RECENT_OVERLAP_MS },
    { key: "contacts", kind: "note", from: backfill.from, through: backfill.through, recurring: false, cadenceMs: GHL_RECENT_OVERLAP_MS },
    { key: "opportunities", kind: "opportunity", from: backfill.from, through: backfill.through, recurring: false, cadenceMs: GHL_RECENT_OVERLAP_MS },
  ];
}

function entityArray(body: unknown): unknown[] {
  if (!body || typeof body !== "object") return [];
  const row = body as Json;
  for (const key of ["messages", "events", "calendars", "contacts", "conversations", "opportunities", "data"]) {
    if (Array.isArray(row[key])) return row[key];
  }
  return [];
}

function nextCursorOf(body: unknown, items: unknown[], limit: number): string | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Json;
  const cursor = row.nextCursor ?? row.next_cursor ?? row.lastMessageId ?? row.last_message_id;
  if (typeof cursor === "string" && cursor.trim()) return cursor;
  if (items.length < limit) return null;
  const last = items.at(-1) as Json | undefined;
  return last?.id ? String(last.id) : null;
}

/** The real adapter. It only reads documented endpoints through the bounded
 * client; any provider gap surfaces as a category failure, not a silent zero. */
export function createGhlSyncSource(scope: GhlScope, client: GhlClient): GhlSyncSource {
  return {
    async messages({ channel, from, through, cursor, limit }) {
      const body = await client.read({
        path: "/conversations/messages/export",
        query: {
          locationId: scope.locationId,
          channel,
          startDate: from,
          endDate: through,
          limit,
          ...(channel === "Email" ? { sortBy: "createdAt", sortDirection: "desc" } : {}),
          ...(cursor ? { lastMessageId: cursor } : {}),
        },
      });
      const items = entityArray(body);
      return { items, nextCursor: nextCursorOf(body, items, limit), capped: items.length >= limit };
    },
    async calendars() {
      const body = await client.read({ path: "/calendars/", query: { locationId: scope.locationId } });
      const calendars = entityArray(body);
      return calendars.map((item) => String((item as Json).id ?? "")).filter(Boolean);
    },
    async appointments({ calendarId, from, through, cursor, limit }) {
      const body = await client.read({
        path: "/calendars/events",
        query: {
          locationId: scope.locationId,
          calendarId,
          startTime: Date.parse(from),
          endTime: Date.parse(through),
        },
      });
      const items = entityArray(body).filter((item) => {
        if (!cursor) return true;
        return String((item as Json).id ?? "") > cursor;
      }).slice(0, limit);
      return { items, nextCursor: items.length >= limit ? String((items.at(-1) as Json)?.id ?? "") || null : null, capped: items.length >= limit };
    },
    async contacts({ cursor, limit }) {
      const page = cursor ? Math.max(1, Number(cursor)) : 1;
      const body = await client.read({
        path: "/contacts/search",
        method: "POST",
        body: { locationId: scope.locationId, page, pageLimit: limit },
      });
      const items = entityArray(body);
      const next = items.length >= limit ? String(page + 1) : null;
      return { items, nextCursor: next, capped: items.length >= limit };
    },
    async notes(contactId) {
      const body = await client.read({ path: `/contacts/${encodeURIComponent(contactId)}/notes` });
      return entityArray(body);
    },
    async tasks(contactId) {
      const body = await client.read({ path: `/contacts/${encodeURIComponent(contactId)}/tasks` });
      return entityArray(body);
    },
    async opportunities({ from, through, cursor, limit }) {
      const body = await client.read({
        path: "/opportunities/search",
        query: {
          locationId: scope.locationId,
          limit,
          ...(cursor ? { startAfterId: cursor } : {}),
          date: Date.parse(from),
          endDate: Date.parse(through),
        },
      });
      const items = entityArray(body);
      return { items, nextCursor: nextCursorOf(body, items, limit), capped: items.length >= limit };
    },
  };
}

export async function claimGhlPartition(input: {
  stateId: string;
  leaseOwner: string;
  now: Date;
  leaseMs?: number;
}): Promise<boolean> {
  const expires = new Date(input.now.getTime() + (input.leaseMs ?? 60_000)).toISOString();
  const result = await getPool().query(
    `update work_ghl_sync_state
        set lease_owner = $1, lease_expires_at = $2, state = 'running', updated_at = now()
      where id = $3 and (lease_owner is null or lease_expires_at < $4)
      returning id`,
    [input.leaseOwner, expires, input.stateId, input.now.toISOString()],
  );
  return result.rows.length > 0;
}

export async function advanceGhlCheckpoint(input: {
  stateId: string;
  leaseOwner: string;
  now: Date;
  scanned: number;
  nextCursor: string | null;
  state: "pending" | "complete" | "partial" | "failed";
  coverage: GhlCoverage;
  capped?: boolean;
  failureReason?: string | null;
}): Promise<boolean> {
  const result = await getPool().query(
    `update work_ghl_sync_state
        set cursor_value = $1, scanned = scanned + $2, state = $3, coverage = $4,
            failure_reason = $5, capped = $6, lease_owner = null, lease_expires_at = null,
            completed_through = case when $3 in ('complete','partial') then range_through else completed_through end,
            revision = revision + 1, last_synced_at = $7, updated_at = now()
      where id = $8 and lease_owner = $9 and lease_expires_at > $7
      returning id`,
    [
      input.nextCursor,
      Math.max(0, input.scanned),
      input.state,
      JSON.stringify(input.coverage),
      input.failureReason ?? null,
      input.capped === true,
      input.now.toISOString(),
      input.stateId,
      input.leaseOwner,
    ],
  );
  return result.rows.length > 0;
}

async function releaseLease(stateId: string, owner: string, now: Date, state: string, reason: string | null) {
  await getPool().query(
    `update work_ghl_sync_state
        set lease_owner = null, lease_expires_at = null, state = $1, failure_reason = $2,
            last_synced_at = case when $1 = 'failed' then last_synced_at else $3 end, updated_at = now()
      where id = $4 and lease_owner = $5`,
    [state, reason, now.toISOString(), stateId, owner],
  );
}

function sameInstant(left: unknown, right: unknown): boolean {
  const leftTime = new Date(String(left ?? "")).getTime();
  const rightTime = new Date(String(right ?? "")).getTime();
  return Number.isFinite(leftTime) && leftTime === rightTime;
}

async function ensureState(scope: GhlScope, plan: GhlPartitionPlan, now: Date): Promise<Json> {
  const existing = await getPool().query(
    "select * from work_ghl_sync_state where connection_id = $1 and kind = $2 and partition_key = $3",
    [scope.connectionId, plan.kind, plan.key],
  );
  const row = existing.rows[0] as Json | undefined;
  if (!row) {
    const inserted = await getPool().query(
      `insert into work_ghl_sync_state
        (organization_id, connection_id, kind, partition_key, state, range_from, range_through, coverage)
       values ($1,$2,$3,$4,'pending',$5,$6,$7)
       returning *`,
      [
        scope.organizationId,
        scope.connectionId,
        plan.kind,
        plan.key,
        plan.from,
        plan.through,
        JSON.stringify({ kind: plan.kind, state: "pending", from: plan.from, through: plan.through, reason: null, scanned: 0, capped: false }),
      ],
    );
    return inserted.rows[0] as Json;
  }
  if (plan.recurring && row.state === "complete" && !sameInstant(row.range_through, plan.through)) {
    const reset = await getPool().query(
      `update work_ghl_sync_state
          set range_from = $1, range_through = $2, cursor_value = null, state = 'pending', updated_at = now()
        where id = $3 returning *`,
      [plan.from, plan.through, row.id],
    );
    return reset.rows[0] as Json;
  }
  if (plan.cadenceMs && (row.state === "complete" || row.state === "partial")) {
    const last = row.last_synced_at ? new Date(String(row.last_synced_at)).getTime() : 0;
    if (!last || now.getTime() - last >= plan.cadenceMs) {
      const reset = await getPool().query(
        `update work_ghl_sync_state
            set range_from = $1, range_through = $2, cursor_value = null, state = 'pending', updated_at = now()
          where id = $3 returning *`,
        [plan.from, plan.through, row.id],
      );
      return reset.rows[0] as Json;
    }
  }
  return row;
}

function coverageState(row: Json): GhlCoverage["state"] {
  if (row.state === "failed") return "unavailable";
  if (row.state === "running") return "pending";
  if (row.state === "unavailable" || row.state === "partial" || row.state === "complete" || row.state === "pending") {
    return row.state;
  }
  return "pending";
}

function coverageFor(row: Json, plan: GhlPartitionPlan, state: GhlCoverage["state"], reason: string | null, scanned: number, capped: boolean): GhlCoverage {
  return {
    kind: plan.kind,
    state,
    from: String(row.range_from ?? plan.from),
    through: String(row.range_through ?? plan.through),
    reason,
    scanned,
    capped,
  };
}

async function processPartition(input: {
  scope: GhlScope;
  plan: GhlPartitionPlan;
  source: GhlSyncSource;
  now: Date;
  identities: Awaited<ReturnType<typeof loadGhlIdentities>>;
  revision: string;
  persist?: typeof persistGhlRecords;
}): Promise<boolean> {
  const { scope, plan, source, now, identities, revision } = input;
  const persist = input.persist ?? persistGhlRecords;
  const state = await ensureState(scope, plan, now);
  if (state.state === "complete" || state.state === "partial") {
    if (!plan.recurring) return false;
    if (sameInstant(state.range_through, plan.through)) return false;
  }
  const owner = randomUUID();
  if (!(await claimGhlPartition({ stateId: String(state.id), leaseOwner: owner, now }))) return false;
  const limit = plan.key === "contacts" ? 10 : 100;
  const asInstant = (value: unknown, fallback: string): string => {
    const parsed = new Date(value instanceof Date ? value.toISOString() : String(value ?? ""));
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
  };
  const from = asInstant(state.range_from, plan.from);
  const through = asInstant(state.range_through, plan.through);
  const cursor = state.cursor_value ? String(state.cursor_value) : null;
  const persistPage = (page: GhlRecord[]) => persist(scope, page, revision, { stateId: String(state.id), leaseOwner: owner, now });
  try {
    let records: GhlRecord[] = [];
    let nextCursor: string | null = null;
    let scanned = 0;
    let capped = false;
    if (plan.channel) {
      const page = await source.messages({ channel: plan.channel, from, through, cursor, limit });
      scanned = page.items.length;
      capped = page.capped;
      nextCursor = page.nextCursor;
      records = page.items.flatMap((item) => normalizeGhlRecord(pageKind(plan.channel!), item, { scope, identities, observedAt: now.toISOString() }));
    } else if (plan.key === "appointments:snapshot") {
      const calendarIds = await source.calendars();
      const all: unknown[] = [];
      for (const calendarId of calendarIds) {
        const page = await source.appointments({ calendarId, from, through, cursor: null, limit });
        all.push(...page.items);
        capped = capped || page.capped;
      }
      scanned = all.length;
      records = all.flatMap((item) => normalizeGhlRecord("appointment", item, { scope, identities, observedAt: now.toISOString() }));
      const persisted = await persistPage(records);
      if (persisted.fenced) return false;
      if (persisted.rejectedStaleMapping) {
        await releaseLease(String(state.id), owner, now, "pending", "Mapping changed during the page; pagination will retry from the durable checkpoint.");
        return true;
      }
      const coverage = normalizeGhlAppointmentCoverage({ scope, scheduledFrom: from, scheduledThrough: through, scanned, capped });
      const next = null;
      await advanceGhlCheckpoint({
        stateId: String(state.id),
        leaseOwner: owner,
        now,
        scanned,
        nextCursor: next,
        state: "partial",
        coverage,
        capped,
      });
      return true;
    } else if (plan.key === "contacts") {
      const page = await source.contacts({ cursor, limit });
      scanned = page.items.length;
      capped = page.capped;
      nextCursor = page.nextCursor;
      const notes: unknown[] = [];
      const tasks: unknown[] = [];
      for (const contact of page.items.slice(0, 10)) {
        const contactId = String((contact as Json).id ?? "");
        if (!contactId) continue;
        notes.push(...await source.notes(contactId));
        tasks.push(...await source.tasks(contactId));
      }
      records = [
        ...notes.flatMap((item) => normalizeGhlRecord("note", item, { scope, identities, observedAt: now.toISOString() })),
        ...tasks.flatMap((item) => normalizeGhlRecord("task", item, { scope, identities, observedAt: now.toISOString() })),
      ];
    } else if (plan.key === "opportunities") {
      const page = await source.opportunities({ from, through, cursor, limit });
      scanned = page.items.length;
      capped = page.capped;
      nextCursor = page.nextCursor;
      records = page.items.flatMap((item) => normalizeGhlRecord("opportunity", item, { scope, identities, observedAt: now.toISOString() }));
    }

    const persisted = await persistPage(records);
    if (persisted.fenced) return false;
    if (persisted.rejectedStaleMapping) {
      await releaseLease(String(state.id), owner, now, "pending", "Mapping changed during the page; pagination will retry from the durable checkpoint.");
      return true;
    }
    const terminal = !nextCursor;
    const terminalState: GhlCoverage["state"] = terminal ? (capped ? "partial" : "complete") : "pending";
    const reason = terminal && capped
      ? (plan.key === "contacts"
        ? "Contact discovery is capped; notes and tasks beyond the cap are not covered."
        : "Provider pagination is capped for this pilot window; further history is not covered.")
      : null;
    await advanceGhlCheckpoint({
      stateId: String(state.id),
      leaseOwner: owner,
      now,
      scanned,
      nextCursor,
      state: terminalState,
      coverage: coverageFor(state, plan, terminalState, reason, scanned, capped),
      capped,
    });
    return true;
  } catch (error) {
    const status = (error as { status?: unknown } | null)?.status;
    if (error instanceof GhlCursorExpiredError) {
      await releaseLease(String(state.id), owner, now, "pending", "Provider cursor expired; pagination restarted from a durable checkpoint.");
      await getPool().query(
        "update work_ghl_sync_state set cursor_value = null, state = 'pending', updated_at = now() where id = $1 and lease_owner = $2",
        [state.id, owner],
      );
      return true;
    }
    if (error instanceof GhlRateLimitError || status === 429) {
      const retry = error instanceof GhlRateLimitError ? error.retryAfterSeconds : 60;
      await releaseLease(String(state.id), owner, now, "pending", `Rate limited; retry after ${retry}s.`);
      return true;
    }
    if (status === 401 || status === 403) {
      await getPool().query(
        `update work_ghl_sync_state
            set coverage = jsonb_set(coverage, '{state}', to_jsonb('unavailable'::text), true),
                failure_reason = 'Provider rejected the credential or scope (401/403).', updated_at = now()
          where id = $1 and lease_owner = $2`,
        [state.id, owner],
      );
      await releaseLease(String(state.id), owner, now, "failed", "Provider rejected the credential or scope (401/403).");
      return true;
    }
    await releaseLease(String(state.id), owner, now, "failed", error instanceof Error ? error.message : "GHL synchronization failed");
    return true;
  }
}

function pageKind(channel: "Call" | "SMS" | "Email"): GhlKind {
  return channel === "Call" ? "call" : channel === "SMS" ? "sms" : "email";
}

export async function runGhlSync(input: {
  scope: GhlScope;
  now: Date;
  maxPages: number;
  deadlineMs: number;
  source?: GhlSyncSource;
  persist?: typeof persistGhlRecords;
}): Promise<{ coverage: GhlCoverage[]; pending: boolean }> {
  const { scope, now } = input;
  const source = input.source ?? createGhlSyncSource(scope, createGhlClient({ scope, token: await loadGhlCredential(scope) }));
  const identities = await loadGhlIdentities(scope);
  const revision = ghlMappingRevision(identities);
  const pages = Math.max(1, Math.min(input.maxPages || DEFAULT_MAX_PAGES, 50));
  const budget = Math.max(1_000, input.deadlineMs || DEFAULT_DEADLINE_MS);
  const startedAt = Date.now();
  let processed = 0;
  for (const plan of ghlPartitionPlan(now)) {
    if (processed >= pages || Date.now() - startedAt > budget) break;
    // Reconciliation only starts after the backfill has completed.
    if (plan.key.startsWith("reconcile:")) {
      const backfill = await getPool().query(
        "select state from work_ghl_sync_state where connection_id = $1 and partition_key = $2",
        [scope.connectionId, `backfill:${plan.channel}`],
      );
      if ((backfill.rows[0] as Json | undefined)?.state !== "complete") continue;
    }
    const attempted = await processPartition({ scope, plan, source, now, identities, revision, persist: input.persist });
    if (attempted) processed += 1;
  }
  const states = await getPool().query(
    "select * from work_ghl_sync_state where connection_id = $1 order by kind, partition_key",
    [scope.connectionId],
  );
  const coverage = (states.rows as Json[]).map((row) => {
    const stored = (row.coverage ?? {}) as Json;
    return {
      kind: String(row.kind) as GhlKind,
      state: coverageState(row),
      from: String(row.range_from ?? stored.from ?? now.toISOString()),
      through: String(row.range_through ?? stored.through ?? now.toISOString()),
      reason: row.failure_reason ? String(row.failure_reason) : (stored.reason ?? null),
      scanned: Number(row.scanned ?? 0),
      capped: row.capped === true || stored.capped === true,
    };
  });
  return { coverage, pending: coverage.some((item) => item.state === "pending") };
}

export async function syncDueGhlEvidence(input: {
  now: Date;
  limit: number;
  sourceForScope?: (scope: GhlScope) => GhlSyncSource | Promise<GhlSyncSource>;
  persist?: typeof persistGhlRecords;
}): Promise<{ processed: number; pending: number; failed: number }> {
  const connections = await getPool().query(
    `select c.id, c.organization_id, c.external_workspace_id
       from work_provider_connections c
       join work_organizations o on o.id = c.organization_id
       left join (
         select connection_id, max(last_synced_at) as last_synced_at
           from work_ghl_sync_state group by connection_id
       ) s on s.connection_id = c.id
      where c.provider = 'ghl' and c.active = true
        and coalesce(o.feature_flags->>'ghl_evidence', 'false') = 'true'
      order by s.last_synced_at asc nulls first
      limit 20`,
  );
  let processed = 0;
  let pending = 0;
  let failed = 0;
  for (const row of (connections.rows as Json[]).slice(0, Math.max(1, Math.min(input.limit, 20)))) {
    const scope: GhlScope = {
      organizationId: String(row.organization_id),
      connectionId: String(row.id),
      locationId: String(row.external_workspace_id),
    };
    const last = await getPool().query(
      "select max(last_synced_at) as last_synced_at from work_ghl_sync_state where connection_id = $1",
      [scope.connectionId],
    );
    const lastSyncedAt = (last.rows[0] as Json | undefined)?.last_synced_at;
    if (lastSyncedAt && new Date(lastSyncedAt).getTime() > input.now.getTime() - GHL_DUE_MS) {
      pending += 1;
      continue;
    }
    try {
      const source = input.sourceForScope ? await input.sourceForScope(scope) : undefined;
      await runGhlSync({
        scope,
        now: input.now,
        maxPages: DEFAULT_MAX_PAGES,
        deadlineMs: DEFAULT_DEADLINE_MS,
        source,
        persist: input.persist,
      });
      await hydrateDueGhlEmailContent({ scope, now: input.now, limit: 3 });
      processed += 1;
    } catch {
      failed += 1;
    }
  }
  return { processed, pending, failed };
}

export async function getGhlStatus(scope: GhlScope): Promise<{
  mode: "pit_polling";
  coverage: GhlCoverage[];
  lastSyncedAt: string | null;
  nextDueAt: string | null;
  state: string;
}> {
  const states = await getPool().query(
    "select * from work_ghl_sync_state where connection_id = $1 order by kind, partition_key",
    [scope.connectionId],
  );
  const rows = states.rows as Json[];
  if (!rows.length) {
    return { mode: "pit_polling", coverage: [], lastSyncedAt: null, nextDueAt: null, state: "not_started" };
  }
  const lastSyncedAt = rows
    .map((row) => row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
  const state = rows.some((row) => row.state === "failed")
    ? "failed"
    : rows.some((row) => row.state === "pending" || row.state === "running") ? "syncing" : "ready";
  return {
    mode: "pit_polling",
    coverage: rows.map((row) => {
      const stored = (row.coverage ?? {}) as Json;
      return {
        kind: String(row.kind) as GhlKind,
        state: coverageState(row),
        from: String(row.range_from ?? ""),
        through: String(row.range_through ?? ""),
        reason: row.failure_reason ? String(row.failure_reason) : (stored.reason ?? null),
        scanned: Number(row.scanned ?? 0),
        capped: row.capped === true,
      };
    }),
    lastSyncedAt,
    nextDueAt: lastSyncedAt ? new Date(new Date(lastSyncedAt).getTime() + GHL_DUE_MS).toISOString() : null,
    state,
  };
}
