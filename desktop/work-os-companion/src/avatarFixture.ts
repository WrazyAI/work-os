/** DEV-only fixture for the floating companion's visual checks.
 *
 * `?window=avatar&avatar-fixture=recorded-completion` renders a persisted
 * display turn plus a recorded completion without a desktop session token, so
 * the avatar's recorded-result rendering (one action summary, no phantom task
 * card) can be screenshotted and covered by TestSprite on any dev server.
 * `?window=avatar&avatar-fixture=shift-progress` renders the compact companion
 * at a deterministic half-shift point for elapsed-time and progress checks.
 * The shapes mirror production exactly: the display result carries a real
 * `tasks` array, and the recorded mutation carries the proposal row's
 * `provider_result` object (jsonb `{}`) that must never render as a card
 * (design §25.9, §25.11). Never active outside `import.meta.env.DEV`. */
import type { ProposedOperation, ToolCallResult } from "./interpretation";
import type { CompanionDayFacts } from "./avatarLogic";

export const AVATAR_FIXTURE_PARAM = "avatar-fixture";
export const AVATAR_RECORDED_FIXTURE = "recorded-completion";
export const AVATAR_SHIFT_PROGRESS_FIXTURE = "shift-progress";

export interface AvatarFixtureFacts extends CompanionDayFacts {
  loaded: boolean;
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
  return fixture === AVATAR_RECORDED_FIXTURE || fixture === AVATAR_SHIFT_PROGRESS_FIXTURE;
}

export function avatarShiftProgressFixtureRequested(search: string): boolean {
  if (!import.meta.env.DEV) return false;
  return new URLSearchParams(search).get(AVATAR_FIXTURE_PARAM) === AVATAR_SHIFT_PROGRESS_FIXTURE;
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

/** Loaded day facts with no session, prompt, or agenda pressure: the composer
 * stays in its normal update mode and no contextual banner competes with the
 * cards under review. */
export function avatarFixtureFacts(): AvatarFixtureFacts {
  return {
    loaded: true,
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
