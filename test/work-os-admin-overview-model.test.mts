import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdminOverview } from "../src/lib/work-os-admin-overview";
import { buildOverviewModel } from "../src/modules/work-os/admin/overview-model";

function workdaysEnding(through: string, count: number) {
  const dates: string[] = [];
  const cursor = new Date(`${through}T12:00:00Z`);
  while (dates.length < count) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.unshift(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates;
}

function person(overrides: Partial<AdminOverview["people"][number]> = {}): AdminOverview["people"][number] {
  return {
    personId: "p-1",
    displayName: "Ada Lovelace",
    email: "ada@example.com",
    roleProfile: "Design",
    timezone: "UTC",
    schedule: null,
    attendance: {
      state: "active",
      source: "worktivity",
      observedAt: null,
      freshness: "fresh",
      clockedInAt: null,
      clockedOutAt: null,
    },
    session: null,
    updatesToday: 0,
    substantiveUpdatesToday: 0,
    recapsToday: 0,
    recapsReviewedToday: 0,
    recapsAutoApprovedToday: 0,
    lastRecapAt: null,
    evidenceToday: 0,
    tasksCompletedToday: 0,
    lastUpdateAt: null,
    lastUpdateKind: null,
    eodToday: null,
    eodOutstanding: null,
    ...overrides,
  };
}

function fixture(overrides: Partial<AdminOverview["counts"]> = {}): AdminOverview {
  const dates = workdaysEnding("2026-11-26", 14);
  const generatedAt = "2026-11-26T10:00:00.000Z";
  return {
    date: "2026-11-26",
    generatedAt,
    counts: {
      people: 3,
      onShift: 2,
      paused: 0,
      offShift: 1,
      unknown: 0,
      updatesToday: 4,
      substantiveUpdatesToday: 2,
      recapsToday: 10,
      recapsReviewedToday: 6,
      recapsAutoApprovedToday: 2,
      tasksCompletedToday: 3,
      tasksOpen: 12,
      tasksOverdue: 1,
      evidenceToday: 8,
      evidenceActivityToday: 5,
      evidenceOutputToday: 3,
      ghlPerformedToday: 0,
      ghlContextToday: 0,
      reportsDraftedToday: 1,
      reportsSubmittedToday: 3,
      reportsPendingReview: 2,
      pendingReviewOldestAt: "2026-11-24T07:00:00.000Z",
      eodOutstandingPeople: 1,
      eodOutstandingDays: 1,
      disputedEvidence: 1,
      ...overrides,
    },
    people: [
      person({ personId: "p-1", displayName: "Ada Lovelace", eodToday: "pending_review" }),
      person({ personId: "p-2", displayName: "Ben Sato", attendance: { state: "active", source: "worktivity", observedAt: null, freshness: "fresh", clockedInAt: null, clockedOutAt: null }, eodToday: "approved" }),
      person({ personId: "p-3", displayName: "Chloe Marin", attendance: { state: "off_shift", source: "none", observedAt: null, freshness: "unknown", clockedInAt: null, clockedOutAt: null } }),
    ],
    recentActivity: [],
    attention: [],
    series: dates.map((date, index) => ({
      date,
      completed: index < 7 ? 2 : 3,
      updates: index < 7 ? 2 : 3,
      recaps: index < 7 ? 1 : 2,
      evidence: index < 7 ? 1 : 2,
    })),
    timeSeries: dates.map((date) => ({ date, totalMinutes: 60, people: [] })),
    freshness: {
      niftySyncedAt: null,
      niftyTasksToday: 0,
      worktivityObservedAt: null,
      githubLastEventAt: null,
      githubEventsToday: 0,
      ghlLastEventAt: null,
      ghlLastSyncAt: null,
      ghlEventsToday: 0,
      lastPlanAt: null,
      lastReportSubmittedAt: null,
    },
    readiness: null,
  } as AdminOverview;
}

test("the overview model reads the final seven workdays and keeps the prior seven", () => {
  const model = buildOverviewModel(fixture());
  assert.equal(model.days.length, 14);
  assert.equal(model.recent.length, 7);
  assert.equal(model.prior.length, 7);
  assert.deepEqual(model.recentTotals, { completed: 21, updates: 21, recaps: 14, evidence: 14, minutes: 420 });
  assert.deepEqual(model.priorTotals, { completed: 14, updates: 14, recaps: 7, evidence: 7, minutes: 420 });
  assert.equal(model.reviewWaiting, 2, "auto-approved recaps are not waiting");
  assert.deepEqual(model.oldestReview, { value: 2, unit: "day", phrase: "2 days" });
  assert.equal(model.eodSubmittedPeople, 2);
  assert.match(model.headline, /evidence record is waiting on a ruling/);
  assert.match(model.deck, /2 of 3 teammates are on shift/);
});

test("an age under a day is reported in hours", () => {
  const data = fixture({ pendingReviewOldestAt: "2026-11-26T03:00:00.000Z" });
  const model = buildOverviewModel(data);
  assert.deepEqual(model.oldestReview, { value: 7, unit: "hour", phrase: "7 hours" });
});
