import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attendanceFreshness, classifyOutstandingByPerson, currentScheduleForDate, summarizeRecapGroups } from "../src/lib/work-os-admin-overview";

test("attendance freshness uses the ten-minute observation boundary", () => {
  const now = new Date("2026-09-30T15:00:00Z");
  assert.equal(attendanceFreshness("2026-09-30T14:55:00Z", now), "fresh");
  assert.equal(attendanceFreshness("2026-09-30T14:45:00Z", now), "stale");
  assert.equal(attendanceFreshness(null, now), "unknown");
  assert.equal(attendanceFreshness("not-a-date", now), "unknown");
});

test("current schedule selection honors effective windows and picks the latest", () => {
  const schedules = [
    { person_id: "p1", effective_from: "2026-08-01", effective_to: "2026-08-31", timezone: "UTC" },
    { person_id: "p1", effective_from: "2026-09-01", effective_to: null, timezone: "Europe/London" },
    { person_id: "p2", effective_from: "2026-09-01", effective_to: null, timezone: "UTC" },
  ];
  assert.equal(currentScheduleForDate(schedules, "p1", "2026-09-30")?.timezone, "Europe/London");
  assert.equal(currentScheduleForDate(schedules, "p1", "2026-08-15")?.timezone, "UTC");
  assert.equal(currentScheduleForDate(schedules, "p3", "2026-09-30"), null);
});

test("outstanding EOD classification reuses the employee rule per person", () => {
  const result = classifyOutstandingByPerson([
    { personId: "p1", date: "2026-09-29", hasSession: true, observedMinutes: 300, hasPlan: true, completedTasks: 3, report: null },
    { personId: "p1", date: "2026-09-28", hasSession: true, observedMinutes: 280, hasPlan: true, completedTasks: 2, report: { id: "r", status: "pending_review", submitted: true } },
    { personId: "p2", date: "2026-09-29", hasSession: true, observedMinutes: 120, hasPlan: false, completedTasks: 0, report: { id: "r2", status: "rejected", submitted: false } },
  ]);
  const p1 = result.get("p1") ?? [];
  const p2 = result.get("p2") ?? [];
  assert.equal(p1.length, 1, "a submitted report clears the day");
  assert.equal(p1[0].status, "no_draft");
  assert.equal(p2.length, 1, "a rejected report stays outstanding");
  assert.equal(p2[0].status, "changes_requested");
  assert.equal(result.has("p3"), false);
});

test("a day with no recorded session or plan never counts as outstanding", () => {
  const result = classifyOutstandingByPerson([
    { personId: "p1", date: "2026-09-29", hasSession: false, observedMinutes: 0, hasPlan: false, completedTasks: 0, report: null },
  ]);
  assert.equal(result.size, 0);
});

test("recap groups keep the returned totals and review state exact", () => {
  const rollup = summarizeRecapGroups([
    { person_id: "p1", total: 2, reviewed: 1, last_at: "2026-11-04T11:00:00.000Z" },
    { person_id: "p2", total: 1, reviewed: 1, last_at: "2026-11-04T09:30:00.000Z" },
  ]);
  assert.equal(rollup.total, 3);
  assert.equal(rollup.reviewed, 2);
  assert.equal(rollup.lastAt, "2026-11-04T11:00:00.000Z");
  assert.deepEqual(rollup.byPerson.get("p1"), { total: 2, reviewed: 1, lastAt: "2026-11-04T11:00:00.000Z" });
  assert.deepEqual(rollup.byPerson.get("p2"), { total: 1, reviewed: 1, lastAt: "2026-11-04T09:30:00.000Z" });
  assert.equal(rollup.byPerson.get("p3"), undefined);
});

test("recap groups accept database strings, dates, and an absent last recap", () => {
  const rollup = summarizeRecapGroups([
    { person_id: "p1", total: "4", reviewed: "2", last_at: new Date("2026-11-04T08:15:00.000Z") },
    { person_id: "p2", total: 0, reviewed: 0, last_at: null },
  ]);
  assert.equal(rollup.total, 4);
  assert.equal(rollup.reviewed, 2);
  assert.equal(rollup.byPerson.get("p1")?.lastAt, "2026-11-04T08:15:00.000Z");
  assert.equal(rollup.byPerson.get("p2")?.lastAt, null);
});

test("the recap rollup read stays org-scoped, ready-only, and active-only", () => {
  const source = readFileSync(new URL("../src/lib/work-os-admin-overview.ts", import.meta.url), "utf8");
  assert.match(source, /JOIN work_people p[\s\S]*p\.active = true/);
  assert.match(source, /i\.organization_id = \$1 AND i\.local_date = \$2 AND i\.generation_status = 'ready'/);
  assert.match(source, /count\(\*\) FILTER \(WHERE i\.review_status IN \('confirmed', 'amended'\)\)/);
});
