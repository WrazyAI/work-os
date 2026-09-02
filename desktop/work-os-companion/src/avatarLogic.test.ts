import { describe, expect, it } from "vitest";
import {
  clockInNudge, collectNudges, eodNudge, hourlyNudge, isOnShift,
  nextSnoozeDelayMs, shiftElapsedFraction, snoozeUntil,
  type CompanionDayFacts,
} from "./avatarLogic";

const NOW = new Date("2026-08-31T10:00:00Z").getTime();
const base: CompanionDayFacts = {
  shiftDate: "2026-08-31",
  promptRequired: false,
  nextPromptAt: null,
  shiftStartsAt: "2026-08-31T08:00:00Z",
  shiftEndsAt: "2026-08-31T16:00:00Z",
  sessionState: "active",
  clockedInAt: "2026-08-31T08:05:00Z",
  clockedOutAt: null,
  pausedSeconds: 0,
};

describe("isOnShift", () => {
  it("is true while clocked in and not paused", () => {
    expect(isOnShift(base, NOW)).toBe(true);
  });
  it("is false when clocked out, paused, or never clocked in", () => {
    expect(isOnShift({ ...base, clockedOutAt: "2026-08-31T09:00:00Z" }, NOW)).toBe(false);
    expect(isOnShift({ ...base, sessionState: "paused" }, NOW)).toBe(false);
    expect(isOnShift({ ...base, clockedInAt: null }, NOW)).toBe(false);
  });
});

describe("hourly nudge", () => {
  it("fires once per prompt instance while required and on shift", () => {
    const facts = { ...base, promptRequired: true, nextPromptAt: "2026-08-31T10:00:00Z" };
    const nudge = hourlyNudge(facts, NOW, new Set());
    expect(nudge?.kind).toBe("hourly");
    const seen = new Set([nudge!.key]);
    expect(hourlyNudge(facts, NOW + 1000, seen)).toBeNull();
  });
  it("never fires off shift", () => {
    const facts = { ...base, promptRequired: true, clockedInAt: null };
    expect(hourlyNudge(facts, NOW, new Set())).toBeNull();
  });
  it("waits until the server-scheduled prompt time", () => {
    const facts = { ...base, promptRequired: true, nextPromptAt: "2026-08-31T10:05:00Z" };
    expect(hourlyNudge(facts, NOW, new Set())).toBeNull();
  });
});

describe("clock-in nudge", () => {
  it("fires within 15 minutes of the scheduled start when not clocked in", () => {
    const facts: CompanionDayFacts = { ...base, clockedInAt: null, sessionState: "scheduled" };
    const at = new Date("2026-08-31T08:10:00Z").getTime();
    expect(clockInNudge(facts, at, new Set())?.kind).toBe("clock_in");
  });
  it("does not fire 30 minutes after start", () => {
    const facts: CompanionDayFacts = { ...base, clockedInAt: null, sessionState: "scheduled" };
    const at = new Date("2026-08-31T08:30:00Z").getTime();
    expect(clockInNudge(facts, at, new Set())).toBeNull();
  });
});

describe("eod nudge", () => {
  it("fires within 30 minutes after the scheduled end while on shift", () => {
    const at = new Date("2026-08-31T16:20:00Z").getTime();
    expect(eodNudge(base, at, new Set())?.kind).toBe("eod");
  });
  it("does not fire mid-shift", () => {
    expect(eodNudge(base, NOW, new Set())).toBeNull();
  });
});

describe("snooze escalation", () => {
  it("snoozes 10 then 20 minutes, then marks missed", () => {
    expect(nextSnoozeDelayMs(0)).toBe(600_000);
    expect(nextSnoozeDelayMs(1)).toBe(1_200_000);
    expect(nextSnoozeDelayMs(2)).toBeNull();
    expect(snoozeUntil(NOW, 0)).toBe(NOW + 600_000);
    expect(snoozeUntil(NOW, 2)).toBeNull();
  });
});

describe("shift elapsed fraction", () => {
  it("splits the shift into a 0..1 fraction with a readable label", () => {
    const mid = new Date("2026-08-31T12:05:00Z").getTime();
    const { fraction, label } = shiftElapsedFraction(base, mid);
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.6);
    expect(label).toBe("4h 05m");
    expect(shiftElapsedFraction(base, mid).remaining).toBe("3h 55m left");
  });
  it("anchors the ring to the scheduled day instead of a late clock-in", () => {
    const lateClockIn = { ...base, clockedInAt: "2026-08-31T10:00:00Z" };
    expect(shiftElapsedFraction(lateClockIn, NOW).fraction).toBeCloseTo(0.25);
  });
  it("clamps to 1 after the scheduled end", () => {
    const late = new Date("2026-08-31T20:00:00Z").getTime();
    expect(shiftElapsedFraction(base, late).fraction).toBe(1);
  });
});

describe("collectNudges", () => {
  it("returns every due nudge in one pass", () => {
    const facts: CompanionDayFacts = { ...base, promptRequired: true, nextPromptAt: "2026-08-31T10:00:00Z" };
    const at = new Date("2026-08-31T16:10:00Z").getTime();
    const lateFacts: CompanionDayFacts = { ...facts, clockedInAt: "2026-08-31T08:05:00Z", clockedOutAt: null };
    const nudges = collectNudges(lateFacts, at, new Set());
    expect(nudges.map((nudge) => nudge.kind).sort()).toEqual(["eod", "hourly"]);
  });
});
