/** Whether the employee's current workday is still open.
 *
 * Worktivity owns attendance, so a shift counts as open while either the
 * mirrored Work OS session is still running or a fresh provider observation
 * says the employee is working. The server gate, the web workspace, and the
 * Windows companion share this one predicate so every surface tells the same
 * story about an unfinished day.
 *
 * This module is deliberately dependency-free: the browser bundle, the
 * companion bundle, and the server all import it. */

export const OPEN_SHIFT_SESSION_STATES = ["clocked_in", "active", "paused", "eod_due"] as const;

export type ShiftGateSession = {
  state?: unknown;
  clocked_in_at?: unknown;
  clocked_out_at?: unknown;
  scheduled_ends_at?: unknown;
} | null | undefined;

export type ShiftGateAttendance = {
  source?: unknown;
  state?: unknown;
  stale?: unknown;
  observedAt?: unknown;
} | null | undefined;

function instant(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** True while the workday session is still running. A closed session — one
 * with a clock-out, or a state that names a finished shift — is never open. */
export function sessionStillOpen(session: ShiftGateSession): boolean {
  if (!session) return false;
  if (session.clocked_out_at) return false;
  const state = String(session.state ?? "");
  if (state === "clocked_out" || state === "closed") return false;
  if ((OPEN_SHIFT_SESSION_STATES as readonly string[]).includes(state)) return true;
  // A session that recorded a clock-in without a clock-out is still running,
  // whatever the state label says.
  return !!session.clocked_in_at;
}

/** True while a fresh Worktivity observation says the employee is working.
 * A stale observation is not evidence of an open shift. */
export function attendanceStillOpen(attendance: ShiftGateAttendance): boolean {
  if (!attendance) return false;
  if (String(attendance.source ?? "") !== "worktivity") return false;
  if (attendance.stale === true) return false;
  const state = String(attendance.state ?? "");
  return state === "active" || state === "paused";
}

/** Whether the workday is still open.
 *
 * Worktivity owns attendance, so the freshest fact decides: a provider
 * observation that is newer than the mirrored session settles a conflict,
 * and a clock-out recorded after the provider's last observation ends the
 * shift even when the provider has not been polled again yet. */
export function shiftStillOpen(input: { session?: ShiftGateSession; attendance?: ShiftGateAttendance }): boolean {
  const session = input.session ?? null;
  const attendance = input.attendance ?? null;
  const closedAt = instant(session?.clocked_out_at);
  const observedAt = instant(attendance?.observedAt);
  // A clock-out newer than the last observation is the fresher fact: the
  // employee has closed the shift, whatever the provider last reported.
  if (closedAt !== null && (observedAt === null || closedAt >= observedAt)) return false;
  if (attendance && String(attendance.source ?? "") === "worktivity" && attendance.stale !== true) {
    const state = String(attendance.state ?? "");
    if (state === "active" || state === "paused") return true;
    // The provider is the attendance authority: a fresh off-shift observation
    // ends the shift even when the mirrored session still says otherwise.
    if (state === "off_shift") return false;
  }
  return sessionStillOpen(session);
}

/** The final stretch of a scheduled shift where today's EOD may be drafted
 * before clock-out. Ten minutes matches the companion's EOD reminder window,
 * so the alert and the draft action open together. */
export const EOD_EARLY_DRAFT_WINDOW_MS = 10 * 60_000;

/** Whether today's scheduled EOD window is open: the final ten minutes before
 * the scheduled clock-out, and everything after it. A day without a scheduled
 * end has no window. */
export function eodDraftWindowOpen(input: {
  session?: ShiftGateSession;
  scheduledEndsAt?: unknown;
  now?: number;
}): boolean {
  const scheduledEnd = instant(input.scheduledEndsAt ?? input.session?.scheduled_ends_at);
  return scheduledEnd !== null && (input.now ?? Date.now()) >= scheduledEnd - EOD_EARLY_DRAFT_WINDOW_MS;
}

/** Whether today's EOD is still blocked by an open shift.
 *
 * An open shift blocks the report only before its final ten minutes. The
 * scheduled end comes from the mirrored session (or an explicit schedule end
 * passed by the caller); a day with no scheduled clock-out stays blocked,
 * because there is no end to open early. A closed shift is never blocked. */
export function eodDraftBlocked(input: {
  session?: ShiftGateSession;
  attendance?: ShiftGateAttendance;
  /** A schedule end to prefer when the session has not mirrored it yet. */
  scheduledEndsAt?: unknown;
  now?: number;
}): boolean {
  if (!shiftStillOpen(input)) return false;
  return !eodDraftWindowOpen(input);
}

/** The shared prompt for a shift that has not ended. The link label is inline
 * text in both surfaces; each surface finishes the sentence for its own
 * clock-out path (the companion drives Worktivity, the web points at it). */
export const EOD_SHIFT_OPEN_PREFIX = "Today's EOD opens 10 minutes before your scheduled clock-out, or";
export const EOD_SHIFT_OPEN_REBUILD_PREFIX = "Today's EOD can be rebuilt from 10 minutes before your scheduled clock-out, or";
export const EOD_SHIFT_OPEN_LINK_LABEL = "clock out";
export const EOD_SHIFT_OPEN_SUFFIX = {
  companion: " first to draft it now.",
  companionRebuild: " first to rebuild it now.",
  web: " in the Windows Work OS Companion first to draft it now.",
  webRebuild: " in the Windows Work OS Companion first to rebuild it now.",
} as const;

/** The server's refusal for a draft that would describe an unfinished day. */
export const EOD_SHIFT_OPEN_SERVER_MESSAGE =
  "Today's EOD opens 10 minutes before your scheduled clock-out. Clock out to draft it now.";

/** The machine-readable reason carried with a 409 so a client can show the
 * prompt instead of a generic failure. */
export const EOD_SHIFT_OPEN_REASON = "shift_open";
