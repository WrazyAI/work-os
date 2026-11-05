import { db } from "@/lib/work-os-internal";
import {
  isEmployeeAttachedEvidence,
  taskEvidenceFromRow,
  type TaskEvidenceRecord,
} from "@/modules/work-os/completion-evidence";

/** One task's employee-attached completion evidence, ready for a task row or
 * its detail drawer. The task id is kept beside the record so a list read can
 * group one bounded query without inventing a second evidence shape. */
export type TaskCompletionEvidence = {
  taskId: string;
  evidence: TaskEvidenceRecord;
};

/** The one projection the task row and its drawer share: only employee-attached
 * completion files survive, and every record keeps the task it belongs to. */
export function taskCompletionEvidenceFromRows(rows: Array<Record<string, unknown>>): TaskCompletionEvidence[] {
  return rows
    .filter(isEmployeeAttachedEvidence)
    .map((row) => ({
      taskId: String(row.task_id ?? ""),
      evidence: taskEvidenceFromRow(row),
    }))
    .filter((row) => row.taskId);
}

/** Loads employee-attached completion evidence for a bounded set of tasks.
 * Provider evidence and other task-scoped evidence stay out: this is the file
 * an employee attached to the completion record, not a screenshot or a claim. */
export async function loadTaskCompletionEvidence(
  organizationId: string,
  taskIds: string[],
  limit = 1000,
): Promise<TaskCompletionEvidence[]> {
  const unique = [...new Set(taskIds.map((taskId) => String(taskId ?? "").trim()).filter(Boolean))];
  if (!unique.length) return [];
  const result = await db().from("work_evidence")
    .select("id,task_id,title,summary,source,metrics,created_at")
    .eq("organization_id", organizationId)
    .in("task_id", unique)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(2000, Math.floor(limit))));
  if (result.error) throw new Error(`load task completion evidence: ${result.error.message}`);
  return taskCompletionEvidenceFromRows((result.data ?? []) as Array<Record<string, unknown>>);
}
