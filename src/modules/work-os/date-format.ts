const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

function dateOnlyValue(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
}

function yearInTimezone(date: Date, timezone?: string) {
  const year = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric" })
    .formatToParts(date)
    .find((part) => part.type === "year")?.value;
  return year ? Number(year) : date.getFullYear();
}

function contextualDate(date: Date, timezone: string | undefined, referenceDate: Date) {
  const rendered = new Intl.DateTimeFormat("en-US", { timeZone: timezone, month: "long", day: "numeric" }).format(date);
  const year = yearInTimezone(date, timezone);
  return year === yearInTimezone(referenceDate, timezone) ? rendered : `${rendered} ’${String(year).slice(-2)}`;
}

/** Formats a Work OS calendar date without allowing the local timezone to shift its day. */
export function formatWorkOsDate(value?: string | null, fallback = "—", referenceDate = new Date()) {
  if (!value) return fallback;
  const dateOnly = dateOnlyValue(value);
  const date = dateOnly ?? new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return contextualDate(date, dateOnly ? "UTC" : undefined, referenceDate);
}

/** Formats a timestamp with the shared Work OS date and the employee-local time. */
export function formatWorkOsDateTime(value?: string | null, timezone?: string, fallback = "—", referenceDate = new Date()) {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const dateLabel = contextualDate(date, timezone, referenceDate);
  const timeLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `${dateLabel}, ${timeLabel}`;
}
