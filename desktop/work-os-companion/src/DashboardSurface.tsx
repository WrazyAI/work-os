import { useRef, useState, type KeyboardEvent } from "react";
import { Check, CheckCircle2, ChevronRight, CirclePause, CirclePlay, Pencil, Plus, RefreshCw, Target } from "lucide-react";
import { formatWorkOsDate, formatWorkOsTime } from "./dateFormat";
import { dashboardRemainingLabel, type WorkdayDashboardModel } from "./dashboardModel";
import { MascotPet } from "./MascotPet";
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

/** One count in the workday band. A zero has nowhere useful to go, so it is a
 *  plain fact rather than a disabled control, and the accessible name starts
 *  with the visible value and label (WCAG 2.5.3) before naming the destination. */
function BandFact({ value, label, review, danger = false, onClick }: {
  value: number;
  label: string;
  review: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const content = <><strong className={danger && value > 0 ? "is-danger" : undefined}>{value}</strong><small>{label}</small></>;
  return value > 0
    ? <button type="button" className="band-fact" aria-label={`${value} ${label}. ${review}`} onClick={onClick}>{content}</button>
    : <span className="band-fact is-empty">{content}</span>;
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

function PulseTimeline({ model, showPosition = true }: { model: WorkdayDashboardModel; showPosition?: boolean }) {
  const progress = Math.max(0, Math.min(100, model.pulse.progressPercent));
  // The axis names the scheduled window only: the reader's own clock already
  // tells them the time, so the marker carries the present without restating it.
  // Before the window opens there is no position to mark.
  return <div className="dashboard-pulse-timeline">
    <div className="dashboard-pulse-line"><i style={{ width: `${progress}%` }} />{showPosition && <b style={{ left: `clamp(8px, ${progress}%, calc(100% - 8px))` }} />}</div>
    <div className="dashboard-pulse-labels">
      <span><small>Start</small><strong>{formatWorkOsTime(model.schedule.startsAt ?? undefined, model.schedule.timezone ?? undefined)}</strong></span>
      <span><small>End</small><strong>{formatWorkOsTime(model.schedule.endsAt ?? undefined, model.schedule.timezone ?? undefined)}</strong></span>
    </div>
  </div>;
}

export function OffShiftDashboard({ model, tasks, currentDate, busy = false, canClockIn = true, attendanceControlsSupported = true, goalSaveState = "saved", taskFlight, onOpenTasks, onOpenCarryover, onOpenFocus, onOpenTask, onToggleTask, onClockIn, onRetryPendingTask, onDismissPendingTask }: OffShiftDashboardProps) {
  const taskCopy = model.metrics.carryover > 0
    ? { title: "Start by clearing the oldest decision", body: `${model.metrics.carryover} unfinished task${model.metrics.carryover === 1 ? "" : "s"} is waiting from an earlier workday.` }
    : { title: "Your agenda is open", body: "Choose a first priority or use the composer below to add one without clocking in." };
  const openCount = tasks.filter((task) => task.completed !== true).length;
  const startsIn = model.schedule.phase === "upcoming" ? dashboardRemainingLabel(model).replace(" remaining", "") : null;
  const scheduleKnown = Boolean(model.schedule.startsAt && model.schedule.endsAt);
  // Pre-shift there is no window progress to draw, so the instrument leads with
  // the time until the window opens and the axis carries its start and end.
  const windowReading = !scheduleKnown ? "Not set" : startsIn ?? (model.schedule.phase === "complete" ? "Ended" : "Ready");
  const readiness = !attendanceControlsSupported
    ? "Use Worktivity on your Mac to clock in, pause, resume, or clock out. Work OS shows its confirmed status."
    : model.schedule.phase === "upcoming"
      ? "Clock in with Worktivity from the Windows Companion; Work OS waits for provider confirmation."
      : "Shape the agenda now, then clock in with Worktivity from the Windows Companion when you are ready.";
  const degraded = model.stateTone === "warning" || model.stateTone === "danger";
  return <main className="dashboard-shell off-shift-dashboard">
    <section className="workday-band">
      <div className="workday-band-status">
        <MascotPet className="dashboard-otto-band" workday="off-shift" />
        <div className="workday-band-state">
          <span className="workday-band-label"><span className={`dashboard-status-dot ${syncClass(model.stateTone)}`} aria-hidden="true" />{model.stateLabel}</span>
          <p className={`workday-band-detail ${degraded ? syncClass(model.stateTone) : ""}`}>{degraded ? model.stateDetail : `${model.stateDetail} ${readiness}`}</p>
        </div>
        <div className="workday-band-actions">
          {attendanceControlsSupported && <button className="dashboard-primary-action" disabled={busy || !canClockIn} onClick={onClockIn}><CirclePlay size={14} aria-hidden="true" /> Clock in</button>}
          <button className="dashboard-secondary-action" onClick={onOpenFocus}><Pencil size={14} aria-hidden="true" /> Set focus</button>
        </div>
      </div>
      <div className="workday-band-instrument is-single">
        <div className="band-reading">
          <small>{startsIn ? "Starts in" : model.schedule.phase === "complete" ? "Window" : "Schedule"}</small>
          <strong>{windowReading}</strong>
        </div>
        <PulseTimeline model={model} showPosition={model.schedule.phase !== "upcoming"} />
      </div>
      <div className="workday-band-facts" aria-label="Workday counts">
        <BandFact value={model.metrics.planned} label="planned" review="Review today’s tasks" onClick={() => onOpenTasks("today")} />
        <BandFact value={model.metrics.carryover} label="carried over" review="Review tasks carried over from earlier workdays" onClick={onOpenCarryover} />
        <BandFact value={model.metrics.overdue} label="overdue" review="Review overdue work" danger onClick={() => onOpenTasks("unfinished")} />
        <BandFact value={model.metrics.completed} label="completed" review="Review completed tasks" onClick={() => onOpenTasks("completed")} />
      </div>
      {(model.activityWatch === "clock-in" || goalSaveState !== "saved") && <footer className="workday-band-footer">
        {model.activityWatch === "clock-in" && <small className="dashboard-activity-watch" role="status">Checking your activity… Work OS will clock you in as soon as Worktivity sees you working.</small>}
        {goalSaveState !== "saved" && <small className="dashboard-save-warning"><RefreshCw size={12} aria-hidden="true" /> Focus changes are {goalSaveState === "saving" ? "saving" : "waiting to retry"}.</small>}
      </footer>}
    </section>

    <section className="day-focus-strip" aria-label="Today’s focus">
      <span className="day-focus-kicker"><Target size={12} aria-hidden="true" /> Focus</span>
      <button type="button" className="day-focus-copy" onClick={onOpenFocus} title="Edit today’s focus">
        <OverflowPanText className="agenda-strip-focus-scroll" lineClassName="agenda-strip-text">{model.focus.text}</OverflowPanText>
        <Pencil size={12} aria-hidden="true" />
      </button>
      <small className="day-focus-source">{model.focus.source}</small>
    </section>

    <section className="dashboard-panel work-queue-panel" aria-label="Work queue">
      <header className="work-queue-header is-static">
        <h3>First moves</h3>
        <div className="work-queue-actions">
          <button className="dashboard-inline-link" onClick={() => onOpenTasks("today")}>Open Tasks <ChevronRight size={14} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="work-queue-list">
        <DashboardTaskQueue tasks={tasks} currentDate={currentDate} emptyTitle={taskCopy.title} emptyBody={taskCopy.body} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} />
      </div>
      <footer className="dashboard-panel-footer">
        <span className={`dashboard-sync-chip ${syncClass(model.sync.tone)}`}><i />{model.sync.label}</span>
        <small>{model.sync.detail}</small>
        <span className="work-queue-showing">Showing {Math.min(5, openCount)} of {openCount} open</span>
      </footer>
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
  return <main className="dashboard-shell active-dashboard">
    <section className="workday-band">
      <div className="workday-band-status">
        <MascotPet className="dashboard-otto-band" workday={observedOnly ? model.attendance?.state === "paused" ? "paused" : model.attendance?.state === "active" ? "active" : "off-shift" : model.state === "paused" ? "paused" : "active"} />
        <div className="workday-band-state">
          <span className="workday-band-label"><span className={`dashboard-status-dot ${syncClass(model.stateTone)}`} aria-hidden="true" />{observedOnly ? "Worktivity status" : model.stateLabel}</span>
          {(!confirmed || !attendanceControlsSupported) && <p className={`workday-band-detail ${syncClass(model.stateTone)}`}>{attendanceControlsSupported ? model.stateDetail : "Use Worktivity on your Mac to clock in, pause, resume, or clock out. Work OS shows its confirmed status."}</p>}
        </div>
        <div className="workday-band-actions">
          {attendanceControlsSupported && canPause && <button className="dashboard-secondary-action" disabled={busy} onClick={onPause}>{model.state === "paused" ? <CirclePlay size={14} aria-hidden="true" /> : <CirclePause size={14} aria-hidden="true" />}{model.state === "paused" ? "Resume" : "Pause"}</button>}
          {attendanceControlsSupported && canClockOut && <button className="dashboard-danger-action" disabled={busy} onClick={onClockOut}>Clock out</button>}
          <button className="dashboard-icon-link" aria-label="Open today’s Tasks" onClick={() => onOpenTasks("today")}><ChevronRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="workday-band-instrument">
        <div className="band-reading">
          <small>Elapsed</small>
          <strong>{observedOnly ? model.pulse.observedElapsedLabel : model.pulse.elapsedLabel}</strong>
          <span>{observedOnly ? "Worktivity active time" : "Mirrored Worktivity time"}</span>
        </div>
        <PulseTimeline model={model} />
        <div className="band-reading is-end">
          <small>Remaining</small>
          <strong>{dashboardRemainingLabel(model).replace(" remaining", "")}</strong>
        </div>
      </div>
      <div className="workday-band-facts" aria-label="Workday counts">
        <BandFact value={model.metrics.completed} label="completed" review="Review completed tasks" onClick={() => onOpenTasks("completed")} />
        <BandFact value={model.metrics.open} label="open today" review="Review open tasks for today" onClick={() => onOpenTasks("today")} />
        <BandFact value={model.metrics.overdue} label="overdue" review="Review overdue work" danger onClick={() => onOpenTasks("unfinished")} />
        <BandFact value={model.metrics.carryover} label="carried over" review="Review tasks carried over from earlier workdays" onClick={onOpenCarryover} />
      </div>
      {(model.activityWatch === "clock-out" || goalSaveState !== "saved") && <footer className="workday-band-footer">
        {model.activityWatch === "clock-out" && <small className="dashboard-activity-watch" role="status">Checking your activity… Work OS will close the day when Worktivity observes your clock-out.</small>}
        {goalSaveState !== "saved" && <button className="dashboard-save-warning" onClick={onRetryGoalSave}><RefreshCw size={12} aria-hidden="true" /> Retry focus save</button>}
      </footer>}
    </section>

    <section className="day-focus-strip" aria-label="Today’s focus">
      <span className="day-focus-kicker"><Target size={12} aria-hidden="true" /> Focus</span>
      <button type="button" className="day-focus-copy" onClick={onOpenFocus} title="Edit today’s focus">
        <OverflowPanText className="agenda-strip-focus-scroll" lineClassName="agenda-strip-text">{model.focus.text}</OverflowPanText>
        <Pencil size={12} aria-hidden="true" />
      </button>
      <small className="day-focus-source">{model.focus.source}</small>
    </section>

    <section className="dashboard-panel work-queue-panel" aria-label="Work queue">
      <header className="work-queue-header">
        <div className="work-queue-tabs" role="tablist" aria-label="Workday tasks">
          {tabs.map((item, index) => <button key={item.id} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`work-queue-tab-${item.id}`} aria-controls="work-queue-list" aria-selected={tab === item.id} tabIndex={tab === item.id ? 0 : -1} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} onKeyDown={onTabKeyDown}>{item.label} <em>{item.count}</em></button>)}
        </div>
        <div className="work-queue-actions">
          <button className="dashboard-secondary-action" onClick={onAddTask}><Plus size={14} aria-hidden="true" /> Add task</button>
          <button className="dashboard-inline-link" onClick={() => onOpenTasks("today")}>Full workspace <ChevronRight size={14} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="work-queue-list" role="tabpanel" id="work-queue-list" aria-labelledby={`work-queue-tab-${tab}`}>
        <DashboardTaskQueue tasks={sourceTasks} currentDate={currentDate} emptyTitle={tab === "today" ? "Today is clear" : "Nothing left behind"} emptyBody={tab === "today" ? "Add the next task you want to move forward." : "Earlier work is complete or already planned."} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} />
      </div>
      <footer className="dashboard-panel-footer">
        <span className={`dashboard-sync-chip ${syncClass(model.sync.tone)}`}><i />{model.sync.label}</span>
        <small>{model.sync.detail}</small>
        <span className="work-queue-showing">Showing {Math.min(5, openInTab)} of {openInTab} open</span>
      </footer>
    </section>
  </main>;
}
