"use client";

import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
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
  SyncChip,
  cx,
  inlineInputClass,
  inputClass,
  inputStyle,
} from "./ui";

type TaskView = "day" | "open" | "completed" | "all";

type PendingTask = { id: string; title: string; description: string; status: "syncing" | "failed"; error?: string; idempotencyKey: string };

const VIEWS: Array<{ id: TaskView; label: string }> = [
  { id: "day", label: "My day" },
  { id: "open", label: "Unfinished" },
  { id: "completed", label: "Completed" },
  { id: "all", label: "All tasks" },
];

type SortKey = "name" | "due" | "status";
type Sort = { key: SortKey; direction: "asc" | "desc" } | null;
type TaskPage = {
  tasks: AnyRow[];
  totalCount: number;
  nextCursor?: string | null;
  cursor?: { next: string | null };
  counts?: { total: number; open: number; completed: number; overdue?: number };
};

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
  const { day, refresh, sync, syncing } = useEmployeeDay();
  const [view, setView] = useState<TaskView>("day");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [menuTaskId, setMenuTaskId] = useState<string | null>(null);
  const [subtaskMenuId, setSubtaskMenuId] = useState<string | null>(null);
  const [drawer, setDrawer] = useState<{ mode: "create" } | { mode: "edit"; task: AnyRow } | null>(null);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);

  useEffect(() => {
    if (day.data?.shiftDate) setDate((current) => current || day.data!.shiftDate);
  }, [day.data?.shiftDate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setServerSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const order = sort ? `${sort.key === "name" ? "title" : sort.key}_${sort.direction}` : "due_desc";
  const scoped = useInfiniteQuery<TaskPage, Error, { pages: TaskPage[]; pageParams: Array<string | null> }, readonly unknown[], string | null>({
    queryKey: ["work-os", "employee-tasks", view, date, serverSearch, fromDate, toDate, order],
    enabled: !!day.data && (view === "day" ? !!date : view === "open"),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? last.cursor?.next ?? undefined,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ view: view === "day" ? "day" : "open", limit: "50", sort: order.slice(0, order.lastIndexOf("_")), direction: order.slice(order.lastIndexOf("_") + 1) });
      if (view === "day") params.set("date", date);
      else params.set("sortDate", day.data?.shiftDate ?? date);
      if (serverSearch) params.set("search", serverSearch);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (pageParam) params.set("cursor", pageParam);
      return fetchJson<TaskPage>(`/api/work-os/me/tasks?${params}`, { signal });
    },
    staleTime: 60_000,
  });

  const history = useInfiniteQuery<TaskPage, Error, { pages: TaskPage[]; pageParams: Array<string | null> }, readonly unknown[], string | null>({
    queryKey: ["work-os", "employee-tasks", "history", view, serverSearch, fromDate, toDate, order, day.data?.shiftDate ?? ""],
    enabled: view === "completed" || view === "all",
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? last.cursor?.next ?? undefined,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        view: "history",
        includeCompleted: "true",
        limit: "50",
        sort: order.slice(0, order.lastIndexOf("_")),
        direction: order.slice(order.lastIndexOf("_") + 1),
      });
      if (view === "completed") params.set("completed", "true");
      if (day.data?.shiftDate) params.set("sortDate", day.data.shiftDate);
      if (serverSearch) params.set("search", serverSearch);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      if (pageParam) params.set("cursor", pageParam);
      return fetchJson<TaskPage>(`/api/work-os/me/tasks?${params}`, { signal });
    },
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

  // Optimistic add: the row stays visible as syncing until the server
  // confirms it, and a failed add keeps the text with Retry / Discard.
  const createTask = useMutation({
    mutationFn: ({ pending }: { pending: PendingTask }) => fetchJson("/api/work-os/me/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": pending.idempotencyKey },
      body: JSON.stringify({ name: pending.title, description: pending.description || undefined }),
    }),
    onSuccess: (_data, { pending }) => {
      setPendingTasks((current) => current.filter((item) => item.id !== pending.id));
      void refresh();
    },
    onError: (error, { pending }) => {
      setPendingTasks((current) => current.map((item) => item.id === pending.id ? { ...item, status: "failed", error: (error as Error).message } : item));
    },
  });

  const submitCreate = (title: string, description: string) => {
    const pending: PendingTask = { id: `pending-${globalThis.crypto.randomUUID()}`, title, description, status: "syncing", idempotencyKey: requestId() };
    setPendingTasks((current) => [pending, ...current]);
    createTask.mutate({ pending });
  };

  // Backlog tasks can be pulled onto today or explicitly deferred, exactly
  // like the companion's surface/defer actions.
  const surfaceTask = useMutation({
    mutationFn: ({ task, disposition }: { task: AnyRow; disposition: "selected" | "deferred" }) => fetchJson("/api/work-os/me/plan", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "Idempotency-Key": requestId() },
      body: JSON.stringify(disposition === "selected" ? { surface_task_id: task.id } : { defer_task_id: task.id }),
    }),
    onSuccess: () => {
      setMenuTaskId(null);
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
  const activeQuery = isHistoryView ? history : scoped;
  const rawRows = useMemo(() => activeQuery.data?.pages.flatMap((page) => page.tasks) ?? [], [activeQuery.data]);
  const searchPending = search.trim() !== serverSearch;
  const loading = searchPending || (isHistoryView ? history.isLoading : (scoped.isLoading && !scoped.data));
  const error = scoped.error || history.error || changeTask.error || day.error;
  const historical = view === "day" && !!date && !!day.data?.shiftDate && date !== day.data.shiftDate;
  const today = day.data?.shiftDate ?? null;

  const visible = rawRows;

  const activateSort = (key: SortKey) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  const tabCounts: Partial<Record<TaskView, number>> = {
    ...(scoped.data?.pages[0]?.counts && view === "day" ? { day: scoped.data.pages[0].counts.open } : {}),
    ...(scoped.data?.pages[0]?.counts && view === "open" ? { open: scoped.data.pages[0].counts.open } : {}),
    ...(isHistoryView && history.data?.pages[0]?.counts ? {
      [view]: view === "completed" ? history.data.pages[0].counts.completed : history.data.pages[0].counts.total,
    } : {}),
  };

  const searchActive = search.trim().length > 0;
  const filtersActive = searchActive || !!fromDate || !!toDate;
  const totalCount = activeQuery.data?.pages[0]?.totalCount ?? null;
  const resultSummary = searchPending || totalCount === null ? null
    : visible.length < totalCount ? `Showing ${visible.length} of ${totalCount}`
      : filtersActive ? `${totalCount} result${totalCount === 1 ? "" : "s"}` : null;

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
            <SyncChip sync={day.data?.niftySync} syncing={syncing} onSync={() => sync.mutate()} />
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
                  onClick={() => { setView(item.id); setSort(null); setSearch(""); setServerSearch(""); setFromDate(""); setToDate(""); setMenuTaskId(null); }}
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
            <label className="grid gap-0.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
              <span>From</span>
              <input type="date" aria-label="Filter from date" value={fromDate} max={toDate || today || undefined} onChange={(event) => setFromDate(event.target.value)} className={`${inlineInputClass} w-[142px]`} style={inputStyle} />
            </label>
            <label className="grid gap-0.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
              <span>To</span>
              <input type="date" aria-label="Filter to date" value={toDate} min={fromDate || undefined} max={today || undefined} onChange={(event) => setToDate(event.target.value)} className={`${inlineInputClass} w-[142px]`} style={inputStyle} />
            </label>
            {(fromDate || toDate) ? <SecondaryButton className="!px-2.5 !py-1.5 !text-[11px]" onClick={() => { setFromDate(""); setToDate(""); }}>Clear dates</SecondaryButton> : null}
          </div>
        </div>
        {resultSummary ? <p className="border-b px-5 py-2 text-[11px] tabular-nums text-[var(--text-tertiary)]" role="status" style={{ borderColor: "var(--border)" }}>{resultSummary}</p> : null}

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
              {pendingTasks.map((pending) => (
                <li
                  key={pending.id}
                  className="border-b px-5 py-3.5"
                  style={{ borderColor: "var(--border)", background: pending.status === "failed" ? "color-mix(in srgb, var(--status-error) 5%, transparent)" : undefined }}
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center" aria-hidden="true">
                      {pending.status === "syncing"
                        ? <span className="size-3.5 animate-spin rounded-full border-2" style={{ borderColor: "var(--border-hot)", borderTopColor: "transparent" }} />
                        : <AlertTriangle size={14} style={{ color: "var(--status-error)" }} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-[var(--text-primary)]">{pending.title}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                        {pending.status === "syncing" ? "Adding to your workspace…" : `Failed to add — ${pending.error || "retry or discard"}`}
                      </p>
                    </div>
                    {pending.status === "failed" ? (
                      <span className="flex shrink-0 gap-2">
                        <SecondaryButton
                          className="!px-2.5 !py-1.5 !text-[11px]"
                          onClick={() => {
                            setPendingTasks((current) => current.map((item) => item.id === pending.id ? { ...item, status: "syncing", error: undefined } : item));
                            createTask.mutate({ pending });
                          }}
                        >
                          Retry
                        </SecondaryButton>
                        <SecondaryButton className="!px-2.5 !py-1.5 !text-[11px]" onClick={() => setPendingTasks((current) => current.filter((item) => item.id !== pending.id))}>
                          Discard
                        </SecondaryButton>
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
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
                          {subtasks.length ? (
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
                              {view === "open" && !completed ? (
                                <>
                                  <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => surfaceTask.mutate({ task, disposition: "selected" })}>
                                    <Plus size={13} /> Add to today
                                  </button>
                                  <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => surfaceTask.mutate({ task, disposition: "deferred" })}>
                                    <CircleDot size={13} /> Defer
                                  </button>
                                </>
                              ) : null}
                              {view === "day" && task.dayAttribution?.date && String(task.dayAttribution.date) < date ? (
                                <button role="menuitem" className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--bg-tertiary)]" onClick={() => { setMenuTaskId(null); setDate(String(task.dayAttribution.date)); }}>
                                  <ChevronRight size={13} /> Open original day
                                </button>
                              ) : null}
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
            {activeQuery.hasNextPage ? (
              <div className="flex justify-center border-t px-5 py-3.5" style={{ borderColor: "var(--border)" }}>
                <SecondaryButton disabled={activeQuery.isFetchingNextPage} onClick={() => void activeQuery.fetchNextPage()}>
                  {activeQuery.isFetchingNextPage ? "Loading…" : activeQuery.isFetchNextPageError ? "Retry load more" : "Load more"}
                </SecondaryButton>
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={<ListTodo size={20} />}
            title={filtersActive ? "No tasks match these filters" : view === "day" ? (historical ? "Nothing was recorded for this day" : "No tasks are attributed to today") : view === "open" ? "Nothing is unfinished" : view === "completed" ? "No completed tasks yet" : "No tasks yet"}
            message={filtersActive ? "Clear the search and dates to see every task in this view." : view === "day" ? "Add a task or plan your day to get started." : undefined}
            action={filtersActive ? <SecondaryButton onClick={() => { setSearch(""); setServerSearch(""); setFromDate(""); setToDate(""); }}>Clear filters</SecondaryButton> : view === "day" && !historical ? <PrimaryButton onClick={() => setDrawer({ mode: "create" })}><Plus size={14} /> Add task</PrimaryButton> : undefined}
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
          onCreate={submitCreate}
        />
      ) : null}
    </div>
  );
}
