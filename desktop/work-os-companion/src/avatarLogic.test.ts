import { describe, expect, it } from "vitest";
import {
  clockInNudge, collectNudges, eodNudge, hourlyNudge, isOnShift,
  avatarPrompt, clearRecordedUpdatePrompt, nextSnoozeDelayMs, shiftElapsedFraction, snoozeUntil,
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
  it("uses the recorded update and focus in the due prompt", () => {
    const facts = {
      ...base,
      promptRequired: true,
      promptKind: "hourly_fallback" as const,
      nextPromptAt: "2026-08-31T10:00:00Z",
      timezone: "UTC",
      lastSubstantiveUpdateAt: "2026-08-31T09:20:00Z",
      planIntent: "Finish the companion approval flow",
      completedTasks: 1,
      openTasks: 2,
    };
    const nudge = hourlyNudge(facts, NOW, new Set());
    expect(nudge?.title).toBe("Check-in due");
    expect(nudge?.body).toContain("9:20 AM");
    expect(nudge?.body).toContain("Finish the companion approval flow");
    expect(nudge?.body).toContain("1 completed and 2 open tasks");
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
  it("fires from the server EOD prompt before the scheduled end", () => {
    const facts = { ...base, promptKind: "eod" as const, nextPromptAt: "2026-08-31T15:50:00Z" };
    const at = new Date("2026-08-31T15:50:00Z").getTime();
    expect(eodNudge(facts, at, new Set())?.title).toBe("EOD review is due");
  });
});

describe("avatar prompt", () => {
  it("asks for an EOD submission with shift and task context", () => {
    const prompt = avatarPrompt({ ...base, promptKind: "eod", timezone: "UTC", completedTasks: 3, openTasks: 1 }, NOW);
    expect(prompt.action).toBe("open_eod");
    expect(prompt.body).toContain("4:00 PM");
    expect(prompt.body).toContain("3 completed and 1 open task");
    expect(prompt.body).toContain("submit your EOD");
  });
  it("stops EOD reminders after the report is submitted", () => {
    const facts = { ...base, promptKind: "eod" as const, eodSubmitted: true };
    expect(avatarPrompt(facts, NOW).heading).toBe("Off shift");
    expect(eodNudge(facts, NOW, new Set())).toBeNull();
  });
  it("asks for today's work immediately after clock-in", () => {
    const prompt = avatarPrompt({ ...base, promptKind: "plan" }, NOW);
    expect(prompt.heading).toBe("What are you working on today?");
    expect(prompt.body).toContain("This does not affect attendance.");
  });
  it("keeps paused and off-shift states explicit instead of asking for work", () => {
    expect(avatarPrompt({ ...base, sessionState: "paused" }, NOW).heading).toBe("Shift paused");
    expect(avatarPrompt({ ...base, clockedOutAt: "2026-08-31T09:30:00Z", sessionState: "clocked_out" }, NOW).heading).toBe("Off shift");
  });
});

describe("recorded update receipt", () => {
  it("clears the due prompt locally after a confirmed response", () => {
    const facts = clearRecordedUpdatePrompt({ ...base, promptRequired: true, promptKind: "hourly_fallback", nextPromptAt: "2026-08-31T10:00:00Z" });
    expect(facts.promptRequired).toBe(false);
    expect(facts.promptKind).toBeNull();
    expect(avatarPrompt(facts, NOW).kind).toBe("available");
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
  it("never renders negative elapsed time before a stale future shift boundary", () => {
    const future = { ...base, shiftStartsAt: "2026-09-03T15:00:00Z", clockedInAt: "2026-09-03T15:00:00Z" };
    expect(shiftElapsedFraction(future, NOW).label).toBe("0m");
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
