import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attendanceStillOpen,
  EOD_SHIFT_OPEN_LINK_LABEL,
  EOD_SHIFT_OPEN_PREFIX,
  EOD_SHIFT_OPEN_REASON,
  EOD_SHIFT_OPEN_SERVER_MESSAGE,
  EOD_SHIFT_OPEN_SUFFIX,
  sessionStillOpen,
  shiftStillOpen,
} from "../src/lib/work-os-shift-gate";

const openSession = { state: "active", clocked_in_at: "2026-10-19T09:00:00.000Z", clocked_out_at: null };
const closedSession = { state: "clocked_out", clocked_in_at: "2026-10-19T09:00:00.000Z", clocked_out_at: "2026-10-19T17:00:00.000Z" };

test("a running session keeps the workday unfinished", () => {
  assert.equal(sessionStillOpen(openSession), true);
  assert.equal(sessionStillOpen({ state: "clocked_in", clocked_in_at: "2026-10-19T09:00:00.000Z", clocked_out_at: null }), true);
  assert.equal(sessionStillOpen({ state: "paused", clocked_in_at: "2026-10-19T09:00:00.000Z", clocked_out_at: null }), true);
  // The EOD-due state is still an open shift: the day has not ended.
  assert.equal(sessionStillOpen({ state: "eod_due", clocked_in_at: "2026-10-19T09:00:00.000Z", clocked_out_at: null }), true);
});

test("a clock-out ends the workday", () => {
  assert.equal(sessionStillOpen(closedSession), false);
  // A state that names a finished shift never keeps the day open.
  assert.equal(sessionStillOpen({ state: "clocked_out", clocked_in_at: "2026-10-19T09:00:00.000Z", clocked_out_at: null }), false);
  // A session that never started is not an open shift.
  assert.equal(sessionStillOpen({ state: "scheduled", clocked_in_at: null, clocked_out_at: null }), false);
  assert.equal(sessionStillOpen(null), false);
});

test("a fresh Worktivity observation keeps the workday unfinished", () => {
  assert.equal(attendanceStillOpen({ source: "worktivity", state: "active", stale: false }), true);
  assert.equal(attendanceStillOpen({ source: "worktivity", state: "paused", stale: false }), true);
  // A stale observation is not evidence of an open shift.
  assert.equal(attendanceStillOpen({ source: "worktivity", state: "active", stale: true }), false);
  // Only the provider speaks for attendance.
  assert.equal(attendanceStillOpen({ source: "work_os_fallback", state: "active", stale: false }), false);
  assert.equal(attendanceStillOpen({ source: "worktivity", state: "off_shift", stale: false }), false);
  assert.equal(attendanceStillOpen(null), false);
});

test("the shift is open when either the session or the provider says so", () => {
  assert.equal(shiftStillOpen({ session: openSession, attendance: null }), true);
  assert.equal(shiftStillOpen({ session: null, attendance: { source: "worktivity", state: "active", stale: false } }), true);
  assert.equal(shiftStillOpen({ session: closedSession, attendance: { source: "worktivity", state: "off_shift", stale: false } }), false);
  assert.equal(shiftStillOpen({ session: null, attendance: null }), false);
});

test("the prompt is one sentence with an inline clock-out link", () => {
  assert.match(EOD_SHIFT_OPEN_PREFIX, /shift has not ended/);
  assert.equal(EOD_SHIFT_OPEN_LINK_LABEL, "clock out");
  assert.match(EOD_SHIFT_OPEN_SUFFIX.companion, /first, then draft your report\./);
  assert.match(EOD_SHIFT_OPEN_SUFFIX.web, /Windows Work OS Companion/);
  assert.match(EOD_SHIFT_OPEN_SERVER_MESSAGE, /Clock out before drafting it\./);
  assert.equal(EOD_SHIFT_OPEN_REASON, "shift_open");
});
