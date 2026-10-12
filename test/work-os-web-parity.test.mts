// Web/companion parity helpers: the shift-time instrument, the planning merge,
// and the insights port are pure modules; pin their behavior here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { remainingShiftLabel, shiftPulse, untilShiftLabel } from "../src/modules/work-os/employee/shiftPulse";
import { applyCommitmentEdits, buildPlanItemsFromInterpretation, type PlanningInterpretation } from "../src/modules/work-os/employee/planning";
import { consistencyChips, flowBreakdown, insightRangeSummary, insightSeries, periodDeltas } from "../src/modules/work-os/employee/insights";
import { assistantDraftFallbackNotice, assistantDraftNotice, extractBottleneckSection, restoreBottleneckSection, stripBottleneckSection } from "../src/modules/work-os/employee/eod";
import { hasRecapForSlot, recapEnsureSlot, recapPromptDueInMs } from "../src/modules/work-os/employee/recaps";
import { normalizeCheckInKind } from "../src/lib/work-os-checkins";

test("shift pulse subtracts recorded breaks from elapsed time", () => {
  const pulse = shiftPulse(
    { state: "active", clocked_in_at: "2026-09-30T09:00:00.000Z", paused_seconds: 1800 },
    { startsAt: "2026-09-30T09:00:00.000Z", endsAt: "2026-09-30T17:00:00.000Z" },
    new Date("2026-09-30T13:00:00.000Z"),
    false,
    null,
  );
  assert.equal(pulse.elapsedLabel, "03:30");
  assert.equal(pulse.breakLabel, "00:30");
  assert.equal(pulse.breakSeconds, 1800);
  assert.equal(pulse.progressPercent, 50);
  assert.equal(pulse.schedulePhase, "in_progress");
});

test("shift pulse keeps the schedule instrument honest without a session", () => {
  const pulse = shiftPulse(
    { state: "scheduled" },
    { startsAt: "2026-09-30T09:00:00.000Z", endsAt: "2026-09-30T17:00:00.000Z" },
    new Date("2026-09-30T08:00:00.000Z"),
  );
  assert.equal(pulse.elapsedLabel, "00:00");
  assert.equal(pulse.progressPercent, 0);
  assert.equal(pulse.schedulePhase, "upcoming");
  assert.equal(remainingShiftLabel({ endsAt: "2026-09-30T17:00:00.000Z" }, new Date("2026-09-30T15:30:00.000Z")), "1h 30m remaining");
  assert.equal(untilShiftLabel({ startsAt: "2026-09-30T09:00:00.000Z" }, new Date("2026-09-30T08:15:00.000Z")), "45m until your shift");
});

test("shift pulse prefers the authoritative provider break clock when enabled", () => {
  const pulse = shiftPulse(
    { state: "paused", clocked_in_at: "2026-09-30T09:00:00.000Z", paused_seconds: 3600, provider_break_seconds: 1200 },
    { startsAt: "2026-09-30T09:00:00.000Z", endsAt: "2026-09-30T17:00:00.000Z" },
    new Date("2026-09-30T11:00:00.000Z"),
    true,
    null,
  );
  assert.equal(pulse.elapsedLabel, "01:40");
  assert.equal(pulse.breakSeconds, 1200);
});

const interpretation: PlanningInterpretation = {
  buildId: "11111111-1111-4111-8111-111111111111",
  rawIntent: "Ship the settlement fix",
  summary: "One linked task and one new outcome.",
  commitments: [
    {
      clientId: "c1",
      linkedTaskId: "t1",
      title: "Reconcile the settlement",
      objective: "Close the September reconciliation.",
      successCriteria: ["Ledger matches"],
      sourceRefs: [{ provider: "work_os", type: "task", id: "t1", label: "Reconcile the settlement" }],
      confidence: 0.9,
    },
    {
      clientId: "c2",
      title: "Write the handoff note",
      objective: "Document the reconciliation for the team.",
      successCriteria: ["Note shared"],
      sourceRefs: [{ provider: "employee", type: "intent", id: "raw_intent" }],
      confidence: 0.6,
    },
  ],
  clarifications: [{ id: "q1", commitmentId: "c2", question: "Who needs the note?", reason: "The audience is unclear." }],
  readiness: "needs_one_clarification",
};

test("plan merge enriches linked tasks and appends new outcomes", () => {
  const items = buildPlanItemsFromInterpretation(
    [{ id: "i1", task_id: "t1", title_snapshot: "Reconcile the settlement", disposition: "selected", item_kind: "task", completion_state: "open" }],
    interpretation,
    {},
  );
  assert.equal(items.length, 2);
  assert.equal(items[0].id, "i1");
  assert.equal(items[0].objective, "Close the September reconciliation.");
  assert.equal(items[0].clarification_state, "none");
  assert.equal(items[1].id, "");
  assert.equal(items[1].task_id, null);
  assert.equal(items[1].item_kind, "outcome");
  assert.equal(items[1].title_snapshot, "Write the handoff note");
  assert.equal(items[1].clarification_state, "needs_clarification");
});

test("answered clarifications resolve before save", () => {
  const items = buildPlanItemsFromInterpretation([], interpretation, { q1: "The operations lead" });
  const outcome = items.find((item) => item.title_snapshot === "Write the handoff note");
  assert.equal(outcome?.clarification_state, "resolved");
});

test("inline edits apply to titles, objectives, and criteria", () => {
  const edited = applyCommitmentEdits(interpretation, {
    c2: { title: "Handoff brief", objective: "Give ops the runbook.", successCriteria: ["Runbook linked"] },
  });
  const commitment = edited.commitments.find((item) => item.clientId === "c2");
  assert.equal(commitment?.title, "Handoff brief");
  assert.equal(commitment?.objective, "Give ops the runbook.");
  assert.deepEqual(commitment?.successCriteria, ["Runbook linked"]);
  assert.equal(edited.commitments.find((item) => item.clientId === "c1")?.title, "Reconcile the settlement");
});

const days = [
  { date: "2026-09-28", observedSeconds: 14400, pausedSeconds: 0, planStatus: "confirmed" as const, planned: 4, plannedCompleted: 3, carryOver: 0, overdue: 0, updates: 2, outputEvidence: 1, activityContext: 2, trackedMinutes: 120, tasksCompleted: 3, tasksOpen: 1, progressed: 1, deferred: 0, carried: 0, unplanned: 0, outcomesOnTime: 2, outcomesLate: 1, goal: { text: "Ship the fix", provenance: "employee" }, references: [] },
  { date: "2026-09-29", observedSeconds: 10800, pausedSeconds: 1800, planStatus: "confirmed" as const, planned: 3, plannedCompleted: 2, carryOver: 1, overdue: 0, updates: 1, outputEvidence: 0, activityContext: 1, trackedMinutes: 60, tasksCompleted: 2, tasksOpen: 2, progressed: 2, deferred: 1, carried: 1, unplanned: 1, outcomesOnTime: 1, outcomesLate: 1, goal: { text: null, provenance: null }, references: [] },
  { date: "2026-09-30", observedSeconds: 10800, pausedSeconds: 0, planStatus: "draft" as const, planned: 2, plannedCompleted: 1, carryOver: 2, overdue: 1, updates: 3, outputEvidence: 1, activityContext: 0, trackedMinutes: 90, tasksCompleted: 1, tasksOpen: 3, progressed: 0, deferred: 0, carried: 2, unplanned: 0, outcomesOnTime: 1, outcomesLate: 0, goal: { text: "Wrap the week", provenance: "employee" }, references: [] },
];

test("insight series and flow breakdown stay exact", () => {
  const series = insightSeries(days);
  assert.equal(series.length, 3);
  assert.equal(series[0].observedMinutes, 240);
  assert.equal(series[0].completionPercent, 75);
  const flow = flowBreakdown(days);
  assert.deepEqual(flow.map((slice) => slice.value), [6, 3, 1, 3, 1]);
});

test("range summary and period deltas compare the prior window honestly", () => {
  const summary = insightRangeSummary({
    range: "7d",
    from: "2026-09-28",
    through: "2026-09-30",
    days,
    totals: { planned: 9, plannedCompleted: 6, tasksCompleted: 6, observedSeconds: 36000, updates: 6, outputEvidence: 2, activityContext: 3, trackedMinutes: 270 },
    comparison: { totals: { planned: 8, plannedCompleted: 4, tasksCompleted: 4, observedSeconds: 32000, updates: 4, outputEvidence: 3, activityContext: 2, trackedMinutes: 200 }, days: [{ ...days[0], date: "2026-09-27", carried: 1 }] },
    brief: { summary: "", wins: [], attention: [], nextFocus: [] },
    freshness: {},
  } as never);
  assert.equal(summary.recordedDays, 3);
  assert.equal(summary.commitmentRate, 67);
  assert.equal(summary.closingCarryOver, 2);
  assert.equal(summary.carryOverDelta, 1);
  assert.equal(summary.blockers, 0);
  const deltas = periodDeltas({ tasksCompleted: 6, planned: 9, plannedCompleted: 6 }, { tasksCompleted: 4, planned: 8, plannedCompleted: 4 });
  assert.equal(deltas.find((stat) => stat.key === "tasksCompleted")?.delta, 2);
  assert.equal(deltas.find((stat) => stat.key === "plannedCompleted")?.delta, 17);
});

test("consistency chips fall back to the days when the range has no stats", () => {
  const chips = consistencyChips(null, days);
  assert.deepEqual(chips.map((chip) => [chip.key, chip.value]), [["goal", "2/3"], ["update", "3/3"]]);
  const withStats = consistencyChips({ dayCount: 3, daysWithGoal: 3, daysWithUpdate: 2, daysWithCompletion: 3, bestDay: { date: "2026-09-28", tasksCompleted: 3 }, currentStreak: 3, commitmentRate: 67 }, days);
  assert.ok(withStats.some((chip) => chip.key === "streak" && chip.value === "3d"));
  assert.ok(withStats.some((chip) => chip.key === "commitments" && chip.value === "67%"));
});

test("progress prompts store as the catch_up check-in kind", () => {
  assert.equal(normalizeCheckInKind("follow_up"), "catch_up");
  assert.equal(normalizeCheckInKind("hourly_fallback"), "catch_up");
  assert.equal(normalizeCheckInKind("optional"), "optional");
  assert.equal(normalizeCheckInKind("eod"), "eod");
  assert.equal(normalizeCheckInKind(undefined), null);
  assert.equal(normalizeCheckInKind("not_a_kind"), null);
});

test("a due progress prompt ensures its recap exactly once", () => {
  const now = Date.parse("2026-09-30T11:30:00.000Z");
  const due = { kind: "hourly_fallback", nextPromptAt: "2026-09-30T11:00:00.000Z" };
  assert.equal(recapEnsureSlot(due, now), "hourly_fallback:2026-09-30T11:00:00.000Z");
  assert.equal(recapEnsureSlot({ kind: "plan", nextPromptAt: due.nextPromptAt }, now), null);
  assert.equal(recapEnsureSlot({ kind: "hourly_fallback", nextPromptAt: "2026-09-30T12:00:00.000Z" }, now), null);
  assert.equal(recapEnsureSlot(null, now), null);
  const slot = recapEnsureSlot(due, now)!;
  assert.equal(hasRecapForSlot([{ windowStart: "2026-09-30T10:00:00.000Z", windowEnd: "2026-09-30T11:00:00.000Z", generationStatus: "ready" }], slot), true);
  assert.equal(hasRecapForSlot([{ windowStart: "2026-09-30T09:00:00.000Z", windowEnd: "2026-09-30T10:00:00.000Z", generationStatus: "ready" }], slot), false);
  assert.equal(hasRecapForSlot([{ windowStart: "2026-09-30T10:00:00.000Z", windowEnd: "2026-09-30T11:00:00.000Z", generationStatus: "failed" }], slot), false);
  // A not-yet-due prompt schedules its check for the due moment.
  assert.equal(recapPromptDueInMs({ kind: "follow_up", nextPromptAt: "2026-09-30T12:00:00.000Z" }, now), 30 * 60_000);
  assert.equal(recapPromptDueInMs(due, now), null);
  assert.equal(recapPromptDueInMs({ kind: "plan", nextPromptAt: "2026-09-30T12:00:00.000Z" }, now), null);
});

test("EOD refinement strips only the bottleneck section", () => {
  const markdown = "## Summary\nShipped the fix.\n\n## Bottleneck\nAwaiting access.\n";
  assert.equal(stripBottleneckSection(markdown), "## Summary\nShipped the fix.");
  assert.equal(stripBottleneckSection("## Summary\nNo bottleneck section."), "## Summary\nNo bottleneck section.");
  assert.equal(
    stripBottleneckSection("## Summary\nShipped.\n\n## Bottleneck\nAwaiting access.\n\n## Notes\nExtra."),
    "## Summary\nShipped.\n\n## Notes\nExtra.",
  );
  assert.equal(
    stripBottleneckSection("## Summary\nShipped.\n\n## Bottleneck analysis\nLate starts."),
    "## Summary\nShipped.\n\n## Bottleneck analysis\nLate starts.",
  );
  const section = extractBottleneckSection(markdown);
  assert.equal(section, "## Bottleneck\nAwaiting access.");
  assert.equal(restoreBottleneckSection("## Summary\nRefined.", section), "## Summary\nRefined.\n\n## Bottleneck\nAwaiting access.");
  assert.equal(restoreBottleneckSection("## Summary\nRefined.\n\n## Bottleneck\nKept.", section), "## Summary\nRefined.\n\n## Bottleneck\nKept.");
  assert.equal(stripBottleneckSection("## Bottleneck\nAwaiting access."), "");
  assert.equal(extractBottleneckSection("## Bottleneck\nAwaiting access."), "## Bottleneck\nAwaiting access.");
});

test("assistant draft notices name what grounded the draft", () => {
  assert.match(assistantDraftNotice({ markdown: "x", model: "m", screenshots: { processed: 3, excluded: 0, failed: 0, pending: 0, hours: [] } }), /3 analyzed screenshots grounded it/);
  assert.match(assistantDraftNotice({ markdown: "x", model: "m", screenshotSyncUnavailable: true }), /Screenshot context was unavailable/);
  assert.match(assistantDraftFallbackNotice(false, "assistant down"), /standard draft/);
  assert.equal(assistantDraftFallbackNotice(true, "gated"), "gated");
});

test("recap gaps collapse into Extra notes and coverage stays in evidence on both surfaces", () => {
  const companion = readFileSync(resolve(import.meta.dirname, "../desktop/work-os-companion/src/ActivityIntervalCard.tsx"), "utf8");
  const web = readFileSync(resolve(import.meta.dirname, "../src/modules/work-os/employee/EmployeeActivityRecaps.tsx"), "utf8");
  for (const source of [companion, web]) {
    assert.match(source, /Extra notes/, "gaps live behind a quiet Extra notes disclosure");
    assert.match(source, /coverageLabel/, "the frame coverage summary is shared vocabulary");
    assert.doesNotMatch(source, /Not established/, "the old inline gap line is gone");
  }
  const engine = readFileSync(resolve(import.meta.dirname, "../src/lib/work-os-activity-intervals.ts"), "utf8");
  assert.match(engine, /framesRecorded/, "the interval view carries the coverage snapshot");
  assert.match(engine, /maxItems: 3/, "the synthesis schema caps generated gaps");
});
