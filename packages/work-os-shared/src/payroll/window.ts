import type { PayrollWeek } from "./contracts";

const DAY_MS = 86_400_000;

function parts(value: string): [number, number, number] {
  const match = typeof value === "string" ? value.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) throw new Error("payroll window date must be YYYY-MM-DD");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) throw new Error("payroll window date is invalid");
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw new Error("payroll window date is invalid");
  }
  return [year, month, day];
}

function key(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** Date.UTC treats years 00..99 as 1900..1999; setUTCFullYear does not. */
function utcDate(year: number, monthIndex: number, day: number): Date {
  const at = new Date(0);
  at.setUTCFullYear(year, monthIndex, day);
  return at;
}

export function addPayrollDays(value: string, days: number): string {
  const [year, month, day] = parts(value);
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day + days);
  return key(at);
}

export function payrollDayOfMonth(value: string): number {
  return parts(value)[2];
}

/** The pay date that follows a payroll window. A window ending on the 15th is
 * paid on the 16th; any later day is paid on the first of the next month. */
export function payrollPayDateForThrough(through: string): string {
  const [year, month, day] = parts(through);
  if (day <= 15) return key(utcDate(year, month - 1, 16));
  return key(utcDate(year, month, 1));
}

/** The canonical semimonthly window for a first-or-sixteenth pay date. */
export function payrollStandardWindow(payDate: string): { from: string; through: string } {
  const [year, month, day] = parts(payDate);
  if (day !== 1 && day !== 16) throw new Error("pay date must be the first or sixteenth");
  if (day === 16) {
    return { from: key(utcDate(year, month - 1, 1)), through: key(utcDate(year, month - 1, 15)) };
  }
  return { from: key(utcDate(year, month - 2, 16)), through: key(utcDate(year, month - 1, 0)) };
}

/** Two bounded weeks. A window shorter than eight days leaves the second week
 * empty (its start follows the last included day); callers must not invent
 * evidence for it. */
export function payrollWeeks(from: string, through: string): [PayrollWeek & { week: 1 }, PayrollWeek & { week: 2 }] {
  if (through < from) throw new Error("payroll window end must not precede its start");
  const firstEnd = addPayrollDays(from, 6) < through ? addPayrollDays(from, 6) : through;
  return [
    { week: 1, from, through: firstEnd },
    { week: 2, from: addPayrollDays(firstEnd, 1), through },
  ];
}

export function payrollIsStandardWindow(payDate: string, from: string, through: string): boolean {
  const standard = payrollStandardWindow(payDate);
  return standard.from === from && standard.through === through;
}

export function payrollPartialWindowBlocker(from: string, through: string): string {
  return `This review covers a partial payroll window (${from} to ${through}). Analysis is allowed; approval requires the full pay period.`;
}

/** A period ending today is still running; its pay date is the next day. */
export function payrollPeriodHasEnded(through: string, today: string): boolean {
  return through < today;
}

export function payrollWindowKey(from: string, through: string): string {
  parts(from);
  parts(through);
  return `${from}_${through}`;
}

/** The current window ending with the available days through `today`. */
export function currentPayrollWindowForDate(today: string): { from: string; through: string; payDate: string } {
  const [year, month, day] = parts(today);
  const from = day <= 15 ? key(utcDate(year, month - 1, 1)) : key(utcDate(year, month - 1, 16));
  return { from, through: today, payDate: payrollPayDateForThrough(today) };
}

export function payrollWindowDayCount(from: string, through: string): number {
  return Math.floor((Date.parse(`${through}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS) + 1;
}
