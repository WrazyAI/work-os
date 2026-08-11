import assert from "node:assert/strict";
import {
  validateWorkOsBreakWindows,
  validateWorkOsDate,
  validateWorkOsDateRange,
  validateWorkOsTimezone,
} from "../src/lib/work-os-schedule-validation";

assert.equal(validateWorkOsTimezone("America/New_York"), "America/New_York");
assert.throws(() => validateWorkOsTimezone("Not/AZone"), /valid IANA timezone/);
assert.equal(validateWorkOsDate("2026-08-11", "date"), "2026-08-11");
assert.throws(() => validateWorkOsDate("2026-02-30", "date"), /valid calendar date/);
assert.throws(() => validateWorkOsDateRange("2026-08-11", "2026-08-10"), /before effective_from/);

assert.deepEqual(validateWorkOsBreakWindows([{ start: "12:00", end: "12:30" }], "09:00", "17:00"), [{ start: "12:00", end: "12:30" }]);
assert.deepEqual(validateWorkOsBreakWindows([{ start: "00:30", end: "01:00" }], "22:00", "06:00"), [{ start: "00:30", end: "01:00" }]);
assert.throws(() => validateWorkOsBreakWindows([{ start: "08:00", end: "08:30" }], "09:00", "17:00"), /within the configured shift/);
assert.throws(() => validateWorkOsBreakWindows([{ start: "11:00", end: "12:00" }, { start: "11:30", end: "12:30" }], "09:00", "17:00"), /cannot overlap/);

console.log("Work OS schedule validation tests passed.");
