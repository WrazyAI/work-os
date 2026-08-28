const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

function dateOnlyValue(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const numericYear = Number(year);
  const numericMonth = Number(month) - 1;
  const numericDay = Number(day);
  const date = new Date(Date.UTC(numericYear, numericMonth, numericDay, 12));
  return date.getUTCFullYear() === numericYear && date.getUTCMonth() === numericMonth && date.getUTCDate() === numericDay ? date : null;
}

function yearInTimezone(date: Date, timezone?: string) {
  try {
    const year = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" })
      .formatToParts(date)
      .find((part) => part.type === "year")?.value;
    return year ? Number(year) : date.getFullYear();
  } catch {
    return null;
  }
}

function contextualDate(date: Date, timezone: string | undefined, referenceDate: Date) {
  try {
    const rendered = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "long", day: "numeric" }).format(date);
    const year = yearInTimezone(date, timezone);
    const referenceYear = yearInTimezone(referenceDate, timezone);
    if (year === null || referenceYear === null) return null;
    return year === referenceYear ? rendered : `${rendered} ’${String(year).slice(-2)}`;
  } catch {
    return null;
  }
}

/** Formats a Work OS calendar date without allowing the local timezone to shift its day. */
export function formatWorkOsDate(value?: string | null, fallback = "—", referenceDate = new Date()) {
  if (!value) return fallback;
  const dateOnly = dateOnlyValue(value);
  if (DATE_ONLY_PATTERN.test(value) && !dateOnly) return fallback;
  const date = dateOnly ?? new Date(value);
  if (Number.isNaN(date.getTime()) || Number.isNaN(referenceDate.getTime())) return fallback;
  return contextualDate(date, dateOnly ? "UTC" : undefined, referenceDate) ?? fallback;
}

/** Formats a timestamp with the shared Work OS date and the employee-local time. */
export function formatWorkOsDateTime(value?: string | null, timezone?: string, fallback = "—", referenceDate = new Date()) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || Number.isNaN(referenceDate.getTime())) return fallback;
  const dateLabel = contextualDate(date, timezone, referenceDate);
  if (!dateLabel) return fallback;
  const timeLabel = formatWorkOsTime(value, timezone, fallback);
  return timeLabel === fallback ? fallback : `${dateLabel}, ${timeLabel}`;
}

/** Formats a timestamp without allowing malformed provider values to break rendering. */
export function formatWorkOsTime(value?: string | null, timezone?: string, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return fallback;
  }
}

/** Moves a strict Work OS calendar date while returning a safe fallback for invalid input. */
export function shiftWorkOsDate(value?: string | null, amount = 0, fallback = "") {
  if (!value || !Number.isInteger(amount)) return fallback;
  const date = dateOnlyValue(value);
  if (!date) return fallback;
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
