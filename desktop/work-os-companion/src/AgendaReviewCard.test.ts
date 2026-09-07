import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgendaReviewCard } from "./AgendaReviewCard";

const clarifications = [
  { id: "q1", question: "What part of WorkOS?" },
  { id: "q2", question: "What does done look like?" },
];
const noop = () => undefined;
const handlers = { onAnswers: noop, onSend: noop, onSkip: noop, onCancel: noop };

describe("AgendaReviewCard", () => {
  it("asks each follow-up with labeled inputs and gates sending on answers", () => {
    const fresh = renderToStaticMarkup(
      createElement(AgendaReviewCard, { clarifications, answers: {}, busy: false, ...handlers }),
    );
    expect(fresh).toContain("What part of WorkOS?");
    expect(fresh).toContain('aria-label="What does done look like?"');
    expect(fresh).toContain("Skip &amp; confirm");
    expect(fresh).toContain("disabled");

    const answered = renderToStaticMarkup(
      createElement(AgendaReviewCard, {
        clarifications, answers: { q1: "The avatar flow" }, busy: false, ...handlers,
      }),
    );
    expect(answered).toContain('value="The avatar flow"');
  });

  it("confirms readiness once every question is answered", () => {
    const markup = renderToStaticMarkup(
      createElement(AgendaReviewCard, {
        clarifications, answers: { q1: "The avatar flow", q2: "Agenda review ships" }, busy: false, ...handlers,
      }),
    );
    expect(markup).toContain("ready to confirm your agenda");
  });

  it("disables every action while busy", () => {
    const markup = renderToStaticMarkup(
      createElement(AgendaReviewCard, { clarifications, answers: { q1: "x" }, busy: true, ...handlers }),
    );
    expect(markup.match(/disabled/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
