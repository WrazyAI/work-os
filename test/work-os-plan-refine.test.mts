import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanRefinePrompt, refinePlanDraft } from "../src/lib/aiPlan";

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
