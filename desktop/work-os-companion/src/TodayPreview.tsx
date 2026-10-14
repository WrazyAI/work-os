import { isMacOS } from "./platform";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { ProgressComposer } from "./App";
import { ActiveWorkdayDashboard, OffShiftDashboard } from "./DashboardSurface";
import { buildWorkdayDashboardModel } from "./dashboardModel";
import { WorktivityControlNotice, type WorktivityControlNoticeState } from "./WorktivityControlNotice";
import { shiftPulse } from "./shiftPulse";
import type { TaskRow } from "./taskWorkspace";
import SidebarNav from "./SidebarNav";

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
  const expanded = new URLSearchParams(window.location.search).get("sidebar") === "expanded";
  return <SidebarNav activeView="day" onNavigate={() => undefined} onNewChat={() => undefined} initiallyCollapsed={!expanded} />;
}

export default function TodayPreview() {
  const params = new URLSearchParams(window.location.search);
  const previewState = params.get("preview-state");
  const attendanceControlsSupported = params.get("platform") !== "macos" && !isMacOS();
  const observedOnly = previewState?.startsWith("worktivity-active") === true;
  const conversationPreview = previewState === "conversation";
  const goalPreview = previewState === "goal";
  const [tasks, setTasks] = useState(initialTasks);
  const pendingMode = params.get("pending");
  const pendingRows: TaskRow[] = pendingMode ? [{ id: "pending-dash", title: "Draft the onboarding checklist", description: "Optimistic add awaiting Nifty confirmation.", completed: false, due_date: "2026-08-25", pending_status: pendingMode, pending_error: pendingMode === "failed" ? "Nifty timed out" : undefined }] : [];
  const worktivityControlMode = params.get("worktivity-control");
  const watchMode = params.get("watch") === "clock-out" ? "clock-out" as const : params.get("watch") === "clock-in" ? "clock-in" as const : null;
  const [worktivityControlPreview, setWorktivityControlPreview] = useState<WorktivityControlNoticeState | null>(() =>
    worktivityControlMode === "pending"
      ? { status: "pending", message: "Worktivity has not confirmed the change yet. This preview has not contacted a provider account." }
      : worktivityControlMode === "starting"
        ? { status: "starting", phase: "desktop" }
        : null,
  );
  const worktivityControlBusy = worktivityControlPreview !== null;
  const checkWorktivityPreviewStatus = () => setWorktivityControlPreview({
    status: "pending",
    message: "Preview only: a read-only Worktivity status check was requested. No provider account was contacted.",
  });
  const worktivityControlNotice = worktivityControlPreview
    ? <WorktivityControlNotice state={worktivityControlPreview} onCheckStatus={checkWorktivityPreviewStatus} />
    : null;
  const [goal, setGoal] = useState("Ship a clear, dependable workday experience.");
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(conversationPreview || goalPreview);
  const [panel, setPanel] = useState<"update" | "goal">(goalPreview ? "goal" : "update");
  const [pending, setPending] = useState(conversationPreview ? "I finished the active-day layout and fixed the task transitions." : "");
  const [receipt, setReceipt] = useState<{ text: string; message: string; kind: "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task"; createdAt: string } | null>(null);
  if (previewState?.startsWith("pre-shift")) {
    const now = new Date("2026-08-26T12:08:00Z");
    const shift = { startsAt: "2026-08-26T15:00:00Z", endsAt: "2026-08-26T20:00:00Z", timezone: "UTC", breaks: [] };
    const attendance = { source: "worktivity" as const, state: "off_shift" as const, status: "yet_to_start" as const, observedAt: "2026-08-26T12:08:00Z", clockedInAt: null, clockedOutAt: null, stale: false, fallbackAllowed: false, message: "Worktivity reports no active attendance; Work OS attendance remains explicit." };
    const pulse = shiftPulse(null, shift, now, true, attendance);
    const previewTasks = [...pendingRows, ...tasks];
    const model = buildWorkdayDashboardModel({ active: false, paused: false, currentDate: "2026-08-26", shift, attendance, activityWatch: watchMode, pulse, tasks: previewTasks, carryover: previousTasks, focus: goal, focusSource: "Written by you", niftySync: { fresh: true, syncedAt: "2026-08-26T12:06:00Z" } }, now.getTime());
    const submitAgendaUpdate = () => {
      const text = input.trim();
      if (!text) return;
      setPending(text); setReceipt(null); setInput(""); setPanel("update"); setOpen(true);
    };
    return <div className="workspace today-preview"><PreviewRail onShift={false} /><section className="stage"><header className="masthead"><div><p>August 26</p><h1>Today</h1></div><div className="mast-actions"><button className="icon" aria-label="Refresh"><RefreshCw size={17} /></button><button className="avatar">DZ</button></div></header>{worktivityControlNotice}<OffShiftDashboard attendanceControlsSupported={attendanceControlsSupported} model={model} tasks={previewTasks} currentDate="2026-08-26" busy={worktivityControlBusy} canClockIn={!worktivityControlBusy} onClockIn={() => setWorktivityControlPreview({ status: "starting", phase: "desktop" })} onOpenTasks={() => undefined} onOpenCarryover={() => undefined} onOpenFocus={() => { setPanel("goal"); setOpen(true); }} onOpenTask={() => undefined} onToggleTask={(task, completed) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed } : item))} onRetryPendingTask={() => undefined} onDismissPendingTask={() => undefined} /><ProgressComposer mode="agenda" input={input} open={open} panel={panel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="employee" goalSuggestion={null} saveState="saved" onInput={setInput} onOpen={() => { setPanel("update"); setOpen(true); }} onOpenGoal={() => { setPanel("goal"); setOpen(true); }} onClose={() => { setOpen(false); setPending(""); }} onSubmit={submitAgendaUpdate} onClassify={(kind) => { const text = pending; if (kind === "new_task") setTasks((current) => [...current, { id: crypto.randomUUID(), title: text, due_date: "2026-08-26", completed: false }]); setReceipt({ text, kind, createdAt: new Date().toISOString(), message: kind === "new_task" ? `Added “${text}” to today’s Nifty agenda.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onApplyGoal={setGoal} /></section></div>;
  }
  const activeNow = new Date("2026-08-25T13:46:00Z");
  const activeShift = { startsAt: "2026-08-25T09:00:00Z", endsAt: "2026-08-25T17:00:00Z", timezone: "UTC", breaks: [] };
  const activeAttendance = { source: "worktivity" as const, state: "active" as const, status: "working" as const, observedAt: "2026-08-25T13:46:00Z", clockedInAt: "2026-08-25T09:00:00Z", clockedOutAt: null, stale: false, fallbackAllowed: false, message: "Activity observed" };
  const activeSession = { id: "preview-session", state: "active" as const, scheduled_starts_at: activeShift.startsAt, scheduled_ends_at: activeShift.endsAt, clocked_in_at: activeShift.startsAt, clocked_out_at: null, paused_seconds: 0 };
  const activePulse = shiftPulse(activeSession, activeShift, activeNow, false, activeAttendance);
  const activeTasks = [...pendingRows, ...tasks];
  const activeModel = buildWorkdayDashboardModel({ active: true, paused: false, observedOnly, currentDate: "2026-08-25", shift: activeShift, attendance: activeAttendance, activityWatch: watchMode, pulse: activePulse, tasks: activeTasks, carryover: [...previousTasks, ...otherTasks], focus: goal, focusSource: "Your focus note", niftySync: { fresh: true, syncedAt: "2026-08-25T13:42:00Z" } }, activeNow.getTime());
  return <div className="workspace today-preview">
    <PreviewRail />
    <section className="stage"><header className="masthead"><div><p>2026-08-25</p><h1>Today</h1></div><div className="mast-actions"><button className="avatar">DZ</button></div></header>
      {worktivityControlNotice}
      <ActiveWorkdayDashboard attendanceControlsSupported={attendanceControlsSupported} model={activeModel} tasks={activeTasks} previousTasks={previousTasks} otherTasks={otherTasks} currentDate="2026-08-25" busy={worktivityControlBusy} canPause={!observedOnly} canClockOut={!observedOnly} observedOnly={observedOnly} onOpenTasks={() => undefined} onOpenCarryover={() => undefined} onOpenFocus={() => { setPanel("goal"); setOpen(true); }} onOpenTask={() => undefined} onToggleTask={(task, completed) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed } : item))} onPause={() => setWorktivityControlPreview({ status: "starting", phase: "desktop" })} onClockOut={() => setWorktivityControlPreview({ status: "starting", phase: "desktop" })} onAddTask={() => setTasks((current) => [...current, { id: crypto.randomUUID(), title: "New task for today", due_date: "2026-08-25", completed: false }])} onRetryPendingTask={() => undefined} onDismissPendingTask={() => undefined} />
      <ProgressComposer input={input} open={open} panel={panel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="employee" goalSuggestion={null} saveState="saved" onInput={setInput} onOpen={() => { setPanel("update"); setOpen(true); }} onOpenGoal={() => { setPanel("goal"); setOpen(true); }} onClose={() => { setOpen(false); setPending(""); }} onSubmit={() => { if (!input.trim()) return; setPending(input.trim()); setReceipt(null); setInput(""); setPanel("update"); setOpen(true); }} onClassify={(kind) => { const text = pending; if (kind === "new_task") setTasks((current) => [...current, { id: crypto.randomUUID(), title: text, due_date: "2026-08-25", completed: false }]); setReceipt({ text, kind, createdAt: new Date().toISOString(), message: kind === "new_task" ? `Added “${text}” to today’s tasks and recorded the update.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onApplyGoal={setGoal} />
    </section>
  </div>;
}
