import { useState, type CSSProperties } from "react";
import { Activity, AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronRight, CirclePause, CirclePlay, Clock3, ListChecks, MoreHorizontal, Pencil, Plus, RefreshCw, Sparkles } from "lucide-react";
import { formatWorkOsDate, formatWorkOsTime } from "./dateFormat";
import { dashboardRemainingLabel, type WorkdayDashboardModel } from "./dashboardModel";
import { MascotPet, MascotStatus } from "./MascotPet";
import { ProgressRing } from "./ProgressRing";
import { FadeArc } from "./LoadingUi";
import { safeTaskText, subtaskProgress, taskState, type TaskRow } from "./taskWorkspace";

export type DashboardTaskView = "today" | "unfinished" | "completed";

export interface DashboardSurfaceActions {
  onOpenTasks: (view?: DashboardTaskView) => void;
  onOpenCarryover: () => void;
  onOpenFocus: () => void;
  onOpenTask: (task: TaskRow) => void;
  onToggleTask: (task: TaskRow, completed: boolean) => void;
  onClockIn?: () => void;
  onPause?: () => void;
  onClockOut?: () => void;
  onAddTask?: () => void;
  onRetryPendingTask?: (task: TaskRow) => void;
  onDismissPendingTask?: (task: TaskRow) => void;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
}

export interface OffShiftDashboardProps extends DashboardSurfaceActions {
  model: WorkdayDashboardModel;
  tasks: TaskRow[];
  currentDate: string;
  busy?: boolean;
  canClockIn?: boolean;
  attendanceControlsSupported?: boolean;
  goalSaveState?: "saved" | "saving" | "offline" | "conflict";
}

export interface ActiveWorkdayDashboardProps extends DashboardSurfaceActions {
  model: WorkdayDashboardModel;
  tasks: TaskRow[];
  previousTasks: TaskRow[];
  otherTasks: TaskRow[];
  currentDate: string;
  busy?: boolean;
  canPause?: boolean;
  canClockOut?: boolean;
  attendanceControlsSupported?: boolean;
  observedOnly?: boolean;
  goalSaveState?: "saved" | "saving" | "offline" | "conflict";
  onRetryGoalSave?: () => void;
}

function syncClass(tone: WorkdayDashboardModel["sync"]["tone"]) {
  return `dashboard-status-${tone}`;
}

function scheduleLabel(model: WorkdayDashboardModel) {
  if (!model.schedule.startsAt || !model.schedule.endsAt) return "No schedule configured";
  return `${formatWorkOsTime(model.schedule.startsAt ?? undefined, model.schedule.timezone ?? undefined)}–${formatWorkOsTime(model.schedule.endsAt ?? undefined, model.schedule.timezone ?? undefined)}`;
}

function scheduleDescription(model: WorkdayDashboardModel) {
  if (!model.schedule.startsAt || !model.schedule.endsAt) return "Set a schedule when you are ready to plan a synchronized workday.";
  if (model.schedule.phase === "upcoming") return `Starts at ${formatWorkOsTime(model.schedule.startsAt ?? undefined, model.schedule.timezone ?? undefined)}.`;
  if (model.schedule.phase === "complete") return `Ended at ${formatWorkOsTime(model.schedule.endsAt ?? undefined, model.schedule.timezone ?? undefined)}.`;
  return `${dashboardRemainingLabel(model)} in the scheduled window.`;
}

function statusDot(tone: WorkdayDashboardModel["stateTone"]) {
  return <span className={`dashboard-status-dot ${syncClass(tone)}`} aria-hidden="true" />;
}

function DashboardMetric({ icon: Icon, label, value, detail, tone = "quiet", onClick }: {
  icon: typeof Clock3;
  label: string;
  value: number | string;
  detail: string;
  tone?: WorkdayDashboardModel["stateTone"];
  onClick?: () => void;
}) {
  const content = <><span className={`dashboard-metric-icon ${syncClass(tone)}`}><Icon size={16} aria-hidden="true" /></span><span className="dashboard-metric-copy"><small>{label}</small><strong>{value}</strong><em>{detail}</em></span>{onClick && <ChevronRight className="dashboard-metric-arrow" size={15} aria-hidden="true" />}</>;
  return onClick
    ? <button className="dashboard-metric" onClick={onClick}>{content}</button>
    : <article className="dashboard-metric">{content}</article>;
}

function DashboardTaskRow({ task, currentDate, busy = false, taskFlight, onOpenTask, onToggleTask, onRetryPendingTask, onDismissPendingTask }: {
  task: TaskRow;
  currentDate: string;
  busy?: boolean;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
  onOpenTask: (task: TaskRow) => void;
  onToggleTask: (task: TaskRow, completed: boolean) => void;
  onRetryPendingTask?: (task: TaskRow) => void;
  onDismissPendingTask?: (task: TaskRow) => void;
}) {
  const id = String(task.provider_task_id ?? task.id);
  const title = safeTaskText(task.title, "Untitled task");
  const pending = task.pending_status === "syncing" || task.pending_status === "failed" ? task.pending_status : null;
  const flight = taskFlight?.get(id) ?? null;
  const state = taskState(task, currentDate);
  const progress = subtaskProgress(task);
  const due = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
  return <article className={`dashboard-task-row ${state}${pending ? " is-pending" : ""}${flight === "leaving" ? " is-leaving" : ""}`} data-task-id={id}>
    <button type="button" className={`dashboard-task-check${task.completed || flight === "leaving" ? " is-complete" : ""}${flight === "completing" ? " is-completing" : ""}`} disabled={!!pending || !!flight} aria-busy={flight === "completing"} aria-label={flight === "completing" ? `Completing ${title}` : task.completed ? `Reopen ${title}` : `Complete ${title}`} onClick={() => { if (!pending && !flight) onToggleTask(task, !task.completed); }}>
      {pending === "syncing" || flight === "completing" ? <FadeArc size={13} /> : task.completed || flight === "leaving" ? <Check size={15} aria-hidden="true" /> : null}
    </button>
    <button type="button" className="dashboard-task-row-copy" disabled={!!pending || !!flight} onClick={() => onOpenTask(task)}>
      <strong>{title}</strong>
      <span>{task.priority ? `${String(task.priority).replace(/^./, (value) => value.toUpperCase())} priority` : due ? `Due ${formatWorkOsDate(due)}` : "No due date"}</span>
    </button>
    <div className="dashboard-task-row-meta">
      {progress.total > 0 && <ProgressRing completed={progress.completed} total={progress.total} size={24} stroke={3} label="subtasks" />}
      {due && <span className={state === "overdue" ? "is-overdue" : ""}>{formatWorkOsDate(due)}</span>}
      {pending === "failed" && <span className="dashboard-pending-actions"><button type="button" title={task.pending_error || "Retry adding task"} aria-label={`Retry adding ${title}`} onClick={() => onRetryPendingTask?.(task)}><RefreshCw size={13} /></button><button type="button" aria-label={`Dismiss ${title}`} onClick={() => onDismissPendingTask?.(task)}><Check size={12} /></button></span>}
    </div>
  </article>;
}

function DashboardTaskQueue({ tasks, currentDate, emptyTitle, emptyBody, busy, taskFlight, onOpenTask, onToggleTask, onRetryPendingTask, onDismissPendingTask }: {
  tasks: TaskRow[];
  currentDate: string;
  emptyTitle: string;
  emptyBody: string;
  busy?: boolean;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
  onOpenTask: (task: TaskRow) => void;
  onToggleTask: (task: TaskRow, completed: boolean) => void;
  onRetryPendingTask?: (task: TaskRow) => void;
  onDismissPendingTask?: (task: TaskRow) => void;
}) {
  const openTasks = tasks.filter((task) => task.completed !== true).slice(0, 5);
  return openTasks.length
    ? <div className="dashboard-task-queue">{openTasks.map((task) => <DashboardTaskRow key={String(task.provider_task_id ?? task.id)} task={task} currentDate={currentDate} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} />)}</div>
    : <div className="dashboard-empty-state"><span className="dashboard-empty-icon"><CheckCircle2 size={18} /></span><strong>{emptyTitle}</strong><p>{emptyBody}</p></div>;
}

function WorkdayFlow({ model }: { model: WorkdayDashboardModel }) {
  const total = Math.max(1, model.metrics.planned + model.metrics.carryover);
  const completedWidth = Math.min(100, (model.metrics.completed / total) * 100);
  const carryWidth = Math.min(100 - completedWidth, (model.metrics.carryover / total) * 100);
  const openWidth = Math.max(0, 100 - completedWidth - carryWidth);
  return <div className="dashboard-flow-visual" aria-label={`${model.metrics.completed} completed, ${model.metrics.open} open, and ${model.metrics.carryover} carried over`}>
    <div className="dashboard-flow-bar"><i className="completed" style={{ width: `${completedWidth}%` }} /><i className="carryover" style={{ width: `${carryWidth}%` }} /><i className="open" style={{ width: `${openWidth}%` }} /></div>
    <div className="dashboard-flow-legend"><span><i className="completed" />Completed <b>{model.metrics.completed}</b></span><span><i className="carryover" />Carryover <b>{model.metrics.carryover}</b></span><span><i className="open" />Open <b>{model.metrics.open}</b></span></div>
  </div>;
}

function PulseTimeline({ model }: { model: WorkdayDashboardModel }) {
  const progress = Math.max(0, Math.min(100, model.pulse.progressPercent));
  return <div className="dashboard-pulse-timeline">
    <div className="dashboard-pulse-line"><i style={{ width: `${progress}%` }} /><b style={{ left: `clamp(8px, ${progress}%, calc(100% - 8px))` }} /></div>
    <div className="dashboard-pulse-labels"><span><small>Start</small><strong>{formatWorkOsTime(model.schedule.startsAt ?? undefined, model.schedule.timezone ?? undefined)}</strong></span><span><small>Now</small><strong>{model.pulse.elapsedLabel}</strong></span><span><small>End</small><strong>{formatWorkOsTime(model.schedule.endsAt ?? undefined, model.schedule.timezone ?? undefined)}</strong></span></div>
  </div>;
}

export function OffShiftDashboard({ model, tasks, currentDate, busy = false, canClockIn = true, attendanceControlsSupported = true, goalSaveState = "saved", taskFlight, onOpenTasks, onOpenCarryover, onOpenFocus, onOpenTask, onToggleTask, onClockIn, onRetryPendingTask, onDismissPendingTask }: OffShiftDashboardProps) {
  const taskCopy = model.metrics.carryover > 0
    ? { title: "Start by clearing the oldest decision", body: `${model.metrics.carryover} unfinished task${model.metrics.carryover === 1 ? "" : "s"} is waiting from an earlier workday.` }
    : { title: "Your agenda is open", body: "Choose a first priority or use the composer below to add one without clocking in." };
  return <main className="dashboard-shell off-shift-dashboard">
    <section className="dashboard-panel dashboard-readiness-panel">
      <div className="dashboard-readiness-copy">
        <div className="dashboard-eyebrow">{statusDot(model.stateTone)} {model.stateLabel}</div>
        <h2>Start the day with one clear move.</h2>
        <p>{model.stateDetail} {!attendanceControlsSupported ? "Use Worktivity on your Mac to clock in, pause, resume, or clock out. Work OS shows its confirmed status." : model.schedule.phase === "upcoming" ? "Clock in with Worktivity from the Windows Companion; Work OS waits for provider confirmation." : "Shape the agenda now, then clock in with Worktivity from the Windows Companion when you are ready."}</p>
        {model.activityWatch === "clock-in" && <p className="dashboard-activity-watch" role="status">Checking your activity… Work OS will clock you in as soon as Worktivity sees you working.</p>}
        <div className="dashboard-primary-actions">{attendanceControlsSupported && <button className="dashboard-primary-action" disabled={busy || !canClockIn} onClick={onClockIn}><CirclePlay size={16} /> Clock in</button>}<button className="dashboard-secondary-action" onClick={onOpenFocus}><Pencil size={14} /> Set focus</button></div>
      </div>
      <div className="dashboard-readiness-art"><div className="dashboard-art-orbit"><MascotPet workday="off-shift" className="dashboard-otto" /></div><MascotStatus fallback={model.schedule.phase === "upcoming" ? "Ready when you are" : "No active workday"} /></div>
      <footer className="dashboard-panel-footer"><span className={`dashboard-sync-chip ${syncClass(model.sync.tone)}`}><i />{model.sync.label}</span><small>{model.sync.detail}</small>{goalSaveState !== "saved" && <small className="dashboard-save-warning"><RefreshCw size={12} /> Focus changes are {goalSaveState === "saving" ? "saving" : "waiting to retry"}.</small>}</footer>
    </section>

    <section className="dashboard-panel dashboard-pulse-panel">
      <header className="dashboard-panel-heading"><div><span className="dashboard-eyebrow"><Clock3 size={13} /> Workday pulse</span><h3>{scheduleDescription(model)}</h3></div><span className={`dashboard-state-pill ${syncClass(model.stateTone)}`}>{model.stateLabel}</span></header>
      <div className="dashboard-pulse-value"><div><small>Time until shift</small><strong>{model.schedule.phase === "upcoming" ? dashboardRemainingLabel(model) : "Ready"}</strong></div><span className="dashboard-schedule-badge"><CalendarDays size={15} /><small>{model.schedule.phase === "upcoming" ? "Next shift" : "Today’s schedule"}</small><strong>{scheduleLabel(model)}</strong></span></div>
      <PulseTimeline model={model} />
      <p className="dashboard-separation-note"><Activity size={13} /> Worktivity owns attendance; Work OS mirrors it after provider confirmation.</p>
    </section>

    <section className="dashboard-metric-grid" aria-label="Workday overview">
      <DashboardMetric icon={ListChecks} label="Planned today" value={model.metrics.planned} detail={model.metrics.open ? `${model.metrics.open} still open` : "Plan your first task"} onClick={() => onOpenTasks("today")} tone="signal" />
      <DashboardMetric icon={AlertTriangle} label="Carryover" value={model.metrics.carryover} detail={model.metrics.carryover ? "Needs a decision" : "Nothing carried forward"} onClick={model.metrics.carryover ? onOpenCarryover : undefined} tone={model.metrics.carryover ? "warning" : "quiet"} />
      <DashboardMetric icon={CheckCircle2} label="Completed today" value={model.metrics.completed} detail={model.metrics.completed ? "Review the record" : "Finish a task first"} onClick={model.metrics.completed ? () => onOpenTasks("completed") : undefined} tone="signal" />
    </section>

    <section className="dashboard-lower-grid">
      <section className="dashboard-panel dashboard-flow-panel"><header className="dashboard-panel-heading"><div><span className="dashboard-eyebrow"><ListChecks size={13} /> Work in motion</span><h3>Make the first task visible.</h3></div><button className="dashboard-inline-link" onClick={() => onOpenTasks("today")}>Open Tasks <ChevronRight size={14} /></button></header><WorkdayFlow model={model} /><div className="dashboard-focus-block"><span><Sparkles size={14} /> Today’s focus</span><button onClick={onOpenFocus}>{model.focus.text}</button><small>{model.focus.source}</small></div></section>
      <section className="dashboard-panel dashboard-queue-panel"><header className="dashboard-panel-heading"><div><span className="dashboard-eyebrow"><ListChecks size={13} /> First moves</span><h3>{taskCopy.title}</h3></div><button className="dashboard-icon-link" aria-label="Open Tasks" onClick={() => onOpenTasks("today")}><ChevronRight size={16} /></button></header><DashboardTaskQueue tasks={tasks} currentDate={currentDate} emptyTitle={taskCopy.title} emptyBody={taskCopy.body} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} /></section>
    </section>
  </main>;
}

export function ActiveWorkdayDashboard({ model, tasks, previousTasks, otherTasks, currentDate, busy = false, canPause = false, canClockOut = true, attendanceControlsSupported = true, observedOnly = false, goalSaveState = "saved", taskFlight, onRetryGoalSave, onOpenTasks, onOpenCarryover, onOpenFocus, onOpenTask, onToggleTask, onPause, onClockOut, onAddTask, onRetryPendingTask, onDismissPendingTask }: ActiveWorkdayDashboardProps) {
  const [tab, setTab] = useState<"today" | "previous" | "other">("today");
  const sourceTasks = tab === "today" ? tasks.filter((task) => task.completed !== true) : tab === "previous" ? previousTasks : otherTasks;
  const tabLabel = tab === "today" ? "Today’s queue" : tab === "previous" ? "Yesterday’s carryover" : "Older carryover";
  return <main className="dashboard-shell active-dashboard">
    <section className="dashboard-panel active-command-panel">
      <header className="active-command-header"><div className="active-status-heading"><MascotPet className="dashboard-otto-active" workday={observedOnly ? model.attendance?.state === "paused" ? "paused" : model.attendance?.state === "active" ? "active" : "off-shift" : model.state === "paused" ? "paused" : "active"} /><span className={`dashboard-status-dot ${syncClass(model.stateTone)}`} /><div><span className="dashboard-eyebrow">{observedOnly ? "Worktivity status" : model.stateLabel}</span><h2>{model.stateDetail}</h2></div></div><div className="active-command-actions">{attendanceControlsSupported && canPause && <button className="dashboard-secondary-action" disabled={busy} onClick={onPause}>{model.state === "paused" ? <CirclePlay size={14} /> : <CirclePause size={14} />}{model.state === "paused" ? "Resume" : "Pause"}</button>}{attendanceControlsSupported && canClockOut && <button className="dashboard-danger-action" disabled={busy} onClick={onClockOut}>Clock out</button>}<button className="dashboard-icon-link" aria-label="Open today’s Tasks" onClick={() => onOpenTasks("today")}><MoreHorizontal size={17} /></button></div></header>
      <div className="active-time-grid"><div><small>Elapsed</small><strong>{observedOnly ? model.pulse.observedElapsedLabel : model.pulse.elapsedLabel}</strong><span>{observedOnly ? "Worktivity active time" : "Mirrored Worktivity time"}</span></div><div className="active-progress-orb" style={{ "--progress": `${model.pulse.progressPercent}%` } as CSSProperties}><span><strong>{Math.round(model.pulse.progressPercent)}%</strong><small>window elapsed</small></span></div><div><small>Remaining</small><strong>{dashboardRemainingLabel(model).replace(" remaining", "")}</strong><span>{scheduleLabel(model)}</span></div></div>
      <PulseTimeline model={model} />
      {!attendanceControlsSupported && <p className="dashboard-activity-watch">Use Worktivity on your Mac to clock in, pause, resume, or clock out. Work OS shows its confirmed status.</p>}
      <footer className="dashboard-panel-footer"><span className={`dashboard-sync-chip ${syncClass(model.sync.tone)}`}><i />{model.sync.label}</span><small>{model.attendance?.message || "Observed context is unavailable."}</small>{model.activityWatch === "clock-out" && <small className="dashboard-activity-watch" role="status">Checking your activity… Work OS will close the day when Worktivity observes your clock-out.</small>}{goalSaveState !== "saved" && <button className="dashboard-save-warning" onClick={onRetryGoalSave}><RefreshCw size={12} /> Retry focus save</button>}</footer>
    </section>

    <section className="active-summary-grid">
      <section className="dashboard-panel active-focus-panel"><header className="dashboard-panel-heading"><div><span className="dashboard-eyebrow"><Sparkles size={13} /> Today’s focus</span><h3>{model.focus.text}</h3></div><button className="dashboard-secondary-action" onClick={onOpenFocus}><Pencil size={13} /> Update</button></header><p>{model.focus.source}</p><WorkdayFlow model={model} /></section>
      <section className="dashboard-panel active-summary-panel"><header className="dashboard-panel-heading"><div><span className="dashboard-eyebrow"><ListChecks size={13} /> Workday at a glance</span><h3>Keep the queue moving.</h3></div></header><div className="active-summary-facts"><span><strong>{model.metrics.completed}</strong><small>completed</small></span><span><strong>{model.metrics.open}</strong><small>open</small></span><span><strong className={model.metrics.overdue ? "is-danger" : ""}>{model.metrics.overdue}</strong><small>overdue</small></span></div><button className="dashboard-inline-link active-summary-action" onClick={() => onOpenTasks("unfinished")}>Review unfinished work <ChevronRight size={14} /></button></section>
    </section>

    <section className="dashboard-panel active-task-panel"><header className="active-task-panel-header"><div><span className="dashboard-eyebrow"><ListChecks size={13} /> Task queue</span><h3>{tabLabel}</h3></div><div className="active-task-panel-actions"><button className="dashboard-secondary-action" onClick={onAddTask}><Plus size={14} /> Add task</button><button className="dashboard-inline-link" onClick={() => onOpenTasks("today")}>Full workspace <ChevronRight size={14} /></button></div></header><div className="active-task-tabs" role="tablist" aria-label="Active workday tasks"><button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Today <em>{tasks.filter((task) => task.completed !== true).length}</em></button><button role="tab" aria-selected={tab === "previous"} className={tab === "previous" ? "active" : ""} onClick={() => setTab("previous")}>Yesterday <em>{previousTasks.length}</em></button><button role="tab" aria-selected={tab === "other"} className={tab === "other" ? "active" : ""} onClick={() => setTab("other")}>Older <em>{otherTasks.length}</em></button></div><div className="active-task-queue"><DashboardTaskQueue tasks={sourceTasks} currentDate={currentDate} emptyTitle={tab === "today" ? "Today is clear" : "Nothing left behind"} emptyBody={tab === "today" ? "Add the next task you want to move forward." : "Earlier work is complete or already planned."} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} /></div><footer className="dashboard-panel-footer"><span>{model.metrics.carryover ? `${model.metrics.carryover} task${model.metrics.carryover === 1 ? "" : "s"} still needs a decision.` : "Changes save to your workday record."}</span><button className="dashboard-inline-link" onClick={onOpenCarryover}>Review carryover <ChevronRight size={14} /></button></footer></section>
  </main>;
}
