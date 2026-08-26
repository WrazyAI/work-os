import { describe, expect, it } from "vitest";
import { formatWorkOsDate, formatWorkOsDateTime, formatWorkOsTime, shiftWorkOsDate } from "./dateFormat";

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

  it("degrades malformed dates and timezones instead of throwing", () => {
    expect(formatWorkOsDate("not-a-date")).toBe("—");
    expect(formatWorkOsDate("2026-02-31")).toBe("—");
    expect(formatWorkOsTime("not-a-date", "UTC")).toBe("—");
    expect(formatWorkOsTime("2026-08-26T12:00:00Z", "Not/A_Timezone")).toBe("—");
    expect(formatWorkOsDateTime("2026-08-26T12:00:00Z", "Not/A_Timezone")).toBe("—");
  });

  it("moves valid workday dates and safely rejects invalid ones", () => {
    expect(shiftWorkOsDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftWorkOsDate("2026-02-31", -1)).toBe("");
    expect(shiftWorkOsDate("", -1)).toBe("");
    expect(shiftWorkOsDate("not-a-date", -1)).toBe("");
  });
});
