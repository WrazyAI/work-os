/** Reads the assistant's read-only task view out of a tool result.
 *
 * Only display-tool results carry a selection, and the payload must contain a
 * real `tasks` array. Recorded mutations also carry a `provider_result` object
 * on their server row (`work_task_proposals.provider_result` is jsonb with a
 * `{}` default), so a bare truthy `provider_result` must never count as a card:
 * that rendered an empty "No pending tasks" card after every recorded action
 * and looked like the employee's list had emptied (design §25.9). */

export interface TaskSelectionPayload {
  view: "pending" | "overdue";
  tasks: Array<Record<string, unknown>>;
}

export function taskSelectionFromResult(result: { op?: { op?: unknown }; data?: unknown } | null | undefined): TaskSelectionPayload | null {
  // Mutation payloads can also contain a provider task array. Only the two
  // explicit read-only operations are allowed to become an inline task card.
  if (result?.op && result.op.op !== "display_pending_tasks" && result.op.op !== "display_overdue_tasks") return null;
  const provider = (result?.data as { provider_result?: { view?: unknown; tasks?: unknown } } | undefined)?.provider_result;
  if (!provider || !Array.isArray(provider.tasks)) return null;
  return {
    view: provider.view === "overdue" ? "overdue" : "pending",
    tasks: provider.tasks as Array<Record<string, unknown>>,
  };
}
