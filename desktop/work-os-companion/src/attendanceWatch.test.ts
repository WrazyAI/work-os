import { describe, expect, it } from "vitest";
import { ATTENDANCE_PENDING_POLL_MS, ATTENDANCE_SETTLED_POLL_MS, attendanceWatchExpectation, attendanceWatchInterval, type AttendanceWatchInput } from "./attendanceWatch";

const base: AttendanceWatchInput = { sessionState: null, shiftStartsAt: "2026-09-29T09:00:00.000Z", shiftEndsAt: "2026-09-29T17:00:00.000Z" };
const at = (iso: string) => Date.parse(iso);

describe("attendanceWatchExpectation", () => {
  it("waits for the activity clock-in from just before the shift until the window closes", () => {
    expect(attendanceWatchExpectation(base, at("2026-09-29T08:30:00.000Z"))).toBeNull();
    expect(attendanceWatchExpectation(base, at("2026-09-29T08:57:59.000Z"))).toBeNull();
    expect(attendanceWatchExpectation(base, at("2026-09-29T08:58:00.000Z"))).toBe("clock-in");
    expect(attendanceWatchExpectation(base, at("2026-09-29T12:00:00.000Z"))).toBe("clock-in");
  });

  it("waits for the clock-out once the session is active and the window has ended", () => {
    expect(attendanceWatchExpectation({ ...base, sessionState: "active" }, at("2026-09-29T16:59:59.000Z"))).toBeNull();
    expect(attendanceWatchExpectation({ ...base, sessionState: "active" }, at("2026-09-29T17:00:00.000Z"))).toBe("clock-out");
  });

  it("treats fresh provider activity as a pending clock-in even without a shift window", () => {
    expect(attendanceWatchExpectation({ ...base, shiftStartsAt: null, shiftEndsAt: null, attendanceSource: "worktivity", attendanceState: "active", attendanceStale: false }, at("2026-09-29T12:00:00.000Z"))).toBe("clock-in");
    expect(attendanceWatchExpectation({ ...base, shiftStartsAt: null, shiftEndsAt: null, attendanceSource: "worktivity", attendanceState: "active", attendanceStale: true }, at("2026-09-29T12:00:00.000Z"))).toBeNull();
  });

  it("treats an observed provider clock-out as pending until the session mirrors it", () => {
    expect(attendanceWatchExpectation({ ...base, sessionState: "active", attendanceSource: "worktivity", attendanceState: "off_shift", attendanceStale: false, attendanceClockedOutAt: "2026-09-29T16:40:00.000Z" }, at("2026-09-29T16:45:00.000Z"))).toBe("clock-out");
  });

  it("settles to 60s once the day is steady and polls at 30s while a transition is expected", () => {
    expect(attendanceWatchInterval(base, at("2026-09-29T09:00:00.000Z"))).toBe(ATTENDANCE_PENDING_POLL_MS);
    expect(attendanceWatchInterval(base, at("2026-09-29T18:00:00.000Z"))).toBe(ATTENDANCE_SETTLED_POLL_MS);
    expect(attendanceWatchInterval({ ...base, sessionState: "active" }, at("2026-09-29T12:00:00.000Z"))).toBe(ATTENDANCE_SETTLED_POLL_MS);
  });
});
