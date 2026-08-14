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
}

export interface PromptContext {
  session: SessionShape | null;
  breaks: Array<{ startsAt: string; endsAt: string }>;
  hasConfirmedPlan: boolean;
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
  if (session.state === "paused" || context.breaks.some((item) => inWindow(now, item))) {
    const activeBreak = context.breaks.find((item) => inWindow(now, item));
    return { kind: null, nextPromptAt: activeBreak?.endsAt ?? null, required: false, reason: "Prompts are paused." };
  }
  if (session.snoozedUntil && Date.parse(session.snoozedUntil) > now) {
    return { kind: null, nextPromptAt: session.snoozedUntil, required: false, reason: "Check-in snoozed." };
  }
  const eodAt = end === null ? null : end - 10 * 60_000;
  if (eodAt !== null && now >= eodAt) return { kind: "eod", nextPromptAt: new Date(eodAt).toISOString(), required: true, reason: "Wrap the day with an EOD report." };
  if (end !== null && eodAt !== null && end - now <= 60 * 60_000) return { kind: null, nextPromptAt: new Date(eodAt).toISOString(), required: false, reason: "Final-hour interruption suppression." };
  if (!context.hasConfirmedPlan) return { kind: "plan", nextPromptAt: context.at, required: true, reason: "Confirm what you are taking on today." };
  const baseline = session.clockedInAt ?? session.scheduledStartsAt ?? context.at;
  const last = context.lastSubstantiveUpdateAt ? Date.parse(context.lastSubstantiveUpdateAt) : Date.parse(baseline);
  const next = eodAt === null ? last + 60 * 60_000 : Math.min(last + 60 * 60_000, eodAt);
  if (now >= next) return { kind: "hourly_fallback", nextPromptAt: new Date(next).toISOString(), required: false, reason: "A quiet progress check is due." };
  return { kind: "follow_up", nextPromptAt: new Date(next).toISOString(), required: false, reason: "The next check-in follows your active plan." };
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
