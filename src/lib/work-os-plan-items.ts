import { createAdminClient } from "@/lib/supabase/admin";

/** Keeps the persisted commitment state of plan items aligned with the task
 * record.
 *
 * Plan items snapshot what an employee committed to on a given day. Their
 * `completion_state` is what the commitment metrics read, but nothing used to
 * advance it after the plan was saved — a task completed later left its plan
 * item open forever, so commitment rate always read zero. The task record is
 * authoritative: completing a task completes its selected plan items, and
 * reopening it reopens them. Items manually completed through the plan surface
 * stay completed unless their task is explicitly reopened.
 */

export interface PlanItemCompletionCandidate {
  id: string;
  completion_state?: string | null;
}

/** The items whose stored state differs from the state the task implies. */
export function planItemCompletionTargets(items: PlanItemCompletionCandidate[], completed: boolean): string[] {
  const target = completed ? "completed" : "open";
  return items
    .filter((item) => String(item.completion_state ?? "open") !== target)
    .map((item) => String(item.id));
}

export async function syncPlanItemCompletion(input: {
  organizationId: string;
  /** Local work_tasks.id the plan items reference. */
  taskId: string;
  completed: boolean;
  completedAt?: string | null;
  /** Narrows the sync to one person's plan when the actor is known. */
  personId?: string | null;
}): Promise<{ updated: number }> {
  const db = createAdminClient();
  const query = db
    .from("work_daily_plan_items")
    .select("id,completion_state")
    .eq("organization_id", input.organizationId)
    .eq("task_id", input.taskId)
    .eq("disposition", "selected")
    .limit(200);
  const { data, error } = await (input.personId ? query.eq("person_id", input.personId) : query);
  if (error) throw new Error(`load plan items for task completion: ${error.message}`);
  const ids = planItemCompletionTargets((data ?? []) as PlanItemCompletionCandidate[], input.completed);
  if (!ids.length) return { updated: 0 };
  const { error: updateError } = await db
    .from("work_daily_plan_items")
    .update({
      completion_state: input.completed ? "completed" : "open",
      completed_at: input.completed ? input.completedAt ?? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
  if (updateError) throw new Error(`sync plan item completion: ${updateError.message}`);
  return { updated: ids.length };
}
