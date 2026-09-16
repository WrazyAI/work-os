import assert from "node:assert/strict";
import test from "node:test";
import { activityEvidenceRollup, deterministicInsightBrief, effectiveBreakObservation, insightConsistency, insightDateWindow, outcomeTiming, planAdherenceRollup, previousInsightWindow, updateKindRollup } from "../src/lib/work-os-insights";
import { projectWorkspaceDay } from "../src/lib/work-os-daily-workspace";
import { buildInsightSynthesisPrompt } from "../src/lib/aiInsights";

test("personal insight ranges are inclusive and deterministic", () => {
  assert.deepEqual(insightDateWindow("day", "2026-08-20"), { from: "2026-08-20", through: "2026-08-20", count: 1 });
  assert.deepEqual(insightDateWindow("7d", "2026-08-20"), { from: "2026-08-14", through: "2026-08-20", count: 7 });
  assert.deepEqual(insightDateWindow("30d", "2026-08-20"), { from: "2026-07-22", through: "2026-08-20", count: 30 });
});

test("deterministic insight brief keeps activity separate from outcomes", () => {
  const brief = deterministicInsightBrief([{ tasksCompleted: 0, plannedCompleted: 0, carryOver: 1, outputEvidence: 0, planned: 2 }], [{ id: "plan-1" }]);
  assert.match(brief.summary, /separates goals, task outcomes, employee updates, evidence, and activity context/i);
  assert.match(brief.attention.join(" "), /carried or overdue item remained visible/i);
  assert.doesNotMatch(JSON.stringify(brief), /productivity score/i);
  assert.deepEqual(brief.referenceIds, ["plan-1"]);
});

test("authoritative insights use provider breaks and expose stale or unknown provenance", () => {
  const now = new Date("2026-08-21T12:00:00Z");
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99, provider_break_seconds: 600, provider_break_observed_at: "2026-08-21T11:58:00Z" }, now, true), { seconds: 600, freshness: "observed" });
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99, provider_break_seconds: 600, provider_break_observed_at: "2026-08-21T11:00:00Z" }, now, true), { seconds: 600, freshness: "stale" });
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99 }, now, true), { seconds: 0, freshness: "unknown" });
  assert.deepEqual(effectiveBreakObservation({ paused_seconds: 99 }, now, false), { seconds: 99, freshness: "manual" });
});

test("activity context rollup stays neutral and only aggregates Worktivity app summaries", () => {
  const rollup = activityEvidenceRollup([
    { source: "worktivity", metrics: { totalMinutes: 120, topApps: [{ name: "Figma", minutes: 80 }, { name: "Chrome", minutes: 40 }] } },
    { source: "worktivity", metrics: { totalMinutes: 30, topApps: [{ name: "Figma", minutes: 30 }] } },
    { source: "manual", metrics: { totalMinutes: 999, topApps: [{ name: "Payroll", minutes: 999 }] } },
  ]);
  assert.deepEqual(rollup, { trackedMinutes: 150, topApps: [{ name: "Figma", minutes: 110 }, { name: "Chrome", minutes: 40 }] });
  assert.equal(activityEvidenceRollup([]).trackedMinutes, 0);
});

test("deterministic brief reports tracked activity context without a productivity score", () => {
  const brief = deterministicInsightBrief([{ tasksCompleted: 1, plannedCompleted: 1, planned: 1, trackedMinutes: 90 }], []);
  assert.match(brief.wins.join(" "), /90 tracked minutes of app\/site activity context/i);
  assert.match(brief.wins.join(" "), /not a productivity score/i);
});

test("insight synthesis prompt renders recalled context as informational only", () => {
  const base = {
    range: "7d" as const,
    from: "2026-09-08",
    through: "2026-09-14",
    summary: "A steady week.",
    wins: ["Shipped the memory integration."],
    attention: [],
    nextFocus: ["Close the loop with managers."],
    totals: { observedSeconds: 5400, trackedMinutes: 60, planned: 5, plannedCompleted: 3, tasksCompleted: 2, outputEvidence: 1 },
    days: [{ date: "2026-09-14", observedSeconds: 5400, planned: 5, plannedCompleted: 3, tasksCompleted: 2, trackedMinutes: 90 }],
  };
  const plain = buildInsightSynthesisPrompt(base);
  assert.doesNotMatch(plain, /Additional context/);
  const enriched = buildInsightSynthesisPrompt({ ...base, contextBlock: "Today so far (2026-09-14) — live facts:\n- Shift: on shift" });
  assert.match(enriched, /Additional context \(live day state and recalled history — informational only/);
  assert.match(enriched, /Shift: on shift/);
  assert.match(enriched, /never a selectable fact and never completion evidence/);
});

test("the earlier comparison window is the equal-length range immediately before", () => {
  assert.deepEqual(previousInsightWindow("7d", "2026-08-20"), { from: "2026-08-07", through: "2026-08-13", count: 7 });
  assert.deepEqual(previousInsightWindow("30d", "2026-08-20"), { from: "2026-06-22", through: "2026-07-21", count: 30 });
  assert.deepEqual(previousInsightWindow("day", "2026-08-20"), { from: "2026-08-19", through: "2026-08-19", count: 1 });
});

test("update kinds keep blockers, priority changes, and unplanned work visible", () => {
  const kinds = updateKindRollup([
    { update_kind: "continuing" }, { update_kind: "material_progress" }, { update_kind: "starting" },
    { update_kind: "completion_claim" }, { update_kind: "blocked" }, { update_kind: "priority_change" },
    { update_kind: "unplanned_work" }, { update_kind: null },
  ]);
  assert.deepEqual(kinds, { progress: 2, starting: 1, completionClaim: 1, blocked: 1, priorityChange: 1, unplannedWork: 1 });
});

test("outcome timing only classifies completed work that carried a due date", () => {
  const timing = outcomeTiming([
    { completed: true, due_date: "2026-08-20", completed_at: "2026-08-20T15:00:00Z" },
    { completed: true, due_date: "2026-08-20", completed_at: "2026-08-21T09:00:00Z" },
    { completed: true, due_date: "2026-08-20" },
    { completed: true },
    { completed: false, due_date: "2026-08-01" },
  ]);
  assert.deepEqual(timing, { onTime: 1, late: 2 });
});

test("plan adherence counts selected, deferred, and removal proposals separately", () => {
  const rollup = planAdherenceRollup([
    { disposition: "selected", completion_state: "completed" },
    { disposition: "selected", completion_state: "open" },
    { disposition: "deferred", completion_state: "open" },
    { disposition: "removal_proposed", completion_state: "open" },
  ]);
  assert.deepEqual(rollup, { selected: 2, selectedCompleted: 1, deferred: 1, removalProposed: 1 });
});

test("consistency reports goal/update rhythm, best day, and the closing streak", () => {
  const days = [
    { date: "2026-08-14", goal: { text: "Ship it" }, updates: 1, tasksCompleted: 1 },
    { date: "2026-08-15", goal: { text: null }, updates: 0, tasksCompleted: 0 },
    { date: "2026-08-16", goal: { text: "Refine" }, updates: 2, tasksCompleted: 3 },
    { date: "2026-08-17", goal: { text: "Review" }, updates: 1, tasksCompleted: 2 },
  ];
  const stats = insightConsistency(days, { planned: 10, plannedCompleted: 6 });
  assert.equal(stats.daysWithGoal, 3);
  assert.equal(stats.daysWithUpdate, 3);
  assert.equal(stats.daysWithCompletion, 3);
  assert.equal(stats.currentStreak, 2);
  assert.deepEqual(stats.bestDay, { date: "2026-08-16", tasksCompleted: 3 });
  assert.equal(stats.commitmentRate, 60);
  assert.deepEqual(insightConsistency([], { planned: 0, plannedCompleted: 0 }).bestDay, null);
});

test("the expanded brief grounds blockers, on-time outcomes, rhythm, and deltas", () => {
  const days = [
    { date: "2026-08-14", planned: 2, plannedCompleted: 1, tasksCompleted: 2, updates: 2, updatesByKind: { blocked: 1 }, outcomesOnTime: 1, outcomesLate: 1, sessionCorrections: 0, goal: { text: "Ship it" }, observedSeconds: 3600 },
    { date: "2026-08-15", planned: 2, plannedCompleted: 2, tasksCompleted: 1, updates: 1, updatesByKind: { blocked: 1 }, outcomesOnTime: 1, outcomesLate: 0, sessionCorrections: 1, goal: { text: "Refine" }, observedSeconds: 5400 },
  ];
  const comparison = { days: [{ date: "2026-08-12", tasksCompleted: 1, observedSeconds: 3600 }] };
  const consistency = insightConsistency(days, { planned: 4, plannedCompleted: 3 });
  const brief = deterministicInsightBrief(days, [], { comparison, consistency });
  const all = [...brief.wins, ...brief.attention, ...brief.nextFocus].join(" ");
  assert.match(all, /2 of 3 outcomes with a due date landed on time/i);
  assert.match(all, /2 blockers were raised through the update record/i);
  assert.match(all, /1 outcome landed after its due date/i);
  assert.match(all, /session still needs correction/i);
  assert.match(all, /written goal was set on every one of the 2 days/i);
  assert.match(all, /Task outcomes were up from 1 in the equal earlier period/i);
  assert.match(all, /Review the blockers raised this period/i);
  assert.doesNotMatch(JSON.stringify(brief), /productivity score/i);
});

test("projectWorkspaceDay keeps attribution and commitment semantics stable", () => {
  const date = "2026-08-20";
  const tasks = [
    { id: "t1", provider_task_id: "n1", title: "Due today", completed: true, due_date: date, provider_created_at: "2026-08-01T09:00:00Z" },
    { id: "t2", provider_task_id: "n2", title: "Completed event", completed: true, due_date: null, provider_created_at: "2026-08-02T09:00:00Z" },
    { id: "t3", provider_task_id: "n3", title: "Open overdue", completed: false, due_date: "2026-08-18", provider_created_at: "2026-08-03T09:00:00Z" },
    { id: "t4", provider_task_id: "n4", title: "Unrelated", completed: false, due_date: null, provider_created_at: "2026-07-01T09:00:00Z" },
  ];
  const events = [
    { id: "e1", task_id: "t2", event_type: "completed", exact_at: "2026-08-20T14:00:00Z", task_snapshot: { completed: false }, local_date: date },
    { id: "e2", task_id: "t2", event_type: "surfaced", exact_at: "2026-08-20T09:00:00Z", task_snapshot: { completed: false }, local_date: date },
    { id: "e3", task_id: "t3", event_type: "deferred", exact_at: "2026-08-20T10:00:00Z", task_snapshot: { completed: false }, local_date: date },
  ];
  const projected = projectWorkspaceDay({
    date, currentDate: date, allTasks: tasks, attributable: tasks, events,
    plan: {
      id: "p1", freeform_intent: "Focus", goal_provenance: "employee", suggestion_task_ids: [], revision: 1,
      items: [{ task_id: "t2", completion_state: "completed", disposition: "selected" }],
    },
    session: null,
  });
  assert.deepEqual(projected.tasks.map((task) => [task.id, task.dayAttribution.reason]).sort(), [["t1", "due_date"], ["t2", "surfaced"]]);
  assert.equal(projected.total, 2);
  assert.equal(projected.completed, 2);
  assert.equal(projected.commitmentCompleted, 2);
  assert.equal(projected.commitmentTotal, 2);
  assert.equal(projected.overdueCount, 1);
  assert.deepEqual(projected.carryOverGroups.flatMap((group) => group.tasks.map((task) => task.id)), ["t3"]);
  assert.equal(projected.tasks.find((task) => task.id === "t2")?.dayDisposition, "active");
  assert.equal(projected.goal.text, "Focus");
  assert.equal(projected.sessionQuality.status, "none");
});
