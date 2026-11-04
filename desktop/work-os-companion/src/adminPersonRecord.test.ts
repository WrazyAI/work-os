import { describe, expect, it } from "vitest";
import { buildPersonWorkdays, recapReviewLabel, recapsForDay, recordDate, reportForDay } from "./admin/adminPersonRecord";

describe("admin person record", () => {
  it("keeps the recorded calendar day for plain dates and UTC-midnight instants", () => {
    expect(recordDate("2026-11-04")).toBe("2026-11-04");
    expect(recordDate("2026-11-04T00:00:00.000Z")).toBe("2026-11-04");
    expect(recordDate(new Date("2026-11-04T00:00:00.000Z"))).toBe("2026-11-04");
    expect(recordDate("")).toBe("");
  });

  it("reads a workday, not a session: sums observed time and merges recap counts", () => {
    const workdays = buildPersonWorkdays([
      { shift_date: "2026-11-04T00:00:00.000Z", state: "closed", observed_seconds: 3600, clocked_in_at: "2026-11-04T07:00:00Z" },
      { shift_date: "2026-11-04T00:00:00.000Z", state: "active", observed_seconds: 1800, clocked_in_at: "2026-11-04T12:00:00Z" },
      { shift_date: "2026-11-03", state: "closed", observed_seconds: 5400, clocked_in_at: "2026-11-03T07:00:00Z" },
    ], [
      { date: "2026-11-04", total: 3, reviewed: 1 },
      { date: "2026-11-02", total: 1, reviewed: 1 },
    ], 6);

    expect(workdays).toEqual([
      { date: "2026-11-04", state: "active", observedSeconds: 5400, recapCount: 3, recapReviewed: 1 },
      { date: "2026-11-03", state: "closed", observedSeconds: 5400, recapCount: 0, recapReviewed: 0 },
      { date: "2026-11-02", state: "unknown", observedSeconds: 0, recapCount: 1, recapReviewed: 1 },
    ]);
  });

  it("shows only ready recaps recorded on the requested local day", () => {
    const recaps = recapsForDay([
      { id: "a", local_date: "2026-11-04T00:00:00.000Z", generation_status: "ready" },
      { id: "b", local_date: "2026-11-04", generation_status: "failed" },
      { id: "c", local_date: "2026-11-03", generation_status: "ready" },
    ], "2026-11-04");
    expect(recaps.map((recap) => recap.id)).toEqual(["a"]);
  });

  it("opens the furthest-along report when a day has more than one", () => {
    const report = reportForDay([
      { id: "draft", report_date: "2026-11-04", status: "draft" },
      { id: "pending", report_date: "2026-11-04", status: "pending_review", submitted_at: "2026-11-04T17:00:00Z" },
      { id: "approved", report_date: "2026-11-04", status: "approved", submitted_at: "2026-11-03T17:00:00Z" },
      { id: "other", report_date: "2026-11-03", status: "approved" },
    ], "2026-11-04");
    expect(report?.id).toBe("approved");
  });

  it("names the recap review state in employee language", () => {
    expect(recapReviewLabel("confirmed")).toBe("Confirmed");
    expect(recapReviewLabel("amended")).toBe("Updated");
    expect(recapReviewLabel("inferred")).toBe("Not reviewed");
    expect(recapReviewLabel(null)).toBe("Not reviewed");
  });
});
