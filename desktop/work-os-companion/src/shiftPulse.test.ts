import { describe, expect, it } from "vitest";
import { shiftPulse } from "./shiftPulse";
import type { WorkSession } from "./types";

const session: WorkSession = {
  id: "session-1", state: "active", scheduled_starts_at: "2026-08-14T09:00:00Z",
  scheduled_ends_at: "2026-08-14T17:00:00Z", clocked_in_at: "2026-08-14T09:15:00Z",
  clocked_out_at: null, paused_seconds: 15 * 60,
};
const shift = { startsAt: "2026-08-14T09:00:00Z", endsAt: "2026-08-14T17:00:00Z", timezone: "UTC", breaks: [] };

describe("shift pulse", () => {
  it("reports actual elapsed session time and scheduled shift progress", () => {
    expect(shiftPulse(session, shift, new Date("2026-08-14T13:00:00Z"))).toEqual({
      elapsedLabel: "03:30",
      breakLabel: "00:15",
      breakSeconds: 900,
      progressPercent: 50,
    });
  });

  it("keeps schedule progress truthful before explicit clock-in and clamps overtime", () => {
    expect(shiftPulse({ ...session, clocked_in_at: null }, shift, new Date("2026-08-14T13:00:00Z"))).toEqual({ elapsedLabel: "00:00", breakLabel: "00:00", breakSeconds: 0, progressPercent: 50 });
    expect(shiftPulse(session, shift, new Date("2026-08-14T19:00:00Z")).progressPercent).toBe(100);
  });

  it("deducts only observed Worktivity OnBreak time under the provider policy", () => {
    expect(shiftPulse({ ...session, paused_seconds: 3_600, provider_break_seconds: 600 }, shift, new Date("2026-08-14T13:00:00Z"), true)).toMatchObject({
      elapsedLabel: "03:35",
      breakLabel: "00:10",
      breakSeconds: 600,
    });
  });
});
