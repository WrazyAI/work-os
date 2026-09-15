/** Late-start policy shared by the server and both clients. A session that
 * begins 30+ minutes after its scheduled start stays in a "reason required"
 * state until the employee records why — the companion shows it as red Otto
 * and the dashboards surface a reminder. Client bundles may import this file:
 * it has no server dependencies. */

export const PROLONGED_ABSENCE_MINUTES = 30;

type LateSession = {
  clocked_in_at?: unknown;
  scheduled_starts_at?: unknown;
  late_reason?: unknown;
};

/** True when the session started 30+ minutes after its scheduled start and no
 * late-start reason has been recorded yet. Unscheduled (exception) sessions
 * have no scheduled start and never require a reason. */
export function lateReasonRequired(session: LateSession | null | undefined): boolean {
  if (!session) return false;
  const started = Date.parse(String(session.clocked_in_at ?? ""));
  const scheduled = Date.parse(String(session.scheduled_starts_at ?? ""));
  if (!Number.isFinite(started) || !Number.isFinite(scheduled)) return false;
  if (started < scheduled + PROLONGED_ABSENCE_MINUTES * 60_000) return false;
  return !(typeof session.late_reason === "string" && session.late_reason.trim());
}

/** Whole minutes between the scheduled start and the actual clock-in, when the
 * session is late enough to require a reason. Null otherwise. */
export function lateStartMinutes(session: LateSession | null | undefined): number | null {
  if (!session || !lateReasonRequired({ ...session, late_reason: null })) return null;
  const started = Date.parse(String(session.clocked_in_at ?? ""));
  const scheduled = Date.parse(String(session.scheduled_starts_at ?? ""));
  return Math.max(0, Math.round((started - scheduled) / 60_000));
}
