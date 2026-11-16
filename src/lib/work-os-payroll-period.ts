import { validateWorkOsDate, validateWorkOsTimezone } from "@/lib/work-os-schedule-validation";
import type { PayrollPeriod } from "@/modules/work-os/payroll/contracts";
export { payrollAutoApprovalDue } from "@/modules/work-os/payroll/recap-policy";

function dateKey(year: number, month: number, day: number): string {
  // setUTCFullYear avoids Date.UTC treating years 00..99 as 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.toISOString().slice(0, 10);
}

export function resolvePayrollPeriod(payDate: string, timezone: string): PayrollPeriod {
  const key = validateWorkOsDate(payDate, "pay date");
  const zone = validateWorkOsTimezone(timezone);
  const [year, month, day] = key.split("-").map(Number);
  if (year < 1) throw new Error("pay date year must be positive");
  if (day !== 1 && day !== 16) throw new Error("pay date must be the first or sixteenth");
  const from = day === 16 ? dateKey(year, month, 1) : dateKey(year, month - 1, 16);
  const through = day === 16 ? dateKey(year, month, 15) : dateKey(year, month, 0);
  if (from.startsWith("0000")) throw new Error("pay period year must be positive");
  const first = new Date(`${from}T00:00:00.000Z`);
  first.setUTCDate(first.getUTCDate() + 6);
  const weekOneEnd = first.toISOString().slice(0, 10);
  first.setUTCDate(first.getUTCDate() + 1);
  return {
    payDate: key, from, through, timezone: zone,
    weeks: [
      { week: 1, from, through: weekOneEnd },
      { week: 2, from: first.toISOString().slice(0, 10), through },
    ],
  };
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
