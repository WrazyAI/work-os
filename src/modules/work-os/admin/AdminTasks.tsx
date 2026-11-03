"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Check, ChevronDown, ChevronUp, ExternalLink, ListChecks, Plus, Search } from "lucide-react";
import { formatWorkOsDate } from "@/modules/work-os/date-format";
import { adminFetch, adminKeys } from "./api";
import {
  Button,
  Drawer,
  EmptyState,
  Group,
  Notice,
  Panel,
  SegmentedControl,
  SelectField,
  Skeleton,
  StateMark,
  TextField,
  cx,
} from "./ui";

type AnyRow = Record<string, any>;
type TaskFilter = "open" | "completed" | "all";
type SortKey = "title" | "assignees" | "created" | "due" | "status";

const SORT_NATURAL: Record<SortKey, 1 | -1> = { title: 1, assignees: 1, created: -1, due: 1, status: 1 };

const ROW_GRID = "grid grid-cols-[minmax(0,1fr)_76px_24px] items-center gap-3 lg:grid-cols-[minmax(0,1fr)_140px_104px_92px_76px_24px] xl:grid-cols-[minmax(0,1fr)_150px_140px_104px_104px_88px_24px]";

function taskUrl(task: AnyRow): string | null {
  const url = task.url || task.provider_url || task.raw?.url;
  return typeof url === "string" && url.startsWith("http") ? url : null;
}

function assigneeNames(task: AnyRow, peopleById: Map<string, string>): string[] {
  const names = Array.isArray(task.assignees)
    ? task.assignees.filter((person: AnyRow) => typeof person?.displayName === "string").map((person: AnyRow) => String(person.displayName))
    : [];
  if (names.length) return names;
  // The record returns raw assignee ids; resolve them through the roster so a
  // task with a real assignee never reads as unassigned.
  return (Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids : [])
    .map((id: unknown) => peopleById.get(String(id)))
    .filter((name): name is string => !!name);
}

function createdStamp(task: AnyRow): string | null {
  const value = task.provider_created_at ?? task.created_at ?? task.created;
  return typeof value === "string" && value ? value : null;
}

/** The due date a row reads against: the recorded date, else the default one
 * day after creation, exactly as the record's overdue predicate does. */
function effectiveDue(task: AnyRow): string | null {
  if (typeof task.due_date === "string" && task.due_date) return task.due_date;
  const created = createdStamp(task);
  if (!created) return null;
  const parsed = new Date(created);
  if (Number.isNaN(parsed.getTime())) return null;
  const next = new Date(parsed);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

function statusRank(task: AnyRow, today: string): number {
  if (task.completed === true) return 2;
  const due = effectiveDue(task);
  return due && due < today ? 0 : 1;
}

function sortTasks(rows: AnyRow[], sort: { key: SortKey; dir: 1 | -1 }, peopleById: Map<string, string>, today: string) {
  const value = (task: AnyRow): string | number | null => {
    if (sort.key === "title") return String(task.title ?? "").toLowerCase() || null;
    if (sort.key === "assignees") return assigneeNames(task, peopleById).join(", ").toLowerCase() || null;
    if (sort.key === "created") {
      const stamp = createdStamp(task);
      const parsed = stamp ? Date.parse(stamp) : Number.NaN;
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (sort.key === "due") return effectiveDue(task);
    return statusRank(task, today);
  };
  return [...rows].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    if (a == null && b == null) return String(left.title ?? "").localeCompare(String(right.title ?? ""));
    if (a == null) return 1;
    if (b == null) return -1;
    const compared = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
    if (compared) return compared * sort.dir;
    return String(left.title ?? "").localeCompare(String(right.title ?? "")) || String(left.id).localeCompare(String(right.id));
  });
}

export default function AdminTasksPage() {
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [filter, setFilter] = useState<TaskFilter>("open");
  const [personId, setPersonId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [search, setSearch] = useState("");
  const [pageSize, setPageSize] = useState(100);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "created", dir: -1 });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
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
  const tasks = useQuery<{ tasks: AnyRow[]; nextOffset: number | null; summary?: { open: number; overdue: number; overdueRecorded?: number; completedWeek: number } }>({
    queryKey: adminKeys.tasks({ filter, personId, projectId, pageSize: String(pageSize) }),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(pageSize) });
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
        project_id: tasksProjectId ? String(tasksProjectId) : undefined,
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
      setForm({ name: "", description: "", assigneePersonId: "", dueDate: "", startDate: "", priority: "", labels: "", storyPoints: "", expectedOutcome: "", definitionOfDone: "" });
      void queryClient.invalidateQueries({ queryKey: ["work-os"] });
    },
  });

  const personOptions = (people.data?.people ?? []).map((person) => ({ value: person.id, label: person.display_name }));
  const projectOptions = (projects.data?.projects ?? []).map((project) => ({ value: String(project.id), label: String(project.name) }));
  // TASKS is the one project that owns organization work; the picker is gone.
  const tasksProjectId = (projects.data?.projects ?? []).find((project) => String(project.name ?? "").trim().toUpperCase() === "TASKS")?.id;
  const peopleById = useMemo(() => new Map((people.data?.people ?? []).map((person) => [String(person.id), String(person.display_name)])), [people.data]);

  const rows = useMemo(() => {
    const list = tasks.data?.tasks ?? [];
    const query = search.trim().toLowerCase();
    const matched = query
      ? list.filter((task) => `${task.title ?? ""} ${task.description ?? ""}`.toLowerCase().includes(query))
      : list;
    return sortTasks(matched, sort, peopleById, today);
  }, [tasks.data, search, sort, peopleById, today]);

  const summary = tasks.data?.summary;
  const recordedOverdue = summary?.overdueRecorded ?? summary?.overdue ?? 0;
  const defaultOverdue = Math.max(0, (summary?.overdue ?? 0) - recordedOverdue);

  const toggleSort = (key: SortKey) => {
    setSort((current) => current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: SORT_NATURAL[key] });
  };

  return (
    <div className="flex flex-col">
      <Group label="Record" detail="The workspace task record and what is still open.">
        <div className="flex flex-wrap items-end justify-between gap-3 pb-3">
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
            <label className="grid gap-1.5 text-[11.5px] font-medium text-[var(--text-secondary)]">
              Search
              <span className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" aria-hidden />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Title or description"
                  className="min-h-[34px] w-[200px] rounded-[9px] border bg-transparent pl-8 pr-2.5 py-1.5 text-[12px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
                  style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}
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

        {summary ? (
          <div className="pb-3">
            <p className="text-[12px] text-[var(--text-tertiary)]">
              <strong className="font-semibold tabular-nums text-[var(--text-primary)]">{summary.open}</strong> open
              {" · "}
              <strong
                className="font-semibold tabular-nums"
                style={{ color: recordedOverdue ? "var(--status-warn)" : "var(--text-primary)" }}
              >
                {recordedOverdue}
              </strong>{" "}
              past a recorded due date
              {" · "}
              <strong className="font-semibold tabular-nums text-[var(--text-primary)]">{summary.completedWeek}</strong> completed this week
            </p>
            {defaultOverdue ? (
              <p className="mt-1 text-[10.5px] leading-4 text-[var(--text-tertiary)]">
                Another {defaultOverdue} are past the default due date (one day after creation) and have no date recorded.
              </p>
            ) : null}
          </div>
        ) : null}

        <Panel padded={false}>
          <div className={cx(ROW_GRID, "border-b px-3 py-2 text-[10.5px] font-medium text-[var(--text-tertiary)]")} style={{ borderColor: "var(--border)" }}>
            <SortHeader label="Task" active={sort.key === "title"} dir={sort.dir} onClick={() => toggleSort("title")} />
            <span role="columnheader" className="hidden lg:block">Project</span>
            <span className="hidden xl:block"><SortHeader label="Assignees" active={sort.key === "assignees"} dir={sort.dir} onClick={() => toggleSort("assignees")} /></span>
            <span className="hidden lg:block"><SortHeader label="Created" active={sort.key === "created"} dir={sort.dir} onClick={() => toggleSort("created")} /></span>
            <span className="hidden lg:block"><SortHeader label="Due" active={sort.key === "due"} dir={sort.dir} onClick={() => toggleSort("due")} /></span>
            <SortHeader label="Status" active={sort.key === "status"} dir={sort.dir} onClick={() => toggleSort("status")} />
            <span role="columnheader" className="sr-only">Open</span>
          </div>

          {tasks.isLoading ? (
            <div className="grid gap-1 p-3">
              {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-11 w-full" />)}
            </div>
          ) : tasks.error ? (
            <div className="p-4"><Notice tone="err">{(tasks.error as Error).message}</Notice></div>
          ) : rows.length ? (
            <ul>
              {rows.map((task) => {
                const done = task.completed === true;
                const names = assigneeNames(task, peopleById);
                const url = taskUrl(task);
                const due = effectiveDue(task);
                const overdue = !done && due != null && due < today;
                const created = createdStamp(task);
                return (
                  <li key={String(task.id)} className={cx(ROW_GRID, "border-b px-3 py-2.5 transition last:border-b-0 hover:bg-[var(--bg-secondary)]")} style={{ borderColor: "var(--border-subtle)" }}>
                    <span className="flex min-w-0 items-start gap-2.5">
                      <button
                        type="button"
                        aria-label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
                        title={done ? "Reopen task" : "Mark complete"}
                        disabled={complete.isPending}
                        onClick={() => complete.mutate({ id: String(task.id), completed: !done })}
                        className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full border transition"
                        style={{
                          borderColor: done ? "var(--accent)" : "var(--border-hot)",
                          background: done ? "var(--accent)" : "transparent",
                          color: done ? "var(--text-inverse)" : "transparent",
                        }}
                      >
                        {done ? <Check size={11} aria-hidden /> : null}
                      </button>
                      <span className="min-w-0">
                        <span className={cx("block truncate text-[12.5px] font-semibold", done ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]")}>
                          {String(task.title ?? "Untitled task")}
                        </span>
                        {task.description ? <span className="mt-0.5 block truncate text-[11px] text-[var(--text-tertiary)]">{String(task.description)}</span> : null}
                        {task.pending_status === "failed" ? <span className="mt-1 block"><StateMark tone="err">Sync failed</StateMark></span> : null}
                      </span>
                    </span>
                    <span className="hidden min-w-0 truncate text-[11.5px] text-[var(--text-secondary)] lg:block">
                      {task.project?.name ? String(task.project.name) : <span className="text-[var(--text-tertiary)]">No project</span>}
                    </span>
                    <span className="hidden min-w-0 truncate text-[11.5px] text-[var(--text-secondary)] xl:block">
                      {names.length ? names.join(", ") : <span className="text-[var(--text-tertiary)]">Unassigned</span>}
                    </span>
                    <span className="hidden text-[11px] tabular-nums text-[var(--text-tertiary)] lg:block">
                      {created ? formatWorkOsDate(created.slice(0, 10)) : "—"}
                    </span>
                    <span className="hidden lg:block">
                      {typeof task.due_date === "string" && task.due_date ? (
                        <span className={cx("text-[11.5px] tabular-nums", overdue ? "font-medium" : "")} style={{ color: overdue ? "var(--status-warn)" : "var(--text-secondary)" }}>
                          {formatWorkOsDate(task.due_date)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-[var(--text-tertiary)]" title={due ? `Defaults to ${formatWorkOsDate(due)}` : undefined}>No due date</span>
                      )}
                    </span>
                    <span>
                      <StateMark tone={done ? "ok" : overdue ? "warn" : "neutral"}>{done ? "Done" : overdue ? "Overdue" : "Open"}</StateMark>
                    </span>
                    <span className="flex justify-end">
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${task.title} in its provider`}
                          className="text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)]"
                        >
                          <ExternalLink size={12} aria-hidden />
                        </a>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4">
              <EmptyState
                icon={ListChecks}
                title={filter === "open" ? "No open tasks match" : "No tasks match these filters"}
                body="Change the filters, clear the search, or add a task."
                action={<Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}><Plus size={12} aria-hidden /> Add task</Button>}
              />
            </div>
          )}
        </Panel>

        {tasks.data?.nextOffset != null ? (
          <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-tertiary)]">
            <span>Showing the first {rows.length} tasks.</span>
            <Button size="sm" onClick={() => setPageSize((size) => size + 100)} disabled={tasks.isFetching}>
              {tasks.isFetching ? "Loading…" : "Load more"}
            </Button>
          </p>
        ) : null}
      </Group>

      <Drawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add a task"
        subtitle="The task lands in the TASKS project and the Work OS record immediately."
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
          <label className="grid gap-1.5 text-[11.5px] font-medium text-[var(--text-secondary)]">
            Description
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={3}
              placeholder="Context, links, or acceptance notes."
              className="w-full resize-y rounded-[9px] border bg-transparent px-3 py-2 text-[12.5px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
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

/** A labeled column header that sorts the bounded record. */
function SortHeader({ label, active, dir, onClick }: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}) {
  const Icon = active ? (dir === 1 ? ChevronUp : ChevronDown) : ArrowUpDown;
  return (
    <span role="columnheader" aria-sort={active ? (dir === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={onClick}
        className={cx(
          "group/sort inline-flex items-center gap-1 text-left font-medium transition hover:text-[var(--text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
          active ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]",
        )}
      >
        {label}
        <Icon size={11} className={active ? "opacity-100" : "opacity-0 transition group-hover/sort:opacity-60 group-focus-visible/sort:opacity-100"} aria-hidden />
      </button>
    </span>
  );
}
