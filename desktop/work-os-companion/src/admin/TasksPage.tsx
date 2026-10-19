import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CalendarDays, Check, ChevronsUpDown, ListChecks, Plus, Search } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import {
  adminKeys,
  ADMIN_STALE_MS,
  type AdminTaskRow,
  completeAdminTask,
  createAdminTask,
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
} from "./data";
import { formatWorkOsFullDate, shiftWorkOsDate } from "../dateFormat";
import { OverflowPanText } from "../OverflowPan";
import { AdminButton, AdminCard, AdminControls, AdminControlsGroup, Drawer, Notice, Pill, Segmented, SelectField, Skeleton, TextField } from "./ui";

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
 * (Overdue → Open → Done) exactly as the pill reads the recorded completion
 * flag; a row whose record states no flag claims no rank and stays last. Pure
 * functions, exported for the comparator tests (design.md §16.2 sortable
 * tables). */

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

const STRICT_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The recorded calendar day a date-shaped value states, if it states one; an
 * empty or unreadable value is "not recorded" and never paints. */
function recordedDate(value: unknown): string | null {
  const day = trimmedText(value).slice(0, 10);
  return STRICT_DATE.test(day) ? day : null;
}

/** The created date the row states: the provider's own creation stamp first,
 * then the local record — the same precedence the employee task detail reads.
 * Both shapes keep their recorded calendar day instead of shifting with the
 * viewer's timezone. */
export function taskCreatedDate(task: AdminTaskRow): string | null {
  return recordedDate(trimmedText(task.provider_created_at) || trimmedText(task.created_at));
}

/** The row's effective due date: the recorded due date when the task has one,
 * otherwise one day after it was created (design.md §16.2). The derived value
 * is the due date everywhere the row is read — the Due cell, the overdue
 * warning and the Overdue/Open/Done pill, and the Due column's sorting —
 * exactly as if it were recorded, and it renders plainly with no "default"
 * marker. Only a task whose created date is also missing has no effective due
 * date and keeps the dash. */
export function taskEffectiveDueDate(task: AdminTaskRow): string | null {
  const recorded = recordedDate(task.due_date);
  if (recorded) return recorded;
  const created = taskCreatedDate(task);
  return created ? shiftWorkOsDate(created, 1) || null : null;
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

/** 0 = Overdue, 1 = Open, 2 = Done — the same predicate the pill renders from
 * the recorded completion flag, reading the row's effective due date (the
 * created + 1 day default included); a row whose record states no flag has no
 * rank and sorts last in both directions (the pill's Open is a display default
 * only). */
function statusRank(task: AdminTaskRow, today: string): number | null {
  if (typeof task.completed !== "boolean") return null;
  if (task.completed) return 2;
  const due = taskEffectiveDueDate(task);
  return due && due < today ? 0 : 1;
}

function updatedValue(task: AdminTaskRow): number | null {
  const parsed = Date.parse(trimmedText(task.updated_at));
  return Number.isFinite(parsed) ? parsed : null;
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
  if (!sort) {
    return compareNullable(dayValue(taskCreatedDate(a)), dayValue(taskCreatedDate(b)), -1, numeric)
      || compareNullable(updatedValue(a), updatedValue(b), -1, numeric)
      || compareNullable(dayValue(taskEffectiveDueDate(a)), dayValue(taskEffectiveDueDate(b)), -1, numeric)
      || compareTiebreak(a, b);
  }
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
  const [form, setForm] = useState({ name: "", description: "", projectId: "", assignee: "", dueDate: "", priority: "" });

  const people = useQuery({ queryKey: adminKeys.people(), queryFn: fetchPeople, select: normalizePeople, staleTime: ADMIN_STALE_MS });
  const projects = useQuery({ queryKey: adminKeys.projects(), queryFn: fetchProjects, select: normalizeProjects, staleTime: ADMIN_STALE_MS });
  const completedParam = filter === "open" ? "false" : filter === "completed" ? "true" : "";
  const taskFilters: Record<string, string> = { filter, personId, projectId, limit: "200", completed: completedParam };
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
  const complete = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => completeAdminTask(id, completed),
    onSuccess: (result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["work-os", "admin", "tasks"] });
      const row = (tasks.data?.tasks ?? []).find((entry) => String(entry.id) === variables.id);
      const title = String(result?.task?.title ?? result?.task?.name ?? row?.title ?? row?.name ?? "The task");
      notifications.success(`“${title}” was ${variables.completed ? "marked complete" : "reopened"}.`, variables.completed ? "Task completed" : "Task reopened");
    },
  });
  const create = useMutation({
    mutationFn: () => createAdminTask({
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      project_id: form.projectId || undefined,
      assignee_person_ids: form.assignee ? [form.assignee] : [],
      due_date: form.dueDate || undefined,
      priority: form.priority || undefined,
    }),
    onSuccess: (result) => {
      setCreateOpen(false);
      setForm({ name: "", description: "", projectId: "", assignee: "", dueDate: "", priority: "" });
      void queryClient.invalidateQueries({ queryKey: ["work-os", "admin", "tasks"] });
      const submitted = result?.task?.title ?? result?.task?.name;
      const title = String(submitted ?? (form.name.trim() || "The task"));
      notifications.success(`“${title}” was added to the organization task record.`, "Task created");
    },
  });

  const personOptions = (people.data?.people ?? []).map((person) => ({ value: String(person.id), label: String(person.display_name ?? "Unnamed") }));
  const projectOptions = (projects.data?.projects ?? []).map((project) => ({ value: String(project.id), label: String(project.name ?? "Project") }));
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = tasks.data?.tasks ?? [];
    if (!needle) return list;
    return list.filter((task) => [task.name, task.title, task.project?.name].some((value) => String(value ?? "").toLowerCase().includes(needle)));
  }, [tasks.data, search]);
  // No column active means the record's default order — newest created first,
  // updated as the tiebreak; client-side sorting is honest here because the
  // page holds the full normalized list.
  const sortedRows = useMemo(() => sortTaskRows(rows, sort), [rows, sort]);
  const summary = tasks.data?.summary;

  return (
    <div className="admin-grid">
      <AdminCard
        icon={ListChecks}
        title="Organization tasks"
        detail={summary ? `${summary.open} open · ${summary.overdue} overdue · ${summary.completedWeek} completed in the last 7 days` : undefined}
        padded={false}
        controls={
          <>
            {/* One compact controls row: views, search, and the two record
                filters read in order, with the primary Add task action last
                and right-aligned while the row has room (design.md §8.2,
                §16.2). The row wraps deliberately at narrow widths; the
                action keeps the trailing edge. */}
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
                <SelectField ariaLabel="Filter by person" value={personId} onChange={setPersonId} placeholder="All people" options={personOptions} />
                <SelectField ariaLabel="Filter by project" value={projectId} onChange={setProjectId} placeholder="All projects" options={projectOptions} />
              </AdminControlsGroup>
              <AdminControlsGroup end>
                <AdminButton variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Add task</AdminButton>
              </AdminControlsGroup>
            </AdminControls>
          </>
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
                  const overdue = task.completed !== true && !!due && due < todayIso();
                  const priority = trimmedText(task.priority);
                  return (
                    <tr key={id} onClick={() => setSelectedId(id)} tabIndex={0} data-pan-row="true" onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(id); }}>
                      <td>
                        <span className="admin-record">
                          <b className={task.completed ? "is-done" : undefined}><OverflowPanText>{String(task.title ?? task.name ?? "Task")}</OverflowPanText></b>
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
                      <td><Pill tone={task.completed ? "ok" : overdue ? "err" : "neutral"}>{task.completed ? "Done" : overdue ? "Overdue" : "Open"}</Pill></td>
                      <td>
                        <AdminButton
                          variant="ghost"
                          icon={Check}
                          disabled={complete.isPending}
                          onClick={() => complete.mutate({ id, completed: task.completed !== true })}
                        >
                          {task.completed ? "Reopen" : "Complete"}
                        </AdminButton>
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

      <Drawer
        open={!!selectedId}
        onClose={() => setSelectedId(null)}
        title={detail.data?.task ? String(detail.data.task.title ?? detail.data.task.name ?? "Task") : "Task"}
        subtitle={detail.data?.task?.project?.name ? String(detail.data.task.project.name) : undefined}
        width={560}
      >
        {detail.isLoading ? (
          <Skeleton className="h-48" />
        ) : detail.error || !detail.data ? (
          <Notice tone="err">{((detail.error as Error | null)?.message) ?? "The task could not be loaded."}</Notice>
        ) : (
          <div className="admin-grid admin-drawer-grid">
            <section className="admin-block">
              <div className="admin-kv-grid">
                <div className="admin-kv"><span>Status</span><b>{detail.data.task.completed ? "Completed" : "Open"}</b></div>
                <div className="admin-kv"><span>Due</span><b>{detail.data.task.due_date ? shortDate(`${detail.data.task.due_date}T12:00:00Z`) : "—"}</b></div>
                <div className="admin-kv"><span>Priority</span><b>{statusLabel(detail.data.task.priority ?? "—")}</b></div>
                <div className="admin-kv"><span>Updated</span><b>{detail.data.task.updated_at ? relativeTime(String(detail.data.task.updated_at)) : "—"}</b></div>
              </div>
              {detail.data.task.description ? <p className="admin-quiet">{String(detail.data.task.description)}</p> : null}
            </section>
            {detail.data.subtasks.length ? (
              <section className="admin-block">
                <h3><ListChecks size={14} aria-hidden /> Subtasks</h3>
                <ul className="admin-rows">
                  {detail.data.subtasks.map((subtask) => (
                    <li key={String(subtask.id)}>
                      <span>{String(subtask.title ?? subtask.name ?? "Subtask")}</span>
                      <Pill tone={subtask.completed ? "ok" : "neutral"}>{subtask.completed ? "Done" : "Open"}</Pill>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div className="admin-inline-fields">
              <AdminButton
                variant={detail.data.task.completed ? "secondary" : "primary"}
                icon={Check}
                disabled={complete.isPending}
                onClick={() => complete.mutate({ id: String(detail.data!.task.id), completed: !detail.data!.task.completed })}
              >
                {detail.data.task.completed ? "Reopen task" : "Mark complete"}
              </AdminButton>
            </div>
          </div>
        )}
      </Drawer>

      <Drawer open={createOpen} onClose={() => setCreateOpen(false)} title="Add a task" subtitle="It lands in the organization task record immediately" width={520}>
        <div className="admin-grid admin-drawer-grid">
          <TextField label="Task" value={form.name} onChange={(next) => setForm((current) => ({ ...current, name: next }))} ariaLabel="Task name" placeholder="What needs doing" />
          <TextField label="Description" value={form.description} onChange={(next) => setForm((current) => ({ ...current, description: next }))} ariaLabel="Task description" />
          <div className="admin-inline-fields">
            <SelectField label="Assignee" ariaLabel="Task assignee" value={form.assignee} onChange={(next) => setForm((current) => ({ ...current, assignee: next }))} placeholder="Unassigned" options={personOptions} />
            <SelectField label="Project" ariaLabel="Task project" value={form.projectId} onChange={(next) => setForm((current) => ({ ...current, projectId: next }))} placeholder="No project" options={projectOptions} />
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
    </div>
  );
}
