/** DEV-only fixture for the floating companion's visual checks.
 *
 * `?window=avatar&avatar-fixture=recorded-completion` renders a persisted
 * display turn plus a recorded completion without a desktop session token, so
 * the avatar's recorded-result rendering (one action summary, no phantom task
 * card) can be screenshotted and covered by TestSprite on any dev server.
 * `?window=avatar&avatar-fixture=shift-progress` renders the compact companion
 * at a deterministic half-shift point for elapsed-time and progress checks.
 * Add `&avatar-attention=true` to either fixture to preview generic actionable
 * attention without coupling the visual state to a check-in prompt.
 * `?window=avatar&avatar-fixture=snooze-reminder` renders a due check-in in the
 * compact window so its snooze reminder and attention motion can be exercised.
 * `?window=avatar&avatar-fixture=recap` renders the compact window with a ready
 * activity recap so the summary bubble and its View more action can be
 * exercised; `avatar-fixture=recap-processing` renders the same window while
 * the recap is still being analyzed (working state, no View more yet).
 * `avatar-fixture=eod-outstanding-recap` (wrap-up window with a pending recap),
 * `=eod-outstanding-after-shift` (clocked out inside the one-hour grace), and
 * `=eod-outstanding-expired` (past the grace) exercise the EOD alert's window
 * and its priority over the recap bubble.
 * The shapes mirror production exactly: the display result carries a real
 * `tasks` array, and the recorded mutation carries the proposal row's
 * `provider_result` object (jsonb `{}`) that must never render as a card
 * (design §25.9, §25.11). Never active outside `import.meta.env.DEV`. */
import type { ProposedOperation, ToolCallResult } from "./interpretation";
import type { CompanionDayFacts } from "./avatarLogic";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";
import type { RecapSpeechLine } from "./recapSpeech";
import type { ActivityIntervalCard } from "./types";

export const AVATAR_FIXTURE_PARAM = "avatar-fixture";
export const AVATAR_RECORDED_FIXTURE = "recorded-completion";
export const AVATAR_MULTI_SELECT_SCROLL_FIXTURE = "multi-select-scroll";
export const AVATAR_SHIFT_PROGRESS_FIXTURE = "shift-progress";
export const AVATAR_OBSERVED_FIXTURE = "observed-working";
export const AVATAR_ATTENTION_PARAM = "avatar-attention";
export const AVATAR_SNOOZE_FIXTURE = "snooze-reminder";
export const AVATAR_RECAP_FIXTURE = "recap";
export const AVATAR_RECAP_READING_FIXTURE = "recap-reading";
/** The same reading, frozen mid-sentence: a still frame for review, so the
 * prompters's proportions can be judged without pressing anything. */
export const AVATAR_RECAP_READING_STILL_FIXTURE = "recap-reading-still";
/** The frame after the voice stops: the words stay, and the bubble asks for the
 * decision the listen was for. */
export const AVATAR_RECAP_READING_DONE_FIXTURE = "recap-reading-done";
/** The interactive preview: the plain recap bubble whose Listen really plays
 * (a shipped sample, the words the prompter shows) and whose ✓ resolves on the
 * device, so the whole loop — press, listen, confirm or dismiss — can be driven
 * by hand without a session or a provider call. */
export const AVATAR_RECAP_LIVE_FIXTURE = "recap-live";
/** The same recap in a workspace where reading aloud is switched off: the
 * bubble offers View more but no Listen, so the negative case is reviewable. */
export const AVATAR_RECAP_NO_VOICE_FIXTURE = "recap-no-voice";
/** The wait past the usual window: the quiet "taking longer" line and Cancel. */
export const AVATAR_RECAP_SLOW_FIXTURE = "recap-reading-slow";
/** The bubble after a cancelled or failed read: View more + Try again. */
export const AVATAR_RECAP_RETRY_FIXTURE = "recap-reading-retry";
export const AVATAR_RECAP_PROCESSING_FIXTURE = "recap-processing";
export const AVATAR_RECAP_NEXT_STEPS_FIXTURE = "recap-next-steps";
export const AVATAR_RECAP_NEXT_STEPS_RECOVERY_FIXTURE = "recap-next-steps-recovery";
export const AVATAR_RECAP_NEXT_STEPS_EMPTY_FIXTURE = "recap-next-steps-empty";
export const AVATAR_RECAP_NEXT_STEPS_PAIR_FIXTURE = "recap-next-steps-pair";
export const AVATAR_EOD_BUBBLE_FIXTURE = "eod-bubble";
export const AVATAR_AGENDA_BUBBLE_FIXTURE = "agenda-bubble";
export const AVATAR_EOD_OUTSTANDING_RECAP_FIXTURE = "eod-outstanding-recap";
export const AVATAR_EOD_OUTSTANDING_AFTER_FIXTURE = "eod-outstanding-after-shift";
export const AVATAR_EOD_OUTSTANDING_EXPIRED_FIXTURE = "eod-outstanding-expired";

export interface AvatarFixtureFacts extends CompanionDayFacts {
  loaded: boolean;
  /** The dev fixtures stand in for a deployment that can transcribe. */
  voiceAvailable: boolean;
  personId: string | null;
  planIntent: string | null;
  timezone: string | null;
  displayName: string | null;
  niftySyncing: boolean;
  niftySyncError: string | null;
  taskOptions: Array<{
    id: string;
    title: string;
    dueDate: string | null;
    completed: boolean;
    subtaskTotal?: number;
    subtaskCompleted?: number;
    subtasks?: Array<{ id: string; title: string; completed?: boolean }>;
  }>;
  planStatus: string | null;
  planItems: Array<{ id: string; task_id: string | null; title_snapshot: string; disposition: string; item_kind: string; completion_state: string }>;
  lateReasonRequired: boolean;
}

export interface AvatarFixtureTurn {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  operations?: ProposedOperation[];
  toolResults?: ToolCallResult[];
  taskOptions?: Array<{ id: string; title: string }>;
  receipt?: string | null;
  createdAt?: string;
  /** A next-steps moment attached to the turn, for the pair fixture. */
  nextSteps?: RecapNextStepsMoment;
}

export function avatarFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  const fixture = new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM);
  return fixture === AVATAR_RECORDED_FIXTURE || fixture === AVATAR_MULTI_SELECT_SCROLL_FIXTURE || fixture === AVATAR_SHIFT_PROGRESS_FIXTURE || fixture === AVATAR_SNOOZE_FIXTURE
    || fixture === AVATAR_RECAP_FIXTURE || fixture === AVATAR_RECAP_LIVE_FIXTURE || fixture === AVATAR_RECAP_NO_VOICE_FIXTURE || fixture === AVATAR_RECAP_SLOW_FIXTURE || fixture === AVATAR_RECAP_RETRY_FIXTURE || fixture === AVATAR_RECAP_READING_FIXTURE || fixture === AVATAR_RECAP_READING_STILL_FIXTURE || fixture === AVATAR_RECAP_READING_DONE_FIXTURE || fixture === AVATAR_RECAP_PROCESSING_FIXTURE || fixture === AVATAR_RECAP_NEXT_STEPS_FIXTURE || fixture === AVATAR_RECAP_NEXT_STEPS_RECOVERY_FIXTURE || fixture === AVATAR_RECAP_NEXT_STEPS_EMPTY_FIXTURE || fixture === AVATAR_RECAP_NEXT_STEPS_PAIR_FIXTURE || fixture === AVATAR_EOD_BUBBLE_FIXTURE || fixture === AVATAR_AGENDA_BUBBLE_FIXTURE || fixture === AVATAR_EOD_OUTSTANDING_RECAP_FIXTURE || fixture === AVATAR_EOD_OUTSTANDING_AFTER_FIXTURE || fixture === AVATAR_EOD_OUTSTANDING_EXPIRED_FIXTURE || fixture === AVATAR_OBSERVED_FIXTURE;
}

export function avatarMultiSelectScrollFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_MULTI_SELECT_SCROLL_FIXTURE;
}

export function avatarRecapFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_FIXTURE;
}

/** DEV-only fixture for the read-aloud state: the same recap, already being
 * spoken. It plays a shipped voice sample as though the route had answered, so
 * the prompter's motion, Otto's mouth, the dots and the grown bubble can be
 * watched in a browser without a session or a provider call. */
export function avatarRecapReadingFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  const fixture = new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM);
  return fixture === AVATAR_RECAP_READING_FIXTURE
    || fixture === AVATAR_RECAP_READING_STILL_FIXTURE
    || fixture === AVATAR_RECAP_READING_DONE_FIXTURE
    || fixture === AVATAR_RECAP_LIVE_FIXTURE
    || fixture === AVATAR_RECAP_NO_VOICE_FIXTURE
    || fixture === AVATAR_RECAP_SLOW_FIXTURE
    || fixture === AVATAR_RECAP_RETRY_FIXTURE;
}

export function avatarRecapSlowFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_SLOW_FIXTURE;
}

export function avatarRecapRetryFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_RETRY_FIXTURE;
}

/** True only for the no-voice preview. */
export function avatarRecapNoVoiceFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_NO_VOICE_FIXTURE;
}

/** The recap's facts with the capability off: the control must not appear. */
export function avatarRecapNoVoiceFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return { ...avatarRecapFixtureFacts(now), voiceAvailable: false };
}

/** True only for the interactive preview, whose decisions stay on the device. */
export function avatarRecapLiveFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_LIVE_FIXTURE;
}

/** True only for the frozen frame: the bubble renders mid-read with a fixed
 * progress and no audio element at all. */
export function avatarRecapReadingStillFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  const fixture = new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM);
  return fixture === AVATAR_RECAP_READING_STILL_FIXTURE || fixture === AVATAR_RECAP_READING_DONE_FIXTURE;
}

/** True only for the finished frame: the ask row, with the read already over. */
export function avatarRecapReadingDoneFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_READING_DONE_FIXTURE;
}

/** The lines the reading fixture speaks.
 *
 * These are the exact words the shipped voice samples say (`public/voices/*`,
 * see its README), so the preview can be used to judge whether the prompter
 * keeps up with the audio: the text on screen and the voice in your ears are
 * the same sentences. */
export function avatarRecapReadingFixtureLines(): Array<{ text: string; time: string | null }> {
  return [
    { text: "Software-development review across three repositories.", time: null },
    { text: "Reviewed the cursor-pagination code", time: "7:21 PM" },
    { text: "Read the blocker notes and an admin work-dashboard request", time: "7:23 PM" },
    { text: "Checked the review queue for pending reports", time: "7:38 PM" },
    { text: "Opened the connect-screen implementation notes", time: "7:43 PM" },
  ];
}

/** Which shipped sample the reading fixture plays: the first voice, so the
 * preview shows the default the employee would hear. */
export const AVATAR_RECAP_READING_SAMPLE = "/voices/warm.mp3";

/** DEV-only fixture for the post-approval moment: the recap bubble plus the
 * three suggestion kinds, so the chat flow can be exercised end to end. */
export function avatarNextStepsFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_NEXT_STEPS_FIXTURE;
}

/** DEV-only fixture for the recovery path: the conversation holds a moment
 * whose card was lost to an older sync (lead text only), and the load-time
 * recovery must re-attach it from the server. */
export function avatarNextStepsRecoveryFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_NEXT_STEPS_RECOVERY_FIXTURE;
}

/** DEV-only fixture for the vanished-card bug: an older moment is already on
 * screen and a newer one is re-attached right after it, so the render must
 * keep both cards. */
export function avatarNextStepsPairFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_NEXT_STEPS_PAIR_FIXTURE;
}

export function avatarNextStepsPairFixtureChat(): AvatarFixtureTurn[] {
  const lead = "Recap confirmed — while it's fresh, here's what could come next:";
  const oldMoment: RecapNextStepsMoment = {
    intervalId: "fixture-pair-old",
    label: "2:05–2:10 PM",
    status: "ready",
    items: [{
      proposalId: "fixture-pair-old-1",
      operation: "create_task",
      status: "pending",
      title: "Verify Console MCP enablement and workspace settings",
      rationale: "The Console MCP information dialog and workspace General/Integrations views were inspected.",
      taskId: null,
      editable: true,
    }],
    states: {},
    failures: {},
    error: null,
  };
  return [...avatarRecapFixtureChat(),
    { id: "next-steps-fixture-pair-old", role: "assistant", text: lead, nextSteps: oldMoment },
    { id: "next-steps-fixture-pair-new", role: "assistant", text: lead },
  ];
}

/** DEV-only fixture for the empty path: the recovered moment has nothing to
 * action, so it must settle and close like any other finished moment. */
export function avatarNextStepsEmptyFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_NEXT_STEPS_EMPTY_FIXTURE;
}

export function avatarNextStepsRecoveryFixtureChat(intervalId = "fixture-recap"): AvatarFixtureTurn[] {
  return [...avatarRecapFixtureChat(), {
    id: `next-steps-${intervalId}`,
    role: "assistant",
    text: "Recap confirmed — while it's fresh, here's what could come next:",
  }];
}

export function avatarNextStepsFixtureMoment(): RecapNextStepsMoment {
  return {
    intervalId: "fixture-recap",
    label: "2:17–3:17 PM",
    status: "ready",
    items: [
      { proposalId: "fixture-step-1", operation: "complete_task", status: "pending", title: "Wire GitHub context into interval recaps", rationale: "The render tests pass and the recap card shows the recorded activity.", taskId: "fixture-task-1", editable: false },
      { proposalId: "fixture-step-2", operation: "create_task", status: "pending", title: "Deploy the recap next-steps release", rationale: "The release cut is a concrete deliverable visible in the recap.", taskId: null, editable: true },
      { proposalId: "fixture-step-3", operation: "add_subtask", status: "pending", title: "Verify the drawer on staging", rationale: "The drawer shipped untested, so a staging check is still open.", taskId: "fixture-task-2", editable: true },
    ],
    states: {},
    failures: {},
    error: null,
  };
}

/** DEV-only preview phases for the bubble: the wait state, the ready list, and
 * a list long enough to scroll. */
export type AvatarNextStepsFixturePhase = "ready" | "drafting" | "empty" | "long" | "failed";

export function avatarNextStepsFixturePhase(search: string): AvatarNextStepsFixturePhase {
  if (!import.meta.env.DEV) return "ready";
  const value = new URLSearchParams(search).get("avatar-next-steps");
  return value === "drafting" || value === "empty" || value === "long" || value === "failed" ? value : "ready";
}

export function avatarNextStepsFixtureMomentFor(phase: AvatarNextStepsFixturePhase): RecapNextStepsMoment {
  const base = avatarNextStepsFixtureMoment();
  if (phase === "drafting") {
    return { ...base, status: "drafting", items: [], states: {}, failures: {}, error: null };
  }
  if (phase === "empty") {
    return { ...base, status: "empty", items: [], states: {}, failures: {}, error: null };
  }
  if (phase === "failed") {
    return { ...base, status: "failed", items: [], states: {}, failures: {}, error: "Next steps could not be drafted from this recap." };
  }
  if (phase === "long") {
    return {
      ...base,
      items: [
        ...base.items,
        { proposalId: "fixture-step-4", operation: "create_task", status: "pending", title: "Write the rollout note for the companion release", rationale: "The release notes are part of shipping the update.", taskId: null, editable: true },
        { proposalId: "fixture-step-5", operation: "complete_task", status: "pending", title: "Close the stale screenshot-retention ticket", rationale: "The retention work is visible and already verified in the recap.", taskId: "fixture-task-3", editable: false },
      ],
    };
  }
  return base;
}

/** The fixture conversation starts at the moment, not at the recap card: the
 * preview exists to judge the bubble that replaces the panel. */
export function avatarNextStepsFixtureChat(moment: RecapNextStepsMoment): AvatarFixtureTurn[] {
  return [{
    id: `next-steps-${moment.intervalId}`,
    role: "assistant",
    text: "Recap confirmed — while it's fresh, here's what could come next:",
    nextSteps: moment,
  }];
}

/** The words the fixture clip "speaks": the same lead and rows the bubble
 * shows, so the highlight can be previewed without a provider call. */
export function avatarNextStepsFixtureSpeechLines(moment: RecapNextStepsMoment): RecapSpeechLine[] {
  const lines: RecapSpeechLine[] = [{
    text: moment.label ? `Next steps from your ${moment.label} recap.` : "Next steps from your approved recap.",
    time: null,
    ref: "lead",
  }];
  for (const item of moment.items) {
    if (item.title.trim()) lines.push({ text: item.title.trim(), time: null, ref: `${item.proposalId}:title` });
    if (item.rationale.trim()) lines.push({ text: item.rationale.trim(), time: null, ref: `${item.proposalId}:why` });
  }
  return lines;
}

export function avatarRecapProcessingFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_PROCESSING_FIXTURE;
}

/** DEV fixtures render either configured mascot size without the vault. */
export function avatarMascotSizeFixture(search: string): "small" | "large" | null {
  if (!import.meta.env.DEV) return null;
  const value = new URLSearchParams(search).get("avatar-mascot");
  return value === "small" || value === "large" ? value : null;
}

export function avatarShiftProgressFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_SHIFT_PROGRESS_FIXTURE;
}

/** Worktivity observes an active workday while Work OS has not mirrored a
 * session yet, so the companion must stay awake instead of sleeping. */
export function avatarObservedFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_OBSERVED_FIXTURE;
}

export function avatarObservedFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  const instant = new Date(now);
  return {
    ...avatarFixtureFacts(),
    shiftDate: instant.toISOString().slice(0, 10),
    shiftStartsAt: new Date(now - 3 * 60 * 60_000).toISOString(),
    shiftEndsAt: new Date(now + 3 * 60 * 60_000).toISOString(),
    sessionState: "clocked_out",
    clockedInAt: new Date(now - 3 * 60 * 60_000).toISOString(),
    clockedOutAt: new Date(now - 30 * 60_000).toISOString(),
    attendanceState: "active",
    planStatus: "confirmed",
  };
}

export function avatarAttentionFixtureRequested(search: string): boolean {
  if (!avatarFixtureRequested(search)) return false;
  return new URLSearchParams(search).get(AVATAR_ATTENTION_PARAM) === "true";
}

export function avatarSnoozeFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_SNOOZE_FIXTURE;
}

export function avatarEodBubbleFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_EOD_BUBBLE_FIXTURE;
}

export function avatarAgendaBubbleFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_AGENDA_BUBBLE_FIXTURE;
}

/** DEV-only fixture for the wrap-up window with a ready recap still pending:
 * the EOD alert must own the collapsed bubble instead of the recap. */
export function avatarEodOutstandingRecapFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_EOD_OUTSTANDING_RECAP_FIXTURE;
}

/** DEV-only fixture for clock-out inside the EOD grace: the mascot stays in
 * its wrap-up state even though the session is already closed. */
export function avatarEodOutstandingAfterFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_EOD_OUTSTANDING_AFTER_FIXTURE;
}

/** DEV-only fixture for past the one-hour grace with no report: the mascot
 * rests again and the bubble returns to the off-shift prompt. */
export function avatarEodOutstandingExpiredFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_EOD_OUTSTANDING_EXPIRED_FIXTURE;
}

/** The collapsed bubble at clock-out: the EOD prompt with its direct action
 * into the EOD review page. No due hourly prompt, so the fixture renders the
 * bubble without the delivery path a real session owns. */
export function avatarEodBubbleFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return {
    ...avatarShiftProgressFixtureFacts(now),
    promptKind: "eod",
    sessionState: "eod_due",
  };
}

/** The collapsed bubble before the plan is confirmed: the agenda prompt with
 * its direct action into the SOD planning modal. The plan is marked confirmed
 * so the fixture shows the collapsed bubble instead of auto-expanding. */
export function avatarAgendaBubbleFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return {
    ...avatarShiftProgressFixtureFacts(now),
    promptKind: "plan",
  };
}

/** Wrap-up window (shift ends in five minutes) with a ready recap still
 * pending: the EOD alert outranks the recap bubble. */
export function avatarEodOutstandingRecapFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return {
    ...avatarRecapFixtureFacts(now),
    shiftEndsAt: new Date(now + 5 * 60_000).toISOString(),
    sessionState: "eod_due",
    promptKind: "eod",
  };
}

/** Clocked out twenty minutes ago with today's report still unsubmitted,
 * inside the one-hour grace: the mascot stays awake in its wrap-up state. */
export function avatarEodOutstandingAfterFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return {
    ...avatarShiftProgressFixtureFacts(now),
    shiftEndsAt: new Date(now - 20 * 60_000).toISOString(),
    sessionState: "clocked_out",
    clockedOutAt: new Date(now - 15 * 60_000).toISOString(),
    promptKind: null,
  };
}

/** Seventy minutes past the scheduled end with no report: the grace is over,
 * so the mascot rests and no EOD alert is due. */
export function avatarEodOutstandingExpiredFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return {
    ...avatarShiftProgressFixtureFacts(now),
    shiftEndsAt: new Date(now - 70 * 60_000).toISOString(),
    sessionState: "clocked_out",
    clockedOutAt: new Date(now - 65 * 60_000).toISOString(),
    promptKind: null,
  };
}

export function avatarShiftProgressFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  const instant = new Date(now);
  return {
    ...avatarFixtureFacts(),
    shiftDate: instant.toISOString().slice(0, 10),
    shiftStartsAt: new Date(now - 3 * 60 * 60_000).toISOString(),
    shiftEndsAt: new Date(now + 3 * 60 * 60_000).toISOString(),
    sessionState: "active",
    clockedInAt: new Date(now - 90 * 60_000).toISOString(),
    clockedOutAt: null,
    pausedSeconds: 0,
    pausedAt: null,
    planStatus: "confirmed",
  };
}

export function avatarSnoozeFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  const facts = avatarShiftProgressFixtureFacts(now);
  return {
    ...facts,
    promptRequired: true,
    nextPromptAt: new Date(now - 60_000).toISOString(),
    promptKind: "hourly_fallback",
    taskOptions: facts.taskOptions.map((task) => task.id === "fixture-old" ? {
      ...task,
      subtaskTotal: 2,
      subtasks: [
        { id: "fixture-old-subtask-1", title: "Reproduce the stale mirror" },
        { id: "fixture-old-subtask-2", title: "Verify the provider refresh" },
      ],
    } : task),
  };
}

/** Active shift with no due prompt: the ready recap bubble owns the compact
 * window without competing check-in pressure. */
export function avatarRecapFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return avatarShiftProgressFixtureFacts(now);
}

/** A ready, undecided recap shaped exactly like `/ensure` returns: the full
 * disclosure with its exact analyzed evidence, a collapsed Extra notes list,
 * and the quiet coverage line. */
export function avatarRecapFixtureCard(): ActivityIntervalCard {
  return {
    id: "fixture-recap",
    windowStart: "2026-09-29T14:17:00.000Z",
    windowEnd: "2026-09-29T15:17:00.000Z",
    label: "2:17–3:17 PM",
    promptKind: "hourly_fallback",
    generationStatus: "ready",
    reviewStatus: "inferred",
    headline: "Reviewed the cursor-pagination work",
    detail: "Software-development review across three repositories.",
    activities: [
      "7:21 PM — Reviewed the cursor-pagination code",
      "7:23 PM — Read the blocker notes and an admin work-dashboard request",
      "7:38 PM — Checked the review queue for pending reports",
      "7:43 PM — Opened the connect-screen implementation notes",
    ],
    workflow: ["implementation", "verification", "UI inspection"],
    uncertainties: [
      "The exact deployment state after the last test run is unclear.",
      "Whether the scroll fix shipped to the pilot build is not established.",
    ],
    recordedActivity: [
      { description: "Pushed 3 commits to WrazyAI/work-os", relation: "performed", url: "https://github.com/WrazyAI/work-os/compare/fixture" },
      { description: "CI for your commit on main: Work OS CI", relation: "triggered", url: "https://github.com/WrazyAI/work-os/actions/runs/1" },
    ],
    employeeFeedback: null,
    failureReason: null,
    generatedAt: "2026-09-29T15:18:00.000Z",
    reviewedAt: null,
    evidenceExpired: false,
    evidenceCount: 4,
    evidence: [
      { summaryId: "fixture-frame-1", capturedAt: "2026-09-29T14:20:00.000Z", visibleApp: "VS Code", frameSummary: "Editing the recap card's evidence disclosure.", usedInModel: true, rawImageShown: true, selectionReason: "first+raw", retained: true },
      { summaryId: "fixture-frame-2", capturedAt: "2026-09-29T14:41:00.000Z", visibleApp: "Windows Terminal", frameSummary: "Render tests passing in the terminal.", usedInModel: true, rawImageShown: false, selectionReason: "app_transition", retained: true },
      { summaryId: "fixture-frame-3", capturedAt: "2026-09-29T14:58:00.000Z", visibleApp: "Google Chrome", frameSummary: "Companion Tasks stream open in the browser.", usedInModel: true, rawImageShown: false, selectionReason: "app_transition", retained: true },
      { summaryId: "fixture-frame-4", capturedAt: "2026-09-29T15:10:00.000Z", visibleApp: "Work OS", frameSummary: "Composer routing verified in the companion window.", usedInModel: true, rawImageShown: true, selectionReason: "last+raw", retained: true },
    ],
    coverage: { framesRecorded: 12, framesAnalyzed: 4 },
  };
}

/** The fixture chat plus filler turns, so the recap card sits below the fold
 * and View more must actually scroll the thread to reach it. */
export function avatarRecapFixtureChat(): AvatarFixtureTurn[] {
  const filler: AvatarFixtureTurn[] = Array.from({ length: 12 }, (_, index) => ([
    { id: `recap-fixture-user-${index}`, role: "user" as const, text: `Fixture note ${index + 1}: continued work on the dashboard surfaces.` },
    { id: `recap-fixture-assistant-${index}`, role: "assistant" as const, text: `Recorded note ${index + 1}.` },
  ])).flat();
  return [...avatarFixtureChat(), ...filler];
}

/** Loaded day facts with no session, prompt, or agenda pressure: the composer
 * stays in its normal update mode and no contextual banner competes with the
 * cards under review. */
export function avatarFixtureFacts(): AvatarFixtureFacts {
  return {
    loaded: true,
    voiceAvailable: true,
    shiftDate: "2026-09-18",
    promptRequired: false,
    nextPromptAt: null,
    promptKind: null,
    shiftStartsAt: null,
    shiftEndsAt: null,
    sessionState: null,
    clockedInAt: null,
    clockedOutAt: null,
    pausedSeconds: 0,
    lastSubstantiveUpdateAt: null,
    employeeUpdates: 0,
    completedTasks: 0,
    openTasks: 2,
    eodSubmitted: false,
    timezone: "Europe/London",
    planIntent: null,
    personId: "fixture-person",
    displayName: "Fixture",
    niftySyncing: false,
    niftySyncError: null,
    taskOptions: [
      { id: "fixture-new", title: "Visually exercise the avatar chat surfaces", dueDate: "2026-09-18", completed: false },
      { id: "fixture-old", title: "Repair provider sync", dueDate: "2026-09-06", completed: false },
    ],
    planStatus: null,
    planItems: [],
    lateReasonRequired: false,
  };
}

export function avatarMultiSelectScrollFixtureFacts(): AvatarFixtureFacts {
  const taskOptions = Array.from({ length: 23 }, (_, index) => ({
    id: `fixture-scroll-${index + 1}`,
    title: `Review task ${String(index + 1).padStart(2, "0")} before the next handoff`,
    dueDate: null,
    completed: false,
  }));
  return { ...avatarFixtureFacts(), openTasks: taskOptions.length, taskOptions };
}

export function avatarMultiSelectScrollFixtureChat(): AvatarFixtureTurn[] {
  const displayOperation: ProposedOperation = { op: "display_pending_tasks", statement: "Show my pending tasks.", limit: 20, enabled: false };
  const tasks = Array.from({ length: 20 }, (_, index) => ({
    id: `fixture-scroll-${index + 1}`,
    title: `Review task ${String(index + 1).padStart(2, "0")} before the next handoff`,
    due_date: null,
    project_name: "Work OS",
    state: "pending",
    subtask_total: 0,
    subtask_completed: 0,
  }));
  return [
    { id: "fixture-scroll-user", role: "user", text: "Show my pending tasks.", createdAt: "2026-09-18T20:00:00.000Z" },
    {
      id: "fixture-scroll-pending",
      role: "assistant",
      text: "Here are your pending tasks for review. No changes will be made.",
      createdAt: "2026-09-18T20:00:05.000Z",
      operations: [displayOperation],
      toolResults: [{
        op: displayOperation,
        status: "recorded",
        message: "Pending tasks loaded.",
        data: { provider_result: { view: "pending", tasks } },
      }],
    },
  ];
}

export function avatarFixtureChat(): AvatarFixtureTurn[] {
  const displayOperation: ProposedOperation = { op: "display_pending_tasks", statement: "Show my pending tasks.", limit: 20, enabled: false };
  const displayResult: ToolCallResult = {
    op: displayOperation,
    status: "recorded",
    message: "Pending tasks loaded.",
    data: {
      provider_result: {
        view: "pending",
        tasks: [
          { id: "fixture-new", title: "Visually exercise the avatar chat surfaces", due_date: "2026-09-18", project_name: "Work OS", state: "pending", subtask_total: 0, subtask_completed: 0 },
          { id: "fixture-old", title: "Repair provider sync", due_date: "2026-09-06", project_name: "Work OS", state: "overdue", subtask_total: 0, subtask_completed: 0 },
        ],
      },
    },
  };
  const completionOperation: ProposedOperation = {
    op: "complete_task",
    statement: "Employee confirmed completion of Visually exercise the avatar chat surfaces.",
    taskId: "fixture-new",
    taskTitle: "Visually exercise the avatar chat surfaces",
    proposalId: "fixture-proposal-1",
    enabled: false,
  };
  const recordedResult: ToolCallResult = {
    op: completionOperation,
    status: "recorded",
    message: "Recorded. Provider confirmation follows the normal sync state.",
    data: { provider_result: {}, outcome: "applied" },
  };
  return [
    { id: "fixture-u-1", role: "user", text: "Show my pending tasks", createdAt: "2026-09-18T20:00:00.000Z" },
    {
      id: "fixture-a-1",
      role: "assistant",
      text: "Here are your pending tasks for review. No changes will be made.",
      createdAt: "2026-09-18T20:00:05.000Z",
      operations: [displayOperation],
      toolResults: [displayResult],
    },
    {
      id: "fixture-a-2",
      role: "assistant",
      text: "Review the selected task completions before anything changes.",
      createdAt: "2026-09-18T20:01:00.000Z",
      operations: [completionOperation],
      toolResults: [recordedResult],
    },
  ];
}
