import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, ArrowUp, CalendarDays, Check, ChevronsUpDown, Clock3, ListChecks, Pencil, Plus, Search, Trash2, UserRound } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import {
  adminKeys,
  ADMIN_STALE_MS,
  attachAdminAssigneeNames,
  type AdminTaskRow,
  completeAdminTask,
  createAdminTask,
  deleteAdminTask,
  fetchAdminTaskDetails,
  fetchAdminTasks,
  fetchPeople,
  fetchProjects,
  normalizeAdminTaskDetails,
  normalizeAdminTaskList,
  normalizePeople,
  normalizeProjects,
  relativeTime,
  shortDate,
  statusLabel,
  todayIso,
  updateAdminTask,
} from "./data";
import { formatWorkOsFullDate } from "../dateFormat";
import {
  adminTaskDates,
  adminTaskStatusRank,
  compareAdminTaskDefaultOrder,
} from "../../../../src/modules/work-os/admin-task-model";
import { OverflowPanText } from "../OverflowPan";
import { displayTaskState, hasTaskMenu, taskStatusLabel, taskStatusOptions } from "../taskActions";
import { EllipsisMenu, TaskActionMenuItems, toggleAssigneeIds } from "../taskSurfaces";
import { isCalendarDate, type TaskCapabilities } from "../../../../src/lib/work-os-task-permissions";
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, CheckField, Drawer, Notice, Pill, Segmented, SelectField, Skeleton, TextField } from "./ui";

type TaskFilter = "open" | "completed" | "all";

/* --- Task ordering ------------------------------------------------------
 * The organization task record opens newest-created first — the created date
 * the row shows, provider stamp first — with the most recently updated row as
 * the tiebreak, then the effective due date, so the default order always
 * matches the Created column the operator reads even when every updated
 * timestamp ties or is absent. Every labeled column sorts the fetched list in
 * place: the first activation applies the column's natural direction, a
 * second activation reverses it, and another column starts its own natural
 * order. Missing values stay last in both directions, and ties fall back to
 * title A→Z then id so equal keys never jitter. Status ranks by attention
 * (Overdue → Pending/In progress → Done) exactly as the pill reads the recorded
 * completion flag and the derived due date; a row whose record states no flag
 * claims no rank and stays last. Pure functions, exported for the comparator
 * tests (design.md §16.2 sortable tables). */

export type TaskSortKey = "task" | "assignees" | "created" | "due" | "status";
export type TaskSortDirection = "asc" | "desc";
export interface TaskSortState {
  key: TaskSortKey;
  direction: TaskSortDirection;
}

export const TASK_SORT_COLUMNS: ReadonlyArray<{
  key: TaskSortKey;
  label: string;
  firstDirection: TaskSortDirection;
  directions: Record<TaskSortDirection, string>;
}> = [
  { key: "task", label: "Task", firstDirection: "asc", directions: { asc: "A to Z", desc: "Z to A" } },
  { key: "assignees", label: "Assignees", firstDirection: "asc", directions: { asc: "A to Z", desc: "Z to A" } },
  { key: "created", label: "Created", firstDirection: "desc", directions: { asc: "oldest first", desc: "newest first" } },
  { key: "due", label: "Due", firstDirection: "asc", directions: { asc: "earliest first", desc: "latest first" } },
  { key: "status", label: "Status", firstDirection: "asc", directions: { asc: "overdue first", desc: "done first" } },
];

function trimmedText(value: unknown) {
  return String(value ?? "").trim();
}

/** The created date the row states: the provider's own creation stamp first,
 * then the local record. Both shapes keep their recorded calendar day instead
 * of shifting with the viewer's timezone. */
export function taskCreatedDate(task: AdminTaskRow): string | null {
  return adminTaskDates(task).createdDate;
}

/** The row's effective due date: the recorded due date when the task has one,
 * otherwise one day after it was created (design.md §16.2). The derived value
 * is the due date everywhere the row is read — the Due cell, the overdue
 * warning and the Overdue/Open/Done pill, and the Due column's sorting —
 * exactly as if it were recorded, and it renders plainly with no "default"
 * marker. Only a task whose created date is also missing has no effective due
 * date and keeps the dash. */
export function taskEffectiveDueDate(task: AdminTaskRow): string | null {
  return adminTaskDates(task).effectiveDueDate;
}

function taskLabel(task: AdminTaskRow): string | null {
  return trimmedText(task.title ?? task.name) || null;
}

/** The joined assignee names the cell renders; an empty or missing embed, or
 * the cell's own "Unassigned" fallback, is a missing value. */
function assigneeLabel(task: AdminTaskRow): string | null {
  if (!Array.isArray(task.assignees)) return null;
  const names = task.assignees.map((assignee) => trimmedText(assignee?.displayName)).filter(Boolean);
  if (!names.length) return null;
  const joined = names.join(", ");
  return joined.toLowerCase() === "unassigned" ? null : joined;
}

function dayValue(value: unknown): number | null {
  const text = trimmedText(value);
  if (!text) return null;
  const parsed = Date.parse(text.length === 10 ? `${text}T00:00:00Z` : text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 0 = Overdue, 1 = Pending or In progress, 2 = Done — the same predicate the
 * pill renders from the recorded completion flag, reading the row's effective
 * due date (the created + 1 day default included); a row whose record states no
 * flag has no rank and sorts last in both directions (the pill's Pending is a
 * display default only). */
function statusRank(task: AdminTaskRow, today: string): number | null {
  return adminTaskStatusRank(task, today);
}

function compareText(a: string, b: string) {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Missing values sort last whichever direction is active; direction only
 * flips the comparison between two present values. */
function compareNullable<T>(a: T | null, b: T | null, direction: 1 | -1, compare: (left: T, right: T) => number) {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return direction * compare(a, b);
}

function compareTiebreak(a: AdminTaskRow, b: AdminTaskRow) {
  return compareNullable(taskLabel(a), taskLabel(b), 1, compareText)
    || compareNullable(trimmedText(a.id) || null, trimmedText(b.id) || null, 1, compareText);
}

/** `sort` null keeps the record's default order: newest created first (the
 * provider stamp, then the local record — the same date the row shows),
 * most recently updated as the tiebreak, then the effective due date; missing
 * values stay last in every step. `today` is the caller's workday for the
 * Status ranks. Created and Due read the date helpers above, so a derived due
 * date orders exactly like a recorded one. */
export function compareAdminTasks(a: AdminTaskRow, b: AdminTaskRow, sort: TaskSortState | null, today = todayIso()) {
  const numeric = (left: number, right: number) => left - right;
  if (!sort) return compareAdminTaskDefaultOrder(a, b);
  const direction: 1 | -1 = sort.direction === "desc" ? -1 : 1;
  const primary = sort.key === "task"
    ? compareNullable(taskLabel(a), taskLabel(b), direction, compareText)
    : sort.key === "assignees"
      ? compareNullable(assigneeLabel(a), assigneeLabel(b), direction, compareText)
      : sort.key === "created"
        ? compareNullable(dayValue(taskCreatedDate(a)), dayValue(taskCreatedDate(b)), direction, numeric)
        : sort.key === "due"
          ? compareNullable(dayValue(taskEffectiveDueDate(a)), dayValue(taskEffectiveDueDate(b)), direction, numeric)
          : compareNullable(statusRank(a, today), statusRank(b, today), direction, numeric);
  return primary || compareTiebreak(a, b);
}

export function sortTaskRows(rows: AdminTaskRow[], sort: TaskSortState | null, today = todayIso()) {
  return [...rows].sort((a, b) => compareAdminTasks(a, b, sort, today));
}

/** First activation applies the column's natural direction and a second
 * reverses it; another column starts its own natural order. */
export function nextTaskSort(current: TaskSortState | null, key: TaskSortKey): TaskSortState {
  if (current?.key === key) return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  return { key, direction: TASK_SORT_COLUMNS.find((column) => column.key === key)?.firstDirection ?? "asc" };
}

/** The table head: every labeled column is one real button, the sorted
 * column's th carries aria-sort, and the indicator slot is always present so
 * the header never shifts when the sort changes. The empty actions column
 * stays non-sortable. */
export function TaskTableHead({ sort, onSort }: { sort: TaskSortState | null; onSort: (key: TaskSortKey) => void }) {
  return (
    <thead>
      <tr>
        {TASK_SORT_COLUMNS.map((column) => {
          const direction: TaskSortDirection | null = sort && sort.key === column.key ? sort.direction : null;
          const next: TaskSortDirection = direction === "asc" ? "desc" : direction === "desc" ? "asc" : column.firstDirection;
          const accessible = direction
            ? `${column.label}, sorted ${column.directions[direction]}. Activate to sort ${column.directions[next]}.`
            : `Sort by ${column.label}, ${column.directions[next]}.`;
          const Indicator = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
          return (
            <th
              key={column.key}
              scope="col"
              className="admin-sort-head"
              aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined}
            >
              <button
                type="button"
                className={direction ? "admin-sort-button is-active" : "admin-sort-button"}
                aria-label={accessible}
                title={accessible}
                onClick={() => onSort(column.key)}
              >
                <span>{column.label}</span>
                <span className="admin-sort-icon" aria-hidden="true">
                  <Indicator size={13} className={direction ? undefined : "admin-sort-idle"} />
                </span>
              </button>
            </th>
          );
        })}
        <th scope="col" />
      </tr>
    </thead>
  );
}

/** The priority vocabulary the record already stores. */
const PRIORITY_OPTIONS = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

/** The ids the record assigns; the identity embed is the fallback for a payload
 *  that predates `assignee_person_ids`. */
function taskAssigneeIds(task: AdminTaskRow): string[] {
  const ids = Array.isArray(task.assignee_person_ids)
    ? task.assignee_person_ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length) return ids;
  return Array.isArray(task.assignees)
    ? task.assignees.map((person) => (typeof person?.personId === "string" ? person.personId : "")).filter(Boolean)
    : [];
}

function taskTitle(task: AdminTaskRow | null | undefined, fallback = "Task") {
  return trimmedText(task?.title ?? task?.name) || fallback;
}

/** The date editor's seed: only a real calendar-day prefix opens populated. */
function taskDueDateSeed(value: unknown) {
  const day = trimmedText(value).slice(0, 10);
  return isCalendarDate(day) ? day : "";
}

/** The stored manual status, which is also the status option that is already
 *  active — changing to it would be a no-op write. */
function currentWorkflowStatus(task: AdminTaskRow): "pending" | "in_progress" {
  return task.workflow_status === "in_progress" ? "in_progress" : "pending";
}

export interface AdminTaskEditForm {
  name: string;
  description: string;
  dueDate: string;
  priority: string;
  assignee: string;
}

/** The edit drawer's PATCH body. Assignment is written only when the selection
 *  actually changed, and only for a task with at most one assignee: a
 *  multi-assignee set is managed by the drawer's checkbox list, so a title-only
 *  save can never truncate it or re-stamp the assigner. The due date is the
 *  recorded value the editor seeded — never the derived display default. */
export function adminTaskEditPatch(task: AdminTaskRow, form: AdminTaskEditForm): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    due_date: form.dueDate || null,
    priority: form.priority || null,
  };
  const current = taskAssigneeIds(task);
  if (current.length <= 1 && form.assignee !== (current[0] ?? "")) {
    patch.assignee_person_ids = form.assignee ? [form.assignee] : [];
  }
  return patch;
}

/** Tone for the four-state pill: Overdue always reads as attention, and Done
 *  keeps the settled green. */
function taskStateTone(state: "pending" | "in_progress" | "overdue" | "complete"): "ok" | "err" | "info" | "neutral" {
  if (state === "complete") return "ok";
  if (state === "overdue") return "err";
  if (state === "in_progress") return "info";
  return "neutral";
}

/** The one status record this surface reads. The effective due date — recorded,
 *  else one day after creation (design.md §16.2) — is the date the row, the row
 *  menu, and the drawer all judge, and the capability lock follows it so those
 *  three can never disagree. The source row keeps its real `due_date`, so an
 *  editor never writes the derived default back as a recorded date. */
export function adminTaskStatusRecord(task: AdminTaskRow, today: string): AdminTaskRow {
  const effectiveDue = taskEffectiveDueDate(task);
  const overdue = task.completed !== true && !!effectiveDue && effectiveDue < today;
  return {
    ...task,
    due_date: effectiveDue ?? task.due_date ?? null,
    capabilities: task.capabilities
      ? { ...task.capabilities, overdue, statusLocked: overdue || task.capabilities.statusLocked === true }
      : undefined,
  };
}

/** The row menu body. Exported so the render test can assert the exact
 *  vocabulary the page wires without a portal; a row renders it inside the
 *  anchored, keyboard-reachable `EllipsisMenu`. */
export function AdminTaskMenuItems({ task, today, busy, onStatus, onComplete, onEdit, onAssign, onArchive, onDelete, onClose }: {
  task: AdminTaskRow;
  today: string;
  busy: boolean;
  onStatus: (status: "pending" | "in_progress") => void;
  onComplete: (completed: boolean) => void;
  onEdit: () => void;
  onAssign?: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return <TaskActionMenuItems
    task={task}
    currentDate={today}
    busy={busy}
    onStatus={onStatus}
    onComplete={onComplete}
    onEdit={onEdit}
    onAssign={onAssign}
    onArchive={onArchive}
    onDelete={onDelete}
    onClose={onClose}
  />;
}

/** The organization task record: bounded filters, the flat list, and a drawer
 * that opens one task's detail with its subtasks. */
export default function TasksPage({ initialTaskId }: { initialTaskId?: string }) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [personId, setPersonId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TaskSortState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(initialTaskId ?? null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", assignee: "", dueDate: "", priority: "" });
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [editTask, setEditTask] = useState<AdminTaskRow | null>(null);
  const [editForm, setEditForm] = useState<AdminTaskEditForm>({ name: "", description: "", dueDate: "", priority: "", assignee: "" });
  const [assigneeDraft, setAssigneeDraft] = useState<{ taskId: string; ids: string[] } | null>(null);
  const [confirm, setConfirm] = useState<{ task: AdminTaskRow; mode: "archive" | "delete" } | null>(null);

  const people = useQuery({ queryKey: adminKeys.people(), queryFn: fetchPeople, select: normalizePeople, staleTime: ADMIN_STALE_MS });
  const projects = useQuery({ queryKey: adminKeys.projects(), queryFn: fetchProjects, select: normalizeProjects, staleTime: ADMIN_STALE_MS });
  const completedParam = filter === "open" ? "false" : filter === "completed" ? "true" : "";
  // The stated day drives both the server's exact overdue count and the rows'
  // effective-due status, so the summary and the pills cannot disagree.
  const today = todayIso();
  const taskFilters: Record<string, string> = { filter, personId, projectId, limit: "200", completed: completedParam, date: today };
  const tasks = useQuery({
    queryKey: adminKeys.tasks(taskFilters),
    queryFn: () => fetchAdminTasks(taskFilters),
    select: normalizeAdminTaskList,
    staleTime: 30_000,
  });
  const detail = useQuery({
    queryKey: adminKeys.taskDetails(selectedId ?? ""),
    queryFn: () => fetchAdminTaskDetails(selectedId!),
    select: normalizeAdminTaskDetails,
    enabled: !!selectedId,
    staleTime: 30_000,
  });
  /** Every task mutation invalidates the record and the one open detail: both
   *  carry the same task, its status, and its capabilities. */
  const refreshTask = (taskId?: string | null) => {
    void queryClient.invalidateQueries({ queryKey: ["work-os", "admin", "tasks"] });
    if (taskId) void queryClient.invalidateQueries({ queryKey: adminKeys.taskDetails(taskId) });
  };
  const rowTitle = (taskId: string) => {
    const row = (tasks.data?.tasks ?? []).find((entry) => String(entry.id) === taskId);
    const open = detail.data?.task;
    return taskTitle(row ?? (String(open?.id) === taskId ? open : null), "The task");
  };
  const complete = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => completeAdminTask(id, completed),
    onSuccess: (result, variables) => {
      refreshTask(variables.id);
      const title = String(result?.task?.title ?? result?.task?.name ?? rowTitle(variables.id));
      notifications.success(`“${title}” was ${variables.completed ? "marked complete" : "reopened"}.`, variables.completed ? "Task completed" : "Task reopened");
    },
  });
  const statusChange = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "pending" | "in_progress" }) =>
      updateAdminTask(id, { workflow_status: status }),
    onSuccess: (_result, variables) => {
      refreshTask(variables.id);
      const title = rowTitle(variables.id);
      notifications.success(`“${title}” is now ${variables.status === "in_progress" ? "In progress" : "Pending"}.`, "Task status updated");
    },
  });
  const assigneeChange = useMutation({
    mutationFn: ({ id, personIds }: { id: string; personIds: string[] }) =>
      updateAdminTask(id, { assignee_person_ids: personIds }),
    onSuccess: (_result, variables) => {
      refreshTask(variables.id);
      setAssigneeDraft(null);
      const title = rowTitle(variables.id);
      const count = variables.personIds.length;
      notifications.success(
        count ? `“${title}” is assigned to ${count === 1 ? "1 person" : `${count} people`}.` : `“${title}” is unassigned.`,
        "Task assignment updated",
      );
    },
  });
  /** The archive/delete request runs only after the operator confirms in the
   *  drawer; archiving is reversible and says so. */
  const removeTask = useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: "archive" | "delete" }) => deleteAdminTask(id, mode),
    onSuccess: (result, variables) => {
      refreshTask(variables.id);
      setConfirm(null);
      setMenuTaskId(null);
      setAssigneeDraft(null);
      setSelectedId((current) => (current === variables.id ? null : current));
      setEditTask((current) => (String(current?.id) === variables.id ? null : current));
      const title = String(result?.task?.title ?? result?.task?.name ?? rowTitle(variables.id));
      notifications.success(
        variables.mode === "delete" ? `“${title}” was permanently deleted.` : `“${title}” was archived. It can be restored from the record.`,
        variables.mode === "delete" ? "Task deleted" : "Task archived",
      );
    },
  });
  const saveEdit = useMutation({
    mutationFn: (task: AdminTaskRow) => updateAdminTask(String(task.id), adminTaskEditPatch(task, editForm)),
    onSuccess: (result, task) => {
      refreshTask(String(task.id));
      setEditTask(null);
      notifications.success(`“${String(result?.task?.title ?? result?.task?.name ?? taskTitle(task))}” was updated.`, "Task updated");
    },
  });
  const create = useMutation({
    mutationFn: () => createAdminTask({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      // Administration creates work in the one project that owns it; the
      // picker is gone because a second project choice is noise, not a decision.
      project_id: tasksProjectIdValue,
      assignee_person_ids: form.assignee ? [form.assignee] : [],
      due_date: form.dueDate || undefined,
      priority: form.priority || undefined,
    }),
    onSuccess: (result) => {
      setCreateOpen(false);
      setForm({ name: "", description: "", assignee: "", dueDate: "", priority: "" });
      refreshTask();
      const submitted = result?.task?.title ?? result?.task?.name;
      const title = String(submitted ?? (form.name.trim() || "The task"));
      notifications.success(`“${title}” was added to the organization task record.`, "Task created");
    },
  });

  /** Seed the editor from the record the operator acted on (row or drawer). A
   *  multi-assignee task seeds no selection: its set is managed in the drawer,
   *  so the editor never truncates it. */
  const openEdit = (task: AdminTaskRow) => {
    setMenuTaskId(null);
    const assignees = taskAssigneeIds(task);
    setEditForm({
      name: taskTitle(task, ""),
      description: trimmedText(task.description),
      dueDate: taskDueDateSeed(task.due_date),
      priority: trimmedText(task.priority),
      assignee: assignees.length === 1 ? assignees[0]! : "",
    });
    setEditTask(task);
  };

  /** A removal waits in the confirmation drawer; a second press while the
   *  request is in flight never opens another confirmation or a second write. */
  const requestRemoval = (task: AdminTaskRow, mode: "archive" | "delete") => {
    if (removeTask.isPending) return;
    setConfirm({ task, mode });
  };

  const roster = people.data?.people ?? [];
  // Assignment options exclude deactivated people. The full roster still
  // resolves names for a task that already names an inactive assignee.
  const rosterReportsActive = roster.some((person) => typeof person.active === "boolean");
  const activePeople = rosterReportsActive ? roster.filter((person) => person.active !== false) : roster;
  const personOptions = activePeople.map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") }));
  const rosterOptions = roster.map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") }));
  const inactiveRosterNote = !rosterReportsActive
    ? "This roster does not report active status; every person is listed."
    : roster.some((person) => person.active === false)
      ? "Deactivated people are not available for new assignments."
      : null;
  const projectOptions = (projects.data?.projects ?? []).map((project) => ({ value: String(project.id), label: String(project.name ?? "Project") }));
  // TASKS is the one project that owns organization work. It stays out of the
  // form: the admin is choosing a person and a task, not a bucket.
  const tasksProjectId = (projects.data?.projects ?? [])
    .find((project) => String(project.name ?? "").trim().toUpperCase() === "TASKS")?.id;
  const tasksProjectIdValue = tasksProjectId ? String(tasksProjectId) : undefined;
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    // The record returns assignee ids; resolve them against the roster so the
    // cell and its sort see the same names the employee lists do.
    const list = attachAdminAssigneeNames(tasks.data?.tasks ?? [], people.data?.people ?? []);
    if (!needle) return list;
    return list.filter((task) => [task.name, task.title, task.project?.name].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [tasks.data, search, people.data]);
  // No column active means the record's default order — newest created first,
  // updated as the tiebreak; client-side sorting is honest here because the
  // page holds the full normalized list.
  const sortedRows = useMemo(() => sortTaskRows(rows, sort, today), [rows, sort, today]);
  const summary = tasks.data?.summary;
  const drawerTask = detail.data?.task ?? null;
  // The drawer and the row menu read the same derived status record, so an
  // Overdue pill can never open into a drawer that calls the task Pending.
  const drawerStatusTask = drawerTask ? adminTaskStatusRecord(drawerTask, today) : null;
  const drawerState = drawerStatusTask ? displayTaskState(drawerStatusTask, today) : null;
  const drawerStatusOptions = drawerStatusTask ? taskStatusOptions(drawerStatusTask, today) : [];
  const drawerStatusNote = drawerStatusOptions.find((option) => option.note)?.note;
  // A completed task has no status path, and an actor with none gets no section
  // rather than a row of dead buttons or a stale active highlight.
  const drawerStatusVisible = drawerStatusOptions.some((option) => !option.disabled || option.note);
  const drawerWorkflowStatus = drawerTask ? currentWorkflowStatus(drawerTask) : "pending";
  // The drawer labels the row's effective due date plainly (design.md §16.2);
  // the editor still seeds the recorded value.
  const drawerDue = drawerTask ? taskEffectiveDueDate(drawerTask) : null;
  const drawerAssigneeIds = drawerTask ? taskAssigneeIds(drawerTask) : [];
  const drawerAssigneeDraft = assigneeDraft && drawerTask && assigneeDraft.taskId === String(drawerTask.id)
    ? assigneeDraft.ids
    : drawerAssigneeIds;
  const drawerAssigneeChanged = drawerAssigneeDraft.length !== drawerAssigneeIds.length
    || drawerAssigneeDraft.some((id) => !drawerAssigneeIds.includes(id));
  const toggleDrawerAssignee = (personId: string) => {
    if (!drawerTask) return;
    const id = String(drawerTask.id);
    const base = assigneeDraft && assigneeDraft.taskId === id ? assigneeDraft.ids : drawerAssigneeIds;
    setAssigneeDraft({ taskId: id, ids: toggleAssigneeIds(base, personId) });
  };
  const drawerCaps = (drawerTask?.capabilities ?? {}) as Partial<TaskCapabilities>;
  const drawerAssignedBy = drawerTask?.assigned_by_person_id
    ? (people.data?.people ?? []).find((person) => String(person.id) === String(drawerTask.assigned_by_person_id))
    : null;
  const editAssignees = editTask ? taskAssigneeIds(editTask) : [];
  const editMultiAssignee = editAssignees.length > 1;
  const editAssigneeNames = editAssignees.map((id) => {
    const roster = (people.data?.people ?? []).find((person) => String(person.id) === id);
    const embedded = Array.isArray(editTask?.assignees)
      ? editTask?.assignees.find((person) => String(person?.personId ?? "") === id)
      : null;
    return String(roster?.display_name ?? embedded?.displayName ?? "Organization member");
  });
  const mutationError = (statusChange.error ?? removeTask.error ?? saveEdit.error ?? assigneeChange.error ?? null) as Error | null;

  return (
    <div className="admin-grid">
      <AdminCard
        className="admin-task-record-card"
        icon={ListChecks}
        title="Organization tasks"
        detail={summary ? `${summary.open} open · ${summary.overdue} overdue · ${summary.completedWeek} completed in the last 7 days` : undefined}
        // The primary action trails the card's name and summary on the title
        // row; the compact toolbar below carries only the record's views,
        // search, and filters (design.md §8.2, §16.2).
        action={
          <span className="admin-task-add">
            <AdminButton variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Add task</AdminButton>
          </span>
        }
        padded={false}
        controls={
          <AdminControls className="admin-task-controls">
            <AdminControlsGroup>
              <Segmented<TaskFilter>
                ariaLabel="Task filter"
                value={filter}
                onChange={(next) => setFilter(next)}
                options={[
                  { value: "open", label: "Open" },
                  { value: "completed", label: "Completed" },
                  { value: "all", label: "All" },
                ]}
              />
            </AdminControlsGroup>
            <AdminControlsGroup>
              <label className="admin-search">
                <Search size={14} aria-hidden />
                <input type="search" value={search} placeholder="Search tasks" aria-label="Search tasks" onChange={(event) => setSearch(event.target.value)} />
              </label>
            </AdminControlsGroup>
            <AdminControlsGroup>
              <SelectField ariaLabel="Filter by person" value={personId} onChange={setPersonId} placeholder="All people" options={rosterOptions} />
              <SelectField ariaLabel="Filter by project" value={projectId} onChange={setProjectId} placeholder="All projects" options={projectOptions} />
            </AdminControlsGroup>
          </AdminControls>
        }
      >
        {tasks.isLoading ? (
          <div className="admin-card-body is-padded"><div className="admin-grid"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div></div>
        ) : tasks.error ? (
          <div className="admin-card-body is-padded"><Notice tone="err">{(tasks.error as Error).message}</Notice></div>
        ) : rows.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <TaskTableHead sort={sort} onSort={(key) => setSort((current) => nextTaskSort(current, key))} />
              <tbody>
                {sortedRows.map((task) => {
                  const id = String(task.id);
                  const created = taskCreatedDate(task);
                  // The effective due date includes the created + 1 day default;
                  // it drives the cell, the overdue warning, and the pill
                  // exactly as a recorded due date would (design.md §16.2).
                  const due = taskEffectiveDueDate(task);
                  const overdue = task.completed !== true && !!due && due < today;
                  const priority = trimmedText(task.priority);
                  const description = trimmedText(task.description);
                  // One status record drives the pill, the row menu, and the
                  // drawer: the effective due date and its lock.
                  const statusTask = adminTaskStatusRecord(task, today);
                  const state = displayTaskState(statusTask, today);
                  const busy = complete.isPending || statusChange.isPending || removeTask.isPending;
                  return (
                    <tr key={id} onClick={() => setSelectedId(id)} tabIndex={0} data-pan-row="true" onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(id); }}>
                      <td>
                        <span className="admin-record">
                          <b className={task.completed ? "is-done" : undefined}><OverflowPanText>{String(task.title ?? task.name ?? "Task")}</OverflowPanText></b>
                          {/* The description is the line an operator actually
                              reads; it fades at the clip edge and never pans,
                              so the title is the one line that reveals. */}
                          {description ? <small className="admin-record-desc"><OverflowPanText pan={false}>{description}</OverflowPanText></small> : null}
                          {/* Project stays a small per-task detail — the list
                              is one flat record, never grouped by project. */}
                          <small>{task.project?.name ? String(task.project.name) : "No project"}{priority ? ` · ${statusLabel(priority)} priority` : ""}{Array.isArray(task.labels) && task.labels.length ? ` · ${task.labels.join(", ")}` : ""}</small>
                        </span>
                      </td>
                      <td className="admin-quiet">
                        {Array.isArray(task.assignees) && task.assignees.length ? task.assignees.map((assignee: Record<string, any>) => assignee.displayName).join(", ") : "Unassigned"}
                      </td>
                      <td className="admin-numeric">{formatWorkOsFullDate(created)}</td>
                      <td className={overdue ? "admin-numeric warn" : "admin-numeric"}>{formatWorkOsFullDate(due)}</td>
                      <td><Pill tone={taskStateTone(state)}>{taskStatusLabel(state)}</Pill></td>
                      {/* One trailing cell carries the row's actions: the
                          completion control stays where it was and the ellipsis
                          sits beside it, so the row keeps its height and the
                          menu opens from its own trigger (design.md §16.2). */}
                      <td className="admin-row-actions">
                        <span
                          className="admin-row-actions-inner"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
                        >
                          <AdminButton
                            variant="ghost"
                            icon={Check}
                            disabled={complete.isPending}
                            onClick={() => complete.mutate({ id, completed: task.completed !== true })}
                          >
                            {task.completed ? "Reopen" : "Complete"}
                          </AdminButton>
                          {hasTaskMenu(statusTask, today) ? (
                            <EllipsisMenu
                              open={menuTaskId === id}
                              label={`Actions for ${taskTitle(task)}`}
                              disabled={busy}
                              onToggle={() => setMenuTaskId((current) => (current === id ? null : id))}
                              onClose={() => setMenuTaskId(null)}
                            >
                              <AdminTaskMenuItems
                                task={statusTask}
                                today={today}
                                busy={busy}
                                onStatus={(status) => {
                                  // The option that is already active is a no-op write.
                                  if (status !== currentWorkflowStatus(statusTask)) statusChange.mutate({ id, status });
                                }}
                                onComplete={(completed) => complete.mutate({ id, completed })}
                                onEdit={() => openEdit(task)}
                                onAssign={() => setSelectedId(id)}
                                onArchive={() => requestRemoval(task, "archive")}
                                onDelete={() => requestRemoval(task, "delete")}
                                onClose={() => setMenuTaskId(null)}
                              />
                            </EllipsisMenu>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="admin-card-body is-padded"><p className="admin-empty-note">No tasks match these filters.</p></div>
        )}
      </AdminCard>

      {complete.error ? <Notice tone="err">{(complete.error as Error).message}</Notice> : null}
      {mutationError ? <Notice tone="err">{mutationError.message}</Notice> : null}

      <Drawer
        open={!!selectedId}
        onClose={() => { setSelectedId(null); setAssigneeDraft(null); }}
        title={detail.data?.task ? String(detail.data.task.title ?? detail.data.task.name ?? "Task") : "Task"}
        subtitle={detail.data?.task?.project?.name ? String(detail.data.task.project.name) : undefined}
        width={560}
      >
        {detail.isLoading ? (
          <Skeleton className="h-48" />
        ) : detail.error || !drawerTask ? (
          <Notice tone="err">{((detail.error as Error | null)?.message) ?? "The task could not be loaded."}</Notice>
        ) : (
          <div className="admin-grid admin-drawer-grid">
            <section className="admin-block">
              <div className="admin-kv-grid">
                <div className="admin-kv"><span>Status</span><b>{drawerState ? taskStatusLabel(drawerState) : "—"}</b></div>
                <div className="admin-kv"><span>Due</span><b>{drawerDue ? shortDate(`${drawerDue}T12:00:00Z`) : "—"}</b></div>
                <div className="admin-kv"><span>Priority</span><b>{statusLabel(drawerTask.priority ?? "—")}</b></div>
                <div className="admin-kv"><span>Updated</span><b>{drawerTask.updated_at ? relativeTime(String(drawerTask.updated_at)) : "—"}</b></div>
                {drawerAssignedBy ? <div className="admin-kv"><span>Assigned by</span><b>{String(drawerAssignedBy.display_name ?? "Organization member")}</b></div> : null}
              </div>
              {drawerTask.description ? <p className="admin-quiet">{String(drawerTask.description)}</p> : null}
            </section>
            {/* The status control is the same permission payload the row menu
                reads. An overdue task keeps the control, disabled with the
                due-date note; a completed task has no status path at all. */}
            {drawerStatusVisible ? (
              <section className="admin-block">
                <h3><Clock3 size={14} aria-hidden /> Task status</h3>
                <div className="admin-inline-fields">
                  {drawerStatusOptions.map((option) => (
                    <AdminButton
                      key={option.value}
                      variant={option.value === drawerWorkflowStatus ? "primary" : "secondary"}
                      disabled={option.disabled || statusChange.isPending || option.value === drawerWorkflowStatus}
                      onClick={() => {
                        // The option that is already active is a no-op write.
                        if (option.value !== drawerWorkflowStatus) statusChange.mutate({ id: String(drawerTask.id), status: option.value });
                      }}
                    >
                      {option.label}
                    </AdminButton>
                  ))}
                </div>
                {drawerStatusNote ? <Notice tone="warn">{drawerStatusNote}.</Notice> : null}
              </section>
            ) : null}
            {drawerCaps.canAssign === true ? (
              <section className="admin-block">
                <h3><UserRound size={14} aria-hidden /> Assignee</h3>
                {(people.data?.people ?? []).length ? (
                  <>
                    <div className="admin-check-list">
                      {activePeople.map((person) => (
                        <CheckField
                          key={String(person.id)}
                          label={String(person.display_name ?? "Unnamed")}
                          checked={drawerAssigneeDraft.includes(String(person.id))}
                          disabled={assigneeChange.isPending}
                          onChange={() => toggleDrawerAssignee(String(person.id))}
                        />
                      ))}
                    </div>
                    {inactiveRosterNote ? <p className="admin-quiet">{inactiveRosterNote}</p> : null}
                    <div className="admin-inline-fields">
                      <AdminButton
                        variant="primary"
                        disabled={!drawerAssigneeChanged || assigneeChange.isPending}
                        onClick={() => assigneeChange.mutate({ id: String(drawerTask.id), personIds: drawerAssigneeDraft })}
                      >
                        {assigneeChange.isPending ? "Assigning…" : "Assign"}
                      </AdminButton>
                    </div>
                  </>
                ) : <p className="admin-quiet">No organization members are available to assign.</p>}
              </section>
            ) : null}
            {detail.data && detail.data.subtasks.length ? (
              <section className="admin-block">
                <h3><ListChecks size={14} aria-hidden /> Subtasks</h3>
                <ul className="admin-rows">
                  {detail.data.subtasks.map((subtask) => {
                    // The pill reads the same effective due date the rows do.
                    const subtaskState = displayTaskState(adminTaskStatusRecord(subtask, today), today);
                    return (
                      <li key={String(subtask.id)}>
                        <span>{String(subtask.title ?? subtask.name ?? "Subtask")}</span>
                        <Pill tone={taskStateTone(subtaskState)}>{taskStatusLabel(subtaskState)}</Pill>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            <div className="admin-inline-fields">
              <AdminButton
                variant={drawerTask.completed ? "secondary" : "primary"}
                icon={Check}
                disabled={complete.isPending}
                onClick={() => complete.mutate({ id: String(drawerTask.id), completed: drawerTask.completed !== true })}
              >
                {drawerTask.completed ? "Reopen task" : "Mark complete"}
              </AdminButton>
              {drawerCaps.canEdit === true ? (
                <AdminButton icon={Pencil} onClick={() => openEdit(drawerTask)}>Edit task</AdminButton>
              ) : null}
              {drawerCaps.canArchive === true ? (
                <AdminButton icon={Archive} disabled={removeTask.isPending} onClick={() => requestRemoval(drawerTask, "archive")}>Archive task</AdminButton>
              ) : null}
              {drawerCaps.canDelete === true ? (
                <AdminButton variant="danger" icon={Trash2} disabled={removeTask.isPending} onClick={() => requestRemoval(drawerTask, "delete")}>Delete task</AdminButton>
              ) : null}
            </div>
          </div>
        )}
      </Drawer>

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Add a task" subtitle="It lands in the TASKS project and the organization record immediately" width={520}>
        <div className="admin-grid admin-drawer-grid">
          <TextField label="Task" value={form.name} onChange={(next) => setForm((current) => ({ ...current, name: next }))} ariaLabel="Task name" placeholder="What needs doing" />
          <TextField label="Description" value={form.description} onChange={(next) => setForm((current) => ({ ...current, description: next }))} ariaLabel="Task description" />
          <div className="admin-inline-fields">
            <SelectField label="Assignee" ariaLabel="Task assignee" value={form.assignee} onChange={(next) => setForm((current) => ({ ...current, assignee: next }))} placeholder="Unassigned" options={rosterOptions} />
            <TextField label="Due" type="date" value={form.dueDate} onChange={(next) => setForm((current) => ({ ...current, dueDate: next }))} ariaLabel="Task due date" />
          </div>
          {create.error ? <Notice tone="err">{(create.error as Error).message}</Notice> : null}
          <div className="admin-inline-fields">
            <AdminButton variant="primary" icon={CalendarDays} disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Adding…" : "Add task"}
            </AdminButton>
          </div>
        </div>
      </Drawer>

      {/* The editor carries the editable record: title, description, due date,
          priority, and the one assignee. It sits over the detail drawer and the
          drawer stack keeps Escape closing only the top layer. */}
      <Drawer
        open={!!editTask}
        onClose={() => setEditTask(null)}
        title="Edit task"
        subtitle={editTask ? taskTitle(editTask) : undefined}
        width={520}
      >
        <div className="admin-grid admin-drawer-grid">
          <TextField label="Task" value={editForm.name} onChange={(next) => setEditForm((current) => ({ ...current, name: next }))} ariaLabel="Task name" placeholder="What needs doing" />
          <TextField label="Description" value={editForm.description} onChange={(next) => setEditForm((current) => ({ ...current, description: next }))} ariaLabel="Task description" />
          <div className="admin-inline-fields">
            {editMultiAssignee ? (
              <div className="admin-field">
                <span>Assignee</span>
                <b>Multiple assignees</b>
              </div>
            ) : (
              <SelectField label="Assignee" ariaLabel="Task assignee" value={editForm.assignee} onChange={(next) => setEditForm((current) => ({ ...current, assignee: next }))} placeholder="Unassigned" options={personOptions} />
            )}
            <TextField label="Due" type="date" value={editForm.dueDate} onChange={(next) => setEditForm((current) => ({ ...current, dueDate: next }))} ariaLabel="Task due date" />
          </div>
          {editMultiAssignee ? (
            <Notice tone="info">{editAssigneeNames.join(", ")}. Change the set in the task drawer; this editor never rewrites assignment.</Notice>
          ) : null}
          <SelectField label="Priority" ariaLabel="Task priority" value={editForm.priority} onChange={(next) => setEditForm((current) => ({ ...current, priority: next }))} placeholder="No priority" options={PRIORITY_OPTIONS} />
          {saveEdit.error ? <Notice tone="err">{(saveEdit.error as Error).message}</Notice> : null}
          <div className="admin-inline-fields">
            <AdminButton variant="primary" disabled={!editForm.name.trim() || saveEdit.isPending} onClick={() => { if (editTask) saveEdit.mutate(editTask); }}>
              {saveEdit.isPending ? "Saving…" : "Save changes"}
            </AdminButton>
            <AdminButton disabled={saveEdit.isPending} onClick={() => setEditTask(null)}>Cancel</AdminButton>
          </div>
        </div>
      </Drawer>

      {/* Permanent deletion always asks first; archiving says it is reversible
          and keeps the record in history. */}
      <Drawer
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.mode === "delete" ? "Delete this task permanently?" : "Archive this task?"}
        width={460}
      >
        {confirm ? (
          <div className="admin-grid admin-drawer-grid">
            <Notice tone={confirm.mode === "delete" ? "err" : "info"}>
              {confirm.mode === "delete"
                ? `“${taskTitle(confirm.task)}” will be permanently removed and cannot be restored.`
                : `“${taskTitle(confirm.task)}” will be hidden from active work but kept in Work OS history. Archiving is reversible.`}
            </Notice>
            {removeTask.error ? <Notice tone="err">{(removeTask.error as Error).message}</Notice> : null}
            <div className="admin-inline-fields">
              <AdminButton disabled={removeTask.isPending} onClick={() => setConfirm(null)}>Cancel</AdminButton>
              <AdminButton
                variant={confirm.mode === "delete" ? "danger" : "primary"}
                disabled={removeTask.isPending}
                onClick={() => { if (!removeTask.isPending) removeTask.mutate({ id: String(confirm.task.id), mode: confirm.mode }); }}
              >
                {removeTask.isPending
                  ? confirm.mode === "delete" ? "Deleting…" : "Archiving…"
                  : confirm.mode === "delete" ? "Delete permanently" : "Archive task"}
              </AdminButton>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
