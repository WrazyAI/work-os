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
 * The shapes mirror production exactly: the display result carries a real
 * `tasks` array, and the recorded mutation carries the proposal row's
 * `provider_result` object (jsonb `{}`) that must never render as a card
 * (design §25.9, §25.11). Never active outside `import.meta.env.DEV`. */
import type { ProposedOperation, ToolCallResult } from "./interpretation";
import type { CompanionDayFacts } from "./avatarLogic";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";
import type { ActivityIntervalCard } from "./types";

export const AVATAR_FIXTURE_PARAM = "avatar-fixture";
export const AVATAR_RECORDED_FIXTURE = "recorded-completion";
export const AVATAR_SHIFT_PROGRESS_FIXTURE = "shift-progress";
export const AVATAR_OBSERVED_FIXTURE = "observed-working";
export const AVATAR_ATTENTION_PARAM = "avatar-attention";
export const AVATAR_SNOOZE_FIXTURE = "snooze-reminder";
export const AVATAR_RECAP_FIXTURE = "recap";
export const AVATAR_RECAP_PROCESSING_FIXTURE = "recap-processing";
export const AVATAR_RECAP_NEXT_STEPS_FIXTURE = "recap-next-steps";

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
}

export function avatarFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  const fixture = new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM);
  return fixture === AVATAR_RECORDED_FIXTURE || fixture === AVATAR_SHIFT_PROGRESS_FIXTURE || fixture === AVATAR_SNOOZE_FIXTURE
    || fixture === AVATAR_RECAP_FIXTURE || fixture === AVATAR_RECAP_PROCESSING_FIXTURE || fixture === AVATAR_RECAP_NEXT_STEPS_FIXTURE || fixture === AVATAR_OBSERVED_FIXTURE;
}

export function avatarRecapFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_FIXTURE;
}

/** DEV-only fixture for the post-approval moment: the recap bubble plus the
 * three suggestion kinds, so the chat flow can be exercised end to end. */
export function avatarNextStepsFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_RECAP_NEXT_STEPS_FIXTURE;
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
  return {
    ...avatarShiftProgressFixtureFacts(now),
    promptRequired: true,
    nextPromptAt: new Date(now - 60_000).toISOString(),
    promptKind: "hourly_fallback",
  };
}

/** Active shift with no due prompt: the ready recap bubble owns the compact
 * window without competing check-in pressure. */
export function avatarRecapFixtureFacts(now = Date.now()): AvatarFixtureFacts {
  return avatarShiftProgressFixtureFacts(now);
}

/** A ready, undecided recap shaped exactly like `/ensure` returns (no evidence
 * list; the Tasks stream carries the full record). */
export function avatarRecapFixtureCard(): ActivityIntervalCard {
  return {
    id: "fixture-recap",
    windowStart: "2026-09-29T14:17:00.000Z",
    windowEnd: "2026-09-29T15:17:00.000Z",
    label: "2:17–3:17 PM",
    promptKind: "hourly_fallback",
    generationStatus: "ready",
    reviewStatus: "inferred",
    headline: "Reviewed the recap bubble and chat scroll behavior",
    detail: "Worked in the companion chat and the Tasks stream, checked the recap card actions, and verified the composer routing while the plan was pending. The screenshots do not establish whether the change was released.",
    employeeFeedback: null,
    failureReason: null,
    generatedAt: "2026-09-29T15:18:00.000Z",
    reviewedAt: null,
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
