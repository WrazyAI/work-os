import { describe, expect, it } from "vitest";
import { formatWorkOsDate, formatWorkOsDateTime } from "./dateFormat";

describe("Work OS date formatting", () => {
  const referenceDate = new Date("2026-06-15T12:00:00Z");

  it("uses a full month and omits the current year", () => {
    expect(formatWorkOsDate("2026-08-24", "—", referenceDate)).toBe("August 24");
  });

  it("does not shift a calendar date across timezones", () => {
    expect(formatWorkOsDate("2026-01-01T00:15:00Z", "—", referenceDate)).toBe("January 1");
  });

  it("adds an apostrophe year when the date is outside the current year", () => {
    expect(formatWorkOsDate("2025-12-31", "—", referenceDate)).toBe("December 31 ’25");
  });

  it("includes the same date style when a timestamp needs its time", () => {
    expect(formatWorkOsDateTime("2026-08-24T15:30:00Z", "UTC", "—", referenceDate)).toBe("August 24, 3:30 PM");
    expect(formatWorkOsDateTime("2025-08-24T15:30:00Z", "UTC", "—", referenceDate)).toBe("August 24 ’25, 3:30 PM");
  });
});
