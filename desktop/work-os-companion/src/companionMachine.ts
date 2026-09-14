import type { DayData } from "./types";
import type { SessionGate } from "./sessionGate";

export type CompanionState =
  | "idle"
  | "clock_in_greeting"
  | "awaiting_plan"
  | "progress_check"
  | "blocker_follow_up"
  | "eod_due"
  | "offline"
  | "quiet";

export type CompanionAction = "open_composer" | "open_plan" | "open_eod" | "open_tasks";

export interface CompanionPrompt {
  id: string;
  title: string;
  body: string;
  action: CompanionAction;
  severity: "info" | "attention";
}

export interface CompanionDecision {
  state: CompanionState;
  prompt: CompanionPrompt | null;
  suppressReason: string | null;
}

/** Durable, non-secret reminder bookkeeping. Persisted per device. */
export interface CompanionRecord {
  fired: Record<string, string>;
  answered: Record<string, string>;
  ignored: Record<string, number>;
  ignoredAt: Record<string, string>;
  quiet: { active: boolean };
  snooze: { cause: string | null; until: string | null };
}

export const EMPTY_COMPANION_RECORD: CompanionRecord = {
  fired: {},
  answered: {},
  ignored: {},
  ignoredAt: {},
  quiet: { active: false },
  snooze: { cause: null, until: null },
};

/** Maximum companion-initiated notifications in any rolling hour (EOD exempt). */
export const MAX_PROMPTS_PER_HOUR = 3;
/** No ordinary prompts within the final hour of the shift. */
export const FINAL_HOUR_MS = 60 * 60_000;
/** The EOD prompt window opens this long before the shift ends. */
export const EOD_WINDOW_MS = 10 * 60_000;
/** A clock-in greeting is only shown this close to the clock-in. */
export const GREETING_WINDOW_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;
const BLOCKER_FOLLOW_UP_MS = 45 * 60_000;

export interface CompanionInput {
  now: Date;
  online: boolean;
  gate: SessionGate;
  day: DayData | null;
  record: CompanionRecord;
  /** Set by the scenario debugger to pin a state for testing. */
  force?: CompanionState | null;
  /** ISO time of the last recorded update or plan confirmation. */
  lastResponseAt: string | null;
}

function openBlocker(day: DayData | null): string | null {
  const items = day?.plan?.items ?? [];
  const blocked = items.find((item) => typeof item.blocker === "string" && item.blocker.trim() && item.completion_state !== "completed");
  return blocked ? blocked.blocker!.trim() : null;
}

function planConfirmed(day: DayData | null): boolean {
  return !!day?.plan && Array.isArray(day.plan.items) && day.plan.items.length > 0 && day.plan.status === "confirmed";
}

function minutesUntil(shiftEnd: string | null, now: Date): number | null {
  if (!shiftEnd) return null;
  const parsed = Date.parse(shiftEnd);
  if (!Number.isFinite(parsed)) return null;
  return Math.round((parsed - now.getTime()) / 60_000);
}

function inFinalHour(input: CompanionInput): boolean {
  const day = input.day;
  if (!day?.shift?.endsAt) return false;
  const endsAt = Date.parse(day.shift.endsAt);
  if (!Number.isFinite(endsAt)) return false;
  return endsAt - input.now.getTime() <= FINAL_HOUR_MS && input.now.getTime() < endsAt;
}

function withinRollingHour(iso: string, now: Date): boolean {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) && now.getTime() - parsed < 60 * 60_000;
}

function backoffRemainingMs(cause: string, record: CompanionRecord, now: Date): number {
  const count = record.ignored[cause] ?? 0;
  if (!count) return 0;
  const ignoredAt = record.ignoredAt[cause];
  if (!ignoredAt) return 0;
  const parsed = Date.parse(ignoredAt);
  if (!Number.isFinite(parsed)) return 0;
  const window = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (count - 1));
  const remaining = parsed + window - now.getTime();
  return remaining > 0 ? remaining : 0;
}

function answeredSinceFire(record: CompanionRecord, cause: string, firedAt: string, lastResponseAt: string | null): boolean {
  const answeredAt = record.answered[cause];
  if (answeredAt && Date.parse(answeredAt) > Date.parse(firedAt)) return true;
  return !!lastResponseAt && Date.parse(lastResponseAt) > Date.parse(firedAt);
}

/**
 * Dedupe + backoff for ordinary prompts in one window: after firing, a prompt
 * stays silent for its current backoff window, which escalates with each
 * ignore; once the window passes it may fire again — an ignored prompt
 * re-surfaces with escalating spacing instead of disappearing forever. A
 * response recorded after the fire re-arms the cause immediately (markResponded
 * also resets its ignore count).
 */
function ordinarySuppressed(record: CompanionRecord, cause: string, lastResponseAt: string | null, now: Date): boolean {
  const firedAt = record.fired[cause];
  if (!firedAt) return false;
  if (answeredSinceFire(record, cause, firedAt, lastResponseAt)) return false;
  const ignored = record.ignored[cause] ?? 0;
  const window = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** ignored);
  return now.getTime() < Date.parse(firedAt) + window;
}

/** The EOD prompt deduplicates but does not back off: it fires once per session/schedule cause. */
function eodReminderStatus(record: CompanionRecord, cause: string, lastResponseAt: string | null): "already-reminded" | "acknowledged" | null {
  const firedAt = record.fired[cause];
  if (!firedAt) return null;
  return answeredSinceFire(record, cause, firedAt, lastResponseAt) ? "acknowledged" : "already-reminded";
}

/**
 * The deterministic companion decision core. Given the workday facts and the
 * durable reminder record, decides the companion state and — if a prompt is
 * due — the prompt to surface, applying every notification quality control:
 * dedupe, backoff after ignored prompts, rolling-hour frequency cap,
 * final-hour suppression, post-clock-out silence, quiet mode, and snooze.
 * The EOD prompt is exempt from backoff/cap/suppression (it is the one
 * required interrupt) but still deduplicates.
 */
export function evaluateCompanion(input: CompanionInput): CompanionDecision {
  const { now, gate, day, record } = input;
  if (!input.online) return { state: "offline", prompt: null, suppressReason: "offline" };

  const sessionState = day?.session?.state;
  if (sessionState === "clocked_out") return { state: "idle", prompt: null, suppressReason: "clocked-out" };
  if (!gate.active) return { state: "idle", prompt: null, suppressReason: "off-shift" };

  if (input.force) {
    const forced = forcedDecision(input, input.force);
    if (forced) {
      if (forced.prompt) {
        const firedAt = record.fired[forced.prompt.id];
        if (firedAt && now.getTime() - Date.parse(firedAt) < 120_000) {
          return { state: forced.state, prompt: null, suppressReason: "already-reminded" };
        }
      }
      return forced;
    }
  }

  const sessionId = day?.session?.id ?? day?.shiftDate ?? "unknown";
  const lastResponseAt = input.lastResponseAt;
  const shiftEnd = day?.shift?.endsAt ?? null;
  const minutesLeft = minutesUntil(shiftEnd, now);

  // EOD is the one required interrupt: it opens EOD_WINDOW_MS before the shift
  // ends (or when the server marks the prompt as EOD) and pierces quiet mode
  // and snooze — the employee still gets their mandatory wrap-up — but it is
  // deduplicated until a response lands.
  const eodWindow = minutesLeft !== null && minutesLeft <= EOD_WINDOW_MS / 60_000 && minutesLeft > -15;
  if (day?.prompt?.kind === "eod" || eodWindow) {
    const cause = `eod:${sessionId}:${shiftEnd ?? "unscheduled"}`;
    const minutes = minutesLeft === null ? null : Math.max(0, minutesLeft);
    const prompt: CompanionPrompt = {
      id: cause,
      title: "Record your final update",
      body: minutes === null
        ? "Your workday is wrapping up. Record what changed and I'll prepare the EOD draft."
        : minutes <= 1
          ? "Shift end is here. Record your final update and I'll prepare the EOD draft."
          : `Your shift ends in ${minutes} minutes. Record your final update and I'll prepare the EOD draft.`,
      action: "open_eod",
      severity: "attention",
    };
    const eodStatus = eodReminderStatus(record, cause, lastResponseAt);
    if (eodStatus) {
      return { state: "eod_due", prompt: null, suppressReason: eodStatus };
    }
    return { state: "eod_due", prompt, suppressReason: null };
  }

  if (record.quiet.active) return { state: "quiet", prompt: null, suppressReason: "quiet-mode" };
  if (record.snooze.until && Date.parse(record.snooze.until) > now.getTime()) {
    return { state: "quiet", prompt: null, suppressReason: "snoozed" };
  }

  const blocker = openBlocker(day);
  const overdueCount = day?.tasks?.filter((task) => task.completed !== true && typeof task.due_date === "string" && task.due_date.slice(0, 10) < day.shiftDate).length ?? 0;
  const openCount = day?.tasks?.filter((task) => task.completed !== true).length ?? 0;
  const frequencyCount = Object.values(record.fired).filter((iso) => withinRollingHour(iso, now)).length;
  const ordinarySuppression: string | null = inFinalHour(input) ? "final-hour" : frequencyCount >= MAX_PROMPTS_PER_HOUR ? "frequency-cap" : null;

  // Plan confirmation prompt (required by the server, not an ordinary nudge).
  if (day?.prompt?.kind === "plan" && day.prompt.required && !planConfirmed(day)) {
    const cause = `plan:${sessionId}`;
    const suppressed = ordinarySuppression === "final-hour" ? null : ordinarySuppression;
    const backoff = suppressed ? 0 : backoffRemainingMs(cause, record, now);
    if (backoff > 0 || suppressed) {
      return { state: "awaiting_plan", prompt: null, suppressReason: backoff > 0 ? "backoff" : suppressed };
    }
    if (ordinarySuppressed(record, cause, lastResponseAt, now)) {
      return { state: "awaiting_plan", prompt: null, suppressReason: "already-reminded" };
    }
    return {
      state: "awaiting_plan",
      prompt: {
        id: cause,
        title: "What are you working on today?",
        body: openCount ? `Confirm today's plan — ${openCount} open task${openCount === 1 ? "" : "s"} are on your plate.` : "Confirm what you are working on today.",
        action: "open_plan",
        severity: "attention",
      },
      suppressReason: null,
    };
  }

  // Blocker follow-up: an open blocker unaddressed for 45+ minutes.
  if (blocker && (!lastResponseAt || now.getTime() - Date.parse(lastResponseAt) > BLOCKER_FOLLOW_UP_MS)) {
    const cause = `blocker:${sessionId}:${blocker}`;
    const suppressed = ordinarySuppression;
    const backoff = suppressed ? 0 : backoffRemainingMs(cause, record, now);
    if (backoff > 0 || suppressed) {
      return { state: "blocker_follow_up", prompt: null, suppressReason: backoff > 0 ? "backoff" : suppressed };
    }
    if (ordinarySuppressed(record, cause, lastResponseAt, now)) {
      return { state: "blocker_follow_up", prompt: null, suppressReason: "already-reminded" };
    }
    return {
      state: "blocker_follow_up",
      prompt: {
        id: cause,
        title: "Is the blocker still blocking?",
        body: `“${blocker}” — still the dependency? Record what changed and I'll pass it along.`,
        action: "open_composer",
        severity: "attention",
      },
      suppressReason: null,
    };
  }

  // Hourly progress check (server-scheduled) with an overdue mention.
  const nextPromptAt = day?.prompt?.nextPromptAt ?? null;
  if (day?.prompt?.kind && nextPromptAt && now.getTime() >= Date.parse(nextPromptAt)) {
    const cause = `progress:${sessionId}:${nextPromptAt}`;
    const suppressed = ordinarySuppression;
    const backoff = suppressed ? 0 : backoffRemainingMs(cause, record, now);
    if (backoff > 0 || suppressed) {
      return { state: "progress_check", prompt: null, suppressReason: backoff > 0 ? "backoff" : suppressed };
    }
    if (ordinarySuppressed(record, cause, lastResponseAt, now)) {
      return { state: "progress_check", prompt: null, suppressReason: "already-reminded" };
    }
    const intent = (day.plan?.focus_summary ?? day.plan?.freeform_intent)?.trim();
    return {
      state: "progress_check",
      prompt: {
        id: cause,
        title: promptTitle(day.prompt?.kind ?? null),
        body: `${intent ? `You planned to ${intent.replace(/\.$/, "")}. ` : ""}Record what changed.${overdueCount ? ` ${overdueCount} task${overdueCount === 1 ? " is" : "s are"} overdue.` : ""}`,
        action: "open_composer",
        severity: overdueCount > 0 ? "attention" : "info",
      },
      suppressReason: null,
    };
  }

  // Clock-in greeting, once per session, only in the first few minutes.
  const clockedInAt = day?.session?.clocked_in_at ?? null;
  if (clockedInAt) {
    const since = now.getTime() - Date.parse(clockedInAt);
    const cause = `greet:${sessionId}`;
    if (since >= 0 && since <= GREETING_WINDOW_MS && !record.fired[cause] && !ordinarySuppression) {
      return {
        state: "clock_in_greeting",
        prompt: {
          id: cause,
          title: "On shift — ready when you are.",
          body: openCount ? `${openCount} task${openCount === 1 ? "" : "s"} on today's plate. Say the word when something changes.` : "Tell me what you are working on and I'll keep track.",
          action: "open_plan",
          severity: "info",
        },
        suppressReason: null,
      };
    }
  }

  return { state: "idle", prompt: null, suppressReason: null };
}

function promptTitle(kind: NonNullable<DayData["prompt"]>["kind"]): string {
  if (kind === "catch_up") return "Catch-up check-in";
  if (kind === "eod") return "Review your EOD draft";
  return kind === "optional" ? "Anything to add?" : "Work OS check-in";
}

function forcedDecision(input: CompanionInput, force: CompanionState): CompanionDecision | null {
  const sessionId = input.day?.session?.id ?? input.day?.shiftDate ?? "unknown";
  const now = input.now;
  const shiftEnd = input.day?.shift?.endsAt ?? null;
  const minutesLeft = minutesUntil(shiftEnd, now);
  switch (force) {
    case "offline":
      return { state: "offline", prompt: null, suppressReason: "forced" };
    case "quiet":
      return { state: "quiet", prompt: null, suppressReason: "forced" };
    case "eod_due":
      return {
        state: "eod_due",
        prompt: {
          id: `debug:eod`,
          title: "Record your final update",
          body: `Your shift ends in ${minutesLeft ?? 8} minutes. Record your final update and I'll prepare the EOD draft.`,
          action: "open_eod",
          severity: "attention",
        },
        suppressReason: null,
      };
    case "blocker_follow_up":
      return {
        state: "blocker_follow_up",
        prompt: {
          id: `debug:blocker`,
          title: "Is the blocker still blocking?",
          body: "“The signing certificate” — still the dependency? Record what changed and I'll pass it along.",
          action: "open_composer",
          severity: "attention",
        },
        suppressReason: null,
      };
    case "awaiting_plan":
      return {
        state: "awaiting_plan",
        prompt: {
          id: `debug:plan`,
          title: "What are you working on today?",
          body: "Confirm what you are working on today.",
          action: "open_plan",
          severity: "attention",
        },
        suppressReason: null,
      };
    case "progress_check":
      return {
        state: "progress_check",
        prompt: {
          id: `debug:progress`,
          title: "Anything to add?",
          body: "Record what changed since your last update.",
          action: "open_composer",
          severity: "info",
        },
        suppressReason: null,
      };
    case "clock_in_greeting":
      return {
        state: "clock_in_greeting",
        prompt: {
          id: `debug:greet`,
          title: "On shift — ready when you are.",
          body: "Tell me what you are working on and I'll keep track.",
          action: "open_plan",
          severity: "info",
        },
        suppressReason: null,
      };
    default:
      return null;
  }
}

/** Pure record transforms used by the runtime. */
export function markFired(record: CompanionRecord, cause: string, now: Date): CompanionRecord {
  return { ...record, fired: { ...record.fired, [cause]: now.toISOString() } };
}

export function markAnswered(record: CompanionRecord, cause: string, now: Date): CompanionRecord {
  return { ...record, answered: { ...record.answered, [cause]: now.toISOString() }, ignored: { ...record.ignored, [cause]: 0 } };
}

/** A user response re-arms every prompt that fired before it and resets its backoff. */
export function markResponded(record: CompanionRecord, now: Date): CompanionRecord {
  const iso = now.toISOString();
  const answered = { ...record.answered };
  const ignored = { ...record.ignored };
  for (const [cause, firedAt] of Object.entries(record.fired)) {
    if (Date.parse(firedAt) <= now.getTime()) {
      answered[cause] = iso;
      ignored[cause] = 0;
    }
  }
  return { ...record, answered, ignored };
}

/** Removes all reminder bookkeeping for a finished session, preserving later sessions. */
export function clearSessionReminders(record: CompanionRecord, sessionId: string): CompanionRecord {
  const keep = <T>(entries: Record<string, T>) => Object.fromEntries(
    Object.entries(entries).filter(([cause]) => cause.split(":")[1] !== sessionId),
  ) as Record<string, T>;
  return { ...record, fired: keep(record.fired), answered: keep(record.answered), ignored: keep(record.ignored), ignoredAt: keep(record.ignoredAt) };
}

/** Drops bookkeeping older than the retention window so persisted state stays bounded. */
export function pruneRecord(record: CompanionRecord, now: Date, maxAgeMs = 7 * 24 * 60 * 60_000): CompanionRecord {
  const cutoff = now.getTime() - maxAgeMs;
  const fresh = (entries: Record<string, string>) =>
    Object.fromEntries(Object.entries(entries).filter(([, iso]) => {
      const parsed = Date.parse(iso);
      return Number.isFinite(parsed) && parsed >= cutoff;
    }));
  return { ...record, fired: fresh(record.fired), answered: fresh(record.answered) };
}

export function markIgnored(record: CompanionRecord, cause: string, now: Date): CompanionRecord {
  return {
    ...record,
    ignored: { ...record.ignored, [cause]: (record.ignored[cause] ?? 0) + 1 },
    ignoredAt: { ...record.ignoredAt, [cause]: now.toISOString() },
  };
}

export function setQuietMode(record: CompanionRecord, active: boolean): CompanionRecord {
  return { ...record, quiet: { active } };
}

export function snooze(record: CompanionRecord, cause: string | null, until: Date): CompanionRecord {
  return { ...record, snooze: { cause, until: until.toISOString() } };
}

export function wakeCompanion(record: CompanionRecord): CompanionRecord {
  return { ...record, snooze: { cause: null, until: null } };
}
