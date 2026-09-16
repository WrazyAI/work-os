import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInsightGroundingText,
  buildInsightSynthesisPrompt,
  composeInsightNarrative,
  normalizeInsightNarrative,
  normalizeInsightSelection,
  normalizeNarrativeSection,
  normalizeSynthesis,
  numbersGroundedIn,
  renderInsightSelection,
} from "../src/lib/aiInsights";

const DATA = {
  range: "7d" as const, from: "2026-08-21", through: "2026-08-27",
  summary: "A steady week.", wins: ["Shipped the debugger fix"], attention: ["Packaging blocked"], nextFocus: ["Finish the release"],
  totals: { observedSeconds: 18000, planned: 10, plannedCompleted: 7, tasksCompleted: 5, outputEvidence: 3, outcomesOnTime: 4, outcomesLate: 1 },
  days: [{ date: "2026-08-27", observedSeconds: 3600, planned: 2, plannedCompleted: 1, tasksCompleted: 1, trackedMinutes: 45 }],
  updateKinds: { progress: 6, starting: 1, completionClaim: 2, blocked: 2, priorityChange: 1, unplannedWork: 1 },
  consistency: { dayCount: 7, daysWithGoal: 6, daysWithUpdate: 5, daysWithCompletion: 4, currentStreak: 3, commitmentRate: 70, bestDay: { date: "2026-08-25", tasksCompleted: 3 } },
  previousTotals: { observedSeconds: 14400, planned: 8, plannedCompleted: 4, tasksCompleted: 3, outcomesOnTime: 2, outcomesLate: 2 },
};

test("the prompt grounds the model in exact values, hrs/mins durations, and the narrative rules", () => {
  const prompt = buildInsightSynthesisPrompt(DATA);
  assert.match(prompt, /5h observed/);
  assert.match(prompt, /7\/10 planned tasks completed/);
  assert.match(prompt, /Shipped the debugger fix/);
  assert.match(prompt, /never invent/i);
  assert.match(prompt, /2026-08-27: 1h observed, 45m tracked activity context, 1\/2 planned tasks done/);
  assert.match(prompt, /4 outcomes on time, 1 outcomes late/);
  assert.match(prompt, /2 blockers/);
  assert.match(prompt, /6\/7 days with a written goal/);
  assert.match(prompt, /Earlier equal period: 3 Nifty outcomes, 4h observed/);
  assert.match(prompt, /never use decimal hours such as 2\.8h/i);
  assert.match(prompt, /bold the most important figure/i);
  assert.match(prompt, /short paragraph/i);
  assert.match(prompt, /Return ONLY JSON with highlight, attention, focus/i);
});

test("the grounding text never emits decimal hours", () => {
  const grounding = buildInsightGroundingText({ ...DATA, totals: { ...DATA.totals, observedSeconds: 10080 } });
  assert.match(grounding, /2h 48m observed/);
  assert.doesNotMatch(grounding, /\d+\.\d+\s*h/);
});

test("normalizes synthesis to bounded plain prose and rejects junk", () => {
  assert.equal(normalizeSynthesis("  A calm, honest summary of the week.  "), "A calm, honest summary of the week.");
  assert.equal(normalizeSynthesis("short"), null);
  assert.equal(normalizeSynthesis(42), null);
  assert.ok(normalizeSynthesis("x".repeat(5000))!.length <= 1200);
});

test("accepts synthesis numbers that trace to the grounding record", () => {
  const grounding = "Totals: 2h 48m observed, 2/3 planned tasks completed, 1 Nifty outcomes. - 2026-08-27: 2h 48m observed, 2/3 planned tasks done, 1 Nifty outcomes";
  assert.equal(numbersGroundedIn("You completed 2 of 3 planned tasks over 2h 48m.", grounding), true);
});

test("rejects invented figures absent from the grounding record", () => {
  const grounding = "Totals: 2/3 planned tasks completed, 1 Nifty outcomes";
  assert.equal(numbersGroundedIn("You completed 2 of 47 planned tasks across 12 days.", grounding), false);
});

test("does not accept an invented count because its digit appears inside a date", () => {
  const grounding = "Daily record: 2026-08-05: 0/0 planned tasks done, 0 Nifty outcomes";
  assert.equal(numbersGroundedIn("You completed 5 tasks.", grounding), false);
});

test("narrative sections reject decimal hours, junk, and over-long text", () => {
  assert.equal(normalizeNarrativeSection("Activity moved **up 2h 48m** against the earlier week."), "Activity moved **up 2h 48m** against the earlier week.");
  assert.equal(normalizeNarrativeSection("Activity moved **up 2.8h** against the earlier week."), null);
  assert.equal(normalizeNarrativeSection("too short"), null);
  assert.equal(normalizeNarrativeSection(12), null);
  assert.equal(normalizeNarrativeSection("word ".repeat(120)), null);
  assert.deepEqual(normalizeInsightNarrative({ highlight: "x".repeat(30), attention: "y".repeat(30), focus: "z".repeat(30) }), {
    highlight: "x".repeat(30), attention: "y".repeat(30), focus: "z".repeat(30),
  });
  assert.equal(normalizeInsightNarrative({ highlight: "x".repeat(30), attention: "y".repeat(30) }), null);
});

test("composes validated prose under bold section labels with short paragraphs", () => {
  const markdown = composeInsightNarrative({
    highlight: "**85 outcomes** completed, up from 38 in the earlier period.",
    attention: "12 outcomes landed after their due dates.",
    focus: "Rebalance the overdue work.",
  });
  const lines = markdown.split("\n");
  for (const label of ["**What went well**", "**Needs attention**", "**Next focus**"]) assert.ok(lines.includes(label), label);
  assert.ok(lines.indexOf("**What went well**") < lines.indexOf("**Needs attention**"));
  assert.ok(lines.indexOf("**Needs attention**") < lines.indexOf("**Next focus**"));
  assert.equal(lines[1], "");
  assert.equal(lines[2], "**85 outcomes** completed, up from 38 in the earlier period.");
  assert.equal(lines[3], "");
  assert.match(markdown, /\*\*85 outcomes\*\* completed/);
});

test("renders the evidence fallback from selected, record-bound facts as markdown", () => {
  const selection = normalizeInsightSelection({ winIds: ["win:0"], attentionIds: ["attention:0", "attention:9"], nextFocusIds: ["focus:0"] }, DATA);
  assert.deepEqual(selection, { winIds: ["win:0"], attentionIds: ["attention:0"], nextFocusIds: ["focus:0"] });
  const synthesis = renderInsightSelection(selection!, DATA);
  assert.match(synthesis, /^\*\*What went well\*\*/);
  assert.match(synthesis, /\n\n\*\*Needs attention\*\*\n\n/);
  assert.match(synthesis, /Shipped the debugger fix/);
  assert.match(synthesis, /Packaging blocked/);
  assert.doesNotMatch(synthesis, /attention:9/);
});

test("rejects malformed Insight selections instead of model prose", () => {
  assert.equal(normalizeInsightSelection("A polished narrative", DATA), null);
  assert.equal(normalizeInsightSelection({ winIds: "win:0" }, DATA), null);
});
