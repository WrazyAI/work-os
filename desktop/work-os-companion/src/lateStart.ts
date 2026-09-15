/** Late-start policy, mirroring src/lib/work-os-late-start.ts on the web side.
 * A session that begins 30+ minutes after its scheduled start stays in a
 * "reason required" state until the employee records why — red Otto and the
 * dashboard reminder are the visible signals. */

export const PROLONGED_ABSENCE_MINUTES = 30;

type LateSession = {
  clocked_in_at?: string | null;
  scheduled_starts_at?: string | null;
  late_reason?: string | null;
} | null | undefined;

export function lateReasonRequired(session: LateSession): boolean {
  if (!session) return false;
  const started = Date.parse(String(session.clocked_in_at ?? ""));
  const scheduled = Date.parse(String(session.scheduled_starts_at ?? ""));
  if (!Number.isFinite(started) || !Number.isFinite(scheduled)) return false;
  if (started < scheduled + PROLONGED_ABSENCE_MINUTES * 60_000) return false;
  return !(typeof session.late_reason === "string" && session.late_reason.trim());
}

/** Whole minutes between the scheduled start and the actual clock-in when the
 * session is late enough to require a reason. Null otherwise. */
export function lateStartMinutes(session: LateSession): number | null {
  if (!session || !lateReasonRequired({ ...session, late_reason: null })) return null;
  const started = Date.parse(String(session.clocked_in_at ?? ""));
  const scheduled = Date.parse(String(session.scheduled_starts_at ?? ""));
  return Math.max(0, Math.round((started - scheduled) / 60_000));
}
