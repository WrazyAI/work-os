import { describe, expect, it } from "vitest";
import { ACTIVITY_INTERVAL_ENSURE_TIMEOUT_MS, ACTIVITY_INTERVALS_PAGE_SIZE, activityIntervalDecisionBody, activityIntervalsUrl, dashboardInsightsUrl, openTaskCountUrl } from "./workOsQueries";

describe("activityIntervalDecisionBody", () => {
  it("echoes the review version, including zero for an unreviewed recap", () => {
    expect(JSON.parse(JSON.stringify(activityIntervalDecisionBody("confirm", undefined, 0))))
      .toEqual({ action: "confirm", expectedReviewVersion: 0 });
  });

  it("sends amended words with the reviewed version", () => {
    expect(JSON.parse(JSON.stringify(activityIntervalDecisionBody("amend", "I only read the queue.", 2))))
      .toEqual({ action: "amend", feedback: "I only read the queue.", expectedReviewVersion: 2 });
  });

  it("stays compatible with older servers that expose no review version", () => {
    expect(activityIntervalDecisionBody("confirm")).toEqual({ action: "confirm" });
    expect(activityIntervalDecisionBody("confirm", undefined, undefined)).not.toHaveProperty("expectedReviewVersion");
  });

  it("never sends an invalid number or the generation revision field", () => {
    for (const value of [-1, 1.5, Number.NaN]) {
      expect(activityIntervalDecisionBody("confirm", undefined, value)).toEqual({ action: "confirm" });
    }
    const body = activityIntervalDecisionBody("confirm", undefined, 3);
    expect(body).not.toHaveProperty("revision");
    expect(body.expectedReviewVersion).toBe(3);
  });
});

describe("openTaskCountUrl", () => {
  it("asks for one row with exact counts, excluding My day", () => {
    const url = openTaskCountUrl("2026-11-04");
    expect(url).toContain("view=open&limit=1");
    expect(url).toContain("excludeToday=true");
    expect(url).toContain("date=2026-11-04");
    expect(openTaskCountUrl()).not.toContain("date=");
  });
});

describe("dashboardInsightsUrl", () => {
  it("asks for the bounded Today summary instead of the full seven-day report", () => {
    expect(dashboardInsightsUrl("2026-11-04")).toBe("/api/work-os/me/insights?range=7d&summary=1&through=2026-11-04");
  });
});

describe("activityIntervalsUrl", () => {
  it("waits long enough for a recap that is still analysing screenshots", () => {
    expect(ACTIVITY_INTERVAL_ENSURE_TIMEOUT_MS).toBe(180_000);
  });

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
