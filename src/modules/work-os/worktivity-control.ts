import type { WorktivityAttendanceState } from "./attendance";

export type WorktivityControlAction = "clock_in" | "clock_out" | "pause" | "resume";
export type WorktivityConfirmationRequirement = "late" | "exception" | "extended";

/** Keep only explicit clock-in acknowledgements and non-empty reasons. Missing
 * client fields must not erase the provider reconciliation defaults. */
export function worktivityClockInContext(input: Record<string, unknown>): Record<string, unknown> {
  const context: Record<string, unknown> = {};
  if (input.late_acknowledged === true) {
    context.late_acknowledged = true;
    if (typeof input.late_reason === "string" && input.late_reason.trim()) context.late_reason = input.late_reason.trim();
  }
  if (input.exception_acknowledged === true) {
    context.exception_acknowledged = true;
    if (typeof input.exception_reason === "string" && input.exception_reason.trim()) context.exception_reason = input.exception_reason.trim();
  }
  return context;
}

/** Timestamptz columns can arrive as ISO strings or JS Dates depending on the
 * data client; normalize both to epoch milliseconds. Anything else is invalid. */
export function worktivityInstant(value: unknown): number {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : Number.NaN;
  if (typeof value === "string") return Date.parse(value);
  return Number.NaN;
}

/** ISO normal form of a stored or provider instant, or null when unusable. */
export function worktivityIsoInstant(value: unknown): string | null {
  const instant = worktivityInstant(value);
  return Number.isFinite(instant) ? new Date(instant).toISOString() : null;
}

/** Whether an adopt is a fresh work interval (a later start) rather than the
 * same interval or a backfilled provider correction. */
export function worktivityRestarted(existingStart: string | null, observedStart: string): boolean {
  const previousStart = existingStart ? Date.parse(existingStart) : Number.NaN;
  const nextStart = Date.parse(observedStart);
  return Number.isFinite(nextStart) && (!Number.isFinite(previousStart) || nextStart > previousStart);
}

/** Provider instants may use different ISO offsets while representing the
 * same moment. Invalid provider times cannot replace a stored clock-in. */
export function worktivityClockInChanged(existingAt: unknown, providerAt: unknown): boolean {
  if (typeof providerAt !== "string") return false;
  const providerInstant = Date.parse(providerAt);
  if (!Number.isFinite(providerInstant)) return false;
  const existingInstant = worktivityInstant(existingAt);
  return !Number.isFinite(existingInstant) || existingInstant !== providerInstant;
}

export type WorktivityActionDecision =
  | { status: "ready" }
  | { status: "already_target" }
  | { status: "blocked"; message: string };

/** The provider snapshot decides whether a click is needed or valid. */
export function decideWorktivityAction(action: WorktivityControlAction, state: WorktivityAttendanceState): WorktivityActionDecision {
  if (state === "unknown") return { status: "blocked", message: "Worktivity status is unavailable. Refresh it before changing the workday." };

  const targetReached = (action === "clock_in" || action === "resume") && state === "active"
    || action === "clock_out" && state === "off_shift"
    || action === "pause" && state === "paused";
  if (targetReached) return { status: "already_target" };

  const allowed = action === "clock_in" && state === "off_shift"
    || action === "clock_out" && (state === "active" || state === "paused")
    || action === "pause" && state === "active"
    || action === "resume" && state === "paused";
  if (allowed) return { status: "ready" };

  const message = action === "clock_in" && state === "paused"
    ? "Worktivity is on a break. Resume work instead of clocking in again."
    : action === "clock_out"
      ? "Worktivity is already clocked out."
      : action === "pause"
        ? "Worktivity is not actively working, so it cannot start a break."
        : "Worktivity is not on a break, so it cannot resume work.";
  return { status: "blocked", message };
}

/** Use an exact provider clock-out when available. If Worktivity only reports
 * off-shift, the first fresh observation is the boundary and is marked inferred. */
export function worktivityClockOutBoundary(input: {
  clockedInAt: string | null | undefined;
  clockedOutAt: string | null | undefined;
  observedAt: string;
}): { at: string; inferred: boolean } | null {
  const startedAt = Date.parse(String(input.clockedInAt ?? ""));
  const exactAt = Date.parse(String(input.clockedOutAt ?? ""));
  if (Number.isFinite(startedAt) && Number.isFinite(exactAt) && exactAt > startedAt) {
    return { at: new Date(exactAt).toISOString(), inferred: false };
  }
  const observedAt = Date.parse(input.observedAt);
  if (Number.isFinite(startedAt) && Number.isFinite(observedAt) && observedAt > startedAt) {
    return { at: new Date(observedAt).toISOString(), inferred: true };
  }
  return null;
}

export function worktivityProjectionClockOutBoundary(input: {
  clockedInAt: string | null | undefined;
  clockedOutAt: string | null | undefined;
  clockedOutAtInferred?: boolean;
  observedAt: string;
}) {
  return worktivityClockOutBoundary({
    clockedInAt: input.clockedInAt,
    clockedOutAt: input.clockedOutAtInferred ? null : input.clockedOutAt,
    observedAt: input.observedAt,
  });
}

export function worktivityConfirmationRequirement(input: {
  action: WorktivityControlAction;
  now: string;
  scheduledStartsAt?: string | null;
  scheduledEndsAt?: string | null;
  body: Record<string, unknown>;
}): WorktivityConfirmationRequirement | null {
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return null;
  if (input.action === "clock_in") {
    const starts = input.scheduledStartsAt ? Date.parse(input.scheduledStartsAt) : Number.NaN;
    const ends = input.scheduledEndsAt ? Date.parse(input.scheduledEndsAt) : Number.NaN;
    const startable = Number.isFinite(starts) && now >= starts - 30 * 60_000 && now < ends;
    if (!startable) {
      if (input.body.exception_acknowledged !== true || typeof input.body.exception_reason !== "string" || !input.body.exception_reason.trim()) return "exception";
    } else if (now > starts + 15 * 60_000 && input.body.late_acknowledged !== true) {
      return "late";
    }
  }
  if (input.action === "clock_out" && input.scheduledEndsAt) {
    const ends = Date.parse(input.scheduledEndsAt);
    if (Number.isFinite(ends) && now > ends + 15 * 60_000 && input.body.extended_acknowledged !== true) return "extended";
  }
  return null;
}
