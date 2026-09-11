import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOutstandingEodDays, type OutstandingEodCandidate } from "../src/lib/work-os-eod";

function candidate(overrides: Partial<OutstandingEodCandidate>): OutstandingEodCandidate {
  return {
    date: "2026-09-09",
    hasSession: false,
    observedMinutes: 0,
    hasPlan: false,
    completedTasks: 0,
    report: null,
    ...overrides,
  };
}

test("days with no recorded work are never outstanding", () => {
  const days = classifyOutstandingEodDays([
    candidate({ date: "2026-09-05" }),
    candidate({ date: "2026-09-06", hasSession: false, hasPlan: false, completedTasks: 0 }),
  ]);
  assert.deepEqual(days, []);
});

test("a worked or planned day without a report is outstanding as no_draft", () => {
  const days = classifyOutstandingEodDays([
    candidate({ date: "2026-09-08", hasSession: true, observedMinutes: 252, completedTasks: 3 }),
    candidate({ date: "2026-09-09", hasPlan: true }),
  ]);
  assert.equal(days.length, 2);
  assert.deepEqual(days[0], {
    date: "2026-09-08",
    status: "no_draft",
    reportId: null,
    observedMinutes: 252,
    completedTasks: 3,
    hasPlan: false,
  });
  assert.equal(days[1]?.status, "no_draft");
});

test("an unsubmitted draft keeps the day outstanding as draft_unsubmitted", () => {
  const days = classifyOutstandingEodDays([
    candidate({ date: "2026-09-09", hasSession: true, report: { id: "report-1", status: "draft", submitted: false } }),
  ]);
  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "draft_unsubmitted");
  assert.equal(days[0]?.reportId, "report-1");
});

test("a rejected report surfaces as changes_requested", () => {
  const days = classifyOutstandingEodDays([
    candidate({ date: "2026-09-09", hasSession: true, report: { id: "report-2", status: "rejected", submitted: true } }),
  ]);
  assert.equal(days.length, 1);
  assert.equal(days[0]?.status, "changes_requested");
});

test("submitted, pending, and approved reports are excluded", () => {
  const days = classifyOutstandingEodDays([
    candidate({ date: "2026-09-07", hasSession: true, report: { id: "a", status: "pending_review", submitted: true } }),
    candidate({ date: "2026-09-08", hasSession: true, report: { id: "b", status: "approved", submitted: true } }),
    candidate({ date: "2026-09-09", hasSession: true, report: { id: "c", status: "draft", submitted: true } }),
  ]);
  assert.deepEqual(days, []);
});

test("classification preserves the newest-first candidate order", () => {
  const days = classifyOutstandingEodDays([
    candidate({ date: "2026-09-10", hasSession: true }),
    candidate({ date: "2026-09-09", hasPlan: true }),
    candidate({ date: "2026-09-08", hasSession: true, report: { id: "r", status: "draft", submitted: false } }),
  ]);
  assert.deepEqual(days.map((day) => day.date), ["2026-09-10", "2026-09-09", "2026-09-08"]);
  assert.deepEqual(days.map((day) => day.status), ["no_draft", "no_draft", "draft_unsubmitted"]);
});
