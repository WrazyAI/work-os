/**
 * Pure logic for the floating avatar companion: prompt cadence, snooze
 * escalation, notification decisions, and the shift timer fraction. Kept
 * side-effect free so the whole cadence is unit-testable.
 */

export interface CompanionDayFacts {
  shiftDate: string;
  promptRequired: boolean;
  nextPromptAt: string | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  sessionState: string | null;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  pausedSeconds: number;
}

export type CompanionNudgeKind = "hourly" | "clock_in" | "eod";

export interface CompanionNudge {
  kind: CompanionNudgeKind;
  /** Stable id so the scheduler can dedupe (one notification per instance). */
  key: string;
  title: string;
  body: string;
}

const SNOOZE_STEPS_MS = [10 * 60_000, 20 * 60_000];

/** Delay before the next re-prompt for a snoozed prompt instance. null = the
 * prompt is exhausted (snoozed through) and should be marked missed locally. */
export function nextSnoozeDelayMs(snoozeCount: number): number | null {
  return snoozeCount < SNOOZE_STEPS_MS.length ? SNOOZE_STEPS_MS[snoozeCount]! : null;
}

export function snoozeUntil(now: number, snoozeCount: number): number | null {
  const delay = nextSnoozeDelayMs(snoozeCount);
  return delay === null ? null : now + delay;
}

function minutesSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : (now - t) / 60_000;
}

/** Whether the employee is actively on the clock right now. */
export function isOnShift(facts: CompanionDayFacts, now: number): boolean {
  if (!facts.clockedInAt) return false;
  if (facts.sessionState === "paused") return false;
  if (facts.clockedOutAt) return false;
  return true;
}

/** Hourly prompt nudge: the server marked an update required and we have not
 * fired for this prompt instance yet. Only while on shift. */
export function hourlyNudge(facts: CompanionDayFacts, now: number, notifiedKeys: Set<string>): CompanionNudge | null {
  if (!isOnShift(facts, now) || !facts.promptRequired) return null;
  const dueAt = facts.nextPromptAt ? Date.parse(facts.nextPromptAt) : now;
  if (!Number.isFinite(dueAt) || dueAt > now) return null;
  const key = `hourly:${facts.shiftDate}:${facts.nextPromptAt ?? "now"}`;
  if (notifiedKeys.has(key)) return null;
  return {
    kind: "hourly",
    key,
    title: "Hourly update due",
    body: "Share what you're working on — tap the Work OS companion.",
  };
}

/** Clock-in nudge: the scheduled shift started ≤15 minutes ago and there is
 * no clock-in yet. Fires once per day. */
export function clockInNudge(facts: CompanionDayFacts, now: number, notifiedKeys: Set<string>): CompanionNudge | null {
  if (facts.clockedInAt || facts.sessionState === "clocked_out") return null;
  const start = minutesSince(facts.shiftStartsAt, now);
  if (start === null || start < 0 || start > 15) return null;
  const key = `clock_in:${facts.shiftDate}`;
  if (notifiedKeys.has(key)) return null;
  return {
    kind: "clock_in",
    key,
    title: "Shift started",
    body: "Your scheduled shift has begun — clock in when you're ready.",
  };
}

/** EOD nudge: on shift and the scheduled end time passed within the last
 * 30 minutes, or the session state explicitly says eod_due. */
export function eodNudge(facts: CompanionDayFacts, now: number, notifiedKeys: Set<string>): CompanionNudge | null {
  if (!isOnShift(facts, now) && facts.sessionState !== "eod_due") return null;
  const sinceEnd = minutesSince(facts.shiftEndsAt, now);
  const dueByState = facts.sessionState === "eod_due";
  const dueByTime = sinceEnd !== null && sinceEnd >= 0 && sinceEnd <= 30;
  if (!dueByState && !dueByTime) return null;
  const key = `eod:${facts.shiftDate}`;
  if (notifiedKeys.has(key)) return null;
  return {
    kind: "eod",
    key,
    title: "End of day",
    body: "Wrap up your shift — file your EOD report while the day is fresh.",
  };
}

/** Decide all nudges worth firing right now. */
export function collectNudges(facts: CompanionDayFacts, now: number, notifiedKeys: Set<string>): CompanionNudge[] {
  const nudges = [hourlyNudge(facts, now, notifiedKeys), clockInNudge(facts, now, notifiedKeys), eodNudge(facts, now, notifiedKeys)];
  return nudges.filter((nudge): nudge is CompanionNudge => nudge !== null);
}

/** Fraction of the scheduled shift elapsed, 0..1, for the avatar's timer ring.
 * Falls back to time since clock-in when no schedule exists. Paused time is
 * subtracted only via the session's paused_seconds snapshot. */
export function shiftElapsedFraction(facts: CompanionDayFacts, now: number): { fraction: number; label: string; remaining: string } {
  // The ring represents the scheduled workday, not attendance duration. A late
  // clock-in must not make the day look longer than the actual shift window.
  const scheduledStart = facts.shiftStartsAt ? new Date(facts.shiftStartsAt).getTime() : null;
  const start = scheduledStart && !Number.isNaN(scheduledStart) ? scheduledStart : facts.clockedInAt ? new Date(facts.clockedInAt).getTime() : null;
  const scheduledEnd = facts.shiftEndsAt ? new Date(facts.shiftEndsAt).getTime() : null;
  if (start === null || Number.isNaN(start)) return { fraction: 0, label: "", remaining: "" };
  const pausedMs = (facts.pausedSeconds || 0) * 1000;
  const end = scheduledEnd && !Number.isNaN(scheduledEnd) && scheduledEnd > start ? scheduledEnd : now;
  const total = Math.max(60_000, end - start);
  const elapsed = Math.max(0, Math.min(total, now - start - pausedMs));
  const minutes = Math.floor((now - start - pausedMs) / 60_000);
  const hours = Math.floor(minutes / 60);
  const label = hours > 0 ? `${hours}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
  const remainingMinutes = Math.max(0, Math.ceil((end - now) / 60_000));
  const remainingHours = Math.floor(remainingMinutes / 60);
  const remaining = remainingHours > 0 ? `${remainingHours}h ${String(remainingMinutes % 60).padStart(2, "0")}m left` : `${remainingMinutes}m left`;
  return { fraction: Math.max(0, Math.min(1, elapsed / total)), label, remaining };
}

/** Notification payload prefix per nudge kind (used by the scheduler tests). */
export function nudgeStackTraceKey(nudge: CompanionNudge): string {
  return nudge.key;
}
