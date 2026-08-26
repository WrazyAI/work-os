import { useState } from "react";
import { LayoutDashboard, ListChecks, MessageSquareText, Gauge, ShieldCheck, Settings } from "lucide-react";
import { ProgressComposer, TasksWorkspace } from "./App";
import { TaskComposerModal, TaskDetailsModal, TaskEditModal, TaskRemovalConfirmation, TaskCarryOverFlyout } from "./taskSurfaces";
import { suggestDailyGoal, unfinishedBefore, type TaskRow } from "./taskWorkspace";
import type { DailyPlan } from "./types";
import { formatWorkOsDate } from "./dateFormat";
import wordmark from "./assets/work-os-mark.png";

const CURRENT_DATE = "2026-08-21";
const tasks: TaskRow[] = [
  { id: "task-today", title: "Ship unified Tasks workspace", description: "Finish the desktop implementation and validation.", due_date: CURRENT_DATE, provider_created_at: `${CURRENT_DATE}T08:15:00Z`, priority: "high", assignee_person_ids: ["person-1"], synced_at: `${CURRENT_DATE}T09:00:00Z`, completed: false, subtask_total: 4, subtask_completed: 3, project: { name: "Work OS" }, milestone: { name: "August release" } },
  { id: "task-carry", title: "Review provider sync failures", description: "Resolve the remaining delayed Nifty records.", due_date: "2026-08-20", provider_created_at: "2026-08-19T13:00:00Z", priority: "medium", assignee_person_ids: ["person-1", "person-2"], synced_at: `${CURRENT_DATE}T08:55:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-old", title: "Document desktop release evidence", description: "Attach the signed installer verification record.", provider_created_at: "2026-08-18T11:00:00Z", priority: "low", synced_at: `${CURRENT_DATE}T08:50:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-done", title: "Remove Plan navigation", description: "Plan is no longer a user-facing route.", due_date: CURRENT_DATE, provider_created_at: `${CURRENT_DATE}T07:30:00Z`, completed: true, synced_at: `${CURRENT_DATE}T08:45:00Z`, project: { name: "Work OS" } },
];

const currentPlan: DailyPlan = {
  id: "plan-current", status: "draft", freeform_intent: "Ship the unified Tasks workspace with truthful history and carryover.", goal_provenance: "accepted_suggestion", suggestion_task_ids: ["task-today", "task-carry"], shift_date: CURRENT_DATE, revision: 3,
  items: [{ id: "item-today", task_id: "task-today", source: "due_today", disposition: "selected", rank: 0, title_snapshot: "Ship unified Tasks workspace", blocker: null, item_kind: "nifty_task", completion_state: "open" }],
};

const historicalPlan: DailyPlan = {
  id: "plan-history", status: "closed", freeform_intent: "Remove the old Plan route and preserve the task record.", goal_provenance: "employee", suggestion_task_ids: [], shift_date: "2026-08-20", revision: 5,
  items: [{ id: "item-carry", task_id: "task-carry", source: "due_today", disposition: "selected", rank: 0, title_snapshot: "Review provider sync failures", blocker: null, item_kind: "nifty_task", completion_state: "open" }],
};

export default function TasksPreview() {
  const params = new URLSearchParams(window.location.search);
  const history = params.has("history");
  const scenario = params.get("scenario");
  const degraded = scenario === "degraded" ? tasks.map((task, index) => index === 1 ? { ...task, sync_error: "nifty_unreachable" } : task) : tasks;
  const [carryOpen, setCarryOpen] = useState(params.has("carryover") || scenario === "carryover");
  const [goal, setGoal] = useState(currentPlan.freeform_intent ?? "");
  const [input, setInput] = useState("");
  const [composerOpen, setComposerOpen] = useState(params.has("agenda") || params.has("focus"));
  const [composerPanel, setComposerPanel] = useState<"update" | "goal">(params.has("focus") ? "goal" : "update");
  const [pending, setPending] = useState(params.has("agenda") ? "I completed the retry review and found a release blocker." : "");
  const [taskView, setTaskView] = useState<"today" | "unfinished" | "completed" | "all">("today");
  const [receipt, setReceipt] = useState<{ text: string; message: string; kind: "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task" } | null>(null);
  const suggestion = suggestDailyGoal(tasks, CURRENT_DATE, currentPlan.items);
  const detailsTask = {
    task: { ...tasks[0], description: "Finish the desktop implementation, validate the workflow end to end, and attach the signed verification record." },
    subtasks: [
      { id: "sub-1", provider_task_id: "sub-1", title: "Reconcile search behavior with the web dashboard", description: "", completed: true },
      { id: "sub-2", provider_task_id: "sub-2", title: "Fix overdue ordering after midnight", description: "Oldest-due-first must survive a date rollover.", completed: false, due_date: "2026-08-19" },
      { id: "sub-3", provider_task_id: "sub-3", title: "Capture review screenshots", description: "", completed: false, assignees: [{ personId: "person-1", displayName: "David Zahemen", email: null }] },
    ],
    moveTargets: tasks.slice(1, 3),
    subtaskSync: scenario === "degraded" ? { tasks: null, syncedAt: null, error: "nifty_unreachable" } : { tasks: 3, syncedAt: `${CURRENT_DATE}T09:05:00Z`, error: null },
  };
  const menuId = scenario === "menu-bottom" ? "task-old" : scenario === "menu-middle" ? "task-carry" : scenario === "menu-top" ? "task-today" : null;
  return <div className="workspace preview-workspace">
    <aside className="rail"><div className="wordmark"><img src={wordmark} alt="" /><span>WORK <b>OS</b></span></div><nav aria-label="Work OS"><div className="nav-group nav-core">{[[LayoutDashboard, "My day"], [ListChecks, "Tasks"], [MessageSquareText, "Review"]].map(([Icon, label]) => <button className={label === "Tasks" ? "active" : ""} key={String(label)}><Icon size={18} /><span>{String(label)}</span></button>)}</div><div className="nav-group nav-context">{[[Gauge, "Insights"], [ShieldCheck, "Evidence"]].map(([Icon, label]) => <button className={label === "Evidence" ? "nav-evidence" : ""} key={String(label)}><Icon size={18} /><span>{String(label)}</span></button>)}</div><div className="nav-group nav-settings"><button><Settings size={18} /><span>Settings</span></button></div></nav><div className="rail-foot"><span className="presence live" /><div><strong>On shift</strong><small>Synced</small></div></div></aside>
    <section className="stage"><header className="masthead"><div><p>{formatWorkOsDate(history ? "2026-08-20" : CURRENT_DATE)}</p><h1>Tasks</h1></div><div className="mast-actions"><span className="provider">Nifty live · 3 open</span><button className="avatar">DZ</button></div></header>
      <TasksWorkspace currentDate={CURRENT_DATE} historyDate={history ? "2026-08-20" : CURRENT_DATE} currentPlan={currentPlan} historicalPlan={history ? historicalPlan : null} historicalTasks={history ? tasks : []} goal={goal} goalProvenance="accepted_suggestion" suggestion={suggestion} saveState="saved" taskView={taskView} todayTasks={degraded.filter((task) => task.due_date === CURRENT_DATE)} taskHistory={degraded} carryOver={unfinishedBefore(tasks, CURRENT_DATE)} carryOverOpen={carryOpen} loadingMore={false} hasMore={false} busy={false} initialTaskMenuId={menuId} initialSearch={scenario === "filtered-empty" ? "zzz no match" : ""} onTaskView={setTaskView} onDate={async () => undefined} onEditFocus={() => { setComposerPanel("goal"); setComposerOpen(true); }} onAddTask={() => undefined} onOpenTask={() => undefined} onEditTask={() => undefined} onArchiveTask={() => undefined} onDeleteTask={() => undefined} onSurfaceTask={() => undefined} onTaskCompletion={() => undefined} onCarryOverOpen={setCarryOpen} onLoadMore={() => undefined} />
      {!history && <ProgressComposer mode="agenda" input={input} open={composerOpen} panel={composerPanel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="accepted_suggestion" goalSuggestion={suggestion} saveState="saved" onInput={setInput} onOpen={() => { setComposerPanel("update"); setComposerOpen(true); }} onOpenGoal={() => { setComposerPanel("goal"); setComposerOpen(true); }} onClose={() => { setComposerOpen(false); setPending(""); }} onSubmit={() => { const text = input.trim(); if (!text) return; setPending(text); setReceipt(null); setInput(""); setComposerOpen(true); }} onClassify={(kind) => { const text = pending; setReceipt({ text, kind, message: kind === "new_task" ? `Added “${text}” to today’s Nifty agenda.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onGoal={setGoal} onAcceptSuggestion={() => suggestion && setGoal(suggestion.text)} />}
      {scenario === "details" && <TaskDetailsModal details={detailsTask} loading={false} readOnly={false} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={null} moveMenuId={null} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={() => undefined} onMoveMenu={() => undefined} onSubtaskCreate={() => undefined} onEditTask={() => undefined} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
      {scenario === "details-readonly" && <TaskDetailsModal details={detailsTask} loading={false} readOnly={true} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={null} moveMenuId={null} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={() => undefined} onMoveMenu={() => undefined} onSubtaskCreate={() => undefined} onEditTask={() => undefined} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
      {scenario === "details-loading" && <TaskDetailsModal details={{ task: tasks[0] as unknown as Record<string, unknown>, subtasks: [], moveTargets: [], subtaskSync: undefined }} loading={true} readOnly={false} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={null} moveMenuId={null} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={() => undefined} onMoveMenu={() => undefined} onSubtaskCreate={() => undefined} onEditTask={() => undefined} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
      {scenario === "create" && <TaskComposerModal busy={false} title="" description="" assignees={["person-1"]} options={[{ id: "person-1", displayName: "David Zahemen", email: "david@wrazyos.com" }, { id: "person-2", displayName: "Alex Rivera", email: null }]} optionsLoading={false} onTitle={() => undefined} onDescription={() => undefined} onToggleAssignee={() => undefined} onClose={() => undefined} onSubmit={() => undefined} />}
      {scenario === "edit" && <TaskEditModal kind="task" title="Ship unified Tasks workspace" description="Finish the desktop implementation and validation." busy={false} onTitle={() => undefined} onDescription={() => undefined} onClose={() => undefined} onSubmit={() => undefined} />}
      {scenario === "confirm-archive" && <TaskRemovalConfirmation mode="archive" scope="task" title="Ship unified Tasks workspace" subtaskCount={3} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />}
      {scenario === "confirm-delete" && <TaskRemovalConfirmation mode="delete" scope="task" title="Ship unified Tasks workspace" subtaskCount={3} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />}
      {scenario === "move-menu" && <TaskDetailsModal details={detailsTask} loading={false} readOnly={false} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId="sub-2" moveMenuId="sub-2" onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={() => undefined} onMoveMenu={() => undefined} onSubtaskCreate={() => undefined} onEditTask={() => undefined} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
    </section>
  </div>;
}
