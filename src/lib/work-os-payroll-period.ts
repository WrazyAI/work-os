import { validateWorkOsDate, validateWorkOsTimezone } from "@/lib/work-os-schedule-validation";
import { localDateForTimezone } from "@/modules/work-os/companion";
import {
  addPayrollDays, currentPayrollWindowForDate, payrollPayDateForThrough, payrollStandardWindow,
  payrollWeeks, payrollWindowDayCount,
} from "@wrazy/work-os-shared/payroll/window";
import type { PayrollPeriod } from "@/modules/work-os/payroll/contracts";
export { payrollAutoApprovalDue } from "@/modules/work-os/payroll/recap-policy";

const MAX_WINDOW_DAYS = 31;

function dateKey(year: number, month: number, day: number): string {
  // setUTCFullYear avoids Date.UTC treating years 00..99 as 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.toISOString().slice(0, 10);
}

function requirePayDate(value: string): string {
  const key = validateWorkOsDate(value, "pay date");
  const year = Number(key.slice(0, 4));
  const day = Number(key.slice(8, 10));
  if (year < 1) throw new Error("pay date year must be positive");
  if (day !== 1 && day !== 16) throw new Error("pay date must be the first or sixteenth");
  return key;
}

function periodFromStoredDates(periodStart: string, periodEnd: string, payDate: string, timezone: string): PayrollPeriod {
  const from = validateWorkOsDate(periodStart, "period start");
  const through = validateWorkOsDate(periodEnd, "period end");
  const key = requirePayDate(payDate);
  const zone = validateWorkOsTimezone(timezone);
  if (through < from) throw new Error("period end must not precede its start");
  if (through >= key) throw new Error("period end must precede the pay date");
  if (payrollWindowDayCount(from, through) > MAX_WINDOW_DAYS) throw new Error("payroll window must be 31 days or fewer");
  return { payDate: key, from, through, timezone: zone, weeks: payrollWeeks(from, through) };
}

export function resolvePayrollPeriod(payDate: string, timezone: string): PayrollPeriod {
  const key = requirePayDate(payDate);
  const zone = validateWorkOsTimezone(timezone);
  const standard = payrollStandardWindow(key);
  return {
    payDate: key, from: standard.from, through: standard.through, timezone: zone,
    weeks: payrollWeeks(standard.from, standard.through),
  };
}

/** Any bounded window within recorded time, anchored to the pay date that
 * follows it. The end may not pass the employee's current local day. */
export function resolvePayrollWindow(from: string, through: string, timezone: string, now = new Date()): PayrollPeriod {
  const start = validateWorkOsDate(from, "analysis start");
  const end = validateWorkOsDate(through, "analysis end");
  const zone = validateWorkOsTimezone(timezone);
  if (!Number.isFinite(now.getTime())) throw new Error("payroll window instant must be valid");
  if (end < start) throw new Error("analysis end must not precede its start");
  if (payrollWindowDayCount(start, end) > MAX_WINDOW_DAYS) throw new Error("analysis window must be 31 days or fewer");
  const today = localDateForTimezone(now, zone);
  // A browser may compute "today" a calendar day ahead of the employee's
  // timezone. Allow that edge, but not a genuinely future window.
  if (end > addPayrollDays(today, 1)) throw new Error("analysis end cannot be in the future");
  return periodFromStoredDates(start, end, payrollPayDateForThrough(end), zone);
}

/** Rehydrate the exact window stored on a review. Runs and reads must use this
 * instead of recomputing a full semimonthly period from the pay date. */
export function buildStoredPayrollPeriod(periodStart: string, periodEnd: string, payDate: string, timezone: string): PayrollPeriod {
  return periodFromStoredDates(periodStart, periodEnd, payDate, timezone);
}

export function currentPayrollWindow(now: Date, timezone: string): { from: string; through: string; payDate: string } {
  if (!Number.isFinite(now.getTime())) throw new Error("payroll window instant must be valid");
  const zone = validateWorkOsTimezone(timezone);
  return currentPayrollWindowForDate(localDateForTimezone(now, zone));
}

export function latestDuePayrollPeriod(at: Date, timezone: string): PayrollPeriod {
  if (!Number.isFinite(at.getTime())) throw new Error("payroll instant must be valid");
  const zone = validateWorkOsTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const year = Number(parts.find(p => p.type === "year")?.value);
  const month = Number(parts.find(p => p.type === "month")?.value);
  const day = Number(parts.find(p => p.type === "day")?.value);
  return resolvePayrollPeriod(dateKey(year, month, day >= 16 ? 16 : 1), zone);
}
