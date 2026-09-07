import { describe, expect, it } from "vitest";
import { agendaReceipt, applicableAnswers, unansweredQuestions, withAnswerRound } from "./avatarAgenda";

const clarifications = [
  { id: "q1", question: "What part of WorkOS?", reason: "ambiguous_scope" },
  { id: "q2", question: "What does done look like?", reason: "missing_completion_criteria" },
];

describe("avatar agenda helpers", () => {
  it("finds only the questions still needing answers", () => {
    expect(unansweredQuestions(clarifications, { q1: "The avatar flow" })).toEqual([clarifications[1]]);
    expect(unansweredQuestions(clarifications, {})).toHaveLength(2);
  });

  it("appends an answer round without rewriting intent", () => {
    const conversation = [{ role: "user" as const, text: "Working on WorkOS today" }];
    const next = withAnswerRound(conversation, clarifications, { q1: "The avatar flow" });
    expect(next[0]).toEqual({ role: "user", text: "Working on WorkOS today" });
    expect(next.slice(-2)).toEqual([
      { role: "assistant", text: "What part of WorkOS?" },
      { role: "user", text: "The avatar flow" },
    ]);
  });

  it("drops answers to stale question ids before confirming", () => {
    const next = [
      { id: "q1", question: "What part of WorkOS?" },
      { id: "q3", question: "Who is blocked?" },
    ];
    expect(applicableAnswers(next, { q1: "The avatar flow", q2: "Done means shipped", empty: "  " })).toEqual({
      q1: "The avatar flow",
    });
  });

  it("names the actual review outcome in receipts", () => {
    expect(agendaReceipt({ rounds: 1, answered: 0, asked: 0, reviewed: true })).toMatch(/No follow-ups/);
    expect(agendaReceipt({ rounds: 1, answered: 0, asked: 2, reviewed: true })).toMatch(/skipped/);
    expect(agendaReceipt({ rounds: 2, answered: 1, asked: 2, reviewed: true })).toMatch(/1 follow-up answer\./);
    expect(agendaReceipt({ rounds: 0, answered: 0, asked: 0, reviewed: false })).toBe("Agenda confirmed");
  });
});
