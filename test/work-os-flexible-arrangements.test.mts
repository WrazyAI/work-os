import assert from "node:assert/strict";
import test from "node:test";
import * as arrangements from "../src/modules/work-os/work-arrangement";
import { hasScheduledShiftOnDate, resolveUpcomingShiftWindow, resolveStartableShiftWindow, resolveShiftWindowForDate } from "../src/modules/work-os/companion";
import { worktivityConfirmationRequirement } from "../src/modules/work-os/worktivity-control";
import { screenshotRunMode } from "../src/lib/work-os-screenshots";
import { flexibleEodDraftBlocked } from "../src/lib/work-os-shift-gate";

test("flexible proposals retain fixed days but strip hidden times and targets", () => {
  assert.deepEqual(arrangements.normalizeWorkArrangement({ arrangement: "flexible", daysOfWeek: [5, 1, 1], shiftStart: "09:00", shiftEnd: "17:00", dailyHours: 8 }), {
    arrangement: "flexible", daysOfWeek: [1, 5], shiftStart: null, shiftEnd: null, breaks: [],
  });
});
test("legacy clients keep scheduled semantics and invalid arrangements/days fail", () => {
  assert.equal(arrangements.normalizeWorkArrangement({ daysOfWeek: [1], shiftStart: "09:00", shiftEnd: "17:00" }).arrangement, "scheduled");
  for (const input of [{ arrangement: "mystery", daysOfWeek: [1] }, { arrangement: "flexible", daysOfWeek: [] }, { arrangement: "flexible", daysOfWeek: [1, 8] }, { arrangement: "flexible", daysOfWeek: ["nope"] }]) {
    assert.throws(() => arrangements.normalizeWorkArrangement(input));
  }
  assert.equal(arrangements.normalizeWorkArrangement({ arrangement: null, daysOfWeek: ["1"], shiftStart: "09:00", shiftEnd: "17:00" }).arrangement, "scheduled");
  assert.throws(() => arrangements.normalizeWorkArrangement({ daysOfWeek: [1] }));
});
const flexible = { id: "flex", arrangement: "flexible" as const, timezone: "America/New_York", days_of_week: [1, 5], shift_start: null, shift_end: null, effective_from: "2026-11-01", effective_to: null };
test("flexible weekdays and exceptions never fabricate a timed window", () => {
  assert.equal(hasScheduledShiftOnDate([flexible], [], "2026-11-13"), true);
  assert.equal(hasScheduledShiftOnDate([flexible], [], "2026-11-14"), false);
  assert.equal(hasScheduledShiftOnDate([flexible], [{ exception_date: "2026-11-13", kind: "leave" }], "2026-11-13"), false);
  assert.equal(hasScheduledShiftOnDate([flexible], [{ exception_date: "2026-11-14", kind: "working_day" }], "2026-11-14"), true);
  assert.equal(resolveUpcomingShiftWindow([flexible], [], new Date("2026-11-13T16:00:00Z")), null);
  assert.equal(resolveStartableShiftWindow([flexible], [], new Date("2026-11-13T16:00:00Z")), null);
  assert.equal(resolveShiftWindowForDate([flexible], [], "2026-11-13"), null);
  assert.equal(hasScheduledShiftOnDate([], [], "2026-11-14"), true);
});
test("a dated working-day exception cannot resurrect an expired timed shift", () => {
  const old = { ...flexible, id: "old", arrangement: "scheduled" as const, shift_start: "09:00", shift_end: "17:00", effective_to: "2026-11-12" };
  const exception = [{ exception_date: "2026-11-13", kind: "working_day" as const }];
  assert.equal(resolveShiftWindowForDate([flexible, old], exception, "2026-11-13"), null);
  assert.equal(resolveStartableShiftWindow([flexible, old], exception, new Date("2026-11-13T16:00:00Z")), null);
});
test("flexible attendance starts without late or exception acknowledgment", () => {
  assert.equal(worktivityConfirmationRequirement({ action: "clock_in", now: "2026-11-13T22:00:00Z", flexible: true, body: {} }), null);
  assert.equal(worktivityConfirmationRequirement({ action: "clock_in", now: "2026-11-13T22:00:00Z", body: {} }), "exception");
});
test("a flexible report opens after work starts, not only after clock-out", () => {
  assert.equal(flexibleEodDraftBlocked({ started: true, closed: false }), false);
  assert.equal(flexibleEodDraftBlocked({ started: true, closed: true }), false);
  assert.equal(flexibleEodDraftBlocked({ started: false, closed: true }), false);
  assert.equal(flexibleEodDraftBlocked({ started: false, closed: false }), true);
});
test("flexible screenshot scheduling follows recorded sessions, not fabricated shift times", () => {
  const input = { now: new Date("2026-11-13T20:00:00Z"), timezone: "UTC", shiftStart: "", shiftEnd: "", arrangement: "flexible" as const };
  assert.equal(screenshotRunMode(input), null);
  assert.equal(screenshotRunMode({ ...input, clockedInAt: "2026-11-13T19:00:00Z" }), "hourly");
  assert.equal(screenshotRunMode({ ...input, clockedInAt: "2026-11-13T19:00:00Z", clockedOutAt: "2026-11-13T19:55:00Z" }), "eod");
});
