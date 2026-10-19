import { useRef, useState, type KeyboardEvent } from "react";
import { Activity, AlertTriangle, CalendarDays, Check, CheckCircle2, ChevronRight, CirclePause, CirclePlay, Clock3, ListChecks, Pencil, Plus, RefreshCw, Sparkles, Target } from "lucide-react";
import { formatWorkOsDate, formatWorkOsTime } from "./dateFormat";
import { dashboardRemainingLabel, type WorkdayDashboardModel } from "./dashboardModel";
import { MascotPet, MascotStatus } from "./MascotPet";
import { ProgressRing } from "./ProgressRing";
import { FadeArc } from "./LoadingUi";
import { OverflowPanText } from "./OverflowPan";
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
    <div className="dashboard-pulse-labels"><span><small>Start</small><strong>{formatWorkOsTime(model.schedule.startsAt ?? undefined, model.schedule.timezone ?? undefined)}</strong></span><span><small>Now</small><strong>{formatWorkOsTime(new Date(model.asOf).toISOString(), model.schedule.timezone ?? undefined)}</strong></span><span><small>End</small><strong>{formatWorkOsTime(model.schedule.endsAt ?? undefined, model.schedule.timezone ?? undefined)}</strong></span></div>
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
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const sourceTasks = tab === "today" ? tasks.filter((task) => task.completed !== true) : tab === "previous" ? previousTasks : otherTasks;
  const openInTab = sourceTasks.filter((task) => task.completed !== true).length;
  const tabs = [
    { id: "today" as const, label: "Today", count: tasks.filter((task) => task.completed !== true).length },
    { id: "previous" as const, label: "Yesterday", count: previousTasks.length },
    { id: "other" as const, label: "Older", count: otherTasks.length },
  ];
  // Peer-view contract (§8.13): one tab stop, arrows move and activate, Home
  // and End jump to the ends, and each tab's accessible name includes its count.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.findIndex((item) => item.id === tab);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  };
  // The confirmed session is already carried by the state line, the Worktivity
  // chip, and the mirrored-time label, so the long mirroring sentence only
  // earns a place when the provider state is not confirmed.
  const confirmed = model.stateTone === "signal";
  const fact = (value: number, label: string, action: () => void, review: string, danger = false) => {
    const body = <><strong className={danger && value > 0 ? "is-danger" : undefined}>{value}</strong><small>{label}</small></>;
    // The accessible name starts with the visible value and label (WCAG 2.5.3),
    // then names the destination, so a screen reader hears both the fact and
    // what pressing it does. A zero has nowhere useful to go, so it is a plain
    // fact rather than a disabled button.
    return value > 0
      ? <button type="button" className="active-fact" aria-label={`${value} ${label}. ${review}`} onClick={action}>{body}</button>
      : <span className="active-fact is-empty">{body}</span>;
  };
  return <main className="dashboard-shell active-dashboard">
    <section className="active-band">
      <div className="active-band-status">
        <MascotPet className="dashboard-otto-band" workday={observedOnly ? model.attendance?.state === "paused" ? "paused" : model.attendance?.state === "active" ? "active" : "off-shift" : model.state === "paused" ? "paused" : "active"} />
        <div className="active-band-state">
          <span className="active-band-label"><span className={`dashboard-status-dot ${syncClass(model.stateTone)}`} aria-hidden="true" />{observedOnly ? "Worktivity status" : model.stateLabel}</span>
          {(!confirmed || !attendanceControlsSupported) && <p className={`active-band-detail ${syncClass(model.stateTone)}`}>{attendanceControlsSupported ? model.stateDetail : "Use Worktivity on your Mac to clock in, pause, resume, or clock out. Work OS shows its confirmed status."}</p>}
        </div>
        <div className="active-band-actions">
          {attendanceControlsSupported && canPause && <button className="dashboard-secondary-action" disabled={busy} onClick={onPause}>{model.state === "paused" ? <CirclePlay size={14} aria-hidden="true" /> : <CirclePause size={14} aria-hidden="true" />}{model.state === "paused" ? "Resume" : "Pause"}</button>}
          {attendanceControlsSupported && canClockOut && <button className="dashboard-danger-action" disabled={busy} onClick={onClockOut}>Clock out</button>}
          <button className="dashboard-icon-link" aria-label="Open today’s Tasks" onClick={() => onOpenTasks("today")}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="active-band-instrument">
        <div className="active-reading">
          <small>Elapsed</small>
          <strong>{observedOnly ? model.pulse.observedElapsedLabel : model.pulse.elapsedLabel}</strong>
          <span>{observedOnly ? "Worktivity active time" : "Mirrored Worktivity time"}</span>
        </div>
        <PulseTimeline model={model} />
        <div className="active-reading is-end">
          <small>Remaining</small>
          <strong>{dashboardRemainingLabel(model).replace(" remaining", "")}</strong>
        </div>
      </div>
      <div className="active-band-facts" aria-label="Workday counts">
        {fact(model.metrics.completed, "completed", () => onOpenTasks("completed"), "Review completed tasks")}
        {fact(model.metrics.open, "open today", () => onOpenTasks("today"), "Review open tasks for today")}
        {fact(model.metrics.overdue, "overdue", () => onOpenTasks("unfinished"), "Review overdue work", true)}
        {fact(model.metrics.carryover, "carried over", onOpenCarryover, "Review tasks carried over from earlier workdays")}
      </div>
      <footer className="active-band-footer">
        <span className={`dashboard-sync-chip ${syncClass(model.stateTone)}`}><i />Worktivity</span>
        <small>{model.attendance?.message || "Observed context is unavailable."}</small>
        {model.activityWatch === "clock-out" && <small className="dashboard-activity-watch" role="status">Checking your activity… Work OS will close the day when Worktivity observes your clock-out.</small>}
        {goalSaveState !== "saved" && <button className="dashboard-save-warning" onClick={onRetryGoalSave}><RefreshCw size={12} aria-hidden="true" /> Retry focus save</button>}
      </footer>
    </section>

    <section className="active-focus-strip" aria-label="Today’s focus">
      <span className="active-focus-kicker"><Target size={12} aria-hidden="true" /> Focus</span>
      <button type="button" className="active-focus-copy" onClick={onOpenFocus} title="Edit today’s focus">
        <OverflowPanText>{model.focus.text}</OverflowPanText>
        <Pencil size={12} aria-hidden="true" />
      </button>
      <small className="active-focus-source">{model.focus.source}</small>
    </section>

    <section className="dashboard-panel active-task-panel" aria-label="Work queue">
      <header className="active-task-panel-header">
        <div className="active-task-tabs" role="tablist" aria-label="Workday tasks">
          {tabs.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`active-task-tab-${item.id}`} aria-controls="active-task-queue" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} onKeyDown={onTabKeyDown}>{item.label} <em>{item.count}</em></button>)}
        </div>
        <div className="active-task-panel-actions">
          <button className="dashboard-secondary-action" onClick={onAddTask}><Plus size={14} aria-hidden="true" /> Add task</button>
          <button className="dashboard-inline-link" onClick={() => onOpenTasks("today")}>Full workspace <ChevronRight size={14} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="active-task-queue" role="tabpanel" id="active-task-queue" aria-labelledby={`active-task-tab-${tab}`}>
        <DashboardTaskQueue tasks={sourceTasks} currentDate={currentDate} emptyTitle={tab === "today" ? "Today is clear" : "Nothing left behind"} emptyBody={tab === "today" ? "Add the next task you want to move forward." : "Earlier work is complete or already planned."} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} />
      </div>
      <footer className="dashboard-panel-footer">
        <span className={`dashboard-sync-chip ${syncClass(model.sync.tone)}`}><i />{model.sync.label}</span>
        <small>{model.sync.detail}</small>
        <span className="active-task-showing">Showing {Math.min(5, openInTab)} of {openInTab} open</span>
      </footer>
    </section>
  </main>;
}
