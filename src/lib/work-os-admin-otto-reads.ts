import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { loadReviewedRecap } from "@/lib/work-os-reviewed-recaps";
import {
  ADMIN_TASK_DEFAULT_LIMIT,
  ADMIN_TASK_MAX_LIMIT,
  addAdminTaskDays,
  adminTaskDates,
  adminTaskStatusRank,
} from "@/modules/work-os/admin-task-model";
import { localDateForTimezone } from "@/modules/work-os/companion";
import type {
  LocalWindow,
  Page,
  PersonRef,
  Resolution,
  ReviewedRecap,
  Target,
  TaskCard,
  WorkRecord,
} from "@/modules/work-os/admin-otto/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;
// A signed cursor carries the full keyset position (including a task title).
// 4,096 characters accommodates the bounded task title plus base64/HMAC
// overhead; it was widened from 256/512 for that reason. Encoding fails closed
// above this bound rather than truncating a key and losing records.
const MAX_CURSOR_LENGTH = 4096;
// Directory pages are capped at 100; one record/recap request can carry the
// same number of per-person local windows (widened from 50). A larger roster
// splits into multiple requests.
const MAX_WINDOWS = 100;
const MAX_TARGETS = 20;
const MAX_PEOPLE_IDS = 100;
const MAX_RECORD_SPAN_DAYS = 31;
const DEFAULT_RECORD_DAYS = 7;
const DEFAULT_PEOPLE_LIMIT = 50;
const DEFAULT_RECORD_LIMIT = 50;

const TASK_COVERAGE = [
  "Open, non-archived organization tasks only. Overdue uses the effective due date — the recorded due date, otherwise created + 1 day — against the stated day.",
];
const PEOPLE_COVERAGE = ["Active organization roster only."];
const PEOPLE_IDS_COVERAGE = [
  "Saved same-organization people by explicit id, including inactive choices; never a general inactive list or another organization.",
];
const RECORD_COVERAGE = [
  "Authored updates, submitted EOD reports, canonical task events, reviewed recaps, and workday snapshots only; no drafts, private chats, memory, or raw screenshots.",
];
const RECAP_COVERAGE = [
  "Reviewed recaps only. Explicit history is not limited to the 30-day arrival inbox; normal organization access still applies.",
];
const LATEST_RECAP_COVERAGE = [
  "The latest reviewed recap per employee across all retained reviewed history, not only the 30-day arrival inbox.",
];

function requireAdmin(access: WorkOsAccess) {
  if (access.role !== "admin" || access.featureFlags.employee_companion !== true) {
    throw new WorkOsConflictError("Admin Otto access is not active for this membership.", "otto_access_revoked");
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function dateOnlyValue(value: unknown): string {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value ?? "").slice(0, 10);
}

function calendarDate(value: unknown, field: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!STRICT_DATE.test(text)) throw new WorkOsValidationError(`${field} must be a calendar date`);
  const [year, month, day] = text.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw new WorkOsValidationError(`${field} must be a calendar date`);
  }
  return text;
}

function boundedLimit(value: number | undefined, fallback: number, max: number, field = "limit") {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new WorkOsValidationError(`${field} must be between 1 and ${max}`);
  }
  return value;
}

function explicitPeopleIds(values: unknown): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > MAX_PEOPLE_IDS) {
    throw new WorkOsValidationError(`ids must contain between 1 and ${MAX_PEOPLE_IDS} organization employee ids`);
  }
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !UUID.test(value)) {
      throw new WorkOsValidationError(`ids must contain between 1 and ${MAX_PEOPLE_IDS} organization employee ids`);
    }
    const id = value.toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function safeTimezone(value: unknown): string {
  const timezone = typeof value === "string" && value.trim() ? value.trim() : "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return "UTC";
  }
}

function validTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function scopeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

type CursorPayload = {
  v: 1;
  k: "tasks" | "people" | "records" | "recaps";
  s: string;
  [key: string]: unknown;
};

/** Pagination cursors are opaque, but they are still client-held state. The
 * release-download grant is the existing signed-token pattern, but it HMACs
 * with a provider credential (`WORK_OS_RELEASE_GITHUB_TOKEN`); making admin
 * reads depend on that configuration would be an unrelated provider
 * requirement. Derive a domain-separated signing key from the already-required
 * server database URL instead: no new secret/default key, no credential is
 * exposed, and rotating the database URL only invalidates in-flight cursors. */
function cursorSigningKey(): Buffer {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to sign admin Otto cursors");
  return createHash("sha256")
    .update("work-os-admin-otto-cursor:v1\0")
    .update(databaseUrl)
    .digest();
}

function encodeCursor(payload: CursorPayload): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", cursorSigningKey()).update(body).digest("base64url");
  const cursor = `${body}.${signature}`;
  if (cursor.length > MAX_CURSOR_LENGTH) {
    throw new WorkOsValidationError("cursor exceeds the supported size; narrow the query");
  }
  return cursor;
}

function decodeCursor(value: string | undefined, kind: CursorPayload["k"], scope: string): CursorPayload | null {
  if (value === undefined) return null;
  if (!value || value.length > MAX_CURSOR_LENGTH) throw new WorkOsValidationError("cursor is invalid");
  const [body, signature, extra] = value.split(".");
  if (extra || !body || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) {
    throw new WorkOsValidationError("cursor is invalid");
  }
  const expected = createHmac("sha256", cursorSigningKey()).update(body).digest();
  const received = Buffer.from(signature, "base64url");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    throw new WorkOsValidationError("cursor is invalid");
  }
  let parsed: Partial<CursorPayload>;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<CursorPayload>;
  } catch {
    throw new WorkOsValidationError("cursor is invalid");
  }
  if (parsed.v !== 1 || parsed.k !== kind || parsed.s !== scope) {
    throw new WorkOsValidationError("cursor does not match the current filters");
  }
  const validInstant = (candidate: unknown) => typeof candidate === "string" && Number.isFinite(Date.parse(candidate));
  if (kind === "tasks") {
    if (typeof parsed.c !== "string" || !STRICT_DATE.test(parsed.c)
      || typeof parsed.u !== "string" || !validInstant(parsed.u)
      || typeof parsed.d !== "string" || !STRICT_DATE.test(parsed.d)
      || typeof parsed.t !== "string"
      || typeof parsed.i !== "string" || !UUID.test(parsed.i)) {
      throw new WorkOsValidationError("cursor is invalid");
    }
  } else if (kind === "people") {
    if (typeof parsed.c !== "string" || typeof parsed.i !== "string" || !UUID.test(parsed.i)) {
      throw new WorkOsValidationError("cursor is invalid");
    }
  } else if (kind === "records") {
    if (!validInstant(parsed.o) || typeof parsed.i !== "string" || !parsed.i) {
      throw new WorkOsValidationError("cursor is invalid");
    }
  } else if (!validInstant(parsed.o) || typeof parsed.i !== "string" || !UUID.test(parsed.i)) {
    throw new WorkOsValidationError("cursor is invalid");
  }
  return parsed as CursorPayload;
}

function emptyPage<T>(coverage: string[]): Page<T> {
  return { items: [], nextCursor: null, total: 0, asOf: new Date().toISOString(), coverage };
}

type PersonRow = {
  id: string;
  display_name: string | null;
  active: boolean;
  timezone: string | null;
};

function personRef(row: PersonRow): PersonRef {
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? "").trim() || "Organization member",
    active: row.active === true,
    timezone: safeTimezone(row.timezone),
  };
}

async function activeRoster(access: WorkOsAccess): Promise<PersonRef[]> {
  const { rows } = await getPool().query<PersonRow>(`SELECT p.id, p.display_name, p.active,
      COALESCE((
        SELECT max(o.timezone) FROM work_employee_onboarding o
        WHERE o.organization_id = p.organization_id AND o.person_id = p.id
          AND nullif(btrim(o.timezone), '') IS NOT NULL
      ), 'UTC') AS timezone
    FROM work_people p
    WHERE p.organization_id = $1 AND p.active
    ORDER BY lower(COALESCE(p.display_name, '')), p.id`,
  [access.organizationId]);
  return rows.map(personRef);
}

function normalizedName(value: string) {
  // NFC keeps accents and script letters while making canonically equivalent
  // input comparable. Task 6's provenance predicate uses the same rule.
  return value.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
}

function targetStrings(target: Target): string[] {
  if (target.kind === "names") {
    if (!Array.isArray(target.names) || target.names.length < 1 || target.names.length > MAX_TARGETS) {
      throw new WorkOsValidationError(`names must contain between 1 and ${MAX_TARGETS} values`);
    }
    return target.names.map((name) => {
      if (typeof name !== "string" || !name.trim()) throw new WorkOsValidationError("names must be non-empty strings");
      return name;
    });
  }
  if (target.kind === "ids") {
    if (!Array.isArray(target.ids) || target.ids.length < 1 || target.ids.length > MAX_TARGETS) {
      throw new WorkOsValidationError(`ids must contain between 1 and ${MAX_TARGETS} values`);
    }
    return target.ids.map((id) => {
      if (typeof id !== "string" || !UUID.test(id)) throw new WorkOsValidationError("ids must be person ids");
      return id.toLowerCase();
    });
  }
  throw new WorkOsValidationError("target must be team, names or ids");
}

/** Resolve a target against the complete active authorized roster, never the
 * first directory page. Exact full names win; a unique partial name resolves;
 * several matches wait for a named choice. */
export async function resolveAdminOttoPeople(access: WorkOsAccess, target: Target): Promise<Resolution> {
  requireAdmin(access);
  if (target.kind === "team") {
    return { kind: "resolved", people: await activeRoster(access) };
  }
  const values = targetStrings(target);
  const roster = await activeRoster(access);
  if (target.kind === "ids") {
    const byId = new Map(roster.map((person) => [person.id, person]));
    const people: PersonRef[] = [];
    for (const id of values) {
      const person = byId.get(id);
      if (!person) return { kind: "missing", name: id };
      if (!people.some((entry) => entry.id === person.id)) people.push(person);
    }
    return { kind: "resolved", people };
  }

  const people: PersonRef[] = [];
  for (const rawName of values) {
    const name = normalizedName(rawName);
    const exact = roster.filter((person) => normalizedName(person.displayName) === name);
    const matches = exact.length ? exact : roster.filter((person) => normalizedName(person.displayName).includes(name));
    if (!matches.length) return { kind: "missing", name: rawName.trim() };
    if (matches.length > 1) {
      return { kind: "ambiguous", name: rawName.trim(), choices: matches };
    }
    const person = matches[0];
    if (!people.some((entry) => entry.id === person.id)) people.push(person);
  }
  return { kind: "resolved", people };
}

/** Bounded active directory page. The resolver above still searches the whole
 * authorized roster; this page is only for selection UIs. */
export async function listAdminOttoPeople(access: WorkOsAccess, input: {
  cursor?: string; limit?: number; ids?: string[];
} = {}): Promise<Page<PersonRef>> {
  requireAdmin(access);
  if (input.ids !== undefined) {
    if (input.cursor !== undefined) throw new WorkOsValidationError("ids cannot be combined with a cursor");
    const ids = explicitPeopleIds(input.ids);
    const { rows } = await getPool().query<PersonRow>(`SELECT p.id, p.display_name, p.active,
        COALESCE((
          SELECT max(o.timezone) FROM work_employee_onboarding o
          WHERE o.organization_id = p.organization_id AND o.person_id = p.id
            AND nullif(btrim(o.timezone), '') IS NOT NULL
        ), 'UTC') AS timezone
      FROM work_people p
      WHERE p.organization_id = $1 AND p.id = ANY($2::uuid[])
      ORDER BY lower(COALESCE(p.display_name, '')), p.id`,
    [access.organizationId, ids]);
    return {
      items: rows.map(personRef),
      nextCursor: null,
      total: rows.length,
      asOf: new Date().toISOString(),
      coverage: PEOPLE_IDS_COVERAGE,
    };
  }
  const limit = boundedLimit(input.limit, DEFAULT_PEOPLE_LIMIT, ADMIN_TASK_MAX_LIMIT);
  const scope = scopeHash({ kind: "people", organizationId: access.organizationId });
  const cursor = decodeCursor(input.cursor, "people", scope);
  const afterName = typeof cursor?.c === "string" ? cursor.c : null;
  const afterId = typeof cursor?.i === "string" && UUID.test(cursor.i) ? cursor.i : null;
  const count = await getPool().query<{ total: number | string }>(`SELECT count(*)::int AS total
    FROM work_people counted WHERE counted.organization_id = $1 AND counted.active`,
  [access.organizationId]);
  const { rows } = await getPool().query<PersonRow>(`SELECT p.id, p.display_name, p.active,
      COALESCE((
        SELECT max(o.timezone) FROM work_employee_onboarding o
        WHERE o.organization_id = p.organization_id AND o.person_id = p.id
          AND nullif(btrim(o.timezone), '') IS NOT NULL
      ), 'UTC') AS timezone
    FROM work_people p
    WHERE p.organization_id = $1 AND p.active
      AND ($2::text IS NULL OR (lower(COALESCE(p.display_name, '')), p.id) > ($2::text, $3::uuid))
    ORDER BY lower(COALESCE(p.display_name, '')), p.id
    LIMIT $4`,
  [access.organizationId, afterName, afterId, limit + 1]);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible[visible.length - 1];
  return {
    items: visible.map(personRef),
    nextCursor: hasMore && last ? encodeCursor({
      v: 1, k: "people", s: scope,
      c: String(last.display_name ?? "").toLowerCase(), i: String(last.id),
    }) : null,
    total: Number(count.rows[0]?.total ?? 0),
    asOf: new Date().toISOString(),
    coverage: PEOPLE_COVERAGE,
  };
}

type TaskRow = {
  id: string;
  title: string | null;
  parent_task_id: string | null;
  parent_provider_task_id: string | null;
  parent_title: string | null;
  assignee_person_ids: string[] | null;
  assignee_provider_ids: string[] | null;
  created_source: Date | string | null;
  effective_due: Date | string | null;
  created_key: Date | string;
  updated_key: Date | string;
  due_key: Date | string;
  title_key: string;
};

function taskParentId(row: TaskRow): string | null {
  return row.parent_task_id ? String(row.parent_task_id) : row.parent_provider_task_id ? String(row.parent_provider_task_id) : null;
}

function taskRecordUrl(id: string) {
  return `/work-os/admin/tasks?task=${encodeURIComponent(id)}`;
}

async function hydrateTaskAssignees(organizationId: string, rows: TaskRow[]): Promise<Map<string, PersonRef[]>> {
  const personIds = new Set<string>();
  const providerIds = new Set<string>();
  for (const row of rows) {
    for (const id of row.assignee_person_ids ?? []) if (UUID.test(String(id))) personIds.add(String(id).toLowerCase());
    for (const id of row.assignee_provider_ids ?? []) if (id) providerIds.add(String(id));
  }
  const result = new Map<string, PersonRef[]>();
  if (!personIds.size && !providerIds.size) return result;
  const { rows: people } = await getPool().query<PersonRow & { nifty_member_id: string | null }>(`SELECT p.id, p.display_name, p.active, p.nifty_member_id,
      COALESCE((
        SELECT max(o.timezone) FROM work_employee_onboarding o
        WHERE o.organization_id = p.organization_id AND o.person_id = p.id
          AND nullif(btrim(o.timezone), '') IS NOT NULL
      ), 'UTC') AS timezone
    FROM work_people p
    WHERE p.organization_id = $1
      AND (p.id = ANY($2::uuid[]) OR p.nifty_member_id = ANY($3::text[]))`,
  [organizationId, personIds.size ? [...personIds] : null, providerIds.size ? [...providerIds] : null]);
  const byId = new Map(people.map((person) => [String(person.id), personRef(person)]));
  const byProvider = new Map(people.filter((person) => person.nifty_member_id)
    .map((person) => [String(person.nifty_member_id), personRef(person)]));
  for (const row of rows) {
    const resolved: PersonRef[] = [];
    for (const id of row.assignee_person_ids ?? []) {
      const person = byId.get(String(id).toLowerCase());
      if (person && !resolved.some((entry) => entry.id === person.id)) resolved.push(person);
    }
    for (const id of row.assignee_provider_ids ?? []) {
      const person = byProvider.get(String(id));
      if (person && !resolved.some((entry) => entry.id === person.id)) resolved.push(person);
    }
    result.set(String(row.id), resolved);
  }
  return result;
}

async function validateTaskPeople(access: WorkOsAccess, personIds: string[]): Promise<string[]> {
  const unique = [...new Set(personIds.map((id) => id.toLowerCase()))];
  if (unique.some((id) => !UUID.test(id))) throw new WorkOsValidationError("personIds must be person ids");
  if (!unique.length) return [];
  const { rows } = await getPool().query<{ id: string }>(`SELECT id FROM work_people
    WHERE organization_id = $1 AND active AND id = ANY($2::uuid[])`, [access.organizationId, unique]);
  if (rows.length !== unique.length) {
    throw new WorkOsValidationError("personIds must be active organization members");
  }
  return unique;
}

/** Complete open backlog for the team (null) or the selected people. An empty
 * person list is explicitly no rows, never the team. */
export async function listAdminOttoTasks(access: WorkOsAccess, input: {
  personIds: string[] | null;
  overdueOnly: boolean;
  cursor?: string;
  limit?: number;
  now: Date;
}): Promise<Page<TaskCard>> {
  requireAdmin(access);
  if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw new WorkOsValidationError("now must be a valid instant");
  }
  const limit = boundedLimit(input.limit, ADMIN_TASK_DEFAULT_LIMIT, ADMIN_TASK_MAX_LIMIT);
  const today = input.now.toISOString().slice(0, 10);
  const personIds = input.personIds === null ? null : await validateTaskPeople(access, input.personIds);
  const scope = scopeHash({
    kind: "tasks", organizationId: access.organizationId,
    personIds: personIds === null ? null : [...personIds].sort(), overdueOnly: input.overdueOnly,
    // A cursor for the normal backlog stays valid across midnight; only the
    // overdue filter depends on which day the first page was read.
    ...(input.overdueOnly ? { today } : {}),
  });
  const cursor = decodeCursor(input.cursor, "tasks", scope);
  if (personIds !== null && personIds.length === 0) return emptyPage(TASK_COVERAGE);
  const afterCreated = typeof cursor?.c === "string" ? cursor.c : null;
  const afterUpdated = typeof cursor?.u === "string" ? cursor.u : null;
  const afterDue = typeof cursor?.d === "string" ? cursor.d : null;
  const afterTitle = typeof cursor?.t === "string" ? cursor.t : null;
  const afterId = typeof cursor?.i === "string" && UUID.test(cursor.i) ? cursor.i : null;

  const base = `
    WITH selected_people AS (
      SELECT p.id, p.nifty_member_id FROM work_people p
      WHERE p.organization_id = $1 AND p.active AND p.id = ANY($2::uuid[])
    ), base AS (
      SELECT t.id, t.title, t.completed, t.status, t.updated_at,
        t.parent_task_id, t.parent_provider_task_id, parent.title AS parent_title,
        t.assignee_person_ids, t.assignee_provider_ids,
        coalesce(t.provider_created_at, t.created_at) AS created_source,
        coalesce(t.due_date, (coalesce(t.provider_created_at, t.created_at) AT TIME ZONE 'UTC')::date + 1) AS effective_due
      FROM work_tasks t
      LEFT JOIN work_tasks parent
        ON parent.organization_id = t.organization_id
        AND parent.id = t.parent_task_id
      WHERE t.organization_id = $1
        AND t.completed = false
        AND coalesce(t.status, '') NOT IN ('archived', 'deleted')
        AND ($2::uuid[] IS NULL OR EXISTS (
          SELECT 1 FROM selected_people sp
          WHERE sp.id = ANY(t.assignee_person_ids)
            OR (sp.nifty_member_id IS NOT NULL AND btrim(sp.nifty_member_id) <> '' AND (
              t.assignee_provider_ids @> ARRAY[btrim(sp.nifty_member_id)]
              OR coalesce(t.raw, '{}'::jsonb) ->> 'created_by' = btrim(sp.nifty_member_id)
              OR (coalesce(t.raw, '{}'::jsonb) -> 'subscribers') ? btrim(sp.nifty_member_id)
            ))
        ))
    ), eligible AS (
      SELECT b.*,
        coalesce((b.created_source AT TIME ZONE 'UTC')::date, date '0001-01-01') AS created_key,
        coalesce(b.updated_at, timestamptz '0001-01-01 00:00:00+00') AS updated_key,
        coalesce(b.effective_due, date '0001-01-01') AS due_key,
        lower(btrim(coalesce(b.title, ''))) AS title_key
      FROM base b
      WHERE (NOT $3::boolean OR (b.effective_due IS NOT NULL AND b.effective_due < $4::date))
    )`;
  const count = await getPool().query<{ total: number | string }>(`${base}
    SELECT count(*)::int AS total FROM eligible`, [access.organizationId, personIds, input.overdueOnly, today]);
  const total = Number(count.rows[0]?.total ?? 0);
  if (!total) return { ...emptyPage<TaskCard>(TASK_COVERAGE), asOf: input.now.toISOString() };
  const { rows } = await getPool().query<TaskRow>(`${base}
    SELECT * FROM eligible e
    WHERE $5::date IS NULL
      OR e.created_key < $5::date
      OR (e.created_key = $5::date AND (
        e.updated_key < $6::timestamptz
        OR (e.updated_key = $6::timestamptz AND (
          e.due_key < $7::date
          OR (e.due_key = $7::date AND (
            e.title_key > $8::text
            OR (e.title_key = $8::text AND e.id > $9::uuid)
          ))
        ))
      ))
    ORDER BY e.created_key DESC, e.updated_key DESC, e.due_key DESC, e.title_key ASC, e.id ASC
    LIMIT $10`,
  [access.organizationId, personIds, input.overdueOnly, today,
    afterCreated, afterUpdated, afterDue, afterTitle, afterId, limit + 1]);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const assignees = await hydrateTaskAssignees(access.organizationId, visible);
  const items: TaskCard[] = visible.map((row) => {
    const dates = adminTaskDates({
      provider_created_at: row.created_source,
      due_date: row.effective_due,
    });
    const rank = adminTaskStatusRank({ completed: false, due_date: row.effective_due }, today);
    return {
      id: String(row.id),
      title: String(row.title ?? "").trim() || "Task",
      assignees: assignees.get(String(row.id)) ?? [],
      parentId: taskParentId(row),
      parentTitle: typeof row.parent_title === "string" && row.parent_title.trim() ? row.parent_title.trim() : null,
      createdDate: dates.createdDate,
      effectiveDueDate: dates.effectiveDueDate,
      status: rank === 0 ? "overdue" : "open",
      recordUrl: taskRecordUrl(String(row.id)),
    };
  });
  const last = visible[visible.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({
      v: 1, k: "tasks", s: scope,
      c: dateOnlyValue(last.created_key),
      u: iso(last.updated_key)!,
      d: dateOnlyValue(last.due_key),
      t: String(last.title_key),
      i: String(last.id),
    }) : null,
    total,
    asOf: input.now.toISOString(),
    coverage: TASK_COVERAGE,
  };
}

/** Exact administration-record counts for the same person attribution and
 * effective-due predicate the rows use. */
export async function countAdminTaskRecord(access: WorkOsAccess, input: {
  ownerId: string; personId: string | null; today: string;
}): Promise<{ open: number; overdue: number; completedWeek: number }> {
  if (access.role !== "admin") throw new WorkOsConflictError("Administration access is required.");
  const today = calendarDate(input.today, "today");
  const personId = input.personId === null ? null : input.personId.toLowerCase();
  if (personId !== null && !UUID.test(personId)) throw new WorkOsValidationError("personId must be a person id");
  const { rows } = await getPool().query<{ open: number | string; overdue: number | string }>(`WITH selected_person AS (
      SELECT p.id, p.nifty_member_id FROM work_people p
      WHERE p.organization_id = $1 AND p.id = $3::uuid
    ), base AS (
      SELECT t.completed,
        coalesce(t.due_date, (coalesce(t.provider_created_at, t.created_at) AT TIME ZONE 'UTC')::date + 1) AS effective_due
      FROM work_tasks t
      WHERE t.organization_id = $1 AND t.user_id = $2
        AND coalesce(t.status, '') NOT IN ('archived', 'deleted')
        AND ($3::uuid IS NULL OR EXISTS (
          SELECT 1 FROM selected_person sp
          WHERE sp.id = ANY(t.assignee_person_ids)
            OR (sp.nifty_member_id IS NOT NULL AND btrim(sp.nifty_member_id) <> '' AND (
              t.assignee_provider_ids @> ARRAY[btrim(sp.nifty_member_id)]
              OR coalesce(t.raw, '{}'::jsonb) ->> 'created_by' = btrim(sp.nifty_member_id)
              OR (coalesce(t.raw, '{}'::jsonb) -> 'subscribers') ? btrim(sp.nifty_member_id)
            ))
        ))
    )
    SELECT
      count(*) FILTER (WHERE NOT completed)::int AS open,
      count(*) FILTER (WHERE NOT completed AND effective_due IS NOT NULL AND effective_due < $4::date)::int AS overdue
    FROM base`, [access.organizationId, input.ownerId, personId, today]);
  const { rows: completed } = await getPool().query<{ n: number | string }>(`SELECT count(*)::int AS n
    FROM work_task_day_events
    WHERE organization_id = $1 AND event_type = 'completed'
      AND local_date >= $3::date - 6
      AND ($2::uuid IS NULL OR person_id = $2::uuid)`,
  [access.organizationId, personId, today]);
  return {
    open: Number(rows[0]?.open ?? 0),
    overdue: Number(rows[0]?.overdue ?? 0),
    completedWeek: Number(completed[0]?.n ?? 0),
  };
}

/** Seven local days by default, today/yesterday or this/last week per person,
 * explicit ranges bounded at 31 local days. */
export function adminRecordWindows(people: PersonRef[], input: {
  from?: string | null;
  through?: string | null;
  relativeDay?: "today" | "yesterday" | "this_week" | "last_week" | null;
}, now = new Date()): LocalWindow[] {
  if (!Array.isArray(people) || people.length < 1) throw new WorkOsValidationError("at least one person is required");
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new WorkOsValidationError("now must be a valid instant");
  const relative = input.relativeDay ?? null;
  if (relative !== null && relative !== "today" && relative !== "yesterday"
    && relative !== "this_week" && relative !== "last_week") {
    throw new WorkOsValidationError("relativeDay must be today, yesterday, this_week or last_week");
  }
  const explicitFrom = input.from ? calendarDate(input.from, "from") : null;
  const explicitThrough = input.through ? calendarDate(input.through, "through") : null;
  if (explicitFrom || explicitThrough) {
    const from = explicitFrom ?? explicitThrough!;
    const through = explicitThrough ?? explicitFrom!;
    if (through < from) throw new WorkOsValidationError("through must not be before from");
    if (spanDays(from, through) > MAX_RECORD_SPAN_DAYS) {
      throw new WorkOsValidationError(`record windows are limited to ${MAX_RECORD_SPAN_DAYS} local days`);
    }
    return people.map((person) => ({
      personId: person.id,
      timezone: safeTimezone(person.timezone),
      from,
      through,
    }));
  }
  return people.map((person) => {
    const timezone = safeTimezone(person.timezone);
    const today = localDateForTimezone(now, timezone);
    if (relative === "this_week" || relative === "last_week") {
      // Work weeks are Monday through Sunday in the employee's local calendar.
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      const monday = addAdminTaskDays(today, weekday === 0 ? -6 : 1 - weekday)!;
      const from = relative === "this_week" ? monday : addAdminTaskDays(monday, -7)!;
      const through = relative === "this_week" ? today : addAdminTaskDays(monday, -1)!;
      return { personId: person.id, timezone, from, through };
    }
    const through = relative === "yesterday" ? addAdminTaskDays(today, -1)! : today;
    const from = relative ? through : addAdminTaskDays(today, -(DEFAULT_RECORD_DAYS - 1))!;
    return { personId: person.id, timezone, from, through };
  });
}

function spanDays(from: string, through: string) {
  const start = Date.parse(`${from}T12:00:00Z`);
  const end = Date.parse(`${through}T12:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

function normalizeWindows(value: unknown): LocalWindow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WINDOWS) {
    throw new WorkOsValidationError(`windows must contain between 1 and ${MAX_WINDOWS} entries`);
  }
  const seen = new Set<string>();
  const windows: LocalWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new WorkOsValidationError("windows must be objects");
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.personId !== "string" || !UUID.test(row.personId)) {
      throw new WorkOsValidationError("window personId must be a person id");
    }
    if (typeof row.timezone !== "string" || !validTimezone(row.timezone)) {
      throw new WorkOsValidationError("window timezone must be a valid IANA timezone");
    }
    const from = calendarDate(row.from, "window from");
    const through = calendarDate(row.through, "window through");
    if (through < from) throw new WorkOsValidationError("window through must not be before from");
    if (spanDays(from, through) > MAX_RECORD_SPAN_DAYS) {
      throw new WorkOsValidationError(`record windows are limited to ${MAX_RECORD_SPAN_DAYS} local days`);
    }
    const key = `${row.personId.toLowerCase()}|${row.timezone}|${from}|${through}`;
    if (seen.has(key)) continue;
    seen.add(key);
    windows.push({ personId: row.personId.toLowerCase(), timezone: row.timezone, from, through });
  }
  return windows;
}

async function validateWindows(access: WorkOsAccess, value: unknown): Promise<LocalWindow[]> {
  const windows = normalizeWindows(value);
  const personIds = [...new Set(windows.map((window) => window.personId))];
  const { rows } = await getPool().query<{ id: string }>(`SELECT id FROM work_people
    WHERE organization_id = $1 AND active AND id = ANY($2::uuid[])`, [access.organizationId, personIds]);
  if (rows.length !== personIds.length) {
    throw new WorkOsValidationError("record windows must reference active organization members");
  }
  return windows;
}

function recordUrl(source: WorkRecord["source"], personId: string, target: string) {
  switch (source) {
    case "task":
      return taskRecordUrl(target);
    case "submitted_eod":
      return `/work-os/admin/review?report=${encodeURIComponent(target)}`;
    case "reviewed_recap":
      return `/work-os/admin/people/${encodeURIComponent(personId)}?recap=${encodeURIComponent(target)}`;
    case "workday":
      return `/work-os/admin/people/${encodeURIComponent(personId)}?workday=${encodeURIComponent(target)}`;
    case "update":
    default:
      return `/work-os/admin/people/${encodeURIComponent(personId)}?update=${encodeURIComponent(target)}`;
  }
}

type RecordRow = {
  record_id: string;
  source: WorkRecord["source"];
  source_id: string;
  record_target: string;
  person_id: string;
  occurred_at: Date | string | null;
  occurred_key: Date | string;
  local_date: Date | string;
  text: string | null;
  needs_snapshot: boolean;
  interval_id: string | null;
  payload: ReviewedRecap | null;
};

function recordText(value: unknown) {
  return String(value ?? "").trim();
}

const RECORD_SOURCES = new Set<WorkRecord["source"]>([
  "update", "submitted_eod", "task", "reviewed_recap", "workday",
]);

/** Optional exact source filter for a typed admin read (for example the
 * workday action). The default keeps the complete record projection. */
function normalizeRecordSources(value: WorkRecord["source"][] | undefined): WorkRecord["source"][] | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > RECORD_SOURCES.size) {
    throw new WorkOsValidationError("sources must contain between 1 and 5 record sources");
  }
  const sources: WorkRecord["source"][] = [];
  for (const source of value) {
    if (!RECORD_SOURCES.has(source)) throw new WorkOsValidationError("sources contains an unknown record source");
    if (!sources.includes(source)) sources.push(source);
  }
  return sources;
}

/** One reviewed-record text for persisted and lazy recap paths: the immutable
 * original words plus the labelled employee correction when the version was
 * amended. The correction is stored in `employeeFeedback`, never folded into
 * `original`. */
function reviewedRecapRecordText(recap: ReviewedRecap) {
  const parts = [recap.original.headline, recap.original.detail].filter(Boolean);
  const correction = recap.reviewStatus === "amended" ? String(recap.employeeFeedback ?? "").trim() : "";
  if (correction) parts.push(`Employee correction: ${correction}`);
  return parts.join("\n").trim();
}

/** Authored updates, submitted EOD snapshots, canonical task events, reviewed
 * recaps and workday snapshots inside each person's stated local windows. */
export async function listAdminOttoRecords(access: WorkOsAccess, input: {
  windows: LocalWindow[]; cursor?: string; sources?: WorkRecord["source"][];
}): Promise<Page<WorkRecord>> {
  requireAdmin(access);
  const windows = await validateWindows(access, input.windows);
  const sources = normalizeRecordSources(input.sources);
  const scope = scopeHash({
    kind: "records", organizationId: access.organizationId, windows,
    ...(sources ? { sources } : {}),
  });
  const cursor = decodeCursor(input.cursor, "records", scope);
  const afterOccurred = typeof cursor?.o === "string" ? cursor.o : null;
  const afterId = typeof cursor?.i === "string" ? cursor.i : null;
  const personIds = windows.map((window) => window.personId);
  const timezones = windows.map((window) => window.timezone);
  const fromDates = windows.map((window) => window.from);
  const throughDates = windows.map((window) => window.through);
  const limit = DEFAULT_RECORD_LIMIT;

  const records = `
    WITH windows AS (
      SELECT * FROM unnest($2::uuid[], $3::text[], $4::date[], $5::date[])
        AS w(person_id, timezone, from_date, through_date)
    ), records AS (
      SELECT 'update'::text AS source, ci.id::text AS source_id, ci.id::text AS record_target,
        ci.person_id, coalesce(ci.occurred_at, ci.created_at) AS occurred_at,
        w.timezone, (coalesce(ci.occurred_at, ci.created_at) AT TIME ZONE w.timezone)::date AS local_date,
        btrim(ci.input_text) AS text, false AS needs_snapshot, NULL::uuid AS interval_id, NULL::jsonb AS payload
      FROM work_check_ins ci
      JOIN LATERAL (
        SELECT w.* FROM windows w
        WHERE w.person_id = ci.person_id
          AND (coalesce(ci.occurred_at, ci.created_at) AT TIME ZONE w.timezone)::date
            BETWEEN w.from_date AND w.through_date
        ORDER BY w.from_date DESC LIMIT 1
      ) w ON true
      WHERE ci.organization_id = $1 AND nullif(btrim(ci.input_text), '') IS NOT NULL
      UNION ALL
      SELECT 'submitted_eod', r.id::text, r.id::text, r.person_id, r.submitted_at,
        w.timezone, r.report_date,
        coalesce(nullif(btrim(r.submitted_markdown), ''), nullif(btrim(r.markdown), ''), r.title),
        false, NULL::uuid, NULL::jsonb
      FROM work_reports r
      JOIN LATERAL (
        SELECT w.* FROM windows w
        WHERE w.person_id = r.person_id AND r.report_date BETWEEN w.from_date AND w.through_date
        ORDER BY w.from_date DESC LIMIT 1
      ) w ON true
      WHERE r.organization_id = $1 AND r.submitted_at IS NOT NULL
        AND coalesce(r.status, '') <> 'draft' AND r.kind = 'eod'
      UNION ALL
      SELECT 'task', e.id::text, e.task_id::text, e.person_id,
        coalesce(e.exact_at, e.observed_at, e.created_at),
        w.timezone, e.local_date,
        initcap(replace(e.event_type, '_', ' ')) || ': '
          || coalesce(nullif(e.task_snapshot ->> 'title', ''), nullif(t.title, ''), 'Task'),
        false, NULL::uuid, NULL::jsonb
      FROM work_task_day_events e
      LEFT JOIN work_tasks t ON t.id = e.task_id AND t.organization_id = e.organization_id
      JOIN LATERAL (
        SELECT w.* FROM windows w
        WHERE w.person_id = e.person_id AND e.local_date BETWEEN w.from_date AND w.through_date
        ORDER BY w.from_date DESC LIMIT 1
      ) w ON true
      WHERE e.organization_id = $1
      UNION ALL
      SELECT 'reviewed_recap', r.interval_id::text, r.interval_id::text, r.person_id, r.reviewed_at,
        w.timezone, (r.reviewed_at AT TIME ZONE w.timezone)::date,
        concat_ws(E'\\n', nullif(r.payload -> 'original' ->> 'headline', ''),
          nullif(r.payload -> 'original' ->> 'detail', '')),
        false, r.interval_id, r.payload
      FROM work_recap_reviews r
      JOIN LATERAL (
        SELECT w.* FROM windows w
        WHERE w.person_id = r.person_id
          AND (r.reviewed_at AT TIME ZONE w.timezone)::date BETWEEN w.from_date AND w.through_date
        ORDER BY w.from_date DESC LIMIT 1
      ) w ON true
      WHERE r.organization_id = $1
        AND r.version = (SELECT max(r2.version) FROM work_recap_reviews r2
          WHERE r2.organization_id = r.organization_id AND r2.interval_id = r.interval_id)
      UNION ALL
      SELECT 'reviewed_recap', i.id::text, i.id::text, i.person_id,
        coalesce(i.reviewed_at, i.generated_at, i.window_end),
        w.timezone,
        (coalesce(i.reviewed_at, i.generated_at, i.window_end) AT TIME ZONE w.timezone)::date,
        concat_ws(E'\\n', nullif(i.headline, ''), nullif(coalesce(i.final_detail, i.ai_detail), '')),
        true, i.id, NULL::jsonb
      FROM work_activity_intervals i
      JOIN LATERAL (
        SELECT w.* FROM windows w
        WHERE w.person_id = i.person_id
          AND (coalesce(i.reviewed_at, i.generated_at, i.window_end) AT TIME ZONE w.timezone)::date
            BETWEEN w.from_date AND w.through_date
        ORDER BY w.from_date DESC LIMIT 1
      ) w ON true
      WHERE i.organization_id = $1
        AND i.review_status IN ('confirmed', 'amended')
        AND NOT EXISTS (
          SELECT 1 FROM work_recap_reviews existing
          WHERE existing.organization_id = i.organization_id AND existing.interval_id = i.id
        )
      UNION ALL
      SELECT 'workday', s.id::text, s.id::text, s.person_id,
        coalesce(s.clocked_out_at, s.clocked_in_at, s.scheduled_starts_at, s.created_at),
        w.timezone, s.shift_date,
        concat('Workday ', coalesce(s.state, 'recorded')),
        false, NULL::uuid, NULL::jsonb
      FROM work_sessions s
      JOIN LATERAL (
        SELECT w.* FROM windows w
        WHERE w.person_id = s.person_id AND s.shift_date BETWEEN w.from_date AND w.through_date
        ORDER BY w.from_date DESC LIMIT 1
      ) w ON true
      WHERE s.organization_id = $1
    ), projected AS (
      SELECT *, source || ':' || source_id AS record_id,
        coalesce(occurred_at, timestamptz '0001-01-01 00:00:00+00') AS occurred_key
      FROM records
    )`;
  const coverage = sources
    ? [...RECORD_COVERAGE, `Sources: ${sources.join(", ")}.`]
    : RECORD_COVERAGE;
  const count = await getPool().query<{ total: number | string }>(`${records}
    SELECT count(*)::int AS total FROM projected
    WHERE $6::text[] IS NULL OR source = ANY($6::text[])`,
  [access.organizationId, personIds, timezones, fromDates, throughDates, sources]);
  const total = Number(count.rows[0]?.total ?? 0);
  if (!total) return emptyPage<WorkRecord>(coverage);
  const { rows } = await getPool().query<RecordRow>(`${records}
    SELECT * FROM projected r
    WHERE ($6::text[] IS NULL OR r.source = ANY($6::text[]))
      AND ($7::timestamptz IS NULL
        OR r.occurred_key < $7::timestamptz
        OR (r.occurred_key = $7::timestamptz AND r.record_id > $8::text))
    ORDER BY r.occurred_key DESC, r.record_id ASC
    LIMIT $9`,
  [access.organizationId, personIds, timezones, fromDates, throughDates, sources, afterOccurred, afterId, limit + 1]);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const items: WorkRecord[] = [];
  for (const row of visible) {
    let occurredAt = iso(row.occurred_at);
    let text = recordText(row.text);
    const localDate = dateOnlyValue(row.local_date);
    if (row.source === "reviewed_recap") {
      const recap = row.payload
        ?? (row.needs_snapshot && row.interval_id ? await loadReviewedRecap(access, row.interval_id) : null);
      if (recap) {
        occurredAt = recap.reviewedAt || occurredAt;
        text = reviewedRecapRecordText(recap) || text;
      }
    }
    const source = row.source;
    items.push({
      id: String(row.record_id),
      personId: String(row.person_id),
      source,
      occurredAt,
      localDate,
      text,
      recordUrl: recordUrl(source, String(row.person_id), String(row.record_target)),
    });
  }
  const last = visible[visible.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({
      v: 1, k: "records", s: scope,
      o: iso(last.occurred_key)!,
      i: String(last.record_id),
    }) : null,
    total,
    asOf: new Date().toISOString(),
    coverage: [
      ...coverage,
      ...windows.map((window) => `${window.personId}: ${window.from} through ${window.through} (${window.timezone})`),
    ],
  };
}

type RecapRow = {
  interval_id: string;
  person_id: string;
  reviewed_at: Date | string | null;
  payload: ReviewedRecap | null;
  version: number | string | null;
};

async function recapPage(access: WorkOsAccess, rows: RecapRow[], scope: string, total: number, latest: boolean, hasMore: boolean): Promise<Page<ReviewedRecap>> {
  const items: ReviewedRecap[] = [];
  for (const row of rows) {
    let recap = row.payload;
    if (!recap) recap = await loadReviewedRecap(access, String(row.interval_id));
    if (recap) items.push(recap);
  }
  const last = rows[rows.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({
      v: 1, k: "recaps", s: scope,
      o: iso(last.reviewed_at)!,
      i: String(last.interval_id),
    }) : null,
    total,
    asOf: new Date().toISOString(),
    coverage: latest ? LATEST_RECAP_COVERAGE : RECAP_COVERAGE,
  };
}

/** Latest reviewed interval per person when `latest`, otherwise reviewed
 * recaps inside the stated local windows. Older retained history is included. */
export async function listAdminOttoRecaps(access: WorkOsAccess, input: {
  windows: LocalWindow[]; latest: boolean; cursor?: string;
}): Promise<Page<ReviewedRecap>> {
  requireAdmin(access);
  const windows = await validateWindows(access, input.windows);
  const scope = scopeHash({ kind: "recaps", organizationId: access.organizationId, windows, latest: input.latest });
  const cursor = decodeCursor(input.cursor, "recaps", scope);
  const afterReviewed = typeof cursor?.o === "string" ? cursor.o : null;
  const afterId = typeof cursor?.i === "string" ? cursor.i : null;
  const personIds = windows.map((window) => window.personId);
  const timezones = windows.map((window) => window.timezone);
  const fromDates = windows.map((window) => window.from);
  const throughDates = windows.map((window) => window.through);
  const limit = DEFAULT_RECORD_LIMIT;

  const candidates = `
    WITH windows AS (
      SELECT * FROM unnest($2::uuid[], $3::text[], $4::date[], $5::date[])
        AS w(person_id, timezone, from_date, through_date)
    ), candidates AS (
      SELECT i.id AS interval_id, i.person_id,
        coalesce(r.reviewed_at, i.reviewed_at, i.generated_at, i.window_end,
          timestamptz '0001-01-01 00:00:00+00') AS reviewed_at,
        r.payload, r.version,
        ${input.latest ? `row_number() OVER (
          PARTITION BY i.person_id
          ORDER BY coalesce(r.reviewed_at, i.reviewed_at, i.generated_at, i.window_end) DESC NULLS LAST,
            coalesce(r.version, 1) DESC, i.id ASC
        ) AS rank` : "1 AS rank"}
      FROM work_activity_intervals i
      LEFT JOIN LATERAL (
        SELECT rr.* FROM work_recap_reviews rr
        WHERE rr.organization_id = i.organization_id AND rr.interval_id = i.id
        ORDER BY rr.version DESC LIMIT 1
      ) r ON true
      WHERE i.organization_id = $1
        AND i.review_status IN ('confirmed', 'amended')
        AND EXISTS (
          SELECT 1 FROM windows w
          WHERE w.person_id = i.person_id
          ${input.latest ? "" : `AND (coalesce(r.reviewed_at, i.reviewed_at, i.generated_at, i.window_end)
            AT TIME ZONE w.timezone)::date BETWEEN w.from_date AND w.through_date`}
        )
    ), eligible AS (
      SELECT * FROM candidates WHERE rank = 1
    )`;
  const count = await getPool().query<{ total: number | string }>(`${candidates}
    SELECT count(*)::int AS total FROM eligible`, [access.organizationId, personIds, timezones, fromDates, throughDates]);
  const total = Number(count.rows[0]?.total ?? 0);
  if (!total) return emptyPage<ReviewedRecap>(input.latest ? LATEST_RECAP_COVERAGE : RECAP_COVERAGE);
  const { rows } = await getPool().query<RecapRow>(`${candidates}
    SELECT * FROM eligible e
    WHERE $6::timestamptz IS NULL
      OR e.reviewed_at < $6::timestamptz
      OR (e.reviewed_at = $6::timestamptz AND e.interval_id > $7::uuid)
    ORDER BY e.reviewed_at DESC NULLS LAST, e.interval_id ASC
    LIMIT $8`,
  [access.organizationId, personIds, timezones, fromDates, throughDates, afterReviewed, afterId, limit + 1]);
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  return recapPage(access, visible, scope, total, input.latest, hasMore);
}

/** Exact org-scoped detail lookup. An inferred, missing or foreign recap is
 * unavailable; nothing is synthesized from a guessed interval. */
export async function getAdminOttoRecap(access: WorkOsAccess, intervalId: string): Promise<ReviewedRecap | null> {
  requireAdmin(access);
  if (!UUID.test(intervalId)) return null;
  const { rows } = await getPool().query<{ id: string }>(`SELECT id FROM work_activity_intervals
    WHERE organization_id = $1 AND id = $2 AND review_status IN ('confirmed', 'amended')`,
  [access.organizationId, intervalId.toLowerCase()]);
  if (!rows[0]) return null;
  return loadReviewedRecap(access, intervalId.toLowerCase());
}

/** Parse the explicit windows JSON or build per-person windows from the
 * requested ids and relative/explicit dates. */
export async function adminOttoWindowsFromQuery(access: WorkOsAccess, params: URLSearchParams): Promise<LocalWindow[]> {
  const raw = params.get("windows");
  if (raw !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new WorkOsValidationError("windows must be valid JSON");
    }
    return normalizeWindows(parsed);
  }
  const personIds = (params.get("personIds") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (!personIds.length) throw new WorkOsValidationError("personIds or windows is required");
  const resolution = await resolveAdminOttoPeople(access, { kind: "ids", ids: personIds });
  if (resolution.kind !== "resolved") {
    throw new WorkOsValidationError("personIds must be active organization members");
  }
  const relative = params.get("relativeDay");
  if (relative !== null && relative !== "today" && relative !== "yesterday") {
    throw new WorkOsValidationError("relativeDay must be today or yesterday");
  }
  return adminRecordWindows(resolution.people, {
    from: params.get("from"),
    through: params.get("through"),
    relativeDay: relative as "today" | "yesterday" | null,
  });
}
