import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyOutstandingEodDays, selectDayEodWork, type OutstandingEodCandidate } from "../src/lib/work-os-eod";

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

test("EOD work sections are scoped to the day's own events and attribution", () => {
  const events = [
    { id: "e1", task_id: "t1", event_type: "completed", provenance: "employee_explicit", task_snapshot: { title: "Old local completion" } },
    { id: "e2", task_id: "t1", event_type: "completed", provenance: "nifty_exact", task_snapshot: { title: "Ship the handoff" } },
    { id: "e3", task_id: "t2", event_type: "deferred", provenance: "employee_explicit", task_snapshot: { title: "Rebuild the report" } },
    { id: "e4", task_id: "t3", event_type: "carried", provenance: "provider_observed", task_snapshot: { title: "Reconcile the settlement" } },
  ];
  const tasks = [
    { id: "t3", title: "Reconcile the settlement", completed: false, dayDisposition: "active", dayAttribution: { reason: "carried" } },
    { id: "t4", title: "Finish the intake review", completed: false, dayDisposition: "active", dayAttribution: { reason: "due_date" }, due_date: "2026-09-10" },
    { id: "t5", title: "Answer the customer", completed: false, dayDisposition: "deferred", dayAttribution: { reason: "surfaced" } },
    { id: "t6", title: "Ancient unrelated overdue task", completed: false, dayDisposition: "active", dayAttribution: { reason: "surfaced" } },
    { id: "t7", title: "Done yesterday", completed: true, dayDisposition: "active", dayAttribution: { reason: "surfaced" } },
  ];
  const sections = selectDayEodWork({ events, tasks });
  assert.deepEqual(sections.completed.map((item) => item.title), ["Ship the handoff"]);
  assert.deepEqual(sections.deferred.map((item) => item.title), ["Rebuild the report"]);
  assert.deepEqual(sections.carried.map((item) => item.title).sort(), ["Answer the customer", "Finish the intake review", "Reconcile the settlement"]);
  assert.ok(!sections.carried.some((item) => item.title === "Ancient unrelated overdue task"));
});
