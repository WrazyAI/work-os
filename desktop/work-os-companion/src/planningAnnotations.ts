/** Pure helpers for the Plan-your-day annotation/refine loop.
 * Kept free of JSX so the logic is unit-testable; PlanningSession.tsx owns rendering. */

export type PlanAnnotation = {
  id: string;
  /** "summary" | `title:<clientId>` | `objective:<clientId>` | `criterion:<clientId>:<index>` */
  target: string;
  /** Exact selected text the feedback refers to (whitespace-collapsed, capped). */
  quote: string;
  /** Employee feedback on the selection. */
  comment: string;
};

export type PlanDraftEdit = {
  clientId: string;
  title?: string;
  objective?: string;
  successCriteria?: string[];
};

export type EditableCommitment = {
  clientId: string;
  title: string;
  objective: string;
  successCriteria: string[];
};

export const MAX_ANNOTATION_QUOTE = 500;
export const MIN_ANNOTATION_COMMENT = 3;
export const MAX_ANNOTATION_COMMENT = 1_000;

export function sanitizeQuote(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_ANNOTATION_QUOTE);
}

export function sanitizeComment(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_ANNOTATION_COMMENT);
}

export function isAnnotationCommentValid(comment: string): boolean {
  const clean = comment.trim();
  return clean.length >= MIN_ANNOTATION_COMMENT && clean.length <= MAX_ANNOTATION_COMMENT;
}

/** Applies committed field edits onto a draft commitment list, preserving all other fields. */
export function applyEditsToCommitments<C extends EditableCommitment>(
  commitments: readonly C[],
  edited: Record<string, { title: string; objective: string; successCriteria: string[] }>,
): C[] {
  return commitments.map((commitment) => {
    const edit = edited[commitment.clientId];
    return edit ? { ...commitment, title: edit.title, objective: edit.objective, successCriteria: edit.successCriteria } : commitment;
  });
}

function sameCriteria(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

/** Builds the minimal refine payload: only fields that actually changed. */
export function diffEditedCommitments(
  draft: readonly EditableCommitment[],
  edited: Record<string, { title: string; objective: string; successCriteria: string[] }>,
): PlanDraftEdit[] {
  const result: PlanDraftEdit[] = [];
  for (const commitment of draft) {
    const edit = edited[commitment.clientId];
    if (!edit) continue;
    const title = edit.title.trim();
    const objective = edit.objective.trim();
    const successCriteria = edit.successCriteria.map((item) => item.trim()).filter(Boolean);
    const changed: PlanDraftEdit = { clientId: commitment.clientId };
    if (title && title !== commitment.title) changed.title = title;
    if (objective && objective !== commitment.objective) changed.objective = objective;
    if (!sameCriteria(successCriteria, commitment.successCriteria)) changed.successCriteria = successCriteria;
    if (changed.title !== undefined || changed.objective !== undefined || changed.successCriteria !== undefined) {
      result.push(changed);
    }
  }
  return result;
}

/** Parses a criteria textarea (one criterion per line) into a clean list. */
export function parseCriteriaLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Annotations attached to one commitment (title/objective/criteria targets embed the clientId). */
export function countAnnotationsForCommitment(annotations: readonly PlanAnnotation[], clientId: string): number {
  return annotations.filter((annotation) => annotation.target !== "summary" && annotation.target.includes(clientId)).length;
}

/** Annotations attached to one exact annotated element (summary heading, title, objective, criterion). */
export function annotationsForTarget(annotations: readonly PlanAnnotation[], target: string): PlanAnnotation[] {
  return annotations.filter((annotation) => annotation.target === target);
}
