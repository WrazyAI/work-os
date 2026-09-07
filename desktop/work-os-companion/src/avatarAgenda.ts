/** Pure helpers for the avatar's interpret-then-confirm agenda flow.
 * The employee's words are never rewritten; follow-up answers are collected
 * verbatim and sent back as clarification answers alongside the reviewed plan. */

export interface AgendaClarification {
  id: string;
  commitmentId?: string;
  question: string;
  reason?: string;
}

export interface AgendaConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export type AgendaAnswers = Record<string, string>;

/** Questions from the latest interpretation that still need an answer. */
export function unansweredQuestions(
  clarifications: AgendaClarification[],
  answers: AgendaAnswers,
): AgendaClarification[] {
  return clarifications.filter((question) => !answers[question.id]?.trim());
}

/** Keeps only answers that address the latest interpretation's questions.
 * The server rejects answers to stale question ids, so a re-interpretation
 * that rephrases or replaces questions must not carry old ids forward. */
export function applicableAnswers(
  clarifications: AgendaClarification[],
  answers: AgendaAnswers,
): AgendaAnswers {
  const allowed = new Set(clarifications.map((question) => question.id));
  return Object.fromEntries(
    Object.entries(answers).filter(([id, text]) => allowed.has(id) && !!text.trim()),
  );
}

/** Appends one Q&A round to the conversation sent back for re-interpretation,
 * keeping the employee's original intent first. Bounded by the caller. */
export function withAnswerRound(
  conversation: AgendaConversationTurn[],
  clarifications: AgendaClarification[],
  answers: AgendaAnswers,
): AgendaConversationTurn[] {
  const round: AgendaConversationTurn[] = [];
  for (const question of clarifications) {
    const answer = answers[question.id]?.trim();
    if (!answer) continue;
    round.push({ role: "assistant", text: question.question });
    round.push({ role: "user", text: answer });
  }
  return [...conversation, ...round].slice(-8);
}

/** Truthful receipt naming what review actually happened. */
export function agendaReceipt(input: {
  rounds: number;
  answered: number;
  asked: number;
  reviewed: boolean;
}): string {
  if (!input.reviewed) return "Agenda confirmed";
  if (input.asked === 0) return "Today's agenda is set. No follow-ups were needed.";
  if (input.answered === 0) return "Today's agenda is set. You skipped the follow-up questions.";
  return `Today's agenda is set. Reviewed with ${input.answered} follow-up answer${input.answered === 1 ? "" : "s"}.`;
}
