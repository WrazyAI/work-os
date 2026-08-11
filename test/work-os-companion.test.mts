import assert from "node:assert/strict";
import {
  decideWorkOsPrompt,
  isTaskOutcomeEvidence,
  resolveShiftWindow,
  zonedDateTimeToUtc,
  type WorkOsScheduleRule,
} from "../src/modules/work-os/companion";

const baseRule: WorkOsScheduleRule = {
  id: "schedule-1",
  timezone: "UTC",
  days_of_week: [1, 2, 3, 4, 5],
  shift_start: "16:00",
  shift_end: "20:00",
  break_windows: [{ start: "17:30", end: "17:45" }],
  effective_from: "2026-01-01",
};

assert.equal(
  zonedDateTimeToUtc("2026-07-10", "09:00", "America/New_York").toISOString(),
  "2026-07-10T13:00:00.000Z",
  "wall-clock conversion should respect daylight saving time",
);

const beforeShift = new Date("2026-07-10T15:30:00Z");
const upcoming = resolveShiftWindow([baseRule], [], beforeShift);
assert.equal(upcoming?.startsAt, "2026-07-10T16:00:00.000Z");
assert.deepEqual(decideWorkOsPrompt(upcoming, [], beforeShift), {
  kind: "plan",
  nextPromptAt: "2026-07-10T16:00:00.000Z",
  required: true,
  reason: "Shift has not started.",
});

const firstHour = new Date("2026-07-10T16:30:00Z");
const active = resolveShiftWindow([baseRule], [], firstHour);
assert.equal(decideWorkOsPrompt(active, [], firstHour).kind, "plan");
assert.equal(decideWorkOsPrompt(active, [], new Date("2026-07-10T17:05:00Z")).kind, "catch_up");
assert.equal(decideWorkOsPrompt(active, [], new Date("2026-07-10T17:35:00Z")).reason, "Scheduled break.");

const validCheckIn = [{
  substantive: true,
  confirmed_existing_tasks: false,
  occurred_at: "2026-07-10T16:15:00Z",
}];
assert.equal(decideWorkOsPrompt(active, validCheckIn, new Date("2026-07-10T18:10:00Z")).kind, "optional");
assert.equal(decideWorkOsPrompt(active, validCheckIn, new Date("2026-07-10T19:10:00Z")).reason, "Final-hour planning suppression.");
assert.equal(decideWorkOsPrompt(active, validCheckIn, new Date("2026-07-10T19:46:00Z")).kind, "eod");

const overnightRule: WorkOsScheduleRule = {
  ...baseRule,
  shift_start: "22:00",
  shift_end: "06:00",
  break_windows: [],
};
const overnight = resolveShiftWindow([overnightRule], [], new Date("2026-07-11T02:00:00Z"));
assert.equal(overnight?.shiftDate, "2026-07-10");
assert.equal(overnight?.endsAt, "2026-07-11T06:00:00.000Z");

const leave = resolveShiftWindow([baseRule], [{ exception_date: "2026-07-10", kind: "leave" }], firstHour);
assert.equal(leave, null);

assert.equal(isTaskOutcomeEvidence({ source: "worktivity", url: "https://example.test/screenshot" }), false);
assert.equal(isTaskOutcomeEvidence({ source: "manual", metrics: { evidenceClass: "work_claim" } }), false);
assert.equal(isTaskOutcomeEvidence({ source: "github", metrics: { evidenceClass: "output_evidence" } }), true);
assert.equal(isTaskOutcomeEvidence({ source: "manual", url: "https://example.test/deliverable" }), true);

console.log("Work OS companion domain tests passed.");
