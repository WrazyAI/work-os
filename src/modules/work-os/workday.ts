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
  hasConfirmedPlan: boolean;
  planConfirmedAt?: string | null;
  firstFollowUpAt?: string | null;
  nextFallbackAt?: string | null;
  lastPromptKind?: "follow_up" | "hourly_fallback" | "eod" | null;
  lastPromptAt?: string | null;
  lastSubstantiveUpdateAt?: string | null;
  at: string;
}

export interface WorkdayPrompt {
  kind: "plan" | "follow_up" | "hourly_fallback" | "eod" | null;
  nextPromptAt: string | null;
  required: boolean;
  reason: string;
}

const transitions: Record<WorkSessionAction, readonly WorkSessionState[]> = {
  clock_in: ["scheduled"],
  pause: ["clocked_in", "active"],
  resume: ["paused"],
  mark_active: ["clocked_in", "active"],
  mark_eod_due: ["clocked_in", "active", "paused", "eod_due"],
  clock_out: ["clocked_in", "active", "paused", "eod_due"],
};

export const FIRST_FOLLOW_UP_DELAY_MS = 30 * 60_000;
export const HOURLY_FALLBACK_DELAY_MS = 60 * 60_000;
export const EOD_LEAD_TIME_MS = 10 * 60_000;

export function firstFollowUpAt(context: Pick<PromptContext, "planConfirmedAt" | "firstFollowUpAt" | "session" | "at">) {
  if (context.firstFollowUpAt) return context.firstFollowUpAt;
  if (context.planConfirmedAt) {
    const planConfirmedAt = Date.parse(context.planConfirmedAt);
    if (Number.isFinite(planConfirmedAt)) return new Date(planConfirmedAt + FIRST_FOLLOW_UP_DELAY_MS).toISOString();
  }
  const baseline = context.session?.clockedInAt ?? context.session?.scheduledStartsAt ?? context.at;
  const baselineAt = Date.parse(baseline ?? context.at);
  if (!Number.isFinite(baselineAt)) throw new Error("Prompt timestamps must be valid ISO timestamps.");
  return new Date(baselineAt + FIRST_FOLLOW_UP_DELAY_MS).toISOString();
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
  if (!context.hasConfirmedPlan) return { kind: "plan", nextPromptAt: context.at, required: true, reason: "Confirm what you are taking on today." };

  const firstAt = Date.parse(firstFollowUpAt(context));
  if (!Number.isFinite(firstAt)) throw new Error("Prompt timestamps must be valid ISO timestamps.");
  if (context.lastPromptKind !== "follow_up" && context.lastPromptKind !== "hourly_fallback") {
    return now >= firstAt
      ? { kind: "follow_up", nextPromptAt: new Date(firstAt).toISOString(), required: false, reason: "Your first follow-up is due after the plan has had time to start." }
      : { kind: "follow_up", nextPromptAt: new Date(firstAt).toISOString(), required: false, reason: "Your first follow-up follows the confirmed plan." };
  }

  const lastPromptAt = context.lastPromptAt ? Date.parse(context.lastPromptAt) : null;
  const lastSubstantiveAt = context.lastSubstantiveUpdateAt ? Date.parse(context.lastSubstantiveUpdateAt) : null;
  if (lastPromptAt !== null && lastSubstantiveAt !== null && lastSubstantiveAt > lastPromptAt) {
    return { kind: null, nextPromptAt: null, required: false, reason: "Substantive progress was recorded; no fallback prompt is needed." };
  }
  const fallbackAt = Date.parse(context.nextFallbackAt ?? new Date(firstAt + HOURLY_FALLBACK_DELAY_MS).toISOString());
  if (!Number.isFinite(fallbackAt)) throw new Error("Prompt timestamps must be valid ISO timestamps.");
  if (now >= fallbackAt) return { kind: "hourly_fallback", nextPromptAt: new Date(fallbackAt).toISOString(), required: false, reason: "No substantive response was recorded after the follow-up." };
  return { kind: null, nextPromptAt: new Date(fallbackAt).toISOString(), required: false, reason: "Waiting for a substantive response before another prompt." };
}

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
  items: T[], shiftDate: string, carryOver: ReadonlyMap<string, CarryOverSelection>,
): Array<T & { source: PlanCandidateSource; disposition: PlanCandidateDisposition; rank: number }> {
  const sourceOrder: Record<PlanCandidateSource, number> = { carry_over: 0, overdue: 1, due_today: 2, existing: 3 };
  return dedupePlanCandidates(items).map((task) => {
    const previous = task.id ? carryOver.get(task.id) : undefined;
    const source: PlanCandidateSource = previous
      ? "carry_over"
      : task.due_date && task.due_date < shiftDate
        ? "overdue"
        : task.due_date === shiftDate
          ? "due_today"
          : "existing";
    return { task, source, disposition: previous?.disposition ?? "selected", previousRank: previous?.rank ?? Number.MAX_SAFE_INTEGER };
  }).sort((left, right) => sourceOrder[left.source] - sourceOrder[right.source] || left.previousRank - right.previousRank || String(left.task.title).localeCompare(String(right.task.title)))
    .map(({ task, source, disposition }, rank) => ({ ...task, source, disposition, rank }));
}
