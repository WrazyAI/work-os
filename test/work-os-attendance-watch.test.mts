import assert from "node:assert/strict";
import test from "node:test";
import { attendanceSignature } from "../src/modules/work-os/attendance";
import { ATTENDANCE_PENDING_POLL_MS, ATTENDANCE_SETTLED_POLL_MS, attendanceWatchExpectation, attendanceWatchInput, attendanceWatchInterval } from "../src/modules/work-os/attendance-watch";

type SigAttendance = NonNullable<Parameters<typeof attendanceSignature>[0]>;
const attendance: SigAttendance = { status: "working", state: "active", clockedInAt: "2026-09-29T09:00:00.000Z", clockedOutAt: null };
const session = { state: "active", clocked_in_at: "2026-09-29T09:00:00.000Z", clocked_out_at: null };
const at = (iso: string) => Date.parse(iso);

test("attendance signature ignores volatile observation times and tracks real transitions", () => {
  assert.equal(
    attendanceSignature(Object.assign({}, attendance, { observedAt: "2026-09-29T10:00:00.000Z" }), session),
    attendanceSignature(Object.assign({}, attendance, { observedAt: "2026-09-29T10:01:00.000Z" }), session),
  );
  assert.notEqual(
    attendanceSignature(attendance, session),
    attendanceSignature({ status: "clock_out", state: "off_shift", clockedInAt: attendance.clockedInAt, clockedOutAt: "2026-09-29T17:00:00.000Z" }, { ...session, state: "clocked_out", clocked_out_at: "2026-09-29T17:00:00.000Z" }),
  );
  assert.notEqual(
    attendanceSignature(attendance, session),
    attendanceSignature(attendance, { ...session, state: "paused" }),
  );
});

test("dashboard watch narrows the day payload into the shared cadence rule", () => {
  const input = attendanceWatchInput({
    session: { state: "active" },
    shift: { startsAt: "2026-09-29T09:00:00.000Z", endsAt: "2026-09-29T17:00:00.000Z" },
    attendance: { state: "active", source: "worktivity", stale: false, clockedOutAt: null },
  });
  assert.deepEqual(input, {
    sessionState: "active",
    shiftStartsAt: "2026-09-29T09:00:00.000Z",
    shiftEndsAt: "2026-09-29T17:00:00.000Z",
    attendanceState: "active",
    attendanceSource: "worktivity",
    attendanceStale: false,
    attendanceClockedOutAt: null,
  });
  assert.equal(attendanceWatchInterval(input, at("2026-09-29T12:00:00.000Z")), ATTENDANCE_SETTLED_POLL_MS);
  assert.equal(attendanceWatchInterval(input, at("2026-09-29T17:00:00.000Z")), ATTENDANCE_PENDING_POLL_MS);
});

test("dashboard watch waits for the activity clock-in before the shift starts", () => {
  const input = attendanceWatchInput({
    session: null,
    shift: { startsAt: "2026-09-29T09:00:00.000Z", endsAt: "2026-09-29T17:00:00.000Z" },
    attendance: null,
  });
  assert.equal(attendanceWatchExpectation(input, at("2026-09-29T08:30:00.000Z")), null);
  assert.equal(attendanceWatchExpectation(input, at("2026-09-29T08:58:00.000Z")), "clock-in");
  assert.equal(attendanceWatchExpectation(input, at("2026-09-29T12:00:00.000Z")), "clock-in");
});
