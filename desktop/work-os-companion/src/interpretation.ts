import { safeTaskText } from "./taskWorkspace";

export type CandidateOperationKind = "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task"
  | "add_task" | "archive_task" | "delete_task" | "modify_task_description" | "modify_task_status"
  | "add_subtask" | "modify_subtask" | "delete_subtask" | "display_pending_tasks" | "display_overdue_tasks"
  | "navigate_to_page";

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
  proposalId?: string;
  /** Employee inclusion toggle — nothing files without this. */
  enabled: boolean;
}

export interface ToolCallResult {
  op: ProposedOperation;
  status: "recorded" | "queued" | "failed" | "denied";
  message: string;
  data?: unknown;
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
};

export function operationLabel(op: CandidateOperationKind): string {
  return OPERATION_LABELS[op] ?? "Update:";
}

/** Read-only tools fetch immediately in the client — viewing tasks or
 * navigating mutates nothing, so these never enter the approval queue. */
export function isDisplayToolOp(op: Pick<ProposedOperation, "op">): boolean {
  return op.op === "display_pending_tasks" || op.op === "display_overdue_tasks";
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
  return op.proposalId ? `PATCH /api/work-os/proposals/${op.proposalId} ${JSON.stringify({ decision: "accept" })}` : null;
}

/**
 * Defensively normalizes an interpretation response. Malformed provider data
 * must never render as task content: every string passes safeTaskText, ids
 * must exist in the employee's task list, and any structural surprise returns
 * null so the UI falls back to the manual classifier.
 */
export function normalizeInterpretation(
  raw: unknown,
  originalInput: string,
  tasks: Array<{ id: string; title: string }>,
): CandidateReview | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as { operations?: unknown; reply?: unknown };
  const allowed = new Set(tasks.map((task) => task.id));
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
    operations.push({ op, statement, taskId, taskTitle, taskGroupId, limit, page, enabled: true });
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
  return reason === "nifty_failure"
    ? "Your tasks could not be loaded from Nifty. Choose the update type instead."
    : /ai_unavailable|ai_unconfigured|503|501/i.test(`${reason} ${message}`)
    ? "The assistant is unavailable right now."
    : /offline|network|fetch/i.test(`${reason} ${message}`)
      ? "You appear to be offline."
      : "The assistant couldn't read that update.";
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

/** Final submitted markdown: the narrative (placeholder-free) plus the employee's bottleneck answer. */
export function composeEodMarkdown(markdown: string, bottleneck: string, requiresBottleneck = true): string {
  const narrative = stripBottleneckSection(markdown);
  return requiresBottleneck ? `${narrative}\n\n## Bottleneck\n${bottleneck.trim()}` : narrative;
}

/** Offline playground stand-in for the AI EOD draft — device-only, clearly labeled. */
export function simulateAiEod(day: { tasks: Array<Record<string, unknown>>; plan?: { freeform_intent?: string | null } | null; shiftDate: string }): string {
  const title = (task: Record<string, unknown>) => safeTaskText(task.title, "a task");
  const completed = day.tasks.filter((task) => task.completed === true).map((task) => `- ${title(task)}`);
  const open = day.tasks.filter((task) => task.completed !== true).map((task) => `- ${title(task)}`);
  const intent = day.plan?.freeform_intent?.trim();
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
  reviewProposal(proposalId: string): Promise<unknown>;
}

export interface ApprovalOutcome {
  recorded: number;
  queued: number;
  failed: Array<{ op: ProposedOperation; message: string }>;
  results: ToolCallResult[];
}

/** Accepts stored proposals one at a time. An assistant result cannot mutate a
 * task or Nifty until the exact persisted proposal receives this decision. */
export async function fileApprovedOperations(
  operations: ProposedOperation[],
  transport: ApprovalTransport,
): Promise<ApprovalOutcome> {
  const outcome: ApprovalOutcome = { recorded: 0, queued: 0, failed: [], results: [] };
  for (const op of operations) {
    try {
      if (!op.proposalId) throw new Error("This update no longer has a server-side approval record. Interpret it again before filing.");
      const result = await transport.reviewProposal(op.proposalId);
      if ((result as { queued?: boolean } | undefined)?.queued === true) {
        outcome.queued += 1;
        outcome.results.push({ op, status: "queued", message: "Queued locally for a later sync." });
      } else {
        const data = result && typeof result === "object" && "proposal" in result
          ? (result as { proposal: unknown }).proposal
          : result;
        outcome.recorded += 1;
        outcome.results.push({ op, status: "recorded", message: "Recorded. Provider confirmation follows the normal sync state.", data });
      }
    } catch (error) {
      const message = filingFailureMessage(error);
      outcome.failed.push({ op, message });
      outcome.results.push({ op, status: "failed", message });
    }
  }
  return outcome;
}

/** A filing request that outlives the client timeout may still have
 * landed server-side. Say so plainly instead of leaking timer jargon,
 * and point at Review before a retry files twice. */
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
