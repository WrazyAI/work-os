/**
 * Pure logic for the floating avatar companion: prompt cadence, snooze
 * escalation, notification decisions, and the shift timer fraction. Kept
 * side-effect free so the whole cadence is unit-testable.
 */
import type { ProposedOperation, ToolCallResult } from "./interpretation";

export interface CompanionDayFacts {
  shiftDate: string;
  promptRequired: boolean;
  nextPromptAt: string | null;
  promptKind?: "plan" | "follow_up" | "hourly_fallback" | "eod" | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  sessionState: string | null;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  pausedSeconds: number;
  timezone?: string | null;
  planIntent?: string | null;
  lastSubstantiveUpdateAt?: string | null;
  employeeUpdates?: number;
  completedTasks?: number;
  openTasks?: number;
  eodSubmitted?: boolean;
}

export type CompanionNudgeKind = "hourly" | "clock_in" | "eod";

export interface CompanionNudge {
  kind: CompanionNudgeKind;
  /** Stable id so the scheduler can dedupe (one notification per instance). */
  key: string;
  title: string;
  body: string;
}

export type AvatarPromptKind = "agenda" | "check_in" | "eod" | "paused" | "off_shift" | "available";

export interface AvatarPrompt {
  kind: AvatarPromptKind;
  heading: string;
  body: string;
  compact: string;
  action: "open_eod" | null;
}

/** Clears only the locally displayed due state after the server confirms an
 * employee response. The next poll remains the authoritative schedule. */
export function clearRecordedUpdatePrompt<T extends CompanionDayFacts>(facts: T): T {
  return { ...facts, promptRequired: false, promptKind: null, nextPromptAt: null };
}

/** Identity for one agenda-due period: a shift plus its plan status. */
export function agendaAutoExpandKey(shiftDate: string, planStatus: string | null): string {
  return `${shiftDate}:${planStatus ?? ""}`;
}

/** Agenda auto-expand is edge-triggered: the composer opens once when the
 * agenda first becomes due, then never again for the same shift/plan state.
 * This keeps an explicit collapse by the employee from being fought by the
 * effect, while still surfacing a genuinely new agenda. Cleared (returns a null
 * key) as soon as the agenda is no longer due. */
export function nextAgendaAutoExpand(
  previousKey: string | null,
  agendaDue: boolean,
  key: string,
): { expand: boolean; key: string | null } {
  if (!agendaDue) return { expand: false, key: null };
  if (previousKey === key) return { expand: false, key };
  return { expand: true, key };
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

function timeLabel(iso: string | null | undefined, timezone: string | null | undefined): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone ?? undefined, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  } catch {
    return null;
  }
}

function shortText(value: string | null | undefined, max = 120): string | null {
  const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return normalized ? normalized.slice(0, max) : null;
}

function taskContext(facts: CompanionDayFacts): string | null {
  const completed = Math.max(0, facts.completedTasks ?? 0);
  const open = Math.max(0, facts.openTasks ?? 0);
  if (!completed && !open) return null;
  if (completed && open) return `${completed} completed and ${open} open task${open === 1 ? "" : "s"}`;
  if (completed) return `${completed} completed task${completed === 1 ? "" : "s"}`;
  return `${open} open task${open === 1 ? "" : "s"}`;
}

/** Builds one truthful, action-specific companion message from the current day.
 * It intentionally describes employee-authored updates and task state separately. */
export function avatarPrompt(facts: CompanionDayFacts, now: number): AvatarPrompt {
  const focus = shortText(facts.planIntent);
  const focusContext = focus ? `Today's focus: ${focus}.` : null;
  const lastUpdate = timeLabel(facts.lastSubstantiveUpdateAt, facts.timezone);
  const tasks = taskContext(facts);

  if (!facts.eodSubmitted && (facts.promptKind === "eod" || facts.sessionState === "eod_due")) {
    const end = timeLabel(facts.shiftEndsAt, facts.timezone);
    return {
      kind: "eod",
      heading: "EOD review is due",
      body: [end ? `Your scheduled shift ends at ${end}.` : "Your shift is ready to wrap up.", tasks ? `Today has ${tasks}.` : null, "Review the record and submit your EOD when it is accurate."].filter(Boolean).join(" "),
      compact: "Open EOD review to prepare and submit your report.",
      action: "open_eod",
    };
  }

  if (facts.promptKind === "plan") {
    return {
      kind: "agenda",
      heading: "What are you working on today?",
      body: [focusContext, "Set today's focus. This does not affect attendance."].filter(Boolean).join(" "),
      compact: "What are you working on today?",
      action: null,
    };
  }

  if (facts.promptRequired) {
    const firstCheckIn = facts.promptKind === "follow_up" && !facts.lastSubstantiveUpdateAt;
    return {
      kind: "check_in",
      heading: firstCheckIn ? "First check-in due" : "Check-in due",
      body: [
        firstCheckIn ? "Record what you started or moved forward." : lastUpdate ? `Your last recorded update was at ${lastUpdate}. What changed since then?` : "Record what changed since your last update.",
        focusContext,
        tasks ? `Current task state: ${tasks}.` : null,
      ].filter(Boolean).join(" "),
      compact: firstCheckIn ? "Tell Work OS what you started." : "Tell Work OS what changed.",
      action: null,
    };
  }

  if (facts.sessionState === "paused") {
    return { kind: "paused", heading: "Shift paused", body: "Check-ins resume when your shift resumes.", compact: "Check-ins are paused.", action: null };
  }
  if (!isOnShift(facts, now)) {
    return { kind: "off_shift", heading: "Off shift", body: "Clock in from Work OS when you are ready to begin.", compact: "Open Work OS to start your shift.", action: null };
  }
  const next = timeLabel(facts.nextPromptAt, facts.timezone);
  return {
    kind: "available",
    heading: "On shift",
    body: [next ? `Your next check-in is at ${next}.` : "Share progress whenever something meaningful changes.", focusContext].filter(Boolean).join(" "),
    compact: next ? `Next check-in at ${next}.` : "Share progress when it changes.",
    action: null,
  };
}

/** Whether the employee is actively on the clock right now. */
export function isOnShift(facts: CompanionDayFacts, now: number): boolean {
  if (facts.eodSubmitted) return false;
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
  const prompt = avatarPrompt(facts, now);
  return {
    kind: "hourly",
    key,
    title: prompt.heading,
    body: prompt.body,
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
  if (facts.eodSubmitted) return null;
  if (!isOnShift(facts, now) && facts.sessionState !== "eod_due") return null;
  const sinceEnd = minutesSince(facts.shiftEndsAt, now);
  const dueByState = facts.sessionState === "eod_due";
  const dueByPrompt = facts.promptKind === "eod" && (!facts.nextPromptAt || Date.parse(facts.nextPromptAt) <= now);
  const dueByTime = sinceEnd !== null && sinceEnd >= 0 && sinceEnd <= 30;
  if (!dueByState && !dueByPrompt && !dueByTime) return null;
  const key = `eod:${facts.shiftDate}`;
  if (notifiedKeys.has(key)) return null;
  const prompt = avatarPrompt(facts, now);
  return {
    kind: "eod",
    key,
    title: prompt.heading,
    body: prompt.body,
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
  const minutes = Math.floor(Math.max(0, now - start - pausedMs) / 60_000);
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

/** Persisted shape of one avatar chat turn. Tool state rides along so a vault
 * reload or cross-window sync restores approval cards and results intact. */
export interface AvatarStoredTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  meta?: string;
  createdAt: string;
  operations?: ProposedOperation[];
  toolResults?: ToolCallResult[];
}

/** Live avatar chat entry: persisted fields plus local-only review state. */
export interface AvatarChatEntryState {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  receipt?: string | null;
  createdAt?: string;
  operations?: ProposedOperation[];
  toolResults?: ToolCallResult[];
  taskOptions?: Array<{ id: string; title: string }>;
}

/** Serializes a live entry for the vault. System notices stay ephemeral. */
export function serializeAvatarChatEntry(entry: AvatarChatEntryState): AvatarStoredTurn | null {
  if (entry.role !== "user" && entry.role !== "assistant") return null;
  const turn: AvatarStoredTurn = {
    id: entry.id,
    role: entry.role,
    text: entry.text,
    createdAt: entry.createdAt ?? new Date().toISOString(),
  };
  if (entry.receipt) turn.meta = entry.receipt;
  if (entry.operations) turn.operations = entry.operations;
  if (entry.toolResults) turn.toolResults = entry.toolResults;
  return turn;
}

/** Merges reloaded turns over local state by id. Incoming text wins; local
 * tool state survives when the incoming turn does not carry it (another
 * window saved text-only turns). Entries missing from the incoming list are
 * dropped so conversation clears propagate. */
export function mergeAvatarChatEntries(current: AvatarChatEntryState[], incoming: AvatarStoredTurn[]): AvatarChatEntryState[] {
  const localById = new Map(current.map((entry) => [entry.id, entry]));
  return incoming.map((turn) => {
    const local = localById.get(turn.id);
    return {
      id: turn.id,
      role: turn.role,
      text: turn.text,
      receipt: turn.meta ?? local?.receipt ?? null,
      createdAt: turn.createdAt ?? local?.createdAt,
      operations: turn.operations ?? local?.operations,
      toolResults: turn.toolResults ?? local?.toolResults,
      taskOptions: local?.taskOptions ?? [],
    };
  });
}
