import { describe, expect, it } from "vitest";
import { acceptMascotActivity, MASCOT_ACTIVITIES, MASCOT_WORKDAYS, mascotActivityFromSignals, mascotWorkdayFromFacts, mergeMascotActivities, resolveMascotRuntime } from "./mascotRuntimeModel";
import { MASCOT_SEQUENCES } from "./mascotDebugSequences";
import { DEFAULT_DEBUG_SCENARIO, applyDayScenario } from "./scenarios";
import { mascotFactsFromDay } from "./useMascotRuntime";
import type { DebugDayState } from "./types";

const active = { connected: true, sessionState: "active" };
describe("shared mascot runtime", () => {
  it.each(["active", "clocked_in", "paused"])("recognizes live %s sessions", (sessionState) => {
    expect(mascotWorkdayFromFacts({ ...active, sessionState })).toBe(sessionState === "paused" ? "paused" : "active");
  });
  it("stays awake through clock-out while the EOD window is open, and rests after it", () => {
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "eod_due", eodOutstanding: true })).toBe("eod-due");
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "clocked_out", eodOutstanding: true })).toBe("eod-due");
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "clocked_out", eodOutstanding: false })).toBe("off-shift");
    // A session the server still marks eod_due after the grace rests too.
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "eod_due", eodOutstanding: false })).toBe("off-shift");
  });
  it("derives the EOD window from the day payload for the dock mascot", () => {
    const scenario = { ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: true, dayState: "eod_due" as const };
    const day = applyDayScenario(null, scenario)!;
    expect(mascotFactsFromDay(day, true).eodOutstanding).toBe(true);
    const past = { ...day, shift: { ...day.shift!, endsAt: new Date(Date.now() - 70 * 60_000).toISOString() } };
    expect(mascotFactsFromDay(past, true).eodOutstanding).toBe(false);
    const submitted = { ...day, report: { ...(day.report ?? {}), submitted_at: new Date().toISOString() } };
    expect(mascotFactsFromDay(submitted, true).eodOutstanding).toBe(false);
  });
  it.each([null, "scheduled", "clocked_out", "unknown"])("keeps %s sessions off shift without an observed workday", (sessionState) => {
    expect(mascotWorkdayFromFacts({ connected: true, sessionState })).toBe("off-shift");
  });
  it("stays awake for a confirmed provider observation before Work OS mirrors the session", () => {
    // Clocked out in Work OS while Worktivity still observes the employee
    // working: the companion must not sleep through an observed workday.
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "clocked_out", attendanceState: "active" })).toBe("active");
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: null, attendanceState: "paused" })).toBe("paused");
    // An unobserved, stale, or unattributed provider stays off shift, and an
    // open Work OS session still owns the state.
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "clocked_out", attendanceState: "off_shift" })).toBe("off-shift");
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "clocked_out", attendanceState: "unknown" })).toBe("off-shift");
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "scheduled", attendanceState: "off_shift" })).toBe("off-shift");
    expect(mascotWorkdayFromFacts({ connected: true, sessionState: "paused", attendanceState: "active" })).toBe("paused");
  });
  it("maps required prompts, late starts and disconnected state", () => {
    expect(mascotWorkdayFromFacts({ ...active, eodOutstanding: true, promptRequired: true, promptKind: "eod" })).toBe("eod-due");
    expect(mascotWorkdayFromFacts({ ...active, promptRequired: true, promptKind: "plan" })).toBe("check-in-due");
    expect(mascotWorkdayFromFacts({ ...active, promptRequired: false, promptKind: "optional" })).toBe("active");
    expect(mascotWorkdayFromFacts({ ...active, lateReasonRequired: true })).toBe("late");
    expect(mascotWorkdayFromFacts({ ...active, connected: false })).toBe("disconnected");
  });
  it("prioritizes in-flight retries, failures, decisions, then confirmed completion", () => {
    expect(mascotActivityFromSignals({ working: true, failed: true, completed: true })).toBe("working");
    expect(mascotActivityFromSignals({ failed: true, completed: true })).toBe("blocked");
    expect(mascotActivityFromSignals({ needsInput: true, completed: true })).toBe("needs-input");
    expect(mascotActivityFromSignals({ completed: true })).toBe("ready");
    expect(mascotActivityFromSignals({})).toBe("idle");
    expect(mergeMascotActivities("idle", "working")).toBe("working");
    expect(mergeMascotActivities("ready", "blocked")).toBe("blocked");
  });
  it("keeps disabled overrides inert including replay and motion", () => {
    const result = resolveMascotRuntime(active, {}, { enabled: false, mascotActivity: "blocked", mascotWorkday: "late", mascotMotion: "reduced", mascotReplay: 9 });
    expect(result).toMatchObject({ activity: "idle", workday: "active", pose: "focus", source: "live", reducedMotion: false, replay: 0 });
  });
  for (const workday of MASCOT_WORKDAYS) for (const activity of MASCOT_ACTIVITIES) {
    it(`isolates ${workday}/${activity} as a visual override`, () => {
      const scenario = { enabled: true, mascotActivity: activity, mascotWorkday: workday, mascotReplay: 2, mascotMotion: "reduced" as const };
      const before = JSON.stringify(scenario);
      expect(resolveMascotRuntime(active, { working: true }, scenario)).toMatchObject({ activity, workday, source: "scenario", replay: 2, reducedMotion: true });
      expect(JSON.stringify(scenario)).toBe(before);
    });
  }
  const dayStates: DebugDayState[] = ["no_shift", "scheduled", "shift_start", "clocked_in", "paused", "catch_up", "optional", "final_hour", "eod_due", "eod", "clocked_out"];
  it.each(dayStates)("uses the same %s scenario result in both windows", (dayState) => {
    const scenario = { ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: true, dayState };
    const day = applyDayScenario(null, scenario);
    expect(day).not.toBeNull();
    const main = resolveMascotRuntime(mascotFactsFromDay(day, true), {}, scenario);
    const avatar = resolveMascotRuntime({ connected: false }, {}, scenario);
    expect(avatar.workday).toBe(main.workday);
  });
  it.each(["clock_in_greeting", "awaiting_plan", "progress_check", "blocker_follow_up", "eod_due"])("maps companion force %s", (companionForce) => {
    expect(resolveMascotRuntime(active, {}, { enabled: true, companionForce }).activity).toBe("needs-input");
  });
  it("handles provider failure and force precedence", () => {
    expect(resolveMascotRuntime(active, {}, { enabled: true, niftyFailure: true }).activity).toBe("blocked");
    expect(resolveMascotRuntime(active, {}, { enabled: true, companionForce: "quiet" })).toMatchObject({ activity: "idle", workday: "paused" });
    expect(resolveMascotRuntime(active, {}, { enabled: true, companionForce: "offline", mascotActivity: "ready" })).toMatchObject({ activity: "ready", source: "scenario" });
  });
  it("rejects malformed replay values", () => {
    for (const mascotReplay of [-1, NaN, Infinity, 2.5]) expect(resolveMascotRuntime(active, {}, { enabled: true, mascotReplay }).replay).toBe(0);
  });
});
describe("cross-window activity leases", () => {
  const now = 10_000;
  const valid = { window: "avatar", scope: "org/person/day", activity: "working", sentAt: now, expiresAt: now + 20_000 };
  it("accepts a current other-window event", () => expect(acceptMascotActivity(valid, "main", valid.scope, now)).toBe(true));
  it("rejects echo, other scope, expired, malformed and unbounded events", () => {
    expect(acceptMascotActivity(valid, "avatar", valid.scope, now)).toBe(false);
    expect(acceptMascotActivity(valid, "main", "other/person/day", now)).toBe(false);
    for (const patch of [{ window: "debug" }, { activity: "done" }, { expiresAt: now }, { sentAt: now + 10_000 }, { expiresAt: now + 40_000 }, { sentAt: NaN }, { expiresAt: Infinity }]) {
      expect(acceptMascotActivity({ ...valid, ...patch }, "main", valid.scope, now)).toBe(false);
    }
    expect(acceptMascotActivity(null, "main", valid.scope, now)).toBe(false);
  });
});
describe("visual-only transition recipes", () => {
  it("completion returns to Auto and interruption waits for input", () => {
    expect(MASCOT_SEQUENCES.success.map((step) => step.activity)).toEqual(["working", "ready", null]);
    expect(MASCOT_SEQUENCES.interrupt.at(-1)?.activity).toBe("needs-input");
    expect(MASCOT_SEQUENCES.recover.map((step) => step.activity)).toEqual(["working", "blocked", "working", "ready", null]);
  });
});
