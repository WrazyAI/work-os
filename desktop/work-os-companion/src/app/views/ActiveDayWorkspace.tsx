import { useEffect, useRef, useState, type ReactNode } from "react";
import { Activity, AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronRight, CirclePause, CirclePlay, Clock3, ListChecks, MoreHorizontal, Pencil, Plus, RefreshCw, Sparkles, X } from "lucide-react";
import { formatWorkOsDate } from "../../dateFormat";
import { useListShift } from "../../listShift";
import { FadeArc } from "../../LoadingUi";
import { ProgressRing } from "../../ProgressRing";
import { Empty } from "../../SharedUi";
import { SortHeaderRow } from "../../SortHeaderRow";
import { hasTaskMenu, taskCheckboxA11y, taskCheckboxEnabled } from "../../taskActions";
import { EllipsisMenu, TaskActionMenuItems } from "../../taskSurfaces";
import { DAY_SORT_STORAGE_KEY, DEFAULT_TASK_SORT, isOverdueTask, readTaskSort, safeTaskText, sortTaskList, subtaskProgress, TASK_SORT_COLUMNS, taskSortNote, taskState, uniqueTasks, writeTaskSort, type TaskRow, type TaskSort } from "../../taskWorkspace";
import type { DayData } from "../../types";
import { sentence } from "../constants";
import { ShiftDetailsFloatingCard } from "./ShiftDetailsFloatingCard";

function TaskLifecycleMenu({ task, currentDate = "", busy, initialOpen = false, onStatus, onComplete, onEdit, onAssign, onArchive, onDelete }: {
  task: TaskRow; currentDate?: string; busy: boolean; initialOpen?: boolean; onStatus?: (status: "pending" | "in_progress") => void; onComplete?: (completed: boolean) => void; onEdit: (task: TaskRow) => void; onAssign?: (task: TaskRow) => void; onArchive: (task: TaskRow) => void; onDelete: (task: TaskRow) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  if (!hasTaskMenu(task, currentDate)) return null;
  return <div className={`dashboard-task-menu ${open ? "open" : ""}`} onClick={(event) => event.stopPropagation()}><EllipsisMenu open={open} label={`Actions for ${safeTaskText(task.title, "task")}`} disabled={busy} onToggle={() => setOpen((current) => !current)} onClose={() => setOpen(false)}>
    <TaskActionMenuItems task={task} currentDate={currentDate} busy={busy} onStatus={(status) => onStatus?.(status)} onComplete={(completed) => onComplete?.(completed)} onEdit={() => onEdit(task)} onAssign={onAssign ? () => onAssign(task) : undefined} onArchive={() => onArchive(task)} onDelete={() => onDelete(task)} onClose={() => setOpen(false)} />
  </EllipsisMenu></div>;
}

export function PendingTaskControls({ status, error, onRetry, onDismiss }: { status: "syncing" | "failed"; error?: string; onRetry: () => void; onDismiss: () => void }) {
  if (status === "syncing") {
    return <span className="pending-indicator" role="status" title="Adding to your workspace…"><FadeArc size={15} /><span className="sr-only">Adding task</span></span>;
  }
  return <span className="pending-indicator failed">
    <button type="button" className="pending-retry" title={error ? `Failed to add this task — ${error}. Click to retry.` : "Failed to add this task — click to retry."} aria-label="Retry adding this task" onClick={(event) => { event.stopPropagation(); onRetry(); }}><RefreshCw size={14} /></button>
    <button type="button" className="pending-dismiss" title="Discard this task" aria-label="Discard this failed task" onClick={(event) => { event.stopPropagation(); onDismiss(); }}><X size={12} /></button>
  </span>;
}

export function ActiveDayWorkspace({ focus, focusSource, tasks, previousTasks, otherTasks, elapsed, progressPercent, shiftStart, shiftEnd, remaining, timezone, attendance, providerBreakSeconds, initialDetailView = null, initialDetailsMenuOpen = false, initialTaskMenuId = null, paused, busy, observedOnly = false, canPause, canClockOut = true, onEditFocus, onAddTask, onManageTasks, onOpenOverdue, currentDate = "", onOpenTask, onToggleTask, onEditTask, onArchiveTask, onDeleteTask, onAssignTask, onPause, onClockOut, kpiStrip = null, goalSaveState = "saved", onRetryGoalSave, onRetryPendingTask, onDismissPendingTask, taskFlight, onStatusTask }: {
  onStatusTask?: (task: TaskRow, status: "pending" | "in_progress") => void;
  focus: string; focusSource: string; tasks: TaskRow[]; previousTasks: TaskRow[]; otherTasks: TaskRow[]; elapsed: string; progressPercent: number;
  shiftStart: string; shiftEnd: string; remaining: string; timezone?: string; attendance: DayData["attendance"] | null; providerBreakSeconds: number;
  initialDetailView?: "shift" | "worktivity" | null; initialDetailsMenuOpen?: boolean; initialTaskMenuId?: string | null; paused: boolean; busy: boolean; observedOnly?: boolean; canPause: boolean; canClockOut?: boolean;
  onEditFocus: () => void; onAddTask: () => void; onManageTasks: () => void; onOpenOverdue?: () => void; currentDate?: string; onOpenTask: (task: TaskRow) => void; onToggleTask: (task: TaskRow, completed: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask: (task: TaskRow) => void; onAssignTask?: (task: TaskRow) => void; onPause: () => void; onClockOut: () => void; kpiStrip?: ReactNode; goalSaveState?: "saved" | "saving" | "offline" | "conflict"; onRetryGoalSave?: () => void; onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
}) {
  const [tab, setTab] = useState<"today" | "previous" | "other">("today");
  const [sort, setSort] = useState<TaskSort>(() => readTaskSort(DAY_SORT_STORAGE_KEY));
  useEffect(() => { writeTaskSort(DAY_SORT_STORAGE_KEY, sort); }, [sort]);
  const [detailsMenuOpen, setDetailsMenuOpen] = useState(initialDetailsMenuOpen || initialDetailView !== null);
  const [detailView, setDetailView] = useState<"shift" | "worktivity" | null>(initialDetailView);
  const today = currentDate || new Date().toISOString().slice(0, 10);
  // Completed work leaves the day list the moment it is checked off; the hero
  // ring and the KPI strip keep counting it.
  const openToday = tasks.filter((task) => task.completed !== true);
  const rawDisplayed = tab === "today" ? openToday : tab === "previous" ? previousTasks : otherTasks;
  const displayed = sortTaskList(rawDisplayed, sort, today);
  const completed = tasks.filter((task) => task.completed === true).length;
  const listRef = useRef<HTMLDivElement | null>(null);
  useListShift(listRef);
  // One strict overdue definition across the whole tab set (design §27.3):
  // due-dated open work before today. Undated older work stays carry-over.
  const overdueCount = uniqueTasks([...previousTasks, ...otherTasks]).filter((task) => isOverdueTask(task, today)).length;
  const tabLabel = tab === "today" ? "Today tasks" : tab === "previous" ? "Previous day tasks" : "Older tasks";
  const pendingPrevious = previousTasks.filter((task) => task.completed !== true).length;
  const observedStart = attendance?.clockedInAt ? Date.parse(attendance.clockedInAt) : Number.NaN;
  const observedEnd = attendance?.clockedOutAt ? Date.parse(attendance.clockedOutAt) : attendance?.observedAt ? Date.parse(attendance.observedAt) : Number.NaN;
  const observedSeconds = Number.isFinite(observedStart) && Number.isFinite(observedEnd) ? Math.max(0, Math.floor((observedEnd - observedStart) / 1000) - providerBreakSeconds) : 0;
  const observedActive = `${String(Math.floor(observedSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(observedSeconds % 3600 / 60)).padStart(2, "0")}`;
  const providerBreak = `${String(Math.floor(providerBreakSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(providerBreakSeconds % 3600 / 60)).padStart(2, "0")}`;
  return <main className="active-day-page">
    <section className="active-day-card">
      <header className="active-day-header">
        <div className="active-shift-status"><span className={`presence ${paused ? "" : "live"}`} /><div><small>{observedOnly ? paused ? "Worktivity break" : "Activity observed" : paused ? "Shift paused" : "On shift"}</small><strong>{elapsed}</strong></div><div className="active-shift-meter"><i style={{ width: `${progressPercent}%` }} /></div></div>
        <div className="active-day-actions">{canPause && <button className="shift-action-button" disabled={busy} onClick={onPause}>{paused ? <CirclePlay size={15} aria-hidden="true" /> : <CirclePause size={15} aria-hidden="true" />}<span>{paused ? "Resume" : "Pause"}</span></button>}{canClockOut && <button className="shift-action-button" disabled={busy} onClick={onClockOut}>Clock out</button>}<div className="shift-details-menu"><button className="ellipsis-button" aria-label="Open workday details" aria-expanded={detailsMenuOpen} onClick={() => { setDetailsMenuOpen((current) => !current); setDetailView(null); }}><MoreHorizontal size={17} /></button>{detailsMenuOpen && <><button className="shift-popover-scrim" aria-label="Close workday details" onClick={() => { setDetailsMenuOpen(false); setDetailView(null); }} />{detailView ? <ShiftDetailsFloatingCard view={detailView} progressPercent={progressPercent} shiftStart={shiftStart} remaining={remaining} shiftEnd={shiftEnd} elapsed={elapsed} openTasks={tasks.filter((task) => !task.completed).length} attendance={attendance} timezone={timezone} observedActive={observedActive} providerBreak={providerBreak} onBack={() => setDetailView(null)} onClose={() => { setDetailsMenuOpen(false); setDetailView(null); }} /> : <div className="shift-details-options" role="menu"><button role="menuitem" onClick={() => setDetailView("shift")}><Clock3 size={14} /> Workday status</button><button role="menuitem" onClick={() => setDetailView("worktivity")}><Activity size={14} /> Worktivity details</button></div>}</>}</div></div>
      </header>
      <div className="active-focus-block"><div className="active-focus-copy"><span>Today’s focus</span><div className="active-focus-heading"><h2>{focus}</h2><button className="focus-edit-button" onClick={onEditFocus}><Pencil size={14} /> Update focus</button></div><small><Sparkles size={13} /> {focusSource}{goalSaveState === "saving" ? <FadeArc size={11} /> : goalSaveState === "offline" || goalSaveState === "conflict" ? <button type="button" className="goal-retry" title="Goal not saved — click to retry." aria-label="Retry saving the goal" onClick={() => onRetryGoalSave?.()}><RefreshCw size={11} /></button> : null}</small></div><div className="hero-task-metrics">{overdueCount > 0 && <button className="overdue-metric" onClick={() => onOpenOverdue?.()} aria-label={`${overdueCount} overdue tasks. Show unfinished work in Tasks.`}><span><strong>{overdueCount}</strong></span><em>overdue<br />{overdueCount === 1 ? "task" : "tasks"}</em></button>}</div>
        <div className="hero-task-metrics"><button className="hero-metric-button" onClick={() => setTab("today")} aria-label={`${completed} of ${tasks.length} tasks done today. Show Today tasks.`}><ProgressRing completed={completed} total={tasks.length} size={44} stroke={5} label="tasks done" trailing="tasks done"><strong>{completed}</strong><small>of {tasks.length}</small></ProgressRing></button><button className={`carryover-metric ${pendingPrevious > 0 ? "pending" : "clear"}`} onClick={() => setTab("previous")} aria-label={`${pendingPrevious} pending task${pendingPrevious === 1 ? "" : "s"} from yesterday. Show Previous day tasks.`}><span><strong>{pendingPrevious}</strong></span><em>pending tasks<br />from yesterday</em></button></div></div>
      <div className="active-task-toolbar"><div className="active-task-tabs" role="tablist"><button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Today <em>{openToday.length}</em></button><button role="tab" aria-selected={tab === "previous"} className={tab === "previous" ? "active" : ""} onClick={() => setTab("previous")}>Previous day {previousTasks.length > 0 && <em className="alert-count">{previousTasks.length}</em>}</button><button role="tab" aria-selected={tab === "other"} className={tab === "other" ? "active" : ""} onClick={() => setTab("other")}>Other days {otherTasks.length > 0 && <em className="older-count">{otherTasks.length}</em>}</button></div><small className="active-task-sort-note">Sorted by {taskSortNote(sort)}</small><button className="primary add-day-task" onClick={onAddTask}><Plus size={15} /> Add task</button></div>
      {tab === "other" && otherTasks.length > 0 && <div className="older-task-notice" role="status"><span>{otherTasks.length}</span><strong>Older unfinished task{otherTasks.length === 1 ? "" : "s"}</strong><small>From before yesterday</small></div>}
      <div className="active-task-list" ref={listRef}>
        {displayed.length ? <SortHeaderRow columns={TASK_SORT_COLUMNS} sort={sort} fallback={DEFAULT_TASK_SORT} onChange={setSort} label={`Sort ${tabLabel.toLowerCase()}`} className="day-task-sort" /> : null}
        {displayed.length ? displayed.map((task) => { const taskId = String(task.provider_task_id || task.id); const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null; const progress = subtaskProgress(task); const flight = taskFlight?.get(taskId) ?? null; return <article className={`${task.completed ? "completed" : ""}${pendingStatus ? " pending" : ""}${flight === "leaving" ? " is-leaving" : ""}`} data-list-key={taskId} key={taskId}><button className={`task-check${flight === "completing" ? " is-completing" : ""}`} {...taskCheckboxA11y(task, flight === "completing", task.title)} aria-busy={flight === "completing"} disabled={pendingStatus !== null || !taskCheckboxEnabled(task)} onClick={() => { if (!pendingStatus && !flight) onToggleTask(task, !task.completed); }}>{flight === "completing" ? <FadeArc size={13} /> : (task.completed || flight === "leaving") ? <Check size={15} /> : null}</button><button className="active-task-copy" onClick={() => { if (!pendingStatus) onOpenTask(task); }}><strong>{task.title}</strong><small>{pendingStatus ? pendingStatus === "syncing" ? "Adding to your workspace…" : "Failed to add — retry or discard" : task.completed ? (typeof task.completed_at === "string" && task.completed_at ? `Completed ${formatWorkOsDate(task.completed_at.slice(0, 10))}` : "Completed") : task.priority ? `${sentence(String(task.priority))} priority` : task.due_date ? `Due ${formatWorkOsDate(task.due_date)}` : "Open today"}</small></button>{!pendingStatus && progress.total > 0 && <span className="task-row-ring"><ProgressRing completed={progress.completed} total={progress.total} label="subtasks" /></span>}{pendingStatus ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} /> : null}{!pendingStatus && <TaskLifecycleMenu task={task} currentDate={today} busy={busy} initialOpen={initialTaskMenuId === taskId} onStatus={(status) => onStatusTask?.(task, status)} onComplete={(completed) => onToggleTask(task, completed)} onEdit={onEditTask} onAssign={onAssignTask} onArchive={onArchiveTask} onDelete={onDeleteTask} />}</article>; }) : <Empty title={tab === "today" ? "A clear day" : tab === "previous" ? "Nothing left behind" : "No older work pending"} body={tab === "today" ? "Add the first task you want to move forward today." : tab === "previous" ? "Yesterday’s open work has been cleared." : "Everything from before yesterday is complete."} />}</div>
      <footer className="active-day-footer"><span>Changes save to your workday record.</span><button className="workspace-link-button" onClick={onManageTasks}><span>Open full Tasks workspace</span><ChevronRight size={14} aria-hidden="true" /></button></footer>
    </section>
    {kpiStrip}
  </main>;
}

export function KpiStrip({ scheduledCount, yesterdayDueCount, completedCount, onScheduled, onYesterday, onCompleted }: {
  scheduledCount: number; yesterdayDueCount: number; completedCount: number;
  onScheduled: () => void; onYesterday: () => void; onCompleted: () => void;
}) {
  return <section className="kpi-strip" aria-label="Today at a glance">
    <button className="kpi-card" onClick={onScheduled}><small><ListChecks size={13} aria-hidden="true" /> Scheduled today</small><strong>{scheduledCount}</strong><em>{scheduledCount ? "Open the day view" : "Plan your day"}</em></button>
    <button className="kpi-card" disabled={!yesterdayDueCount} onClick={onYesterday}><small><AlertTriangle size={13} aria-hidden="true" /> Due from yesterday</small><strong className={yesterdayDueCount ? "kpi-danger" : undefined}>{yesterdayDueCount}</strong><em className={yesterdayDueCount ? "kpi-attention" : undefined}>{yesterdayDueCount ? "Review unfinished work" : "Nothing carried forward"}</em></button>
    <button className="kpi-card" disabled={!completedCount} onClick={onCompleted}><small><CheckCircle2 size={13} aria-hidden="true" /> Completed today</small><strong>{completedCount}</strong><em>{completedCount ? "Review the record" : "Finish a task first"}</em></button>
  </section>;
}

export function DashboardTaskCard({ task, currentDate, onOpen, flight = null, onComplete, onRetryPendingTask, onDismissPendingTask }: { task: TaskRow; currentDate: string; onOpen: () => void; flight?: "completing" | "leaving" | null; onComplete?: () => void; onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void }) {
  const state = taskState(task, currentDate);
  const dueDate = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
  const title = safeTaskText(task.title, "Untitled task");
  const description = safeTaskText(task.description, "");
  const progress = subtaskProgress(task);
  const projectName = safeTaskText(task.project?.name, "Work OS");
  const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null;
  return <article className={`dashboard-task-card${pendingStatus ? " pending" : ""}${flight === "leaving" ? " is-leaving" : ""}`} role="button" tabIndex={0} data-list-key={String(task.provider_task_id || task.id)} onClick={() => { if (!pendingStatus && !flight) onOpen(); }} onKeyDown={(event) => { if (pendingStatus || flight) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} aria-label={`Open ${title}`}>
    <div className="dashboard-task-head">
      <span className={`task-due-chip ${state === "overdue" ? "danger" : ""}`}><CalendarDays size={12} aria-hidden="true" /> {pendingStatus ? "Adding to today" : dueDate ? `Due ${formatWorkOsDate(dueDate)}` : task.priority ? `${sentence(String(task.priority))} priority` : "No due date"}</span>
      {!pendingStatus && <button className={`task-check card-check${flight === "completing" ? " is-completing" : ""}`} aria-label={flight === "completing" ? `Completing ${title}` : `Complete ${title}`} aria-busy={flight === "completing"} onClick={(event) => { event.stopPropagation(); if (!flight) onComplete?.(); }}>{flight === "completing" ? <FadeArc size={12} /> : flight === "leaving" ? <Check size={13} /> : null}</button>}
    </div>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    <div className="dashboard-task-foot">
      {pendingStatus
        ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} />
        : progress.total > 0
          ? <ProgressRing completed={progress.completed} total={progress.total} label="subtasks" />
          : <span className="task-due">{projectName !== "Work OS" ? projectName : "Work OS task"}</span>}
    </div>
  </article>;
}
