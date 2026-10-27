import { attachTaskAssigneeIdentities } from "@/lib/work-os-task-assignees";
import { validateWorkOsDate } from "@/lib/work-os-schedule-validation";
import { todayIso as today } from "@/lib/work-os-dates";
import {
  dateOnly,
  db,
  ensureNoError,
  nonEmptyString,
  selectFirst,
  type Json,
} from "@/lib/work-os-internal";
import { WorkOsNotFoundError, WorkOsValidationError } from "@/lib/work-os-api";
import { removePlanItemsForTombstonedTask } from "@/lib/work-os-plan-ghosts";
import { createWorkspaceTaskCursor, parseWorkspaceTaskCursor, taskPageScope, type WorkspaceTaskOrder } from "@/lib/work-os-task-pagination";

function structuredDescription(description: string | null, expectedOutcome: unknown, definitionOfDone: unknown) {
  const base = (description || "")
    .replace(/(?:^|\n)## Expected outcome\s*\n[\s\S]*?(?=\n## |$)/i, "")
    .replace(/(?:^|\n)## Definition of done\s*\n[\s\S]*?(?=\n## |$)/i, "")
    .trim();
  const outcome = nonEmptyString(expectedOutcome);
  const done = nonEmptyString(definitionOfDone);
  return [base, outcome ? `## Expected outcome\n${outcome}` : "", done ? `## Definition of done\n${done}` : ""].filter(Boolean).join("\n\n") || null;
}

/** Server-side task ordering. Workspace variants are used by the paginated
 * Tasks surface so sorting applies to the full result set, not only loaded rows. */
export type TaskListOrder =
  | "due"
  | "recency"
  | "title_asc"
  | "title_desc"
  | "due_asc"
  | "due_desc"
  | "created_desc"
  | "status_asc"
  | "status_desc";

export interface TaskListOptions {
  completed?: string | null;
  personId?: string | null;
  projectId?: string | null;
  providerProjectId?: string | null;
  todayOnly?: boolean;
  todayDate?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  offset?: number;
  limit?: number;
  includeCompleted?: boolean;
  includeLedgerHistory?: boolean;
  cursor?: string | null;
  search?: string | null;
  organizationId?: string | null;
  excludeTaskIds?: string[];
  /** SQL-side attribution filters for rows imported with provider creator/subscriber
   * metadata. Historical provenance only; no provider call is made. */
  rawCreatedBy?: string | null;
  rawSubscriber?: string | null;
  providerAssignee?: string | null;
  /** Group overdue work first, ahead of the selected sort (design §6.4). */
  overdueFirst?: boolean;
  order?: TaskListOrder;
  sortDate?: string | null;
}

export const DEFAULT_NIFTY_LEDGER_PROJECT_ID = "czFZk9928z";

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function resolveActiveTaskPeople(organizationId: string, value: unknown) {
  const personIds = [...new Set(stringValues(value))];
  if (!personIds.length) return [];
  const result = await db().from("work_people").select("id,nifty_member_id")
    .eq("organization_id", organizationId)
    .eq("active", true)
    .in("id", personIds);
  if (result.error) throw new Error(`resolve Work OS task assignees: ${result.error.message}`);
  const byId = new Map((result.data ?? []).map((person) => [String(person.id), person]));
  if (personIds.some((personId) => !byId.has(personId))) throw new Error("Assignees must be active Work OS organization members");
  return personIds.map((personId) => byId.get(personId)!);
}

/** One attribution rule for every task surface: the local person id, the
 * historical provider assignee mapping or creator/subscriber metadata. */
export function isTaskAttributableToPerson(task: Record<string, any>, personId: string | null | undefined, niftyMemberId: string | null | undefined) {
  if (personId && stringValues(task.assignee_person_ids).includes(String(personId))) return true;
  return isNiftyTaskAttributableToMember(task, niftyMemberId);
}

export function isNiftyTaskAttributableToMember(task: Record<string, any>, niftyMemberId: string | null | undefined) {
  if (!niftyMemberId) return false;
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Record<string, unknown> : {};
  return stringValues(task.assignee_provider_ids).includes(niftyMemberId)
    || raw.created_by === niftyMemberId
    || stringValues(raw.subscribers).includes(niftyMemberId);
}

/** Query one stable page of mirrored tasks using provider-neutral filters. */
export async function listTasks(userId: string, opts: TaskListOptions = {}) {
  let query = db()
    .from("work_tasks")
    .select("*, project:work_projects(*), evidence:work_evidence(id, source, title, evidence_date)")
    .eq("user_id", userId);
  // The administration record opens newest-created first (design.md §16.2);
  // every other list keeps the due-date order the workday uses.
  query = opts.order === "created_desc"
    ? query.order("created_at", { ascending: false }).order("id", { ascending: true })
    : query.order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
  query = query.range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100) - 1);
  query = query.not("status", "in", "(archived,deleted)");
  if (opts.completed === "true") query = query.eq("completed", true);
  if (opts.completed === "false") query = query.eq("completed", false);
  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  if (opts.providerProjectId) query = query.eq("provider_project_id", opts.providerProjectId);
  if (opts.personId) query = query.contains("assignee_person_ids", [opts.personId]);
  if (opts.rawCreatedBy) query = query.eq("raw->>created_by", opts.rawCreatedBy);
  if (opts.rawSubscriber) query = query.contains("raw->subscribers", JSON.stringify([opts.rawSubscriber]));
  if (opts.providerAssignee) query = query.contains("assignee_provider_ids", [opts.providerAssignee]);
  if (opts.todayOnly) {
    const d = opts.todayDate ?? today();
    const previous = new Date(`${d}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const prior = previous.toISOString().slice(0, 10);
    query = query.or(`due_date.lte.${d},provider_created_at.gte.${prior}T00:00:00Z`);
    if (opts.includeCompleted !== true) query = query.eq("completed", false);
  }
  if (opts.fromDate) query = query.gte("provider_created_at", `${opts.fromDate}T00:00:00Z`);
  if (opts.toDate) query = query.lt("provider_created_at", `${opts.toDate}T00:00:00Z`);
  return ensureNoError(query, "load tasks");
}

export async function hydrateTaskAssignees(userId: string, tasks: Record<string, any>[]) {
  const personIds = [...new Set(tasks.flatMap((task) => stringValues(task.assignee_person_ids)))];
  if (!personIds.length) return attachTaskAssigneeIdentities(tasks, []);
  const people = await ensureNoError(
    db().from("work_people").select("id,display_name,email").eq("user_id", userId).in("id", personIds),
    "load task assignee identities",
  );
  return attachTaskAssigneeIdentities(tasks, people ?? []);
}

async function hydrateTaskProjects(userId: string, tasks: Record<string, any>[]) {
  const projectIds = [...new Set(tasks.map((task) => task.project_id).filter((id) => id != null).map(String))];
  if (!projectIds.length) return tasks.map((task) => ({ ...task, project: null }));
  const projects = await ensureNoError(
    db().from("work_projects").select("*").eq("user_id", userId).in("id", projectIds),
    "load task projects",
  );
  const byId = new Map((projects ?? []).map((project) => [String(project.id), project]));
  return tasks.map((task) => ({ ...task, project: byId.get(String(task.project_id)) ?? null }));
}

/**
 * Loads work attributable to a person. Nifty's API permits creator-owned ledger
 * tasks without assignees, so strict assignee filtering alone hides the agent's
 * daily status updates. Include only ledger rows attributable through Nifty's
 * creator/subscriber metadata; unrelated unassigned project work stays hidden.
 */
/** The timestamp that decides a task's place in a recency list. Nifty's own
 * activity wins when the mirror has it, then provider creation, then the local
 * row: the mirror's `updated_at` is rewrite noise from the last sync, so it
 * must never make an old task look recent. The pg driver returns timestamptz
 * columns as `Date` objects while other clients hand back ISO strings, so both
 * shapes normalize to one comparable stamp. */
export function taskRecencyStamp(task: Record<string, any>) {
  const value = task.provider_updated_at ?? task.provider_created_at ?? task.created_at ?? task.updated_at;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return typeof value === "string" ? value : "";
}

/** Newest activity first, title as the stable tiebreak. */
export function compareTaskRecency(left: Record<string, any>, right: Record<string, any>) {
  return taskRecencyStamp(right).localeCompare(taskRecencyStamp(left))
    || String(left.title ?? "").localeCompare(String(right.title ?? ""));
}

/** The API's legacy due order: soonest due first, undated last. */
function compareTaskDueOrder(left: Record<string, any>, right: Record<string, any>) {
  const leftDue = String(left.due_date ?? "9999-12-31");
  const rightDue = String(right.due_date ?? "9999-12-31");
  return leftDue.localeCompare(rightDue) || String(right.provider_created_at ?? right.created_at ?? "").localeCompare(String(left.provider_created_at ?? left.created_at ?? ""));
}

/** Normalize a task due value to a comparable calendar date. */
function normalizedTaskDue(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/** Compare workspace rows by due date while keeping completed and undated work in canonical positions. */
function compareWorkspaceDue(left: Record<string, any>, right: Record<string, any>, direction: "asc" | "desc") {
  // Match the companion contract: open work before completed work, and undated
  // rows after dated rows in either direction.
  const completion = Number(left.completed === true) - Number(right.completed === true);
  if (completion) return completion;
  const leftDue = normalizedTaskDue(left.due_date);
  const rightDue = normalizedTaskDue(right.due_date);
  if (!leftDue && !rightDue) return compareTaskRecency(left, right);
  if (!leftDue) return 1;
  if (!rightDue) return -1;
  const due = direction === "asc" ? leftDue.localeCompare(rightDue) : rightDue.localeCompare(leftDue);
  return due || compareTaskRecency(left, right);
}

/** Rank overdue, open, and completed rows for Status sorting. */
function workspaceStatusRank(task: Record<string, any>, currentDate: string) {
  if (task.completed === true) return 2;
  const due = normalizedTaskDue(task.due_date);
  return due && due < currentDate ? 0 : 1;
}

/** Apply the server-side ordering contract used before paginating Tasks workspace results. */
function compareWorkspaceOrder(left: Record<string, any>, right: Record<string, any>, order: TaskListOrder, currentDate: string) {
  switch (order) {
    case "title_asc":
      return String(left.title ?? "").localeCompare(String(right.title ?? "")) || compareTaskRecency(left, right);
    case "title_desc":
      return String(right.title ?? "").localeCompare(String(left.title ?? "")) || compareTaskRecency(left, right);
    case "due_asc":
      return compareWorkspaceDue(left, right, "asc");
    case "due_desc":
      return compareWorkspaceDue(left, right, "desc");
    case "status_asc": {
      const status = workspaceStatusRank(left, currentDate) - workspaceStatusRank(right, currentDate);
      return status || compareWorkspaceDue(left, right, "asc");
    }
    case "status_desc": {
      const status = workspaceStatusRank(right, currentDate) - workspaceStatusRank(left, currentDate);
      return status || compareWorkspaceDue(left, right, "asc");
    }
    case "recency":
      return compareTaskRecency(left, right);
    case "due":
    default:
      return compareTaskDueOrder(left, right);
  }
}

/** Use the database's single attributed query for the paginated Tasks workspace.
 * Other callers keep their legacy provenance behavior below. */
async function listPersonWorkspaceTaskPage(
  userId: string,
  personId: string,
  niftyMemberId: string | null | undefined,
  opts: Omit<TaskListOptions, "personId">,
) {
  const completed = opts.completed === "true" ? true : opts.completed === "false" ? false : null;
  const sortDate = opts.sortDate ? validateWorkOsDate(opts.sortDate, "sortDate") : today();
  const data = await ensureNoError(db().rpc("work_list_person_tasks_sorted", {
    p_user_id: userId,
    p_person_id: personId,
    p_nifty_member_id: niftyMemberId ?? null,
    p_completed: completed,
    p_project_id: opts.projectId ?? null,
    p_order: opts.order ?? "due_desc",
    p_sort_date: sortDate,
    p_offset: opts.offset ?? 0,
    p_limit: opts.limit ?? 100,
  }), "load sorted task history");
  return (data ?? []) as Record<string, any>[];
}

/** Load all task provenance paths attributable to one person, then globally sort and page them. */
export async function listPersonTasks(userId: string, personId: string, opts: Omit<TaskListOptions, "personId"> = {}): Promise<Record<string, any>[]> {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 100;
  const workspaceOrder = typeof opts.order === "string" && /^(?:title|due|status)_(?:asc|desc)$/.test(opts.order);
  const candidateLimit = Math.min(1000, offset + limit);
  const baseOptions = { ...opts, offset: 0, limit: candidateLimit };
  const personResult = await db().from("work_people").select("nifty_member_id").eq("user_id", userId).eq("id", personId).maybeSingle();
  if (personResult.error) throw new Error(`load task person mapping: ${personResult.error.message}`);
  const niftyMemberId = personResult.data?.nifty_member_id as string | null | undefined;
  // The Tasks workspace's All / Completed history is the only paginated path
  // that needs global Name / Due / Status ordering. Keep that work in one SQL
  // query so later pages do not reload the complete history through four
  // attribution scans.
  if (workspaceOrder && opts.includeLedgerHistory === true && !opts.todayOnly && !opts.fromDate && !opts.toDate && !opts.providerProjectId) {
    const selected = await listPersonWorkspaceTaskPage(userId, personId, niftyMemberId, opts);
    const parentProviderIds = selected
      .filter((task) => !task.parent_provider_task_id && task.provider_task_id)
      .map((task) => String(task.provider_task_id));
    const childrenResult = parentProviderIds.length
      ? await db().from("work_tasks").select("parent_provider_task_id,completed").eq("user_id", userId).not("status", "in", "(archived,deleted)").in("parent_provider_task_id", parentProviderIds)
      : { data: [], error: null };
    if (childrenResult.error) throw new Error(`load task subtask progress: ${childrenResult.error.message}`);
    const progress = new Map<string, { total: number; completed: number }>();
    for (const child of childrenResult.data ?? []) {
      const parentId = String(child.parent_provider_task_id);
      const current = progress.get(parentId) ?? { total: 0, completed: 0 };
      current.total += 1;
      if (child.completed === true) current.completed += 1;
      progress.set(parentId, current);
    }
    const withProgress = selected.map((task) => {
      const childProgress = task.provider_task_id
        ? progress.get(String(task.provider_task_id)) ?? { total: 0, completed: 0 }
        : { total: 0, completed: 0 };
      return { ...task, subtask_total: childProgress.total, subtask_completed: childProgress.completed };
    });
    return hydrateTaskAssignees(userId, await hydrateTaskProjects(userId, withProgress));
  }
  // Metadata-attributable work lives in every project, not only the ledger, so
  // the same attribution rule runs against each provenance path in SQL.
  const metadataOptions: TaskListOptions = { ...baseOptions };
  if (opts.todayOnly || (!opts.includeLedgerHistory && !opts.fromDate && !opts.toDate)) {
    const date = opts.todayDate ?? today();
    const previous = new Date(`${date}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    metadataOptions.todayOnly = false;
    metadataOptions.fromDate = previous.toISOString().slice(0, 10);
    metadataOptions.toDate = next.toISOString().slice(0, 10);
    if (opts.includeCompleted !== true && !opts.completed) metadataOptions.completed = "false";
  }
  const [assigned, providerAssigned, createdBy, subscriber] = await Promise.all([
    listTasks(userId, { ...baseOptions, personId }),
    niftyMemberId ? listTasks(userId, { ...baseOptions, providerAssignee: niftyMemberId }) : Promise.resolve([]),
    niftyMemberId ? listTasks(userId, { ...metadataOptions, rawCreatedBy: niftyMemberId }) : Promise.resolve([]),
    niftyMemberId ? listTasks(userId, { ...metadataOptions, rawSubscriber: niftyMemberId }) : Promise.resolve([]),
  ]);
  const rows = new Map<string, Record<string, any>>();
  for (const task of assigned ?? []) rows.set(String(task.id), task);
  for (const task of [...(providerAssigned ?? []), ...(createdBy ?? []), ...(subscriber ?? [])]) {
    if (isTaskAttributableToPerson(task, personId, niftyMemberId)) rows.set(String(task.id), task);
  }
  const sortDate = opts.sortDate ? validateWorkOsDate(opts.sortDate, "sortDate") : today();
  const selected = [...rows.values()]
    .sort((left, right) => compareWorkspaceOrder(left, right, opts.order ?? "due", sortDate))
    .slice(offset, offset + limit);
  const parentProviderIds = selected
    .filter((task) => !task.parent_provider_task_id && task.provider_task_id)
    .map((task) => String(task.provider_task_id));
  const childrenResult = parentProviderIds.length
    ? await db().from("work_tasks").select("parent_provider_task_id,completed").eq("user_id", userId).not("status", "in", "(archived,deleted)").in("parent_provider_task_id", parentProviderIds)
    : { data: [], error: null };
  if (childrenResult.error) throw new Error(`load task subtask progress: ${childrenResult.error.message}`);
  const progress = new Map<string, { total: number; completed: number }>();
  for (const child of childrenResult.data ?? []) {
    const parentId = String(child.parent_provider_task_id);
    const current = progress.get(parentId) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (child.completed === true) current.completed += 1;
    progress.set(parentId, current);
  }
  const withProgress = selected.map((task): Record<string, any> => {
    const counts = progress.get(String(task.provider_task_id)) ?? { total: 0, completed: 0 };
    return { ...task, subtask_total: counts.total, subtask_completed: counts.completed };
  });
  return hydrateTaskAssignees(userId, withProgress);
}

export type PersonTaskPage = {
  tasks: Record<string, any>[];
  totalCount: number;
  counts: { total: number; open: number; completed: number; overdue: number };
  nextCursor: string | null;
};

/** Load one bounded, globally sorted page of parent tasks for an employee. */
export async function listPersonTaskPage(
  userId: string,
  organizationId: string,
  personId: string,
  opts: Omit<TaskListOptions, "personId" | "offset"> = {},
): Promise<PersonTaskPage> {
  const limit = Math.min(50, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const order = (opts.order && opts.order !== "due" ? opts.order : "due_desc") as WorkspaceTaskOrder;
  const sortDate = opts.sortDate ? validateWorkOsDate(opts.sortDate, "sortDate") : today();
  const search = opts.search?.trim() || null;
  const excludedTaskIds = [...new Set((opts.excludeTaskIds ?? []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].sort();
  const overdueFirst = opts.overdueFirst === true;
  const scope = taskPageScope({
    userId,
    organizationId,
    personId,
    completed: opts.completed ?? null,
    projectId: opts.projectId ?? null,
    order,
    sortDate,
    search,
    fromDate: opts.fromDate ?? null,
    toDate: opts.toDate ?? null,
    overdueFirst,
  });
  const after = parseWorkspaceTaskCursor(opts.cursor, scope);
  if (after && (after.order !== order || after.sortDate !== sortDate)) {
    throw new Error("Task cursor must be valid and match the current filters");
  }
  const person = await ensureNoError(
    db().from("work_people").select("nifty_member_id")
      .eq("organization_id", organizationId).eq("user_id", userId).eq("id", personId).maybeSingle(),
    "load task person mapping",
  );
  if (!person) throw new Error("Task person must belong to the authorized organization");
  const rows = await ensureNoError(db().rpc("work_list_person_task_page", {
    p_user_id: userId,
    p_organization_id: organizationId,
    p_person_id: personId,
    p_nifty_member_id: person.nifty_member_id ?? null,
    p_completed: opts.completed === "true" ? true : opts.completed === "false" ? false : null,
    p_project_id: opts.projectId ?? null,
    p_order: order,
    p_sort_date: sortDate,
    p_search: search,
    p_from: opts.fromDate ?? null,
    p_to: opts.toDate ?? null,
    p_excluded_task_ids: excludedTaskIds.length ? excludedTaskIds : null,
    p_after: after,
    p_limit: limit,
    p_overdue_first: overdueFirst,
  }), "load employee task page") as Array<Record<string, any>> | null;
  const first = rows?.[0] ?? {};
  const selected = (rows ?? []).flatMap((row) => row.task && typeof row.task === "object" && !Array.isArray(row.task)
    ? [row.task as Record<string, any>]
    : []);
  const totalCount = Math.max(0, Number(first.total_count) || 0);
  const counts = {
    total: Math.max(0, Number(first.total_all) || 0),
    open: Math.max(0, Number(first.total_open) || 0),
    completed: Math.max(0, Number(first.total_completed) || 0),
    overdue: Math.max(0, Number(first.total_overdue) || 0),
  };
  const position = after?.position ?? 0;
  const nextCursor = selected.length === limit && first.has_more === true
    ? createWorkspaceTaskCursor(selected[selected.length - 1]!, { scope, order, sortDate, position: position + selected.length, overdueFirst })
    : null;

  const providerIds = selected.filter((task) => task.provider_task_id).map((task) => String(task.provider_task_id));
  const localIds = selected.filter((task) => task.provider === "local").map((task) => String(task.id));
  const [providerChildren, localChildren] = await Promise.all([
    providerIds.length
      ? db().from("work_tasks").select("parent_provider_task_id,completed")
        .eq("organization_id", organizationId).eq("user_id", userId)
        .not("status", "in", "(archived,deleted)").in("parent_provider_task_id", providerIds)
      : Promise.resolve({ data: [], error: null }),
    localIds.length
      ? db().from("work_tasks").select("parent_task_id,completed")
        .eq("organization_id", organizationId).eq("user_id", userId)
        .not("status", "in", "(archived,deleted)").in("parent_task_id", localIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (providerChildren.error) throw new Error(`load task subtask progress: ${providerChildren.error.message}`);
  if (localChildren.error) throw new Error(`load local task subtask progress: ${localChildren.error.message}`);
  const progress = new Map<string, { total: number; completed: number }>();
  for (const child of [...(providerChildren.data ?? []), ...(localChildren.data ?? [])]) {
    const parentId = String(child.parent_provider_task_id ?? child.parent_task_id);
    const count = progress.get(parentId) ?? { total: 0, completed: 0 };
    count.total += 1;
    if (child.completed === true) count.completed += 1;
    progress.set(parentId, count);
  }
  const withProgress = selected.map((task) => {
    const count = progress.get(String(task.provider_task_id)) ?? progress.get(String(task.id)) ?? { total: 0, completed: 0 };
    return { ...task, subtask_total: count.total, subtask_completed: count.completed };
  });
  const hydrated = await hydrateTaskAssignees(userId, await hydrateTaskProjects(userId, withProgress));
  return { tasks: hydrated, totalCount, counts, nextCursor };
}

/**
 * The complete open backlog for a person, independent of the paginated history
 * window: every attributable open parent plus exact parent counts. The
 * dashboard carry-over tabs and the Tasks Unfinished view both render from this
 * set so the two surfaces cannot disagree.
 */
export async function listPersonOpenTasks(userId: string, personId: string) {
  const personResult = await db().from("work_people").select("nifty_member_id").eq("user_id", userId).eq("id", personId).maybeSingle();
  if (personResult.error) throw new Error(`load task person mapping: ${personResult.error.message}`);
  const niftyMemberId = personResult.data?.nifty_member_id as string | null | undefined;
  // Exact counts require every candidate row, so page through the table instead
  // of trusting a single capped request.
  const rows: Record<string, any>[] = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 20000; offset += pageSize) {
    const page = await ensureNoError(
      db().from("work_tasks")
        .select("*, project:work_projects(id,name,provider_project_id)")
        .eq("user_id", userId)
        .not("status", "in", "(archived,deleted)")
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("provider_created_at", { ascending: false })
        .range(offset, offset + pageSize - 1),
      "load person task backlog",
    );
    const batch = page ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  const parents = rows.filter((task) =>
    !task.parent_task_id && !task.parent_provider_task_id && isTaskAttributableToPerson(task, personId, niftyMemberId));
  const open = parents.filter((task) => task.completed !== true);
  return {
    tasks: open,
    counts: { total: parents.length, open: open.length, completed: parents.length - open.length },
  };
}

/** A stored estimate is whole minutes. Anything else is rejected rather than
 * rounded or cleared, so a typo cannot silently erase the estimate. */
export function effortMinutesPatch(value: unknown): number | null {
  // Absent and explicitly empty both mean "no estimate"; every other shape must
  // be a real number. Coercing whitespace, arrays, or booleans would store 0.
  if (value === null || value === undefined || value === "") return null;
  const minutes = typeof value === "number"
    ? value
    : typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(minutes)) {
    throw new WorkOsValidationError("estimated_effort_minutes must be a whole number of minutes");
  }
  if (minutes < 0) throw new WorkOsValidationError("estimated_effort_minutes must be a non-negative whole number");
  return minutes;
}

export async function updateTask(userId: string, taskId: string, patch: Json) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const row: Json = {};
  if ("name" in patch) row.title = nonEmptyString(patch.name) ?? task.title;
  if ("description" in patch) row.description = nonEmptyString(patch.description);
  for (const key of ["due_date", "start_date", "priority", "expected_outcome", "definition_of_done", "blocked_reason", "task_group_id", "effort_unit"]) {
    if (key in patch) row[key] = nonEmptyString(patch[key]);
  }
  if ("estimated_effort_minutes" in patch) row.estimated_effort_minutes = effortMinutesPatch(patch.estimated_effort_minutes);
  for (const key of ["labels", "story_points", "blocked"]) {
    if (key in patch) row[key] = patch[key];
  }
  if ("assignee_person_ids" in patch) {
    const people = await resolveActiveTaskPeople(task.organization_id as string, patch.assignee_person_ids);
    row.assignee_person_ids = people.map((person) => String(person.id));
  }
  if ("blocked" in patch) row.blocked = patch.blocked === true;
  if ("completed" in patch) {
    row.completed = patch.completed === true;
    row.status = row.completed ? "completed" : "open";
    row.completed_at = row.completed ? new Date().toISOString() : null;
  }
  return selectFirst(
    db().from("work_tasks").update({ ...row, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("id", task.id).select("*"),
    "update Work OS task",
  );
}

export async function completeTask(userId: string, taskId: string, completed = true) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  // Idempotent: re-completing an already-completed task must not move its
  // completion timestamp or emit a second day event.
  if (task.completed === completed) return task;
  return selectFirst(
    db().from("work_tasks").update({
      completed,
      status: completed ? "completed" : "open",
      completed_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("id", task.id).select("*"),
    "complete Work OS task",
  );
}

export async function archiveTask(userId: string, taskId: string) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Json : {};
  const archived = await selectFirst(
    db().from("work_tasks").update({
      status: "archived",
      raw: { ...raw, archived: true },
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("id", task.id).select("*"),
    "archive Work OS task",
  );
  await removePlanItemsForTombstonedTask(String(archived.id));
  return archived;
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Json : {};
  const deleted = await selectFirst(
    db().from("work_tasks").update({
      status: "deleted",
      raw: { ...raw, deleted: true, deleted_at: new Date().toISOString() },
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("id", task.id).select("*"),
    "tombstone Work OS task",
  );
  await removePlanItemsForTombstonedTask(String(deleted.id));
  return deleted;
}

/** Every subtask move passes the same shape and project checks, whether the row
 * is Work OS-native or mirrored from Nifty. One seam keeps the move and create
 * paths from drifting apart: a subtask must never silently change project.
 */
export function assertSubtaskMoveTarget(task: Record<string, any>, parent: Record<string, any>) {
  if (task.id === parent.id) throw new WorkOsValidationError("A task cannot be its own parent");
  if (!task.parent_task_id && !task.parent_provider_task_id) throw new WorkOsValidationError("Only subtasks can be moved to another task");
  if (parent.parent_task_id || parent.parent_provider_task_id) throw new WorkOsValidationError("Subtasks can only be moved beneath a top-level task");
  if (task.organization_id !== parent.organization_id) throw new WorkOsValidationError("Subtasks can only be moved between tasks in the same project");
  const taskLocal = task.provider === "local";
  const parentLocal = parent.provider === "local";
  if (taskLocal && parentLocal) {
    // Local rows carry no provider project, so the local project is the
    // boundary: moving across projects would re-home the subtask silently.
    if ((task.project_id ?? null) !== (parent.project_id ?? null)) {
      throw new WorkOsValidationError("Subtasks can only be moved between tasks in the same project");
    }
    return;
  }
  if (!taskLocal && parentLocal) throw new WorkOsValidationError("Nifty subtasks cannot be moved beneath a Work OS task");
  if (!taskLocal && !parentLocal) {
    if (task.provider_project_id !== parent.provider_project_id) throw new WorkOsValidationError("Subtasks can only be moved between tasks in the same Nifty project");
    return;
  }
  // A Work OS subtask may join a Nifty task only inside the same provider project.
  if (task.provider_project_id && parent.provider_project_id && task.provider_project_id !== parent.provider_project_id) {
    throw new WorkOsValidationError("Subtasks can only be moved between tasks in the same Nifty project");
  }
}

/** Employee-created subtasks hang from a top-level task only; deeper nesting
 * stays out of the employee surface, matching the move path's rule. */
export function assertTopLevelTaskParent(parent: Record<string, any>) {
  if (parent.parent_task_id || parent.parent_provider_task_id) throw new WorkOsValidationError("Subtasks can only be created beneath a top-level task");
}

export async function moveTaskToParent(userId: string, taskId: string, parentTaskId: string) {
  const [task, parent] = await Promise.all([
    getTaskByLocalOrProviderId(userId, taskId),
    getTaskByLocalOrProviderId(userId, parentTaskId),
  ]);
  assertSubtaskMoveTarget(task, parent);
  if (task.parent_task_id === parent.id || (parent.provider_task_id && task.parent_provider_task_id === parent.provider_task_id)) return task;
  return selectFirst(
    db().from("work_tasks").update({
      parent_task_id: parent.id,
      parent_provider_task_id: parent.provider_task_id ?? null,
      project_id: parent.project_id ?? task.project_id ?? null,
      provider_project_id: parent.provider_project_id ?? task.provider_project_id ?? null,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("id", task.id).select("*"),
    "move Work OS task beneath parent",
  );
}

export async function addTaskProgress(userId: string, taskId: string, body: Json) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const idempotencyKey = nonEmptyString(body.idempotency_key) ?? nonEmptyString(body.client_request_id);
  const personId = nonEmptyString(body.person_id);
  if (personId) {
    const person = await ensureNoError(
      db().from("work_people").select("id").eq("organization_id", task.organization_id).eq("id", personId).maybeSingle(),
      "validate task progress person",
    );
    if (!person) throw new Error("person must belong to the task organization");
  }
  if (idempotencyKey) {
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", task.organization_id).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "load idempotent task progress evidence",
    );
    if (existing) return existing;
  }
  const payload = {
    user_id: userId,
    organization_id: task.organization_id,
    task_id: task.id,
    person_id: personId,
    evidence_date: dateOnly(nonEmptyString(body.evidence_date)) ?? today(),
    source: body.source === "manual" ? "manual" : "agent",
    title: nonEmptyString(body.title) ?? `Progress: ${task.title}`,
    summary: nonEmptyString(body.summary) ?? "",
    url: nonEmptyString(body.url),
    metrics: typeof body.metrics === "object" && body.metrics ? body.metrics : {},
    idempotency_key: idempotencyKey,
    raw: { note: body, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) },
  };
  try {
    return await selectFirst(
      db().from("work_evidence").insert(payload).select("*"),
      "add task progress evidence",
    );
  } catch (error) {
    if (!idempotencyKey) throw error;
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", task.organization_id).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "reconcile idempotent task progress evidence",
    );
    if (existing) return existing;
    throw error;
  }
}

export async function getTaskByLocalOrProviderId(userId: string, taskId: string) {
  const localId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId);
  const row = await ensureNoError(
    db().from("work_tasks").select("*").eq("user_id", userId).eq(localId ? "id" : "provider_task_id", taskId).maybeSingle(),
    "load task",
  );
  if (!row) throw new WorkOsNotFoundError();
  return row as Json;
}
