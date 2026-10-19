import assert from "node:assert/strict";
import { test } from "node:test";
import { restampWindow } from "../src/lib/work-os-schedules";
import { resolveShiftWindowForDate } from "../src/modules/work-os/companion";

/* The pilot's day: the schedule moved from 14:00-21:00 to 14:00-20:00 after
   the session was already clocked in, and the session kept the old end. */
const rule = {
  id: "schedule-1",
  timezone: "Atlantic/Reykjavik",
  days_of_week: [1, 2, 3, 4, 5],
  shift_start: "14:00",
  shift_end: "20:00",
  effective_from: "2026-08-14",
  effective_to: null,
};
const resolved = resolveShiftWindowForDate([rule], [], "2026-10-19");

test("a same-day schedule edit moves the open session's window", () => {
  assert.ok(resolved);
  const patch = restampWindow({
    scheduled_starts_at: "2026-10-19T14:00:00.000Z",
    scheduled_ends_at: "2026-10-19T21:00:00.000Z",
    schedule_id: "schedule-1",
  }, resolved);
  assert.deepEqual(patch, {
    scheduled_starts_at: "2026-10-19T14:00:00.000Z",
    scheduled_ends_at: "2026-10-19T20:00:00.000Z",
    schedule_id: "schedule-1",
  });
});

test("a session already matching the schedule is left alone", () => {
  assert.ok(resolved);
  assert.equal(restampWindow({
    scheduled_starts_at: "2026-10-19T14:00:00.000Z",
    scheduled_ends_at: "2026-10-19T20:00:00.000Z",
    schedule_id: "schedule-1",
  }, resolved), null);
});

test("Postgres Date stamps compare as instants, not strings", () => {
  assert.ok(resolved);
  const patch = restampWindow({
    scheduled_starts_at: new Date("2026-10-19T14:00:00.000Z"),
    scheduled_ends_at: new Date("2026-10-19T21:00:00.000Z"),
    schedule_id: "schedule-1",
  }, resolved);
  assert.equal(patch?.scheduled_ends_at, "2026-10-19T20:00:00.000Z");
});

test("a day without a resolved shift keeps the window it started with", () => {
  assert.equal(restampWindow({ scheduled_ends_at: "2026-10-19T21:00:00.000Z", schedule_id: "schedule-1" }, null), null);
});

test("a leave day resolves no window and never clears the session", () => {
  const leave = resolveShiftWindowForDate([rule], [
    { exception_date: "2026-10-19", kind: "leave" },
  ], "2026-10-19");
  assert.equal(leave, null);
  assert.equal(restampWindow({ scheduled_ends_at: "2026-10-19T21:00:00.000Z", schedule_id: "schedule-1" }, leave), null);
});

test("attaching a different schedule is recorded even when the hours match", () => {
  assert.ok(resolved);
  const patch = restampWindow({
    scheduled_starts_at: "2026-10-19T14:00:00.000Z",
    scheduled_ends_at: "2026-10-19T20:00:00.000Z",
    schedule_id: "schedule-0",
  }, resolved);
  assert.equal(patch?.schedule_id, "schedule-1");
});
