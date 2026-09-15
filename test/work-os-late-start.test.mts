import assert from "node:assert/strict";
import test from "node:test";
import { lateReasonRequired, lateStartMinutes, PROLONGED_ABSENCE_MINUTES } from "../src/lib/work-os-late-start";

const session = (overrides: Record<string, unknown> = {}) => ({
  clocked_in_at: "2026-09-15T09:35:00.000Z",
  scheduled_starts_at: "2026-09-15T09:00:00.000Z",
  late_reason: null,
  ...overrides,
});

test("a 30+ minute late start requires a reason until one is recorded", () => {
  assert.equal(PROLONGED_ABSENCE_MINUTES, 30);
  assert.equal(lateReasonRequired(session()), true);
  assert.equal(lateReasonRequired(session({ clocked_in_at: "2026-09-15T09:30:00.000Z" })), true);
  assert.equal(lateReasonRequired(session({ clocked_in_at: "2026-09-15T09:29:59.000Z" })), false);
  assert.equal(lateReasonRequired(session({ late_reason: "Doctor appointment" })), false);
  assert.equal(lateReasonRequired(session({ late_reason: "   " })), true);
});

test("unscheduled and missing sessions never require a reason", () => {
  assert.equal(lateReasonRequired(null), false);
  assert.equal(lateReasonRequired(session({ scheduled_starts_at: null })), false);
  assert.equal(lateReasonRequired(session({ clocked_in_at: null })), false);
});

test("late minutes are exposed for labels and cleared by a reason", () => {
  assert.equal(lateStartMinutes(session()), 35);
  assert.equal(lateStartMinutes(session({ late_reason: "Explained" })), 35);
  assert.equal(lateStartMinutes(session({ clocked_in_at: "2026-09-15T09:10:00.000Z" })), null);
});
