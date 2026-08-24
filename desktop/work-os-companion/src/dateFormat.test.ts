import { describe, expect, it } from "vitest";
import { formatWorkOsDate, formatWorkOsDateTime } from "./dateFormat";

describe("Work OS date formatting", () => {
  it("renders calendar dates with a named month and two-digit year", () => {
    expect(formatWorkOsDate("2026-08-24")).toBe("Aug 24 26");
  });

  it("does not shift a calendar date across timezones", () => {
    expect(formatWorkOsDate("2026-01-01T00:15:00Z")).toBe("Jan 01 26");
  });

  it("includes the same date style when a timestamp needs its time", () => {
    expect(formatWorkOsDateTime("2026-08-24T15:30:00Z", "UTC")).toBe("Aug 24 26, 3:30 PM");
  });
});
