/** Plan-builder model shared with the companion's planning session.
 *
 * The interpretation contract and the server-plan merge are a faithful port of
 * `desktop/work-os-companion/src/planItems.ts` + `PlanningSession.tsx` types so
 * the web builder persists exactly the same plan shape the companion does. */

import type { AnyRow } from "./model";

export type PlanningView = "compose" | "review";

export interface PlanSourceRef {
  provider: string;
  type: string;
  id: string;
  label?: string;
}

export interface PlanCommitment {
  clientId: string;
  linkedTaskId?: string;
  title: string;
  objective: string;
  successCriteria: string[];
  dependency?: string;
  blocker?: string;
  estimatedMinutes?: number;
  sourceRefs: PlanSourceRef[];
  confidence: number;
}

export interface PlanClarification {
  id: string;
  commitmentId?: string;
  question: string;
  reason: string;
}

export interface PlanningInterpretation {
  buildId?: string;
  rawIntent: string;
  summary: string;
  commitments: PlanCommitment[];
  clarifications: PlanClarification[];
  readiness: "ready" | "needs_one_clarification" | "needs_multiple_clarifications";
}

export interface PlanDraftEdit {
  clientId: string;
  title?: string;
  objective?: string;
  successCriteria?: string[];
}

export const LOOM_ONLY_PLAN_INTENT = "Use the attached Loom recording to build today's plan.";

type ServerPlanItem = {
  id: string;
  task_id: string | null;
  title_snapshot: string;
  disposition: string;
  item_kind: string;
  completion_state: string;
};

/** Applies the employee's inline edits to a draft before refining or saving. */
export function applyCommitmentEdits(
  interpretation: PlanningInterpretation,
  edits: Record<string, { title?: string; objective?: string; successCriteria?: string[] }>,
): PlanningInterpretation {
  if (!Object.keys(edits).length) return interpretation;
  return {
    ...interpretation,
    commitments: interpretation.commitments.map((commitment) => {
      const edit = edits[commitment.clientId];
      if (!edit) return commitment;
      return {
        ...commitment,
        title: edit.title?.trim() ? edit.title.trim() : commitment.title,
        objective: edit.objective !== undefined ? edit.objective.trim() : commitment.objective,
        successCriteria: edit.successCriteria ?? commitment.successCriteria,
      };
    }),
  };
}

/** Merges the AI-drafted commitments onto the server plan items: linked
 * commitments enrich their task item, unlinked commitments become new outcome
 * items. Identical to the companion's merge so both clients save one shape. */
export function buildPlanItemsFromInterpretation(
  planItems: Array<Partial<ServerPlanItem> & Record<string, unknown>>,
  interpretation: PlanningInterpretation,
  answers: Record<string, string>,
): Array<Record<string, unknown>> {
  const commitmentByTask = new Map(interpretation.commitments.filter((item) => item.linkedTaskId).map((item) => [item.linkedTaskId!, item]));
  const clarificationState = (commitment: PlanCommitment) => {
    const questions = interpretation.clarifications.filter((question) => question.commitmentId === commitment.clientId);
    return questions.length ? questions.every((question) => answers[question.id]?.trim()) ? "resolved" : "needs_clarification" : "none";
  };
  const items: Array<Record<string, unknown>> = planItems.map((item) => {
    const taskId = typeof item.task_id === "string" && item.task_id ? item.task_id : null;
    const commitment = taskId ? commitmentByTask.get(taskId) : undefined;
    return {
      id: String(item.id ?? ""),
      task_id: taskId,
      title_snapshot: String(item.title_snapshot ?? ""),
      disposition: String(item.disposition ?? "selected"),
      item_kind: String(item.item_kind ?? "task"),
      completion_state: String(item.completion_state ?? "open"),
      ...(commitment ? { objective: commitment.objective, success_criteria: commitment.successCriteria, estimate_minutes: commitment.estimatedMinutes, source_refs: commitment.sourceRefs, clarification_state: clarificationState(commitment) } : {}),
    };
  });
  for (const commitment of interpretation.commitments) {
    if (commitment.linkedTaskId) continue;
    items.push({ id: "", task_id: null, title_snapshot: commitment.title, disposition: "selected", item_kind: "outcome", completion_state: "open", objective: commitment.objective, success_criteria: commitment.successCriteria, estimate_minutes: commitment.estimatedMinutes, source_refs: commitment.sourceRefs, clarification_state: clarificationState(commitment) });
  }
  return items;
}

/** The interpret/refine responses both carry the draft plus its build id. */
export function interpretationFromResponse(response: { interpretation: PlanningInterpretation; build_id?: string } | null | undefined): PlanningInterpretation | null {
  if (!response?.interpretation) return null;
  return { ...response.interpretation, buildId: response.build_id ?? response.interpretation.buildId };
}

/** Human plan status line for the focus panel. */
export function planStatusLabel(plan: AnyRow | null | undefined): string {
  if (!plan) return "No plan yet";
  const status = String(plan.status ?? "draft");
  const items = Array.isArray(plan.items) ? plan.items.length : 0;
  const label = status === "confirmed" ? "Plan confirmed" : status === "closed" ? "Plan closed" : "Plan draft";
  return items ? `${label} · ${items} commitment${items === 1 ? "" : "s"}` : label;
}
