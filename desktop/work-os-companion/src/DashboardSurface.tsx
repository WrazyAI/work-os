import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CheckCircle2, ChevronRight, CirclePause, CirclePlay, Pencil, Plus, RefreshCw, Target, X } from "lucide-react";
import { formatWorkOsDate, formatWorkOsTime } from "./dateFormat";
import { dashboardRemainingLabel, type WorkdayDashboardModel } from "./dashboardModel";
import type { InsightsData } from "./types";
import { MascotPet } from "./MascotPet";
import { ProgressRing } from "./ProgressRing";
import { FadeArc } from "./LoadingUi";
import { OverflowPanText } from "./OverflowPan";
import { safeTaskText, subtaskProgress, taskState, type TaskRow } from "./taskWorkspace";
import { EllipsisMenu, TaskActionMenuItems } from "./taskSurfaces";
import { hasTaskMenu, taskCheckboxEnabled } from "./taskActions";
import worktivityMark from "./worktivity-mark.png";

export type DashboardTaskView = "today" | "unfinished" | "completed";

export interface DashboardSurfaceActions {
  onEditTask?: (task: TaskRow) => void;
  onArchiveTask?: (task: TaskRow) => void;
  onDeleteTask?: (task: TaskRow) => void;
  onAssignTask?: (task: TaskRow) => void;
  onStatusTask?: (task: TaskRow, status: "pending" | "in_progress") => void;
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
  /** The seven-day record that feeds the margin instruments. Optional so the
   *  command center still renders while it loads or when the read fails. */
  week?: InsightsData | null;
  weekLoading?: boolean;
  nextCheckIn?: string | null;
  nextCheckInRequired?: boolean;
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
  week?: InsightsData | null;
  weekLoading?: boolean;
  nextCheckIn?: string | null;
  nextCheckInRequired?: boolean;
}

function syncClass(tone: WorkdayDashboardModel["sync"]["tone"]) {
  return `dashboard-status-${tone}`;
}

/** Keep elapsed and remaining readings in the same duration vocabulary. */
function elapsedDuration(label: string) {
  const match = /^(\d+):([0-5]\d)$/.exec(label);
  if (!match) return label;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/** One count in the workday band. A zero has nowhere useful to go, so it is a
 *  plain fact rather than a disabled control, and the accessible name starts
 *  with the visible value and label (WCAG 2.5.3) before naming the destination. */
function BandFact({ value, label, detail, review, danger = false, onClick }: {
  value: number;
  label: string;
  detail: string;
  review: string;
  danger?: boolean;
  onClick: () => void;
}) {
  const content = <><span className="band-fact-label">{label}</span><strong className={danger && value > 0 ? "is-danger" : undefined}>{value}</strong><span className="band-fact-detail">{detail}</span></>;
  return value > 0
    ? <button type="button" className="band-fact" aria-label={`${value} ${label}. ${review}`} onClick={onClick}>{content}</button>
    : <span className="band-fact is-empty">{content}</span>;
}

function DashboardTaskRow({ task, currentDate, busy = false, taskFlight, onOpenTask, onToggleTask, onRetryPendingTask, onDismissPendingTask, actions }: {
  actions: Partial<DashboardSurfaceActions>;
  task: TaskRow;
  currentDate: string;
  busy?: boolean;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
  onOpenTask: (task: TaskRow) => void;
  onToggleTask: (task: TaskRow, completed: boolean) => void;
  onRetryPendingTask?: (task: TaskRow) => void;
  onDismissPendingTask?: (task: TaskRow) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const id = String(task.provider_task_id ?? task.id);
  const title = safeTaskText(task.title, "Untitled task");
  const pending = task.pending_status === "syncing" || task.pending_status === "failed" ? task.pending_status : null;
  const flight = taskFlight?.get(id) ?? null;
  const state = taskState(task, currentDate);
  const progress = subtaskProgress(task);
  const due = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
  const dueLabel = due ? due === currentDate ? "Today" : formatWorkOsDate(due) : "No date";
  const stateLabel = task.completed ? "Done" : state === "overdue" ? "Overdue" : "Open";
  const project = typeof task.project?.name === "string" ? task.project.name : null;
  const priority = task.priority ? `${String(task.priority).replace(/^./, (value) => value.toUpperCase())} priority` : null;
  const subtitle = [project, priority].filter(Boolean).join(" · ");
  return <article className={`dashboard-task-row ${state}${pending ? " is-pending" : ""}${flight === "leaving" ? " is-leaving" : ""}`} data-task-id={id}>
    <button type="button" className={`dashboard-task-check${task.completed || flight === "leaving" ? " is-complete" : ""}${flight === "completing" ? " is-completing" : ""}`} disabled={!!pending || !!flight || !taskCheckboxEnabled(task)} aria-busy={flight === "completing"} aria-label={flight === "completing" ? `Completing ${title}` : task.completed ? `Reopen ${title}` : `Complete ${title}`} onClick={() => { if (!pending && !flight) onToggleTask(task, !task.completed); }}>
      {pending === "syncing" || flight === "completing" ? <FadeArc size={13} /> : task.completed || flight === "leaving" ? <Check size={15} aria-hidden="true" /> : null}
    </button>
    <button type="button" className="dashboard-task-row-copy" disabled={!!pending || !!flight} onClick={() => onOpenTask(task)}>
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </button>
    <span className="dashboard-task-row-progress">{progress.total > 0 ? <ProgressRing completed={progress.completed} total={progress.total} size={24} stroke={3} label="subtasks" /> : null}</span>
    <span className={`dashboard-task-row-due${state === "overdue" ? " is-overdue" : ""}`}>{dueLabel}</span>
    <span className={`dashboard-task-pill is-${state}`}>{stateLabel}</span>
    <div className="dashboard-task-row-actions">
      {pending === "failed" && <span className="dashboard-pending-actions"><button type="button" title={task.pending_error || "Retry adding task"} aria-label={`Retry adding ${title}`} onClick={() => onRetryPendingTask?.(task)}><RefreshCw size={13} /></button><button type="button" aria-label={`Dismiss ${title}`} onClick={() => onDismissPendingTask?.(task)}><Check size={12} /></button></span>}
      {!pending && hasTaskMenu(task, currentDate) && <div className={`dashboard-task-menu ${menuOpen ? "open" : ""}`}><EllipsisMenu open={menuOpen} label={`Actions for ${title}`} disabled={busy || !!flight} onToggle={() => setMenuOpen((value) => !value)} onClose={() => setMenuOpen(false)}><TaskActionMenuItems task={task} currentDate={currentDate} busy={busy} onStatus={(status) => actions.onStatusTask?.(task, status)} onComplete={(completed) => onToggleTask(task, completed)} onEdit={() => actions.onEditTask?.(task)} onAssign={actions.onAssignTask ? () => actions.onAssignTask?.(task) : undefined} onArchive={() => actions.onArchiveTask?.(task)} onDelete={() => actions.onDeleteTask?.(task)} onClose={() => setMenuOpen(false)} /></EllipsisMenu></div>}
    </div>
    <span className="dashboard-task-row-meta">
      {progress.total > 0 ? <span>{progress.completed}/{progress.total} subtasks</span> : null}
      <span>Due {dueLabel}</span>
      <span className={state === "overdue" ? "is-overdue" : undefined}>{stateLabel}</span>
    </span>
  </article>;
}

function DashboardTaskQueue({ tasks, currentDate, emptyTitle, emptyBody, busy, taskFlight, onOpenTask, onToggleTask, onRetryPendingTask, onDismissPendingTask, actions }: {
  actions: Partial<DashboardSurfaceActions>;
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
    ? <div className="dashboard-task-queue">{openTasks.map((task) => <DashboardTaskRow actions={actions} key={String(task.provider_task_id ?? task.id)} task={task} currentDate={currentDate} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} />)}</div>
    : <div className="dashboard-empty-state"><span className="dashboard-empty-icon"><CheckCircle2 size={18} /></span><strong>{emptyTitle}</strong><p>{emptyBody}</p></div>;
}

function PulseTimeline({ model, showPosition = true, expanded = false }: { model: WorkdayDashboardModel; showPosition?: boolean; expanded?: boolean }) {
  const progress = Math.max(0, Math.min(100, model.pulse.progressPercent));
  const localTime = Number.isFinite(model.asOf) ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(model.asOf)) : "Unavailable";
  const start = formatWorkOsTime(model.schedule.startsAt ?? undefined, model.schedule.timezone ?? undefined);
  const end = formatWorkOsTime(model.schedule.endsAt ?? undefined, model.schedule.timezone ?? undefined);
  // The axis names the scheduled window only: the reader's own clock already
  // tells them the time, so the marker carries the present without restating it.
  // Before the window opens there is no position to mark.
  return <div className="dashboard-pulse-timeline">
    <div className="dashboard-pulse-line" tabIndex={0} role="img" aria-label={expanded ? `Current local time: ${localTime}` : `Scheduled window: ${start} to ${end}`}>
      <i style={{ width: `${progress}%` }} />{showPosition && <b style={{ left: `clamp(8px, ${progress}%, calc(100% - 8px))` }} />}
      <span className="dashboard-pulse-time" aria-hidden="true" style={{ left: `clamp(75px, ${progress}%, calc(100% - 75px))` }}>{expanded ? <><small>Local time</small><strong>{localTime}</strong></> : <><small>Scheduled window</small><strong>{start} – {end}</strong></>}</span>
    </div>
    {expanded && <div className="dashboard-pulse-labels"><span><small>Start</small><strong>{start}</strong></span><span><small>End</small><strong>{end}</strong></span></div>}
  </div>;
}

function WeekInstrument({ week, loading = false }: { week?: InsightsData | null; loading?: boolean }) {
  const days = week?.days ?? [];
  const values = days.map((entry) => Number(entry.tasksCompleted ?? 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  const max = Math.max(4, Math.ceil(Math.max(1, ...values) / 2) * 2);
  const chartX = (index: number) => 42 + (index * 280) / Math.max(1, days.length - 1);
  const chartY = (value: number) => 122 - (value / max) * 92;
  const points = days.map((entry, index) => ({
    x: chartX(index),
    y: chartY(Number(entry.tasksCompleted ?? 0)),
    date: entry.date,
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const area = points.length
    ? `${line} L${points[points.length - 1].x.toFixed(1)} 122 L${points[0].x.toFixed(1)} 122 Z`
    : "";
  const label = days.map((entry) => `${formatWorkOsDate(entry.date)} ${Number(entry.tasksCompleted ?? 0)} tasks completed`).join(", ");
  return <section className="dashboard-instrument dashboard-week" aria-labelledby="dashboard-week-title">
    <header className="dashboard-instrument-head">
      <h2 id="dashboard-week-title">This week</h2>
      <span><strong>{total}</strong> completed</span>
    </header>
    {days.length ? <>
      <svg className="dashboard-week-chart" viewBox="0 0 340 156" role="img" aria-label={`Tasks completed each day: ${label}.`}>
        <line className="dashboard-week-grid" x1="34" y1={chartY(max)} x2="330" y2={chartY(max)} />
        <line className="dashboard-week-grid" x1="34" y1={chartY(max / 2)} x2="330" y2={chartY(max / 2)} />
        <line className="dashboard-week-grid" x1="34" y1={chartY(0)} x2="330" y2={chartY(0)} />
        <text className="dashboard-week-axis" x="6" y={chartY(max) + 3}>{max}</text>
        <text className="dashboard-week-axis" x="6" y={chartY(max / 2) + 3}>{max / 2}</text>
        <text className="dashboard-week-axis" x="6" y={chartY(0) + 3}>0</text>
        {points.length > 1 ? <path className="dashboard-week-area" d={area} /> : null}
        {points.length > 1 ? <path className="dashboard-week-line" pathLength={1} d={line} /> : null}
        {points.map((point, index) => <circle key={`${point.date}-dot`} className={index === points.length - 1 ? "dashboard-week-dot is-today" : "dashboard-week-dot"} cx={point.x} cy={point.y} r={index === points.length - 1 ? 4.2 : 3.4} />)}
        {days.map((entry, index) => <text key={`${entry.date}-label`} className={index === days.length - 1 ? "dashboard-week-day is-today" : "dashboard-week-day"} x={points[index]?.x ?? 0} y="146" textAnchor="middle">{index === days.length - 1 ? "Today" : weekdayInitial(entry.date)}</text>)}
      </svg>
      <p className="dashboard-instrument-note">Tasks completed, not a productivity score. Today is the filled mark.</p>
    </> : <div className="dashboard-instrument-empty">{loading ? "Loading this week’s record…" : "No recorded days in this range."}</div>}
  </section>;
}

function weekdayInitial(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "narrow" }).format(parsed);
}

function DashboardMargin({ week, weekLoading = false }: {
  week?: InsightsData | null;
  weekLoading?: boolean;
}) {
  const days = week?.days ?? [];
  const consistency = week?.consistency;
  const dayCount = consistency?.dayCount ?? days.length;
  const onTime = days.reduce((sum, entry) => sum + Number(entry.outcomesOnTime ?? 0), 0);
  const late = days.reduce((sum, entry) => sum + Number(entry.outcomesLate ?? 0), 0);
  const reliability = [
    onTime + late > 0 ? { label: "On-time outcomes", value: `${onTime} of ${onTime + late}`, percent: Math.round((onTime / (onTime + late)) * 100) } : null,
    consistency && dayCount > 0 ? { label: "Days with an update", value: `${consistency.daysWithUpdate} of ${dayCount}`, percent: Math.round((consistency.daysWithUpdate / dayCount) * 100) } : null,
    consistency && dayCount > 0 ? { label: "Days with a completed task", value: `${consistency.daysWithCompletion} of ${dayCount}`, percent: Math.round((consistency.daysWithCompletion / dayCount) * 100), quiet: true } : null,
  ].filter((row): row is { label: string; value: string; percent: number; quiet?: boolean } => row !== null);
  return <aside className="dashboard-margin" aria-label="Workday instruments">
    <WeekInstrument week={week} loading={weekLoading} />
    {reliability.length ? <section className="dashboard-instrument dashboard-reliability" aria-labelledby="dashboard-reliability-title">
      <header className="dashboard-instrument-head">
        <h2 id="dashboard-reliability-title">Plan reliability</h2>
        <span>{dayCount} {dayCount === 1 ? "day" : "days"}</span>
      </header>
      <div className="dashboard-rel-rows">
        {reliability.map((row) => <div className="dashboard-rel-row" key={row.label}>
          <div className="dashboard-rel-top"><span>{row.label}</span><small>{row.value} · {row.percent}%</small></div>
          <div className="dashboard-rel-track"><i className={row.quiet ? "is-quiet" : undefined} style={{ width: `${row.percent}%` }} /></div>
        </div>)}
      </div>
    </section> : null}
  </aside>;
}

function WorkdayBand({ model, currentDate, observedOnly = false, children }: { model: WorkdayDashboardModel; currentDate: string; observedOnly?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const dismiss = () => {
    if (closeTimer.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
      setClosing(false);
      trigger.current?.focus();
    }, 160);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  useEffect(() => {
    if (!open) return;
    close.current?.focus();
    function handleKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); }
      if (event.key === "Tab" && dialog.current) {
        const controls = Array.from(dialog.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'));
        if (!controls.length) return;
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);
  const active = model.state === "active" || model.state === "paused" || model.state === "observed";
  return <>
    <section className="workday-band" onClick={(event) => { if (!(event.target as Element).closest("button, a, input, select, textarea")) setOpen(true); }}>
      {children}
      <button ref={trigger} type="button" className="workday-details-trigger" aria-label="Open workday details" aria-haspopup="dialog" onClick={() => setOpen(true)}>Workday details <ChevronRight size={14} aria-hidden="true" /></button>
    </section>
    {open && createPortal(<div className={`workday-details-backdrop${closing ? " is-closing" : ""}`} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
      <div ref={dialog} className="workday-details-dialog" role="dialog" aria-modal="true" aria-labelledby="workday-details-title">
        <header className="workday-details-header"><div><p>{formatWorkOsDate(currentDate)}</p><h2 id="workday-details-title">Your workday</h2></div><button ref={close} type="button" aria-label="Close workday details" onClick={dismiss}><X size={18} aria-hidden="true" /></button></header>
        <div className="workday-details-body">
          <div className="workday-details-status"><span className={`dashboard-status-dot ${syncClass(model.stateTone)}`} aria-hidden="true" /><strong>{model.stateLabel}</strong>{model.attendance?.source === "worktivity" && !model.attendance.stale && (model.state === "active" || model.state === "paused" || model.state === "observed") && <span className="workday-provider"><img src={worktivityMark} alt="" /> From Worktivity</span>}</div>
          {model.stateTone !== "signal" && <p className="workday-details-explanation">{model.stateDetail}</p>}
          <section className="workday-details-window" aria-label="Scheduled work window">
            <div className="workday-details-window-heading"><div><span>Scheduled window</span><strong>{formatWorkOsTime(model.schedule.startsAt ?? undefined, model.schedule.timezone ?? undefined)} <i>to</i> {formatWorkOsTime(model.schedule.endsAt ?? undefined, model.schedule.timezone ?? undefined)}</strong></div>{model.schedule.phase !== "unavailable" && <span className="workday-details-percent">{Math.round(Math.max(0, Math.min(100, model.pulse.progressPercent)))}% of window</span>}</div>
            <PulseTimeline model={model} showPosition={model.schedule.phase !== "upcoming"} expanded />
            <div className="workday-details-readings"><div><span>{active ? "Elapsed" : "Schedule"}</span><strong>{active ? elapsedDuration(observedOnly ? model.pulse.observedElapsedLabel : model.pulse.elapsedLabel) : !model.schedule.startsAt ? "Not set" : model.schedule.phase === "complete" ? "Ended" : model.schedule.phase === "upcoming" ? "Upcoming" : "Ready"}</strong></div><div><span>{model.schedule.phase === "upcoming" ? "Starts in" : "Remaining"}</span><strong>{dashboardRemainingLabel(model).replace(" remaining", "")}</strong></div></div>
          </section>
          <section className="workday-details-work"><div><h3>Work on your plate</h3></div><dl><div><dt>Completed</dt><dd>{model.metrics.completed}</dd></div><div><dt>Open today</dt><dd>{model.metrics.open}</dd></div><div><dt>Overdue</dt><dd>{model.metrics.overdue}</dd></div><div><dt>Carried over</dt><dd>{model.metrics.carryover}</dd></div></dl></section>
          <div className="workday-details-focus"><span>Today’s focus</span><p>{model.focus.text}</p><small>{model.focus.source}</small></div>
        </div>
      </div>
    </div>, document.body)}
  </>;
}

export function OffShiftDashboard({ model, tasks, currentDate, busy = false, canClockIn = true, attendanceControlsSupported = true, goalSaveState = "saved", week = null, weekLoading = false, nextCheckIn = null, nextCheckInRequired = false, taskFlight, onOpenTasks, onOpenCarryover, onOpenFocus, onOpenTask, onToggleTask, onClockIn, onRetryPendingTask, onDismissPendingTask, ...actions }: OffShiftDashboardProps) {
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
    <WorkdayBand model={model} currentDate={currentDate}>
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
        <BandFact value={model.metrics.planned} label="planned" detail="on today’s list" review="Review today’s tasks" onClick={() => onOpenTasks("today")} />
        <BandFact value={model.metrics.carryover} label="carried over" detail="older open work" review="Review tasks carried over from earlier workdays" onClick={onOpenCarryover} />
        <BandFact value={model.metrics.overdue} label="overdue" detail="open work past due" review="Review overdue work" danger onClick={() => onOpenTasks("unfinished")} />
        <BandFact value={model.metrics.completed} label="completed" detail="outcomes today" review="Review completed tasks" onClick={() => onOpenTasks("completed")} />
      </div>
      <section className="day-focus-strip" aria-label="Today’s focus">
        <span className="day-focus-kicker"><Target size={12} aria-hidden="true" /> Focus</span>
        <button type="button" className="day-focus-copy" onClick={onOpenFocus} title="Edit today’s focus">
          <OverflowPanText className="agenda-strip-focus-scroll" lineClassName="agenda-strip-text">{model.focus.text}</OverflowPanText>
          <Pencil size={12} aria-hidden="true" />
        </button>
        <small className="day-focus-source">{model.focus.source}{nextCheckIn ? ` · Next check-in ${nextCheckIn}${nextCheckInRequired ? " (required)" : ""}` : ""}</small>
      </section>
      {(model.activityWatch === "clock-in" || goalSaveState !== "saved") && <footer className="workday-band-footer">
        {model.activityWatch === "clock-in" && <small className="dashboard-activity-watch" role="status">Checking your activity… Work OS will clock you in as soon as Worktivity sees you working.</small>}
        {goalSaveState !== "saved" && <small className="dashboard-save-warning"><RefreshCw size={12} aria-hidden="true" /> Focus changes are {goalSaveState === "saving" ? "saving" : "waiting to retry"}.</small>}
      </footer>}
    </WorkdayBand>

    <div className="dashboard-body">
      <section className="dashboard-panel work-queue-panel" aria-label="Work queue">
        <header className="work-queue-header is-static">
          <h3>First moves</h3>
          <div className="work-queue-actions">
            <button className="dashboard-inline-link" onClick={() => onOpenTasks("today")}>Open Tasks <ChevronRight size={14} aria-hidden="true" /></button>
          </div>
        </header>
        {openCount > 0 ? <div className="dashboard-task-columns" aria-hidden="true"><span /><span>Task</span><span /><span>Due</span><span>Status</span><span /></div> : null}
        <div className="work-queue-list">
          <DashboardTaskQueue actions={actions} tasks={tasks} currentDate={currentDate} emptyTitle={taskCopy.title} emptyBody={taskCopy.body} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} />
        </div>
        <footer className="dashboard-panel-footer">
          <span className={`dashboard-sync-chip ${syncClass(model.sync.tone)}`}><i />{model.sync.label}</span>
          <small>{model.sync.detail}</small>
          <span className="work-queue-showing">Showing {Math.min(5, openCount)} of {openCount} open</span>
        </footer>
      </section>
      <DashboardMargin week={week} weekLoading={weekLoading} />
    </div>
  </main>;
}

export function ActiveWorkdayDashboard({ model, tasks, previousTasks, otherTasks, currentDate, busy = false, canPause = false, canClockOut = true, attendanceControlsSupported = true, observedOnly = false, goalSaveState = "saved", week = null, weekLoading = false, nextCheckIn = null, nextCheckInRequired = false, taskFlight, onRetryGoalSave, onOpenTasks, onOpenCarryover, onOpenFocus, onOpenTask, onToggleTask, onPause, onClockOut, onAddTask, onRetryPendingTask, onDismissPendingTask, ...actions }: ActiveWorkdayDashboardProps) {
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
    <WorkdayBand model={model} currentDate={currentDate} observedOnly={observedOnly}>
      <div className="workday-band-status">
        <MascotPet className="dashboard-otto-band" workday={observedOnly ? model.attendance?.state === "paused" ? "paused" : model.attendance?.state === "active" ? "active" : "off-shift" : model.state === "paused" ? "paused" : "active"} />
        <div className="workday-band-state">
          <span className="workday-band-label"><span className={`dashboard-status-dot ${syncClass(model.stateTone)}`} aria-hidden="true" />{observedOnly ? "Worktivity status" : model.stateLabel}</span>
          {(!confirmed || !attendanceControlsSupported) && <p className={`workday-band-detail ${syncClass(model.stateTone)}`}>{attendanceControlsSupported ? model.stateDetail : "Use Worktivity on your Mac to clock in, pause, resume, or clock out. Work OS shows its confirmed status."}</p>}
          {confirmed && attendanceControlsSupported && model.attendance?.observedAt ? <p className="workday-band-detail">Last observed {formatWorkOsTime(model.attendance.observedAt, model.schedule.timezone ?? undefined)} by Worktivity.</p> : null}
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
          <strong>{elapsedDuration(observedOnly ? model.pulse.observedElapsedLabel : model.pulse.elapsedLabel)}</strong>
        </div>
        <PulseTimeline model={model} />
        <div className="band-reading is-end">
          <small>Remaining</small>
          <strong>{dashboardRemainingLabel(model).replace(" remaining", "")}</strong>
        </div>
      </div>
      <div className="workday-band-facts" aria-label="Workday counts">
        <BandFact value={model.metrics.completed} label="completed" detail="outcomes today" review="Review completed tasks" onClick={() => onOpenTasks("completed")} />
        <BandFact value={model.metrics.open} label="open today" detail="attributed to today" review="Review open tasks for today" onClick={() => onOpenTasks("today")} />
        <BandFact value={model.metrics.overdue} label="overdue" detail="open work past due" review="Review overdue work" danger onClick={() => onOpenTasks("unfinished")} />
        <BandFact value={model.metrics.carryover} label="carried over" detail="older open work" review="Review tasks carried over from earlier workdays" onClick={onOpenCarryover} />
      </div>
      <section className="day-focus-strip" aria-label="Today’s focus">
        <span className="day-focus-kicker"><Target size={12} aria-hidden="true" /> Focus</span>
        <button type="button" className="day-focus-copy" onClick={onOpenFocus} title="Edit today’s focus">
          <OverflowPanText className="agenda-strip-focus-scroll" lineClassName="agenda-strip-text">{model.focus.text}</OverflowPanText>
          <Pencil size={12} aria-hidden="true" />
        </button>
        <small className="day-focus-source">{model.focus.source}{nextCheckIn ? ` · Next check-in ${nextCheckIn}${nextCheckInRequired ? " (required)" : ""}` : ""}</small>
      </section>
      {(model.activityWatch === "clock-out" || goalSaveState !== "saved") && <footer className="workday-band-footer">
        {model.activityWatch === "clock-out" && <small className="dashboard-activity-watch" role="status">Checking your activity… Work OS will close the day when Worktivity observes your clock-out.</small>}
        {goalSaveState !== "saved" && <button className="dashboard-save-warning" onClick={onRetryGoalSave}><RefreshCw size={12} aria-hidden="true" /> Retry focus save</button>}
      </footer>}
    </WorkdayBand>

    <div className="dashboard-body">
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
        {openInTab > 0 ? <div className="dashboard-task-columns" aria-hidden="true"><span /><span>Task</span><span /><span>Due</span><span>Status</span><span /></div> : null}
        <div className="work-queue-list" role="tabpanel" id="work-queue-list" aria-labelledby={`work-queue-tab-${tab}`}>
          <DashboardTaskQueue actions={actions} tasks={sourceTasks} currentDate={currentDate} emptyTitle={tab === "today" ? "Today is clear" : "Nothing left behind"} emptyBody={tab === "today" ? "Add the next task you want to move forward." : "Earlier work is complete or already planned."} busy={busy} taskFlight={taskFlight} onOpenTask={onOpenTask} onToggleTask={onToggleTask} onRetryPendingTask={onRetryPendingTask} onDismissPendingTask={onDismissPendingTask} />
        </div>
        <footer className="dashboard-panel-footer">
          <span className={`dashboard-sync-chip ${syncClass(model.sync.tone)}`}><i />{model.sync.label}</span>
          <small>{model.sync.detail}</small>
          <span className="work-queue-showing">Showing {Math.min(5, openInTab)} of {openInTab} open</span>
        </footer>
      </section>
      <DashboardMargin week={week} weekLoading={weekLoading} />
    </div>
  </main>;
}
