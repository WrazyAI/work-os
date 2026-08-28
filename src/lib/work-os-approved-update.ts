import { createHash } from "node:crypto";
import { createWorkOsCheckIn } from "@/lib/work-os-checkins";
import { createWorkOsEmployeeTask, setWorkOsEmployeeTaskCompletion } from "@/lib/work-os-employee-tasks";
import { db, nonEmptyString as text, type Json } from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";

export type ApprovedWorkUpdateOperation = {
  op: "record_progress" | "record_blocker" | "complete_task" | "reopen_task" | "create_task";
  statement: string;
  taskId?: string;
  taskTitle?: string;
};

const APPROVED_UPDATE_OPERATIONS = new Set<ApprovedWorkUpdateOperation["op"]>([
  "record_progress", "record_blocker", "complete_task", "reopen_task", "create_task",
]);

function approvedOperations(value: unknown): ApprovedWorkUpdateOperation[] {
  if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error("Choose between 1 and 20 approved updates");
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new Error("Approved update is invalid");
    const operation = item as Record<string, unknown>;
    const op = text(operation.op) as ApprovedWorkUpdateOperation["op"] | null;
    const statement = text(operation.statement);
    const taskId = text(operation.taskId);
    const taskTitle = text(operation.taskTitle);
    if (!op || !APPROVED_UPDATE_OPERATIONS.has(op) || !statement || statement.length > 1000) throw new Error("Approved update is invalid");
    if (["complete_task", "reopen_task"].includes(op) && !taskId) throw new Error("Task update requires a task");
    if (op === "create_task" && (taskTitle?.length ?? statement.length) > 240) throw new Error("Task title must be 240 characters or fewer");
    return { op, statement, taskId: taskId ?? undefined, taskTitle: taskTitle ?? undefined };
  });
}

/** Applies one employee-reviewed interpretation exactly once, including after offline replay. */
export async function applyApprovedWorkUpdate(access: WorkOsAccess, body: Json, idempotencyKey: string) {
  const originalInput = text(body.originalInput);
  if (!originalInput || originalInput.length > 4000) throw new Error("originalInput is required");
  const operations = approvedOperations(body.operations);
  const payload = { originalInput, shiftDate: text(body.shiftDate), operations };
  const payloadHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const personId = access.personId as string;
  const commands = db().from("work_companion_commands");
  const existingResult = await commands.select("id,payload_hash,status,result")
    .eq("organization_id", access.organizationId).eq("person_id", personId).eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingResult.error) throw new Error(`load approved update command: ${existingResult.error.message}`);
  let command = existingResult.data as { id: string; payload_hash: string; status: string; result: Json } | null;
  if (command) {
    if (command.payload_hash !== payloadHash) throw new Error("Idempotency key was already used for a different update");
    if (command.status !== "processing") return command.result;
    const { error } = await commands.update({ status: "needs_attention", result: { status: "needs_attention", message: "The previous attempt ended while a provider write was in progress. Review it before retrying." }, updated_at: new Date().toISOString() }).eq("id", command.id);
    if (error) throw new Error(`mark ambiguous approved update: ${error.message}`);
    return { status: "needs_attention", message: "A previous provider write may have completed. Review the task list before retrying." };
  }
  const created = await commands.insert({ organization_id: access.organizationId, person_id: personId, idempotency_key: idempotencyKey, payload_hash: payloadHash, status: "processing" }).select("id").single();
  if (created.error) throw new Error(`create approved update command: ${created.error.message}`);
  command = { id: created.data.id as string, payload_hash: payloadHash, status: "processing", result: {} };

  const results: Json[] = [];
  for (const [index, operation] of operations.entries()) {
    const operationRow = await db().from("work_companion_command_operations").insert({ command_id: command.id, operation_index: index, status: "processing" }).select("id").single();
    if (operationRow.error) throw new Error(`start approved update operation: ${operationRow.error.message}`);
    try {
      let result: Json;
      if (operation.op === "complete_task" || operation.op === "reopen_task") result = await setWorkOsEmployeeTaskCompletion(access, operation.taskId as string, operation.op === "complete_task") as Json;
      else if (operation.op === "create_task") result = { task: await createWorkOsEmployeeTask(access, { name: operation.taskTitle ?? operation.statement.slice(0, 240), description: operation.statement, due_date: payload.shiftDate, assignee_person_ids: [personId] }) };
      else result = await createWorkOsCheckIn(access, { source: "desktop", kind: "optional", update_kind: operation.op === "record_blocker" ? "blocked" : "material_progress", input_text: operation.statement, structured_claims: { originalInput, taskId: operation.taskId ?? null, approvedOperation: operation.op }, client_request_id: `${idempotencyKey}:${index}` }) as Json;
      const { error } = await db().from("work_companion_command_operations").update({ status: "succeeded", result, updated_at: new Date().toISOString() }).eq("id", operationRow.data.id);
      if (error) throw new Error(`complete approved update operation: ${error.message}`);
      results.push({ operation: operation.op, status: "confirmed" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider write failed";
      await db().from("work_companion_command_operations").update({ status: "needs_attention", result: { message }, updated_at: new Date().toISOString() }).eq("id", operationRow.data.id);
      const result = { status: "needs_attention", message: "One approved update needs review before retrying.", operations: results };
      await commands.update({ status: "needs_attention", result, updated_at: new Date().toISOString() }).eq("id", command.id);
      return result;
    }
  }
  const result = { status: "confirmed", operations: results };
  const { error } = await commands.update({ status: "succeeded", result, updated_at: new Date().toISOString() }).eq("id", command.id);
  if (error) throw new Error(`complete approved update command: ${error.message}`);
  return result;
}
