import { safeTaskText } from "./taskWorkspace";

export type CandidateOperationKind = "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task"
  | "add_task" | "archive_task" | "delete_task" | "modify_task_description" | "modify_task_status"
  | "add_subtask" | "modify_subtask" | "delete_subtask" | "display_pending_tasks" | "display_overdue_tasks"
  | "navigate_to_page" | "multi_task_add" | "multi_task_edit" | "multi_task_archive" | "multi_task_delete"
  | "multi_task_log" | "multi_task_reassign" | "plan_import";

/** One step of a batch entry. proposalIds are the server rows this step filed,
 * so an edited card can send its edits to the right proposals. */
export interface ProposedBatchSubtask {
  clientId: string;
  title: string;
  description?: string;
  proposalIds?: string[];
}

/** One entry of a multi_task_add / multi_task_edit batch. */
export interface ProposedBatchTask {
  clientId: string;
  taskId?: string;
  title?: string;
  description?: string;
  taskGroupId?: string;
  completed?: boolean;
  assigneePersonId?: string;
  dueDate?: string;
  subtasks: ProposedBatchSubtask[];
  proposalIds?: string[];
}

/** A plan import names the template to materialize. */
export interface ProposedPlanImport {
  blueprintId: string;
  clientName?: string;
  startDate?: string;
}

/** Destinations the assistant may link inline. Anything else is dropped. */
export const NAVIGATE_PAGES = ["day", "tasks", "review", "insights", "evidence", "settings"] as const;
export type NavigatePage = (typeof NAVIGATE_PAGES)[number];
export type CandidateClaimKind = "progress" | "completion" | "blocker" | "priority_change" | "new_work";

export interface ProposedOperation {
  op: CandidateOperationKind;
  statement: string;
  taskId?: string;
  taskTitle?: string;
  taskGroupId?: string;
  limit?: number;
  page?: NavigatePage;
  /** Batch payload for the multi-task operations. */
  tasks?: ProposedBatchTask[];
  /** plan_import only: which template to materialize. */
  planImport?: ProposedPlanImport;
  /** Server batch id, set once the batch has been filed for review. */
  batchId?: string;
  proposalId?: string;
  /** Set when the operation could not be filed for review (usually the task
   * left the list). The operation is then disabled and explained inline. */
  failure?: string;
  /** Employee inclusion toggle — nothing files without this. */
  enabled: boolean;
}

export interface ToolCallResult {
  op: ProposedOperation;
  status: "recorded" | "queued" | "processing" | "failed" | "denied";
  message: string;
  data?: unknown;
  /** The stored proposal can be filed again with the same id (nothing claimed it). */
  retryable?: boolean;
  /** Set only when the server reports an unresolved Nifty create: the retry
   * must first confirm nothing was created so the intent can be cleared. */
  createResolution?: "no_task_created";
}

export interface CandidateReview {
  originalInput: string;
  operations: ProposedOperation[];
  /** Assistant's conversational reply — present for chat messages and work updates alike. */
  reply?: string;
}

const OPERATION_LABELS: Record<CandidateOperationKind, string> = {
  record_progress: "Progress on",
  record_blocker: "Blocker on",
  complete_task: "Mark done:",
  reopen_task: "Reopen:",
  create_task: "New task:",
  add_task: "New task:",
  archive_task: "Archive:",
  delete_task: "Delete:",
  modify_task_description: "Update description:",
  modify_task_status: "Move status:",
  add_subtask: "New subtask:",
  modify_subtask: "Update subtask:",
  delete_subtask: "Delete subtask:",
  display_pending_tasks: "Show pending tasks",
  display_overdue_tasks: "Show overdue tasks",
  navigate_to_page: "Open page:",
  multi_task_add: "Add tasks:",
  multi_task_edit: "Update tasks:",
  multi_task_archive: "Archive tasks:",
  multi_task_delete: "Delete tasks:",
  multi_task_log: "Log progress:",
  multi_task_reassign: "Reassign tasks:",
  plan_import: "Import a plan:",
};

export function operationLabel(op: CandidateOperationKind): string {
  return OPERATION_LABELS[op] ?? "Update:";
}

/** Read-only tools fetch immediately in the client — viewing tasks or
 * navigating mutates nothing, so these never enter the approval queue. */
export function isDisplayToolOp(op: Pick<ProposedOperation, "op">): boolean {
  return op.op === "display_pending_tasks" || op.op === "display_overdue_tasks";
}

/** How many reviewable items a batch files. An add batch files one new task per
 * new entry plus every step; an edit batch files one change per edited field
 * group (wording/status, then completion) plus any steps. An entry that only
 * adds steps to an existing task files no task row of its own. */
export function batchItemCount(op: Pick<ProposedOperation, "op" | "tasks">): number {
  return (op.tasks ?? []).reduce((total, task) => {
    if (op.op === "multi_task_edit") {
      const wording = task.title !== undefined || task.description !== undefined || task.taskGroupId !== undefined ? 1 : 0;
      const completion = task.completed !== undefined ? 1 : 0;
      return total + wording + completion + task.subtasks.length;
    }
    if (op.op === "multi_task_archive" || op.op === "multi_task_delete" || op.op === "multi_task_log" || op.op === "multi_task_reassign") {
      // One item per named task; these tools never add steps.
      return total + 1;
    }
    return total + (task.taskId ? 0 : 1) + task.subtasks.length;
  }, 0);
}

/** Batch tools render their own grouped approval card instead of the shared
 * one: they carry several tasks and steps in a single decision. */
export function isBatchToolOp(op: Pick<ProposedOperation, "op">): boolean {
  return op.op === "multi_task_add" || op.op === "multi_task_edit" || op.op === "multi_task_archive"
    || op.op === "multi_task_delete" || op.op === "multi_task_log" || op.op === "multi_task_reassign";
}

/** The batch tools that remove work, which the card renders in the danger tone. */
export function isDestructiveBatchOp(op: Pick<ProposedOperation, "op">): boolean {
  return op.op === "multi_task_delete" || op.op === "multi_task_archive";
}

/** plan_import is its own one-card operation, not a tasks table. */
export function isPlanImportOp(op: Pick<ProposedOperation, "op">): boolean {
  return op.op === "plan_import";
}

/** Everything the grouped card renders: the batch tools plus plan_import. */
export function usesGroupedCard(op: Pick<ProposedOperation, "op">): boolean {
  return isBatchToolOp(op) || isPlanImportOp(op);
}

/** Mutating tools always require an explicit approval decision first. */
export function isMutatingToolOp(op: Pick<ProposedOperation, "op">): boolean {
  return !isDisplayToolOp(op) && op.op !== "navigate_to_page";
}

/** How many mutating proposals still need an approval decision. Zero means the
 *  approval bar must not render at all — a display-only or fully filed turn has
 *  nothing to approve, and a "0 tool calls" button is a lie. */
export function pendingApprovalCount(
  operations: readonly ProposedOperation[],
  results?: readonly ToolCallResult[],
): number {
  return operations.filter((op) =>
    isMutatingToolOp(op) &&
    op.enabled &&
    !results?.some((result) => result.op === op || (op.proposalId !== undefined && result.op.proposalId === op.proposalId)),
  ).length;
}

/** The exact Work OS request an approved assistant proposal will make. */
export function operationToolCall(op: ProposedOperation, context: ApprovedOpContext): { tool: string; command: string } {
  if (isBatchToolOp(op)) {
    const items = batchItemCount(op);
    return {
      tool: "work_os.proposals.review_batch",
      command: `POST /api/work-os/proposal-batches/${op.batchId ?? "<batch>"} ${JSON.stringify({ decision: "accept", decisions: `${items} item(s)` })}`,
    };
  }
  if (op.op === "plan_import") {
    return {
      tool: "work_os.proposals.review_batch",
      command: `POST /api/work-os/proposal-batches/${op.batchId ?? "<batch>"} ${JSON.stringify({ decision: "accept", decisions: "import" })}`,
    };
  }
  if (op.proposalId) {
    return {
      tool: "work_os.proposals.review",
      command: `PATCH /api/work-os/proposals/${op.proposalId} ${JSON.stringify({ decision: "accept" })}`,
    };
  }
  if (op.op === "complete_task" || op.op === "reopen_task") {
    return {
      tool: "work_os.tasks.update_completion",
      command: `PATCH /api/work-os/me/tasks/${op.taskId ?? "<select-task>"} ${JSON.stringify({ completed: op.op === "complete_task" })}`,
    };
  }
  if (op.op === "create_task" || op.op === "add_task") {
    return {
      tool: "work_os.tasks.create",
      command: `POST /api/work-os/me/tasks ${JSON.stringify({ name: (op.taskTitle || op.statement).slice(0, 240), description: op.statement, due_date: context.shiftDate, assignee_person_ids: context.personId ? [context.personId] : [] })}`,
    };
  }
  if (op.op === "archive_task" || op.op === "delete_task") {
    const mode = op.op === "delete_task" ? "delete" : "archive";
    return { tool: `work_os.tasks.${mode}`, command: `DELETE /api/work-os/me/tasks/${op.taskId ?? "<select-task>"}?mode=${mode}` };
  }
  if (op.op === "modify_task_description" || op.op === "modify_subtask") {
    return { tool: "work_os.tasks.update", command: `PATCH /api/work-os/me/tasks/${op.taskId ?? "<select-task>"} ${JSON.stringify({ description: op.statement })}` };
  }
  if (op.op === "modify_task_status") {
    return { tool: "work_os.tasks.update_status", command: `PATCH /api/work-os/me/tasks/${op.taskId ?? "<select-task>"} ${JSON.stringify({ task_group_id: op.taskGroupId ?? "<status-column>" })}` };
  }
  if (op.op === "add_subtask") {
    return { tool: "work_os.tasks.create_subtask", command: `POST /api/work-os/me/tasks ${JSON.stringify({ name: (op.taskTitle || op.statement).slice(0, 240), parent_task_id: op.taskId ?? "<parent-task>" })}` };
  }
  if (op.op === "delete_subtask") {
    return { tool: "work_os.tasks.delete_subtask", command: `DELETE /api/work-os/me/tasks/${op.taskId ?? "<select-subtask>"}?mode=delete` };
  }
  if (op.op === "navigate_to_page") {
    return { tool: "work_os.navigation.go", command: `OPEN ${op.page ?? "<page>"}` };
  }
  if (op.op === "display_pending_tasks" || op.op === "display_overdue_tasks") {
    const view = op.op === "display_overdue_tasks" ? "overdue" : "pending";
    return { tool: `work_os.tasks.display_${view}`, command: `GET /api/work-os/me/tasks?view=${view}&limit=${op.limit ?? 20}` };
  }
  return {
    tool: "work_os.check_ins.create",
    command: `POST /api/work-os/check-ins ${JSON.stringify({ source: "desktop", kind: context.promptKind || "optional", update_kind: op.op === "record_blocker" ? "blocked" : "material_progress", input_text: op.statement })}`,
  };
}

export function proposalApprovalCommand(op: ProposedOperation): string | null {
  if (isBatchToolOp(op) || isPlanImportOp(op)) return op.batchId ? `POST /api/work-os/proposal-batches/${op.batchId} ${JSON.stringify({ decision: "accept" })}` : null;
  return op.proposalId ? `PATCH /api/work-os/proposals/${op.proposalId} ${JSON.stringify({ decision: "accept" })}` : null;
}

/**
 * Defensively normalizes an interpretation response. Malformed provider data
 * must never render as task content: every string passes safeTaskText, ids
 * must exist in the employee's task list, and any structural surprise returns
 * null so the UI falls back to the manual classifier.
 */
/** Defensive batch parsing for the chat card. Mirrors the server's rules: a
 * foreign task id is dropped, a title is capped, and an entry with nothing to
 * do is discarded so the card never shows an empty row. */
function normalizeBatchTasks(
  value: unknown,
  op: "multi_task_add" | "multi_task_edit" | "multi_task_archive" | "multi_task_delete" | "multi_task_log" | "multi_task_reassign",
  allowed: Map<string, string>,
): ProposedBatchTask[] {
  if (!Array.isArray(value)) return [];
  const tasks: ProposedBatchTask[] = [];
  for (const rawTask of value.slice(0, 20)) {
    if (!rawTask || typeof rawTask !== "object") continue;
    const entry = rawTask as Record<string, unknown>;
    const taskId = typeof entry.taskId === "string" && allowed.has(entry.taskId) ? entry.taskId : undefined;
    const statedTitle = typeof entry.title === "string" && entry.title.trim() ? safeTaskText(entry.title, "").slice(0, 240) || undefined : undefined;
    // A tool that names its target only by id (log, archive, delete, reassign)
    // still shows the real task title, taken from the same list the employee sees.
    const title = statedTitle ?? (taskId ? allowed.get(taskId) : undefined);
    const description = typeof entry.description === "string" && entry.description.trim() ? entry.description.trim().slice(0, 2000) : undefined;
    const taskGroupId = typeof entry.taskGroupId === "string" && entry.taskGroupId.trim() ? entry.taskGroupId.trim().slice(0, 160) : undefined;
    const completed = typeof entry.completed === "boolean" ? entry.completed : undefined;
    const subtasks: ProposedBatchSubtask[] = [];
    if (Array.isArray(entry.subtasks)) {
      for (const rawSubtask of entry.subtasks.slice(0, 20)) {
        if (!rawSubtask || typeof rawSubtask !== "object") continue;
        const subtask = rawSubtask as Record<string, unknown>;
        const subtaskTitle = typeof subtask.title === "string" && subtask.title.trim() ? safeTaskText(subtask.title, "").slice(0, 240) : "";
        if (!subtaskTitle) continue;
        const subtaskDescription = typeof subtask.description === "string" && subtask.description.trim() ? subtask.description.trim().slice(0, 2000) : undefined;
        subtasks.push({
          clientId: typeof subtask.clientId === "string" && subtask.clientId.trim() ? subtask.clientId.trim().slice(0, 80) : `s${subtasks.length + 1}`,
          title: subtaskTitle,
          ...(subtaskDescription ? { description: subtaskDescription } : {}),
        });
      }
    }
    const assigneePersonId = typeof entry.assigneePersonId === "string" && entry.assigneePersonId.trim() ? entry.assigneePersonId.trim().slice(0, 80) : undefined;
    const rawDue = typeof entry.dueDate === "string" ? entry.dueDate.trim().slice(0, 10) : "";
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? rawDue : undefined;
    if (op === "multi_task_add") {
      if (!taskId && !title) continue;
    } else if (op === "multi_task_edit") {
      if (!taskId || (!title && !description && !taskGroupId && completed === undefined)) continue;
    } else if (op === "multi_task_log") {
      if (!taskId || !description) continue;
    } else if (!taskId) {
      continue;
    }
    tasks.push({
      clientId: typeof entry.clientId === "string" && entry.clientId.trim() ? entry.clientId.trim().slice(0, 80) : `t${tasks.length + 1}`,
      ...(taskId ? { taskId } : {}),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(taskGroupId ? { taskGroupId } : {}),
      ...(completed === undefined ? {} : { completed }),
      ...(assigneePersonId ? { assigneePersonId } : {}),
      ...(dueDate ? { dueDate } : {}),
      subtasks,
    });
  }
  return tasks;
}

/** plan_import names a template. */
function normalizePlanImport(value: unknown): ProposedPlanImport | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Record<string, unknown>;
  const blueprintId = typeof entry.blueprintId === "string" && entry.blueprintId.trim() ? entry.blueprintId.trim().slice(0, 80) : undefined;
  if (!blueprintId) return undefined;
  const clientName = typeof entry.clientName === "string" && entry.clientName.trim() ? entry.clientName.trim().slice(0, 120) : undefined;
  const rawStart = typeof entry.startDate === "string" ? entry.startDate.trim().slice(0, 10) : "";
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(rawStart) ? rawStart : undefined;
  return { blueprintId, ...(clientName ? { clientName } : {}), ...(startDate ? { startDate } : {}) };
}

export function normalizeInterpretation(
  raw: unknown,
  originalInput: string,
  tasks: Array<{ id: string; title: string }>,
): CandidateReview | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as { operations?: unknown; reply?: unknown };
  const allowed = new Map(tasks.map((task) => [task.id, task.title]));
  const reply = typeof source.reply === "string" && source.reply.trim() ? source.reply.replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").slice(0, 1200) || undefined : undefined;
  if (!Array.isArray(source.operations)) {
    // A conversational reply with nothing to record is a valid assistant turn.
    return reply ? { originalInput, operations: [], reply } : null;
  }

  const operations: ProposedOperation[] = [];
  for (const entry of source.operations.slice(0, 20)) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as Record<string, unknown>;
    const op = typeof candidate.op === "string" ? (candidate.op as CandidateOperationKind) : null;
    const statement = safeTaskText(candidate.statement, "");
    if (!op || !(op in OPERATION_LABELS) || !statement) continue;
    const taskId = typeof candidate.taskId === "string" && allowed.has(candidate.taskId) ? candidate.taskId : undefined;
    if ((op === "complete_task" || op === "reopen_task" || op === "record_progress" || op === "record_blocker" || op === "archive_task" || op === "delete_task" || op === "modify_task_description" || op === "modify_task_status" || op === "add_subtask" || op === "modify_subtask" || op === "delete_subtask") && !taskId) continue;
    const taskTitle = typeof candidate.taskTitle === "string" && candidate.taskTitle.trim() ? safeTaskText(candidate.taskTitle, "") || undefined : undefined;
    const taskGroupId = typeof candidate.taskGroupId === "string" && candidate.taskGroupId.trim() ? candidate.taskGroupId.trim().slice(0, 160) : undefined;
    const limit = typeof candidate.limit === "number" && Number.isInteger(candidate.limit) ? Math.min(100, Math.max(1, candidate.limit)) : undefined;
    const page = op === "navigate_to_page" && typeof candidate.page === "string" && (NAVIGATE_PAGES as readonly string[]).includes(candidate.page)
      ? candidate.page as NavigatePage
      : undefined;
    if (op === "navigate_to_page" && !page) continue;
    const batch = op === "multi_task_add" || op === "multi_task_edit" || op === "multi_task_archive"
      || op === "multi_task_delete" || op === "multi_task_log" || op === "multi_task_reassign";
    const tasks = batch ? normalizeBatchTasks(candidate.tasks, op, allowed) : undefined;
    if (batch && !tasks?.length) continue;
    const planImport = op === "plan_import" ? normalizePlanImport(candidate.planImport ?? candidate.plan_import) : undefined;
    if (op === "plan_import" && !planImport) continue;
    operations.push({ op, statement, taskId, taskTitle, taskGroupId, limit, page, tasks, planImport, enabled: true });
  }
  if (!operations.length && !reply) return null;
  return { originalInput, operations, reply };
}

export function interpretationFallbackReason(error: unknown): string {
  const reason = error && typeof error === "object" && typeof (error as { reason?: unknown }).reason === "string"
    ? (error as { reason: string }).reason
    : "";
  const message = error instanceof Error ? error.message : error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : "";
  if (reason === "nifty_failure") return "Your tasks could not be loaded. Choose the update type instead.";
  if (/ai_unavailable|ai_unconfigured|503|501/i.test(`${reason} ${message}`)) return "The assistant is unavailable right now.";
  if (/ai_malformed/i.test(`${reason} ${message}`)) return "The assistant couldn't read that update. Rephrase it or choose the update type.";
  if (/offline|network|fetch/i.test(`${reason} ${message}`)) return "You appear to be offline.";
  // Server-side filing errors carry actionable copy ("…no longer in your task
  // list…"). Surface it instead of a generic unreadable-update message.
  return message || "The assistant couldn't read that update.";
}

/** Summary for a completion batch where some operations could not be filed.
 * Names up to two affected tasks and carries the server's reason. */
export function partialFilingMessage(filed: number, failed: Array<{ title?: string; error: string }>): string {
  const first = failed[0];
  if (!filed) return first?.error ?? "The completion proposals were not saved.";
  const names = failed.map((entry) => entry.title?.trim()).filter((title): title is string => !!title).slice(0, 2);
  const named = names.length ? ` (${names.join(", ")}${failed.length > names.length ? "…" : ""})` : "";
  return `${failed.length} of ${filed + failed.length} tasks could not be filed${named}: ${first?.error ?? "try again."}`;
}

// ── EOD composer helpers ──────────────────────────────────────────────────

export const BOTTLENECK_QUESTION = "What prevented you from completing your task list?";

/** Removes any existing Bottleneck section so the employee's answer is authoritative. */
export function stripBottleneckSection(markdown: string): string {
  return markdown.replace(/\n+##\s*Bottleneck[\s\S]*$/i, "").replace(/\s+$/, "");
}

export function hasBottleneckAnswer(answer: string): boolean {
  return typeof answer === "string" && answer.trim().length >= 3;
}

/** The server's draft placeholder is not an answer. */
const BOTTLENECK_PLACEHOLDER = /^\(needs your input[^)]*\)$/i;

/** Reads a real answer out of the report draft. The AI draft appends a
 * `## Bottleneck` section; when the employee edits that section instead of the
 * dedicated field, the answer must still count — stripping it on submit would
 * silently discard what they wrote. */
export function extractBottleneckAnswer(markdown: string): string {
  const match = typeof markdown === "string" ? markdown.match(/\n+##\s*Bottleneck\s*\n([\s\S]*)$/i) : null;
  const body = match?.[1]?.trim() ?? "";
  if (!body || BOTTLENECK_PLACEHOLDER.test(body)) return "";
  return body;
}

/** The employee's answer, wherever they actually provided it. */
export function resolvedBottleneck(fieldAnswer: string, markdown: string): string {
  return hasBottleneckAnswer(fieldAnswer) ? fieldAnswer.trim() : extractBottleneckAnswer(markdown);
}

/** Final submitted markdown: the narrative (placeholder-free) plus the employee's bottleneck answer. */
export function composeEodMarkdown(markdown: string, bottleneck: string, requiresBottleneck = true): string {
  const narrative = stripBottleneckSection(markdown);
  return requiresBottleneck ? `${narrative}\n\n## Bottleneck\n${bottleneck.trim()}` : narrative;
}

/** Offline playground stand-in for the AI EOD draft — device-only, clearly labeled. */
export function simulateAiEod(day: { tasks: Array<Record<string, unknown>>; plan?: { focus_summary?: string | null; freeform_intent?: string | null } | null; shiftDate: string }): string {
  const title = (task: Record<string, unknown>) => safeTaskText(task.title, "a task");
  const completed = day.tasks.filter((task) => task.completed === true).map((task) => `- ${title(task)}`);
  const open = day.tasks.filter((task) => task.completed !== true).map((task) => `- ${title(task)}`);
  const intent = (day.plan?.focus_summary ?? day.plan?.freeform_intent)?.trim();
  return [
    `# EOD Report (offline playground) — ${day.shiftDate}`,
    "",
    "## Summary",
    `Drafted on-device from the scenario record — nothing reached the server.${intent ? ` The stated goal was: ${intent}` : ""}`,
    "",
    "## Completed",
    ...(completed.length ? completed : ["- Nothing completed yet"]),
    "",
    "## Carried forward",
    ...(open.length ? open : ["- Nothing pending"]),
    "",
    "## Bottleneck",
    "(needs your input — what prevented you from completing your task list?)",
  ].join("\n");
}

export interface ApprovedOpContext {
  shiftDate: string | null;
  personId: string | null;
  promptKind: string;
}

export interface ApprovalTransport {
  reviewProposal(proposalId: string, options?: { providerCreateResolution?: "no_task_created" }): Promise<unknown>;
  /** Owner-scoped readback for reconciling an interrupted approval. */
  readProposal?(proposalId: string): Promise<unknown>;
  /** One decision for a whole batch, with the employee's per-item edits. */
  reviewBatch?(batchId: string, body: { decision: "accept" | "reject"; decisions: Array<{ proposal_id: string; decision?: "accept" | "reject"; edits?: Record<string, unknown> }> }): Promise<unknown>;
}

export interface ApprovalOutcome {
  recorded: number;
  queued: number;
  processing: number;
  failed: Array<{ op: ProposedOperation; message: string }>;
  results: ToolCallResult[];
}

function proposalRow(value: unknown): Record<string, unknown> | null {
  const proposal = value && typeof value === "object" && "proposal" in (value as Record<string, unknown>)
    ? (value as { proposal?: unknown }).proposal
    : value;
  return proposal && typeof proposal === "object" ? proposal as Record<string, unknown> : null;
}

/** The server flag that unlocks the clear-and-retry recovery for an uncertain
 * Nifty create. Never inferred from message text. */
function createResolutionFor(row: Record<string, unknown> | null): "no_task_created" | undefined {
  return row?.create_intent_unresolved === true ? "no_task_created" : undefined;
}

/** One reject decision for a whole batch, shaped like any other filing outcome
 * so the chat surfaces can merge it without a special case. */
export async function skipBatchOperation(operation: ProposedOperation, transport: ApprovalTransport): Promise<ToolCallResult> {
  const outcome = await fileApprovedOperations([operation], transport, { decision: "reject" });
  return outcome.results[0] ?? { op: operation, status: "denied", message: "Skipped. Nothing from this batch was recorded." };
}

/** A filed proposal row, as the proposals endpoint returns it. */
export interface FiledProposalRow {
  id: string;
  client_operation_index: number;
  client_id?: string | null;
  batch_id?: string | null;
  batch_index?: number | null;
  /** The server's stored task state, used to name an entry the agent described
   * only by id (a log, archive, or reassign never carries the task title). */
  before_state?: { title?: string | null } | null;
}

/** Groups filed rows by the operation the client sent. A batch files several
 * rows for one operation, so they must stay together. */
export function filedProposalGroups(
  proposals: FiledProposalRow[],
  indexOf: (clientOperationIndex: number) => number | undefined,
): Map<number, FiledProposalRow[]> {
  const byIndex = new Map<number, FiledProposalRow[]>();
  for (const proposal of proposals) {
    const original = indexOf(proposal.client_operation_index);
    if (original === undefined) continue;
    const list = byIndex.get(original) ?? [];
    list.push(proposal);
    byIndex.set(original, list);
  }
  return byIndex;
}

/** Attaches filed rows back onto the operation they came from. A single
 * operation keeps its one proposal id; a batch receives its batch id and gives
 * every task and step the ids it filed, so the card's edits reach the rows. */
export function attachFiledProposals(op: ProposedOperation, rows: FiledProposalRow[]): ProposedOperation {
  if (!isBatchToolOp(op) && !isPlanImportOp(op)) return { ...op, proposalId: rows[0]?.id };
  const batchId = rows.find((row) => row.batch_id)?.batch_id ?? undefined;
  const idsByClientId = new Map<string, string[]>();
  const titleByClientId = new Map<string, string>();
  for (const row of rows) {
    if (!row.client_id) continue;
    const list = idsByClientId.get(row.client_id) ?? [];
    list.push(row.id);
    idsByClientId.set(row.client_id, list);
    const title = row.before_state?.title;
    if (typeof title === "string" && title.trim()) titleByClientId.set(row.client_id, title.trim());
  }
  const withIds = <T extends { clientId: string; title?: string }>(entry: T): T => {
    const ids = idsByClientId.get(entry.clientId);
    const title = titleByClientId.get(entry.clientId);
    return {
      ...entry,
      // A tool that named its target only by id gets the real task title here,
      // so the card never shows a note as if it were the task name.
      ...(entry.title === undefined && title ? { title } : {}),
      ...(ids ? { proposalIds: ids } : {}),
    };
  };
  return {
    ...op,
    ...(batchId ? { batchId } : {}),
    ...(op.tasks ? { tasks: op.tasks.map((task) => ({ ...withIds(task), subtasks: task.subtasks.map(withIds) })) } : {}),
  };
}

export interface BatchReviewResult {
  proposal_id: string;
  client_id: string | null;
  parent_client_id: string | null;
  operation: string;
  status: string;
  outcome: string | null;
  message: string;
  create_resolution?: "no_task_created";
}

export interface BatchReviewResponse {
  batch_id: string;
  decision: "accept" | "reject";
  results: BatchReviewResult[];
  accepted: number;
  failed: number;
  skipped: number;
  outcome: string;
}

/** The editable fields of a batch entry, omitted when untouched so an approval
 * can never clear a value the employee did not change. */
function batchEntryEdits(task: ProposedBatchTask): Record<string, unknown> | undefined {
  const edits: Record<string, unknown> = {};
  if (task.title !== undefined) edits.name = task.title;
  if (task.description !== undefined) edits.description = task.description;
  if (task.taskGroupId !== undefined) edits.task_group_id = task.taskGroupId;
  return Object.keys(edits).length ? edits : undefined;
}

function batchStepEdits(subtask: ProposedBatchSubtask): Record<string, unknown> | undefined {
  const edits: Record<string, unknown> = {};
  if (subtask.title !== undefined) edits.name = subtask.title;
  if (subtask.description !== undefined) edits.description = subtask.description;
  return Object.keys(edits).length ? edits : undefined;
}

/** Accepts stored proposals one at a time. An assistant result cannot mutate a
 * task or Nifty until the exact persisted proposal receives this decision. */
export async function fileApprovedOperations(
  operations: ProposedOperation[],
  transport: ApprovalTransport,
  options?: { createResolution?: "no_task_created"; decision?: "accept" | "reject" },
): Promise<ApprovalOutcome> {
  const outcome: ApprovalOutcome = { recorded: 0, queued: 0, processing: 0, failed: [], results: [] };
  for (const op of operations) {
    try {
      // A batch files every item through one decision, carrying the employee's
      // edits. Items are still reviewed server-side one at a time, so a failure
      // stays per item instead of pretending the whole batch applied.
      if (isBatchToolOp(op) || isPlanImportOp(op)) {
        const batchId = op.batchId;
        if (!batchId || !transport.reviewBatch) throw new Error("This update no longer has a server-side batch record. Interpret it again before filing.");
        // A skip rejects every pending item in the batch in one decision. There
        // are no edits to carry: nothing is being applied.
        if (options?.decision === "reject") {
          await transport.reviewBatch(batchId, { decision: "reject", decisions: [] });
          outcome.results.push({ op, status: "denied", message: "Skipped. Nothing from this batch was recorded." });
          continue;
        }
        const decisions: Array<{ proposal_id: string; edits?: Record<string, unknown> }> = [];
        for (const task of op.tasks ?? []) {
          const edits = batchEntryEdits(task);
          for (const proposalId of task.proposalIds ?? []) decisions.push({ proposal_id: proposalId, ...(edits ? { edits } : {}) });
          for (const subtask of task.subtasks) {
            const subtaskEdits = batchStepEdits(subtask);
            for (const proposalId of subtask.proposalIds ?? []) decisions.push({ proposal_id: proposalId, ...(subtaskEdits ? { edits: subtaskEdits } : {}) });
          }
        }
        // A plan import expands server-side, so the client has no per-entry ids
        // to send; an empty decisions list approves every pending item.
        if (!decisions.length && !isPlanImportOp(op)) {
          throw new Error("This update has no server-side batch items. Interpret it again before filing.");
        }
        const response = await transport.reviewBatch(batchId, { decision: "accept", decisions }) as BatchReviewResponse | undefined;
        const items = Array.isArray(response?.results) ? response.results : [];
        const recorded = items.filter((item) => item.status === "applied").length;
        const attention = items.filter((item) => item.status === "failed" || item.status === "needs_review" || item.status === "skipped");
        if (!items.length) {
          outcome.recorded += 1;
          outcome.results.push({ op, status: "recorded", message: "Recorded.", data: { batch: response } });
          continue;
        }
        if (attention.length) {
          const message = attention.length === items.length
            ? "Nothing was filed. The batch needs attention before it can be approved."
            : `${recorded} of ${items.length} changes were filed. ${attention.length === 1 ? "One still needs" : `${attention.length} still need`} attention.`;
          outcome.failed.push({ op, message });
          outcome.results.push({
            op,
            status: "failed",
            message,
            retryable: true,
            ...(attention.some((item) => item.create_resolution) ? { createResolution: "no_task_created" as const } : {}),
            data: { batch: response },
          });
          continue;
        }
        outcome.recorded += recorded;
        outcome.results.push({ op, status: "recorded", message: `Filed ${recorded} change${recorded === 1 ? "" : "s"}.`, data: { batch: response } });
        continue;
      }
      if (!op.proposalId) throw new Error("This update no longer has a server-side approval record. Interpret it again before filing.");
      const result = await transport.reviewProposal(op.proposalId, options?.createResolution ? { providerCreateResolution: options.createResolution } : undefined);
      if ((result as { queued?: boolean } | undefined)?.queued === true) {
        outcome.queued += 1;
        outcome.results.push({ op, status: "queued", message: "Queued locally for a later sync." });
      } else {
        const data = result && typeof result === "object" && "proposal" in result
          ? (result as { proposal: unknown }).proposal
          : result;
        // The server states the real outcome; a 200 alone is not proof the
        // action applied (it may be stale, rejected, or still applying).
        const row = proposalRow(result);
        const serverOutcome = typeof row?.outcome === "string" ? row.outcome : null;
        const serverReason = typeof row?.failure_reason === "string" && row.failure_reason.trim() ? row.failure_reason.trim() : null;
        if (serverOutcome === "applying") {
          outcome.processing += 1;
          outcome.results.push({ op, status: "processing", message: "The server is still processing this change. Do not retry — recheck Review in a moment." });
        } else if (serverOutcome === "stale" || serverOutcome === "rejected") {
          const message = serverReason ?? (serverOutcome === "stale"
            ? "The task changed after this proposal was drafted. Create a new proposal from the current task state."
            : "This action was already rejected and was not filed.");
          outcome.failed.push({ op, message });
          outcome.results.push({ op, status: "failed", message });
        } else if (serverOutcome === "failed" || serverOutcome === "needs_review") {
          const message = serverReason ?? "Not filed. The server reported this action as failed.";
          const createResolution = createResolutionFor(row);
          outcome.failed.push({ op, message });
          outcome.results.push({ op, status: "failed", message, retryable: serverOutcome === "failed" || Boolean(createResolution), createResolution });
        } else {
          // `applied` (or a legacy server without an explicit outcome).
          outcome.recorded += 1;
          outcome.results.push({ op, status: "recorded", message: "Recorded. Provider confirmation follows the normal sync state.", data });
        }
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : "The change could not be filed.";
      // A dropped response is not proof of failure. Read the proposal back and
      // report what actually happened instead of guessing.
      if (/timed out|timeout|abort/i.test(rawMessage) && op.proposalId && transport.readProposal) {
        try {
          const row = proposalRow(await transport.readProposal(op.proposalId));
          const status = typeof row?.status === "string" ? row.status : null;
          const failureReason = typeof row?.failure_reason === "string" && row.failure_reason.trim() ? row.failure_reason.trim() : null;
          if (status === "applied") {
            outcome.recorded += 1;
            outcome.results.push({ op, status: "recorded", message: "Recorded after a slow response. The server confirmed the change applied.", data: row });
            continue;
          }
          if (status === "failed" || status === "needs_review" || status === "stale") {
            const message = failureReason ?? filingFailureMessage(error);
            const createResolution = createResolutionFor(row);
            outcome.failed.push({ op, message });
            outcome.results.push({ op, status: "failed", message, retryable: Boolean(createResolution), createResolution });
            continue;
          }
          // `applying` means the server claimed the proposal and is mid-write.
          if (status === "applying") {
            outcome.processing += 1;
            outcome.results.push({ op, status: "processing", message: "The server is still processing this change. Do not retry — recheck Review in a moment." });
            continue;
          }
          // `pending` means no write claimed the proposal yet: nothing was
          // filed, and the server's claim is atomic, so a retry cannot
          // double-apply. Keep it actionable instead of leaving a dead failure.
          if (status === "pending") {
            const message = "Not filed. The server still shows this proposal as pending, so it is safe to retry.";
            outcome.failed.push({ op, message });
            outcome.results.push({ op, status: "failed", message, retryable: true });
            continue;
          }
        } catch {
          // Fall through to the timeout guidance when the readback itself fails.
        }
      }
      const message = filingFailureMessage(error);
      outcome.failed.push({ op, message });
      outcome.results.push({ op, status: "failed", message });
    }
  }
  return outcome;
}

/** Only used when the server cannot confirm the proposal state either. A
 * dropped response may still land server-side, so say so plainly and point at
 * Review before a retry files twice. */
export function filingFailureMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "The change could not be filed.";
  if (/timed out|timeout|abort/i.test(raw)) {
    return "The server took too long to respond. It may still have filed — check Review before retrying.";
  }
  return raw;
}

/** Stable identity for a tool call across windows. Server proposals carry an
 * id; immediate display results fall back to their content coordinates. */
export function toolCallKey(op: Pick<ProposedOperation, "proposalId" | "op" | "taskId" | "statement">): string {
  return op.proposalId ?? `${op.op}|${op.taskId ?? ""}|${op.statement}`;
}

/** One pending review shared between the main window and the avatar so a
 * tool call raised in either surface appears in both. Results merge by key,
 * so filing or denying in one window is reflected in the other. Local
 * approve toggles stay per-window; the server dedupes concurrent filings. */
export interface PendingToolReview {
  /** Stable identity for this review across windows and reloads: both chat
   * surfaces key the review turn by it, so a shared review is one turn. */
  reviewId: string;
  input: string;
  reply?: string;
  operations: ProposedOperation[];
  results: ToolCallResult[];
  taskOptions: Array<{ id: string; title: string }>;
  updatedAt: string;
  origin: "main" | "avatar";
}

/** Merges incoming filed results over existing ones by stable key. Incoming
 * wins per key; unseen entries are appended in order. */
export function mergeToolResults(existing: ToolCallResult[], incoming: ToolCallResult[]): ToolCallResult[] {
  const keys = new Set(incoming.map((item) => toolCallKey(item.op)));
  return [...existing.filter((item) => !keys.has(toolCallKey(item.op))), ...incoming];
}
