import { safeTaskText } from "./taskWorkspace";

export type CandidateOperationKind = "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task";
export type CandidateClaimKind = "progress" | "completion" | "blocker" | "priority_change" | "new_work";

export interface ProposedOperation {
  op: CandidateOperationKind;
  statement: string;
  taskId?: string;
  taskTitle?: string;
  /** Employee inclusion toggle — nothing files without this. */
  enabled: boolean;
}

export interface CandidateReview {
  originalInput: string;
  operations: ProposedOperation[];
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
  const source = raw as { operations?: unknown };
  const allowed = new Set(tasks.map((task) => task.id));
  if (!Array.isArray(source.operations)) return null;

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
  return { originalInput, operations };
}

export function interpretationFallbackReason(error: unknown): string {
  return error instanceof Error && /ai_unavailable|ai_unconfigured|503|501/i.test(error.message)
    ? "The assistant is unavailable right now."
    : error instanceof Error && /offline|network|fetch/i.test(error.message)
      ? "You appear to be offline."
      : "The assistant couldn't read that update.";
}
