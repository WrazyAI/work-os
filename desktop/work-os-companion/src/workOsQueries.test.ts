import { describe, expect, it } from "vitest";
import { ACTIVITY_INTERVALS_PAGE_SIZE, activityIntervalsUrl } from "./workOsQueries";

describe("activityIntervalsUrl", () => {
  it("asks for one bounded page on the first request", () => {
    expect(activityIntervalsUrl("2026-09-28", null))
      .toBe(`/api/work-os/me/activity-intervals?date=2026-09-28&days=30&limit=${ACTIVITY_INTERVALS_PAGE_SIZE}`);
  });

  it("carries the keyset cursor for the next contiguous page", () => {
    const next = activityIntervalsUrl("2026-09-28", "2026-09-28T15:17:00.000Z|interval-1");
    expect(next).toContain("limit=12");
    expect(next).toContain(`cursor=${encodeURIComponent("2026-09-28T15:17:00.000Z|interval-1")}`);
  });
});
