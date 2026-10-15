import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ListChecks, Plus, Search } from "lucide-react";
import { useNotifications } from "../NotificationFlyouts";
import {
  adminKeys,
  ADMIN_STALE_MS,
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
import { AdminButton, AdminCard, Drawer, Notice, Pill, Segmented, SelectField, Skeleton, TextField } from "./ui";

type TaskFilter = "open" | "completed" | "all";

/** The organization task record: bounded filters, the flat list, and a drawer
 * that opens one task's detail with its subtasks. */
export default function TasksPage({ initialTaskId }: { initialTaskId?: string }) {
  const queryClient = useQueryClient();
  const notifications = useNotifications();
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [personId, setPersonId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
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
  const summary = tasks.data?.summary;

  return (
    <div className="admin-grid">
      <AdminCard
        icon={ListChecks}
        title="Organization tasks"
        detail={summary ? `${summary.open} open · ${summary.overdue} overdue · ${summary.completedWeek} completed in the last 7 days` : undefined}
        padded={false}
        action={
          <div className="admin-toolbar">
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
            <label className="admin-search">
              <Search size={14} aria-hidden />
              <input type="search" value={search} placeholder="Search tasks" aria-label="Search tasks" onChange={(event) => setSearch(event.target.value)} />
            </label>
            <SelectField ariaLabel="Filter by person" value={personId} onChange={setPersonId} placeholder="All people" options={personOptions} />
            <SelectField ariaLabel="Filter by project" value={projectId} onChange={setProjectId} placeholder="All projects" options={projectOptions} />
            <AdminButton variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Add task</AdminButton>
          </div>
        }
      >
        {tasks.isLoading ? (
          <div className="admin-card-body is-padded"><div className="admin-grid"><Skeleton className="h-14" /><Skeleton className="h-14" /><Skeleton className="h-14" /></div></div>
        ) : tasks.error ? (
          <div className="admin-card-body is-padded"><Notice tone="err">{(tasks.error as Error).message}</Notice></div>
        ) : rows.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Task</th><th>Assignees</th><th>Due</th><th>Status</th><th /></tr></thead>
              <tbody>
                {rows.map((task) => {
                  const id = String(task.id);
                  const overdue = task.completed !== true && task.due_date && String(task.due_date) < todayIso();
                  return (
                    <tr key={id} onClick={() => setSelectedId(id)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setSelectedId(id); }}>
                      <td>
                        <span className="admin-record">
                          <b className={task.completed ? "is-done" : undefined}>{String(task.title ?? task.name ?? "Task")}</b>
                          <small>{task.project?.name ? String(task.project.name) : "No project"}{Array.isArray(task.labels) && task.labels.length ? ` · ${task.labels.join(", ")}` : ""}</small>
                        </span>
                      </td>
                      <td className="admin-quiet">
                        {Array.isArray(task.assignees) && task.assignees.length ? task.assignees.map((assignee: Record<string, any>) => assignee.displayName).join(", ") : "Unassigned"}
                      </td>
                      <td className={overdue ? "admin-numeric warn" : "admin-numeric"}>{task.due_date ? shortDate(`${task.due_date}T12:00:00Z`) : "—"}</td>
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
