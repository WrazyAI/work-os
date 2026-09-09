import { useState } from "react";
import { BriefcaseBusiness, CheckCircle2, ChevronRight, CirclePlay, Gauge, LayoutDashboard, ListChecks, MessageSquareText, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { ActiveDayWorkspace, DashboardTaskCard, ProgressComposer, ShiftPulseCard } from "./App";
import { shiftPulse } from "./shiftPulse";
import type { TaskRow } from "./taskWorkspace";
import companionArt from "./assets/work-os-task-stack-v2.png";
import wordmark from "./assets/work-os-mark.png";

const initialTasks: TaskRow[] = [
  { id: "today-1", title: "Finalize the active workday experience", description: "Ship the KPI strip and the top-task cards for the pre-shift dashboard.", priority: "high", due_date: "2026-08-25", completed: false, subtask_total: 4, subtask_completed: 2 },
  { id: "today-2", title: "Verify the progress update conversation", description: "Confirm receipts and classification for every composer intent.", priority: "medium", due_date: "2026-08-25", completed: false },
  { id: "today-3", title: "Review responsive task states", description: "Rows must stay legible at 390px without horizontal scroll.", priority: "low", due_date: "2026-08-25", completed: true },
];

const previousTasks: TaskRow[] = [
  { id: "previous-1", title: "Reconcile yesterday’s Nifty sync notes", due_date: "2026-08-24", completed: false },
  { id: "previous-2", title: "Close the remaining desktop QA item", due_date: "2026-08-24", completed: false },
];

const otherTasks: TaskRow[] = [
  { id: "older-1", title: "Document the provider retry behavior", due_date: "2026-08-21", completed: false, priority: "medium" },
  { id: "older-2", title: "Resolve the remaining installer follow-up", due_date: "2026-08-19", completed: false, priority: "low" },
];

function PreviewRail({ onShift = true }: { onShift?: boolean }) {
  return <aside className="rail"><div className="wordmark"><img src={wordmark} alt="" /><span>WORK <b>OS</b></span></div><nav aria-label="Work OS"><div className="nav-group nav-core"><button className="active"><LayoutDashboard size={18} /><span>Today</span></button><button><ListChecks size={18} /><span>Tasks</span></button><button><MessageSquareText size={18} /><span>Review</span></button></div><div className="nav-group nav-context"><button><Gauge size={18} /><span>Insights</span></button><button><ShieldCheck size={18} /><span>Evidence</span></button></div><div className="nav-group nav-settings"><button><Settings size={18} /><span>Settings</span></button></div></nav><div className="rail-foot"><span className={`presence ${onShift ? "live" : ""}`} /><div><strong>{onShift ? "On shift" : "Off shift"}</strong><small>Synced</small></div></div></aside>;
}

export default function TodayPreview() {
  const params = new URLSearchParams(window.location.search);
  const previewState = params.get("preview-state");
  const observedOnly = previewState?.startsWith("worktivity-active") === true;
  const conversationPreview = previewState === "conversation";
  const goalPreview = previewState === "goal";
  const [tasks, setTasks] = useState(initialTasks);
  const [goal, setGoal] = useState("Ship a clear, dependable workday experience.");
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(conversationPreview || goalPreview);
  const [panel, setPanel] = useState<"update" | "goal">(goalPreview ? "goal" : "update");
  const [pending, setPending] = useState(conversationPreview ? "I finished the active-day layout and fixed the task transitions." : "");
  const [receipt, setReceipt] = useState<{ text: string; message: string; kind: "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task" } | null>(null);
  if (previewState?.startsWith("pre-shift")) {
    const now = new Date("2026-08-26T12:08:00Z");
    const shift = { startsAt: "2026-08-26T15:00:00Z", endsAt: "2026-08-26T20:00:00Z", timezone: "UTC", breaks: [] };
    const attendance = { source: "worktivity" as const, state: "off_shift" as const, status: "yet_to_start" as const, observedAt: "2026-08-26T12:08:00Z", clockedInAt: null, clockedOutAt: null, stale: false, fallbackAllowed: false, message: "Worktivity reports no active attendance; Work OS attendance remains explicit." };
    const pulse = shiftPulse(null, shift, now, true, attendance);
    const openTasks = initialTasks.filter((task) => !task.completed);
    const topTasks = openTasks.slice(0, 3);
    const submitAgendaUpdate = () => {
      const text = input.trim();
      if (!text) return;
      setPending(text); setReceipt(null); setInput(""); setPanel("update"); setOpen(true);
    };
    return <div className="workspace today-preview"><PreviewRail onShift={false} /><section className="stage"><header className="masthead"><div><p>August 26</p><h1>Today</h1></div><div className="mast-actions"><span className="provider">Nifty source · {tasks.length} open</span><button className="icon" aria-label="Refresh"><RefreshCw size={17} /></button><button className="avatar">DZ</button></div></header><main className="day-grid off-shift-day"><section className="hero-card"><div className="hero-copy"><span className="kicker">Ready when you are</span><h2>Ready to start.</h2><p>Scheduled 3:00 PM–8:00 PM.</p><div className="hero-actions"><button className="primary"><CirclePlay size={17} /> Clock in</button></div><small className="attendance-context">Observed context: Worktivity reports no active attendance; Work OS attendance remains explicit.</small><div className="hero-focus-line"><small>Today’s focus</small><button aria-label="Update today’s focus"><span>{goal || "Your open tasks define today’s work."}</span></button><em>Written by you · tap to update</em></div></div><div className="hero-companion-art"><img className="companion" src={companionArt} alt="Focused desk with a task checklist" /></div></section><ShiftPulseCard pulse={pulse} now={now} shift={shift} active={false} attendance={attendance} initialMenuOpen={previewState === "pre-shift-menu"} initialDetailsOpen={previewState === "pre-shift-worktivity"} /><section className="kpi-strip" aria-label="Today at a glance"><button className="kpi-card"><small><ListChecks size={13} /> Scheduled today</small><strong>{tasks.length}</strong><em>Open the day view</em></button><button className="kpi-card"><small>Due from yesterday</small><strong className="kpi-danger">2</strong><em className="kpi-attention">Review unfinished work</em></button><button className="kpi-card"><small><CheckCircle2 size={13} /> Completed today</small><strong>{tasks.filter((task) => task.completed).length}</strong><em>Review the record</em></button><button className="kpi-card"><small>Reviews pending</small><strong>0</strong><em>Nothing awaiting review</em></button></section><section className="panel dashboard-tasks-card"><div className="card-title"><span><BriefcaseBusiness size={17} /> Today’s tasks</span><button>View all <ChevronRight size={14} /></button></div><div className="dashboard-task-grid">{topTasks.map((task) => <DashboardTaskCard key={String(task.id)} task={task} currentDate="2026-08-26" onOpen={() => undefined} />)}</div></section></main><ProgressComposer mode="agenda" input={input} open={open} panel={panel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="employee" goalSuggestion={null} saveState="saved" onInput={setInput} onOpen={() => { setPanel("update"); setOpen(true); }} onOpenGoal={() => { setPanel("goal"); setOpen(true); }} onClose={() => { setOpen(false); setPending(""); }} onSubmit={submitAgendaUpdate} onClassify={(kind) => { const text = pending; if (kind === "new_task") setTasks((current) => [...current, { id: crypto.randomUUID(), title: text, due_date: "2026-08-26", completed: false }]); setReceipt({ text, kind, message: kind === "new_task" ? `Added “${text}” to today’s Nifty agenda.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onGoal={setGoal} onAcceptSuggestion={() => undefined} /></section></div>;
  }
  return <div className="workspace today-preview">
    <PreviewRail />
    <section className="stage"><header className="masthead"><div><p>2026-08-25</p><h1>Today</h1></div><div className="mast-actions"><span className="provider">Nifty live · {tasks.filter((task) => !task.completed).length} open</span><button className="avatar">DZ</button></div></header>
      <ActiveDayWorkspace focus={goal || "Your open tasks define today’s work."} focusSource="Your focus note" tasks={tasks} previousTasks={previousTasks} otherTasks={otherTasks} elapsed={observedOnly ? "04:46" : "3h 24m"} progressPercent={43} shiftStart="9:00 AM" shiftEnd="5:00 PM" remaining="4h 36m" attendance={{ source: "worktivity", state: "active", status: "working", observedAt: "2026-08-25T13:46:00Z", clockedInAt: "2026-08-25T09:00:00Z", clockedOutAt: null, stale: false, fallbackAllowed: false, message: "Activity observed" }} providerBreakSeconds={0} reviews={0} initialDetailView={previewState === "shift-details" ? "shift" : previewState === "worktivity-details" || previewState === "worktivity-active-details" ? "worktivity" : null} initialDetailsMenuOpen={previewState === "details-menu"} initialTaskMenuId={params.has("task-actions") ? "today-1" : null} paused={false} busy={false} observedOnly={observedOnly} canPause={!observedOnly} canClockOut={!observedOnly} onEditFocus={() => { setPanel("goal"); setOpen(true); }} onAddTask={() => setTasks((current) => [...current, { id: crypto.randomUUID(), title: "New task for today", due_date: "2026-08-25", completed: false }])} onManageTasks={() => undefined} onOpenTask={() => undefined} onToggleTask={(task, completed) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed } : item))} onEditTask={() => undefined} onArchiveTask={() => undefined} onDeleteTask={() => undefined} onPause={() => undefined} onClockOut={() => undefined} />
      <ProgressComposer input={input} open={open} panel={panel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="employee" goalSuggestion={null} saveState="saved" onInput={setInput} onOpen={() => { setPanel("update"); setOpen(true); }} onOpenGoal={() => { setPanel("goal"); setOpen(true); }} onClose={() => { setOpen(false); setPending(""); }} onSubmit={() => { if (!input.trim()) return; setPending(input.trim()); setReceipt(null); setInput(""); setPanel("update"); setOpen(true); }} onClassify={(kind) => { const text = pending; if (kind === "new_task") setTasks((current) => [...current, { id: crypto.randomUUID(), title: text, due_date: "2026-08-25", completed: false }]); setReceipt({ text, kind, message: kind === "new_task" ? `Added “${text}” to today’s tasks and recorded the update.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onGoal={setGoal} onAcceptSuggestion={() => undefined} />
    </section>
  </div>;
}
