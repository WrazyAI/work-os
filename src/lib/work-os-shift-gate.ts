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
} | null | undefined;

export type ShiftGateAttendance = {
  source?: unknown;
  state?: unknown;
  stale?: unknown;
} | null | undefined;

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

/** Whether the employee's workday is still open. */
export function shiftStillOpen(input: { session?: ShiftGateSession; attendance?: ShiftGateAttendance }): boolean {
  return sessionStillOpen(input.session) || attendanceStillOpen(input.attendance);
}

/** The shared prompt for a shift that has not ended. The link label is inline
 * text in both surfaces; each surface finishes the sentence for its own
 * clock-out path (the companion drives Worktivity, the web points at it). */
export const EOD_SHIFT_OPEN_PREFIX = "Your shift has not ended yet, so today's EOD cannot be drafted.";
export const EOD_SHIFT_OPEN_REBUILD_PREFIX = "Your shift has not ended yet, so today's EOD cannot be rebuilt yet.";
export const EOD_SHIFT_OPEN_LINK_LABEL = "clock out";
export const EOD_SHIFT_OPEN_SUFFIX = {
  companion: " first, then draft your report.",
  companionRebuild: " first, then rebuild the draft.",
  web: " in the Windows Work OS Companion first, then draft your report.",
  webRebuild: " in the Windows Work OS Companion first, then rebuild the draft.",
} as const;

/** The server's refusal for a draft that would describe an unfinished day. */
export const EOD_SHIFT_OPEN_SERVER_MESSAGE =
  "Your shift has not ended yet, so today's EOD cannot be drafted. Clock out before drafting it.";

/** The machine-readable reason carried with a 409 so a client can show the
 * prompt instead of a generic failure. */
export const EOD_SHIFT_OPEN_REASON = "shift_open";
