import { createHash } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { listActivityForAccess, type AgentActivityItem } from "@/lib/work-agent-activity";
import { validCursorTimestamp } from "@/lib/work-agent-tasks";
import { getWorkOsEmployeeTaskDetails } from "@/lib/work-os-employee-tasks";
import { WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { isCalendarDate } from "@/lib/work-os-task-permissions";
import type { Json } from "@/lib/work-os-internal";
import type { AdminAgentTaskFilters } from "@/modules/work-os/admin-agent/contracts";

/** Cross-person task reads for admin tokens. Every query is scoped by the
 * token's organization, never by the token's person: an admin token may have no
 * person and still reads the whole organization's work. Detail and activity
 * reuse the employee readers, which already refuse another tenant's record. */

export type { AdminAgentTaskFilters };

export type AdminAgentTaskPage = {
  tasks: Json[];
  nextCursor: string | null;
  total: number;
};

export type AdminAgentTaskCursor = {
  order: "asc" | "desc";
  updatedAt: string;
  id: string;
  filters: string;
};

export const ADMIN_AGENT_TASK_PAGE_DEFAULT = 50;
/** Tasks carry more rows per page than the directory because cross-person
 * triage reads a workstream, not a single profile. */
export const ADMIN_AGENT_TASK_PAGE_MAX = 200;
export const ADMIN_AGENT_TASK_PERSON_MAX = 20;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_STATUSES = new Set(["active", "archived", "deleted"]);

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** A cursor that was minted against a different filter set is stale by
 * definition; spending it would silently skip rows. The route maps this to the
 * documented 422 `invalid_cursor` code. */
export class AdminAgentInvalidCursorError extends WorkOsValidationError {
  readonly code = "invalid_cursor";
  readonly status = 422;
  constructor(message = "Task cursor does not match these filters") {
    super(message);
    this.name = "AdminAgentInvalidCursorError";
  }
}

/** `%`, `_`, and `\` are LIKE metacharacters; escaping them keeps a search for
 * a literal underscore from acting as a wildcard. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function pageLimit(value: number): number {
  if (!Number.isFinite(value)) throw new WorkOsValidationError("limit must be a number");
  return Math.min(ADMIN_AGENT_TASK_PAGE_MAX, Math.max(1, Math.trunc(value)));
}

/** The filter set a cursor is allowed to continue. Limit is deliberately
 * excluded: changing a page size does not change which rows match. */
export function adminAgentTaskFilterFingerprint(filters: AdminAgentTaskFilters): string {
  const normalized = {
    personIds: filters.personIds === null ? null : [...new Set(filters.personIds)].sort(),
    query: filters.query?.trim() || null,
    completed: filters.completed ?? null,
    status: filters.status ?? "active",
    projectId: filters.projectId ?? null,
    dueFrom: filters.dueFrom ?? null,
    dueTo: filters.dueTo ?? null,
    updatedSince: filters.updatedSince ?? null,
    order: filters.updatedSince ? "asc" : "desc",
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("base64url").slice(0, 22);
}

export function encodeAdminAgentTaskCursor(cursor: AdminAgentTaskCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeAdminAgentTaskCursor(
  value: string | null | undefined,
  filters: AdminAgentTaskFilters,
): AdminAgentTaskCursor | null {
  if (value == null || value === "") return null;
  let parsed: Record<string, unknown>;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("invalid cursor");
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("invalid cursor");
    parsed = decoded as Record<string, unknown>;
    if (parsed.order !== "asc" && parsed.order !== "desc") throw new Error("invalid cursor");
    if (!validCursorTimestamp(parsed.updatedAt)) throw new Error("invalid cursor");
    if (typeof parsed.id !== "string" || !isUuid(parsed.id)) throw new Error("invalid cursor");
    if (typeof parsed.filters !== "string" || !parsed.filters) throw new Error("invalid cursor");
  } catch {
    throw new WorkOsValidationError("Task cursor is invalid");
  }
  if (parsed.filters !== adminAgentTaskFilterFingerprint(filters)) {
    throw new AdminAgentInvalidCursorError();
  }
  return {
    order: parsed.order === "asc" ? "asc" : "desc",
    updatedAt: parsed.updatedAt as string,
    id: parsed.id as string,
    filters: parsed.filters as string,
  };
}

/** Service-level validation: the routes parse their query strings, but the
 * list is also called directly by tests and the MCP layer, so a bad id or date
 * can never reach a Postgres cast. */
export function validateAdminAgentTaskFilters(filters: AdminAgentTaskFilters): AdminAgentTaskFilters {
  const personIds = filters.personIds;
  if (personIds !== null) {
    if (personIds.length > ADMIN_AGENT_TASK_PERSON_MAX) {
      throw new WorkOsValidationError("person_ids accepts at most 20 person ids");
    }
    for (const personId of personIds) {
      if (!isUuid(personId)) throw new WorkOsValidationError("person_ids must be person UUIDs");
    }
  }
  if (filters.status !== null && !TASK_STATUSES.has(filters.status)) {
    throw new WorkOsValidationError("status must be active, archived, or deleted");
  }
  if (filters.projectId !== null && !isUuid(filters.projectId)) {
    throw new WorkOsValidationError("project_id must be a UUID");
  }
  if (filters.dueFrom !== null && !isCalendarDate(filters.dueFrom)) {
    throw new WorkOsValidationError("due_from must be a calendar date");
  }
  if (filters.dueTo !== null && !isCalendarDate(filters.dueTo)) {
    throw new WorkOsValidationError("due_to must be a calendar date");
  }
  if (filters.updatedSince !== null && !validCursorTimestamp(filters.updatedSince)) {
    throw new WorkOsValidationError("updated_since must be an ISO timestamp");
  }
  return filters;
}

/** Parses the `GET /tasks` query string. An absent `person_ids` reads the whole
 * organization; an explicitly empty one is no rows, never the whole team. */
export function parseAdminAgentTaskFilters(params: URLSearchParams): AdminAgentTaskFilters {
  let personIds: string[] | null = null;
  const personParam = params.get("person_ids");
  if (personParam !== null) {
    const ids = personParam.split(",").map((value) => value.trim()).filter(Boolean);
    personIds = [...new Set(ids)];
  }

  const query = params.get("q")?.trim() || null;
  if (query !== null && query.length > 200) {
    throw new WorkOsValidationError("q must be 200 characters or fewer");
  }

  const rawCompleted = params.get("completed");
  let completed: boolean | null = null;
  if (rawCompleted !== null && rawCompleted.trim() !== "") {
    const normalized = rawCompleted.trim().toLowerCase();
    if (normalized !== "true" && normalized !== "false") {
      throw new WorkOsValidationError("completed must be true or false");
    }
    completed = normalized === "true";
  }

  const rawStatus = params.get("status");
  const status = rawStatus === null || rawStatus.trim() === ""
    ? "active"
    : rawStatus.trim().toLowerCase();
  if (!TASK_STATUSES.has(status)) {
    throw new WorkOsValidationError("status must be active, archived, or deleted");
  }

  const rawLimit = params.get("limit");
  const limit = rawLimit === null || rawLimit.trim() === ""
    ? ADMIN_AGENT_TASK_PAGE_DEFAULT
    : pageLimit(Number(rawLimit));

  return validateAdminAgentTaskFilters({
    personIds,
    query,
    completed,
    status: status as AdminAgentTaskFilters["status"],
    projectId: params.get("project_id")?.trim() || null,
    dueFrom: params.get("due_from")?.trim() || null,
    dueTo: params.get("due_to")?.trim() || null,
    updatedSince: params.get("updated_since")?.trim() || null,
    limit,
    cursor: params.get("cursor")?.trim() || null,
  });
}

type TaskRow = Record<string, unknown>;

/** `to_char` already turns the calendar-date columns into strings; the
 * timestamptz columns arrive as Date and must leave as ISO timestamps. The
 * full-precision `cursor_at` helper stays out of the response: it exists only
 * so a keyset cursor never truncates microseconds and skips a row. */
function toTaskJson(row: TaskRow): Json {
  const task: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "cursor_at") continue;
    task[key] = value instanceof Date ? value.toISOString() : value;
  }
  return task;
}

const TASK_SELECT = `
  t.id, t.project_id, t.parent_task_id, t.parent_provider_task_id,
  t.title, t.description, t.status, t.workflow_status, t.completed,
  t.assignee_person_ids, t.assigned_by_person_id,
  to_char(t.due_date, 'YYYY-MM-DD') as due_date,
  to_char(t.start_date, 'YYYY-MM-DD') as start_date,
  t.completed_at, t.created_at, t.updated_at,
  to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at`;

/** `active` is an exclusion, not a stored status: archived and tombstoned rows
 * are out unless the caller asks for that exact status. */
const TASK_FILTERS = `
  t.organization_id = $1
  and ($2::uuid[] is null or t.assignee_person_ids && $2::uuid[])
  and ($3::text is null or t.title ilike '%' || $3 || '%' or coalesce(t.description, '') ilike '%' || $3 || '%')
  and ($4::boolean is null or t.completed = $4)
  and (
    ($5::text = 'active' and coalesce(t.status, '') not in ('archived', 'deleted'))
    or ($5::text <> 'active' and t.status = $5::text)
  )
  and ($6::uuid is null or t.project_id = $6)
  and ($7::date is null or t.due_date >= $7::date)
  and ($8::date is null or t.due_date <= $8::date)
  and ($9::timestamptz is null or t.updated_at >= $9::timestamptz)`;

export async function listAdminAgentTasks(
  access: WorkOsAccess,
  filters: AdminAgentTaskFilters,
): Promise<AdminAgentTaskPage> {
  const validated = validateAdminAgentTaskFilters(filters);
  // An explicit empty person list matches nobody. Short-circuiting here keeps
  // the answer obviously intentional instead of relying on an empty overlap.
  if (validated.personIds !== null && validated.personIds.length === 0) {
    return { tasks: [], nextCursor: null, total: 0 };
  }

  const limit = pageLimit(validated.limit);
  const ascending = Boolean(validated.updatedSince);
  const cursor = decodeAdminAgentTaskCursor(validated.cursor, validated);
  if (cursor && cursor.order !== (ascending ? "asc" : "desc")) {
    throw new AdminAgentInvalidCursorError();
  }

  const search = validated.query ? escapeLike(validated.query.trim()) : null;
  const status = validated.status ?? "active";
  const parameters = [
    access.organizationId,
    validated.personIds,
    search,
    validated.completed,
    status,
    validated.projectId,
    validated.dueFrom,
    validated.dueTo,
    validated.updatedSince,
  ];
  const pool = getPool();

  const count = await pool.query<{ total: number | string }>(
    `select count(*)::int as total from work_tasks t where ${TASK_FILTERS}`,
    parameters,
  );

  const pageParameters = [...parameters, cursor?.updatedAt ?? null, cursor?.id ?? null, limit + 1];
  const rows = ascending
    ? await pool.query<TaskRow>(
      `select ${TASK_SELECT} from work_tasks t
       where ${TASK_FILTERS}
         and ($10::timestamptz is null or (t.updated_at, t.id) > ($10::timestamptz, $11::uuid))
       order by t.updated_at asc, t.id asc
       limit $12`,
      pageParameters,
    )
    : await pool.query<TaskRow>(
      `select ${TASK_SELECT} from work_tasks t
       where ${TASK_FILTERS}
         and ($10::timestamptz is null or (t.updated_at, t.id) < ($10::timestamptz, $11::uuid))
       order by t.updated_at desc, t.id desc
       limit $12`,
      pageParameters,
    );

  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.rows.length > limit && last
    ? encodeAdminAgentTaskCursor({
      order: ascending ? "asc" : "desc",
      updatedAt: String(last.cursor_at),
      id: String(last.id),
      filters: adminAgentTaskFilterFingerprint(validated),
    })
    : null;

  return {
    tasks: page.map(toTaskJson),
    total: Number(count.rows[0]?.total ?? 0),
    nextCursor,
  };
}

export async function getAdminAgentTask(access: WorkOsAccess, taskId: string) {
  const details = await getWorkOsEmployeeTaskDetails(access, taskId);
  return {
    task: details.task,
    subtasks: details.subtasks,
    completionEvidence: details.completionEvidence,
  };
}

export function getAdminAgentTaskActivity(
  access: WorkOsAccess,
  taskId: string,
  params: { cursor?: string | null; limit?: number } = {},
): Promise<{ items: AgentActivityItem[]; nextCursor: string | null }> {
  return listActivityForAccess(access, taskId, params);
}
