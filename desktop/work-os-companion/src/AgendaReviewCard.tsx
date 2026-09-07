import { unansweredQuestions, type AgendaAnswers } from "./avatarAgenda";

export interface AgendaReviewQuestion {
  id: string;
  question: string;
}

/** Follow-up questions for an agenda under review. Answers are collected
 * verbatim — the employee's original wording is never rewritten. */
export function AgendaReviewCard({
  clarifications,
  answers,
  onAnswers,
  onSend,
  onSkip,
  onCancel,
  busy,
}: {
  clarifications: AgendaReviewQuestion[];
  answers: AgendaAnswers;
  onAnswers: (answers: AgendaAnswers) => void;
  onSend: () => void;
  onSkip: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  const unanswered = unansweredQuestions(clarifications, answers);
  return (
    <div className="agenda-review-card" role="group" aria-label="Agenda follow-up questions">
      <strong>
        {unanswered.length === 0 ? "Thanks — ready to confirm your agenda." : "Answer so your agenda is specific:"}
      </strong>
      {clarifications.map((question) => (
        <label key={question.id} className="agenda-review-question">
          <span>{question.question}</span>
          <input
            value={answers[question.id] ?? ""}
            maxLength={1000}
            onChange={(event) => onAnswers({ ...answers, [question.id]: event.target.value })}
            placeholder="Your answer…"
            aria-label={question.question}
          />
        </label>
      ))}
      <div className="agenda-review-actions">
        <button
          type="button"
          className="agenda-review-send"
          disabled={busy || unanswered.length === clarifications.length}
          onClick={onSend}
        >
          Send answers
        </button>
        <button type="button" className="agenda-review-skip" disabled={busy} onClick={onSkip}>
          Skip & confirm
        </button>
        <button type="button" className="agenda-review-cancel" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
