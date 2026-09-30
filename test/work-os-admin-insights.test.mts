import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adminInsightWindow,
  buildAdminInsightNotes,
  outcomeTimingFromEvents,
  previousAdminInsightWindow,
  type AdminInsightTotals,
} from "../src/lib/work-os-admin-insights";

const NOW = new Date("2026-09-30T15:00:00Z");

function totals(overrides: Partial<AdminInsightTotals> = {}): AdminInsightTotals {
  return {
    outcomesCompleted: 0,
    outcomesLate: 0,
    updates: 0,
    substantiveUpdates: 0,
    eodSubmitted: 0,
    eodApproved: 0,
    eodRejected: 0,
    planned: 0,
    plannedCompleted: 0,
    trackedMinutes: 0,
    evidenceOutput: 0,
    evidenceActivity: 0,
    sessionsNeedingCorrection: 0,
    activePeople: 0,
    ...overrides,
  };
}

test("insight windows resolve fixed ranges and equal earlier periods", () => {
  assert.deepEqual(adminInsightWindow("7d", "2026-09-30", NOW), { through: "2026-09-30", count: 7, from: "2026-09-24" });
  assert.deepEqual(adminInsightWindow("30d", "2026-09-30", NOW), { through: "2026-09-30", count: 30, from: "2026-09-01" });
  assert.deepEqual(adminInsightWindow("90d", "2026-09-30", NOW), { through: "2026-09-30", count: 90, from: "2026-07-03" });
  assert.deepEqual(previousAdminInsightWindow("7d", "2026-09-30", NOW), { through: "2026-09-23", count: 7, from: "2026-09-17" });
  assert.equal(adminInsightWindow("7d", "not-a-date", NOW).through, "2026-09-30");
});

test("completion timing uses the task snapshot due date and ignores undated work", () => {
  const timing = outcomeTimingFromEvents([
    { local_date: "2026-09-29", task_snapshot: { due_date: "2026-09-29" } },
    { local_date: "2026-09-29", task_snapshot: { due_date: "2026-09-25" } },
    { local_date: "2026-09-29", task_snapshot: {} },
    { local_date: "2026-09-29" },
  ]);
  assert.equal(timing.onTime, 1);
  assert.equal(timing.late, 1);
});

test("insight notes name the facts, attention, and next focus without scores", () => {
  const notes = buildAdminInsightNotes({
    rangeLabel: "2026-09-24 to 2026-09-30",
    totals: totals({ outcomesCompleted: 33, outcomesLate: 2, substantiveUpdates: 41, planned: 29, plannedCompleted: 21, eodSubmitted: 23, trackedMinutes: 2880, sessionsNeedingCorrection: 1 }),
    previous: totals({ outcomesCompleted: 28 }),
    outstandingDays: 3,
    overdueOpen: 7,
  });
  assert.match(notes.summary, /33 completed outcomes/);
  assert.match(notes.summary, /never a score/i);
  assert.ok(notes.wins.some((line) => /72% of planned commitments/.test(line)));
  assert.ok(notes.wins.some((line) => /up from 28 in the equal earlier period/.test(line)));
  assert.ok(notes.attention.some((line) => /2 completed outcomes landed after/.test(line)));
  assert.ok(notes.attention.some((line) => /3 workdays/.test(line)));
  assert.ok(notes.attention.some((line) => /7 open tasks are past their due date/.test(line)));
  assert.ok(notes.attention.some((line) => /1 session still need/.test(line)));
  assert.ok(notes.nextFocus.length >= 2);
});

test("an empty range leads with the missing record instead of inventing activity", () => {
  const notes = buildAdminInsightNotes({
    rangeLabel: "2026-09-24 to 2026-09-30",
    totals: totals(),
    previous: totals(),
    outstandingDays: 0,
    overdueOpen: 0,
  });
  assert.match(notes.summary, /No completed outcomes or updates were recorded/);
  assert.deepEqual(notes.wins, []);
  assert.ok(notes.attention.some((line) => /No completed task outcomes/.test(line)));
  assert.ok(notes.nextFocus.length >= 1);
});
