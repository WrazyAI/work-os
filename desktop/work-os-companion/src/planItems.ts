import type { PlanningInterpretation } from "./PlanningSession";

/** Minimal server plan-item shape shared by the main window and the companion. */
export type ServerPlanItem = {
  id: string;
  task_id: string | null;
  title_snapshot: string;
  disposition: string;
  item_kind: string;
  completion_state: string;
};

/** Merges the AI-drafted commitments onto the server plan items: linked
 * commitments enrich their Nifty task item, unlinked commitments become new
 * outcome items. Used by both the planning modal and the chat agenda flow so
 * the drafted list survives the save. */
export function buildPlanItemsFromInterpretation(
  planItems: ServerPlanItem[],
  interpretation: PlanningInterpretation,
  answers: Record<string, string>,
): Array<Record<string, unknown>> {
  const commitmentByTask = new Map(interpretation.commitments.filter((item) => item.linkedTaskId).map((item) => [item.linkedTaskId!, item]));
  const clarificationState = (commitment: PlanningInterpretation["commitments"][number]) => {
    const questions = interpretation.clarifications.filter((question) => question.commitmentId === commitment.clientId);
    return questions.length ? questions.every((question) => answers[question.id]?.trim()) ? "resolved" : "needs_clarification" : "none";
  };
  const items: Array<Record<string, unknown>> = planItems.map((item) => {
    const commitment = item.task_id ? commitmentByTask.get(item.task_id) : undefined;
    return {
      id: item.id, task_id: item.task_id, title_snapshot: item.title_snapshot, disposition: item.disposition,
      item_kind: item.item_kind, completion_state: item.completion_state,
      ...(commitment ? { objective: commitment.objective, success_criteria: commitment.successCriteria, estimate_minutes: commitment.estimatedMinutes, source_refs: commitment.sourceRefs, clarification_state: clarificationState(commitment) } : {}),
    };
  });
  for (const commitment of interpretation.commitments) {
    if (commitment.linkedTaskId) continue;
    items.push({ id: "", task_id: null, title_snapshot: commitment.title, disposition: "selected", item_kind: "outcome", completion_state: "open", objective: commitment.objective, success_criteria: commitment.successCriteria, estimate_minutes: commitment.estimatedMinutes, source_refs: commitment.sourceRefs, clarification_state: clarificationState(commitment) });
  }
  return items;
}
