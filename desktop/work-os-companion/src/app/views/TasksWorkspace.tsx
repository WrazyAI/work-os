import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, CirclePause, Plus, RefreshCw, Search, Target } from "lucide-react";
import { formatWorkOsDate } from "../../dateFormat";
import { buildFocusPlan } from "../../focusPlan";
import { useListShift } from "../../listShift";
import { FadeArc, TaskListSkeleton } from "../../LoadingUi";
import { MASCOT } from "../../mascot";
import { OverflowPanText } from "../../OverflowPan";
import { ProgressRing } from "../../ProgressRing";
import { Empty } from "../../SharedUi";
import { SortHeaderRow } from "../../SortHeaderRow";
import { displayTaskState, hasTaskMenu, taskCheckboxA11y, taskCheckboxEnabled, taskStatusLabel } from "../../taskActions";
import { TaskFinder } from "../../TaskFinder";
import { TaskFocusDetails } from "../../TaskFocusDetails";
import { AssigneeTags, EllipsisMenu, TaskActionMenuItems, TaskCarryOverFlyout } from "../../taskSurfaces";
import { taskViewTabIndex } from "../../taskViewTabs";
import { dayScopedTasks, dayTaskGroups, DEFAULT_TASK_SORT, filterWorkspaceTasks, parentTasks, safeTaskText, sortTaskList, subtaskProgress, suggestDailyGoal, taskDateAttribution, tasksForDate, TASKS_WORKSPACE_SORT_COLUMNS, taskState, unfinishedBefore, uniqueTasks, type TaskRow, type TaskSort } from "../../taskWorkspace";
import type { DailyPlan } from "../../types";
import type { TaskBacklog, TaskFinderSource } from "../../workOsQueries";
import { moveDate, sentence } from "../constants";
import type { TaskView } from "../types";
import { PendingTaskControls } from "./ActiveDayWorkspace";

/** Render the employee Tasks workspace with shared day history and sorted paginated views. */
export function TasksWorkspace({ finderScope, finderSource, onFinderOpenChange, currentDate, historyDate, backlog = null, backlogLoading = false, backlogError = false, currentPlan, historicalPlan, historicalTasks, goal, goalProvenance, suggestion, saveState, taskView, taskSort, todayTasks, focusTasks, taskHistory, workspaceHistory = taskHistory, completedHistory = null, unfinishedHistory = null, pageCounts = null, pageTotal = null, taskSearch = "", filterFrom = "", filterTo = "", historyOrder = "local", historyError = false, historyHasData = false, carryOver, carryOverOpen, loadingMore, loadMoreError = false, hasMore, busy, initialTaskMenuId = null, initialFiltersOpen = false, loading = false, onTaskView, onTaskSort, onDate, onEditFocus, onAddTask, onOpenTask, onEditTask, onArchiveTask, onDeleteTask = () => undefined, onSurfaceTask, onTaskCompletion, onCarryOverOpen, onLoadMore, onRetryHistory, onRetryPendingTask, onDismissPendingTask, onRetryGoalSave, taskFlight, onStatusTask, onAssignTask }: {
  finderScope?: string; finderSource?: TaskFinderSource; onFinderOpenChange?: (open: boolean) => void;
  onStatusTask?: (task: TaskRow, status: "pending" | "in_progress") => void;
  onAssignTask?: (task: TaskRow) => void;
  currentDate: string; historyDate: string; currentPlan: DailyPlan | null; historicalPlan: DailyPlan | null; historicalTasks: TaskRow[]; goal: string;
  goalProvenance: "employee" | "suggested" | "accepted_suggestion" | "ai_draft" | null; suggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  taskView: TaskView; taskSort: TaskSort; todayTasks: TaskRow[]; focusTasks?: TaskRow[]; taskHistory: TaskRow[]; workspaceHistory?: TaskRow[]; completedHistory?: TaskRow[] | null; unfinishedHistory?: TaskRow[] | null;
  pageCounts?: { total: number; open: number; completed: number } | null; pageTotal?: number | null;
  taskSearch?: string; filterFrom?: string; filterTo?: string;
  historyOrder?: "server" | "local"; historyError?: boolean; historyHasData?: boolean; onRetryHistory?: () => void;
  carryOver: ReturnType<typeof unfinishedBefore>; carryOverOpen: boolean;
  backlog?: TaskBacklog | null; backlogLoading?: boolean; backlogError?: boolean;
  loadingMore: boolean; loadMoreError?: boolean; hasMore: boolean; busy: boolean; onTaskView: (view: TaskView) => void; onTaskSort: (sort: TaskSort) => void; onDate: (date: string) => Promise<void>;
  onEditFocus: () => void; onAddTask: () => void; onOpenTask: (task: TaskRow, readOnly: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask?: (task: TaskRow) => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void; onTaskCompletion: (task: TaskRow, completed: boolean) => void; onCarryOverOpen: (open: boolean) => void; onLoadMore: () => void;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
  onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void; onRetryGoalSave?: () => void;
  initialTaskMenuId?: string | null; initialFiltersOpen?: boolean; loading?: boolean;
  onTaskSearch?: (value: string) => void; onFilterFrom?: (value: string) => void; onFilterTo?: (value: string) => void;
}) {
  const [taskMenuId, setTaskMenuId] = useState<string | null>(initialTaskMenuId);
  const [finderEntry, setFinderEntry] = useState<"search" | "date" | null>(initialFiltersOpen ? "date" : null);
  useEffect(() => { onFinderOpenChange?.(finderEntry !== null); }, [finderEntry, onFinderOpenChange]);
  useEffect(() => () => onFinderOpenChange?.(false), [onFinderOpenChange]);
  const taskTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedDate = historyDate || currentDate;
  const historical = selectedDate !== currentDate;
  const shownPlan = historical ? historicalPlan : currentPlan;
  const planTasks = historical ? historicalTasks : focusTasks ?? todayTasks;
  const focusPlan = buildFocusPlan(shownPlan, planTasks);
  const focusPlanPercent = focusPlan.total ? Math.round((focusPlan.completed / focusPlan.total) * 100) : 0;
  const historyById = new Map<string, TaskRow>();
  for (const task of [...taskHistory, ...workspaceHistory, ...(completedHistory ?? []), ...historicalTasks]) {
    historyById.set(String(task.id), task);
    if (task.provider_task_id) historyById.set(String(task.provider_task_id), task);
  }
  const surfaced = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => historyById.get(String(item.task_id)) ?? {
    id: item.task_id, title: item.title_snapshot, completed: item.completion_state === "completed", workspace_source: item.source,
  });
  const surfacedIds = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => String(item.task_id));
  const rowId = (task: TaskRow) => String(task.provider_task_id || task.id);
  // My day is strictly day-scoped and shares one definition with the dashboard
  // hero (design §27.3), so both surfaces count the identical set.
  const myDayTasks = dayScopedTasks(todayTasks, currentPlan?.items ?? [], currentDate, [...taskHistory, ...historicalTasks]);
  const myDayIds = new Set(myDayTasks.map(rowId));
  // Live Unfinished pages are server-filtered and cursor-paged. Until a page
  // exists, the complete backlog minus today's workspace is the exact
  // exclude-today set the Unfinished view renders.
  const backlogParents = parentTasks(uniqueTasks(backlog?.tasks ?? []));
  const unfinishedFallback = backlog
    ? backlogParents.filter((task) => !myDayIds.has(rowId(task)))
    : taskHistory.filter((task) => task.completed !== true && !myDayIds.has(rowId(task)));
  const unfinishedTasks = unfinishedHistory ?? unfinishedFallback;
  const completedTasks = completedHistory ?? taskHistory.filter((task) => task.completed === true);
  const datedTasks = parentTasks(tasksForDate([...historicalTasks, ...surfaced], selectedDate, surfacedIds));
  const displayedCandidates = historical
    ? datedTasks
    : taskView === "today" ? myDayTasks
      : taskView === "unfinished" ? unfinishedTasks
        : taskView === "completed" ? completedTasks
          : workspaceHistory;
  const unfiltered = parentTasks(uniqueTasks(displayedCandidates));
  // Paginated history views arrive already filtered and sorted by the server;
  // re-filtering here would re-apply the older client rules and could hide
  // rows the server (and its counts) kept. My day still filters locally
  // because `dayScopedTasks` merges plan-surfaced rows on the client.
  const serverBackedRows = !historical && taskView !== "today";
  const displayed = historyOrder === "server" && serverBackedRows
    ? unfiltered
    : filterWorkspaceTasks(unfiltered, currentDate, { query: taskSearch, from: filterFrom, to: filterTo });
  const hasFilters = taskSearch.trim().length > 0 || filterFrom.length > 0 || filterTo.length > 0;
  const viewLabel = taskView === "today" ? "My day" : taskView === "unfinished" ? "Unfinished" : taskView === "completed" ? "Completed" : "All tasks";
  // Every chip counts the exact parents its view will render, subtasks and
  // duplicates excluded, so a chip can never disagree with its own list.
  const serverCounts = backlog?.counts ?? null;
  // Null counts mean the server does not provide totals yet; chips fall back to
  // the loaded window and no pagination note is claimed.
  const chipCounts: Array<{ id: TaskView; label: string; count: number }> = [
    { id: "today", label: "My day", count: dayTaskGroups(myDayTasks, currentDate, taskSort).reduce((sum, group) => sum + group.tasks.filter((task) => task.completed !== true).length, 0) },
    { id: "unfinished", label: "Unfinished", count: taskView === "unfinished" ? pageCounts?.open ?? parentTasks(uniqueTasks(unfinishedTasks)).length : parentTasks(uniqueTasks(unfinishedFallback)).length },
    { id: "completed", label: "Completed", count: (taskView === "all" || taskView === "completed") && pageCounts ? pageCounts.completed : serverCounts?.completed ?? parentTasks(uniqueTasks(completedTasks)).length },
    { id: "all", label: "All tasks", count: (taskView === "all" || taskView === "completed") && pageCounts ? pageCounts.total : serverCounts?.total ?? parentTasks(uniqueTasks(workspaceHistory)).length },
  ];
  // Peer views keep one tab stop and move between views with the shared
  // ←/→/Home/End contract (design §8.13).
  const onTaskTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = taskViewTabIndex(index, event.key, chipCounts.length);
    if (next === null) return;
    event.preventDefault();
    onTaskView(chipCounts[next].id);
    requestAnimationFrame(() => taskTabRefs.current[next]?.focus());
  };
  // Paginated views say how much of the server total is on screen so a chip
  // can never look like it disagrees with its own list.
  const viewTotal = pageTotal ?? (historical ? null : taskView === "all" ? serverCounts?.total ?? null : taskView === "completed" ? serverCounts?.completed ?? null : null);
  const overflowNote = viewTotal !== null && unfiltered.length < viewTotal ? `Showing ${unfiltered.length} of ${viewTotal}` : null;
  // My day is open work only: completed tasks move to the Completed view.
  // All / Completed arrive globally ordered from SQL before pagination; do not
  // re-sort flattened pages on the client or rows can cross page boundaries.
  const rowsForDisplay = taskView === "today" && !historical
    ? displayed.filter((task) => task.completed !== true)
    : displayed;
  // Only server-backed views arrive pre-sorted. My day is assembled on the
  // client, so it must apply the active sort here or the header arrows lie.
  const displayedTasks = !historical && historyOrder === "server" && serverBackedRows
    ? rowsForDisplay
    : sortTaskList(rowsForDisplay, taskSort, currentDate);

  // My day renders urgency groups from the same rows the filters left behind.
  const dayGroupsForDisplay = taskView === "today" && !historical
    ? dayTaskGroups(displayedTasks, currentDate, taskSort)
    : [];

  // The project line only earns its space when the view actually mixes projects.
  const showRowProjects = new Set(displayedTasks.map((task) => safeTaskText(task.project?.name, "Work OS"))).size > 1;
  const listRef = useRef<HTMLDivElement | null>(null);
  useListShift(listRef);
  const selectedIds = new Set((currentPlan?.items ?? []).filter((item) => item.disposition === "selected" && item.task_id).map((item) => String(item.task_id)));
  const groups = new Map<string, typeof carryOver>();
  for (const item of carryOver) {
    const key = item.attribution.date ?? "Older";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const carryGroups = [...groups.entries()].map(([date, items]) => ({ date, label: date === moveDate(currentDate, -1) ? `Yesterday · ${formatWorkOsDate(date)}` : formatWorkOsDate(date), items }));
  const agendaText = historical
    ? shownPlan?.focus_summary ?? (shownPlan?.freeform_intent || "No focus note was recorded for this day.")
    : goal || suggestion?.text || "Your open tasks define today’s work.";
  const provenance = historical
    ? !shownPlan?.freeform_intent ? "Task record" : shownPlan.goal_provenance === "suggested" ? `Suggested by ${MASCOT.name}` : shownPlan.goal_provenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : shownPlan.goal_provenance === "accepted_suggestion" ? "Accepted from that day’s tasks" : "Written on this day"
    : goal ? goalProvenance === "suggested" ? `Suggested by ${MASCOT.name}` : goalProvenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : goalProvenance === "accepted_suggestion" ? "Accepted from today’s tasks" : "Written by you" : suggestion ? "Suggested from today’s tasks" : "Task record";
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  // One source for the day's groups: they are built from the same my-day list
  // the view renders, so a group's count can never contradict the rows beneath
  // it. The strip no longer restates those counts — it states the focus and the
  // carry action, and the groups and view chips carry the numbers.
  const dayGroups = dayTaskGroups(myDayTasks, currentDate, taskSort);
  const emptyCopy = hasFilters
    ? { title: "No tasks match these filters", body: "Try a different search or clear the date filters." }
    : historical
      ? { title: "No tasks surfaced", body: "No tasks were recorded for this day." }
      : taskView === "today"
        ? { title: "Nothing is scheduled for today yet", body: "Pull unfinished work forward or add a task to shape the day." }
        : taskView === "unfinished"
          ? { title: "No unfinished work", body: "Open tasks from previous days will appear here." }
          : taskView === "completed"
            ? { title: "No completed tasks", body: "Completed tasks will appear here." }
            : { title: "No tasks yet", body: "Add your first task to get started." };
  const renderTaskRow = (task: TaskRow) => {
      const attribution = taskDateAttribution(task, currentDate);
      const taskId = rowId(task);
      const menuOpen = taskMenuId === taskId;
      const progress = subtaskProgress(task);
      // "On today" is a plan fact, not a selection. It used to be published as
      // aria-selected, which is invalid on role="button" and — because every
      // My day row is on today's plan — made the whole list wear §6.3's selected
      // chrome at once, so selection stopped discriminating.
      const onTodayPlan = selectedIds.has(String(task.id)) || selectedIds.has(String(task.provider_task_id));
      const state = taskState(task, currentDate);
      const displayState = displayTaskState(task, currentDate);
      const title = safeTaskText(task.title, "Untitled task");
      const description = safeTaskText(task.description, "");
      // §6.2: the description renders only when it adds something beyond the
      // title. Literal containment only caught a description that repeated the
      // title's own words verbatim, so a reworded restatement still cost the row
      // a third line; counting the title's vocabulary catches both.
      const descriptionEchoesTitle = (() => {
        const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const titleText = normalize(title);
        const descriptionText = normalize(description);
        if (descriptionText.length === 0) return true;
        if (titleText.length === 0) return false;
        if (descriptionText === titleText || descriptionText.includes(titleText)) return true;
        // Words of four letters or more carry the meaning; articles and
        // prepositions only dilute the comparison.
        const contentWords = (value: string) => value.split(" ").filter((word) => word.length > 3);
        const titleWords = new Set(contentWords(titleText));
        const descriptionWords = contentWords(descriptionText);
        if (titleWords.size === 0 || descriptionWords.length === 0) return false;
        const carried = descriptionWords.filter((word) => titleWords.has(word)).length;
        return carried / descriptionWords.length >= 0.8;
      })();
      const projectName = safeTaskText(task.project?.name, "Work OS");
      const milestoneName = safeTaskText(task.milestone?.name, "");
      const dueDate = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
      const dueInline = dueDate ? (state === "overdue" ? `Overdue · ${formatWorkOsDate(dueDate)}` : dueDate === currentDate ? "Due today" : `Due ${formatWorkOsDate(dueDate)}`) : null;
      const showProject = showRowProjects && projectName !== "Work OS";
      const metaParts = [milestoneName || null, task.priority ? `${sentence(String(task.priority))} priority` : null].filter(Boolean) as string[];
      // Per-row provenance is warning-only; a healthy "synced" chip on every
      // row is noise. The detail modal keeps the full provenance chip.
      const showSyncChip = !task.completed && (Boolean(task.sync_error) || !task.synced_at);
      const stateLabel = taskStatusLabel(displayState);
      const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null;
      const syncPending = !task.completed && (Boolean(task.sync_error) || !task.synced_at);
      const flight = taskFlight?.get(taskId) ?? null;
      // Surface / defer / open-original-day are not capability-gated, so the
      // trigger stays for open rows and for completed rows with a real action.
      const hasMenu = hasTaskMenu(task, currentDate) || !task.completed || Boolean(attribution.date && attribution.date < currentDate);
      return <article className={`task-record workspace-task ${task.completed ? "is-completed" : ""}${flight === "leaving" ? " is-leaving" : ""}`} data-pan-row="true" key={taskId} data-list-key={taskId}><button className={`task-check${flight === "completing" ? " is-completing" : ""}`} {...taskCheckboxA11y(task, flight === "completing", title)} aria-busy={flight === "completing"} disabled={historical || pendingStatus !== null || !taskCheckboxEnabled(task)} onClick={() => { if (!pendingStatus && !flight) onTaskCompletion(task, !task.completed); }}>{flight === "completing" ? <FadeArc size={13} /> : (task.completed || flight === "leaving") ? <Check size={14} /> : null}</button><div className="task-row-body" onClick={(event) => { if (event.target instanceof Element && event.target.closest("button, a, input")) return; if (!pendingStatus && !flight) onOpenTask(task, historical); }}><div className="task-row-line primary-line"><h3><button type="button" className="task-open" aria-label={`Open task: ${title}`} onClick={() => { if (!pendingStatus && !flight) onOpenTask(task, historical); }}><OverflowPanText>{title}</OverflowPanText></button></h3>{onTodayPlan && taskView !== "today" && task.completed !== true && <span className="surfaced-tag">On today</span>}</div>{(showProject || metaParts.length > 0 || syncPending) && <div className="task-row-line secondary-line"><AssigneeTags task={task} />{showProject ? <small className="task-meta-project">{projectName}</small> : null}{metaParts.length > 0 && <small>{metaParts.join(" · ")}</small>}{syncPending && <small className="sync-warn">sync pending</small>}</div>}{dueInline ? <small className={`task-meta-due${state === "overdue" ? " danger" : ""}`}>{dueInline}</small> : null}{description && !descriptionEchoesTitle ? <p className="task-row-desc"><OverflowPanText pan={false}>{description}</OverflowPanText></p> : null}</div>{!pendingStatus && progress.total > 0 && <span className="task-row-ring"><ProgressRing completed={progress.completed} total={progress.total} label="subtasks" /></span>}{!pendingStatus && dueDate && <span className={`task-due ${state === "overdue" ? "danger" : ""}`}>{formatWorkOsDate(dueDate)}</span>}{pendingStatus ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} /> : <span className={`task-state ${displayState}`}>{stateLabel}</span>}{!historical && !pendingStatus && hasMenu && <div className={`workspace-task-menu ${menuOpen ? "open" : ""}`} onClick={(event) => event.stopPropagation()}><EllipsisMenu open={menuOpen} label={`Actions for ${title}`} disabled={busy} onToggle={() => setTaskMenuId(menuOpen ? null : taskId)} onClose={() => setTaskMenuId(null)}>
        <TaskActionMenuItems task={task} currentDate={currentDate} busy={busy} onStatus={(status) => onStatusTask?.(task, status)} onComplete={(completed) => onTaskCompletion(task, completed)} onEdit={() => onEditTask(task)} onAssign={onAssignTask ? () => onAssignTask(task) : undefined} onArchive={() => onArchiveTask(task)} onDelete={() => onDeleteTask(task)} onClose={() => setTaskMenuId(null)} />
        {!task.completed && !onTodayPlan && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task); }}><Plus size={14} /> Add to today</button>}{!task.completed && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task, "deferred"); }}><CirclePause size={14} /> Defer</button>}{attribution.date && attribution.date < currentDate && <button role="menuitem" onClick={() => { setTaskMenuId(null); void onDate(attribution.date!); }}><ChevronLeft size={14} /> Open original day</button>}</EllipsisMenu></div>}</article>;
  };

  return <main className="page tasks-workspace">
    <TaskFocusDetails text={agendaText} provenance={provenance} date={formatWorkOsDate(selectedDate)} historical={historical} plan={shownPlan ?? null} tasks={planTasks} onEdit={onEditFocus}>
      <div className="agenda-strip-focus">
        <span className="task-focus-kicker"><span className="task-focus-mark" aria-hidden="true"><Target size={12} /></span> {historical ? "Workday focus" : "Today's focus"}</span>
        <OverflowPanText className="agenda-strip-focus-scroll" lineClassName="agenda-strip-text">{agendaText}</OverflowPanText>
        <small className="agenda-strip-meta">
          <span className="agenda-strip-provenance">{provenance}{!historical ? ` · ${saveLabel}` : ""}{!historical && saveState === "saving" ? <FadeArc size={11} /> : null}{!historical && (saveState === "offline" || saveState === "conflict") ? <button type="button" className="goal-retry" title={saveState === "conflict" ? "Goal not saved — refresh the day, then retry." : "Goal not saved — click to retry."} aria-label="Retry saving the goal" onClick={() => onRetryGoalSave?.()}><RefreshCw size={11} /></button> : null}</span>
          {focusPlan.total > 0 && <span className="agenda-strip-plan" aria-label={`${focusPlan.open} open of ${focusPlan.total} planned tasks; ${focusPlan.completed} recorded done`}><b>{focusPlan.open}</b> open <span>of {focusPlan.total} planned</span><span className="agenda-strip-meter" aria-hidden="true"><i style={{ width: `${focusPlanPercent}%` }} /></span></span>}
        </small>
      </div>
      {!historical && carryOver.length > 0 && <button className="agenda-strip-carry" aria-label={`Review unfinished work — ${carryOver.length} unfinished task${carryOver.length === 1 ? "" : "s"}`} title={`Review ${carryOver.length} unfinished task${carryOver.length === 1 ? "" : "s"}`} onClick={() => onCarryOverOpen(true)}><span className="carry-count" aria-hidden="true"><b>{carryOver.length > 99 ? "99+" : carryOver.length}</b><small>{carryOver.length === 1 ? "unfinished task" : "unfinished tasks"}</small></span><AlertTriangle size={13} aria-hidden="true" /><span className="agenda-strip-carry-label">Review unfinished work</span><ChevronRight size={13} aria-hidden="true" /></button>}
    </TaskFocusDetails>
    <section className="panel task-list-panel" aria-label="Task list"><h2 className="sr-only">{historical ? `Tasks from ${formatWorkOsDate(selectedDate)}` : viewLabel}</h2>
      <header className="task-list-header">
        {!historical && <nav className="task-list-tabs" role="tablist" aria-label="Task views">{chipCounts.map(({ id, label, count }, index) => <button key={id} ref={(node) => { taskTabRefs.current[index] = node; }} id={`task-list-tab-${id}`} role="tab" aria-controls="task-list-panel" aria-selected={taskView === id} tabIndex={taskView === id ? 0 : -1} className={`task-list-tab ${taskView === id ? "active" : ""}`} onClick={() => onTaskView(id)} onKeyDown={(event) => onTaskTabKeyDown(event, index)}>{label}<em>{count}</em></button>)}</nav>}
        <section className="task-list-controls" aria-label="Task actions">
          <button type="button" className="task-toolbar-icon" aria-label="Search tasks" title="Search tasks" aria-haspopup="dialog" onClick={() => setFinderEntry("search")}><Search size={17} aria-hidden="true" /></button>
          <button type="button" className="task-toolbar-icon" aria-label="Search tasks by date" title="Search tasks by date" aria-haspopup="dialog" onClick={() => setFinderEntry("date")}><CalendarDays size={17} aria-hidden="true" /></button>
          {!historical && <button type="button" className="task-toolbar-icon is-primary" aria-label="Add task" title="Add task" onClick={onAddTask}><Plus size={18} aria-hidden="true" /></button>}
        </section>
      </header>
      {(hasFilters || overflowNote) && <p className="task-filter-summary" role="status">{overflowNote ?? `${displayedTasks.length} result${displayedTasks.length === 1 ? "" : "s"}`}</p>}
      <div className="evidence-list task-records" id="task-list-panel" ref={listRef} role={historical ? undefined : "tabpanel"} aria-labelledby={historical ? undefined : `task-list-tab-${taskView}`}>{historyError && <div className="task-history-error" role="alert"><span>{historyHasData ? "Task history could not be refreshed. Showing saved results." : "Task history could not be loaded."}</span>{onRetryHistory && <button type="button" onClick={onRetryHistory}>Try again</button>}</div>}<SortHeaderRow columns={TASKS_WORKSPACE_SORT_COLUMNS} sort={taskSort} fallback={DEFAULT_TASK_SORT} onChange={onTaskSort} label={historical ? "Sort recorded tasks" : `Sort ${viewLabel.toLowerCase()} tasks`} className="tasks-column-sort" />{loading && !displayed.length ? <TaskListSkeleton rows={6} /> : displayedTasks.length ? <>{taskView === "today" && !historical
        ? dayGroupsForDisplay.flatMap((group) => group.tasks).map(renderTaskRow)
        : displayedTasks.map(renderTaskRow)}</> : historyError && !historyHasData ? null : <div className="task-empty"><Empty title={emptyCopy.title} body={emptyCopy.body} />{taskView === "today" && !hasFilters && carryOver.length > 0 && <button className="task-empty-action" onClick={() => onCarryOverOpen(true)}><AlertTriangle size={14} aria-hidden="true" /> Review unfinished work</button>}</div>}</div>{loadingMore && <TaskListSkeleton rows={2} />}{hasMore && <button className="task-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <><FadeArc size={13} /> Loading tasks…</> : loadMoreError ? "Retry load more" : "Load more"}</button>}</section>
    {finderEntry && <TaskFinder entry={finderEntry} currentDate={currentDate} scope={finderScope} source={finderSource} onClose={() => setFinderEntry(null)} onOpenTask={task => onOpenTask(task, false)} />}
    {carryOverOpen && <TaskCarryOverFlyout groups={carryGroups} busy={busy} onClose={() => onCarryOverOpen(false)} onSurfaceTask={onSurfaceTask} onTaskCompletion={onTaskCompletion} taskFlight={taskFlight} onOpenDay={(date) => { onCarryOverOpen(false); void onDate(date); }} />}
  </main>;
}
