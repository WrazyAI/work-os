import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGoalSuggestionPrompt, MAX_GOAL_CHARS, parseGoalSuggestion } from "../src/lib/work-os-goal-suggestion";

const context = {
  date: "2026-10-20",
  priorOpen: ["Reconcile the September settlement", "Send the provider export"],
  createdToday: ["Draft the onboarding note"],
  dueToday: ["Review the intake queue"],
  activity: ["VS Code — an editor shows the settlement reconciliation test", "Chrome — a pull request page"],
};

test("the suggestion prompt carries only the bounded work and activity context", () => {
  const prompt = buildGoalSuggestionPrompt(context);
  assert.match(prompt, /one short sentence/i);
  assert.match(prompt, /Unfinished work from earlier days:/);
  assert.match(prompt, /Reconcile the September settlement/);
  assert.match(prompt, /Work created or due today:/);
  assert.match(prompt, /Draft the onboarding note/);
  assert.match(prompt, /Review the intake queue/);
  assert.match(prompt, /Observed activity in this interval:/);
  assert.match(prompt, /settlement reconciliation test/);
  assert.match(prompt, /Do not claim completion, effort, or quality/);
  assert.match(prompt, /Return only JSON/);
  // The prompt never asks the model to act on the workspace.
  assert.doesNotMatch(prompt, /complete the task/i);
});

test("the suggestion prompt states an empty source instead of inventing one", () => {
  const prompt = buildGoalSuggestionPrompt({ date: "2026-10-20", priorOpen: [], createdToday: [], dueToday: [], activity: [] });
  assert.equal(prompt.match(/- None recorded\./g)?.length, 3);
});

test("a suggested goal is one trimmed, bounded sentence", () => {
  assert.equal(parseGoalSuggestion({ goal: "  Finish the settlement reconciliation, then the intake review.  " }), "Finish the settlement reconciliation, then the intake review.");
  assert.equal(parseGoalSuggestion({ goal: "Line one.\nLine two." }), "Line one. Line two.");
  assert.equal(parseGoalSuggestion({ goal: "x".repeat(400) })?.length, MAX_GOAL_CHARS);
  assert.equal(parseGoalSuggestion({ goal: "   " }), null);
  assert.equal(parseGoalSuggestion({ goal: 42 }), null);
  assert.equal(parseGoalSuggestion(null), null);
  assert.equal(parseGoalSuggestion({}), null);
});
