"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, ListChecks, Plus, Search } from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys } from "./api";
import {
  AdminCard,
  Button,
  Drawer,
  EmptyState,
  Notice,
  SegmentedControl,
  SelectField,
  Skeleton,
  StatusPill,
  TextField,
  cx,
  statusLabel,
} from "./ui";

type AnyRow = Record<string, any>;
type TaskFilter = "open" | "completed" | "all";

function taskUrl(task: AnyRow): string | null {
  const url = task.url || task.provider_url || task.raw?.url;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

function assigneeNames(task: AnyRow): string[] {
  return Array.isArray(task.assignees)
    ? task.assignees.filter((person: AnyRow) => typeof person?.displayName === "string").map((person: AnyRow) => String(person.displayName))
    : [];
}

export default function AdminTasksPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [personId, setPersonId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    projectId: "",
    assigneePersonId: "",
    dueDate: "",
    startDate: "",
    priority: "",
    labels: "",
    storyPoints: "",
    expectedOutcome: "",
    definitionOfDone: "",
  });

  const people = useQuery<{ people: Array<{ id: string; display_name: string }> }>({
    queryKey: adminKeys.people(),
    queryFn: () => adminFetch("/api/work-os/people"),
    staleTime: 60_000,
  });
  const projects = useQuery<{ projects: AnyRow[] }>({
    queryKey: adminKeys.projects(),
    queryFn: () => adminFetch("/api/work-os/projects"),
    staleTime: 60_000,
  });
  const completedParam = filter === "open" ? "false" : filter === "completed" ? "true" : "";
  const tasks = useQuery<{ tasks: AnyRow[]; nextOffset: number | null }>({
    queryKey: adminKeys.tasks({ filter, personId, projectId }),
    queryFn: () => {
      const params = new URLSearchParams({ limit: "200" });
      if (completedParam) params.set("completed", completedParam);
      if (personId) params.set("personId", personId);
      if (projectId) params.set("projectId", projectId);
      return adminFetch(`/api/work-os/tasks?${params.toString()}`);
    },
    staleTime: 30_000,
  });

  const complete = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => adminFetch(`/api/work-os/tasks/${encodeURIComponent(id)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-os"] }),
  });
  const create = useMutation({
    mutationFn: () => adminFetch("/api/work-os/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        project_id: form.projectId || undefined,
        assignee_person_ids: form.assigneePersonId ? [form.assigneePersonId] : [],
        due_date: form.dueDate || undefined,
        start_date: form.startDate || undefined,
        priority: form.priority || undefined,
        labels: form.labels.split(",").map((label) => label.trim()).filter(Boolean),
        story_points: form.storyPoints ? Number(form.storyPoints) : undefined,
        expected_outcome: form.expectedOutcome || undefined,
        definition_of_done: form.definitionOfDone || undefined,
      }),
    }),
    onSuccess: () => {
      setCreateOpen(false);
      setForm({ name: "", description: "", projectId: "", assigneePersonId: "", dueDate: "", startDate: "", priority: "", labels: "", storyPoints: "", expectedOutcome: "", definitionOfDone: "" });
      void queryClient.invalidateQueries({ queryKey: ["work-os"] });
    },
  });

  const rows = useMemo(() => {
    const list = tasks.data?.tasks ?? [];
    const query = search.trim().toLowerCase();
    if (!query) return list;
    return list.filter((task) => `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase().includes(query));
  }, [tasks.data, search]);

  const personOptions = (people.data?.people ?? []).map((person) => ({ value: person.id, label: person.display_name }));
  const projectOptions = (projects.data?.projects ?? []).map((project) => ({ value: String(project.provider_project_id || project.id), label: String(project.name) }));

  return (
    <div className="grid gap-5">
      <AdminCard padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--border-subtle)" }}>
          <SegmentedControl<TaskFilter>
            ariaLabel="Task status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: "open", label: "Open" },
              { value: "completed", label: "Completed" },
              { value: "all", label: "All" },
            ]}
          />
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
              Search
              <span className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" aria-hidden />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title or description"
                  className="min-h-[34px] w-[200px] rounded-[10px] border bg-transparent pl-8 pr-2.5 py-1.5 text-[12px] font-normal normal-case tracking-normal text-[var(--text-primary)] outline-none"
                  style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}
                />
              </span>
            </label>
            <SelectField label="Person" value={personId} onChange={setPersonId} options={personOptions} placeholder="All people" ariaLabel="Filter by person" />
            <SelectField label="Project" value={projectId} onChange={setProjectId} options={projectOptions} placeholder="All projects" ariaLabel="Filter by project" />
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus size={13} aria-hidden /> Add task
            </Button>
          </div>
        </div>

        {tasks.isLoading ? (
          <div className="grid gap-2 p-5">
            {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-12 w-full" />)}
          </div>
        ) : tasks.error ? (
          <div className="p-5"><Notice tone="err">{(tasks.error as Error).message}</Notice></div>
        ) : rows.length ? (
          <ul>
            {rows.map((task) => {
              const done = task.completed === true;
              const names = assigneeNames(task);
              const url = taskUrl(task);
              return (
                <li key={String(task.id)} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-3" style={{ borderColor: "var(--border-subtle)" }}>
                  <button
                    type="button"
                    aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                    title={done ? "Reopen task" : "Mark complete"}
                    disabled={complete.isPending}
                    onClick={() => complete.mutate({ id: String(task.id), completed: !done })}
                    className="grid size-6 shrink-0 place-items-center rounded-full border transition"
                    style={{
                      borderColor: done ? "var(--accent)" : "var(--border-hot)",
                      background: done ? "var(--accent)" : "transparent",
                      color: done ? "var(--text-inverse)" : "transparent",
                    }}
                  >
                    {done ? <Check size={13} aria-hidden /> : null}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cx("truncate text-[13px] font-semibold", done ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]")}>{String(task.title ?? "Untitled task")}</p>
                    <p className="truncate text-[11.5px] text-[var(--text-tertiary)]">
                      {task.project?.name ? String(task.project.name) : "No project"}
                      {names.length ? ` · ${names.join(", ")}` : ""}
                      {task.due_date ? ` · due ${formatWorkOsDate(String(task.due_date))}` : ""}
                      {task.priority ? ` · ${statusLabel(String(task.priority))} priority` : ""}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {task.pending_status === "failed" ? <StatusPill tone="err">Sync failed</StatusPill> : null}
                    <ProvenanceBadge task={task} />
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: "var(--accent)" }}>
                        Open <ExternalLink size={11} aria-hidden />
                      </a>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-5">
            <EmptyState
              icon={ListChecks}
              title={filter === "open" ? "No open tasks match" : "No tasks match these filters"}
              body="Change the filters, clear the search, or add a task."
              action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={12} aria-hidden /> Add task</Button>}
            />
          </div>
        )}
        {tasks.data?.nextOffset != null ? (
          <p className="px-5 py-3 text-[11.5px] text-[var(--text-tertiary)]">Showing the first 200 tasks. Narrow the filters to see the rest.</p>
        ) : null}
      </AdminCard>

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a task"
        subtitle="The task is created in Work OS first and mirrored to Nifty by the workspace sync."
        width={560}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!form.name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Creating…" : "Create task"}
            </Button>
          </div>
        }
      >
        <div className="grid gap-3">
          <TextField label="Title" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="What needs to be done?" ariaLabel="Task title" />
          <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
            Description
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={3}
              placeholder="Context, links, or acceptance notes."
              className="w-full resize-y rounded-[10px] border bg-transparent px-3 py-2 text-[12.5px] font-normal normal-case tracking-normal text-[var(--text-primary)] outline-none"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Project" value={form.projectId} onChange={(value) => setForm((current) => ({ ...current, projectId: value }))} options={projectOptions} placeholder="No project" ariaLabel="Task project" />
            <SelectField label="Assignee" value={form.assigneePersonId} onChange={(value) => setForm((current) => ({ ...current, assigneePersonId: value }))} options={personOptions} placeholder="Unassigned" ariaLabel="Task assignee" />
            <TextField label="Due date" type="date" value={form.dueDate} onChange={(value) => setForm((current) => ({ ...current, dueDate: value }))} ariaLabel="Due date" />
            <TextField label="Start date" type="date" value={form.startDate} onChange={(value) => setForm((current) => ({ ...current, startDate: value }))} ariaLabel="Start date" />
            <TextField label="Priority" value={form.priority} onChange={(value) => setForm((current) => ({ ...current, priority: value }))} placeholder="Optional" ariaLabel="Priority" />
            <TextField label="Story points" type="number" value={form.storyPoints} onChange={(value) => setForm((current) => ({ ...current, storyPoints: value }))} ariaLabel="Story points" />
            <TextField label="Labels" value={form.labels} onChange={(value) => setForm((current) => ({ ...current, labels: value }))} placeholder="comma, separated" ariaLabel="Labels" />
            <TextField label="Expected outcome" value={form.expectedOutcome} onChange={(value) => setForm((current) => ({ ...current, expectedOutcome: value }))} ariaLabel="Expected outcome" />
            <TextField label="Definition of done" value={form.definitionOfDone} onChange={(value) => setForm((current) => ({ ...current, definitionOfDone: value }))} ariaLabel="Definition of done" className="sm:col-span-2" />
          </div>
          {create.error ? <Notice tone="err">{(create.error as Error).message}</Notice> : null}
        </div>
      </Drawer>
    </div>
  );
}

function ProvenanceBadge({ task }: { task: AnyRow }) {
  if (String(task.provider ?? "") === "local") return <StatusPill tone="neutral">Work OS record</StatusPill>;
  if (task.synced_at) return <StatusPill tone="neutral">Nifty synced</StatusPill>;
  return <StatusPill tone="warn">Sync pending</StatusPill>;
}
