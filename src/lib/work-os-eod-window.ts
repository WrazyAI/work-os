import { createAdminClient } from "@/lib/supabase/admin";

export type EodActivityWindow = {
  startIso: string;
  endIso: string;
  /** `schedule` is the authoritative workday; `session` is the fallback when
   * the day has no usable scheduled shift (exception and unscheduled days). */
  source: "schedule" | "session";
};

function instant(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The workday window that bounds EOD activity context. The scheduled shift
 * wins when the day has one, so activity the provider recorded outside the
 * shift (overnight machine use, pre-shift frames) never reaches the report.
 * Without a schedule the session interval is the workday. Null means the
 * caller keeps its own day bounds (nothing defines a workday for this day). */
export function resolveEodActivityWindow(input: {
  scheduledStartsAt?: unknown;
  scheduledEndsAt?: unknown;
  clockedInAt?: unknown;
  clockedOutAt?: unknown;
  now?: unknown;
}): EodActivityWindow | null {
  const shiftStart = instant(input.scheduledStartsAt);
  const shiftEnd = instant(input.scheduledEndsAt);
  if (shiftStart !== null && shiftEnd !== null && shiftEnd > shiftStart) {
    return { startIso: new Date(shiftStart).toISOString(), endIso: new Date(shiftEnd).toISOString(), source: "schedule" };
  }
  const clockIn = instant(input.clockedInAt);
  if (clockIn !== null) {
    const clockOut = instant(input.clockedOutAt);
    const now = instant(input.now ?? new Date());
    const end = clockOut !== null && clockOut > clockIn ? clockOut : now !== null && now > clockIn ? now : null;
    if (end !== null) return { startIso: new Date(clockIn).toISOString(), endIso: new Date(end).toISOString(), source: "session" };
  }
  return null;
}

/** Maps a `work_sessions` row onto the resolver. The admin client returns
 * timestamptz columns as Date objects under snake_case names; reading
 * camelCase keys off the raw row would always resolve to null. */
export function eodActivityWindowFromSessionRow(row: {
  scheduled_starts_at?: unknown;
  scheduled_ends_at?: unknown;
  clocked_in_at?: unknown;
  clocked_out_at?: unknown;
} | null | undefined): EodActivityWindow | null {
  return resolveEodActivityWindow({
    scheduledStartsAt: row?.scheduled_starts_at,
    scheduledEndsAt: row?.scheduled_ends_at,
    clockedInAt: row?.clocked_in_at,
    clockedOutAt: row?.clocked_out_at,
  });
}

/** Resolves the window from the day's latest session row. */
export async function eodActivityWindowFor(organizationId: string, personId: string, date: string): Promise<EodActivityWindow | null> {
  const { data, error } = await createAdminClient().from("work_sessions")
    .select("scheduled_starts_at,scheduled_ends_at,clocked_in_at,clocked_out_at")
    .eq("organization_id", organizationId).eq("person_id", personId).eq("shift_date", date)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`load EOD activity window: ${error.message}`);
  return eodActivityWindowFromSessionRow(data);
}
