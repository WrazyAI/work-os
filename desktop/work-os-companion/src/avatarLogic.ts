/**
 * Pure logic for the floating avatar companion: prompt cadence, snooze
 * escalation, notification decisions, and the shift timer fraction. Kept
 * side-effect free so the whole cadence is unit-testable.
 */
import type { ProposedOperation, ToolCallResult } from "./interpretation";
import type { RecapNextStepState, RecapNextStepsMoment } from "./RecapNextStepsCard";
import { overdueSummary } from "./notificationsLogic";
import { isOverdueTask } from "./taskWorkspace";

export interface CompanionDayFacts {
  shiftDate: string;
  promptRequired: boolean;
  nextPromptAt: string | null;
  promptKind?: "plan" | "follow_up" | "hourly_fallback" | "eod" | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  sessionState: string | null;
  /** Worktivity's observed attendance; lets the companion stay awake for a
   * confirmed observation before Work OS mirrors its own session. */
  attendanceState?: "active" | "paused" | "off_shift" | "unknown" | null;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  pausedSeconds: number;
  pausedAt?: string | null;
  timezone?: string | null;
  planIntent?: string | null;
  /** The plan revision the companion last saw, so confirming from the floating
   * window can detect a plan that changed elsewhere instead of overwriting it. */
  planRevision?: number | null;
  lastSubstantiveUpdateAt?: string | null;
  employeeUpdates?: number;
  completedTasks?: number;
  openTasks?: number;
  /** The day's open-task slice, enough to spot overdue work for the prompt and
   * the check-in mention. Older payloads simply carry no tasks. */
  taskOptions?: Array<{ id: string; title: string; dueDate?: string | null; completed?: boolean }>;
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

export type BubbleActionKind = "open_eod" | "open_plan";

/** The one direct action the collapsed prompt bubble offers, by prompt kind.
 * Tapping the bubble still opens the chat; this shortcut skips the typing
 * step for the two prompts with an obvious destination. */
export function bubbleAction(kind: AvatarPromptKind): { kind: BubbleActionKind; label: string } | null {
  if (kind === "eod") return { kind: "open_eod", label: "Open EOD review" };
  if (kind === "agenda") return { kind: "open_plan", label: "Set today's goal" };
  return null;
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

/** The EOD alert opens this long before the scheduled shift end… */
export const EOD_ALERT_LEAD_MS = 10 * 60_000;
/** …and closes this long after it. Past the grace the mascot rests again even
 * when the report is still unsubmitted; the day stays in the outstanding EOD
 * list for follow-up. */
export const EOD_ALERT_GRACE_MS = 60 * 60_000;

/** The scheduled end that anchors the EOD wrap-up window: the session's
 * stamped end while it is open, then the schedule window for the shift date
 * (which survives clock-out and the roll to tomorrow's shift), then the
 * upcoming window as a last resort. */
export function scheduledShiftEnd(input: {
  sessionEnd?: string | null;
  dayShiftEnd?: string | null;
  upcomingEnd?: string | null;
}): string | null {
  return input.sessionEnd ?? input.dayShiftEnd ?? input.upcomingEnd ?? null;
}

/** Whether the EOD alert is live: no submitted report, and now is inside the
 * day's wrap-up window. The server's EOD signal (prompt kind or session state)
 * can open the alert early — e.g. a manager marks the day due — but the grace
 * cap still closes it, so the mascot cannot stay awake indefinitely. A day
 * without a scheduled end has no window and follows the server signal. */
export function eodAlertDue(input: {
  eodSubmitted?: boolean;
  shiftEndsAt?: string | null;
  promptKind?: string | null;
  sessionState?: string | null;
}, now: number): boolean {
  if (input.eodSubmitted) return false;
  const serverDue = input.promptKind === "eod" || input.sessionState === "eod_due";
  const end = input.shiftEndsAt ? Date.parse(input.shiftEndsAt) : Number.NaN;
  if (!Number.isFinite(end)) return serverDue;
  if (now > end + EOD_ALERT_GRACE_MS) return false;
  return serverDue || now >= end - EOD_ALERT_LEAD_MS;
}

/** The day's overdue work, using the one overdue definition every surface
 * shares (design §6.4): open work with a real due date before the workday.
 * Undated older work is carry-over, never overdue. */
export function overdueTasks(facts: CompanionDayFacts): Array<{ id: string; title: string; dueDate: string }> {
  return (facts.taskOptions ?? []).flatMap((task) => {
    if (!isOverdueTask({ due_date: task.dueDate ?? null, completed: task.completed === true }, facts.shiftDate)) return [];
    return [{ id: task.id, title: task.title, dueDate: String(task.dueDate).slice(0, 10) }];
  });
}

/** Builds one truthful, action-specific companion message from the current day.
 * It intentionally describes employee-authored updates and task state separately. */
export function avatarPrompt(facts: CompanionDayFacts, now: number): AvatarPrompt {
  const focus = shortText(facts.planIntent);
  const focusContext = focus ? `Today's focus: ${focus}.` : null;
  const lastUpdate = timeLabel(facts.lastSubstantiveUpdateAt, facts.timezone);
  const tasks = taskContext(facts);

  if (eodAlertDue(facts, now)) {
    const endLabel = timeLabel(facts.shiftEndsAt, facts.timezone);
    const endAt = facts.shiftEndsAt ? Date.parse(facts.shiftEndsAt) : Number.NaN;
    const endText = endLabel
      ? Number.isFinite(endAt) && endAt < now
        ? `Your scheduled shift ended at ${endLabel}.`
        : `Your scheduled shift ends at ${endLabel}.`
      : "Your shift is ready to wrap up.";
    return {
      kind: "eod",
      heading: "EOD review is due",
      body: [endText, tasks ? `Today has ${tasks}.` : null, "Review the record and submit your EOD when it is accurate."].filter(Boolean).join(" "),
      compact: "Open EOD review to prepare and submit your report.",
      action: "open_eod",
    };
  }

  if (facts.promptKind === "plan") {
    return {
      kind: "agenda",
      heading: "What are you working on today?",
      body: [focusContext, "Set today's focus. This does not affect attendance."].filter(Boolean).join(" "),
      compact: "Set today's focus.",
      action: null,
    };
  }

  if (facts.promptRequired) {
    // The banner follows the same due rule as the nudge: a scheduled follow-up
    // is not "due" until its next prompt time arrives, so finishing the plan
    // never causes an immediate check-in demand.
    const dueAt = facts.nextPromptAt ? Date.parse(facts.nextPromptAt) : now;
    if (!Number.isFinite(dueAt) || dueAt <= now) {
      const firstCheckIn = facts.promptKind === "follow_up" && !facts.lastSubstantiveUpdateAt;
      // The ask leads with the day's outstanding state, then the check-in
      // itself; focus and task detail live in the task card and composer.
      const overdue = overdueTasks(facts).length;
      const ask = firstCheckIn
        ? "Record what you started or moved forward."
        : lastUpdate
          ? `Your last recorded update was at ${lastUpdate}. What's changed since then?`
          : "Record what changed since your last update.";
      return {
        kind: "check_in",
        heading: firstCheckIn ? "First check-in due" : "Check-in due",
        body: [overdue > 0 ? `${overdueSummary(overdue)}.` : null, ask].filter(Boolean).join(" "),
        compact: firstCheckIn ? "Tell Work OS what you started." : "Tell Work OS what changed.",
        action: null,
      };
    }
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

/** An open shift keeps its elapsed-time readout visible while paused. */
export function hasOpenShiftSession(facts: CompanionDayFacts): boolean {
  return !facts.eodSubmitted && Boolean(facts.clockedInAt) && !facts.clockedOutAt;
}

/** The composer stays usable while the shift session is open; a due EOD only
 * takes it away after clock-out, when the EOD page owns the moment. */
export function composerVisible(facts: CompanionDayFacts, promptAction: AvatarPrompt["action"]): boolean {
  return promptAction !== "open_eod" || hasOpenShiftSession(facts);
}

/** The companion's panel header drags the window from its chrome — the shift
 * status and empty header space included. Controls inside it keep their own
 * clicks and never start a drag. */
export function isHeaderDragStart(button: number, target: EventTarget | null): boolean {
  if (button !== 0) return false;
  if (!target || typeof (target as Element).closest !== "function") return false;
  return !(target as Element).closest("button, a, input, textarea, select, [role='tablist']");
}

/** A recap alert (toast click or the collapsed recap bubble) can open the chat
 * for its confirmation. After approval the chat lingers with the recap's
 * next-step suggestions; once they are decided, the panel returns to the orb
 * after this settle beat. */
export const NEXT_STEPS_SETTLE_MS = 3_000;

export function nextStepsSettleMs(): number {
  return NEXT_STEPS_SETTLE_MS;
}

/** Which send action the avatar composer owns right now. A recap edit wins over
 * the agenda prompt because the employee explicitly chose to correct the recap;
 * otherwise the plan prompt keeps the composer, as before. */
export function composerSendTarget(input: { agendaDue: boolean; recapEditing: boolean }): "recap" | "agenda" | "update" {
  if (input.recapEditing) return "recap";
  if (input.agendaDue) return "agenda";
  return "update";
}

/** The collapsed companion shows exactly one bubble: the live EOD alert while
 * the day's wrap-up window is open, processing while the recap is being
 * generated, the generated recap with its View more action once ready,
 * otherwise the current prompt. A ready recap outranks the prompt it came
 * from, so the employee sees what was produced — but the EOD alert outranks
 * everything: the mandatory wrap-up must never hide behind an undecided recap
 * or an in-flight analysis. */
export function avatarBubble(input: {
  preparing: boolean;
  eodDue: boolean;
  recapReady: boolean;
  promptDue: boolean;
  /** An approved recap's suggestions are drafting or waiting for a decision. */
  nextSteps?: boolean;
}): "processing" | "next-steps" | "recap" | "prompt" | null {
  if (input.eodDue) return "prompt";
  if (input.preparing) return "processing";
  // The suggestions belong to the recap the employee just approved: they take
  // the bubble ahead of a newer prompt, and never open the panel by themselves.
  if (input.nextSteps) return "next-steps";
  if (input.recapReady) return "recap";
  if (input.promptDue) return "prompt";
  return null;
}

/** Whether the current prompt instance has reached its due instant.
 *
 * The nudge scheduler re-runs on dependency changes, not on the five-second
 * clock. A prompt that becomes due between two day polls has no server field
 * to move, so the boundary itself has to be a dependency: without it the due
 * prompt never requested its interval recap, and the generic check-in stood
 * in for the recap the employee was waiting for. */
export function promptNudgeDue(facts: CompanionDayFacts, now: number): boolean {
  if (!isOnShift(facts, now) || !facts.promptRequired) return false;
  const due = facts.nextPromptAt ? Date.parse(facts.nextPromptAt) : Number.NaN;
  return Number.isFinite(due) && due <= now;
}

/** Whether the goal question's hold has expired: the day is on shift, the
 * prompt is still the planning prompt, and its hold instant — the first
 * follow-up — has passed. The first run after that asks for the interval
 * recap, which writes the suggested goal before it synthesizes. */
export function planHoldExpired(facts: CompanionDayFacts, now: number): boolean {
  if (!isOnShift(facts, now) || facts.promptKind !== "plan") return false;
  const holdAt = facts.nextPromptAt ? Date.parse(facts.nextPromptAt) : Number.NaN;
  return Number.isFinite(holdAt) && holdAt <= now;
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

/** Whether the clock-in alert window is open: the scheduled shift started
 * within the last fifteen minutes and there is no clock-in yet. The scheduler
 * effect depends on this boundary, so the nudge fires when the window opens
 * even if no server field changes. */
export function clockInAlertDue(facts: CompanionDayFacts, now: number): boolean {
  if (facts.clockedInAt || facts.sessionState === "clocked_out") return false;
  const start = minutesSince(facts.shiftStartsAt, now);
  return start !== null && start >= 0 && start <= 15;
}

/** Clock-in nudge: the scheduled shift started ≤15 minutes ago and there is
 * no clock-in yet. Fires once per day. */
export function clockInNudge(facts: CompanionDayFacts, now: number, notifiedKeys: Set<string>): CompanionNudge | null {
  if (!clockInAlertDue(facts, now)) return null;
  const key = `clock_in:${facts.shiftDate}`;
  if (notifiedKeys.has(key)) return null;
  return {
    kind: "clock_in",
    key,
    title: "Shift started",
    body: "Your scheduled shift has begun — clock in when you're ready.",
  };
}

/** EOD nudge: the EOD alert is live and today has not been announced yet. It
 * fires once per day; the alert itself stays visible for the whole window. */
export function eodNudge(facts: CompanionDayFacts, now: number, notifiedKeys: Set<string>): CompanionNudge | null {
  if (!eodAlertDue(facts, now)) return null;
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

/** Scheduled-shift progress for the floating companion ring.
 * The ring follows the scheduled window exactly, matching the dashboard pulse:
 * pauses change session elapsed time, but they do not move the scheduled end. */
export function shiftElapsedFraction(facts: CompanionDayFacts, now: number): { fraction: number; label: string; remaining: string; progressAvailable: boolean } {
  const validTime = (value: string | null | undefined) => {
    const parsed = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const formatMinutes = (minutes: number) => {
    const safe = Math.max(0, Math.ceil(minutes));
    const hours = Math.floor(safe / 60);
    return hours > 0 ? `${hours}h ${String(safe % 60).padStart(2, "0")}m` : `${safe}m`;
  };

  // Elapsed time follows the real session start, matching the main dashboard.
  // The schedule remains the source for the completion fraction.
  const scheduledStart = validTime(facts.shiftStartsAt);
  const clockedInAt = validTime(facts.clockedInAt);
  const elapsedStart = clockedInAt ?? scheduledStart;
  const clockedOutAt = validTime(facts.clockedOutAt);
  const pausedAt = facts.sessionState === "paused" ? validTime(facts.pausedAt) : null;
  const elapsedEnd = clockedOutAt ?? pausedAt ?? now;
  const pausedMs = Math.max(0, Number(facts.pausedSeconds) || 0) * 1000;
  const elapsedMinutes = elapsedStart === null
    ? 0
    : Math.floor(Math.max(0, elapsedEnd - elapsedStart - pausedMs) / 60_000);
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  const pauseBoundaryMissing = facts.sessionState === "paused"
    && clockedOutAt === null
    && (pausedAt === null || elapsedStart === null || pausedAt < elapsedStart);
  const label = elapsedStart === null || pauseBoundaryMissing
    ? ""
    : elapsedHours > 0
      ? `${elapsedHours}h ${String(elapsedMinutes % 60).padStart(2, "0")}m`
      : `${elapsedMinutes}m`;
  const start = scheduledStart;
  const scheduledEnd = validTime(facts.shiftEndsAt);
  if (start === null) return { fraction: 0, label, remaining: "Time unavailable", progressAvailable: false };
  if (scheduledEnd === null || scheduledEnd <= start) return { fraction: 0, label, remaining: "Time unavailable", progressAvailable: false };

  const total = Math.max(60_000, scheduledEnd - start);
  const elapsed = Math.max(0, Math.min(total, now - start));
  const remaining = now < start
    ? `${formatMinutes((start - now) / 60_000)} to start`
    : now >= scheduledEnd
      ? "Shift complete"
      : `${formatMinutes((scheduledEnd - now) / 60_000)} left`;
  return { fraction: Math.max(0, Math.min(1, elapsed / total)), label, remaining, progressAvailable: true };
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
  /** The recap next-steps moment, persisted so a reload or cross-window sync
   * never drops the card mid-decision. */
  nextSteps?: RecapNextStepsMoment;
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
  /** The live recap next-steps moment (persisted once it has items). */
  nextSteps?: RecapNextStepsMoment;
  /** UI-only reminders (plan, check-in, EOD). Ephemeral: never persisted, never
   * sent as conversation history, and removed once the prompt is answered. */
  kind?: "prompt";
}

/** Reminder turns are scaffolding, not conversation: the avatar injects the
 * current prompt into the thread and drops it when the prompt no longer
 * applies. Legacy copies already saved in a vault are recognized by their
 * exact heading prefix, so an upgrade cleans them up too. */
const PROMPT_REMINDER_PREFIXES = [
  "What are you working on today?:",
  "First check-in due:",
  "Check-in due:",
  "EOD review is due:",
];

export function isPromptReminderTurn(entry: { role: string; kind?: string | null; text: string }): boolean {
  if (entry.kind === "prompt") return true;
  return entry.role === "assistant" && PROMPT_REMINDER_PREFIXES.some((prefix) => entry.text.startsWith(prefix));
}

/** Removes reminder turns from anything sent to the interpretation service. */
export function stripPromptReminderTurns<T extends { role: string; kind?: string | null; text: string }>(entries: T[]): T[] {
  return entries.filter((entry) => !isPromptReminderTurn(entry));
}

/** Prompt-reminder scaffolding is dropped when its prompt is no longer current;
 * turns that carry a recap card stay until the employee decides them. */
export function prunePromptReminderTurns<T extends { id: string; role: string; kind?: string | null; text: string; activityInterval?: unknown }>(
  entries: T[],
  currentPromptTurnId: string | null,
): T[] {
  return entries.filter((entry) => entry.id === currentPromptTurnId || Boolean(entry.activityInterval) || !isPromptReminderTurn(entry));
}

/** Keeps only the latest undecided recap turn in the chat: older inferred
 * recaps stay in the Tasks stream instead of stacking up as chat cards. */
export function replaceUndecidedRecapTurns<T extends { id: string; activityInterval?: { reviewStatus?: string | null } | null }>(
  entries: T[],
  keepId: string,
): T[] {
  return entries.filter((entry) => entry.id === keepId || !entry.activityInterval || entry.activityInterval.reviewStatus !== "inferred");
}

/** Serializes a live entry for the vault. System notices and reminder
 * scaffolding stay ephemeral. */
export function serializeAvatarChatEntry(entry: AvatarChatEntryState): AvatarStoredTurn | null {
  if (entry.role !== "user" && entry.role !== "assistant") return null;
  if (isPromptReminderTurn(entry)) return null;
  const turn: AvatarStoredTurn = {
    id: entry.id,
    role: entry.role,
    text: entry.text,
    createdAt: entry.createdAt ?? new Date().toISOString(),
  };
  if (entry.receipt) turn.meta = entry.receipt;
  if (entry.operations) turn.operations = entry.operations;
  if (entry.toolResults) turn.toolResults = entry.toolResults;
  // A drafting moment is transient; persisting it would restore a card that can
  // never finish its poll. Everything else survives reloads and cross-window
  // syncs so the card is never dropped mid-decision.
  if (entry.nextSteps && entry.nextSteps.status !== "drafting") turn.nextSteps = entry.nextSteps;
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
      // Another window's save may predate the moment; the merge is monotonic so
      // a stale snapshot can never overwrite a decision that already landed.
      nextSteps: turn.nextSteps && local?.nextSteps
        ? mergeNextStepsMoment(local.nextSteps, turn.nextSteps)
        : turn.nextSteps ?? local?.nextSteps,
    };
  });
}

const NEXT_STEP_STATE_RANK: Record<RecapNextStepState, number> = { pending: 0, processing: 1, failed: 2, skipped: 2, applied: 2 };
const NEXT_STEP_STATUS_RANK: Record<RecapNextStepsMoment["status"], number> = { drafting: 0, ready: 1, failed: 2, empty: 2, done: 3 };

/** Merges two snapshots of the same next-steps moment without ever regressing
 * it: a stale cross-window save (still "processing") can never overwrite a
 * decision that already landed ("applied"), and a moment that reached "done"
 * stays done. Terminal item states win over in-flight ones. */
export function mergeNextStepsMoment(local: RecapNextStepsMoment, incoming: RecapNextStepsMoment): RecapNextStepsMoment {
  const base = incoming.items.length >= local.items.length ? incoming : local;
  const states: Record<string, RecapNextStepState> = {};
  const failures: Record<string, string> = {};
  for (const item of base.items) {
    const localState = local.states[item.proposalId];
    const incomingState = incoming.states[item.proposalId];
    const localRank = NEXT_STEP_STATE_RANK[localState ?? "pending"] ?? 0;
    const incomingRank = NEXT_STEP_STATE_RANK[incomingState ?? "pending"] ?? 0;
    const state = localRank >= incomingRank
      ? (localState ?? incomingState ?? "pending")
      : (incomingState ?? localState ?? "pending");
    states[item.proposalId] = state;
    if (state === "failed") {
      const failure = localState === "failed" ? local.failures[item.proposalId] : incoming.failures[item.proposalId];
      if (failure) failures[item.proposalId] = failure;
    }
  }
  return {
    ...base,
    intervalId: local.intervalId || incoming.intervalId,
    label: incoming.label ?? local.label,
    status: NEXT_STEP_STATUS_RANK[local.status] >= NEXT_STEP_STATUS_RANK[incoming.status] ? local.status : incoming.status,
    states,
    failures,
    error: incoming.error ?? local.error,
  };
}

/** Maps a proposal decision and its response outcome to the card's item state.
 * A decision whose apply is still running stays "processing"; the caller then
 * reconciles it against the server instead of leaving the card on Saving. */
export function nextStepState(decision: "accept" | "skip", outcome: string | null | undefined): RecapNextStepState {
  if (decision === "skip" || outcome === "rejected") return "skipped";
  if (outcome === "applied") return "applied";
  if (outcome === "applying") return "processing";
  return "failed";
}

/** Additive conversation merge for the shared window store: incoming turns win
 * per id, unseen turns are kept, order is by creation time, and the newest 60
 * survive. Two windows writing their own histories can no longer clobber each
 * other's turns. */
export function mergeConversationTurns<T extends { id: string; createdAt?: string }>(stored: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map(stored.map((turn) => [turn.id, turn]));
  for (const turn of incoming) byId.set(turn.id, turn);
  return [...byId.values()]
    .sort((left, right) => (Date.parse(left.createdAt ?? "") || 0) - (Date.parse(right.createdAt ?? "") || 0) || left.id.localeCompare(right.id))
    .slice(-60);
}
