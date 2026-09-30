"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery } from "@tanstack/react-query";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { useEmployeeDay } from "./useEmployeeDay";
import EmployeeTaskDrawer from "./EmployeeTaskDrawer";
import { fetchJson, requestId, operationLabel, type AnyRow } from "./model";
import {
  EmptyState,
  IconButton,
  Masthead,
  Notice,
  Panel,
  PrimaryButton,
  SecondaryButton,
  Skeleton,
  StatusPill,
  cx,
  inlineInputClass,
  inputClass,
  inputStyle,
} from "./ui";

type TaskView = "day" | "open" | "completed" | "all";

const VIEWS: Array<{ id: TaskView; label: string }> = [
  { id: "day", label: "My day" },
  { id: "open", label: "Unfinished" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All tasks" },
];

type SortKey = "name" | "due" | "status";
type Sort = { key: SortKey; direction: "asc" | "desc" } | null;

function isOverdue(task: AnyRow, today: string | null | undefined) {
  return task.completed !== true && !!task.due_date && !!today && String(task.due_date) < today;
}

function TaskAssigneeTags({ task }: { task: AnyRow }) {
  const people = Array.isArray(task.assignees) ? task.assignees.filter((person: AnyRow) => typeof person?.displayName === "string") : [];
  if (!people.length) return null;
  return (
    <span className="flex flex-wrap gap-1" aria-label={`Assigned to ${people.map((person: AnyRow) => person.displayName).join(", ")}`}>
      {people.map((person: AnyRow) => (
        <span key={person.personId || person.displayName} title={person.email || person.displayName} className="inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
          {person.displayName}
        </span>
      ))}
    </span>
  );
}

export default function EmployeeTasks() {
  const { day, refresh } = useEmployeeDay();
  const [view, setView] = useState<TaskView>("day");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [subtaskMenuId, setSubtaskMenuId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; task: AnyRow } | null>(null);

  const openedRef = useRef(false);
  useEffect(() => {
    if (day.data?.shiftDate) setDate((current) => current || day.data!.shiftDate);
  }, [day.data?.shiftDate]);
  useEffect(() => {
    if (day.data?.shiftDate) openedRef.current = true;
  }, [day.data?.shiftDate]);

  const scoped = useQuery<{ tasks: AnyRow[]; counts: { total: number; open: number; completed: number } | null }>({
    queryKey: ["work-os", "employee-tasks", view, date],
    enabled: !!day.data && (view === "day" ? !!date : view === "open"),
    queryFn: async () => {
      if (view === "day") {
        const payload = await fetchJson<{ tasks: AnyRow[]; workspace: AnyRow; cursor: { next: string | null } }>(`/api/work-os/me/tasks?view=day&date=${encodeURIComponent(date)}&limit=100`);
        const tasks = payload.tasks ?? [];
        return { tasks, counts: { total: tasks.length, open: tasks.filter((task) => task.completed !== true).length, completed: tasks.filter((task) => task.completed === true).length } };
      }
      const payload = await fetchJson<{ tasks: AnyRow[]; counts: { total: number; open: number; completed: number } }>("/api/work-os/me/tasks?view=open");
      return { tasks: payload.tasks ?? [], counts: payload.counts ?? null };
    },
    staleTime: 60_000,
  });

  const history = useInfiniteQuery<{ tasks: AnyRow[]; nextOffset: number | null }>({
    queryKey: ["work-os", "employee-tasks", "history", view],
    enabled: view === "completed" || view === "all",
    queryFn: ({ pageParam }) => fetchJson<{ tasks: AnyRow[]; nextOffset: number | null }>(`/api/work-os/me/tasks?view=history${view === "completed" ? "&completed=true" : ""}&includeCompleted=true&limit=50&offset=${typeof pageParam === "number" ? pageParam : 0}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (typeof last.nextOffset === "number" ? last.nextOffset : undefined),
    staleTime: 60_000,
  });

  const changeTask = useMutation({
    mutationFn: ({ task, body, method = "PATCH", mode }: { task: AnyRow; body?: AnyRow; method?: "PATCH" | "DELETE"; mode?: "archive" | "delete" }) => fetchJson(`/api/work-os/me/tasks/${encodeURIComponent(String(task.provider_task_id || task.id))}${method === "DELETE" ? `?mode=${mode ?? "archive"}` : ""}`, {
      method,
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
    onSuccess: () => {
      setMenuTaskId(null);
      setSubtaskMenuId(null);
      void refresh();
    },
  });

  useEffect(() => {
    if (!menuTaskId && !subtaskMenuId) return;
    const close = () => { setMenuTaskId(null); setSubtaskMenuId(null); };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("[data-task-menu-root]")) return;
      close();
    };
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuTaskId, subtaskMenuId]);

  const isHistoryView = view === "completed" || view === "all";
  const rawRows = useMemo(
    () => (isHistoryView ? history.data?.pages.flatMap((page) => page.tasks) ?? [] : scoped.data?.tasks ?? []),
    [isHistoryView, history.data, scoped.data],
  );
  const loading = isHistoryView ? history.isLoading : (scoped.isLoading && !scoped.data);
  const error = scoped.error || history.error || changeTask.error || day.error;
  const historical = view === "day" && !!date && !!day.data?.shiftDate && date !== day.data.shiftDate;
  const today = day.data?.shiftDate ?? null;

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = query
      ? rawRows.filter((task) => `${String(task.title ?? "")} ${String(task.description ?? "")}`.toLowerCase().includes(query))
      : rawRows;
    const list = [...filtered];
    if (sort?.key === "name") list.sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")) * (sort.direction === "asc" ? 1 : -1));
    if (sort?.key === "due") list.sort((a, b) => String(a.due_date ?? "9999-12-31").localeCompare(String(b.due_date ?? "9999-12-31")) * (sort.direction === "asc" ? 1 : -1));
    if (sort?.key === "status") list.sort((a, b) => (Number(a.completed === true) - Number(b.completed === true)) * (sort.direction === "asc" ? 1 : -1));
    return list;
  }, [rawRows, search, sort]);

  const activateSort = (key: SortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const tabCounts: Partial<Record<TaskView, number>> = {
    ...(scoped.data?.counts && view === "day" ? { day: scoped.data.counts.open } : {}),
    ...(scoped.data?.counts && view === "open" ? { open: scoped.data.counts.open } : {}),
    ...(isHistoryView && history.data ? { [view]: rawRows.length } : {}),
  };

  const searchActive = search.trim().length > 0;

  return (
    <div>
      <Masthead
        eyebrow="Work OS"
        title="Tasks"
        meta={view === "day" ? (historical ? `Historical workspace — read-only.` : "Today’s workspace and its open work.") : "Everything attributed to you."}
        actions={
          <>
            {view === "day" ? (
              <>
                <input
                  type="date"
                  value={date}
                  max={today ?? undefined}
                  onChange={(event) => setDate(event.target.value)}
                  aria-label="Task date"
                  className={`${inlineInputClass} w-auto`}
                  style={inputStyle}
                />
                {historical ? (
                  <SecondaryButton onClick={() => setDate(today ?? "")}>Back to today</SecondaryButton>
                ) : null}
              </>
            ) : null}
            <IconButton label="Refresh tasks" onClick={() => void refresh()} disabled={scoped.isFetching || history.isFetching}>
              <RefreshCw size={15} className={scoped.isFetching || history.isFetching ? "animate-spin" : undefined} />
            </IconButton>
            <PrimaryButton disabled={historical} onClick={() => setDrawer({ mode: "create" })}>
              <Plus size={14} /> Add task
            </PrimaryButton>
          </>
        }
      />

      {error ? <Notice tone="err" className="mb-5">{(error as Error).message}</Notice> : null}

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
          <nav aria-label="Task views" className="flex flex-wrap gap-1">
            {VIEWS.map((item) => {
              const active = view === item.id;
              const count = tabCounts[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { setView(item.id); setSort(null); setSearch(""); setMenuTaskId(null); }}
                  aria-current={active ? "true" : undefined}
                  className={cx("rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition", active ? "" : "hover:bg-[var(--bg-tertiary)]")}
                  style={active
                    ? { background: "color-mix(in srgb, var(--accent-deep) 12%, var(--bg-card))", color: "var(--accent-deep)", border: "1px solid color-mix(in srgb, var(--accent-deep) 30%, var(--border))" }
                    : { color: "var(--text-secondary)", border: "1px solid transparent" }}
                >
                  {item.label}
                  {typeof count === "number" ? <span className="ml-1.5 tabular-nums text-[11px] opacity-70">{count}</span> : null}
                </button>
              );
            })}
          </nav>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search tasks"
                aria-label="Search tasks"
                className={`${inputClass} w-[220px] pl-8`}
                style={inputStyle}
              />
            </label>
          </div>
        </div>

        {loading ? (
          <div aria-busy="true" className="grid gap-3 px-5 py-5">
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="size-5 rounded-full" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="hidden h-4 w-24 md:block" />
              </div>
            ))}
          </div>
        ) : visible.length ? (
          <>
            <div className="hidden items-center gap-3 border-b px-5 py-2 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)] md:flex" style={{ borderColor: "var(--border)" }}>
              <span className="w-5 shrink-0" aria-hidden="true" />
              <button type="button" onClick={() => activateSort("name")} className="flex flex-1 items-center gap-1 text-left hover:text-[var(--text-primary)]">
                Name {sort?.key === "name" ? (sort.direction === "asc" ? "↑" : "↓") : null}
              </button>
              <span className="hidden w-20 shrink-0 md:block">Progress</span>
              <button type="button" onClick={() => activateSort("due")} className="hidden w-28 items-center gap-1 md:flex hover:text-[var(--text-primary)]">
                Date due {sort?.key === "due" ? (sort.direction === "asc" ? "↑" : "↓") : null}
              </button>
              <button type="button" onClick={() => activateSort("status")} className="flex w-24 items-center gap-1 hover:text-[var(--text-primary)]">
                Status {sort?.key === "status" ? (sort.direction === "asc" ? "↑" : "↓") : null}
              </button>
              <span className="w-9 shrink-0" aria-hidden="true" />
            </div>
            <ul>
              {visible.map((task) => {
                const taskId = String(task.provider_task_id || task.id);
                const subtasks = historical ? [] : Array.isArray(task.subtasks) ? task.subtasks : [];
                const progress = task.subtaskProgress ?? { completed: Number(task.subtask_completed ?? 0), total: Number(task.subtask_total ?? 0) };
                const completed = task.completed === true;
                const overdue = isOverdue(task, today);
                const isWorkOsTask = String(task.provider ?? "") === "local";
                const expanded = expandedTaskId === taskId;
                return (
                  <li key={task.id} className="relative border-b last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-start gap-3 px-5 py-3.5">
                      <button
                        type="button"
                        aria-label={completed ? `Reopen ${task.title}` : `Mark ${task.title} done`}
                        disabled={historical || changeTask.isPending}
                        onClick={() => changeTask.mutate({ task, body: { completed: !completed } })}
                        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border transition hover:border-[var(--accent-deep)] disabled:opacity-45"
                        style={{ borderColor: completed ? "var(--accent-deep)" : "var(--border-hot)", background: completed ? "var(--accent-deep)" : "transparent", color: completed ? "var(--bg-card)" : "transparent" }}
                      >
                        <Check size={12} strokeWidth={3} />
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {subtasks.length || expandedTaskId ? (
                            <button
                              type="button"
                              aria-label={`${expanded ? "Collapse" : "Expand"} ${task.title}`}
                              onClick={() => setExpandedTaskId(expanded ? null : taskId)}
                              className="text-[var(--text-tertiary)]"
                            >
                              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                            </button>
                          ) : null}
                          <p className={cx("min-w-0 break-words text-[13px] font-medium", completed ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]")}>{task.title}</p>
                          <TaskAssigneeTags task={task} />
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
                          {task.project?.name ? <span>{task.project.name}</span> : null}
                          {task.milestone?.name ? <span>{task.milestone.name}</span> : null}
                          {task.priority ? <span>{operationLabel(String(task.priority))}</span> : null}
                          <span>{isWorkOsTask ? "Work OS task" : task.synced_at ? "Nifty synced" : "Sync pending"}</span>
                        </div>
                      </div>

                      {progress.total > 0 ? (
                        <span className="hidden w-20 shrink-0 items-center gap-1.5 pt-0.5 text-[11px] tabular-nums text-[var(--text-tertiary)] md:flex" title={`${progress.completed} of ${progress.total} subtasks complete`}>
                          {progress.completed}/{progress.total}
                        </span>
                      ) : (
                        <span className="hidden w-20 shrink-0 md:block" aria-hidden="true" />
                      )}
                      <span className="hidden w-28 shrink-0 pt-0.5 text-[11px] tabular-nums text-[var(--text-secondary)] md:block">
                        {task.due_date ? String(task.due_date) : "No date"}
                      </span>
                      <span className="shrink-0 pt-0.5">
                        <StatusPill tone={completed ? "done" : overdue ? "overdue" : "open"}>{completed ? "Done" : overdue ? "Overdue" : "Open"}</StatusPill>
                      </span>
                      {!historical ? (
                        <span className="shrink-0" data-task-menu-root>
                          <IconButton
                            label={`Actions for ${task.title}`}
                            className="!size-8"
                            onClick={() => setMenuTaskId(menuTaskId === taskId ? null : taskId)}
                          >
                            <MoreHorizontal size={15} />
                          </IconButton>
                          {menuTaskId === taskId ? (
                            <div className="absolute right-5 top-12 z-20 grid min-w-48 rounded-xl border p-1 text-[12px] shadow-xl" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }} role="menu">
                              <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => changeTask.mutate({ task, body: { completed: !completed } })}>
                                {completed ? <RotateCcw size={13} /> : <Check size={13} />}{completed ? "Reopen" : "Mark done"}
                              </button>
                              <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => { setDrawer({ mode: "edit", task }); setMenuTaskId(null); }}>
                                <Pencil size={13} /> Edit
                              </button>
                              <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => window.confirm(isWorkOsTask ? "Archive this task? It will be hidden from active work but retained in Work OS history." : "Archive this task? It will be hidden from active work but retained and restorable in Nifty.") && changeTask.mutate({ task, method: "DELETE", mode: "archive" })}>
                                <Archive size={13} /> Archive (reversible)
                              </button>
                              <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left" style={{ color: "var(--status-error)" }} onClick={() => window.confirm(isWorkOsTask ? "Permanently delete this task from Work OS? This cannot be undone." : "Permanently delete this task from Nifty? This cannot be undone.") && changeTask.mutate({ task, method: "DELETE", mode: "delete" })}>
                                <Trash2 size={13} /> Delete permanently
                              </button>
                            </div>
                          ) : null}
                        </span>
                      ) : null}
                    </div>

                    {expanded && subtasks.length ? (
                      <div className="ml-11 mr-5 mb-3 border-t pt-1" style={{ borderColor: "var(--border)" }}>
                        {subtasks.map((subtask: AnyRow) => {
                          const subtaskId = String(subtask.provider_task_id || subtask.id);
                          const subtaskDone = subtask.completed === true;
                          return (
                            <div key={subtask.id} className="relative flex items-center gap-2 py-1.5 text-[12px]">
                              <button
                                type="button"
                                aria-label={subtaskDone ? `Reopen ${subtask.title}` : `Mark ${subtask.title} done`}
                                disabled={historical || changeTask.isPending}
                                onClick={() => changeTask.mutate({ task: subtask, body: { completed: !subtaskDone } })}
                                className="grid size-4 shrink-0 place-items-center rounded-full border"
                                style={{ borderColor: subtaskDone ? "var(--accent-deep)" : "var(--border-hot)", background: subtaskDone ? "var(--accent-deep)" : "transparent", color: subtaskDone ? "var(--bg-card)" : "transparent" }}
                              >
                                <Check size={10} strokeWidth={3} />
                              </button>
                              <CircleDot size={11} className="shrink-0 text-[var(--text-tertiary)]" />
                              <span className={cx("min-w-0 flex-1 break-words", subtaskDone ? "text-[var(--text-tertiary)] line-through" : "text-[var(--text-primary)]")}>{subtask.title}</span>
                              {!historical ? (
                                <span data-task-menu-root>
                                  <button type="button" aria-label={`Actions for ${subtask.title}`} className="rounded-md border p-1.5" style={{ borderColor: "var(--border)" }} onClick={() => setSubtaskMenuId(subtaskMenuId === subtaskId ? null : subtaskId)}>
                                    <MoreHorizontal size={13} />
                                  </button>
                                  {subtaskMenuId === subtaskId ? (
                                    <div className="absolute right-0 top-8 z-30 grid min-w-48 rounded-xl border p-1 shadow-xl" role="menu" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
                                      <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => changeTask.mutate({ task: subtask, body: { completed: !subtaskDone } })}>
                                        {subtaskDone ? <RotateCcw size={13} /> : <Check size={13} />}{subtaskDone ? "Reopen" : "Mark done"}
                                      </button>
                                      <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => { setDrawer({ mode: "edit", task: subtask }); setSubtaskMenuId(null); }}>
                                        <Pencil size={13} /> Edit
                                      </button>
                                      <label className="grid gap-1 border-t px-2.5 py-1.5 text-[10px] text-[var(--text-tertiary)]" style={{ borderColor: "var(--border)" }}>
                                        Move to parent
                                        <select
                                          aria-label={`Move ${subtask.title}`}
                                          value=""
                                          className="rounded-md border bg-transparent px-2 py-1 text-[11px] text-[var(--text-primary)]"
                                          style={{ borderColor: "var(--border)" }}
                                          onChange={(event) => event.target.value && changeTask.mutate({ task: subtask, body: { parent_task_id: event.target.value } })}
                                        >
                                          <option value="">Choose…</option>
                                          {rawRows.filter((target) => target.id !== task.id && !target.completed).map((target) => (
                                            <option key={target.id} value={target.provider_task_id || target.id}>{target.title}</option>
                                          ))}
                                        </select>
                                      </label>
                                      <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => window.confirm(String(subtask.provider ?? "") === "local" ? "Archive this subtask? It will be hidden but retained in Work OS history." : "Archive this subtask? It will be hidden but retained and restorable in Nifty.") && changeTask.mutate({ task: subtask, method: "DELETE", mode: "archive" })}>
                                        <Archive size={13} /> Archive (reversible)
                                      </button>
                                      <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left" style={{ color: "var(--status-error)" }} onClick={() => window.confirm(String(subtask.provider ?? "") === "local" ? "Permanently delete this subtask from Work OS? This cannot be undone." : "Permanently delete this subtask from Nifty? This cannot be undone.") && changeTask.mutate({ task: subtask, method: "DELETE", mode: "delete" })}>
                                        <Trash2 size={13} /> Delete permanently
                                      </button>
                                    </div>
                                  ) : null}
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {isHistoryView && history.hasNextPage ? (
              <div className="flex justify-center border-t px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
                <SecondaryButton disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
                  {history.isFetchingNextPage ? "Loading…" : "Show more"}
                </SecondaryButton>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={<ListTodo size={20} />}
            title={searchActive ? "No tasks match these filters" : view === "day" ? (historical ? "Nothing was recorded for this day" : "No tasks are attributed to today") : view === "open" ? "Nothing is unfinished" : view === "completed" ? "No completed tasks yet" : "No tasks yet"}
            message={searchActive ? "Clear the search to see every task in this view." : view === "day" ? "Add a task or plan your day to get started." : undefined}
            action={searchActive ? <SecondaryButton onClick={() => setSearch("")}>Clear search</SecondaryButton> : view === "day" && !historical ? <PrimaryButton onClick={() => setDrawer({ mode: "create" })}><Plus size={14} /> Add task</PrimaryButton> : undefined}
          />
        )}
      </Panel>

      {drawer ? (
        <EmployeeTaskDrawer
          mode={drawer.mode}
          task={drawer.mode === "edit" ? drawer.task : null}
          isWorkOsTask={drawer.mode === "edit" ? String(drawer.task.provider ?? "") === "local" : false}
          onClose={() => setDrawer(null)}
          onSaved={() => void refresh()}
        />
      ) : null}
    </div>
  );
}
