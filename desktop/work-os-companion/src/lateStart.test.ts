import { describe, expect, it } from "vitest";
import { lateReasonRequired, lateStartMinutes, PROLONGED_ABSENCE_MINUTES } from "./lateStart";

const session = (overrides: Partial<Parameters<typeof lateReasonRequired>[0]> = {}) => ({
  clocked_in_at: "2026-09-15T09:35:00.000Z",
  scheduled_starts_at: "2026-09-15T09:00:00.000Z",
  late_reason: null as string | null,
  ...overrides,
});

describe("lateReasonRequired", () => {
  it("requires a reason for clock-ins 30+ minutes late", () => {
    expect(PROLONGED_ABSENCE_MINUTES).toBe(30);
    expect(lateReasonRequired(session())).toBe(true);
  });

  it("does not require a reason below the 30-minute threshold", () => {
    expect(lateReasonRequired(session({ clocked_in_at: "2026-09-15T09:29:59.000Z" }))).toBe(false);
    expect(lateReasonRequired(session({ clocked_in_at: "2026-09-15T09:30:00.000Z" }))).toBe(true);
  });

  it("clears as soon as a reason is recorded", () => {
    expect(lateReasonRequired(session({ late_reason: "Doctor appointment" }))).toBe(false);
    expect(lateReasonRequired(session({ late_reason: "   " }))).toBe(true);
  });

  it("never requires a reason for unscheduled or missing sessions", () => {
    expect(lateReasonRequired(null)).toBe(false);
    expect(lateReasonRequired(session({ scheduled_starts_at: null }))).toBe(false);
    expect(lateReasonRequired(session({ clocked_in_at: null }))).toBe(false);
  });

  it("reports whole minutes late for labels", () => {
    expect(lateStartMinutes(session())).toBe(35);
    expect(lateStartMinutes(session({ late_reason: "Already explained" }))).toBe(35);
    expect(lateStartMinutes(session({ clocked_in_at: "2026-09-15T09:10:00.000Z" }))).toBeNull();
  });
});
