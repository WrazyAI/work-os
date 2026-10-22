import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanRefinePrompt, buildPlanningPrompt, LOOM_ONLY_PLAN_INTENT, parsePlanInterpretation, resolvePlanIntent } from "../src/lib/aiPlan";

const context = {
  date: "2026-09-04",
  todayTasks: [{ id: "task-1", title: "Work OS migration", description: null, dueDate: "2026-09-04", status: "Open", blockedReason: null }],
  carryOver: [],
  previousPlan: null,
  activeBlockers: [],
  recentUpdates: [],
};

test("planning interpretation preserves bounded commitments and server-known task references", () => {
  const plan = parsePlanInterpretation({
    summary: "Get the migration ready for review.",
    commitments: [{
      clientId: "migration", linkedTaskId: "task-1", title: "Work OS migration", objective: "Get the current change ready for review.",
      successCriteria: ["Known review blockers are addressed"], estimatedMinutes: 90, confidence: 0.9,
    }],
    clarifications: [],
  }, "Continue Work OS migration.", context);
  assert.equal(plan?.readiness, "ready");
  assert.equal(plan?.commitments[0]?.linkedTaskId, "task-1");
  assert.deepEqual(plan?.commitments[0]?.sourceRefs, [{ provider: "work_os", type: "task", id: "task-1", label: "Work OS migration" }]);
});

test("planning interpretation rejects hallucinated task links and caps clarifications", () => {
  const plan = parsePlanInterpretation({
    summary: "Clarify the target.",
    commitments: [{ clientId: "loom", linkedTaskId: "invented", title: "Launch Loom", objective: "Define today's launch milestone.", successCriteria: [], confidence: 0.3 }],
    clarifications: [
      { id: "one", commitmentId: "loom", question: "Does launch mean production deployment or release preparation?", reason: "missing_outcome" },
      { id: "two", commitmentId: "loom", question: "Which release is in scope?", reason: "ambiguous_scope" },
      { id: "three", commitmentId: "loom", question: "This must not surface.", reason: "unclear_task_match" },
    ],
  }, "Launch Loom.", context);
  assert.equal(plan?.commitments[0]?.linkedTaskId, undefined);
  assert.deepEqual(plan?.commitments[0]?.sourceRefs, [{ provider: "employee", type: "intent", id: "raw_intent", label: "Employee planning input" }]);
  assert.equal(plan?.clarifications.length, 2);
  assert.equal(plan?.readiness, "needs_multiple_clarifications");
});

test("includes bounded GitHub evidence as context but not a linkable task source", () => {
  const prompt = buildPlanningPrompt("Prepare the release.", { ...context, githubEvidence: [{ title: "Pull request merged: release prep", summary: "PR #42 was merged.", url: "https://github.com/example/repo/pull/42", date: "2026-09-04" }] }, []);
  assert.match(prompt, /Pull request merged: release prep/);
  assert.match(prompt, /Only link a task using an id from the supplied context/);
});

test("planning prompt embeds live snapshot and recalled memory only when provided", () => {
  const plain = buildPlanningPrompt("Prepare the release.", context, []);
  assert.doesNotMatch(plain, /todayContext|memoryContext|same-day tentative context/);
  const enriched = buildPlanningPrompt("Prepare the release.", context, [], {
    todayBlock: "Today so far (2026-09-14) — live facts:\n- Shift: on shift",
    memoryBlock: "Recalled history (dated context, not current facts):\n- [2026-09-10 · task_event] Closed the migration task",
  });
  assert.match(enriched, /todayContext/);
  assert.match(enriched, /memoryContext/);
  assert.match(enriched, /Shift: on shift/);
  assert.match(enriched, /same-day tentative context awaiting review/);
  assert.match(enriched, /never as evidence of completion/);
});

test("a Loom attachment can supply the planning intent", () => {
  const loom = { verdict: "same_day", createdLocalDate: "2026-09-04", targetDate: "2026-09-04", line: "Daily update", summary: "The recording describes the release work.", suggestedTasks: [], cautions: [], blocked: false };
  assert.equal(resolvePlanIntent("", loom), LOOM_ONLY_PLAN_INTENT);
  assert.equal(resolvePlanIntent("Write a plan.", loom), "Write a plan.");
  assert.equal(resolvePlanIntent("", undefined), null);
});

test("the plan summary states the day's focus, never the input's provenance", () => {
  const prompt = buildPlanningPrompt("", context, [], undefined, {
    verdict: "unknown",
    createdLocalDate: null,
    targetDate: "2026-10-22",
    line: "Loom transcript pasted by the employee (no recording link)",
    summary: "The employee wants to resume the template work.",
    suggestedTasks: [],
    cautions: ["No recording link was provided; the date is unverified."],
    blocked: false,
  });
  assert.match(prompt, /summary.*day's focus/);
  assert.match(prompt, /never mention the Loom, transcript, recording/);
  assert.match(prompt, /one or two sentences on today's focus/);
  assert.match(prompt, /never copy them into the summary or commitments/);
  const refine = buildPlanRefinePrompt(
    "Prepare the release.",
    { summary: "Focus on the release.", commitments: [] },
    [],
    [],
    context,
  );
  assert.match(refine, /never add provenance/);
});
