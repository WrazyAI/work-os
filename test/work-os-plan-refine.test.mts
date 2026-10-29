import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanRefinePrompt, refinePlanDraft, resolveAnsweredClarifications } from "../src/lib/aiPlan";

const context = {
  date: "2026-09-04",
  todayTasks: [{ id: "task-1", title: "Work OS migration", description: null, dueDate: "2026-09-04", status: "Open", blockedReason: null }],
  carryOver: [],
  previousPlan: null,
  activeBlockers: [],
  recentUpdates: [],
};

const draft = {
  summary: "Get the migration ready for review.",
  commitments: [{ clientId: "migration", title: "Work OS migration", objective: "Get the current change ready for review.", successCriteria: ["Known review blockers are addressed"] }],
};

test("refine prompt carries the draft, annotations, and edits for a minimal revision", () => {
  const prompt = JSON.parse(buildPlanRefinePrompt("Ship it.", draft, [{ target: "objective:migration", quote: "ready for review", comment: "Name the reviewer." }], [], context));
  assert.equal(prompt.employeeInput, "Ship it.");
  assert.equal(prompt.currentDraft.summary, draft.summary);
  assert.equal(prompt.annotationFeedback[0]?.comment, "Name the reviewer.");
  assert.ok(Array.isArray(prompt.rules) && prompt.rules.length > 0);
});

test("refine prompt carries answered clarifications and tells the model to resolve them", () => {
  const prompt = JSON.parse(buildPlanRefinePrompt("Ship it.", draft, [], [], context, undefined, [
    { id: "q1", question: "Who reviews it?", answer: "The operations lead", commitmentId: "migration" },
  ]));
  assert.equal(prompt.clarificationAnswers[0]?.answer, "The operations lead");
  assert.ok(prompt.rules.some((rule: string) => /clarificationAnswers/.test(rule)));
  assert.ok(prompt.rules.some((rule: string) => /Do not repeat a question/.test(rule)));
});

test("answered clarifications leave the draft and lower its readiness", () => {
  const parsed = {
    rawIntent: "Ship it.",
    summary: "Get the migration ready.",
    commitments: [],
    clarifications: [
      { id: "q1", question: "Who reviews it?", reason: "ambiguous_scope" as const },
      { id: "q2", question: "What does done mean?", reason: "missing_completion_criteria" as const },
    ],
    readiness: "needs_multiple_clarifications" as const,
  };
  const resolved = resolveAnsweredClarifications(parsed, [{ id: "q1", question: "Who reviews it?", answer: "The operations lead" }]);
  assert.deepEqual(resolved.clarifications.map((question) => question.id), ["q2"]);
  assert.equal(resolved.readiness, "needs_one_clarification");
  assert.equal(resolveAnsweredClarifications(parsed, [{ id: "q1", question: "Who reviews it?", answer: "Ops" }, { id: "q2", question: "What does done mean?", answer: "Reviewed" }]).readiness, "ready");
});

test("refine validation accepts an answer as feedback and rejects stale or empty answers", async () => {
  delete process.env.OPENROUTER_API_KEY;
  const clarifications = [{ id: "q1", question: "Who reviews it?" }];
  const accepted = await refinePlanDraft({ rawIntent: "Ship it.", draft, clarifications, clarificationAnswers: { q1: "The operations lead" } }, context);
  assert.equal(accepted.ok, false);
  if (!accepted.ok) assert.equal(accepted.reason, "ai_unconfigured");

  const stale = await refinePlanDraft({ rawIntent: "Ship it.", draft, clarifications, clarificationAnswers: { q2: "The operations lead" } }, context);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.reason, "ai_malformed");

  const empty = await refinePlanDraft({ rawIntent: "Ship it.", draft, clarifications, clarificationAnswers: { q1: "   " } }, context);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, "ai_malformed");
});

test("refine validation rejects missing input, empty drafts, and feedback-free calls", async () => {
  const noInput = await refinePlanDraft({ rawIntent: "  ", draft, annotations: [{ target: "t", quote: "q", comment: "Fix it." }] }, context);
  assert.equal(noInput.ok, false);
  const noDraft = await refinePlanDraft({ rawIntent: "Ship it.", draft: null, annotations: [{ target: "t", quote: "q", comment: "Fix it." }] }, context);
  assert.equal(noDraft.ok, false);
  if (!noDraft.ok) assert.equal(noDraft.reason, "ai_malformed");
  const noFeedback = await refinePlanDraft({ rawIntent: "Ship it.", draft, annotations: [], edits: [] }, context);
  assert.equal(noFeedback.ok, false);
  if (!noFeedback.ok) assert.equal(noFeedback.reason, "ai_malformed");
});

test("refine drops too-short comments and empty edits before deciding", async () => {
  const result = await refinePlanDraft({
    rawIntent: "Ship it.",
    draft,
    annotations: [{ target: "objective:migration", quote: "review", comment: "x" }],
    edits: [{ clientId: "migration" }],
  }, context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "ai_malformed");
});

test("refine reports unconfigured AI instead of calling a provider", async () => {
  delete process.env.OPENROUTER_API_KEY;
  const result = await refinePlanDraft({
    rawIntent: "Ship it.",
    draft,
    annotations: [{ target: "objective:migration", quote: "ready for review", comment: "Name the reviewer explicitly." }],
  }, context);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "ai_unconfigured");
});

test("refine sends the answers to the provider and drops the resolved questions", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.OPENROUTER_API_KEY = "test-key";
  const captured: { prompt?: string } = {};
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    captured.prompt = body.messages?.[1]?.content;
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: "Get the migration reviewed by the operations lead.",
            commitments: [{
              clientId: "migration",
              title: "Work OS migration",
              objective: "Get the change reviewed by the operations lead.",
              successCriteria: ["Operations lead approved"],
              confidence: 0.9,
            }],
            clarifications: [{ id: "q1", question: "Who reviews it?", reason: "ambiguous_scope" }],
          }),
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  try {
    const result = await refinePlanDraft({
      rawIntent: "Ship it.",
      draft,
      clarifications: [{ id: "q1", question: "Who reviews it?" }],
      clarificationAnswers: { q1: "The operations lead" },
    }, context);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.interpretation.clarifications, []);
      assert.equal(result.interpretation.readiness, "ready");
      assert.match(result.interpretation.commitments[0]?.objective ?? "", /operations lead/);
    }
    const prompt = JSON.parse(captured.prompt ?? "{}");
    assert.equal(prompt.clarificationAnswers?.[0]?.answer, "The operations lead");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
  }
});
