import { safeTaskText } from "./taskWorkspace";

export type CandidateOperationKind = "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task";
export type CandidateClaimKind = "progress" | "completion" | "blocker" | "priority_change" | "new_work";

export interface ProposedOperation {
  op: CandidateOperationKind;
  statement: string;
  taskId?: string;
  taskTitle?: string;
  proposalId?: string;
  /** Employee inclusion toggle — nothing files without this. */
  enabled: boolean;
}

export interface ToolCallResult {
  op: ProposedOperation;
  status: "recorded" | "queued" | "failed" | "denied";
  message: string;
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
};

export function operationLabel(op: CandidateOperationKind): string {
  return OPERATION_LABELS[op] ?? "Update:";
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
  if (op.op === "create_task") {
    return {
      tool: "work_os.tasks.create",
      command: `POST /api/work-os/me/tasks ${JSON.stringify({ name: (op.taskTitle || op.statement).slice(0, 240), description: op.statement, due_date: context.shiftDate, assignee_person_ids: context.personId ? [context.personId] : [] })}`,
    };
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
  const reply = typeof source.reply === "string" && source.reply.trim() ? source.reply.replace(/\s+/g, " ").trim().slice(0, 600) : undefined;
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
    if ((op === "complete_task" || op === "reopen_task" || op === "record_progress") && !taskId) continue;
    const taskTitle = typeof candidate.taskTitle === "string" && candidate.taskTitle.trim() ? safeTaskText(candidate.taskTitle, "") || undefined : undefined;
    operations.push({ op, statement, taskId, taskTitle, enabled: true });
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
        outcome.recorded += 1;
        outcome.results.push({ op, status: "recorded", message: "Recorded. Provider confirmation follows the normal sync state." });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "The change could not be filed.";
      outcome.failed.push({ op, message });
      outcome.results.push({ op, status: "failed", message });
    }
  }
  return outcome;
}
