/**
 * Timestamps that cross the database boundary.
 *
 * The database client parses `timestamptz` into a `Date`. `String(date)`
 * produces "Mon Oct 20 2026 15:45:01 GMT+0000", which Postgres rejects, so a
 * write that looks correct fails — and the caller, which only logs a warning,
 * silently drops the row. Normalise at the boundary instead of trusting every
 * caller to remember.
 */

/** An ISO instant, or the fallback when the value is missing or unparseable. */
export function isoTimestamp(value: unknown, fallback: string | null = null): string | null {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

/** The `YYYY-MM-DD` day an instant belongs to, for a `date` column. */
export function isoDate(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const iso = isoTimestamp(value);
  return iso ? iso.slice(0, 10) : null;
}
