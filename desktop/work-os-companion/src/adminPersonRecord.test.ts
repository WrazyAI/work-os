import { describe, expect, it } from "vitest";
import { buildPersonWorkdays, recapDaysFromIntervals, recapReviewLabel, recapsForDay, recordDate, reportForDay } from "./admin/adminPersonRecord";

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

  it("derives observed time from the clock boundaries when a payload predates observed_seconds", () => {
    const clockedIn = "2026-11-06T15:00:09.628Z";
    const clockedOut = "2026-11-06T21:05:16.736Z";
    const paused = 2401;
    const elapsed = (Date.parse(clockedOut) - Date.parse(clockedIn)) / 1000;

    const workdays = buildPersonWorkdays([
      { shift_date: "2026-11-06T00:00:00.000Z", state: "clocked_out", clocked_in_at: clockedIn, clocked_out_at: clockedOut, paused_seconds: paused },
    ], [], 6, Date.parse("2026-11-09T00:00:00.000Z"));

    expect(workdays[0].observedSeconds).toBe(Math.round(elapsed - paused));
  });

  it("counts an open session up to the read time when observed_seconds is absent", () => {
    for (const state of ["clocked_in", "active", "paused", "eod_due"]) {
      const workdays = buildPersonWorkdays([
        { shift_date: "2026-11-09", state, clocked_in_at: "2026-11-09T15:00:00.000Z", paused_seconds: 600 },
      ], [], 6, Date.parse("2026-11-09T17:00:00.000Z"));

      expect(workdays[0].observedSeconds, state).toBe(6600);
    }
  });

  it("keeps a recorded zero instead of deriving time from the clock boundaries", () => {
    const workdays = buildPersonWorkdays([
      {
        shift_date: "2026-11-09",
        state: "closed",
        observed_seconds: 0,
        clocked_in_at: "2026-11-09T15:00:00.000Z",
        clocked_out_at: "2026-11-09T17:00:00.000Z",
        paused_seconds: 0,
      },
    ], [], 6, Date.parse("2026-11-09T18:00:00.000Z"));

    expect(workdays[0].observedSeconds).toBe(0);
  });

  it("does not accumulate time for a stale open row in a non-open state", () => {
    const workdays = buildPersonWorkdays([
      { shift_date: "2026-11-08", state: "off_shift", clocked_in_at: "2026-11-08T15:00:00.000Z", paused_seconds: 0 },
      { shift_date: "2026-11-07", state: "clocked_out", clocked_in_at: "2026-11-07T15:00:00.000Z", paused_seconds: 0 },
    ], [], 6, Date.parse("2026-11-09T18:00:00.000Z"));

    expect(workdays.map((day) => day.observedSeconds)).toEqual([0, 0]);
  });

  it("derives per-day recap counts from ready intervals when recapDays is absent", () => {
    const days = recapDaysFromIntervals([
      { local_date: "2026-11-09T00:00:00.000Z", generation_status: "ready", review_status: "confirmed" },
      { local_date: "2026-11-09", generation_status: "ready", review_status: "inferred" },
      { local_date: "2026-11-08", generation_status: "ready", review_status: "amended" },
      { local_date: "2026-11-07", generation_status: "failed", review_status: "inferred" },
    ]);

    expect(days).toEqual([
      { date: "2026-11-09", total: 2, reviewed: 1 },
      { date: "2026-11-08", total: 1, reviewed: 1 },
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
