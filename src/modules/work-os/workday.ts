export const ACTIVE_WORK_SESSION_STATES = ["clocked_in", "active", "paused", "eod_due"] as const;

export type WorkSessionState = "scheduled" | (typeof ACTIVE_WORK_SESSION_STATES)[number] | "clocked_out";
export type WorkSessionAction = "clock_in" | "pause" | "resume" | "mark_active" | "mark_eod_due" | "clock_out";
export type ProgressUpdateKind =
  | "starting"
  | "continuing"
  | "material_progress"
  | "completion_claim"
  | "blocked"
  | "priority_change"
  | "unplanned_work";

export interface SessionShape {
  state: WorkSessionState;
  scheduledStartsAt: string | null;
  scheduledEndsAt: string | null;
  clockedInAt?: string | null;
  clockedOutAt?: string | null;
  snoozedUntil?: string | null;
  firstFollowUpAt?: string | null;
  nextFallbackAt?: string | null;
  lastPromptKind?: "follow_up" | "hourly_fallback" | "eod" | null;
  lastPromptAt?: string | null;
}

export interface PromptContext {
  session: SessionShape | null;
  breaks: Array<{ startsAt: string; endsAt: string }>;
  hasConfirmedPlan?: boolean;
  planConfirmedAt?: string | null;
  firstFollowUpAt?: string | null;
  nextFallbackAt?: string | null;
  lastPromptKind?: "follow_up" | "hourly_fallback" | "eod" | null;
  lastPromptAt?: string | null;
  lastSubstantiveUpdateAt?: string | null;
  /** Resolved per-person cadence; omitted values fall back to the deployment
   * environment and then the built-in defaults. */
  checkInIntervalMinutes?: number | null;
  firstFollowUpMinutes?: number | null;
  at: string;
}

export interface WorkdayPrompt {
  kind: "plan" | "follow_up" | "hourly_fallback" | "eod" | null;
  nextPromptAt: string | null;
  required: boolean;
  reason: string;
}

/** An employee-submitted EOD is the terminal prompt state for that workday.
 * A manager review is separate from asking the employee to submit again. */
export function suppressPromptForSubmittedEod(prompt: WorkdayPrompt, submittedAt: string | null | undefined): WorkdayPrompt {
  if (!submittedAt) return prompt;
  return { kind: null, nextPromptAt: null, required: false, reason: "EOD submitted." };
}

const transitions: Record<WorkSessionAction, readonly WorkSessionState[]> = {
  clock_in: ["scheduled"],
  pause: ["clocked_in", "active"],
  resume: ["paused"],
  mark_active: ["clocked_in", "active"],
  mark_eod_due: ["clocked_in", "active", "paused", "eod_due"],
  clock_out: ["clocked_in", "active", "paused", "eod_due"],
};

/** Planning is available as soon as attendance has been recorded. */
export const FIRST_FOLLOW_UP_MINUTES = 75;
const MIN_FIRST_FOLLOW_UP_MINUTES = 5;
const MAX_FIRST_FOLLOW_UP_MINUTES = 240;
/** Hourly is the safe production fallback; deployments may shorten or lengthen it. */
export const DEFAULT_CHECK_IN_INTERVAL_MINUTES = 60;
const MIN_CHECK_IN_INTERVAL_MINUTES = 5;
const MAX_CHECK_IN_INTERVAL_MINUTES = 240;
export const EOD_LEAD_TIME_MS = 10 * 60_000;

/** Valid cadence options, or null when a value is invalid. Kept next to the
 * bounds so local config and environment overrides share one contract. */
export function checkInIntervalOption(value: unknown): number | null {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= MIN_CHECK_IN_INTERVAL_MINUTES && minutes <= MAX_CHECK_IN_INTERVAL_MINUTES ? minutes : null;
}

export function firstFollowUpOption(value: unknown): number | null {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= MIN_FIRST_FOLLOW_UP_MINUTES && minutes <= MAX_FIRST_FOLLOW_UP_MINUTES ? minutes : null;
}

/** True when a cadence differs from the hourly default (used to scale
 * testing-time daily caps). */
export function checkInCadenceOverride(minutes: number | null | undefined): boolean {
  return minutes != null && minutes !== DEFAULT_CHECK_IN_INTERVAL_MINUTES;
}

/** The cadence is deployment-configurable but bounded so a bad environment
 * value cannot create a notification storm or silence a whole workday. */
export function checkInIntervalMs(value: unknown = process.env.WORK_OS_CHECK_IN_INTERVAL_MINUTES): number {
  return (checkInIntervalOption(value) ?? DEFAULT_CHECK_IN_INTERVAL_MINUTES) * 60_000;
}

/** True when a deployment set the check-in cadence to anything other than the
 * hourly default (used to scale testing-time daily caps). */
export function checkInCadenceOverridden(value: unknown = process.env.WORK_OS_CHECK_IN_INTERVAL_MINUTES): boolean {
  return checkInCadenceOverride(checkInIntervalOption(value));
}

/** The first progress prompt follows clock-in (or plan confirmation) by this
 * many minutes. Deployment-configurable for testing phases, bounded so a bad
 * value cannot silence or storm the workday. */
export function firstFollowUpMinutes(value: unknown = process.env.WORK_OS_FIRST_FOLLOW_UP_MINUTES): number {
  return firstFollowUpOption(value) ?? FIRST_FOLLOW_UP_MINUTES;
}

export function firstFollowUpAt(context: Pick<PromptContext, "planConfirmedAt" | "firstFollowUpAt" | "firstFollowUpMinutes" | "session" | "at">) {
  const baseline = context.planConfirmedAt ?? context.session?.clockedInAt ?? context.session?.scheduledStartsAt ?? context.at;
  const baselineAt = Date.parse(baseline ?? context.at);
  if (!Number.isFinite(baselineAt)) throw new Error("Prompt timestamps must be valid ISO timestamps.");
  const minutes = firstFollowUpOption(context.firstFollowUpMinutes) ?? firstFollowUpMinutes();
  const resolvedAt = baselineAt + minutes * 60_000;
  if (context.firstFollowUpAt) {
    const storedAt = Date.parse(context.firstFollowUpAt);
    // A stored anchor written under the resolved cadence is preserved (it
    // carries sub-minute precision from its confirmation request); a stale
    // one is rebased so a cadence edit applies to the pending workday.
    if (Number.isFinite(storedAt) && Math.abs(storedAt - resolvedAt) <= 60_000) return context.firstFollowUpAt;
  }
  return new Date(resolvedAt).toISOString();
}

export function eodDueAt(scheduledEndsAt: string | null | undefined) {
  if (!scheduledEndsAt) return null;
  const end = Date.parse(scheduledEndsAt);
  if (!Number.isFinite(end)) throw new Error("Prompt timestamps must be valid ISO timestamps.");
  return new Date(end - EOD_LEAD_TIME_MS).toISOString();
}

export function nextSessionState(current: WorkSessionState, action: WorkSessionAction): WorkSessionState {
  if (!transitions[action].includes(current)) throw new Error(`Cannot ${action.replaceAll("_", " ")} from ${current}.`);
  if (action === "clock_in") return "clocked_in";
  if (action === "pause") return "paused";
  if (action === "resume" || action === "mark_active") return "active";
  if (action === "mark_eod_due") return "eod_due";
  return "clocked_out";
}

function inWindow(at: number, window: { startsAt: string; endsAt: string }) {
  return at >= Date.parse(window.startsAt) && at < Date.parse(window.endsAt);
}

export function decideWorkdayPrompt(context: PromptContext): WorkdayPrompt {
  const { session } = context;
  if (!session || session.state === "scheduled" || session.state === "clocked_out") {
    return { kind: null, nextPromptAt: null, required: false, reason: "Clock in to begin the workday." };
  }
  const now = Date.parse(context.at);
  const end = session.scheduledEndsAt ? Date.parse(session.scheduledEndsAt) : null;
  if (!Number.isFinite(now) || (end !== null && !Number.isFinite(end))) throw new Error("Prompt timestamps must be valid ISO timestamps.");
  const eodAt = end === null ? null : end - EOD_LEAD_TIME_MS;
  if (session.state === "eod_due" || (eodAt !== null && now >= eodAt)) return { kind: "eod", nextPromptAt: new Date(eodAt ?? now).toISOString(), required: true, reason: "Wrap the day with an EOD report." };
  if (end !== null && eodAt !== null && end - now <= 60 * 60_000) return { kind: null, nextPromptAt: new Date(eodAt).toISOString(), required: false, reason: "Final-hour interruption suppression." };
  if (session.state === "paused" || context.breaks.some((item) => inWindow(now, item))) {
    const activeBreak = context.breaks.find((item) => inWindow(now, item));
    return { kind: null, nextPromptAt: activeBreak?.endsAt ?? null, required: false, reason: "Prompts are paused." };
  }
  if (session.snoozedUntil && Date.parse(session.snoozedUntil) > now) {
    return { kind: null, nextPromptAt: session.snoozedUntil, required: false, reason: "Check-in snoozed." };
  }
  const firstAt = Date.parse(firstFollowUpAt(context));
  if (!Number.isFinite(firstAt)) throw new Error("Prompt timestamps must be valid ISO timestamps.");
  let progress: WorkdayPrompt;
  if (context.lastPromptKind !== "follow_up" && context.lastPromptKind !== "hourly_fallback") {
    progress = now >= firstAt
      ? { kind: "follow_up", nextPromptAt: new Date(firstAt).toISOString(), required: false, reason: "Your first follow-up is due after the workday has had time to start." }
      : { kind: "follow_up", nextPromptAt: new Date(firstAt).toISOString(), required: false, reason: "Your first follow-up follows clock-in." };
  } else {
    const lastPromptAt = context.lastPromptAt ? Date.parse(context.lastPromptAt) : null;
    const lastSubstantiveAt = context.lastSubstantiveUpdateAt ? Date.parse(context.lastSubstantiveUpdateAt) : null;
    const latestResponseAt = lastSubstantiveAt !== null && lastSubstantiveAt > (lastPromptAt ?? -Infinity) ? lastSubstantiveAt : null;
    const intervalMs = checkInIntervalMs(context.checkInIntervalMinutes ?? undefined);
    let fallbackAt: number;
    if (latestResponseAt !== null) {
      fallbackAt = latestResponseAt + intervalMs;
    } else {
      // The persisted deadline was written at delivery under the then-current
      // cadence. Keep it when it still reflects the resolved cadence (allowing
      // for the delivery lag); otherwise rebase it so an in-place cadence edit
      // takes effect without waiting for another delivery.
      const persistedFallbackAt = context.nextFallbackAt ? Date.parse(context.nextFallbackAt) : Number.NaN;
      const cadenceAnchorAt = (lastPromptAt ?? firstAt) + intervalMs;
      const persistedMatchesCadence = lastPromptAt !== null && Number.isFinite(persistedFallbackAt)
        && Math.abs(persistedFallbackAt - cadenceAnchorAt) <= 60_000;
      fallbackAt = persistedMatchesCadence ? persistedFallbackAt : cadenceAnchorAt;
    }
    if (!Number.isFinite(fallbackAt)) throw new Error("Prompt timestamps must be valid ISO timestamps.");
    progress = now >= fallbackAt
      ? { kind: "hourly_fallback", nextPromptAt: new Date(fallbackAt).toISOString(), required: false, reason: "Your next configured check-in is due." }
      : { kind: null, nextPromptAt: new Date(fallbackAt).toISOString(), required: false, reason: latestResponseAt !== null ? "Your next check-in follows your recorded progress." : "Waiting for the next configured check-in." };
  }
  // An unconfirmed plan keeps its required planning prompt only until the
  // employee has engaged with the day. Once they record a substantive update
  // or a check-in has been delivered, the workday is underway: the agenda
  // review stays as the companion's inline banner instead of a prompt that
  // keeps returning between check-ins.
  if (!context.hasConfirmedPlan && !planningPromptAnswered(context)) {
    const progressDue = progress.kind !== null && progress.nextPromptAt !== null && now >= Date.parse(progress.nextPromptAt);
    if (!progressDue) {
      return {
        kind: "plan",
        nextPromptAt: session.clockedInAt ?? context.at,
        required: true,
        reason: "Plan not confirmed.",
      };
    }
  }
  return progress;
}

/** Whether the employee has already answered the planning question by working
 * the day: an applied substantive update since clock-in, or a progress
 * check-in that has already been delivered. */
export function planningPromptAnswered(context: PromptContext): boolean {
  if (context.lastPromptKind === "follow_up" || context.lastPromptKind === "hourly_fallback") return true;
  const clockedInAt = context.session?.clockedInAt ? Date.parse(context.session.clockedInAt) : Number.NaN;
  const lastSubstantiveAt = context.lastSubstantiveUpdateAt ? Date.parse(context.lastSubstantiveUpdateAt) : Number.NaN;
  return Number.isFinite(clockedInAt) && Number.isFinite(lastSubstantiveAt) && lastSubstantiveAt >= clockedInAt;
}

/** Hard bound on the items one daily plan may hold and one save may submit.
 * The seed and single-task additions are kept below it (see the draft
 * headroom) so a plan the server built can always be saved back, even after a
 * confirm appends its drafted outcomes. */
export const MAX_DAILY_PLAN_ITEMS = 250;
/** Room under the hard bound reserved for drafted outcomes a save may append
 * on top of the seeded list. Seeds and single-task additions stay below it. */
export const PLAN_ITEM_DRAFT_HEADROOM = 50;

export function dedupePlanCandidates<T extends { id?: string | null; provider_task_id?: string | null; title?: string | null }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.id || item.provider_task_id || item.title?.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type PlanCandidateSource = "carry_over" | "overdue" | "due_today" | "existing";
export type PlanCandidateDisposition = "selected" | "deferred";
export interface CarryOverSelection { disposition: PlanCandidateDisposition; rank: number }

export function prioritizePlanCandidates<T extends { id?: string | null; provider_task_id?: string | null; title?: string | null; due_date?: string | null }>(
  items: T[], shiftDate: string, carryOver: ReadonlyMap<string, CarryOverSelection>, limit = Number.POSITIVE_INFINITY,
): Array<T & { source: PlanCandidateSource; disposition: PlanCandidateDisposition; rank: number }> {
  const sourceOrder: Record<PlanCandidateSource, number> = { carry_over: 0, overdue: 1, due_today: 2, existing: 3 };
  const dateKey = (value: unknown): string | null => {
    if (value instanceof Date) {
      return Number.isFinite(value.getTime())
        ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
        : null;
    }
    const match = typeof value === "string" ? value.match(/^\d{4}-\d{2}-\d{2}/) : null;
    return match ? match[0] : null;
  };
  return dedupePlanCandidates(items).map((task) => {
    const dueDate = dateKey(task.due_date);
    const previous = task.id ? carryOver.get(task.id) : undefined;
    const source: PlanCandidateSource = previous
      ? "carry_over"
      : dueDate && dueDate < shiftDate
        ? "overdue"
        : dueDate === shiftDate
          ? "due_today"
          : "existing";
    return { task, source, disposition: previous?.disposition ?? "selected", previousRank: previous?.rank ?? Number.MAX_SAFE_INTEGER };
  }).sort((left, right) => sourceOrder[left.source] - sourceOrder[right.source] || left.previousRank - right.previousRank || String(left.task.title).localeCompare(String(right.task.title)))
    .slice(0, Math.max(0, limit))
    .map(({ task, source, disposition }, rank) => ({ ...task, source, disposition, rank }));
}
