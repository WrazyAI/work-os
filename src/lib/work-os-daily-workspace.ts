import { workOsOrganizationOwnerId, type WorkOsAccess } from "@/lib/work-os-api";
import { addDaysIso as addDays } from "@/lib/work-os-dates";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateOnly } from "@/lib/work-os-internal";
import { hydrateTaskAssignees, isNiftyTaskAttributableToMember } from "@/lib/work-os";
import { localDateForTimezone } from "@/modules/work-os/companion";
import { recordWorkMemory } from "@/lib/work-memory";

type Json = Record<string, any>;

/** The goal a surface should display: the AI-drafted summary when one exists,
 * falling back to the employee's typed intent. The raw intent stays exposed so
 * planners keep editing the original note and the AI-build fingerprint holds. */
export function dailyGoalDisplay(plan: { focus_summary?: unknown; freeform_intent?: unknown; goal_provenance?: unknown } | null | undefined) {
  const intent = typeof plan?.freeform_intent === "string" && plan.freeform_intent.trim() ? plan.freeform_intent : null;
  const draft = typeof plan?.focus_summary === "string" && plan.focus_summary.trim() ? plan.focus_summary : null;
  return {
    text: draft ?? intent,
    intent,
    provenance: typeof plan?.goal_provenance === "string" ? plan.goal_provenance : intent ? "employee" : null,
  };
}

export type TaskDayAttributionReason =
  | "due_date"
  | "surfaced"
  | "completed"
  | "creation_observed"
  | "carried"
  | "subtask_activity";

export interface DailyWorkspaceTaskRow extends Json {
  id: string;
  provider_task_id: string;
  title: string;
  completed: boolean;
  dayDisposition: "active" | "deferred";
  dayAttribution: {
    date: string;
    reason: TaskDayAttributionReason;
    eventId: string | null;
    exactAt: string | null;
    childTaskIds?: string[];
  };
  subtaskProgress: { completed: number; total: number; percentage: number };
  subtasks: Json[];
}

export interface DailyWorkspaceRecord {
  date: string;
  currentDate: string;
  readOnly: boolean;
  goal: { text: string | null; intent: string | null; provenance: string | null; suggestionTaskIds: string[]; revision: number | null };
  tasks: DailyWorkspaceTaskRow[];
  completed: number;
  total: number;
  overdueCount: number;
  commitmentCompleted: number;
  commitmentTotal: number;
  carryOverGroups: Array<{ key: string; label: string; tasks: Json[] }>;
  sessionQuality: { status: "none" | "valid" | "needs_correction" | "corrected"; message: string | null; sessionId: string | null; clockedInAt: string | null };
  cursor: { next: string | null };
}

export async function recordTaskDayEvent(
  access: WorkOsAccess,
  taskValue: Json,
  eventType: "surfaced" | "deferred" | "carried" | "completed" | "reopened" | "creation_observed",
  options: { idempotencyKey: string; exactAt?: string | null; localDate?: string; provenance?: "nifty_exact" | "provider_observed" | "employee_explicit"; metadata?: Json } ,
) {
  const context = await employeeContext(access);
  const providerTaskId = String(taskValue.provider_task_id ?? taskValue.id ?? "");
  let task = taskValue;
  if (!taskValue.organization_id || !taskValue.provider_task_id) {
    const result = await db().from("work_tasks").select("*").eq("organization_id", access.organizationId)
      .or(`id.eq.${providerTaskId},provider_task_id.eq.${providerTaskId}`).maybeSingle();
    if (result.error) throw new Error(`load task event target: ${result.error.message}`);
    if (!result.data) throw new Error("Task event target was not mirrored from Nifty");
    task = result.data;
  }
  const exactAt = options.exactAt ?? null;
  const localDate = options.localDate ?? (exactAt ? localDateForTimezone(new Date(exactAt), context.timezone) : context.currentDate);
  const observedAt = exactAt ?? new Date().toISOString();
  const { error } = await db().from("work_task_day_events").upsert({
    organization_id: access.organizationId,
    person_id: access.personId,
    task_id: task.id,
    provider: task.provider ?? "nifty",
    provider_task_id: task.provider_task_id,
    local_date: localDate,
    event_type: eventType,
    provenance: options.provenance ?? "employee_explicit",
    exact_at: exactAt,
    observed_at: observedAt,
    task_snapshot: { title: task.title, completed: task.completed, status: task.status, dueDate: task.due_date },
    metadata: options.metadata ?? {},
    idempotency_key: options.idempotencyKey,
  }, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error(`record task day event: ${error.message}`);
  if (options.provenance === "employee_explicit") {
    await recordWorkMemory(
      { organizationId: access.organizationId, personId: access.personId as string },
      {
        kind: "task_event",
        sourceTable: "work_task_day_events",
        sourceId: options.idempotencyKey,
        content: `${eventType}: ${String(task.title ?? "task")}`,
        summary: `${eventType} — ${String(task.title ?? "task")}`.slice(0, 160),
        metadata: { eventType, taskId: String(task.id), providerTaskId: String(task.provider_task_id ?? "") },
        localDate,
        occurredAt: observedAt,
      },
    );
  }
}

const db = () => createAdminClient();
const dateOf = (value: unknown) => dateOnly(value);

function cursorValue(row: DailyWorkspaceTaskRow) {
  const createdAt = Date.parse(String(row.provider_created_at ?? row.created_at ?? ""));
  return `${String(Number.isFinite(createdAt) ? createdAt : 0).padStart(16, "0")}|${row.id}`;
}

export function encodeWorkspaceCursor(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeWorkspaceCursor(value: string | null | undefined) {
  if (!value) return null;
  try { return Buffer.from(value, "base64url").toString("utf8"); }
  catch { return null; }
}

export function resolveTaskDayAttribution(task: Json, events: Json[], date: string) {
  const byType = (eventType: string) => events.find((event) => event.event_type === eventType);
  if (dateOf(task.due_date) === date) return { reason: "due_date" as const, event: null };
  const surfaced = byType("surfaced");
  if (surfaced) return { reason: "surfaced" as const, event: surfaced };
  const completed = byType("completed");
  if (completed) return { reason: "completed" as const, event: completed };
  if (dateOf(task.provider_created_at) === date) return { reason: "creation_observed" as const, event: byType("creation_observed") ?? null };
  const carried = byType("carried");
  if (carried) return { reason: "carried" as const, event: carried };
  return null;
}

export async function employeeContext(access: WorkOsAccess, at = new Date()) {
  if (!access.personId) throw new Error("Work OS employee profile is required for the daily workspace");
  const { data, error } = await db().from("work_people").select("nifty_member_id")
    .eq("organization_id", access.organizationId).eq("id", access.personId).single();
  if (error) throw new Error(`load daily workspace employee: ${error.message}`);
  const onboarding = await db().from("work_employee_onboarding").select("timezone")
    .eq("organization_id", access.organizationId).eq("person_id", access.personId as string).maybeSingle();
  if (onboarding.error) throw new Error(`load daily workspace timezone: ${onboarding.error.message}`);
  const timezone = typeof onboarding.data?.timezone === "string" && onboarding.data.timezone ? onboarding.data.timezone : "UTC";
  return { niftyMemberId: data.nifty_member_id as string | null, timezone, currentDate: localDateForTimezone(at, timezone) };
}

/**
 * Pure per-day projection shared by `resolveDailyWorkspace` (single day) and
 * personal insights (many days). Both callers preload the same queries; this
 * function owns the attribution semantics so the two paths cannot drift.
 */
export function projectWorkspaceDay(input: {
  date: string;
  currentDate: string;
  allTasks: Json[];
  attributable: Json[];
  events: Json[];
  plan: Json | null;
  session: Json | null;
}): {
  goal: DailyWorkspaceRecord["goal"];
  tasks: DailyWorkspaceTaskRow[];
  completed: number;
  total: number;
  overdueCount: number;
  commitmentCompleted: number;
  commitmentTotal: number;
  carryOverGroups: DailyWorkspaceRecord["carryOverGroups"];
  sessionQuality: DailyWorkspaceRecord["sessionQuality"];
} {
  const { date, allTasks, attributable, events, plan, session } = input;
  const eventsByTask = new Map<string, Json[]>();
  for (const event of events) {
    const list = eventsByTask.get(String(event.task_id)) ?? [];
    list.push(event);
    eventsByTask.set(String(event.task_id), list);
  }

  const childrenByParent = new Map<string, Json[]>();
  const planItemsByTaskId = new Map<string, Json>();
  for (const item of Array.isArray(plan?.items) ? plan.items as Json[] : []) {
    if (item.task_id && item.disposition !== "removed") planItemsByTaskId.set(String(item.task_id), item);
  }
  const parents = attributable.filter((task) => !task.parent_task_id && !task.parent_provider_task_id);
  for (const child of attributable.filter((task) => task.parent_task_id || task.parent_provider_task_id)) {
    const key = String(child.parent_task_id ?? allTasks.find((task) => task.provider_task_id === child.parent_provider_task_id)?.id ?? "");
    if (!key) continue;
    const list = childrenByParent.get(key) ?? [];
    list.push(child);
    childrenByParent.set(key, list);
  }

  const resolved: DailyWorkspaceTaskRow[] = [];
  for (const parent of parents) {
    const children = childrenByParent.get(String(parent.id)) ?? [];
    const planItem = planItemsByTaskId.get(String(parent.id)) ?? planItemsByTaskId.get(String(parent.provider_task_id));
    let attribution: { reason: TaskDayAttributionReason; event: Json | null } | null = resolveTaskDayAttribution(parent, eventsByTask.get(String(parent.id)) ?? [], date);
    let childTaskIds: string[] = [];
    if (!attribution) {
      const matchedChildren = children.filter((child) => resolveTaskDayAttribution(child, eventsByTask.get(String(child.id)) ?? [], date));
      if (matchedChildren.length) {
        attribution = { reason: "subtask_activity", event: null };
        childTaskIds = matchedChildren.map((child) => String(child.id));
      }
    }
    // A saved daily plan is an explicit record that the task belonged to this
    // workday, including days before task-event capture was introduced.
    if (!attribution && planItem) attribution = { reason: "surfaced", event: null };
    if (!attribution) continue;
    const completedChildren = children.filter((child) => child.completed === true).length;
    const event = attribution.event;
    const dispositionEvent = (eventsByTask.get(String(parent.id)) ?? [])
      .filter((item) => item.event_type === "surfaced" || item.event_type === "deferred").at(-1);
    const historicalCompleted = planItem?.completion_state === "completed"
      ? true
      : planItem?.completion_state === "open"
        ? false
        : typeof event?.task_snapshot?.completed === "boolean" ? event.task_snapshot.completed : parent.completed === true;
    resolved.push({
      ...parent,
      completed: historicalCompleted,
      dayDisposition: dispositionEvent?.event_type === "deferred" ? "deferred" : "active",
      dayAttribution: {
        date,
        reason: attribution.reason,
        eventId: event ? String(event.id) : null,
        exactAt: event?.exact_at ?? null,
        ...(childTaskIds.length ? { childTaskIds } : {}),
      },
      subtaskProgress: {
        completed: completedChildren,
        total: children.length,
        percentage: children.length ? Math.round((completedChildren / children.length) * 100) : parent.completed ? 100 : 0,
      },
      subtasks: children.sort((left, right) => Number(left.completed) - Number(right.completed)
        || String(left.provider_created_at ?? left.created_at).localeCompare(String(right.provider_created_at ?? right.created_at))),
    } as DailyWorkspaceTaskRow);
  }
  resolved.sort((left, right) => cursorValue(right).localeCompare(cursorValue(left)));

  const overdue = parents.filter((task) => task.completed !== true && dateOf(task.due_date) !== null && dateOf(task.due_date)! < date);
  const yesterday = addDays(date, -1);
  const carryMap = new Map<string, { label: string; tasks: Json[] }>();
  for (const task of overdue) {
    const due = dateOf(task.due_date)!;
    const key = due === yesterday ? "yesterday" : due >= addDays(date, -7) ? due : "older";
    const label = key === "yesterday" ? "Yesterday" : key === "older" ? "Older" : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));
    const group = carryMap.get(key) ?? { label, tasks: [] };
    group.tasks.push({ ...task, carryReason: `Overdue since ${due}` });
    carryMap.set(key, group);
  }
  const carryOverGroups = [...carryMap.entries()]
    .sort(([left], [right]) => left === "yesterday" ? -1 : right === "yesterday" ? 1 : left === "older" ? 1 : right === "older" ? -1 : right.localeCompare(left))
    .map(([key, group]) => ({ key, ...group }));

  const committed = resolved.filter((task) => task.dayDisposition !== "deferred");
  const sessionStatus = !session ? "none" : session.correction_status === "needs_correction"
    ? "needs_correction" : session.correction_status === "corrected" ? "corrected" : "valid";
  return {
    goal: {
      ...dailyGoalDisplay(plan),
      suggestionTaskIds: Array.isArray(plan?.suggestion_task_ids) ? plan.suggestion_task_ids : [],
      revision: typeof plan?.revision === "number" ? plan.revision : null,
    },
    tasks: resolved,
    completed: resolved.filter((task) => task.completed === true).length,
    total: resolved.length,
    overdueCount: overdue.length,
    commitmentCompleted: committed.filter((task) => task.completed === true).length,
    commitmentTotal: committed.length,
    carryOverGroups,
    sessionQuality: {
      status: sessionStatus,
      message: sessionStatus === "needs_correction" ? String(session?.correction_reason ?? "Session needs correction.") : null,
      sessionId: session?.id ? String(session.id) : null,
      clockedInAt: session?.clocked_in_at ?? null,
    },
  };
}

export async function resolveDailyWorkspace(
  access: WorkOsAccess,
  requestedDate?: string | null,
  options: { cursor?: string | null; limit?: number; now?: Date } = {},
): Promise<DailyWorkspaceRecord> {
  const now = options.now ?? new Date();
  const context = await employeeContext(access, now);
  const date = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : context.currentDate;
  const ownerId = workOsOrganizationOwnerId(access);
  const [tasksResult, eventsResult, planResult, sessionResult] = await Promise.all([
    db().from("work_tasks")
      .select("*,project:work_projects(id,name,provider_project_id)")
      .eq("user_id", ownerId)
      .eq("organization_id", access.organizationId)
      .not("status", "in", "(archived,deleted)")
      .order("provider_created_at", { ascending: true, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(2500),
    db().from("work_task_day_events").select("*")
      .eq("organization_id", access.organizationId).eq("local_date", date)
      .order("observed_at", { ascending: true }).order("id", { ascending: true }),
    db().from("work_daily_plans").select("id,freeform_intent,focus_summary,goal_provenance,suggestion_task_ids,revision,status,items:work_daily_plan_items(task_id,completion_state,disposition)")
      .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
      .eq("shift_date", date).maybeSingle(),
    db().from("work_sessions").select("id,state,clocked_in_at,clocked_out_at,correction_status,correction_reason")
      .eq("organization_id", access.organizationId).eq("person_id", access.personId as string)
      .eq("shift_date", date).maybeSingle(),
  ]);
  for (const [label, result] of [["tasks", tasksResult], ["events", eventsResult], ["goal", planResult], ["session", sessionResult]] as const) {
    if (result.error) throw new Error(`load daily workspace ${label}: ${result.error.message}`);
  }

  const allTasks = await hydrateTaskAssignees(ownerId, (tasksResult.data ?? []) as Json[]) as Json[];
  const attributable = allTasks.filter((task) =>
    (Array.isArray(task.assignee_person_ids) && task.assignee_person_ids.includes(access.personId))
    || isNiftyTaskAttributableToMember(task, context.niftyMemberId)
  );
  const attributableIds = new Set(attributable.map((task) => String(task.id)));
  const events = (eventsResult.data ?? []).filter((event: any) =>
    event.person_id === access.personId || attributableIds.has(String(event.task_id))
  ) as Json[];
  const projected = projectWorkspaceDay({
    date,
    currentDate: context.currentDate,
    allTasks,
    attributable,
    events,
    plan: (planResult.data as Json | null) ?? null,
    session: (sessionResult.data as Json | null) ?? null,
  });

  const after = decodeWorkspaceCursor(options.cursor);
  const afterFiltered = after ? projected.tasks.filter((row) => cursorValue(row) < after) : projected.tasks;
  const limit = Math.min(100, Math.max(1, options.limit ?? 50));
  const page = afterFiltered.slice(0, limit);
  const next = afterFiltered.length > page.length && page.length
    ? encodeWorkspaceCursor(cursorValue(page[page.length - 1]))
    : null;

  return {
    date,
    currentDate: context.currentDate,
    readOnly: date !== context.currentDate,
    ...projected,
    tasks: page,
    cursor: { next },
  };
}
