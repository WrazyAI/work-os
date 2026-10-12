import { deriveMascotVisualState, type MascotAgentActivity, type MascotWorkdayState, type MascotVisualState } from "./mascotState";

export const MASCOT_ACTIVITIES = ["idle", "working", "needs-input", "ready", "blocked"] as const;
export const MASCOT_WORKDAYS = ["disconnected", "off-shift", "active", "paused", "late", "check-in-due", "eod-due"] as const;
export interface MascotDebugOverrides {
  mascotActivity?: MascotAgentActivity | null;
  mascotWorkday?: MascotWorkdayState | null;
  mascotMotion?: "system" | "reduced";
  mascotReplay?: number;
}
export interface MascotScenario extends MascotDebugOverrides {
  enabled: boolean;
  authState?: string;
  dayState?: string;
  companionForce?: string | null;
  niftyFailure?: boolean;
  planningState?: string | null;
  syncBypass?: boolean;
}
/** Only presentation facts cross this seam. No task payloads or mutable records. */
export interface MascotPlatformFacts {
  connected: boolean;
  sessionState?: string | null;
  /** Worktivity's observed attendance when Work OS has no open session of its
   * own. A confirmed active observation still means the employee is working. */
  attendanceState?: "active" | "paused" | "off_shift" | "unknown" | null;
  lateReasonRequired?: boolean;
  promptRequired?: boolean;
  promptKind?: string | null;
  /** Today's EOD wrap-up window is open and no report is submitted: the mascot
   * stays awake through clock-out, and rests again once the window closes.
   * Callers derive this with `eodAlertDue` (design §9.1). */
  eodOutstanding?: boolean;
  niftySyncError?: string | null;
}
export interface MascotSignals {
  working?: boolean;
  failed?: boolean;
  needsInput?: boolean;
  completed?: boolean;
}
export interface MascotRuntimeState extends MascotVisualState {
  source: "live" | "scenario";
  reason: string;
  reducedMotion: boolean;
  replay: number;
}

export function isMascotActivity(value: unknown): value is MascotAgentActivity {
  return typeof value === "string" && (MASCOT_ACTIVITIES as readonly string[]).includes(value);
}
export function isMascotWorkday(value: unknown): value is MascotWorkdayState {
  return typeof value === "string" && (MASCOT_WORKDAYS as readonly string[]).includes(value);
}

/** A retry in flight replaces its previous failure. Waiting and confirmed
 * success cannot interrupt an active request. Queued writes never set completed. */
export function mascotActivityFromSignals(signals: MascotSignals): MascotAgentActivity {
  return signals.working ? "working" : signals.failed ? "blocked" : signals.needsInput ? "needs-input" : signals.completed ? "ready" : "idle";
}
export function mergeMascotActivities(local: MascotAgentActivity, peer?: MascotAgentActivity): MascotAgentActivity {
  return mascotActivityFromSignals({
    working: local === "working" || peer === "working",
    failed: local === "blocked" || peer === "blocked",
    needsInput: local === "needs-input" || peer === "needs-input",
    completed: local === "ready" || peer === "ready",
  });
}

export function mascotWorkdayFromFacts(facts: MascotPlatformFacts): MascotWorkdayState {
  if (!facts.connected) return "disconnected";
  // The EOD wrap-up is the day's required interrupt: while its window is open
  // the mascot stays awake even after clock-out; once the window closes it
  // rests again, and the day stays in the outstanding EOD list.
  if (facts.eodOutstanding) return "eod-due";
  // An eod_due session whose window has closed (the report is submitted, or
  // the one-hour grace passed) rests instead of staying alert: the mandatory
  // interrupt has had its time, so the mascot stops nagging for the day.
  if (facts.sessionState === "eod_due") return "off-shift";
  // Provider observation alone is NOT a Work OS clock-in, but it is still a
  // working employee: a confirmed observation keeps the mascot awake instead
  // of sleeping through a workday Work OS has not mirrored yet.
  if (!["clocked_in", "active", "paused", "eod_due"].includes(facts.sessionState ?? "")) {
    if (facts.attendanceState === "active") return "active";
    if (facts.attendanceState === "paused") return "paused";
    return "off-shift";
  }
  if (facts.lateReasonRequired) return "late";
  if (facts.sessionState === "paused") return "paused";
  if (facts.promptRequired) return "check-in-due";
  return "active";
}

const SCENARIO_WORKDAY: Record<string, MascotWorkdayState> = {
  no_shift: "off-shift", scheduled: "off-shift", shift_start: "off-shift",
  clocked_in: "check-in-due", paused: "paused", catch_up: "check-in-due",
  optional: "active", final_hour: "active", eod_due: "eod-due", eod: "eod-due", clocked_out: "off-shift",
};
const ATTENTION_FORCES = new Set(["clock_in_greeting", "awaiting_plan", "progress_check", "blocker_follow_up", "eod_due"]);

/** One resolver for dashboard, launcher, floating pet, and debugger. Callers
 * supply effective facts (after applyDayScenario). Avatar-only facts use the
 * same explicit scenario mapping without altering its real conversation/data. */
export function resolveMascotRuntime(facts: MascotPlatformFacts, signals: MascotSignals = {}, scenario?: MascotScenario, peer?: MascotAgentActivity): MascotRuntimeState {
  let workday = mascotWorkdayFromFacts(facts);
  let activity = mergeMascotActivities(mascotActivityFromSignals({ ...signals, failed: signals.failed || !!facts.niftySyncError }), peer);
  let source: MascotRuntimeState["source"] = "live";
  let reason = `Live ${activity}; ${workday}`;
  const enabled = scenario?.enabled === true;
  if (enabled) {
    source = "scenario";
    if (scenario.dayState && SCENARIO_WORKDAY[scenario.dayState]) workday = SCENARIO_WORKDAY[scenario.dayState];
    if (scenario.authState === "unauthenticated") { workday = "disconnected"; activity = "idle"; }
    if (scenario.niftyFailure) activity = "blocked";
    if (scenario.planningState === "required" || scenario.planningState === "conflict") activity = "needs-input";
    if (scenario.planningState === "ai_unavailable") activity = "blocked";
    if (scenario.companionForce === "offline") { workday = "disconnected"; activity = "idle"; }
    else if (scenario.companionForce === "quiet") { workday = "paused"; activity = "idle"; }
    else if (scenario.companionForce === "idle") activity = "idle";
    else if (scenario.companionForce && ATTENTION_FORCES.has(scenario.companionForce)) {
      activity = "needs-input";
      if (scenario.companionForce === "eod_due") workday = "eod-due";
    }
    // Explicit mascot controls win over other scenario controls. They are
    // visual-only; a green preview never creates a completion/approval receipt.
    if (isMascotWorkday(scenario.mascotWorkday)) workday = scenario.mascotWorkday;
    if (isMascotActivity(scenario.mascotActivity)) activity = scenario.mascotActivity;
    reason = isMascotActivity(scenario.mascotActivity) || isMascotWorkday(scenario.mascotWorkday)
      ? "Explicit mascot override" : scenario.companionForce ? `Companion force: ${scenario.companionForce}` : "Effective scenario workday";
  }
  const visual = deriveMascotVisualState({ agent: activity, workday });
  return {
    ...visual, source, reason,
    reducedMotion: enabled && scenario.mascotMotion === "reduced",
    replay: enabled && Number.isSafeInteger(scenario.mascotReplay) && (scenario.mascotReplay ?? 0) > 0 ? scenario.mascotReplay! : 0,
  };
}

export interface MascotActivityMessage {
  window: "main" | "avatar";
  scope: string;
  activity: MascotAgentActivity;
  sentAt: number;
  expiresAt: number;
}
/** Scope and a bounded lease stop another account, old workday, or closed
 * window leaving the mascot stuck. Messages carry no conversational content. */
export function acceptMascotActivity(value: unknown, ownWindow: string, scope: string, now: number): value is MascotActivityMessage {
  if (!value || typeof value !== "object" || !scope) return false;
  const v = value as Partial<MascotActivityMessage>;
  return (v.window === "main" || v.window === "avatar") && v.window !== ownWindow && v.scope === scope && isMascotActivity(v.activity)
    && typeof v.sentAt === "number" && Number.isFinite(v.sentAt) && v.sentAt <= now + 2_000
    && typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt) && v.expiresAt > now && v.expiresAt > v.sentAt && v.expiresAt - v.sentAt <= 30_000;
}
