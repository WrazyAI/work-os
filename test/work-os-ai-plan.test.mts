import assert from "node:assert/strict";
import test from "node:test";
import { buildPlanningPrompt, parsePlanInterpretation } from "../src/lib/aiPlan";

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
