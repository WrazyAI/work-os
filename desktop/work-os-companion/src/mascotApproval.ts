import { isMutatingToolOp, type ProposedOperation, type ToolCallResult } from "./interpretation";

/** A receipt (including queued/denied/failed) has already consumed its decision.
 * Keep only genuinely unanswered mutations in the needs-input state. */
export function hasPendingMascotApproval(operations: readonly ProposedOperation[] = [], results: readonly ToolCallResult[] = []): boolean {
  return operations.some((op) => op.enabled && isMutatingToolOp(op) && !results.some((result) =>
    result.op === op || (op.proposalId ? result.op.proposalId === op.proposalId :
      result.op.op === op.op && result.op.taskId === op.taskId && result.op.statement === op.statement)));
}
