import assert from "node:assert/strict";
import test from "node:test";
import { buildInsightSynthesisPrompt, normalizeSynthesis } from "../src/lib/aiInsights";

const DATA = {
  range: "7d" as const, from: "2026-08-21", through: "2026-08-27",
  summary: "A steady week.", wins: ["Shipped the debugger fix"], attention: ["Packaging blocked"], nextFocus: ["Finish the release"],
  totals: { observedSeconds: 18000, planned: 10, plannedCompleted: 7, tasksCompleted: 5, outputEvidence: 3 },
  days: [{ date: "2026-08-27", observedSeconds: 3600, planned: 2, plannedCompleted: 1, tasksCompleted: 1 }],
};

test("the prompt grounds the model in exact values and forbids invention", () => {
  const prompt = buildInsightSynthesisPrompt(DATA);
  assert.match(prompt, /5h observed/);
  assert.match(prompt, /7\/10 planned tasks completed/);
  assert.match(prompt, /Shipped the debugger fix/);
  assert.match(prompt, /never invent/i);
  assert.match(prompt, /2026-08-27: 1h observed, 1\/2 planned tasks done/);
});

test("normalizes synthesis to bounded plain prose and rejects junk", () => {
  assert.equal(normalizeSynthesis("  A calm, honest summary of the week.  "), "A calm, honest summary of the week.");
  assert.equal(normalizeSynthesis("short"), null);
  assert.equal(normalizeSynthesis(42), null);
  assert.ok(normalizeSynthesis("x".repeat(5000))!.length <= 1200);
});

import { numbersGroundedIn } from "../src/lib/aiInsights";

test("accepts synthesis numbers that trace to the grounding record", () => {
  const grounding = "Totals: 6.2h observed, 2/3 planned tasks completed, 1 Nifty outcomes. - 2026-08-27: 6.2h observed, 2/3 planned tasks done, 1 Nifty outcomes";
  assert.equal(numbersGroundedIn("You completed 2 of 3 planned tasks, with about 6.2h observed.", grounding), true);
});

test("rejects invented figures absent from the grounding record", () => {
  const grounding = "Totals: 2/3 planned tasks completed, 1 Nifty outcomes";
  assert.equal(numbersGroundedIn("You completed 2 of 47 planned tasks across 12 days.", grounding), false);
});
