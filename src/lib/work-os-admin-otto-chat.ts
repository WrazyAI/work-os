import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import {
  adminRecordWindows,
  listAdminOttoRecords,
  listAdminOttoRecaps,
  listAdminOttoTasks,
  resolveAdminOttoPeople,
} from "@/lib/work-os-admin-otto-reads";
import {
  parseAdminOttoIntent,
  requireAdminOttoIntent,
  type AdminOttoIntentContext,
} from "@/lib/work-os-admin-otto-intent";
import {
  adminOttoConversationReply,
  adminOttoMessageRef,
  matchAdminOttoConversation,
  readAdminOttoMessageRef,
  type AdminOttoMessageRef,
} from "@/lib/work-os-admin-otto-conversation";
import type {
  AdminRead,
  ChatRequest,
  ChatResult,
  LocalWindow,
  Page,
  PersonRef,
  ReadIntent,
  Resolution,
  ReviewedRecap,
  Target,
  WorkRecord,
} from "@/modules/work-os/admin-otto/contracts";

/**
 * Admin Otto's read-only conversational runner. The model classifies a bounded
 * intent; this module owns the actor/organization context, resolves names
 * against the active authorized roster, executes the typed Task 5 readers, and
 * writes only thread/turn bookkeeping. It has no mutation, proposal, private
 * employee-chat, memory, draft, URL, SQL or host-execution path.
 */

export type AdminOttoChatDeps = {
  parseIntent?: (text: string, context: AdminOttoIntentContext) => Promise<ReadIntent | null>;
  /** Re-run the authoritative read authorization after the long read and
   * before the thread/turn write. The route supplies a read-capability check;
   * `revalidateAdminOttoAccess` is deliberately voice-gated and is not used. */
  revalidateAccess?: (access: WorkOsAccess) => Promise<WorkOsAccess>;
  now?: () => Date;
  newId?: () => string;
};

export type AdminOttoThreadTurn = {
  turnId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

export type AdminOttoThreadView = {
  conversationId: string;
  contextVersion: number;
  turns: AdminOttoThreadTurn[];
  result: AdminRead | null;
  resultStatus: "ready" | "stale" | "unavailable";
};

type ThreadRow = {
  id: string;
  organization_id: string;
  membership_id: string;
  context_version: number | string;
  last_intent: unknown;
  resolved_person_ids: string[] | null;
  pending_resolution: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

type TurnRow = {
  id: string;
  role: "user" | "assistant";
  text: string;
  source_refs: unknown;
  created_at: Date | string;
};

type AmbiguousGroup = { name: string; choices: PersonRef[] };

/** The complete intended target plus the progress already made. A mixed
 * request such as "Alex and Sam" keeps Alex resolved while Sam waits. */
type PendingTargetState = {
  v: 1;
  intent: ReadIntent;
  resolved: PersonRef[];
  ambiguous: AmbiguousGroup[];
  missing: string[];
};

type TargetResolution = {
  people: PersonRef[];
  ambiguous: AmbiguousGroup[];
  missing: string[];
  denied?: boolean;
  replyOverride?: string;
};

type ResultSnapshot = {
  total: number;
  ids: string[];
  reviewKey?: string;
};

type StoredReadRefs =
  | {
      v: 1;
      kind: "read";
      intent: ReadIntent;
      personIds: string[];
      people: Array<{ id: string; displayName: string }>;
      rosterIds: string[];
      windows: LocalWindow[] | null;
      missing: string[];
      snapshot?: ResultSnapshot;
      recapKey?: string;
    }
  | {
      v: 1;
      kind: "resolution";
      intent: ReadIntent;
      resolution: Resolution;
      pending: PendingTargetState | null;
    }
  | AdminOttoMessageRef
  | { v: 1; kind: "unsupported" };

type ExecutedRead = {
  read: AdminRead | null;
  refs: StoredReadRefs;
  reply: string;
  errorCode?: ChatResult["errorCode"];
  stale?: boolean;
};

type ContinuationPayload = {
  v: 1;
  k: "tasks" | "records" | "recaps";
  t: string;
  o: string;
  m: string;
  u: string;
  cv: number;
  ti: string;
  it: ReadIntent;
  p: string[];
  r: string[];
  w: LocalWindow[] | null;
  c: string;
};

const MAX_TEXT = 4_000;
const MAX_TURNS = 24;
const MAX_CONTINUATION = 32_768;
const RETENTION_DAYS = 30;
const MAX_WINDOWS = 100;
const MAX_PEOPLE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;

const UNSUPPORTED_REPLY = "I can only read existing Work OS records here: unfinished tasks, work records, reviewed recaps, a latest reviewed recap, or a workday. I can't change, message, or run anything.";

function requireAdmin(access: WorkOsAccess) {
  if (access.role !== "admin" || access.featureFlags.employee_companion !== true) {
    throw new WorkOsConflictError("Admin Otto access is not active for this membership.", "otto_access_revoked");
  }
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new WorkOsValidationError(`${field} must be a valid id`);
  }
  return value.toLowerCase();
}

function safeIso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function sameActor(left: WorkOsAccess, right: WorkOsAccess): boolean {
  return left.organizationId === right.organizationId
    && left.membershipId === right.membershipId
    && left.ctx.user.id === right.ctx.user.id;
}

/** Re-run the authoritative read authorization after a long read. The route
 * supplies a read-capability callback; the voice-gated Task 1 helper is not
 * used here. */
async function recheckAfterRead(access: WorkOsAccess, deps: AdminOttoChatDeps) {
  if (!deps.revalidateAccess) return;
  const fresh = await deps.revalidateAccess(access);
  if (!sameActor(access, fresh)) {
    throw new WorkOsConflictError("Admin Otto access changed during the read.", "otto_access_revoked");
  }
  requireAdmin(fresh);
}

function personRef(value: unknown): PersonRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !UUID.test(row.id)) return null;
  const displayName = typeof row.displayName === "string"
    ? row.displayName.replace(/\s+/g, " ").trim()
    : "";
  if (!displayName) return null;
  return {
    id: row.id.toLowerCase(),
    displayName,
    active: row.active === true,
    timezone: typeof row.timezone === "string" ? row.timezone : "UTC",
  };
}

/** NFC (not NFKC) preserves accents, script letters and apostrophes while
 * composing canonically equivalent input. Matching uses the same normalization
 * as the Task 5 name resolver; compatibility folding would create wrong
 * matches (for example, full-width or stripped accents). */
function normalizeText(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[\u2018\u2019\u201b`\u00b4]/g, "'")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

/** A model-supplied name is authorized only by its complete phrase in the
 * administrator's text, bounded by letters/numbers/marks from every script.
 * This accepts exact names, partial names the administrator actually wrote,
 * possessives (`Sam's`) and non-Latin/accented names, but rejects `Sam` inside
 * `same` and `Will Smith` inside `will you`; no token or substring fallback is
 * permitted. Model ids are never name provenance. */
function nameAuthorizedByText(name: string, text: string): boolean {
  const nameText = normalizeText(name);
  const textText = normalizeText(text);
  if (!nameText || !textText) return false;
  const escaped = nameText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escaped}(?![\\p{L}\\p{N}\\p{M}])`, "u");
  return pattern.test(textText);
}

function dedupePeople(people: PersonRef[]): PersonRef[] {
  const seen = new Set<string>();
  const result: PersonRef[] = [];
  for (const person of people) {
    if (seen.has(person.id)) continue;
    seen.add(person.id);
    result.push(person);
  }
  return result;
}

function personSnapshots(people: PersonRef[]): Array<{ id: string; displayName: string }> {
  return people.map((person) => ({ id: person.id, displayName: person.displayName }));
}

function pendingTargetState(value: unknown): PendingTargetState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.v !== 1) return null;
  let intent: ReadIntent;
  try {
    intent = requireAdminOttoIntent(row.intent);
  } catch {
    return null;
  }
  const resolved: PersonRef[] = [];
  if (Array.isArray(row.resolved)) {
    for (const entry of row.resolved) {
      const person = personRef(entry);
      if (person) resolved.push(person);
    }
  }
  const ambiguous: AmbiguousGroup[] = [];
  if (Array.isArray(row.ambiguous)) {
    for (const entry of row.ambiguous) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      const group = entry as Record<string, unknown>;
      if (typeof group.name !== "string" || !Array.isArray(group.choices)) return null;
      const choices: PersonRef[] = [];
      for (const choice of group.choices) {
        const person = personRef(choice);
        if (person) choices.push(person);
      }
      if (!choices.length) return null;
      ambiguous.push({ name: group.name.replace(/\s+/g, " ").trim().slice(0, 120), choices });
    }
  }
  const missing: string[] = [];
  if (Array.isArray(row.missing)) {
    for (const name of row.missing) {
      if (typeof name === "string" && name.trim()) missing.push(name.replace(/\s+/g, " ").trim().slice(0, 120));
    }
  }
  if (!resolved.length && !ambiguous.length && !missing.length) return null;
  return { v: 1, intent, resolved: dedupePeople(resolved), ambiguous, missing };
}

function resolutionValue(value: unknown): Exclude<Resolution, { kind: "resolved" }> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind === "ambiguous") {
    if (typeof row.name !== "string" || !Array.isArray(row.choices)) return null;
    const choices: PersonRef[] = [];
    for (const entry of row.choices) {
      const person = personRef(entry);
      if (person) choices.push(person);
    }
    if (!choices.length) return null;
    return { kind: "ambiguous", name: row.name.replace(/\s+/g, " ").trim().slice(0, 120), choices };
  }
  if (row.kind === "missing" && typeof row.name === "string" && row.name.trim()) {
    return { kind: "missing", name: row.name.replace(/\s+/g, " ").trim().slice(0, 120) };
  }
  return null;
}

function resolutionCard(state: PendingTargetState): Exclude<Resolution, { kind: "resolved" }> | null {
  const first = state.ambiguous[0];
  if (first) return { kind: "ambiguous", name: first.name, choices: first.choices };
  if (state.missing[0]) return { kind: "missing", name: state.missing[0] };
  return null;
}

function resolutionReply(state: PendingTargetState, override?: string): string {
  if (override) return override;
  const parts: string[] = [];
  if (state.resolved.length) parts.push(`Resolved: ${describePeople(state.resolved, false)}.`);
  for (const group of state.ambiguous) {
    const names = group.choices.slice(0, MAX_PEOPLE).map((person) => person.displayName);
    const extra = group.choices.length > MAX_PEOPLE ? ` and ${group.choices.length - MAX_PEOPLE} others` : "";
    parts.push(`More than one employee matches "${group.name}": ${names.join(", ")}${extra}.`);
  }
  if (state.missing.length) {
    parts.push(`Not included (no active employee found): ${state.missing.join(", ")}.`);
  }
  if (!state.resolved.length && !state.ambiguous.length && state.missing.length) {
    return `No active employee named ${state.missing.join(", ")} was found. Check the name and try again.`;
  }
  if (state.ambiguous.length) parts.push("Choose one employee for the first match to continue.");
  return parts.join(" ").trim();
}

function threadIntent(value: unknown): ReadIntent | null {
  if (!value) return null;
  try {
    return requireAdminOttoIntent(value);
  } catch {
    return null;
  }
}

function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  return (async () => {
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
  })();
}

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

async function loadThread(access: WorkOsAccess, id: string, client?: Pool | PoolClient): Promise<ThreadRow | undefined> {
  const queryable = client ?? getPool();
  const { rows } = await queryable.query<ThreadRow>(`select t.*
    from work_admin_otto_threads t
    join work_org_members m
      on m.organization_id = t.organization_id and m.id = t.membership_id
    join work_organizations o on o.id = t.organization_id
    where t.organization_id = $1 and t.id = $2 and t.membership_id = $3
      and m.user_id = $4
      and work_admin_otto_effective_access(m.feature_flags, o.feature_flags, m.role, m.active)`,
  [access.organizationId, id, access.membershipId, access.ctx.user.id]);
  return rows[0];
}

async function loadTurns(access: WorkOsAccess, threadId: string): Promise<TurnRow[]> {
  const { rows } = await getPool().query<TurnRow>(`select id, role, text, source_refs, created_at
    from work_admin_otto_turns
    where organization_id = $1 and thread_id = $2 and membership_id = $3
      and created_at >= clock_timestamp() - interval '${RETENTION_DAYS} days'
    order by created_at desc, id desc
    limit $4`,
  [access.organizationId, threadId, access.membershipId, MAX_TURNS]);
  return rows.reverse();
}

async function findDuplicateTurn(access: WorkOsAccess, threadId: string, requestId: string): Promise<TurnRow | undefined> {
  const { rows } = await getPool().query<TurnRow>(`select id, role, text, source_refs, created_at
    from work_admin_otto_turns
    where organization_id = $1 and thread_id = $2 and membership_id = $3
      and request_id = $4 and role = 'assistant'
      and created_at >= clock_timestamp() - interval '${RETENTION_DAYS} days'`,
  [access.organizationId, threadId, access.membershipId, requestId]);
  return rows[0];
}

function normalizeRequest(input: ChatRequest): {
  conversationId: string | null;
  requestId: string;
  text: string;
  choicePersonId: string | null;
  continuation: string | null;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new WorkOsValidationError("Body must be a JSON object");
  }
  const conversationId = input.conversationId === null || input.conversationId === undefined
    ? null
    : uuid(input.conversationId, "conversationId");
  const requestId = uuid(input.requestId, "requestId");
  if (typeof input.text !== "string") throw new WorkOsValidationError("text is required");
  const text = input.text.trim();
  if (!text || text.length > MAX_TEXT) {
    throw new WorkOsValidationError(`text must be between 1 and ${MAX_TEXT} characters`);
  }
  const choicePersonId = input.choicePersonId === undefined || input.choicePersonId === null
    ? null
    : uuid(input.choicePersonId, "choicePersonId");
  const continuation = input.continuation === undefined || input.continuation === null
    ? null
    : input.continuation;
  if (continuation !== null && (typeof continuation !== "string" || !continuation || continuation.length > MAX_CONTINUATION)) {
    throw new WorkOsValidationError("continuation is invalid");
  }
  if (choicePersonId && continuation) {
    throw new WorkOsValidationError("choicePersonId and continuation cannot be combined");
  }
  return { conversationId, requestId, text, choicePersonId, continuation };
}

type NormalizedRequest = ReturnType<typeof normalizeRequest>;
type CommittedRequest = {
  request_hash: string;
  requested_conversation_id: string | null;
  thread_id: string;
  turn_id: string;
};

function requestHash(request: NormalizedRequest): string {
  // Explicit field order; no parser output or client-supplied actor is trusted.
  return createHash("sha256").update(JSON.stringify([1, request.text, request.choicePersonId, request.continuation])).digest("hex");
}

function assertSameRequest(row: CommittedRequest, request: NormalizedRequest) {
  if (row.request_hash !== requestHash(request)
    || (request.conversationId !== row.requested_conversation_id && request.conversationId !== row.thread_id)) {
    throw new WorkOsConflictError("This request id was already used for a different request. Start a new request.", "request_id_reused");
  }
}

async function loadCommittedRequest(access: WorkOsAccess, request: NormalizedRequest, client: Pool | PoolClient = getPool()) {
  const { rows } = await client.query<CommittedRequest>(`select r.request_hash, r.requested_conversation_id, r.thread_id, r.turn_id
    from work_admin_otto_chat_requests r
    join work_org_members m on m.organization_id = r.organization_id and m.id = r.membership_id and m.user_id = r.user_id
    join work_organizations o on o.id = m.organization_id
    where r.organization_id = $1 and r.membership_id = $2 and r.user_id = $3 and r.request_id = $4
      and work_admin_otto_effective_access(m.feature_flags, o.feature_flags, m.role, m.active)`,
  [access.organizationId, access.membershipId, access.ctx.user.id, request.requestId]);
  const row = rows[0];
  if (row) assertSameRequest(row, request);
  return row;
}

async function replayCommittedRequest(access: WorkOsAccess, row: CommittedRequest, deps: AdminOttoChatDeps, now: Date) {
  const thread = await loadThread(access, row.thread_id);
  const turn = thread ? await findDuplicateTurnById(access, thread.id, row.turn_id) : undefined;
  if (!thread || !turn || turn.role !== "assistant") {
    // A retained identity never permits re-executing an expired/missing turn.
    throw new WorkOsConflictError("This conversation's saved result is no longer available.", "conversation_unavailable");
  }
  return replay(access, thread, turn, deps, now);
}

function resolvedTarget(intent: ReadIntent, people: PersonRef[]): ReadIntent {
  return intent.target.kind === "team"
    ? intent
    : { ...intent, target: { kind: "ids", ids: people.map((person) => person.id) } };
}

/** Resolve every name independently so a later ambiguity or miss never drops
 * the people who already resolved. */
async function resolveTargetRequest(
  access: WorkOsAccess,
  target: Target,
  initialPeople: PersonRef[] = [],
): Promise<TargetResolution> {
  if (target.kind === "team") {
    const resolution = await resolveAdminOttoPeople(access, { kind: "team" });
    if (resolution.kind !== "resolved") {
      return { people: [], ambiguous: [], missing: ["the team"] };
    }
    return { people: resolution.people, ambiguous: [], missing: [] };
  }
  if (target.kind === "ids") {
    const resolution = await resolveAdminOttoPeople(access, { kind: "ids", ids: target.ids });
    if (resolution.kind !== "resolved") {
      return { people: [], ambiguous: [], missing: [resolution.name] };
    }
    return { people: resolution.people, ambiguous: [], missing: [] };
  }
  const people = dedupePeople(initialPeople);
  const ambiguous: AmbiguousGroup[] = [];
  const missing: string[] = [];
  for (const name of target.names) {
    const resolution = await resolveAdminOttoPeople(access, { kind: "names", names: [name] });
    if (resolution.kind === "resolved") {
      people.push(...resolution.people);
    } else if (resolution.kind === "ambiguous") {
      ambiguous.push({ name: resolution.name, choices: resolution.choices });
    } else {
      missing.push(resolution.name);
    }
  }
  return { people: dedupePeople(people), ambiguous, missing };
}

function allowedModelIds(
  context: AdminOttoIntentContext,
  thread: ThreadRow | undefined,
  pending: PendingTargetState | null,
): Set<string> {
  const ids = new Set(context.people.map((person) => person.id));
  for (const id of thread?.resolved_person_ids ?? []) if (UUID.test(id)) ids.add(id.toLowerCase());
  for (const person of pending?.resolved ?? []) ids.add(person.id);
  for (const group of pending?.ambiguous ?? []) for (const person of group.choices) ids.add(person.id);
  return ids;
}

function describePeople(people: PersonRef[], team: boolean): string {
  const names = people.map((person) => person.displayName);
  if (team) return `The team (${names.length} ${names.length === 1 ? "employee" : "employees"})`;
  if (names.length === 0) return "No employees";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others`;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function windowSummary(windows: LocalWindow[]): string {
  if (!windows.length) return "the requested local window";
  const dates = new Set(windows.map((window) => `${window.from}|${window.through}`));
  const timezones = new Set(windows.map((window) => window.timezone));
  if (dates.size === 1 && timezones.size === 1) {
    const [from, through] = windows[0].from === windows[0].through
      ? [windows[0].from, windows[0].from]
      : [windows[0].from, windows[0].through];
    return from === through ? `${from} (${windows[0].timezone})` : `${from} through ${through} (${windows[0].timezone})`;
  }
  return windows.length === 1 ? "one employee's local window" : `${windows.length} employees' local windows`;
}

function localDay(instant: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(instant));
  } catch {
    return instant.slice(0, 10);
  }
}

function emptyRecaps(text: string, now: Date): Page<ReviewedRecap> {
  return { items: [], nextCursor: null, total: 0, asOf: now.toISOString(), coverage: [text] };
}

type ReadResult = Exclude<AdminRead, { kind: "resolution" }>;

function replyFor(read: ReadResult, intent: ReadIntent, resolved: PersonRef[]): { reply: string; errorCode?: ChatResult["errorCode"] } {
  const team = intent.target.kind === "team";
  const label = describePeople(resolved, team);
  if (read.kind === "tasks") {
    const kind = intent.overdueOnly ? "overdue task" : "open task";
    if (!read.page.total) return { reply: `${label} has no ${intent.overdueOnly ? "overdue" : "open"} tasks as of ${read.page.asOf.slice(0, 10)}.` };
    const shown = read.page.items.length < read.page.total ? ` Showing ${read.page.items.length} of ${read.page.total}.` : "";
    return { reply: `${label} has ${plural(read.page.total, kind)}.${shown}` };
  }
  if (read.kind === "records") {
    const scope = windowSummary(read.windows);
    if (!read.page.total) {
      return { reply: `No matching records for ${label} in ${scope}. A missing record does not mean no work was done.` };
    }
    if (intent.action === "workday") {
      return { reply: `Workday record for ${label} in ${scope}: ${plural(read.page.total, "row")}.` };
    }
    const shown = read.page.items.length < read.page.total ? ` Showing ${read.page.items.length} of ${read.page.total}.` : "";
    return { reply: `${label}: ${plural(read.page.total, "record")} in ${scope}.${shown}` };
  }
  if (read.kind === "recaps") {
    if (!read.page.total) {
      return {
        reply: intent.action === "read_recap"
          ? `No reviewed recap was found for ${label}.`
          : `No reviewed recaps were found for ${label}.`,
        ...(intent.action === "read_recap" ? { errorCode: "missing" as const } : {}),
      };
    }
    const shown = read.page.items.length < read.page.total
      ? ` Showing ${read.page.items.length} of ${read.page.total}.`
      : "";
    return { reply: `${label}: ${plural(read.page.total, "reviewed recap")}${intent.latest ? " (latest per employee)" : ""}.${shown}` };
  }
  const recap = read.recap;
  const windowDay = localDay(recap.windowStart, recap.timezone);
  const reviewDay = recap.reviewedAt ? localDay(recap.reviewedAt, recap.timezone) : "";
  const name = recap.person.displayName.replace(/\s+/g, " ").trim();
  return {
    reply: `${name}: latest reviewed recap (${recap.reviewStatus}) for ${windowDay}${reviewDay ? `, reviewed ${reviewDay}` : ""}.`,
  };
}

function computeWindows(intent: ReadIntent, people: PersonRef[], now: Date): LocalWindow[] {
  if (intent.date) return adminRecordWindows(people, { from: intent.date, through: intent.date }, now);
  if (intent.from || intent.through) {
    return adminRecordWindows(people, { from: intent.from, through: intent.through }, now);
  }
  const relativeDay = intent.action === "workday" ? (intent.relativeDay ?? "today") : intent.relativeDay;
  return adminRecordWindows(people, { relativeDay }, now);
}

function readSnapshot(read: AdminRead): ResultSnapshot | null {
  if (read.kind === "tasks") {
    return { total: read.page.total, ids: read.page.items.map((task) => task.id) };
  }
  if (read.kind === "records") {
    return { total: read.page.total, ids: read.page.items.map((record) => record.id) };
  }
  if (read.kind === "recaps") {
    return { total: read.page.total, ids: read.page.items.map((recap) => recap.reviewKey) };
  }
  if (read.kind === "recap") {
    return { total: 1, ids: [read.recap.reviewKey], reviewKey: read.recap.reviewKey };
  }
  return null;
}

function snapshotMatches(expected: ResultSnapshot | undefined, read: AdminRead): boolean {
  if (!expected) return true;
  const actual = readSnapshot(read);
  if (!actual) return false;
  if (expected.total !== actual.total || expected.ids.length !== actual.ids.length) return false;
  if (!expected.ids.every((id, index) => id === actual.ids[index])) return false;
  return (expected.reviewKey ?? null) === (actual.reviewKey ?? null);
}

function samePersonSnapshots(
  expected: Array<{ id: string; displayName: string }>,
  current: PersonRef[],
): boolean {
  if (!expected.length) return true;
  const byId = new Map(current.map((person) => [person.id, person.displayName]));
  return expected.every((person) => byId.get(person.id) === person.displayName);
}

function sameChoiceSet(expected: PersonRef[], current: PersonRef[]): boolean {
  if (expected.length !== current.length) return false;
  const expectedIds = [...expected].sort((left, right) => left.id.localeCompare(right.id));
  const currentIds = [...current].sort((left, right) => left.id.localeCompare(right.id));
  return expectedIds.every((person, index) => person.id === currentIds[index].id
    && person.displayName === currentIds[index].displayName);
}

function readRefs(
  intent: ReadIntent,
  people: PersonRef[],
  windows: LocalWindow[] | null,
  missing: string[],
  read: AdminRead,
  recapKey?: string,
): Extract<StoredReadRefs, { kind: "read" }> {
  const team = intent.target.kind === "team";
  const snapshot = readSnapshot(read);
  if (!snapshot) throw new Error("A readable admin result must have a snapshot");
  return {
    v: 1,
    kind: "read",
    intent,
    personIds: team ? [] : people.map((person) => person.id),
    people: team ? [] : personSnapshots(people),
    rosterIds: team ? people.map((person) => person.id).sort() : [],
    windows,
    missing,
    snapshot,
    ...(recapKey ? { recapKey } : {}),
  };
}

function resolutionExecuted(intent: ReadIntent, state: PendingTargetState, override?: string): ExecutedRead {
  const card = resolutionCard(state);
  if (!card) {
    return {
      read: null,
      refs: { v: 1, kind: "unsupported" },
      reply: override ?? "No employee was resolved.",
      errorCode: "missing",
    };
  }
  return {
    read: { kind: "resolution", resolution: card },
    refs: { v: 1, kind: "resolution", intent, resolution: card, pending: state },
    reply: resolutionReply(state, override),
    errorCode: card.kind,
  };
}

function withMissingNote(executed: ExecutedRead, missing: string[]): ExecutedRead {
  if (!missing.length) return executed;
  return {
    ...executed,
    reply: `${executed.reply} Not included (no active employee found): ${missing.join(", ")}.`,
    refs: executed.refs.kind === "read" ? { ...executed.refs, missing } : executed.refs,
  };
}

async function executeRead(
  access: WorkOsAccess,
  intent: ReadIntent,
  people: PersonRef[],
  now: Date,
  fixedWindows: LocalWindow[] | null,
  missing: string[] = [],
): Promise<ExecutedRead> {
  if (intent.action === "unfinished") {
    const page = await listAdminOttoTasks(access, {
      personIds: intent.target.kind === "team" ? null : people.map((person) => person.id),
      overdueOnly: intent.overdueOnly,
      now,
    });
    const read: AdminRead = { kind: "tasks", page, people };
    const reply = replyFor(read, intent, people);
    return {
      read,
      refs: readRefs(intent, people, null, missing, read),
      ...reply,
    };
  }
  if (intent.action === "read_recap") {
    if (people.length !== 1) {
      throw new WorkOsValidationError("Name one employee to read a reviewed recap.");
    }
    const windows = fixedWindows ?? computeWindows(intent, people, now);
    const page = await listAdminOttoRecaps(access, { windows, latest: true });
    const recap = page.items[0];
    const read: AdminRead = recap
      ? { kind: "recap", recap }
      : { kind: "recaps", page: emptyRecaps("No reviewed recap was found.", now) };
    const reply = replyFor(read, intent, people);
    return {
      read,
      refs: readRefs(intent, people, windows, missing, read, recap?.reviewKey),
      ...reply,
    };
  }
  const windows = fixedWindows ?? computeWindows(intent, people, now);
  if (intent.action === "recaps") {
    const page = await listAdminOttoRecaps(access, { windows, latest: intent.latest });
    const read: AdminRead = { kind: "recaps", page };
    const reply = replyFor(read, intent, people);
    return {
      read,
      refs: readRefs(intent, people, windows, missing, read),
      ...reply,
    };
  }
  const page = await listAdminOttoRecords(access, {
    windows,
    ...(intent.action === "workday" ? { sources: ["workday" as const] } : {}),
  });
  const read: AdminRead = { kind: "records", page, windows };
  const reply = replyFor(read, intent, people);
  return {
    read,
    refs: readRefs(intent, people, windows, missing, read),
    ...reply,
  };
}

function identityReply(
  person: PersonRef,
  page: Page<WorkRecord>,
  windows: LocalWindow[],
  turnNumber: number,
): string {
  const name = person.displayName.replace(/\s+/g, " ").trim();
  const scope = windowSummary(windows);
  if (!page.total) {
    return turnNumber % 2 === 0
      ? `${name} is active in your organization, and I found no records in ${scope}. A missing record does not mean no work was done.`
      : `${name} is an active employee. No recent records were found in ${scope}; that does not mean no work was done.`;
  }
  const shown = page.items.length < page.total ? ` Showing ${page.items.length} of ${page.total}.` : "";
  return turnNumber % 2 === 0
    ? `${name} is active in your organization. I found ${plural(page.total, "record")} in ${scope}.${shown}`
    : `${name} is an active employee. Recent records: ${plural(page.total, "record")} in ${scope}.${shown}`;
}

/** Identity questions are a read of the authorized directory plus the existing
 * recent-records read. Ambiguous and missing names reuse the normal resolution
 * card and choice flow; nothing is guessed and no id is written into the reply. */
async function executeIdentityQuestion(
  access: WorkOsAccess,
  name: string,
  now: Date,
  turnNumber: number,
): Promise<ExecutedRead> {
  const baseIntent: ReadIntent = {
    action: "records",
    target: { kind: "names", names: [name] },
    date: null,
    from: null,
    through: null,
    relativeDay: null,
    overdueOnly: false,
    latest: false,
  };
  const resolution = await resolveAdminOttoPeople(access, baseIntent.target);
  if (resolution.kind === "resolved" && resolution.people.length === 1) {
    const person = resolution.people[0];
    const intent: ReadIntent = { ...baseIntent, target: { kind: "ids", ids: [person.id] } };
    const windows = adminRecordWindows([person], {}, now);
    const executed = await executeRead(access, intent, [person], now, windows, []);
    if (executed.read?.kind === "records") {
      return { ...executed, reply: identityReply(person, executed.read.page, windows, turnNumber) };
    }
    return executed;
  }
  const state: PendingTargetState = resolution.kind === "ambiguous"
    ? {
        v: 1,
        intent: baseIntent,
        resolved: [],
        ambiguous: [{ name: resolution.name, choices: resolution.choices }],
        missing: [],
      }
    : {
        v: 1,
        intent: baseIntent,
        resolved: [],
        ambiguous: [],
        missing: [resolution.kind === "missing" ? resolution.name : name],
      };
  return resolutionExecuted(baseIntent, state);
}

function normalizePersonSnapshots(value: unknown): Array<{ id: string; displayName: string }> | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_PEOPLE) return null;
  const people: Array<{ id: string; displayName: string }> = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !UUID.test(row.id)) return null;
    const displayName = typeof row.displayName === "string"
      ? row.displayName.replace(/\s+/g, " ").trim()
      : "";
    if (!displayName) return null;
    people.push({ id: row.id.toLowerCase(), displayName });
  }
  return people;
}

function normalizeUuidList(value: unknown, max: number): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !UUID.test(entry)) return null;
    const id = entry.toLowerCase();
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

function normalizeMissingNames(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_PEOPLE) return null;
  const names: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) return null;
    names.push(entry.replace(/\s+/g, " ").trim().slice(0, 120));
  }
  return names;
}

function normalizeSnapshot(value: unknown): ResultSnapshot | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.total !== "number" || !Number.isSafeInteger(row.total) || row.total < 0) return null;
  if (!Array.isArray(row.ids) || row.ids.length > 500) return null;
  const ids: string[] = [];
  for (const id of row.ids) {
    if (typeof id !== "string" || !id) return null;
    ids.push(id);
  }
  if (row.reviewKey !== undefined && (typeof row.reviewKey !== "string" || !row.reviewKey)) return null;
  return {
    total: row.total,
    ids,
    ...(typeof row.reviewKey === "string" ? { reviewKey: row.reviewKey } : {}),
  };
}

function refsValue(value: unknown): StoredReadRefs | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.v !== 1) return null;
  if (row.kind === "unsupported") return { v: 1, kind: "unsupported" };
  if (row.kind === "message") return readAdminOttoMessageRef(row);
  let intent: ReadIntent;
  try {
    intent = requireAdminOttoIntent(row.intent);
  } catch {
    return null;
  }
  if (row.kind === "resolution") {
    const resolution = resolutionValue(row.resolution);
    if (!resolution) return null;
    const pending = row.pending === null || row.pending === undefined ? null : pendingTargetState(row.pending);
    if (row.pending !== null && row.pending !== undefined && !pending) return null;
    return { v: 1, kind: "resolution", intent, resolution, pending };
  }
  if (row.kind !== "read") return null;
  const personIds = normalizeUuidList(row.personIds, MAX_PEOPLE);
  const people = normalizePersonSnapshots(row.people);
  const rosterIds = normalizeUuidList(row.rosterIds, 500);
  const missing = normalizeMissingNames(row.missing);
  const snapshot = normalizeSnapshot(row.snapshot);
  if (!personIds || !people || !rosterIds || !missing || snapshot === null) return null;
  if (row.windows !== null && row.windows !== undefined) {
    const windows = normalizeStoredWindows(row.windows);
    if (!windows) return null;
    return {
      v: 1, kind: "read", intent, personIds, people, rosterIds, windows, missing,
      ...(snapshot ? { snapshot } : {}),
      ...(typeof row.recapKey === "string" && row.recapKey ? { recapKey: row.recapKey } : {}),
    };
  }
  return {
    v: 1, kind: "read", intent, personIds, people, rosterIds, windows: null, missing,
    ...(snapshot ? { snapshot } : {}),
    ...(typeof row.recapKey === "string" && row.recapKey ? { recapKey: row.recapKey } : {}),
  };
}

function normalizeStoredWindows(value: unknown): LocalWindow[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WINDOWS) return null;
  const windows: LocalWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    if (typeof row.personId !== "string" || !UUID.test(row.personId)) return null;
    if (typeof row.timezone !== "string" || !row.timezone) return null;
    if (typeof row.from !== "string" || !STRICT_DATE.test(row.from)) return null;
    if (typeof row.through !== "string" || !STRICT_DATE.test(row.through)) return null;
    windows.push({
      personId: row.personId.toLowerCase(),
      timezone: row.timezone,
      from: row.from,
      through: row.through,
    });
  }
  return windows;
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function staleExecuted(refs: StoredReadRefs): ExecutedRead {
  return { read: null, refs, reply: "", stale: true };
}

async function validateResolutionRefs(access: WorkOsAccess, refs: Extract<StoredReadRefs, { kind: "resolution" }>): Promise<Exclude<Resolution, { kind: "resolved" }> | null> {
  if (refs.pending) {
    for (const person of refs.pending.resolved) {
      const current = await resolveAdminOttoPeople(access, { kind: "ids", ids: [person.id] });
      if (current.kind !== "resolved" || current.people[0]?.displayName !== person.displayName) return null;
    }
    for (const group of refs.pending.ambiguous) {
      const current = await resolveAdminOttoPeople(access, { kind: "names", names: [group.name] });
      if (current.kind !== "ambiguous" || !sameChoiceSet(group.choices, current.choices)) return null;
    }
    for (const name of refs.pending.missing) {
      const current = await resolveAdminOttoPeople(access, { kind: "names", names: [name] });
      if (current.kind !== "missing") return null;
    }
  }
  if (refs.resolution.kind === "ambiguous") {
    const current = await resolveAdminOttoPeople(access, { kind: "names", names: [refs.resolution.name] });
    if (current.kind !== "ambiguous" || !sameChoiceSet(refs.resolution.choices, current.choices)) return null;
    return current;
  }
  if (refs.resolution.kind !== "missing") return null;
  const current = await resolveAdminOttoPeople(access, { kind: "names", names: [refs.resolution.name] });
  if (current.kind !== "missing") return null;
  return current;
}

async function validateReadRefs(access: WorkOsAccess, refs: Extract<StoredReadRefs, { kind: "read" }>): Promise<{ people: PersonRef[]; windows: LocalWindow[] | null } | null> {
  // Every pre-fix read ref lacked a safe result snapshot. Never turn one into
  // a current card that can contradict the stored reply.
  if (refs.snapshot === undefined) return null;
  const intent = refs.intent;
  let people: PersonRef[];
  if (intent.target.kind === "team") {
    const current = await resolveAdminOttoPeople(access, { kind: "team" });
    if (current.kind !== "resolved") return null;
    const currentIds = current.people.map((person) => person.id);
    if (refs.rosterIds.length && !sameStringSet(refs.rosterIds, currentIds)) return null;
    people = current.people;
  } else {
    const ids = refs.personIds.length ? refs.personIds : (intent.target.kind === "ids" ? intent.target.ids : []);
    if (ids.length) {
      const current = await resolveAdminOttoPeople(access, { kind: "ids", ids });
      if (current.kind !== "resolved") return null;
      people = current.people;
    } else {
      const current = await resolveAdminOttoPeople(access, intent.target);
      if (current.kind !== "resolved") return null;
      people = current.people;
    }
    if (!samePersonSnapshots(refs.people, people)) return null;
  }
  for (const name of refs.missing) {
    const current = await resolveAdminOttoPeople(access, { kind: "names", names: [name] });
    if (current.kind !== "missing") return null;
  }
  return { people, windows: refs.windows };
}

async function executeStoredRead(access: WorkOsAccess, refs: StoredReadRefs, now: Date): Promise<ExecutedRead> {
  if (refs.kind === "unsupported") {
    return { read: null, refs, reply: UNSUPPORTED_REPLY, errorCode: "unsupported" };
  }
  // A conversational turn persists only its own bounded, server-owned text.
  // There is no read to re-run and no error code: rehydration and replay return
  // the same natural reply instead of the unsupported fallback.
  if (refs.kind === "message") {
    return { read: null, refs, reply: refs.text };
  }
  if (refs.kind === "resolution") {
    const current = await validateResolutionRefs(access, refs);
    if (!current) return staleExecuted(refs);
    return { read: { kind: "resolution", resolution: current }, refs, reply: "" };
  }
  const validated = await validateReadRefs(access, refs);
  if (!validated) return staleExecuted(refs);
  const executed = await executeRead(access, refs.intent, validated.people, now, validated.windows, refs.missing);
  if (!executed.read || !snapshotMatches(refs.snapshot, executed.read)) return staleExecuted(refs);
  if (refs.recapKey) {
    const currentKey = executed.read.kind === "recap"
      ? executed.read.recap.reviewKey
      : executed.read.kind === "recaps" && executed.read.page.total === 0
        ? undefined
        : null;
    if (currentKey !== refs.recapKey) return staleExecuted(refs);
  }
  return { ...executed, refs };
}

function continuationKey(): Buffer {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to sign admin Otto continuations");
  return createHash("sha256")
    .update("work-os-admin-otto-continuation:v1\0")
    .update(databaseUrl)
    .digest();
}

function encodeContinuation(payload: ContinuationPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", continuationKey()).update(body).digest("base64url");
  const token = `${body}.${signature}`;
  if (token.length > MAX_CONTINUATION) {
    throw new WorkOsValidationError("continuation exceeds the supported size; narrow the query");
  }
  return token;
}

function decodeContinuation(token: string): ContinuationPayload {
  if (!token || token.length > MAX_CONTINUATION) throw new WorkOsValidationError("continuation is invalid");
  const [body, signature, extra] = token.split(".");
  if (extra || !body || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    throw new WorkOsValidationError("continuation is invalid");
  }
  const expected = createHmac("sha256", continuationKey()).update(body).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new WorkOsValidationError("continuation is invalid");
  }
  let parsed: Partial<ContinuationPayload>;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ContinuationPayload>;
  } catch {
    throw new WorkOsValidationError("continuation is invalid");
  }
  if (parsed.v !== 1 || (parsed.k !== "tasks" && parsed.k !== "records" && parsed.k !== "recaps")) {
    throw new WorkOsValidationError("continuation is invalid");
  }
  if (typeof parsed.t !== "string" || !UUID.test(parsed.t)
    || typeof parsed.o !== "string" || !UUID.test(parsed.o)
    || typeof parsed.m !== "string" || !UUID.test(parsed.m)
    || typeof parsed.u !== "string" || !UUID.test(parsed.u)
    || typeof parsed.ti !== "string" || !UUID.test(parsed.ti)) {
    throw new WorkOsValidationError("continuation is invalid");
  }
  const contextVersion = parsed.cv;
  if (typeof contextVersion !== "number" || !Number.isSafeInteger(contextVersion) || contextVersion < 1) {
    throw new WorkOsValidationError("continuation is invalid");
  }
  let intent: ReadIntent;
  try {
    intent = requireAdminOttoIntent(parsed.it);
  } catch {
    throw new WorkOsValidationError("continuation is invalid");
  }
  if (!Array.isArray(parsed.p) || parsed.p.length > MAX_PEOPLE) throw new WorkOsValidationError("continuation is invalid");
  const personIds: string[] = [];
  for (const value of parsed.p) {
    if (typeof value !== "string" || !UUID.test(value)) throw new WorkOsValidationError("continuation is invalid");
    personIds.push(value.toLowerCase());
  }
  const rosterIds = normalizeUuidList(parsed.r, 500);
  if (!rosterIds) throw new WorkOsValidationError("continuation is invalid");
  const windows = normalizeStoredWindows(parsed.w);
  if (parsed.w !== null && windows === null) throw new WorkOsValidationError("continuation is invalid");
  if (typeof parsed.c !== "string" || !parsed.c || parsed.c.length > 4096) {
    throw new WorkOsValidationError("continuation is invalid");
  }
  return {
    v: 1,
    k: parsed.k,
    t: parsed.t,
    o: parsed.o,
    m: parsed.m,
    u: parsed.u,
    cv: contextVersion,
    ti: parsed.ti,
    it: intent,
    p: personIds,
    r: rosterIds,
    w: windows,
    c: parsed.c,
  };
}

function withContinuation(
  read: AdminRead,
  refs: StoredReadRefs,
  access: WorkOsAccess,
  threadId: string,
  contextVersion: number,
  turnId: string,
): AdminRead {
  if (refs.kind !== "read" || read.kind === "recap" || read.kind === "resolution") return read;
  const page = read.page;
  if (!page.nextCursor) return read;
  const token = encodeContinuation({
    v: 1,
    k: read.kind,
    t: threadId,
    o: access.organizationId,
    m: access.membershipId,
    u: access.ctx.user.id,
    cv: contextVersion,
    ti: turnId,
    it: refs.intent,
    p: refs.personIds,
    r: refs.rosterIds,
    w: refs.windows,
    c: page.nextCursor,
  });
  return { ...read, page: { ...page, nextCursor: token } } as AdminRead;
}

function replyForContinuation(read: AdminRead, intent: ReadIntent | null): string {
  if (read.kind === "tasks") {
    const kind = intent?.overdueOnly ? "overdue task" : "open task";
    return `Loaded the next ${plural(read.page.items.length, kind)}.`;
  }
  if (read.kind === "records") {
    const kind = intent?.action === "workday" ? "workday row" : "record";
    return `Loaded the next ${plural(read.page.items.length, kind)}.`;
  }
  if (read.kind === "recaps") return `Loaded the next ${plural(read.page.items.length, "reviewed recap")}.`;
  return "Loaded the next result.";
}

type PreparedWrite = {
  threadId: string;
  version: number;
  turnId: string;
  requestId: string;
  text: string;
  assistantText: string;
  refs: StoredReadRefs;
  intent: ReadIntent | null;
  personIds: string[];
  pending: unknown;
};

async function pruneExpiredTurns(client: PoolClient, access: WorkOsAccess, threadId: string) {
  await client.query(`delete from work_admin_otto_turns
    where organization_id = $1 and thread_id = $2 and membership_id = $3
      and created_at < clock_timestamp() - interval '${RETENTION_DAYS} days'`,
  [access.organizationId, threadId, access.membershipId]);
}

async function writeNewThread(client: PoolClient, access: WorkOsAccess, write: PreparedWrite) {
  await client.query(`insert into work_admin_otto_threads
      (id, organization_id, membership_id, context_version, last_intent, resolved_person_ids, pending_resolution)
      values ($1,$2,$3,$4,$5::jsonb,$6::uuid[],$7::jsonb)`,
  [write.threadId, access.organizationId, access.membershipId, write.version,
    write.intent ? JSON.stringify(write.intent) : null, write.personIds, write.pending ? JSON.stringify(write.pending) : null]);
  await client.query(`insert into work_admin_otto_turns
      (id, thread_id, organization_id, membership_id, request_id, role, text, source_refs, created_at)
      values ($1,$2,$3,$4,$5,'user',$6,'{}'::jsonb,clock_timestamp())`,
  [randomUUID(), write.threadId, access.organizationId, access.membershipId, write.requestId, write.text]);
  await client.query(`insert into work_admin_otto_turns
      (id, thread_id, organization_id, membership_id, request_id, role, text, source_refs, created_at)
      values ($1,$2,$3,$4,$5,'assistant',$6,$7::jsonb,clock_timestamp())`,
  [write.turnId, write.threadId, access.organizationId, access.membershipId, write.requestId, write.assistantText, JSON.stringify(write.refs)]);
}

async function appendThreadTurn(client: PoolClient, access: WorkOsAccess, thread: ThreadRow, write: PreparedWrite) {
  const { rows } = await client.query<{ context_version: number | string }>(`update work_admin_otto_threads
      set context_version = context_version + 1,
          last_intent = coalesce($4::jsonb, last_intent),
          resolved_person_ids = $5::uuid[],
          pending_resolution = $6::jsonb,
          updated_at = clock_timestamp()
      where organization_id = $1 and id = $2 and membership_id = $3 and context_version = $7
      returning context_version`,
  [access.organizationId, thread.id, access.membershipId,
    write.intent ? JSON.stringify(write.intent) : null, write.personIds,
    write.pending ? JSON.stringify(write.pending) : null, Number(thread.context_version)]);
  if (!rows[0]) {
    throw new WorkOsConflictError("This conversation changed on another window. Refresh before replying.", "stale_context");
  }
  write.version = Number(rows[0].context_version);
  await pruneExpiredTurns(client, access, thread.id);
  await client.query(`insert into work_admin_otto_turns
      (id, thread_id, organization_id, membership_id, request_id, role, text, source_refs, created_at)
      values ($1,$2,$3,$4,$5,'user',$6,'{}'::jsonb,clock_timestamp())`,
  [randomUUID(), thread.id, access.organizationId, access.membershipId, write.requestId, write.text]);
  await client.query(`insert into work_admin_otto_turns
      (id, thread_id, organization_id, membership_id, request_id, role, text, source_refs, created_at)
      values ($1,$2,$3,$4,$5,'assistant',$6,$7::jsonb,clock_timestamp())`,
  [write.turnId, thread.id, access.organizationId, access.membershipId, write.requestId, write.assistantText, JSON.stringify(write.refs)]);
}

async function replay(
  access: WorkOsAccess,
  thread: ThreadRow,
  turn: TurnRow,
  deps: AdminOttoChatDeps,
  now: Date,
): Promise<ChatResult> {
  const refs = refsValue(turn.source_refs);
  if (!refs) throw new WorkOsConflictError("This conversation's saved result is no longer available.", "conversation_unavailable");
  const executed = await executeStoredRead(access, refs, now);
  if (executed.stale) {
    throw new WorkOsConflictError("This saved result changed. Ask again to get a current answer.", "stale_context");
  }
  await recheckAfterRead(access, deps);
  const result = executed.read ? withContinuation(executed.read, refs, access, thread.id, Number(thread.context_version), turn.id) : null;
  return {
    conversationId: thread.id,
    turnId: turn.id,
    reply: turn.text,
    result,
    contextVersion: Number(thread.context_version),
    ...(executed.errorCode ? { errorCode: executed.errorCode } : {}),
  };
}

async function continueRead(
  access: WorkOsAccess,
  token: string,
  deps: AdminOttoChatDeps,
  now: Date,
): Promise<{ read: AdminRead; threadId: string; turnId: string; contextVersion: number; refs: StoredReadRefs }> {
  const payload = decodeContinuation(token);
  if (payload.o !== access.organizationId || payload.m !== access.membershipId || payload.u !== access.ctx.user.id) {
    throw new WorkOsConflictError("This continuation belongs to another conversation.", "conversation_unavailable");
  }
  const thread = await loadThread(access, payload.t);
  if (!thread) throw new WorkOsConflictError("This conversation is no longer available.", "conversation_unavailable");
  if (Number(thread.context_version) !== payload.cv) {
    throw new WorkOsConflictError("This conversation moved on. Refresh the result before loading more.", "stale_context");
  }
  const stored = threadIntent(thread.last_intent);
  if (!stored || JSON.stringify(stored) !== JSON.stringify(payload.it)) {
    throw new WorkOsConflictError("This conversation moved on. Refresh the result before loading more.", "stale_context");
  }
  const turn = await findDuplicateTurnById(access, payload.t, payload.ti);
  if (!turn) throw new WorkOsConflictError("This conversation's saved result is no longer available.", "conversation_unavailable");

  const intent = payload.it;
  let people: PersonRef[];
  if (intent.target.kind === "team") {
    const resolution = await resolveAdminOttoPeople(access, { kind: "team" });
    if (resolution.kind !== "resolved") throw new WorkOsConflictError("The conversation target changed.", "conversation_unavailable");
    people = resolution.people;
    if (payload.r.length && !sameStringSet(payload.r, people.map((person) => person.id))) {
      throw new WorkOsConflictError("The team changed. Refresh the result before loading more.", "stale_context");
    }
  } else {
    const resolution = await resolveAdminOttoPeople(access, { kind: "ids", ids: payload.p });
    if (resolution.kind !== "resolved") throw new WorkOsConflictError("The conversation target is no longer active.", "conversation_unavailable");
    people = resolution.people;
  }
  const refs: Extract<StoredReadRefs, { kind: "read" }> = {
    v: 1,
    kind: "read",
    intent: resolvedTarget(intent, people),
    personIds: intent.target.kind === "team" ? [] : people.map((person) => person.id),
    people: intent.target.kind === "team" ? [] : personSnapshots(people),
    rosterIds: intent.target.kind === "team" ? people.map((person) => person.id).sort() : [],
    windows: payload.w,
    missing: [],
  };
  if (payload.k === "tasks") {
    const page = await listAdminOttoTasks(access, {
      personIds: intent.target.kind === "team" ? null : people.map((person) => person.id),
      overdueOnly: intent.overdueOnly,
      cursor: payload.c,
      now,
    });
    const read: AdminRead = { kind: "tasks", page, people };
    return { read: withContinuation(read, refs, access, thread.id, payload.cv, payload.ti), threadId: thread.id, turnId: payload.ti, contextVersion: payload.cv, refs };
  }
  if (!payload.w) throw new WorkOsValidationError("continuation is invalid");
  if (payload.k === "records") {
    const page = await listAdminOttoRecords(access, {
      windows: payload.w,
      cursor: payload.c,
      ...(intent.action === "workday" ? { sources: ["workday" as const] } : {}),
    });
    const read: AdminRead = { kind: "records", page, windows: payload.w };
    return { read: withContinuation(read, refs, access, thread.id, payload.cv, payload.ti), threadId: thread.id, turnId: payload.ti, contextVersion: payload.cv, refs };
  }
  const page = await listAdminOttoRecaps(access, {
    windows: payload.w,
    latest: intent.latest,
    cursor: payload.c,
  });
  const read: AdminRead = { kind: "recaps", page };
  return { read: withContinuation(read, refs, access, thread.id, payload.cv, payload.ti), threadId: thread.id, turnId: payload.ti, contextVersion: payload.cv, refs };
}

async function findDuplicateTurnById(access: WorkOsAccess, threadId: string, turnId: string): Promise<TurnRow | undefined> {
  const { rows } = await getPool().query<TurnRow>(`select id, role, text, source_refs, created_at
    from work_admin_otto_turns
    where organization_id = $1 and thread_id = $2 and membership_id = $3 and id = $4
      and created_at >= clock_timestamp() - interval '${RETENTION_DAYS} days'`,
  [access.organizationId, threadId, access.membershipId, turnId]);
  return rows[0];
}

function stateFromResolution(intent: ReadIntent, resolution: TargetResolution): PendingTargetState | null {
  if (!resolution.ambiguous.length && !resolution.missing.length) return null;
  return {
    v: 1,
    intent,
    resolved: dedupePeople(resolution.people),
    ambiguous: resolution.ambiguous,
    missing: resolution.missing,
  };
}

async function executeTargetResolution(
  access: WorkOsAccess,
  intent: ReadIntent,
  resolution: TargetResolution,
  now: Date,
): Promise<ExecutedRead> {
  const state = stateFromResolution(intent, resolution);
  if (state?.ambiguous.length) return resolutionExecuted(intent, state, resolution.replyOverride);
  if (resolution.people.length) {
    const finalIntent: ReadIntent = intent.target.kind === "team"
      ? intent
      : { ...intent, target: { kind: "ids", ids: resolution.people.map((person) => person.id) } };
    const executed = await executeRead(access, finalIntent, resolution.people, now, null, resolution.missing);
    return withMissingNote(executed, resolution.missing);
  }
  if (state) return resolutionExecuted(intent, state, resolution.replyOverride);
  return resolutionExecuted(intent, {
    v: 1, intent, resolved: [], ambiguous: [], missing: ["the requested employees"],
  }, resolution.replyOverride);
}

function prepareWrite(
  thread: ThreadRow | undefined,
  executed: ExecutedRead,
  request: { requestId: string; text: string },
  newId: () => string,
): PreparedWrite {
  let intent: ReadIntent | null = null;
  let personIds: string[] = [];
  let pending: PendingTargetState | null = null;
  if (executed.refs.kind === "read") {
    intent = executed.refs.intent;
    personIds = executed.refs.personIds;
  } else if (executed.refs.kind === "resolution") {
    pending = executed.refs.pending;
    intent = pending?.intent ?? null;
    personIds = pending?.resolved.map((person) => person.id) ?? [];
  } else {
    intent = thread ? threadIntent(thread.last_intent) : null;
    personIds = thread?.resolved_person_ids ?? [];
    pending = thread ? pendingTargetState(thread.pending_resolution) : null;
  }
  return {
    threadId: thread?.id ?? newId(),
    version: thread ? Number(thread.context_version) + 1 : 1,
    turnId: newId(),
    requestId: request.requestId,
    text: request.text,
    assistantText: executed.reply,
    refs: executed.refs,
    intent,
    personIds,
    pending,
  };
}

async function commitOrReplay(
  access: WorkOsAccess,
  thread: ThreadRow | undefined,
  request: NormalizedRequest,
  write: PreparedWrite,
  deps: AdminOttoChatDeps,
  now: Date,
): Promise<ChatResult | null> {
  const duplicate = await transaction(async (client) => {
    await assertCurrentAccess(client, access);
    const { rows } = await client.query(`insert into work_admin_otto_chat_requests
      (organization_id,membership_id,user_id,request_id,request_hash,requested_conversation_id,thread_id,turn_id)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (organization_id,membership_id,user_id,request_id) do nothing
      returning request_id`,
    [access.organizationId, access.membershipId, access.ctx.user.id, request.requestId,
      requestHash(request), request.conversationId, write.threadId, write.turnId]);
    if (!rows.length) {
      // PostgreSQL's unique check waits for the competing transaction. This
      // subsequent READ COMMITTED statement sees only its committed result;
      // a rollback instead lets our INSERT win. Never catch/ignore a raw 23505.
      const existing = await loadCommittedRequest(access, request, client);
      if (!existing) throw new WorkOsConflictError("This request changed. Retry it.", "stale_context");
      return existing;
    }
    if (thread) await appendThreadTurn(client, access, thread, write);
    else await writeNewThread(client, access, write);
    return null;
  });
  return duplicate ? replayCommittedRequest(access, duplicate, deps, now) : null;
}

async function persistExecution(
  access: WorkOsAccess,
  thread: ThreadRow | undefined,
  request: NormalizedRequest,
  executed: ExecutedRead,
  deps: AdminOttoChatDeps,
  now: Date,
  newId: () => string,
): Promise<ChatResult> {
  const write = prepareWrite(thread, executed, request, newId);
  const replayed = await commitOrReplay(access, thread, request, write, deps, now);
  if (replayed) return replayed;
  const read = executed.read
    ? withContinuation(executed.read, executed.refs, access, write.threadId, write.version, write.turnId)
    : null;
  return {
    conversationId: write.threadId,
    turnId: write.turnId,
    reply: executed.reply,
    result: read,
    contextVersion: write.version,
    ...(executed.errorCode ? { errorCode: executed.errorCode } : {}),
  };
}

/**
 * Execute one bounded admin chat turn or a server-issued continuation.
 *
 * The service re-reads the thread and uses `context_version` as a compare-and-
 * set fence. Reads run before the write; the route supplies `revalidateAccess`
 * so a long model/read interval is followed by a fresh read authorization.
 */
export async function executeAdminOttoChat(
  access: WorkOsAccess,
  input: ChatRequest,
  deps: AdminOttoChatDeps = {},
): Promise<ChatResult> {
  requireAdmin(access);
  const request = normalizeRequest(input);
  const now = deps.now?.() ?? new Date();
  const newId = deps.newId ?? randomUUID;

  // Explicit conversation authorization precedes replay lookup, even when a
  // caller knows one of their own valid request ids but supplies a foreign id.
  const thread = request.conversationId ? await loadThread(access, request.conversationId) : undefined;
  if (request.conversationId && !thread) {
    throw new WorkOsConflictError("This conversation is no longer available.", "conversation_unavailable");
  }
  const committed = await loadCommittedRequest(access, request);
  if (committed) return replayCommittedRequest(access, committed, deps, now);

  if (request.continuation) {
    const continued = await continueRead(access, request.continuation, deps, now);
    await recheckAfterRead(access, deps);
    return {
      conversationId: continued.threadId,
      turnId: continued.turnId,
      reply: replyForContinuation(continued.read, continued.refs.kind === "read" ? continued.refs.intent : null),
      result: continued.read,
      contextVersion: continued.contextVersion,
    };
  }

  if (thread) {
    const duplicate = await findDuplicateTurn(access, thread.id, request.requestId);
    // Legacy turns have no immutable payload binding. Fail closed rather than
    // returning a different intent under an unverified reused request id.
    if (duplicate) throw new WorkOsConflictError("This request id has no replay identity. Start a new request.", "request_id_reused");
  }
  const pending = thread ? pendingTargetState(thread.pending_resolution) : null;

  if (request.choicePersonId) {
    if (!thread) throw new WorkOsValidationError("A conversation is required to choose an employee.");
    if (!pending?.ambiguous.length) throw new WorkOsValidationError("There is no pending employee choice.");
    const group = pending.ambiguous[0];
    const choice = group.choices.find((person) => person.id === request.choicePersonId);
    if (!choice) throw new WorkOsValidationError("That employee is not one of the pending choices.");
    const chosen = await resolveAdminOttoPeople(access, { kind: "ids", ids: [choice.id] });
    if (chosen.kind !== "resolved") throw new WorkOsValidationError("That employee is no longer active in this organization.");

    const resolved: PersonRef[] = [];
    const unavailable = [...pending.missing];
    for (const person of pending.resolved) {
      const current = await resolveAdminOttoPeople(access, { kind: "ids", ids: [person.id] });
      if (current.kind === "resolved") resolved.push(current.people[0]);
      else unavailable.push(person.displayName);
    }
    resolved.push(chosen.people[0]);
    const remaining: AmbiguousGroup[] = [];
    for (const group of pending.ambiguous.slice(1)) {
      const current = await resolveAdminOttoPeople(access, { kind: "names", names: [group.name] });
      if (current.kind === "ambiguous") remaining.push({ name: current.name, choices: current.choices });
      else if (current.kind === "resolved") resolved.push(...current.people);
      else unavailable.push(current.name);
    }
    for (const name of pending.missing) {
      const current = await resolveAdminOttoPeople(access, { kind: "names", names: [name] });
      if (current.kind === "ambiguous") remaining.push({ name: current.name, choices: current.choices });
      else if (current.kind === "resolved") resolved.push(...current.people);
      else unavailable.push(current.name);
    }
    const state: PendingTargetState = {
      v: 1,
      intent: pending.intent,
      resolved: dedupePeople(resolved),
      ambiguous: remaining,
      missing: [...new Set(unavailable)],
    };
    let executed: ExecutedRead;
    if (state.ambiguous.length) {
      executed = resolutionExecuted(pending.intent, state);
    } else if (state.resolved.length) {
      executed = withMissingNote(await executeRead(access, {
        ...pending.intent,
        target: { kind: "ids", ids: state.resolved.map((person) => person.id) },
      }, state.resolved, now, null, state.missing), state.missing);
    } else {
      executed = resolutionExecuted(pending.intent, state);
    }
    await recheckAfterRead(access, deps);
    return persistExecution(access, thread, request, executed, deps, now, newId);
  }

  // Ordinary conversation is answered deterministically before any model call.
  // Identity questions read only the authorized directory and the existing
  // recent-records projection; greetings/thanks/capability questions persist a
  // bounded message ref with no result card and no error code.
  const conversation = matchAdminOttoConversation(request.text);
  if (conversation) {
    const turnNumber = thread ? Number(thread.context_version) : 0;
    let executed: ExecutedRead;
    if (conversation.kind === "identity") {
      executed = await executeIdentityQuestion(access, conversation.name, now, turnNumber);
      await recheckAfterRead(access, deps);
    } else {
      const reply = adminOttoConversationReply(conversation, turnNumber);
      executed = { read: null, refs: adminOttoMessageRef(reply), reply };
    }
    return persistExecution(access, thread, request, executed, deps, now, newId);
  }

  // A pending unresolved target stays unresolved on a pronoun follow-up. The
  // server never widens "their" to the roster while a choice is outstanding.
  if (thread && pending && pronounFollowUp(request.text) && !explicitTeam(request.text)) {
    const executed = resolutionExecuted(pending.intent, pending);
    return persistExecution(access, thread, request, executed, deps, now, newId);
  }

  const context = thread ? await parserContext(access, thread) : { people: [], lastIntent: null };
  const parsed = deps.parseIntent
    ? await deps.parseIntent(request.text, context)
    : await parseAdminOttoIntent(request.text, context);
  if (!parsed) {
    const executed: ExecutedRead = {
      read: null,
      refs: { v: 1, kind: "unsupported" },
      reply: UNSUPPORTED_REPLY,
      errorCode: "unsupported",
    };
    return persistExecution(access, thread, request, executed, deps, now, newId);
  }
  // Even an injected parser is held to the typed contract before any read.
  const parsedIntent = requireAdminOttoIntent(parsed);
  const teamExplicit = explicitTeam(request.text);
  const pronoun = pronounFollowUp(request.text);
  let intent = parsedIntent;
  let resolution: TargetResolution;

  if (teamExplicit) {
    intent = { ...parsedIntent, target: { kind: "team" } };
    resolution = await resolveTargetRequest(access, intent.target);
  } else if (pronoun) {
    let base: PersonRef[] = [];
    let baseTeam = false;
    const resolvedIds = (thread?.resolved_person_ids ?? []).filter((id) => UUID.test(id));
    if (resolvedIds.length) {
      const current = await resolveAdminOttoPeople(access, { kind: "ids", ids: resolvedIds });
      if (current.kind !== "resolved") {
        const executed = resolutionExecuted(parsedIntent, {
          v: 1, intent: parsedIntent, resolved: [], ambiguous: [], missing: ["a previously resolved employee"],
        }, "I can't reapply \"their\" because a previously resolved employee is no longer active. Name the employees again.");
        return persistExecution(access, thread, request, executed, deps, now, newId);
      }
      base = current.people;
    } else {
      const last = thread ? threadIntent(thread.last_intent) : null;
      if (last) {
        const lastResolution = await resolveTargetRequest(access, last.target);
        if (lastResolution.ambiguous.length || lastResolution.missing.length) {
          const state = stateFromResolution(last, lastResolution);
          if (state) {
            return persistExecution(access, thread, request,
              resolutionExecuted(last, state), deps, now, newId);
          }
        }
        base = lastResolution.people;
        baseTeam = last.target.kind === "team";
      }
    }
    if (!base.length && !baseTeam) {
      const executed = resolutionExecuted(parsedIntent, {
        v: 1, intent: parsedIntent, resolved: [], ambiguous: [], missing: ["the employees you are referring to"],
      }, "I don't have a previous employee set to apply \"their\" to. Name the employees.");
      return persistExecution(access, thread, request, executed, deps, now, newId);
    }
    const newNames = parsedIntent.target.kind === "names"
      ? parsedIntent.target.names.filter((name) => nameAuthorizedByText(name, request.text)
        && !base.some((person) => normalizeText(person.displayName) === normalizeText(name)))
      : [];
    if (newNames.length) {
      intent = { ...parsedIntent, target: { kind: "names", names: newNames } };
      resolution = await resolveTargetRequest(access, intent.target, base);
    } else {
      intent = baseTeam
        ? { ...parsedIntent, target: { kind: "team" } }
        : { ...parsedIntent, target: { kind: "ids", ids: base.map((person) => person.id) } };
      resolution = { people: base, ambiguous: [], missing: [] };
    }
  } else if (parsedIntent.target.kind === "ids") {
    const allowed = allowedModelIds(context, thread, pending);
    const explicitIds = new Set((request.text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [])
      .map((id) => id.toLowerCase()));
    if (parsedIntent.target.ids.some((id) => !allowed.has(id) || !explicitIds.has(id))) {
      const executed = resolutionExecuted(parsedIntent, {
        v: 1, intent: parsedIntent, resolved: [], ambiguous: [], missing: ["a requested employee id"],
      }, "That employee id is not part of the resolved directory for this conversation. Name the employee instead.");
      return persistExecution(access, thread, request, executed, deps, now, newId);
    }
    resolution = await resolveTargetRequest(access, parsedIntent.target);
  } else if (parsedIntent.target.kind === "names") {
    const unauthorized = parsedIntent.target.names.find((name) => !nameAuthorizedByText(name, request.text));
    if (unauthorized) {
      const executed = resolutionExecuted(parsedIntent, {
        v: 1, intent: parsedIntent, resolved: [], ambiguous: [], missing: [unauthorized],
      }, "I couldn't verify that employee name in your request. Name the employee exactly as you want them read.");
      return persistExecution(access, thread, request, executed, deps, now, newId);
    }
    resolution = await resolveTargetRequest(access, parsedIntent.target);
  } else {
    resolution = await resolveTargetRequest(access, parsedIntent.target);
  }

  const executed = await executeTargetResolution(access, intent, resolution, now);
  await recheckAfterRead(access, deps);
  return persistExecution(access, thread, request, executed, deps, now, newId);
}

/** Internal typed continuation read. The route exposes it through the POST
 * `continuation` field; it never adds a conversation turn. */
export async function continueAdminOttoRead(
  access: WorkOsAccess,
  token: string,
  deps: AdminOttoChatDeps = {},
): Promise<AdminRead> {
  requireAdmin(access);
  const now = deps.now?.() ?? new Date();
  const read = (await continueRead(access, token, deps, now)).read;
  await recheckAfterRead(access, deps);
  return read;
}

/** Rehydrate the bounded last-24-turn window and re-run the typed read from the
 * stored source references. Complete team results are never persisted. */
export async function loadAdminOttoThread(
  access: WorkOsAccess,
  conversationId: string,
  deps: AdminOttoChatDeps = {},
): Promise<AdminOttoThreadView> {
  requireAdmin(access);
  const id = uuid(conversationId, "conversationId");
  const thread = await loadThread(access, id);
  if (!thread) throw new WorkOsConflictError("This conversation is no longer available.", "conversation_unavailable");
  const rows = await loadTurns(access, id);
  const latestAssistant = [...rows].reverse().find((row) => row.role === "assistant");
  let result: AdminRead | null = null;
  let resultStatus: AdminOttoThreadView["resultStatus"] = "unavailable";
  if (latestAssistant) {
    const refs = refsValue(latestAssistant.source_refs);
    if (refs) {
      const executed = await executeStoredRead(access, refs, deps.now?.() ?? new Date());
      if (executed.stale) {
        resultStatus = "stale";
      } else {
        resultStatus = "ready";
        if (executed.read) {
          result = withContinuation(executed.read, refs, access, id, Number(thread.context_version), latestAssistant.id);
        }
      }
    }
  }
  await recheckAfterRead(access, deps);
  return {
    conversationId: id,
    contextVersion: Number(thread.context_version),
    turns: rows.map((row) => ({
      turnId: row.id,
      role: row.role,
      text: row.text,
      createdAt: safeIso(row.created_at),
    })),
    result,
    resultStatus,
  };
}

async function parserContext(access: WorkOsAccess, thread: ThreadRow): Promise<AdminOttoIntentContext> {
  const lastIntent = threadIntent(thread.last_intent);
  const ids = (thread.resolved_person_ids ?? []).filter((id) => UUID.test(id)).slice(0, MAX_PEOPLE);
  if (ids.length) {
    const resolution = await resolveAdminOttoPeople(access, { kind: "ids", ids });
    if (resolution.kind === "resolved") return { people: resolution.people.slice(0, MAX_PEOPLE), lastIntent };
  }
  const pending = pendingTargetState(thread.pending_resolution);
  if (pending) {
    const people = dedupePeople([
      ...pending.resolved,
      ...pending.ambiguous.flatMap((group) => group.choices),
    ]).slice(0, MAX_PEOPLE);
    return { people, lastIntent };
  }
  return { people: [], lastIntent };
}

function pronounFollowUp(text: string): boolean {
  return /\b(their|them|those|these|the same|both of them)\b/i.test(text);
}

function explicitTeam(text: string): boolean {
  return /\b(team|everyone|everybody|all employees|whole team|whole company|organization)\b/i.test(text);
}
