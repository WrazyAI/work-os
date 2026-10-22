import { useState } from "react";
import SidebarNav from "./SidebarNav";
import { ProgressComposer, TasksWorkspace } from "./App";
import { TaskComposerModal, TaskDetailsModal, TaskEditModal, TaskRemovalConfirmation, TaskCarryOverFlyout } from "./taskSurfaces";
import { TaskEvidenceDialog, type TaskEvidenceDialogPhase } from "./CompletionEvidence";
import { TaskSelectionCard } from "./TaskSelectionCard";
import type { TaskEvidenceRecord } from "../../../src/modules/work-os/completion-evidence";
import { DEFAULT_TASK_SORT, suggestDailyGoal, unfinishedBefore, type TaskRow, type TaskSort } from "./taskWorkspace";
import type { DailyPlan } from "./types";
import { formatWorkOsDate } from "./dateFormat";
import { TaskDateNavigator } from "./TaskDateNavigator";

const CURRENT_DATE = "2026-08-21";
const DETAIL_SUBTASKS = [
  { id: "sub-1", provider_task_id: "sub-1", title: "Reconcile search behavior with the web dashboard", description: "", completed: true },
  { id: "sub-2", provider_task_id: "sub-2", title: "Fix overdue ordering after midnight", description: "Oldest-due-first must survive a date rollover.", completed: false, due_date: "2026-08-19" },
  { id: "sub-3", provider_task_id: "sub-3", title: "Capture review screenshots", description: "", completed: false, assignees: [{ personId: "person-1", displayName: "Dana Whitfield", email: null }] },
];
const tasks: TaskRow[] = [
  { id: "task-today", title: "Ship unified Tasks workspace", description: "Finish the desktop implementation and validation.", due_date: CURRENT_DATE, provider_created_at: `${CURRENT_DATE}T08:15:00Z`, priority: "high", assignee_person_ids: ["person-1"], synced_at: `${CURRENT_DATE}T09:00:00Z`, completed: false, subtask_total: 4, subtask_completed: 3, project: { name: "Work OS" }, milestone: { name: "August release" } },
  { id: "task-carry", title: "Review provider sync failures", description: "Resolve the remaining delayed Nifty records.", due_date: "2026-08-20", provider_created_at: "2026-08-19T13:00:00Z", priority: "medium", assignee_person_ids: ["person-1", "person-2"], synced_at: `${CURRENT_DATE}T08:55:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-old", title: "Document desktop release evidence", description: "Attach the signed installer verification record.", provider_created_at: "2026-08-18T11:00:00Z", priority: "low", synced_at: `${CURRENT_DATE}T08:50:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-done", title: "Remove Plan navigation", description: "Plan is no longer a user-facing route.", due_date: CURRENT_DATE, provider_created_at: `${CURRENT_DATE}T07:30:00Z`, completed: true, synced_at: `${CURRENT_DATE}T08:45:00Z`, project: { name: "Work OS" } },
  { id: "task-later", title: "Draft the Q3 review outline for the LaunchLoom handoff", description: "Later-dated work stays below today in the My day groups.", due_date: "2026-08-28", provider_created_at: "2026-08-19T14:00:00Z", priority: "medium", synced_at: `${CURRENT_DATE}T08:52:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-done-release", title: "Archive old task normalization", description: "Retain the completed record for history sorting.", completed: true, completed_at: `${CURRENT_DATE}T06:30:00Z`, provider_created_at: `${CURRENT_DATE}T06:00:00Z`, synced_at: `${CURRENT_DATE}T08:40:00Z`, project: { name: "Work OS" } },
];

const PREVIEW_EVIDENCE: TaskEvidenceRecord[] = [
  {
    id: "evidence-preview-1",
    title: "Ship unified Tasks workspace — completion evidence",
    note: "Signed installer check and the release screenshot.",
    fileName: "release-verification.pdf",
    contentType: "application/pdf",
    sizeBytes: 482_112,
    createdAt: `${CURRENT_DATE}T16:42:00Z`,
    url: "/api/work-os/evidence/evidence-preview-1/file",
  },
];

const currentPlan: DailyPlan = {
  id: "plan-current", status: "draft", freeform_intent: "Ship the unified Tasks workspace with truthful history and carryover.", goal_provenance: "accepted_suggestion", suggestion_task_ids: ["task-today", "task-carry"], shift_date: CURRENT_DATE, revision: 3,
  items: [
    { id: "item-today", task_id: "task-today", source: "due_today", disposition: "selected", rank: 0, title_snapshot: "Ship unified Tasks workspace", blocker: null, item_kind: "nifty_task", completion_state: "open" },
    { id: "item-carry-today", task_id: "task-carry", source: "carry_over", disposition: "selected", rank: 1, title_snapshot: "Review provider sync failures", blocker: null, item_kind: "nifty_task", completion_state: "open" },
    { id: "item-old-today", task_id: "task-old", source: "carry_over", disposition: "selected", rank: 2, title_snapshot: "Document desktop release evidence", blocker: null, item_kind: "nifty_task", completion_state: "open" },
    { id: "item-later-today", task_id: "task-later", source: "carry_over", disposition: "selected", rank: 3, title_snapshot: "Draft the Q3 review outline", blocker: null, item_kind: "nifty_task", completion_state: "open" },
  ],
};

const historicalPlan: DailyPlan = {
  id: "plan-history", status: "closed", freeform_intent: "Remove the old Plan route and preserve the task record.", goal_provenance: "employee", suggestion_task_ids: [], shift_date: "2026-08-20", revision: 5,
  items: [
    { id: "item-carry", task_id: "task-carry", source: "due_today", disposition: "selected", rank: 0, title_snapshot: "Review provider sync failures", blocker: null, item_kind: "nifty_task", completion_state: "open" },
    { id: "item-done", task_id: "task-done", source: "carry_over", disposition: "selected", rank: 1, title_snapshot: "Remove Plan navigation", blocker: null, item_kind: "nifty_task", completion_state: "completed" },
  ],
};

/** Development preview for the Tasks workspace, including sorting and lifecycle scenarios. */
export default function TasksPreview() {
  const params = new URLSearchParams(window.location.search);
  const history = params.has("history");
  const scenario = params.get("scenario");
  const detailScenario = scenario === "details" || scenario === "details-readonly" || scenario === "details-interactive";
  const pendingMode = params.get("pending");
  const pendingRows = pendingMode ? [{ id: "pending-1", title: "Draft the onboarding checklist", description: "Optimistic add awaiting Nifty confirmation.", completed: false, due_date: CURRENT_DATE, pending_status: pendingMode, pending_error: pendingMode === "failed" ? "Nifty timed out" : undefined }] : [];
  // A dock-height fixture needs a page that actually scrolls: a short list can
  // never show the composer's growth displacing the tasks, so `?many` fills the
  // day beyond the fold with the same row shapes production renders.
  const many = params.has("many");
  const manyTasks: TaskRow[] = many ? Array.from({ length: 24 }, (_, index) => ({
    id: `task-many-${index}`,
    title: `Reconcile provider record ${index + 1}`,
    description: "Hold the row rhythm steady while the composer grows beneath it.",
    due_date: CURRENT_DATE,
    provider_created_at: `${CURRENT_DATE}T0${index % 9}:${String(index % 60).padStart(2, "0")}:00Z`,
    priority: index % 3 === 0 ? "high" : index % 3 === 1 ? "medium" : "low",
    assignee_person_ids: index % 2 === 0 ? ["person-1"] : ["person-1", "person-2"],
    synced_at: `${CURRENT_DATE}T09:00:00Z`,
    completed: false,
    subtask_total: 3,
    subtask_completed: index % 3,
    project: { name: index % 2 === 0 ? "Work OS" : "LaunchLoom" },
  })) : [];
  const baseTasks = many ? [...tasks, ...manyTasks] : tasks;
  const degraded = scenario === "degraded" ? baseTasks.map((task, index) => index === 1 ? { ...task, sync_error: "nifty_unreachable" } : task) : baseTasks;
  const [carryOpen, setCarryOpen] = useState(params.has("carryover") || scenario === "carryover");
  const [detailsOpen, setDetailsOpen] = useState(detailScenario);
  const [previewDate, setPreviewDate] = useState(history ? "2026-08-20" : CURRENT_DATE);
  const previewHistorical = previewDate !== CURRENT_DATE;
  const [previewSubtasks, setPreviewSubtasks] = useState(() => DETAIL_SUBTASKS.map((subtask) => ({ ...subtask })));
  const [subtaskMenuId, setSubtaskMenuId] = useState<string | null>(scenario === "move-menu" ? "sub-2" : null);
  const [moveMenuId, setMoveMenuId] = useState<string | null>(scenario === "move-menu" ? "sub-2" : null);
  const [previewEditTask, setPreviewEditTask] = useState<Record<string, any> | null>(null);
  const [previewEditTitle, setPreviewEditTitle] = useState("");
  const [previewEditDescription, setPreviewEditDescription] = useState("");
  const [previewRemoval, setPreviewRemoval] = useState<{ task: Record<string, any>; mode: "archive" | "delete" } | null>(null);
  const [goal, setGoal] = useState(currentPlan.freeform_intent ?? "");
  const [input, setInput] = useState("");
  const [composerOpen, setComposerOpen] = useState(params.has("agenda") || params.has("focus"));
  const [composerPanel, setComposerPanel] = useState<"update" | "goal">(params.has("focus") ? "goal" : "update");
  const [pending, setPending] = useState(params.has("agenda") ? "I completed the retry review and found a release blocker." : "");
  const [taskView, setTaskView] = useState<"today" | "unfinished" | "completed" | "all">(() => {
    const requested = params.get("view");
    return requested === "unfinished" || requested === "completed" || requested === "all" ? requested : "today";
  });
  const [taskSort, setTaskSort] = useState<TaskSort>(DEFAULT_TASK_SORT);
  const [previewSearch, setPreviewSearch] = useState(scenario === "filtered-empty" ? "zzz no match" : "");
  const [previewHistoryError, setPreviewHistoryError] = useState(scenario === "history-error");
  const [receipt, setReceipt] = useState<{ text: string; message: string; kind: "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task"; createdAt: string } | null>(null);
  const suggestion = suggestDailyGoal(baseTasks, CURRENT_DATE, currentPlan.items);
  const detailsTask = {
    task: { ...tasks[0], description: "Finish the desktop implementation, validate the workflow end to end, and attach the signed verification record." },
    subtasks: previewSubtasks,
    moveTargets: baseTasks.slice(1, 3),
    subtaskSync: scenario === "degraded" ? { tasks: null, syncedAt: null, error: "nifty_unreachable" } : { tasks: 3, syncedAt: `${CURRENT_DATE}T09:05:00Z`, error: null },
  };
  const openPreviewEdit = (task: Record<string, any>) => {
    setPreviewEditTask(task);
    setPreviewEditTitle(String(task.title ?? ""));
    setPreviewEditDescription(String(task.description ?? ""));
    setSubtaskMenuId(null);
    setMoveMenuId(null);
  };
  const savePreviewEdit = () => {
    if (!previewEditTask || !previewEditTitle.trim()) return;
    const id = String(previewEditTask.provider_task_id || previewEditTask.id);
    setPreviewSubtasks((current) => current.map((task) => String(task.provider_task_id || task.id) === id ? { ...task, title: previewEditTitle.trim(), description: previewEditDescription } : task));
    setPreviewEditTask(null);
  };
  const confirmPreviewRemoval = () => {
    if (!previewRemoval) return;
    const id = String(previewRemoval.task.provider_task_id || previewRemoval.task.id);
    setPreviewSubtasks((current) => current.filter((task) => String(task.provider_task_id || task.id) !== id));
    setPreviewRemoval(null);
  };
  const menuId = scenario === "menu-bottom" ? "task-old" : scenario === "menu-middle" ? "task-carry" : scenario === "menu-top" ? "task-today" : null;
  // The full server backlog: an open task beyond the loaded history window plus
  // exact counts, so the Unfinished view and chips can be exercised end to end.
  // The production Unfinished view always receives a server backlog, so the
  // fixture supplies one for that view unless a test asks for the degraded case.
  const backlog = (params.has("backlog") || many || (params.get("view") === "unfinished" && !params.has("nobacklog"))) ? {
    tasks: [
      ...baseTasks.filter((task) => task.completed !== true),
      { id: "beyond-window", title: "Beyond the loaded window", due_date: "2026-07-01", provider_created_at: "2026-07-01T09:00:00Z", completed: false, project: { name: "LaunchLoom" } },
    ],
    counts: { total: many ? 30 : 12, open: many ? 28 : 4, completed: 8 },
  } : null;
  const selectionScenario = scenario?.startsWith("selection-") ? scenario.slice("selection-".length) : null;
  // The selection card carries a task's open subtasks with it: the first task
  // owns three, so ticking it shows the cascade and the loaded-subtask path.
  const selectionSubtasks = [
    { id: "selection-sub-1", title: "Trim the header", completed: false },
    { id: "selection-sub-2", title: "Move the tabs", completed: false },
    { id: "selection-sub-3", title: "Verify the empty state", completed: true },
  ];
  const selectionTasks = tasks.slice(0, 3).map((task, index) => ({
    id: String(task.id),
    title: String(task.title),
    description: String(task.description),
    dueDate: task.due_date,
    projectName: task.project?.name,
    priority: task.priority,
    state: index === 1 ? "overdue" as const : "pending" as const,
    subtaskTotal: index === 0 ? selectionSubtasks.length : 0,
    subtaskCompleted: index === 0 ? selectionSubtasks.filter((subtask) => subtask.completed).length : 0,
  }));
  const emptyHistoryFixture = scenario === "history-empty" || scenario === "history-loading" || (scenario === "history-error" && !params.has("stale"));
  const previewTaskHistory = emptyHistoryFixture ? [] : degraded;
  const evidenceScenario = scenario?.startsWith("completion") ? scenario : null;
  const evidencePhase: TaskEvidenceDialogPhase = scenario === "completion-uploading" ? "saving"
    : scenario === "completion-failed" ? "failed"
      : scenario === "completion-saved" ? "evidence_saved"
        : scenario === "completion-done" ? "done" : "idle";
  return <div className="workspace preview-workspace">
    <SidebarNav activeView="tasks" onNavigate={() => undefined} onNewChat={() => undefined} initiallyCollapsed={new URLSearchParams(window.location.search).get("sidebar") !== "expanded"} />
    <section className={`stage${previewHistorical ? "" : " has-dock"}`}><header className="masthead"><div><p>{formatWorkOsDate(previewDate)}</p><h1>Tasks</h1></div><div className="mast-actions"><TaskDateNavigator currentDate={CURRENT_DATE} selectedDate={previewDate} onDate={async (date) => setPreviewDate(date)} /><button className="avatar">DZ</button></div></header>
      <TasksWorkspace currentDate={CURRENT_DATE} historyDate={previewDate} backlog={backlog} currentPlan={currentPlan} historicalPlan={previewHistorical ? historicalPlan : null} historicalTasks={previewHistorical ? baseTasks : []} goal={goal} goalProvenance="accepted_suggestion" suggestion={suggestion} saveState="saved" taskView={taskView} taskSort={taskSort} taskSearch={previewSearch} onTaskSearch={setPreviewSearch} todayTasks={[...pendingRows, ...degraded.filter((task) => task.due_date === CURRENT_DATE)]} taskHistory={previewTaskHistory} workspaceHistory={previewTaskHistory} historyOrder="local" historyError={previewHistoryError} historyHasData={params.has("stale")} onRetryHistory={() => setPreviewHistoryError(false)} carryOver={unfinishedBefore(baseTasks, CURRENT_DATE)} carryOverOpen={carryOpen} loadingMore={false} hasMore={false} busy={false} loading={scenario === "history-loading"} initialTaskMenuId={menuId} initialFiltersOpen={params.has("filters")} onTaskView={setTaskView} onTaskSort={setTaskSort} onDate={async (date) => setPreviewDate(date)} onEditFocus={() => { setComposerPanel("goal"); setComposerOpen(true); }} onAddTask={() => undefined} onOpenTask={() => setDetailsOpen(true)} onEditTask={openPreviewEdit} onArchiveTask={(task) => setPreviewRemoval({ task, mode: "archive" })} onDeleteTask={(task) => setPreviewRemoval({ task, mode: "delete" })} onSurfaceTask={() => undefined} onTaskCompletion={() => undefined} onCarryOverOpen={setCarryOpen} onLoadMore={() => undefined} />
      {!previewHistorical && <ProgressComposer mode="agenda" input={input} open={composerOpen} panel={composerPanel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="accepted_suggestion" goalSuggestion={suggestion} saveState="saved" onInput={setInput} onOpen={() => { setComposerPanel("update"); setComposerOpen(true); }} onOpenGoal={() => { setComposerPanel("goal"); setComposerOpen(true); }} onClose={() => { setComposerOpen(false); setPending(""); }} onSubmit={() => { const text = input.trim(); if (!text) return; setPending(text); setReceipt(null); setInput(""); setComposerOpen(true); }} onClassify={(kind) => { const text = pending; setReceipt({ text, kind, createdAt: new Date().toISOString(), message: kind === "new_task" ? `Added “${text}” to today’s Nifty agenda.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onApplyGoal={setGoal} />}
      {detailsOpen && <TaskDetailsModal details={detailsTask} loading={false} readOnly={scenario === "details-readonly"} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={subtaskMenuId} moveMenuId={moveMenuId} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={setSubtaskMenuId} onMoveMenu={setMoveMenuId} onSubtaskCreate={() => undefined} onEditTask={openPreviewEdit} onCompleteTask={() => undefined} completionEvidence={PREVIEW_EVIDENCE} onAttachEvidence={() => undefined} onDownloadEvidence={() => undefined} onMoveSubtask={(subtask) => { setSubtaskMenuId(null); setMoveMenuId(null); setPreviewSubtasks((current) => current.filter((row) => String(row.provider_task_id || row.id) !== String(subtask.provider_task_id || subtask.id))); }} onToggleSubtask={(subtask) => setPreviewSubtasks((current) => current.map((row) => String(row.provider_task_id || row.id) === String(subtask.provider_task_id || subtask.id) ? { ...row, completed: !row.completed } : row))} onArchiveSubtask={(subtask) => setPreviewRemoval({ task: subtask, mode: "archive" })} onDeleteSubtask={(subtask) => setPreviewRemoval({ task: subtask, mode: "delete" })} onClose={() => setDetailsOpen(false)} />}
      {scenario === "details-loading" && <TaskDetailsModal details={{ task: tasks[0] as unknown as Record<string, unknown>, subtasks: [], moveTargets: [], subtaskSync: undefined }} loading={true} readOnly={false} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={null} moveMenuId={null} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={() => undefined} onMoveMenu={() => undefined} onSubtaskCreate={() => undefined} onEditTask={() => undefined} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
      {scenario === "create" && <TaskComposerModal busy={false} title="" description="" assignees={["person-1"]} options={[{ id: "person-1", displayName: "Dana Whitfield", email: "dana@example.com" }, { id: "person-2", displayName: "Alex Rivera", email: null }]} optionsLoading={false} onTitle={() => undefined} onDescription={() => undefined} onToggleAssignee={() => undefined} onClose={() => undefined} onSubmit={() => undefined} />}
      {scenario === "edit" && <TaskEditModal kind="task" title="Ship unified Tasks workspace" description="Finish the desktop implementation and validation." busy={false} onTitle={() => undefined} onDescription={() => undefined} onClose={() => undefined} onSubmit={() => undefined} />}
      {scenario === "confirm-archive" && <TaskRemovalConfirmation mode="archive" scope="task" title="Ship unified Tasks workspace" subtaskCount={3} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />}
      {scenario === "confirm-delete" && <TaskRemovalConfirmation mode="delete" scope="task" title="Ship unified Tasks workspace" subtaskCount={3} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />}
      {scenario === "move-menu" && <TaskDetailsModal details={detailsTask} loading={false} readOnly={false} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={subtaskMenuId} moveMenuId={moveMenuId} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={setSubtaskMenuId} onMoveMenu={setMoveMenuId} onSubtaskCreate={() => undefined} onEditTask={openPreviewEdit} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
      {previewEditTask && <TaskEditModal kind="subtask" title={previewEditTitle} description={previewEditDescription} busy={false} onTitle={setPreviewEditTitle} onDescription={setPreviewEditDescription} onClose={() => setPreviewEditTask(null)} onSubmit={savePreviewEdit} />}
      {previewRemoval && <TaskRemovalConfirmation mode={previewRemoval.mode} scope="subtask" title={String(previewRemoval.task.title ?? "Untitled subtask")} subtaskCount={0} busy={false} onCancel={() => setPreviewRemoval(null)} onConfirm={confirmPreviewRemoval} />}
      {selectionScenario && <TaskSelectionCard title="Finish pending work" tasks={selectionScenario === "empty" || selectionScenario === "error" ? [] : selectionTasks} status={selectionScenario === "loading" ? "loading" : selectionScenario === "error" ? "error" : "ready"} degraded={selectionScenario === "degraded"} dense={selectionScenario === "dense"} errorMessage="Nifty could not refresh this task list." onRetry={() => undefined} onMarkSelectedDone={() => undefined} onLoadSubtasks={async (taskId) => (taskId === selectionTasks[0]?.id ? selectionSubtasks : [])} />}
      {evidenceScenario && <TaskEvidenceDialog
        task={scenario === "completion-required" ? { ...tasks[0], expected_outcome: "A signed verification record for the desktop release." } : tasks[0]}
        mode={scenario === "completion-attach" ? "attach" : "complete"}
        initialPhase={evidencePhase}
        initialError={scenario === "completion-failed" ? "The connection dropped before the file was saved." : scenario === "completion-saved" ? "Evidence saved. The task is not marked complete yet." : null}
        initialFileName={scenario === "completion-uploading" || scenario === "completion-failed" ? "release-verification.pdf" : ""}
        initialEvidence={scenario === "completion-saved" || scenario === "completion-done" ? PREVIEW_EVIDENCE[0] : null}
        onAttach={async (_file, _note, _key) => ({ outcome: "completed", evidence: PREVIEW_EVIDENCE[0] })}
        onRetryCompletion={async () => ({ completed: false, error: "Still waiting for the server. Try again." })}
        onCompleteWithoutEvidence={async () => ({ completed: true })}
        onClose={() => undefined}
      />}
    </section>
  </div>;
}
