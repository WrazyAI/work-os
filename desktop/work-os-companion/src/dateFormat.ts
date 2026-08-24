const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;

function dateOnlyValue(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
}

/** Formats a Work OS calendar date without allowing the local timezone to shift its day. */
export function formatWorkOsDate(value?: string | null, fallback = "—") {
  if (!value) return fallback;
  const dateOnly = dateOnlyValue(value);
  const date = dateOnly ?? new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: dateOnly ? "UTC" : undefined,
    month: "short",
    day: "2-digit",
    year: "2-digit",
  }).format(date).replace(",", "");
}

/** Formats a timestamp with the shared Work OS date and the employee-local time. */
export function formatWorkOsDateTime(value?: string | null, timezone?: string, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  }).format(date).replace(",", "");
}
