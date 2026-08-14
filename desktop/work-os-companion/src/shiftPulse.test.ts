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
      progressPercent: 50,
    });
  });

  it("clamps overtime progress and stays empty before explicit clock-in", () => {
    expect(shiftPulse({ ...session, clocked_in_at: null }, shift, new Date("2026-08-14T13:00:00Z"))).toEqual({ elapsedLabel: "00:00", progressPercent: 0 });
    expect(shiftPulse(session, shift, new Date("2026-08-14T19:00:00Z")).progressPercent).toBe(100);
  });
});
