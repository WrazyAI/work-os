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
  { id: "task-carry", title: "Review provider sync failures", description: "Resolve the remaining delayed task records.", due_date: "2026-08-20", provider_created_at: "2026-08-19T13:00:00Z", priority: "medium", assignee_person_ids: ["person-1", "person-2"], synced_at: `${CURRENT_DATE}T08:55:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-old", title: "Document desktop release evidence", description: "Attach the signed installer verification record.", provider_created_at: "2026-08-18T11:00:00Z", priority: "low", synced_at: `${CURRENT_DATE}T08:50:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-done", title: "Remove Plan navigation", description: "Plan is no longer a user-facing route.", due_date: CURRENT_DATE, provider_created_at: `${CURRENT_DATE}T07:30:00Z`, completed: true, synced_at: `${CURRENT_DATE}T08:45:00Z`, project: { name: "Work OS" } },
  { id: "task-later", title: "Draft the Q3 review outline for the LaunchLoom handoff", description: "Later-dated work stays below today in the My day groups.", due_date: "2026-08-28", provider_created_at: "2026-08-19T14:00:00Z", priority: "medium", synced_at: `${CURRENT_DATE}T08:52:00Z`, completed: false, project: { name: "Work OS" } },
  { id: "task-done-release", title: "Archive old task normalization", description: "Retain the completed record for history sorting.", completed: true, completed_at: `${CURRENT_DATE}T06:30:00Z`, provider_created_at: `${CURRENT_DATE}T06:00:00Z`, synced_at: `${CURRENT_DATE}T08:40:00Z`, project: { name: "Work OS" } },
];

const PREVIEW_MARKDOWN = `# Release verification

- Signed installer verified
- App launched from the built package
- Task flow checked end to end

**Note:** This is employee-attached completion evidence, not a provider confirmation.
`;
const previewTextUrl = (type: string, value: string) => `data:${type};charset=utf-8,${encodeURIComponent(value)}`;

/** DEV fixture files. Data URLs let the token-free preview exercise the same
 * authenticated blob path without a live workspace; production records always
 * use the person-scoped read route. */
const PREVIEW_EVIDENCE: TaskEvidenceRecord[] = [
  {
    id: "evidence-preview-image",
    title: "Ship unified Tasks workspace — completion evidence",
    note: "The release screen after the built app launched.",
    fileName: "completion-screen.png",
    contentType: "image/png",
    sizeBytes: 5_798,
    createdAt: `${CURRENT_DATE}T16:42:00Z`,
    url: "data:image/png;base64,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",
  },
  {
    id: "evidence-preview-pdf",
    title: "Ship unified Tasks workspace — completion evidence",
    note: "Signed verification record.",
    fileName: "release-verification.pdf",
    contentType: "application/pdf",
    sizeBytes: 889,
    createdAt: `${CURRENT_DATE}T16:40:00Z`,
    url: "data:application/pdf;base64,JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCAzNDUgPj4Kc3RyZWFtCkJUIC9GMSAxOCBUZiA3MiA3MjAgVGQgKFJlbGVhc2UgdmVyaWZpY2F0aW9uIHJlY29yZCkgVGogRVQKMC42NSB3IDcyIDcwMCBtIDU0MCA3MDAgbCBTCkJUIC9GMSAxMSBUZiA3MiA2NzAgVGQgKFRhc2s6IFNoaXAgdW5pZmllZCBUYXNrcyB3b3Jrc3BhY2UpIFRqIEVUCkJUIC9GMSAxMSBUZiA3MiA2NTAgVGQgKFN0YXR1czogc2lnbmVkIGluc3RhbGxlciB2ZXJpZmllZCwgYXBwIGxhdW5jaGVkLCB0YXNrIGZsb3cgY2hlY2tlZC4pIFRqIEVUCkJUIC9GMSAxMSBUZiA3MiA2MzAgVGQgKEVtcGxveWVlLWF0dGFjaGVkIGV2aWRlbmNlIGZpeHR1cmUgZm9yIHRoZSBjb21wYW5pb24gcHJldmlldy4pIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwNjM2IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNzA2CiUlRU9GCg==",
  },
  {
    id: "evidence-preview-markdown",
    title: "Ship unified Tasks workspace — completion evidence",
    note: "The checked release steps.",
    fileName: "verification-notes.md",
    contentType: "text/markdown",
    sizeBytes: PREVIEW_MARKDOWN.length,
    createdAt: `${CURRENT_DATE}T16:38:00Z`,
    url: previewTextUrl("text/markdown", PREVIEW_MARKDOWN),
  },
  {
    id: "evidence-preview-docx",
    title: "Ship unified Tasks workspace — completion evidence",
    note: "The release checklist the employee used.",
    fileName: "release-checklist.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 18_432,
    createdAt: `${CURRENT_DATE}T16:36:00Z`,
    url: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBAo=",
  },
  {
    id: "evidence-preview-zip",
    title: "Ship unified Tasks workspace — completion evidence",
    note: "Installer logs collected during verification.",
    fileName: "installer-logs.zip",
    contentType: "application/zip",
    sizeBytes: 1_248_512,
    createdAt: `${CURRENT_DATE}T16:34:00Z`,
    url: "data:application/zip;base64,UEsDBAo=",
  },
  {
    id: "evidence-preview-7z",
    title: "Ship unified Tasks workspace — completion evidence",
    note: "The archived build output.",
    fileName: "build-output.7z",
    contentType: "application/x-7z-compressed",
    sizeBytes: 3_905_536,
    createdAt: `${CURRENT_DATE}T16:32:00Z`,
    url: "data:application/x-7z-compressed;base64,N3q8ryoc",
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
  const detailScenario = scenario === "details" || scenario === "details-readonly" || scenario === "details-interactive"
    || scenario === "evidence-missing" || scenario === "evidence-corrupt";
  const pendingMode = params.get("pending");
  const pendingRows = pendingMode ? [{ id: "pending-1", title: "Draft the onboarding checklist", description: "Optimistic add awaiting confirmation.", completed: false, due_date: CURRENT_DATE, pending_status: pendingMode, pending_error: pendingMode === "failed" ? "The workspace timed out" : undefined }] : [];
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
  // The preview resolves fixture data URLs directly; a missing or corrupt
  // scenario exercises the fallback states without a live workspace.
  const loadPreviewEvidence = async (record: TaskEvidenceRecord) => {
    if (scenario === "evidence-missing") throw new Error("The evidence file could not be found.");
    if (scenario === "evidence-corrupt" && record.contentType === "image/png") {
      return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00])], { type: "image/png" });
    }
    const response = await fetch(record.url);
    if (!response.ok) throw new Error(`The evidence file failed (${response.status}).`);
    return response.blob();
  };
  const evidenceScenario = scenario?.startsWith("completion") ? scenario : null;
  const evidencePhase: TaskEvidenceDialogPhase = scenario === "completion-uploading" ? "saving"
    : scenario === "completion-failed" ? "failed"
      : scenario === "completion-saved" ? "evidence_saved"
        : scenario === "completion-done" ? "done" : "idle";
  return <div className="workspace preview-workspace">
    <SidebarNav activeView="tasks" onNavigate={() => undefined} onNewChat={() => undefined} initiallyCollapsed={new URLSearchParams(window.location.search).get("sidebar") !== "expanded"} />
    <section className={`stage${previewHistorical ? "" : " has-dock"}`}><header className="masthead"><div><p>{formatWorkOsDate(previewDate)}</p><h1>Tasks</h1></div><div className="mast-actions"><TaskDateNavigator currentDate={CURRENT_DATE} selectedDate={previewDate} onDate={async (date) => setPreviewDate(date)} /><button className="avatar">DZ</button></div></header>
      <TasksWorkspace currentDate={CURRENT_DATE} historyDate={previewDate} backlog={backlog} currentPlan={currentPlan} historicalPlan={previewHistorical ? historicalPlan : null} historicalTasks={previewHistorical ? baseTasks : []} goal={goal} goalProvenance="accepted_suggestion" suggestion={suggestion} saveState="saved" taskView={taskView} taskSort={taskSort} taskSearch={previewSearch} onTaskSearch={setPreviewSearch} todayTasks={[...pendingRows, ...degraded.filter((task) => task.due_date === CURRENT_DATE)]} taskHistory={previewTaskHistory} workspaceHistory={previewTaskHistory} historyOrder="local" historyError={previewHistoryError} historyHasData={params.has("stale")} onRetryHistory={() => setPreviewHistoryError(false)} carryOver={unfinishedBefore(baseTasks, CURRENT_DATE)} carryOverOpen={carryOpen} loadingMore={false} hasMore={false} busy={false} loading={scenario === "history-loading"} initialTaskMenuId={menuId} initialFiltersOpen={params.has("filters")} onTaskView={setTaskView} onTaskSort={setTaskSort} onDate={async (date) => setPreviewDate(date)} onEditFocus={() => { setComposerPanel("goal"); setComposerOpen(true); }} onAddTask={() => undefined} onOpenTask={() => setDetailsOpen(true)} onEditTask={openPreviewEdit} onArchiveTask={(task) => setPreviewRemoval({ task, mode: "archive" })} onDeleteTask={(task) => setPreviewRemoval({ task, mode: "delete" })} onSurfaceTask={() => undefined} onTaskCompletion={() => undefined} onCarryOverOpen={setCarryOpen} onLoadMore={() => undefined} />
      {!previewHistorical && <ProgressComposer mode="agenda" input={input} open={composerOpen} panel={composerPanel} pending={pending} receipt={receipt} busy={false} required={false} goal={goal} goalProvenance="accepted_suggestion" goalSuggestion={suggestion} saveState="saved" onInput={setInput} onOpen={() => { setComposerPanel("update"); setComposerOpen(true); }} onOpenGoal={() => { setComposerPanel("goal"); setComposerOpen(true); }} onClose={() => { setComposerOpen(false); setPending(""); }} onSubmit={() => { const text = input.trim(); if (!text) return; setPending(text); setReceipt(null); setInput(""); setComposerOpen(true); }} onClassify={(kind) => { const text = pending; setReceipt({ text, kind, createdAt: new Date().toISOString(), message: kind === "new_task" ? `Added “${text}” to today’s agenda.` : `Recorded “${text}” as ${kind.replaceAll("_", " ")} for today.` }); setPending(""); }} onApplyGoal={setGoal} />}
      {detailsOpen && <TaskDetailsModal details={detailsTask} loading={false} readOnly={scenario === "details-readonly"} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={subtaskMenuId} moveMenuId={moveMenuId} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={setSubtaskMenuId} onMoveMenu={setMoveMenuId} onSubtaskCreate={() => undefined} onEditTask={openPreviewEdit} onCompleteTask={() => undefined} completionEvidence={PREVIEW_EVIDENCE} loadEvidence={loadPreviewEvidence} onAttachEvidence={() => undefined} onDownloadEvidence={() => undefined} onMoveSubtask={(subtask) => { setSubtaskMenuId(null); setMoveMenuId(null); setPreviewSubtasks((current) => current.filter((row) => String(row.provider_task_id || row.id) !== String(subtask.provider_task_id || subtask.id))); }} onToggleSubtask={(subtask) => setPreviewSubtasks((current) => current.map((row) => String(row.provider_task_id || row.id) === String(subtask.provider_task_id || subtask.id) ? { ...row, completed: !row.completed } : row))} onArchiveSubtask={(subtask) => setPreviewRemoval({ task: subtask, mode: "archive" })} onDeleteSubtask={(subtask) => setPreviewRemoval({ task: subtask, mode: "delete" })} onClose={() => setDetailsOpen(false)} />}
      {scenario === "details-loading" && <TaskDetailsModal details={{ task: tasks[0] as unknown as Record<string, unknown>, subtasks: [], moveTargets: [], subtaskSync: undefined }} loading={true} readOnly={false} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={null} moveMenuId={null} loadEvidence={loadPreviewEvidence} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={() => undefined} onMoveMenu={() => undefined} onSubtaskCreate={() => undefined} onEditTask={() => undefined} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
      {scenario === "create" && <TaskComposerModal busy={false} title="" description="" assignees={["person-1"]} options={[{ id: "person-1", displayName: "Dana Whitfield", email: "dana@example.com" }, { id: "person-2", displayName: "Alex Rivera", email: null }]} optionsLoading={false} onTitle={() => undefined} onDescription={() => undefined} onToggleAssignee={() => undefined} onClose={() => undefined} onSubmit={() => undefined} />}
      {scenario === "edit" && <TaskEditModal kind="task" title="Ship unified Tasks workspace" description="Finish the desktop implementation and validation." busy={false} onTitle={() => undefined} onDescription={() => undefined} onClose={() => undefined} onSubmit={() => undefined} />}
      {scenario === "confirm-archive" && <TaskRemovalConfirmation mode="archive" scope="task" title="Ship unified Tasks workspace" subtaskCount={3} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />}
      {scenario === "confirm-delete" && <TaskRemovalConfirmation mode="delete" scope="task" title="Ship unified Tasks workspace" subtaskCount={3} busy={false} onCancel={() => undefined} onConfirm={() => undefined} />}
      {scenario === "move-menu" && <TaskDetailsModal details={detailsTask} loading={false} readOnly={false} currentDate={CURRENT_DATE} busy={false} subtaskTitle="" subtaskDescription="" subtaskMenuId={subtaskMenuId} moveMenuId={moveMenuId} loadEvidence={loadPreviewEvidence} onSubtaskTitle={() => undefined} onSubtaskDescription={() => undefined} onSubtaskMenu={setSubtaskMenuId} onMoveMenu={setMoveMenuId} onSubtaskCreate={() => undefined} onEditTask={openPreviewEdit} onMoveSubtask={() => undefined} onToggleSubtask={() => undefined} onArchiveSubtask={() => undefined} onDeleteSubtask={() => undefined} onClose={() => undefined} />}
      {previewEditTask && <TaskEditModal kind="subtask" title={previewEditTitle} description={previewEditDescription} busy={false} onTitle={setPreviewEditTitle} onDescription={setPreviewEditDescription} onClose={() => setPreviewEditTask(null)} onSubmit={savePreviewEdit} />}
      {previewRemoval && <TaskRemovalConfirmation mode={previewRemoval.mode} scope="subtask" title={String(previewRemoval.task.title ?? "Untitled subtask")} subtaskCount={0} busy={false} onCancel={() => setPreviewRemoval(null)} onConfirm={confirmPreviewRemoval} />}
      {selectionScenario && <TaskSelectionCard title="Finish pending work" tasks={selectionScenario === "empty" || selectionScenario === "error" ? [] : selectionTasks} status={selectionScenario === "loading" ? "loading" : selectionScenario === "error" ? "error" : "ready"} degraded={selectionScenario === "degraded"} dense={selectionScenario === "dense"} errorMessage="The task list could not be refreshed." onRetry={() => undefined} onMarkSelectedDone={() => undefined} onLoadSubtasks={async (taskId) => (taskId === selectionTasks[0]?.id ? selectionSubtasks : [])} />}
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
