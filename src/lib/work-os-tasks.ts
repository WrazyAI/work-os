import {
  assignNiftyTask,
  archiveNiftyTask,
  completeNiftyTask,
  createNiftyTask,
  deleteNiftyTask,
  ensureNiftyAccessToken,
  getNiftyTask,
  listNiftyTasks,
  NiftyHttpError,
  normalizeNiftyTaskPayload,
  updateNiftyTask,
  updateNiftyTaskField,
} from "@/lib/integrations/nifty";
import { attachTaskAssigneeIdentities } from "@/lib/work-os-task-assignees";
import { todayIso as today } from "@/lib/work-os-dates";
import {
  dateOnly,
  db,
  ensureNoError,
  nonEmptyString,
  niftyForOwner,
  selectFirst,
  type Json,
} from "@/lib/work-os-internal";
import { syncNifty, upsertNiftyTask } from "@/lib/work-os-nifty";
import { removePlanItemsForTombstonedTask } from "@/lib/work-os-plan-ghosts";

function structuredDescription(description: string | null, expectedOutcome: unknown, definitionOfDone: unknown) {
  const base = (description || "")
    .replace(/(?:^|\n)## Expected outcome\s*\n[\s\S]*?(?=\n## |$)/i, "")
    .replace(/(?:^|\n)## Definition of done\s*\n[\s\S]*?(?=\n## |$)/i, "")
    .trim();
  const outcome = nonEmptyString(expectedOutcome);
  const done = nonEmptyString(definitionOfDone);
  return [base, outcome ? `## Expected outcome\n${outcome}` : "", done ? `## Definition of done\n${done}` : ""].filter(Boolean).join("\n\n") || null;
}

async function applyMappedFields(userId: string, providerTaskId: string, values: Json) {
  const supabase = db();
  const { data: organization, error: organizationError } = await supabase.from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (organizationError) throw new Error(`load Nifty field organization: ${organizationError.message}`);
  if (!organization) return;
  const keys = Object.keys(values);
  if (!keys.length) return;
  const { data: mappings, error } = await supabase.from("work_provider_field_mappings").select("semantic_field,provider_field_id,config")
    .eq("organization_id", organization.id).eq("provider", "nifty").in("semantic_field", keys);
  if (error) throw new Error(`load Nifty field mappings: ${error.message}`);
  for (const mapping of mappings ?? []) {
    const config = (mapping.config ?? {}) as Json;
    const valueMap = (config.valueMap ?? config.value_map ?? {}) as Json;
    const raw = values[mapping.semantic_field];
    const mapped = typeof raw === "string" && raw in valueMap ? valueMap[raw] : raw;
    await niftyForOwner(userId, () => updateNiftyTaskField(providerTaskId, mapping.provider_field_id, mapped));
  }
}

async function mappedSemanticFields(userId: string, fields: string[]) {
  const { data: organization, error: organizationError } = await db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (organizationError) throw new Error(`load Nifty field organization: ${organizationError.message}`);
  if (!organization || !fields.length) return new Set<string>();
  const { data, error } = await db().from("work_provider_field_mappings").select("semantic_field")
    .eq("organization_id", organization.id).eq("provider", "nifty").in("semantic_field", fields);
  if (error) throw new Error(`load Nifty field mappings: ${error.message}`);
  return new Set((data ?? []).map((mapping: any) => mapping.semantic_field as string));
}

async function mirrorExtendedTaskFields(taskId: string, values: Json) {
  const patch: Json = { updated_at: new Date().toISOString() };
  for (const key of ["priority", "estimated_effort", "estimated_effort_minutes", "effort_unit", "expected_outcome", "definition_of_done", "dependency_task_ids", "blocked", "blocked_reason"]) {
    if (key in values) patch[key] = values[key];
  }
  if (Object.keys(patch).length === 1) return null;
  return selectFirst(db().from("work_tasks").update(patch).eq("id", taskId).select("*"), "mirror extended task fields");
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
  /** SQL-side attribution filters used to mirror Nifty creator/subscriber metadata. */
  rawCreatedBy?: string | null;
  rawSubscriber?: string | null;
  providerAssignee?: string | null;
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
 * Nifty assignee mapping, or Nifty creator/subscriber metadata. */
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
    .eq("user_id", userId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100) - 1);
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
  const sortDate = opts.sortDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.sortDate) ? opts.sortDate : today();
  const result = await db().rpc("work_list_person_tasks_sorted", {
    p_user_id: userId,
    p_person_id: personId,
    p_nifty_member_id: niftyMemberId ?? null,
    p_completed: completed,
    p_project_id: opts.projectId ?? null,
    p_order: opts.order ?? "due_desc",
    p_sort_date: sortDate,
    p_offset: opts.offset ?? 0,
    p_limit: opts.limit ?? 100,
  });
  if (result.error) throw new Error(`load sorted task history: ${result.error.message}`);
  return (result.data ?? []) as Record<string, any>[];
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
    return hydrateTaskAssignees(userId, selected.map((task) => {
      const childProgress = task.provider_task_id
        ? progress.get(String(task.provider_task_id)) ?? { total: 0, completed: 0 }
        : { total: 0, completed: 0 };
      return { ...task, subtask_total: childProgress.total, subtask_completed: childProgress.completed };
    }));
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
  const sortDate = opts.sortDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.sortDate) ? opts.sortDate : today();
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

type NormalizedNiftyTask = NonNullable<ReturnType<typeof normalizeNiftyTaskPayload>>;

// Assignees, mapped fields, and the mirror write are shared by fresh creates
// and by adoption of a task a previous attempt already created.
async function finalizeCreatedNiftyTask(userId: string, initial: NormalizedNiftyTask, body: Json) {
  const requestedAssignees = stringValues(body.assignees);
  if (requestedAssignees.length) {
    await niftyForOwner(userId, () => assignNiftyTask(initial.id, requestedAssignees));
  }
  await applyMappedFields(userId, initial.id, body);
  let normalized = initial;
  for (let attempt = 0; attempt < (requestedAssignees.length ? 6 : 1); attempt += 1) {
    normalized = normalizeNiftyTaskPayload(await niftyForOwner(userId, () => getNiftyTask(initial.id))) ?? normalized;
    if (requestedAssignees.every((assignee) => normalized.assignees.includes(assignee))) break;
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const missingAssignees = requestedAssignees.filter((assignee) => !normalized.assignees.includes(assignee));
  if (missingAssignees.length) throw new Error(`Nifty did not confirm ${missingAssignees.length} requested assignee${missingAssignees.length === 1 ? "" : "s"}`);
  const task = await upsertNiftyTask(userId, normalized) as Json;
  return await mirrorExtendedTaskFields(task.id as string, body) ?? task;
}

/** Extracts the provider status from the live class or a structurally identical
 * copy: tsx can instantiate one .ts module separately for ESM and CJS importers
 * (Node without require(esm)), so a cross-module instanceof check alone would
 * silently classify a real NiftyHttpError as uncertain. */
function niftyHttpStatus(error: unknown): number | null {
  if (error instanceof NiftyHttpError) return error.status;
  const candidate = error as { name?: unknown; status?: unknown } | null | undefined;
  return candidate?.name === "NiftyHttpError" && typeof candidate.status === "number" ? candidate.status : null;
}

/** True when a create failure is a definitive provider rejection: the request
 * was answered with HTTP 4xx, so Nifty cannot have created the task. Anything
 * else — timeout, network failure, 5xx, and 408 (the server gave up waiting but
 * may still have processed the request) — is uncertain and must never be
 * retried with another POST. */
export function providerCreateFailureDefinite(error: unknown): boolean {
  const status = niftyHttpStatus(error);
  return status !== null && status >= 400 && status < 500 && status !== 408;
}

export async function createTask(
  userId: string,
  body: Json,
  hooks?: {
    /** Runs after credentials are proven and immediately before the POST is
     * dispatched, so the caller can record a durable create intent. Throwing
     * here aborts before any provider request is attempted. */
    beforeProviderCreate?: () => Promise<void>;
    onProviderTaskCreated?: (providerTaskId: string) => Promise<void>;
  },
) {
  const name = nonEmptyString(body.name);
  const taskGroupId = nonEmptyString(body.task_group_id);
  if (!name) throw new Error("name is required");
  if (!taskGroupId) throw new Error("task_group_id is required for Nifty tasks");
  const payload: Json = { name, task_group_id: taskGroupId };
  for (const key of ["task_id", "project_id", "milestone_id", "due_date", "start_date", "assignees", "labels", "story_points", "priority", "dependencies"]) if (key in body) payload[key] = body[key];
  const structuredMappings = await mappedSemanticFields(userId, ["expected_outcome", "definition_of_done"]);
  payload.description = structuredDescription(
    nonEmptyString(body.description),
    structuredMappings.has("expected_outcome") ? null : body.expected_outcome,
    structuredMappings.has("definition_of_done") ? null : body.definition_of_done,
  );
  const result = await niftyForOwner(userId, async () => {
    // Prove credentials before the intent is recorded: a credential failure
    // cannot have created a provider task, so it must not look uncertain.
    if (hooks?.beforeProviderCreate) await ensureNiftyAccessToken();
    await hooks?.beforeProviderCreate?.();
    return createNiftyTask(payload);
  });
  const initial = normalizeNiftyTaskPayload(result);
  if (initial) {
    // Outbox anchor: persist the provider id before any further provider write
    // or mirror work, so a retry adopts this task instead of creating a second.
    // A throwing hook means the caller's lease was lost — aborting here keeps
    // this task unmapped, where the caller's marker search can still adopt it.
    if (hooks?.onProviderTaskCreated) await hooks.onProviderTaskCreated(initial.id);
    return finalizeCreatedNiftyTask(userId, initial, body);
  }
  if (hooks?.beforeProviderCreate) {
    // The POST was dispatched (or at least issued) but the response could not
    // be parsed, so the created task cannot be identified. Never finalize as
    // applied without the id: fail into the uncertain path, where a retry
    // adopts the task by marker instead of creating a second one.
    throw new Error("Nifty accepted the create but did not return the task; a retry will adopt it by marker.");
  }
  await syncNifty(userId);
  return { providerResult: result };
}

/** Completes a create whose provider task already exists — a previous attempt
 * created it but never recorded the id or mirrored it. Runs the same tail as
 * createTask so missing assignments and mapped fields are filled in. */
export async function adoptProviderTask(userId: string, providerTaskId: string, body: Json) {
  const initial = normalizeNiftyTaskPayload(await niftyForOwner(userId, () => getNiftyTask(providerTaskId)));
  if (!initial) throw new Error("The provider task could not be loaded for adoption");
  return finalizeCreatedNiftyTask(userId, initial, body);
}

/** Finds a provider task an interrupted attempt already created for this
 * proposal. The proposal id travels inside the task description marker, so a
 * crash between the Nifty POST and the id write is still recoverable. Only
 * called on retries; pages a bounded window because the list API's filters are
 * not guaranteed to be applied server-side. */
export async function findNiftyTaskByMarker(
  userId: string,
  marker: string,
  params?: { projectId?: string; taskGroupId?: string; maxPages?: number; retries?: number; retryDelayMs?: number },
) {
  const pageSize = 100;
  const maxPages = Math.max(1, params?.maxPages ?? 3);
  const attempts = Math.max(1, params?.retries ?? 1);
  const delayMs = Math.max(0, params?.retryDelayMs ?? 0);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (let page = 0; page < maxPages; page += 1) {
      const { tasks, hasMore } = await niftyForOwner(userId, () => listNiftyTasks({
        ...(params?.projectId ? { project_id: params.projectId } : {}),
        ...(params?.taskGroupId ? { task_group_id: params.taskGroupId } : {}),
        include_subtasks: "true",
        limit: String(pageSize),
        offset: String(page * pageSize),
      }));
      const found = tasks.find((task) => (task.description ?? "").includes(marker));
      if (found) return found;
      if (hasMore === false || tasks.length < pageSize) break;
    }
    // Provider listings can lag a just-created task; give the uncertain path a
    // bounded chance to see it before refusing to continue.
    if (attempt < attempts - 1 && delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

export async function updateTask(userId: string, taskId: string, patch: Json) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  if (task.provider === "local") {
    const row: Json = {};
    if ("name" in patch) row.title = nonEmptyString(patch.name) ?? task.title;
    if ("description" in patch) row.description = nonEmptyString(patch.description);
    for (const key of ["due_date", "start_date", "priority", "expected_outcome", "definition_of_done", "blocked_reason"]) {
      if (key in patch) row[key] = nonEmptyString(patch[key]);
    }
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
  const providerTaskId = task.provider_task_id as string;
  const allowed: Json = {};
  for (const key of ["name", "description", "milestone_id", "due_date", "start_date", "task_group_id", "assignees", "labels", "story_points", "priority", "dependencies"]) {
    if (key in patch) allowed[key] = patch[key];
  }
  if ("assignee_person_ids" in patch) {
    const people = await resolveActiveTaskPeople(task.organization_id as string, patch.assignee_person_ids);
    const providerIds = people.map((person) => nonEmptyString(person.nifty_member_id));
    if (providerIds.some((providerId) => !providerId)) throw new Error("Historical Nifty tasks require mapped Nifty assignees");
    allowed.assignees = providerIds;
  }
  if ("expected_outcome" in patch || "definition_of_done" in patch) {
    const structuredMappings = await mappedSemanticFields(userId, ["expected_outcome", "definition_of_done"]);
    allowed.description = structuredDescription(
      nonEmptyString(patch.description) ?? nonEmptyString(task.description),
      structuredMappings.has("expected_outcome") ? null : patch.expected_outcome ?? task.expected_outcome,
      structuredMappings.has("definition_of_done") ? null : patch.definition_of_done ?? task.definition_of_done,
    );
  }
  // Nifty's partial task update clears completion unless it is sent explicitly.
  if (Object.keys(allowed).length && !("completed" in allowed)) allowed.completed = task.completed === true;
  const result = Object.keys(allowed).length
    ? await niftyForOwner(userId, () => updateNiftyTask(providerTaskId, allowed))
    : null;
  await applyMappedFields(userId, providerTaskId, patch);
  const normalized = normalizeNiftyTaskPayload(result) ?? normalizeNiftyTaskPayload(await niftyForOwner(userId, () => getNiftyTask(providerTaskId)));
  if (normalized) {
    const mirrored = await upsertNiftyTask(userId, normalized) as Json;
    return await mirrorExtendedTaskFields(mirrored.id as string, patch) ?? mirrored;
  }
  return task;
}

export async function completeTask(userId: string, taskId: string, completed = true) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  if (task.provider === "local") {
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
  const providerTaskId = task.provider_task_id as string;
  const result = await niftyForOwner(userId, () => completeNiftyTask(providerTaskId, completed));
  const normalized = normalizeNiftyTaskPayload(result) ?? normalizeNiftyTaskPayload(await niftyForOwner(userId, () => getNiftyTask(providerTaskId)));
  if (normalized) {
    const mirrored = await upsertNiftyTask(userId, normalized) as Json;
    if (!completed) {
      return selectFirst(
        db().from("work_tasks").update({ completed_at: null, updated_at: new Date().toISOString() })
          .eq("user_id", userId).eq("id", mirrored.id as string).select("*"),
        "clear reopened task completion timestamp",
      );
    }
    return mirrored;
  }
  return selectFirst(
    db().from("work_tasks").update({
      completed,
      status: completed ? "completed" : "open",
      completed_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("id", task.id).select("*"),
    "mark task complete",
  );
}

export async function archiveTask(userId: string, taskId: string) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  if (task.provider === "local") {
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
  const providerTaskId = task.provider_task_id as string;
  await niftyForOwner(userId, () => archiveNiftyTask(providerTaskId, true));
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Json : {};
  const archived = await selectFirst(
    db().from("work_tasks").update({
      status: "archived",
      raw: { ...raw, archived: true },
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider_task_id", providerTaskId).select("*"),
    "archive task mirror",
  );
  // A tombstoned task can no longer back a plan item: mark its plan rows
  // removed so no workspace surface keeps rendering unhittable work.
  await removePlanItemsForTombstonedTask(String(archived.id));
  return archived;
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  if (task.provider === "local") {
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
  const providerTaskId = task.provider_task_id as string;
  await niftyForOwner(userId, () => deleteNiftyTask(providerTaskId));
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Json : {};
  const deleted = await selectFirst(
    db().from("work_tasks").update({
      status: "deleted",
      raw: { ...raw, deleted: true, deleted_at: new Date().toISOString() },
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider_task_id", providerTaskId).select("*"),
    "tombstone deleted task mirror",
  );
  await removePlanItemsForTombstonedTask(String(deleted.id));
  return deleted;
}

export async function moveTaskToParent(userId: string, taskId: string, parentTaskId: string) {
  const [task, parent] = await Promise.all([
    getTaskByLocalOrProviderId(userId, taskId),
    getTaskByLocalOrProviderId(userId, parentTaskId),
  ]);
  if (task.id === parent.id) throw new Error("A task cannot be its own parent");
  if (!task.parent_task_id && !task.parent_provider_task_id) throw new Error("Only subtasks can be moved to another task");
  if (parent.parent_task_id || parent.parent_provider_task_id) throw new Error("Subtasks can only be moved beneath a top-level task");
  if (task.organization_id !== parent.organization_id) throw new Error("Subtasks can only be moved between tasks in the same project");
  const localMove = task.provider === "local" || parent.provider === "local";
  if (localMove) {
    if (task.provider !== "local") throw new Error("Nifty subtasks cannot be moved beneath a Work OS task");
    if (task.provider === "local" && parent.provider === "nifty" && task.provider_project_id && parent.provider_project_id && task.provider_project_id !== parent.provider_project_id) {
      throw new Error("Subtasks can only be moved between tasks in the same Nifty project");
    }
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
  if (task.provider_project_id !== parent.provider_project_id) {
    throw new Error("Subtasks can only be moved between tasks in the same Nifty project");
  }
  const providerTaskId = task.provider_task_id as string;
  const providerParentId = parent.provider_task_id as string;
  if (task.parent_provider_task_id === providerParentId) return task;
  await niftyForOwner(userId, () => updateNiftyTask(providerTaskId, { task_id: providerParentId }));
  let providerConfirmed = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const children = await niftyForOwner(userId, () => listNiftyTasks({ task_id: providerParentId, include_subtasks: "true", limit: "100", offset: "0" }));
    if (children.tasks.some((candidate) => candidate.id === providerTaskId && candidate.parentTaskId === providerParentId)) {
      providerConfirmed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!providerConfirmed) throw new Error("Nifty did not confirm the subtask move");
  return selectFirst(
    db().from("work_tasks").update({
      parent_task_id: parent.id,
      parent_provider_task_id: providerParentId,
      provider_project_id: parent.provider_project_id,
      project_id: parent.project_id,
      milestone_id: parent.milestone_id,
      task_group_id: parent.task_group_id,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider_task_id", providerTaskId).select("*"),
    "move task beneath parent",
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
  if (!row) throw new Error("Task not found");
  return row as Json;
}
