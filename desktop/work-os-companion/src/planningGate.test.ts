import { describe, expect, it } from "vitest";
import { shouldAutoOpenPlanning, shouldCloseAutoOpenedPlanning } from "./planningGate";

const base = { active: true, dayLive: true, promptKind: "plan", promptRequired: true, planStatus: "draft" };

describe("planning modal boot gate", () => {
  it("waits for a live server day before auto-opening", () => {
    expect(shouldAutoOpenPlanning({ ...base, dayLive: false })).toBe(false);
    expect(shouldAutoOpenPlanning(base)).toBe(true);
  });

  it("never auto-opens with a confirmed plan or a non-plan prompt", () => {
    expect(shouldAutoOpenPlanning({ ...base, planStatus: "confirmed" })).toBe(false);
    expect(shouldAutoOpenPlanning({ ...base, promptKind: "follow_up" })).toBe(false);
    expect(shouldAutoOpenPlanning({ ...base, promptRequired: false })).toBe(false);
    expect(shouldAutoOpenPlanning({ ...base, active: false })).toBe(false);
  });

  it("closes an auto-opened modal once the live day proves the plan confirmed", () => {
    expect(shouldCloseAutoOpenedPlanning({ open: true, autoOpened: true, planStatus: "confirmed" })).toBe(true);
    expect(shouldCloseAutoOpenedPlanning({ open: true, autoOpened: true, planStatus: "draft" })).toBe(false);
    expect(shouldCloseAutoOpenedPlanning({ open: true, autoOpened: false, planStatus: "confirmed" })).toBe(false);
    expect(shouldCloseAutoOpenedPlanning({ open: false, autoOpened: true, planStatus: "confirmed" })).toBe(false);
  });
});
