import assert from "node:assert/strict";
import {
  decideWorkOsPrompt,
  isTaskOutcomeEvidence,
  resolveStartableShiftWindow,
  resolveShiftWindow,
  resolveShiftWindowForDate,
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
  kind: null,
  nextPromptAt: null,
  required: false,
  reason: "Clock in to begin the workday.",
});
assert.equal(resolveStartableShiftWindow([baseRule], [], beforeShift)?.shiftDate, "2026-07-10", "30-minute grace is startable");
assert.equal(resolveStartableShiftWindow([baseRule], [], new Date("2026-07-10T15:29:59Z")), null, "earlier starts require an exception");

const firstHour = new Date("2026-07-10T16:30:00Z");
const active = resolveShiftWindow([baseRule], [], firstHour);
assert.equal(decideWorkOsPrompt(active, [], firstHour).kind, "follow_up");
assert.equal(decideWorkOsPrompt(active, [], new Date("2026-07-10T17:05:00Z")).kind, "follow_up");
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

// Postgres date columns arrive as Date objects: comparing them to "YYYY-MM-DD"
// strings silently disabled every schedule rule (no shift windows, unscheduled
// Worktivity clock-ins, no EOD state). The resolver must normalize both forms.
const datedRule = { ...baseRule, effective_from: new Date("2026-01-01T00:00:00.000Z") as unknown as string };
assert.equal(resolveStartableShiftWindow([datedRule], [], beforeShift)?.shiftDate, "2026-07-10", "a Date-valued effective_from must not disable the rule");
assert.equal(resolveShiftWindow([datedRule], [], beforeShift)?.startsAt, "2026-07-10T16:00:00.000Z", "the upcoming window resolves for Date-valued rules");
const endedRule = { ...baseRule, effective_from: new Date("2026-01-01T00:00:00.000Z") as unknown as string, effective_to: new Date("2026-06-30T00:00:00.000Z") as unknown as string };
assert.equal(resolveShiftWindow([endedRule], [], beforeShift), null, "a Date-valued effective_to still ends the rule");

// The day window is the EOD anchor: it must resolve for its own date even
// after it ended, and stay null for leave days or unscheduled dates.
assert.equal(resolveShiftWindowForDate([baseRule], [], "2026-07-10")?.endsAt, "2026-07-10T20:00:00.000Z", "the day window survives past its end");
assert.equal(resolveShiftWindowForDate([baseRule], [], "2026-07-11"), null, "an unscheduled weekday has no window");
assert.equal(resolveShiftWindowForDate([baseRule], [{ exception_date: "2026-07-10", kind: "leave" }], "2026-07-10"), null, "leave days have no window");
assert.equal(
  resolveShiftWindowForDate([baseRule], [{ exception_date: "2026-07-10", kind: "changed_shift", shift_start: "15:00", shift_end: "19:00" }], "2026-07-10")?.endsAt,
  "2026-07-10T19:00:00.000Z",
  "a changed-shift exception overrides the day window",
);
assert.equal(
  resolveShiftWindowForDate([baseRule], [{ exception_date: "2026-07-11", kind: "working_day" }], "2026-07-11")?.endsAt,
  "2026-07-11T20:00:00.000Z",
  "a working-day exception adds the window",
);

assert.equal(isTaskOutcomeEvidence({ source: "worktivity", url: "https://example.test/screenshot" }), false);
assert.equal(isTaskOutcomeEvidence({ source: "manual", metrics: { evidenceClass: "work_claim" } }), false);
assert.equal(isTaskOutcomeEvidence({ source: "github", metrics: { evidenceClass: "output_evidence" } }), true);
assert.equal(isTaskOutcomeEvidence({ source: "manual", url: "https://example.test/deliverable" }), true);

console.log("Work OS companion domain tests passed.");
