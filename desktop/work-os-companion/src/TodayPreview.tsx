import { useState } from "react";
import { Gauge, LayoutDashboard, ListChecks, MessageSquareText, Settings, ShieldCheck } from "lucide-react";
import { ActiveDayWorkspace, ProgressComposer } from "./App";
import type { TaskRow } from "./taskWorkspace";
import wordmark from "./assets/work-os-mark.png";

const initialTasks: TaskRow[] = [
  { id: "today-1", title: "Finalize the active workday experience", priority: "high", due_date: "2026-08-25", completed: false },
  { id: "today-2", title: "Verify the progress update conversation", priority: "medium", due_date: "2026-08-25", completed: false },
  { id: "today-3", title: "Review responsive task states", priority: "low", due_date: "2026-08-25", completed: true },
];

const previousTasks: TaskRow[] = [
  { id: "previous-1", title: "Reconcile yesterday’s Nifty sync notes", due_date: "2026-08-24", completed: false },
  { id: "previous-2", title: "Close the remaining desktop QA item", due_date: "2026-08-24", completed: false },
];

const otherTasks: TaskRow[] = [
  { id: "older-1", title: "Document the provider retry behavior", due_date: "2026-08-21", completed: false, priority: "medium" },
  { id: "older-2", title: "Resolve the remaining installer follow-up", due_date: "2026-08-19", completed: false, priority: "low" },
];

export default function TodayPreview() {
  const previewState = new URLSearchParams(window.location.search).get("preview-state");
  const conversationPreview = previewState === "conversation";
  const goalPreview = previewState === "goal";
  const [tasks, setTasks] = useState(initialTasks);
  const [goal, setGoal] = useState("Ship a clear, dependable workday experience.");
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(conversationPreview || goalPreview);
  const [panel, setPanel] = useState<"update" | "goal">(goalPreview ? "goal" : "update");
  const [pending, setPending] = useState(conversationPreview ? "I finished the active-day layout and fixed the task transitions." : "");
  const [receipt, setReceipt] = useState<{ text: string; message: string; kind: "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task" } | null>(null);
  return <div className="workspace today-preview">
    <aside className="rail"><div className="wordmark"><img src={wordmark} alt="" /><span>WORK <b>OS</b></span></div><nav><button className="active"><LayoutDashboard size={18} /><span>Today</span></button><button><ListChecks size={18} /><span>Tasks</span></button><button><MessageSquareText size={18} /><span>Review</span></button><button><Gauge size={18} /><span>Insights</span></button><button><ShieldCheck size={18} /><span>Evidence</span></button><button><Settings size={18} /><span>Settings</span></button></nav><div className="rail-foot"><span className="presence live" /><div><strong>On shift</strong><small>Synced</small></div></div></aside>
    <section className="stage"><header className="masthead"><div><p>2026-08-25</p><h1>Today</h1></div><div className="mast-actions"><span className="provider">Nifty live · {tasks.filter((task) => !task.completed).length} open</span><button className="avatar">DZ</button></div></header>
      <ActiveDayWorkspace focus={goal || "Your open tasks define today’s work."} focusSource="Your focus note" tasks={tasks} previousTasks={previousTasks} otherTasks={otherTasks} elapsed="3h 24m" progressPercent={43} nextPrompt="2:15 PM" shiftStart="9:00 AM" shiftEnd="5:00 PM" remaining="4h 36m" attendance={{ source: "worktivity", state: "active", status: "working", observedAt: "2026-08-25T13:46:00Z", clockedInAt: "2026-08-25T09:00:00Z", clockedOutAt: null, stale: false, fallbackAllowed: false, message: "Activity observed" }} providerBreakSeconds={0} reviews={0} initialDetailView={previewState === "shift-details" ? "shift" : previewState === "worktivity-details" ? "worktivity" : null} initialDetailsMenuOpen={previewState === "details-menu"} paused={false} busy={false} canPause onEditFocus={() => { setPanel("goal"); setOpen(true); }} onAddTask={() => setTasks((current) => [...current, { id: crypto.randomUUID(), title: "New task for today", due_date: "2026-08-25", completed: false }])} onManageTasks={() => undefined} onOpenTask={() => undefined} onToggleTask={(task, completed) => setTasks((current) => current.map((item) => item.id === task.id ? { ...item, completed } : item))} onPause={() => undefined} onClockOut={() => undefined} />
      <ProgressComposer input={input} open={open} panel={panel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="employee" goalSuggestion={null} saveState="saved" onInput={setInput} onOpen={() => { setPanel("update"); setOpen(true); }} onOpenGoal={() => { setPanel("goal"); setOpen(true); }} onClose={() => { setOpen(false); setPending(""); }} onSubmit={() => { if (!input.trim()) return; setPending(input.trim()); setReceipt(null); setInput(""); setPanel("update"); setOpen(true); }} onClassify={(kind) => { const text = pending; if (kind === "new_task") setTasks((current) => [...current, { id: crypto.randomUUID(), title: text, due_date: "2026-08-25", completed: false }]); setReceipt({ text, kind, message: kind === "new_task" ? `Added “${text}” to today’s tasks and recorded the update.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onGoal={setGoal} onAcceptSuggestion={() => undefined} />
    </section>
  </div>;
}
