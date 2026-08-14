import { describe, expect, it } from "vitest";
import type { DayData, WorkSession } from "./types";
import { sessionGate } from "./sessionGate";

function day(session: WorkSession | null, hasShift = true): DayData {
  return {
    at: "2026-08-14T09:00:00.000Z", shiftDate: "2026-08-14",
    shift: hasShift ? { startsAt: "2026-08-14T09:00:00.000Z", endsAt: "2026-08-14T17:00:00.000Z", timezone: "UTC", breaks: [] } : null,
    prompt: { kind: null, nextPromptAt: null, required: false, reason: "" },
    tasks: [], evidence: [], proposals: [], report: null, session, plan: null,
  };
}

const baseSession: WorkSession = {
  id: "session-1", state: "scheduled", scheduled_starts_at: null, scheduled_ends_at: null,
  clocked_in_at: null, clocked_out_at: null, paused_seconds: 0,
};

describe("desktop session gate", () => {
  it.each(["clocked_in", "active", "paused", "eod_due"] as const)("treats %s as writable", (state) => {
    expect(sessionGate(day({ ...baseSession, state }))).toMatchObject({ active: true, canClockIn: false });
  });

  it("offers explicit clock-in when a shift exists", () => {
    expect(sessionGate(day(null))).toEqual({ active: false, canClockIn: true, message: "Clock in explicitly to confirm a plan or send work updates." });
  });

  it("allows an explicit acknowledged exception session without a current shift", () => {
    expect(sessionGate(day(null, false))).toMatchObject({ active: false, canClockIn: true });
    expect(sessionGate(day(null, false)).message).toMatch(/exception session/);
  });

  it("keeps a closed session blocked", () => {
    expect(sessionGate(day({ ...baseSession, state: "clocked_out" }))).toMatchObject({ active: false, canClockIn: false });
  });
});
