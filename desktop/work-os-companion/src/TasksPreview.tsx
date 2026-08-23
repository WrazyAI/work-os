import { useState } from "react";
import { LayoutDashboard, ListChecks, MessageSquareText, Gauge, ShieldCheck, Settings } from "lucide-react";
import { TasksWorkspace } from "./App";
import { suggestDailyGoal, unfinishedBefore, type TaskRow } from "./taskWorkspace";
import type { DailyPlan } from "./types";

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
  const [carryOpen, setCarryOpen] = useState(params.has("carryover"));
  const [goal, setGoal] = useState(currentPlan.freeform_intent ?? "");
  const suggestion = suggestDailyGoal(tasks, CURRENT_DATE, currentPlan.items);
  return <div className="workspace preview-workspace">
    <aside className="rail"><div className="wordmark"><span>WORK <b>OS</b></span></div><nav>{[[LayoutDashboard, "My day"], [ListChecks, "Tasks"], [MessageSquareText, "Review"], [Gauge, "Insights"], [ShieldCheck, "Evidence"], [Settings, "Settings"]].map(([Icon, label]) => <button className={label === "Tasks" ? "active" : ""} key={String(label)}><Icon size={18} /><span>{String(label)}</span></button>)}</nav><div className="rail-foot"><span className="presence live" /><div><strong>On shift</strong><small>Synced</small></div></div></aside>
    <section className="stage"><header className="masthead"><div><p>{history ? "2026-08-20" : CURRENT_DATE}</p><h1>Tasks</h1></div><div className="mast-actions"><span className="provider">Nifty live · 3 open</span><button className="avatar">DZ</button></div></header>
      <TasksWorkspace currentDate={CURRENT_DATE} historyDate={history ? "2026-08-20" : CURRENT_DATE} currentPlan={currentPlan} historicalPlan={history ? historicalPlan : null} historicalTasks={history ? tasks : []} goal={goal} goalProvenance="accepted_suggestion" suggestion={suggestion} saveState="saved" taskView="today" todayTasks={tasks.filter((task) => task.due_date === CURRENT_DATE)} taskHistory={tasks} carryOver={unfinishedBefore(tasks, CURRENT_DATE)} carryOverOpen={carryOpen} loadingMore={false} hasMore={false} busy={false} taskStatus="" onTaskView={() => undefined} onDate={async () => undefined} onGoal={setGoal} onAcceptSuggestion={() => suggestion && setGoal(suggestion.text)} onAddTask={() => undefined} onOpenTask={() => undefined} onEditTask={() => undefined} onArchiveTask={() => undefined} onSurfaceTask={() => undefined} onTaskCompletion={() => undefined} onCarryOverOpen={setCarryOpen} onLoadMore={() => undefined} />
    </section>
  </div>;
}
