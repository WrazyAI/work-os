import { describe, expect, it } from "vitest";
import { parseAdminRecordHref, safeAdminRecordHref } from "./recordLinks";
import { adminCalendarDate } from "./labels";

const person = "33333333-3333-4333-8333-333333333333";

describe("admin record links", () => {
  it("accepts only the exact same-app administration record shapes", () => {
    expect(safeAdminRecordHref("/work-os/admin/tasks?task=task-1"))
      .toBe("/work-os/admin/tasks?task=task-1");
    expect(safeAdminRecordHref("/work-os/admin/review?report=report-1"))
      .toBe("/work-os/admin/review?report=report-1");
    expect(safeAdminRecordHref(`/work-os/admin/people/${person}?recap=interval-1`))
      .toBe(`/work-os/admin/people/${person}?recap=interval-1`);
    // No companion destination exists for an update/workday record, so those
    // shapes are refused rather than opening an unrelated person drawer.
    expect(safeAdminRecordHref(`/work-os/admin/people/${person}?workday=workday-1`)).toBe(null);
    expect(safeAdminRecordHref(`/work-os/admin/people/${person}?update=update-1`)).toBe(null);
  });

  it("rejects model-authored, external, scheme-relative and ambiguous URLs", () => {
    for (const value of [
      "https://example.invalid/tasks?task=1",
      "http://evil.test",
      "//evil.test/work-os/admin/tasks?task=1",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "/work-os/admin/tasks?task=1&next=https://evil.test",
      "/work-os/admin/tasks?task=",
      "/work-os/admin/tasks?task=1#fragment",
      "/work-os/admin/people/../review?report=1",
      "/work-os/admin/people/%2e%2e/review?report=1",
      `/work-os/admin/people/${person}?recap=1&report=2`,
      "/work-os/admin/review?report=javascript:alert(1)",
      "/somewhere/else?task=1",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(safeAdminRecordHref(value), String(value)).toBe(null);
    }
  });

  it("accepted values render as the recorded calendar day, never shifted by the viewer", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      // The shared Work OS full-date form is short-month letter form, and the
      // recorded calendar day is unchanged west of UTC.
      expect(adminCalendarDate("2026-10-28")).toBe("Oct 28, 2026");
      expect(adminCalendarDate("2026-01-01")).toBe("Jan 1, 2026");
      // A recorded date serialized as a UTC-midnight instant keeps that day.
      expect(adminCalendarDate("2026-01-01T00:00:00.000Z")).toBe("Jan 1, 2026");
      expect(adminCalendarDate("not-a-date")).toBe("—");
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });

  it("maps a recap record to the administration recap focus target, never a fake EOD report", () => {
    expect(parseAdminRecordHref(`/work-os/admin/people/${person}?recap=interval-1`))
      .toEqual({ section: "people", focus: { personId: person, recapId: "interval-1" } });
    expect(parseAdminRecordHref("/work-os/admin/review?report=report-1"))
      .toEqual({ section: "review", focus: { reportId: "report-1" } });
    expect(parseAdminRecordHref("/work-os/admin/tasks?task=task-1"))
      .toEqual({ section: "tasks", focus: { taskId: "task-1" } });
    expect(parseAdminRecordHref("https://example.invalid/tasks?task=1")).toBe(null);
  });

  it("encodes values in the generated link only once", () => {
    const encoded = "recap%20with%20space";
    expect(safeAdminRecordHref(`/work-os/admin/people/${person}?recap=${encoded}`))
      .toBe(`/work-os/admin/people/${person}?recap=${encoded}`);
    // A decoded/unescaped value that could change the query structure is not
    // accepted as an app URL.
    expect(safeAdminRecordHref(`/work-os/admin/people/${person}?recap=a%26report%3D1`))
      .toBe(`/work-os/admin/people/${person}?recap=a%26report%3D1`);
  });
});
