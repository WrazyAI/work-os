import type { PayrollPeriod } from "./contracts";

/** Pure local cutoff check. Comparing date/hour parts avoids inventing an
 * offset for ambiguous DST local wall times. A missed cron catches up later. */
export function payrollAutoApprovalDue(period: PayrollPeriod, at: Date, hour = 6): boolean {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("payroll cutoff hour must be 0–23");
  if (!Number.isFinite(at.getTime())) throw new Error("payroll instant must be valid");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: period.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? "";
  const localDate = `${value("year")}-${value("month")}-${value("day")}`;
  return localDate > period.payDate || (localDate === period.payDate && Number(value("hour")) >= hour);
}
