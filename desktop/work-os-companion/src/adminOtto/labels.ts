import type { ReviewedRecap } from "../../../../src/modules/work-os/admin-otto/contracts";
import { formatWorkOsFullDate } from "../dateFormat";

/** The one vocabulary administration uses for a reviewed recap. */
export function adminReviewStatusLabel(status: ReviewedRecap["reviewStatus"]): string {
  return status === "amended" ? "Corrected by employee" : "Confirmed by employee";
}

export function adminRecapDate(iso: string | null | undefined, timezone?: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date);
  }
}

/** A recorded calendar date keeps its recorded day, even for a viewer west of
 * UTC. This delegates to the shared Work OS date model (`formatWorkOsFullDate`)
 * instead of re-parsing a date-only value as an instant in local time. */
export function adminCalendarDate(value: string | null | undefined): string {
  return formatWorkOsFullDate(value);
}

export function adminRecapTime(iso: string | null | undefined, timezone?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || undefined,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return null;
  }
}

/** "October 26, 2026, 10:00 AM – 11:00 AM", never a raw timestamp. */
export function adminRecapWindow(recap: ReviewedRecap): string {
  const date = adminRecapDate(recap.windowStart, recap.timezone);
  const start = adminRecapTime(recap.windowStart, recap.timezone);
  const end = adminRecapTime(recap.windowEnd, recap.timezone);
  if (!start || !end) return date;
  return `${date}, ${start} – ${end}`;
}

export function adminRecapReviewLine(recap: ReviewedRecap): string {
  const date = adminRecapDate(recap.reviewedAt, recap.timezone);
  const time = adminRecapTime(recap.reviewedAt, recap.timezone);
  return time ? `${date}, ${time}` : date;
}
