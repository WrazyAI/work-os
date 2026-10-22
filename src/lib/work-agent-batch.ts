import { WorkOsValidationError } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";

/** Batch is a convenience envelope, not a transaction: each operation carries
 * its own idempotent key and reports its own result. */

export const AGENT_BATCH_MAX_OPERATIONS = 20;
export const AGENT_BATCH_OPERATIONS = ["create_task", "update_task", "complete_task", "reopen_task", "log_progress"] as const;
export type AgentBatchOperation = (typeof AGENT_BATCH_OPERATIONS)[number];

export type AgentBatchItem = {
  index: number;
  operation: AgentBatchOperation;
  payload: Json;
};

export function validateAgentBatch(body: Json): AgentBatchItem[] {
  const operations = body?.operations;
  if (!Array.isArray(operations) || !operations.length) {
    throw new WorkOsValidationError("A batch needs at least one operation");
  }
  if (operations.length > AGENT_BATCH_MAX_OPERATIONS) {
    throw new WorkOsValidationError(`A batch supports at most ${AGENT_BATCH_MAX_OPERATIONS} operations`);
  }
  return operations.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new WorkOsValidationError(`Operation ${index} must be an object`);
    }
    const { operation, ...payload } = raw as Json;
    if (typeof operation !== "string" || !(AGENT_BATCH_OPERATIONS as readonly string[]).includes(operation)) {
      throw new WorkOsValidationError(`Unknown batch operation: ${String(operation)}`);
    }
    return { index, operation: operation as AgentBatchOperation, payload };
  });
}

export function batchItemTaskId(payload: Json): { taskId: string; rest: Json } {
  const taskId = typeof payload.task_id === "string" ? payload.task_id.trim() : "";
  if (!taskId) throw new WorkOsValidationError("task_id is required");
  const { task_id: _ignored, ...rest } = payload;
  return { taskId, rest };
}
