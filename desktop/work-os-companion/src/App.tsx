import { hasPendingMascotApproval } from "./mascotApproval";
import { OverflowPanText } from "./OverflowPan";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { lateReasonRequired, PROLONGED_ABSENCE_MINUTES } from "./lateStart";
import { readStoredFlag, writeStoredFlag } from "./storedFlags";
import { emit, listen } from "./tauriEvents";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { isVoiceEventFor, useVoiceInput, VOICE_HOTKEY_LABEL } from "./chat/voiceInput";
import { getVersion } from "@tauri-apps/api/app";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import type { Update } from "@tauri-apps/plugin-updater";
import { UPDATE_AVAILABLE_KEY, UPDATE_CHECK_CADENCE_COPY, UPDATE_CHECK_INTERVAL_MS, applyDownloadEvent, canRunBackgroundUpdateCheck, displayUpdateVersion, INITIAL_UPDATE_DOWNLOAD_PROGRESS, queryAvailableUpdate, resolvePendingUpdate, shouldAutoCheckUpdate, updateAvailableCopy, updateDownloadedCopy, updateDownloadFailedCopy, updateProgressDetails, updateRowCopy, type UpdateDownloadProgress, type UpdateRowCopyInput } from "./updater";
import { changelogBulletsFor, changelogHistory, readAnnouncedVersion, shouldAnnounceUpdate, updateInstalledCopy, WHATS_NEW_ANNOUNCE_KEY, writeAnnouncedVersion } from "./whatsNew";
import { WhatsNewModal } from "./WhatsNewModal";
import CHANGELOG_RAW from "../CHANGELOG.md?raw";
import { relaunch } from "@tauri-apps/plugin-process";
import { Activity, AlertTriangle, Archive, ArrowLeft, BriefcaseBusiness, Bug, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, CirclePause, CirclePlay, Clock3, ExternalLink, FileCheck2, Gauge, LayoutDashboard, ListChecks, LogIn, MessageSquareText, MoreHorizontal, Pause, Pencil, PlugZap, Plus, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Sparkles, SquarePen, Target, Trash2, X } from "lucide-react";
import { ApiRequestError, apiRequest, apiRequestAudio, apiRequestBlob, discardReadyInterpretation, flushQueue, isQueuedResult, readyInterpretations, sendOrQueue, setDebugSession, setSyncBypass, updateTaskCompletion, uploadTaskCompletionEvidence } from "./api";
import { TaskEvidenceDialog, type TaskEvidenceAttachResult } from "./CompletionEvidence";
import { taskRequiresCompletionEvidence, type TaskEvidenceRecord } from "../../../src/modules/work-os/completion-evidence";
import { PLAN_INTERPRET_TIMEOUT_MS, PLAN_REFINE_TIMEOUT_MS } from "../../../src/modules/work-os/plan-timeouts";
import { beginAuthentication, discardPendingAuthentication, errorMessage, listenForAuthentication, reopenPendingAuthentication } from "./auth";
import { diagnostics, exportDiagnostics, openLogsDir } from "./diagnostics";
import { markBootPhase, markCleanExit } from "./bootTrace";
import { startInstanceHeartbeat } from "./instanceHeartbeat";
import { loadMachineCadence } from "./localSettings";
import { openDebuggerWindow } from "./openDebugger";
import { FEATURES } from "./features";
import { formatWorkOsDate, formatWorkOsDateTime, formatWorkOsTime as formatTime, shiftWorkOsDate } from "./dateFormat";
import { useNotifications } from "./NotificationFlyouts";
import Onboarding from "./Onboarding";
import { OnboardingStage } from "./OnboardingStage";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO, insightsFixture } from "./scenarios";
import { sessionGate } from "./sessionGate";
import { shiftPulse } from "./shiftPulse";
import { EOD_SHIFT_OPEN_PREFIX, EOD_SHIFT_OPEN_REASON, EOD_SHIFT_OPEN_SUFFIX, eodDraftBlocked, eodDraftWindowOpen } from "../../../src/lib/work-os-shift-gate";
import { AssigneeTags, EllipsisMenu, TaskActionMenuItems, moveMenuFocus, SyncChip, TaskComposerModal, TaskCarryOverFlyout, TaskDetailsModal, TaskEditModal, EodComposer, EodLoadingState, EodShiftOpenNotice, TaskRemovalConfirmation } from "./taskSurfaces";
import { completionTaskCapabilities, hasTaskMenu, displayTaskState, taskCheckboxA11y, taskCheckboxEnabled, taskDueDateSeed, taskStatusLabel, taskStatusWriteRequired } from "./taskActions";
import { ChatSectionBoundary } from "./ErrorBoundary";
import { AvatarThinking, type AvatarThinkingStage } from "./AvatarThinking";
import { ChatTabs, ChatTimeDivider, ChatTurn, ChatWelcome, ConversationLauncher, ConversationSurface, WorkOsPromptBar, collapseConsecutiveAssistantDuplicates, shouldShowChatDivider, threadScrollTarget, workOsChatCommands } from "./WorkOsChat";
import { HistoryTurn, type HistoryTurnData } from "./chat/HistoryTurn";
import type { RecapNextStepItem } from "./types";
import type { RecapNextStepState } from "./RecapNextStepsCard";
import { taskSelectionFromResult } from "./chat/selection";
import { MASCOT } from "./mascot";
import { fileApprovedOperations, interpretationFallbackReason, isDisplayToolOp, isMutatingToolOp, mergeToolResults, normalizeInterpretation, partialFilingMessage, sameToolCall, simulateAiEod, stripBottleneckSection, extractBottleneckSection, restoreBottleneckSection, toolCallKey, usesGroupedCard, type PendingToolReview, type ProposedOperation, type ToolCallResult } from "./interpretation";
import { NavigateButton } from "./NavigateButton";
import { ChatMarkdown } from "./ChatMarkdown";
import { ApprovalFlow, ApprovalResults } from "./ApprovalFlow";
import { BatchApprovalCards } from "./TaskBatchCard";
import { attachFiledProposals, filedProposalGroups, isBatchToolOp, isPlanImportOp, skipBatchOperation, type FiledProposalRow } from "./interpretation";
import { TaskSelectionCard, type TaskSelectionCardTask } from "./TaskSelectionCard";
import { dayScopedTasks, dayTaskGroups, DEFAULT_TASK_SORT, filterWorkspaceTasks, isOverdueTask, orderTasksByRecency, parentTasks, readTaskSort, safeTaskText, sortTaskList, subtaskProgress, suggestDailyGoal, taskDateAttribution, taskKind, taskSortNote, taskState, tasksForDate, unfinishedBefore, uniqueTasks, writeTaskSort, DAY_SORT_STORAGE_KEY, TASK_SORT_COLUMNS, TASKS_SORT_STORAGE_KEY, TASKS_WORKSPACE_SORT_COLUMNS, type TaskRow, type TaskSort } from "./taskWorkspace";
import { SortHeaderRow } from "./SortHeaderRow";
import { taskViewTabIndex } from "./taskViewTabs";
import { ProgressRing } from "./ProgressRing";
import { prefersReducedMotion, useListShift } from "./listShift";
import type { DailyPlan, DailyPlanItem, DayData, DebugScenario, DesktopSession, EodScreenshotHour, InsightDay, InsightsData, OfflineAction, OnboardingData, OutstandingEodDay } from "./types";
import { secureState, abandonVaultOpen, resetLocalVault, type WorkOsConversationTurn } from "./vault";
import { sessionNotice } from "./sessionState";
import { runVaultGate, type VaultGateSettled, type VaultGateState, type VaultAttempt } from "./vaultGate";
import { TASK_OPTIONS_STALE_MS, workOsKeys } from "./queryClient";
import { fetchDay, fetchOnboarding, fetchTaskDetails, prepareEodScreenshots, reviewMemoryFact, forgetMemoryFact, useActivityIntervalsQuery, useDayQuery, useEodScreenshotsQuery, useHistoricalDayQuery, useInsightsQuery, useMemoryQuery, useOnboardingQuery, useOutstandingEodsQuery, useReportDayQuery, useTaskBacklogQuery, useTaskDetailsQuery, useTaskHistoryQuery, useTaskOptionsQuery, type TaskBacklog, type TaskDetails, type TaskHistoryPage } from "./workOsQueries";
import { MascotPet } from "./MascotPet";
import { mascotFactsFromDay, useMascotRuntime } from "./useMascotRuntime";
import { NotificationsBell, OUTSTANDING_STATUS_META, outstandingRowMeta } from "./NotificationsBell";
import { MEMORY_SEEN_KEY, OVERDUE_NOTIFIED_KEY, RECAP_NOTIFIED_KEY, memoryCandidateIds, mergeOverdueKeys, mergeSeenIds, overdueNotifyKey, overdueSummary, readyRecap, recapNotifyKey, unseenMemoryIds, unseenOverdueKeys } from "./notificationsLogic";
import { fireCompanionToast } from "./scheduler";
import { CheckedMoment } from "./CheckedMoment";
import { BootOverlay, useBootRise } from "./BootHandoff";
import { DashboardSkeleton, FadeArc, TaskListSkeleton } from "./LoadingUi";
import { PlanningSession, type PlanningInterpretation } from "./PlanningSession";
import { ActivityIntervalStream } from "./ActivityIntervalList";
import { buildPlanItemsFromInterpretation } from "./planItems";
import { WorktivityControlNotice } from "./WorktivityControlNotice";
import { isMacOS } from "./platform";
import { retryWorktivityConfirmation, runWorktivityControl, type WorktivityControlAction, type WorktivityControlPhase, type WorktivityControlResult, type WorktivityControlTransport, type WorktivityDesktopResult, type WorktivityPreflight } from "./worktivityControl";
import { MemoryModal } from "./MemorySettings";
import { PersonalSettings } from "./PersonalSettings";
import PageGuide from "./PageGuide";
import GuideTour, { ADMIN_TOUR_PAGES } from "./GuideTour";
import { usePageGuides } from "./usePageGuides";
import { adminSectionForGuideView, guideViewForAdminSection, guideViewForSidebar, isAdminGuideView, type GuideView } from "./guideState";
import { DEFAULT_RECAP_VOICE, normalizeRecapVoice, RECAP_VOICE_EVENT } from "./recapSpeech";
import { browserRecapAudio, createRecapSpeechPlayer, type RecapSpeechSnapshot } from "./recapSpeechPlayer";
import { APPEARANCE_EVENT, applyAppearance, normalizeAppearance, type MascotSize, type TextSize } from "./appearance";
import { ProfileAvatar, ProfileSettings, type ProfileSettingsPatch } from "./ProfileSettings";
import { PersonalInsights } from "./InsightsView";
import AdminWorkspace from "./admin/AdminWorkspace";
import type { AdminNotifications } from "./admin/AdminWorkspace";
import { bootSurface } from "./bootSurface";
import { seedAdminFixtures, seedAdminShellNotifications } from "./admin/adminFixtures";
import { adminKeys, fetchSession } from "./admin/data";
import type { AdminSection, AdminSectionFocus, SessionResponse } from "./admin/types";
import { AdminOttoChat, type AdminArrivalView } from "./adminOtto/AdminOttoChat";
import { AdminOttoSettings } from "./adminOtto/AdminOttoSettings";
import { adminOttoFollowChangedAppliesTo, listenAdminOttoFollowChanged } from "./adminOtto/followSignal";
import type { OttoScope, ReviewedRecap } from "../../../src/modules/work-os/admin-otto/contracts";
import { fetchAdminOttoContext, claimAdminOttoDelivery, fetchAdminOttoInbox, fetchAdminOttoRecap, updateAdminOttoDelivery, transcribeAdminOttoAudio, type AdminOttoContextResponse } from "./adminOtto/api";
import { ADMIN_FIXTURE_TRANSPORT, adminFixtureSpeak, createAdminOttoFollowFixture, FIXTURE_REVIEWED_RECAP, fixtureInboxPage } from "./adminOtto/fixtures";
import { parseAdminRecordHref } from "./adminOtto/recordLinks";
import { useAdminOttoRecapAudio } from "./adminOtto/useAdminOttoRecapAudio";
import { adminOttoRoleAllowed, personalBootstrapFlags, planAdminOttoBootstrap } from "./adminOtto/bootstrap";
import { adminOttoKeys } from "./adminOtto/queryKeys";
import { adminOttoChangedEvent, captureScopeStillCurrent, createOttoModeController, ottoContextEvent, parseAdminOttoChangedEvent, sameOttoScope, OTTO_CHANGED_EVENT, OTTO_CONTEXT_CLEARED_EVENT, OTTO_CONTEXT_EVENT, type AdminOttoContext, type OttoModeController, type OttoModeSnapshot } from "./adminOtto/mode";
import { startAuthorizedAdminRecapDelivery, type AdminRecapDeliveryHandle } from "./adminOtto/delivery";
import { presentAdminRecapArrival } from "./adminOtto/notifications";
import { personalBootstrapAccess, runPersonalBootstrapRefresh, type PersonalBootstrapSource } from "./adminOtto/personalBootstrap";
import { deliveryOwnershipKey, startDeliveryOwnership } from "./adminOtto/ownership";
import { createAdminOttoContextRetry } from "./adminOtto/context";
import { createLocalAudioBus, createOttoAudioBroker, createOttoAudioRequester, installOttoAudioRequester, onOttoAudioStop, onOttoSpeechStop, requestOttoAudio, requestOttoAudioStop, requestOttoSpeechStop, tauriAudioBus, type OttoAudioLease } from "./adminOtto/audioOwner";
import { clearAdminOttoSurface } from "./adminOtto/modeSurface";
import { ADMIN_SHELL_SESSION, adminShellGuideStateFor, adminShellNotificationStateFor, adminShellOttoStateFor, adminShellOverlayFor, adminShellSettingsAccountFor, adminShellSettingsStateFor, isAdminShellBoot, type AdminShellNotificationState, type AdminShellOttoState, type AdminShellOverlay, type AdminShellSettingsState } from "./adminShell";
import { Empty, PageIntro } from "./SharedUi";
import type { PlanAnnotation, PlanDraftEdit } from "./planningAnnotations";
import { overlayScrollLockActive, useModalScrollLock } from "./modalScrollLock";
import { ScrollFadeRegion } from "./ScrollFadeRegion";
import { ActiveWorkdayDashboard, OffShiftDashboard } from "./DashboardSurface";
import { buildWorkdayDashboardModel } from "./dashboardModel";
import SidebarNav, { type SidebarView } from "./SidebarNav";
import { isSettingsHotkey } from "./settingsHotkey";
import { TaskDateNavigator } from "./TaskDateNavigator";
import { resolveDashboardShift } from "./dashboardModel";
import { shouldAutoOpenPlanning, shouldCloseAutoOpenedPlanning } from "./planningGate";
import { attendanceWatchExpectation, attendanceWatchInput } from "./attendanceWatch";
import { useAttendanceWatch } from "./useAttendanceWatch";
import "./plan-insights.css";
import "./insight-charts.css";

type View = SidebarView;
type TaskView = "today" | "unfinished" | "completed" | "all";
type EodScreenshotContext = { processed: number; excluded: number; failed: number; pending: number; hours: EodScreenshotHour[] };

/** Bounded interactive preparation before an EOD draft: four batches of a few
 * frames is enough to cover a day's sampled context without letting a single
 * press run away with vision cost. */
const EOD_PREPARE_ROUNDS = 4;

/** Remembers which workspace this device last opened. The choice is a view
 * preference; the account's role stays the authority on what it may open. */
const WORKSPACE_MODE_KEY = "work-os.workspace-mode";

/** DEV-only boot harness for the real shell in the administration workspace;
 * see `adminShell.ts` for the `?admin-shell[&overlay=…]` contract. Resolved
 * once at module load and inert in a packaged build (and in node tests, where
 * there is no window). */
const ADMIN_SHELL_BOOT = typeof window !== "undefined" && isAdminShellBoot(window.location.search, import.meta.env.DEV);
const ADMIN_SHELL_OVERLAY: AdminShellOverlay | null = ADMIN_SHELL_BOOT
  ? adminShellOverlayFor(window.location.search, import.meta.env.DEV)
  : null;
/** The bell state the `?admin-shell` harness pins (see `adminShell.ts`); null
 * in a packaged build and on every other boot. */
const ADMIN_SHELL_NOTIFICATIONS: AdminShellNotificationState | null = ADMIN_SHELL_BOOT
  ? adminShellNotificationStateFor(window.location.search, import.meta.env.DEV)
  : null;
/** The guide flags the `?admin-shell` harness boots with; `&guides=seen` is
 * what the film shooter uses so a take films the page, not the guide. */
const ADMIN_SHELL_GUIDE_STATE = ADMIN_SHELL_BOOT
  ? adminShellGuideStateFor(window.location.search, import.meta.env.DEV)
  : null;
const ADMIN_SHELL_OTTO: AdminShellOttoState | null = ADMIN_SHELL_BOOT
  ? adminShellOttoStateFor(window.location.search, import.meta.env.DEV)
  : null;
/** Dev-only follow-settings fixture state; see adminShell.ts. It selects a
 * synthetic route state and a second independent admin account without a live
 * account, provider, or database. */
const ADMIN_SHELL_SETTINGS: AdminShellSettingsState | null = ADMIN_SHELL_BOOT
  ? adminShellSettingsStateFor(window.location.search, import.meta.env.DEV)
  : null;
const ADMIN_SHELL_SETTINGS_ACCOUNT: string | null = ADMIN_SHELL_BOOT
  ? adminShellSettingsAccountFor(window.location.search, import.meta.env.DEV)
  : null;

const worktivityControlTransport: WorktivityControlTransport = {
  preflight: (request) => apiRequest<WorktivityPreflight>("/api/work-os/me/workday/worktivity-control", {
    method: "POST",
    headers: { "Idempotency-Key": request.operation_id, "X-Work-OS-Desktop-Control": "companion" },
    body: JSON.stringify(request),
  }),
  execute: (action) => invoke<WorktivityDesktopResult>("worktivity_control", { action }),
  restore: (desktop) => !desktop || desktop.restore_required
    ? invoke<void>("finish_worktivity_control")
    : Promise.resolve(),
  confirm: (request) => apiRequest<Extract<WorktivityControlResult, { status: "confirmed" | "pending" | "blocked" | "not_applied" }>>("/api/work-os/me/workday/worktivity-control", {
    method: "POST",
    headers: { "Idempotency-Key": request.operation_id, "X-Work-OS-Desktop-Control": "companion" },
    body: JSON.stringify(request),
  }),
  sleep: (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
};

type TaskAssigneeOption = { id: string; displayName: string; email: string | null };
type TaskDeletionRequest = { task: Record<string, any>; closeParent: boolean; mode: "archive" | "delete" };
type TaskEditRequest = { task: Record<string, any>; kind: "task" | "subtask" };
type TaskEvidenceRequest = { task: Record<string, any>; mode: "complete" | "attach"; refreshDetails: boolean; savedEvidence?: TaskEvidenceRecord | null };
type ClockInConfirmation = { kind: "late" | "exception"; reason: string; operationId?: string };
type PendingWorktivityControl = { action: WorktivityControlAction; operationId: string; body: Record<string, unknown>; message: string };
function isWorktivityControlResult(value: unknown): value is WorktivityControlResult {
  return !!value && typeof value === "object" && "operation_id" in value && "status" in value
    && ["confirmed", "not_applied", "pending", "desktop_failed", "blocked", "confirmation_required"].includes(String((value as { status: unknown }).status));
}
type MissedClockOutCorrection = { sessionId: string; date: string; clockedInAt: string | null };
type ProgressUpdateKind = "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task";
type ProgressReceipt = { text: string; message: string; kind: ProgressUpdateKind; queued?: boolean; createdAt: string };
type ProgressPanel = "update" | "goal";
/** Update delivery flow shared by the flyout and the Settings row. The
 * plugin's Update object stays referenced while it holds native resources
 * (downloaded installer bytes, version catalog entry). */
type UpdateFlow =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; update: Update; headers: Record<string, string> }
  | { status: "downloading"; update: Update; headers: Record<string, string>; progress: UpdateDownloadProgress }
  | { status: "downloaded"; update: Update }
  | { status: "failed"; update: Update; headers: Record<string, string>; message: string }
  | { status: "installing"; update: Update };
type ComposerMode = "progress" | "agenda";
const views: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "day", label: "My Day", icon: LayoutDashboard }, { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "review", label: "EOD Review", icon: MessageSquareText }, { id: "insights", label: "Insights", icon: Gauge },
  { id: "evidence", label: "Evidence", icon: ShieldCheck }, { id: "settings", label: "Settings", icon: Settings },
];

const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
const initials = (value?: string | null) => (value ?? "Work OS").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "WO";
const timeRemaining = (value?: string | null) => {
  const remaining = value ? Math.max(0, Date.parse(value) - Date.now()) : 0;
  const minutes = Math.floor(remaining / 60_000);
  return value ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : "—";
};
const actionSuccessMessages: Record<string, string> = {
  "check_in.create": "Your update was saved.",
  "proposal.reject": "The proposal was rejected.",
  "proposal.accept": "The proposal was approved.",
  "shift.clock_in": "You are clocked in.",
  "shift.clock_out": "Your workday was closed.",
  "shift.pause_toggle": "Your session status was updated.",
  "shift.resolve_missed_clock_out": "The missed clock-out was corrected.",
  "report.submit": "Your EOD was submitted for review.",
  "task.create": "The task was created.",
  "task.complete": "The task was marked complete.",
  "task.reopen": "The task was reopened.",
  "task.update": "The task was updated.",
  "task.subtask_create": "The subtask was created.",
  "task.subtask_move": "The subtask was moved.",
  "task.archive": "The task was archived.",
  "task.delete": "The task was permanently deleted.",
  "workspace.task_surface": "The task was added to today.",
  "workspace.task_defer": "The task was deferred.",
};

/** One filing transport for approvals and retries: the accept request plus the
 * owner-scoped readback used to reconcile an interrupted response. */
function proposalFilingTransport() {
  return {
    reviewProposal: (proposalId: string, options?: { providerCreateResolution?: "no_task_created" }) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "accept", ...(options?.providerCreateResolution ? { provider_create_resolution: options.providerCreateResolution } : {}) }), signal: AbortSignal.timeout(60_000) }),
    readProposal: (proposalId: string) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`),
    reviewBatch: (batchId: string, body: { decision: "accept" | "reject"; decisions: Array<{ proposal_id: string; decision?: "accept" | "reject"; edits?: Record<string, unknown>; clear_fields?: string[] }> }) => apiRequest(`/api/work-os/proposal-batches/${encodeURIComponent(batchId)}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }),
  };
}


/** How often the review-notification sources (memory, activity intervals) are
 * re-read while the app is open. Matches the day poll cadence. */
const NOTIFICATION_POLL_MS = 60_000;
/** Device-local memory for the Focus tab's goal section (§7.2.1). */
const GOAL_COLLAPSE_KEY = "work-os.focus.goal-collapsed.v1";

/** The seen registries are best-effort local memory: losing them only means a
 * reminder may be announced once more, never that one is lost. */
function readSeenIds(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeSeenIds(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch { /* best effort */ }
}

/** Main companion shell: coordinates cached workday data, task history, and routed workspaces. */
export default function App() {
  const notifications = useNotifications();
  const [session, setSession] = useState<DesktopSession | null>(null);
  const adminOttoSessionRef = useRef(session);
  adminOttoSessionRef.current = session;
  // Why this device was signed out, shown once on the connect screen.
  const [connectNotice, setConnectNotice] = useState<string | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  /** True once a live server day payload has landed this session. The launch
   * snapshot can look like an unresolved plan; auto-open waits for this. */
  const [dayLive, setDayLive] = useState(false);
  const planningAutoOpenedRef = useRef(false);
  const [dayDetailsLoaded, setDayDetailsLoaded] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [view, setView] = useState<View>("day");
  const [workspace, setWorkspace] = useState<"employee" | "admin">(() => (ADMIN_SHELL_BOOT || localStorage.getItem(WORKSPACE_MODE_KEY) === "admin" ? "admin" : "employee"));
  const [input, setInput] = useState("");
  const [progressComposerOpen, setProgressComposerOpen] = useState(false);
  const [progressPanel, setProgressPanel] = useState<ProgressPanel>("update");
  const [pendingProgressUpdate, setPendingProgressUpdate] = useState("");
  const [progressReceipt, setProgressReceipt] = useState<ProgressReceipt | null>(null);
  const [mascotReceipt, setMascotReceipt] = useState<object | null>(null);
  useEffect(() => { if (progressReceipt && !progressReceipt.queued) setMascotReceipt(progressReceipt); }, [progressReceipt]);
  // Full composer conversation. Persists for the app session until the user
  // explicitly clears it (trash) or starts a new chat (plus) — closing the
  // flyout intentionally keeps it.
  const [composerHistory, setComposerHistory] = useState<WorkOsConversationTurn[]>([]);
  const [loadedComposerConversation, setLoadedComposerConversation] = useState<string | null>(null);
  const composerConversationSignature = useRef("");
  const launchUpdateCheckRef = useRef(false);
  const [interpretation, setInterpretation] = useState<{ status: "loading" | "ready"; operations: ProposedOperation[]; taskOptions: Array<{ id: string; title: string }>; reply?: string; results?: ToolCallResult[]; reviewId?: string } | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState<string | null>(null);
  const [composerThinking, setComposerThinking] = useState<{ stages: AvatarThinkingStage[]; active: number; startedAt: number } | null>(null);
  const [voiceHotkeyEnabled, setVoiceHotkeyEnabled] = useState(true);
  const [voiceHotkeyError, setVoiceHotkeyError] = useState<string | null>(null);
  /** Registers or releases the hold-to-talk shortcut and records the truthful
   * result, so Settings never shows a shortcut Windows (or another app)
   * refused, and never claims one is off while it is still captured. */
  const applyVoiceHotkey = useCallback(async (enabled: boolean) => {
    if (!isTauri()) return false;
    try {
      const status = await invoke<{ enabled: boolean; error: string | null }>("set_voice_hotkey", { enabled });
      setVoiceHotkeyError(status.error ?? null);
      return status.enabled;
    } catch {
      setVoiceHotkeyError("Hold-to-talk could not be registered on this device.");
      return false;
    }
  }, []);
  async function toggleVoiceHotkey(enabled: boolean) {
    setVoiceHotkeyEnabled(enabled);
    const applied = await applyVoiceHotkey(enabled);
    setVoiceHotkeyEnabled(applied);
    if (applied !== enabled) return;
    try { await secureState.saveSettings({ voiceHotkey: enabled }); }
    catch (value) { showError(value, "The voice shortcut setting could not be saved.", "Setting not saved"); }
  }
  const [queuedInterpretationId, setQueuedInterpretationId] = useState<string | null>(null);
  const [eodDraft, setEodDraft] = useState<{ markdown: string; source: "ai" | "deterministic" | "simulated"; screenshots?: EodScreenshotContext | null; screenshotSyncUnavailable?: boolean; loom?: { title: string | null; durationSeconds: number | null; createdLocalDate: string | null; verdict: string; url: string } | null } | null>(null);
  const [eodRedrafting, setEodRedrafting] = useState(false);
  /** Live on-demand Worktivity preparation for the day being drafted: null when
   * idle, counts while the composer waits, `pending: null` while the first
   * batch is still being requested. */
  const [eodPreparing, setEodPreparing] = useState<{ date: string; analyzed: number; total: number; pending: number | null; failed: number } | null>(null);
  /** Honest explanation kept after preparation ends when the provider serves
   * no frames for the day (so the composer does not silently look empty). */
  const [eodScreenshotNotice, setEodScreenshotNotice] = useState<string | null>(null);
  const eodPrepareCancelRef = useRef(false);
  const eodPrepareAbandonRef = useRef(false);
  const eodPrepareAbortRef = useRef<AbortController | null>(null);
  const [eodSubmitted, setEodSubmitted] = useState(false);
  const [eodLanding, setEodLanding] = useState(false);
  /** A queued submission has not reached the server yet. */
  const [eodQueued, setEodQueued] = useState(false);
  const [eodGate, setEodGate] = useState<{ gate: string; detail: string } | null>(null);
  const [eodClockedOut, setEodClockedOut] = useState(false);
  /** The day a draft was refused because the shift was still open, with the
   * payload the server judged. A fresh payload supersedes the refusal, so
   * clocking out brings the draft action back. */
  const [eodShiftRefused, setEodShiftRefused] = useState<{ date: string; at: string | null } | null>(null);
  /** A draft is deleted only after the employee confirms the removal. */
  const [eodDeleteConfirmation, setEodDeleteConfirmation] = useState(false);
  const [eodDeleting, setEodDeleting] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [adminOttoEntryOpen, setAdminOttoEntryOpen] = useState(() => ADMIN_SHELL_OTTO !== null);
  const [adminOttoConversationId, setAdminOttoConversationId] = useState<string | null>(null);
  const [adminOttoDraft, setAdminOttoDraft] = useState("");
  const [adminOttoInitialTab, setAdminOttoInitialTab] = useState<"chat" | "recaps">(ADMIN_SHELL_OTTO === "recaps" || ADMIN_SHELL_OTTO === "single" || ADMIN_SHELL_OTTO === "multiple" || ADMIN_SHELL_OTTO === "empty" ? "recaps" : "chat");
  const [adminOttoRequestedRecap, setAdminOttoRequestedRecap] = useState<ReviewedRecap | null>(ADMIN_SHELL_OTTO === "single" ? FIXTURE_REVIEWED_RECAP : null);
  const [adminOttoResetToken, setAdminOttoResetToken] = useState(0);
  const [adminOttoArrival, setAdminOttoArrival] = useState<AdminArrivalView | null>(ADMIN_SHELL_OTTO === "single"
    ? { count: 1, unread: 1, eventIds: [FIXTURE_REVIEWED_RECAP.eventId], recap: FIXTURE_REVIEWED_RECAP }
    : ADMIN_SHELL_OTTO === "multiple"
      ? { count: 3, unread: 3, eventIds: [], recap: null }
      : null);
  const [adminOttoArrivalRevision, setAdminOttoArrivalRevision] = useState(0);
  const [adminOttoFollowRevision, setAdminOttoFollowRevision] = useState(0);
  const adminOttoRetryRequestId = useRef<string | null>(null);
  const rememberAdminOttoRecovery = useCallback((recovery: { draft: string; requestId: string | null }) => {
    setAdminOttoDraft(recovery.draft);
    adminOttoRetryRequestId.current = recovery.requestId;
  }, []);
  const [adminOttoSnapshot, setAdminOttoSnapshot] = useState<OttoModeSnapshot | null>(null);
  const adminOttoSnapshotRef = useRef<OttoModeSnapshot | null>(null);
  useLayoutEffect(() => {
    adminOttoSnapshotRef.current = adminOttoSnapshot;
  }, [adminOttoSnapshot]);
  /** Stable across App renders, including the New chat state updates. The
   * callback still reads the latest published scope from the ref. */
  const handleAdminOttoConversation = useCallback((conversationId: string) => {
    setAdminOttoConversationId(conversationId);
    const snapshot = adminOttoSnapshotRef.current;
    if (!snapshot) return;
    void emit(OTTO_CHANGED_EVENT, adminOttoChangedEvent({
      scope: snapshot.scope,
      epoch: snapshot.epoch,
      eventIds: [],
      conversationId,
    }));
  }, []);
  const [avatarWindowVisible, setAvatarWindowVisible] = useState<boolean | null>(null);
  const [deliveryOwnedContext, setDeliveryOwnedContext] = useState<string | null>(null);
  const adminOttoModeRef = useRef<OttoModeController | null>(null);
  const adminOttoEpochRef = useRef(0);
  const adminOttoDeliveryRef = useRef<AdminRecapDeliveryHandle | null>(null);
  const adminOttoOpenAttemptRef = useRef(0);
  const adminOttoDeviceId = useRef<string>(crypto.randomUUID());
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [eodDate, setEodDate] = useState<string | null>(null);
  const interpretationTaskOptions = () => {
    const rows = uniqueTasks([...(visibleDay?.tasks ?? []), ...taskHistory]).filter((task) => task.completed !== true && !task.pending_status);
    // The interpreter returns Work OS local IDs. Keep that canonical identifier
    // through review and approval so completion proposals are never dropped.
    return rows.map((task) => ({ id: String(task.id), title: String(task.title ?? "Untitled task") }));
  };
  const [planIntent, setPlanIntent] = useState("");
  const [goalProvenance, setGoalProvenance] = useState<"employee" | "suggested" | "accepted_suggestion" | "ai_draft" | null>(null);
  const [suggestionTaskIds, setSuggestionTaskIds] = useState<string[]>([]);
  const [planItems, setPlanItems] = useState<DailyPlanItem[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [planSaveState, setPlanSaveState] = useState<"saved" | "saving" | "offline" | "conflict">("saved");
  const [planningSessionOpen, setPlanningSessionOpen] = useState(false);
  /** Goal text handed from the dock Focus panel to the planning modal. */
  const [planningSeed, setPlanningSeed] = useState<string | null>(null);
  const [planHistoryDate, setPlanHistoryDate] = useState("");
  const [historicalPlan, setHistoricalPlan] = useState<DailyPlan | null>(null);
  const [historicalTasks, setHistoricalTasks] = useState<Array<Record<string, any>>>([]);
  const [taskView, setTaskView] = useState<TaskView>("today");
  const [taskWorkspaceSort, setTaskWorkspaceSort] = useState<TaskSort>(() => readTaskSort(TASKS_SORT_STORAGE_KEY));
  const [taskSearch, setTaskSearch] = useState("");
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [taskFilterFrom, setTaskFilterFrom] = useState("");
  const [taskFilterTo, setTaskFilterTo] = useState("");
  useEffect(() => { writeTaskSort(TASKS_SORT_STORAGE_KEY, taskWorkspaceSort); }, [taskWorkspaceSort]);
  useEffect(() => {
    const timer = window.setTimeout(() => setTaskSearchQuery(taskSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [taskSearch]);
  const [carryOverOpen, setCarryOverOpen] = useState(false);
  const [insightRange, setInsightRange] = useState<"day" | "7d" | "30d">("7d");
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The boot hold releases on a DAY failure only — the shared error string also
  // carries unrelated failures (task history, insights, notifications) that must
  // never end the First Light wait early (bootSurface §4.1).
  const [dayLoadFailed, setDayLoadFailed] = useState(false);
  const [worktivityPending, setWorktivityPending] = useState<PendingWorktivityControl | null>(null);
  const [worktivityControlPhase, setWorktivityControlPhase] = useState<WorktivityControlPhase | null>(null);
  const [clockOutExtendedPrompt, setClockOutExtendedPrompt] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [queueAttentionCount, setQueueAttentionCount] = useState(0);
  const [apiBase, setApiBase] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ status: "idle" });
  const updateFlowRef = useRef<UpdateFlow>({ status: "idle" });
  const updateCheckInFlightRef = useRef(false);
  const updatePaintRef = useRef<unknown>(null);
  const updateRowSummary: UpdateRowCopyInput =
    updateFlow.status === "available" ? { status: "available", version: updateFlow.update.version }
    : updateFlow.status === "downloading" ? { status: "downloading", version: updateFlow.update.version, progress: updateFlow.progress }
    : updateFlow.status === "downloaded" ? { status: "downloaded", version: updateFlow.update.version }
    : updateFlow.status === "failed" ? { status: "failed", version: updateFlow.update.version, message: updateFlow.message }
    : updateFlow.status === "installing" ? { status: "installing", version: updateFlow.update.version }
    : { status: updateFlow.status };
  const [vaultGate, setVaultGate] = useState<VaultGateState>({ status: "pending" });
  const vaultAttemptRef = useRef<VaultAttempt | null>(null);
  // The latest vault opener, kept behind a ref so the boot effect's starter can
  // stay identity-stable across the state churn of an ordinary session. It
  // rejects until the first render supplies the real opener, so an ordering
  // mistake surfaces as a failure screen instead of a silently skipped vault.
  const applyVaultStateRef = useRef<() => Promise<void>>(() => Promise.reject(new Error("The vault opener is not ready yet.")));
  const [refreshing, setRefreshing] = useState(false);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [textSize, setTextSize] = useState<TextSize>("small");
  const [mascotSize, setMascotSize] = useState<MascotSize>("large");
  const [recapVoice, setRecapVoice] = useState<string>(DEFAULT_RECAP_VOICE);
  const [installedVersion, setInstalledVersion] = useState("Reading installed version…");
  const [installedVersionRaw, setInstalledVersionRaw] = useState<string | null>(null);
  const [whatsNew, setWhatsNew] = useState<{ version: string } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [debugPageGuide, setDebugPageGuide] = useState<GuideView | null>(null);
  /** The whole-workspace walk-through: which workspace's pages it walks, so
   * its step list and navigation follow. Null while closed. */
  const [tourScope, setTourScope] = useState<"employee" | "admin" | null>(null);
  /** Where the administration workspace is. The app owns it because the
   * page-guide seam keys first-visit flags by section and the tour drives the
   * section for real; the workspace renders it and never keeps a second copy. */
  const [adminSection, setAdminSection] = useState<AdminSection>("overview");
  const [adminFocus, setAdminFocus] = useState<AdminSectionFocus>({});
  const [connecting, setConnecting] = useState(false);
  /** True after the browser is opened, until the deep-link callback lands or
   *  the employee starts over. The connect screen keeps asking for the browser
   *  approval instead of reverting to the idle first frame. */
  const [awaitingApproval, setAwaitingApproval] = useState(false);
  const authResolutionHandledRef = useRef(false);
  const [taskHistory, setTaskHistory] = useState<Array<Record<string, any>>>([]);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [taskComposerClosing, setTaskComposerClosing] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<Array<{ id: string; title: string; description: string; assignees: string[]; status: "syncing" | "failed"; error?: string }>>([]);
  // Per-task completion flight: the clicked checkbox spins until the server
  // confirms, then the row exits before the caches drop it. Checkboxes no
  // longer honor the global busy flag, so one completion never freezes the
  // rest of the list.
  const [completingTaskIds, setCompletingTaskIds] = useState<Set<string>>(() => new Set());
  const [leavingTaskIds, setLeavingTaskIds] = useState<Set<string>>(() => new Set());
  const [taskComposerTitle, setTaskComposerTitle] = useState("");
  const [taskComposerDescription, setTaskComposerDescription] = useState("");
  const [taskComposerAssignees, setTaskComposerAssignees] = useState<string[]>([]);
  const [taskAssigneeOptions, setTaskAssigneeOptions] = useState<TaskAssigneeOption[]>([]);
  const [taskOptionsLoading, setTaskOptionsLoading] = useState(false);
  const [taskDetails, setTaskDetails] = useState<TaskDetails | null>(null);
  const taskDetailsRef = useRef<TaskDetails | null>(null);
  taskDetailsRef.current = taskDetails;
  const [taskEvidenceRequest, setTaskEvidenceRequest] = useState<TaskEvidenceRequest | null>(null);
  const taskEvidenceRequestSeq = useRef(0);
  const [taskDetailsReadOnly, setTaskDetailsReadOnly] = useState(false);
  const [taskDetailsLoading, setTaskDetailsLoading] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskMenuId, setSubtaskMenuId] = useState<string | null>(null);
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<TaskDeletionRequest | null>(null);
  const [editRequest, setEditRequest] = useState<TaskEditRequest | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [clockInConfirmation, setClockInConfirmation] = useState<ClockInConfirmation | null>(null);
  const [clockOutConfirmation, setClockOutConfirmation] = useState(false);
  const [missedClockOut, setMissedClockOut] = useState<MissedClockOutCorrection | null>(null);
  const [missedClockOutAt, setMissedClockOutAt] = useState("");
  const [missedClockOutReason, setMissedClockOutReason] = useState("");
  const [debugScenario, setDebugScenario] = useState<DebugScenario>(() => {
    // Dev-only boot harness: /?admin-shell renders the administration branch
    // of the real shell (see adminShell.ts). The fixture scenario keeps the
    // global overlays supplied with profile and day data without a live
    // backend, while syncBypass stays off so the branch gate matches prod.
    if (ADMIN_SHELL_BOOT) {
      return { ...DEFAULT_DEBUG_SCENARIO, enabled: true, liveWrites: false, authState: "real", onboardingState: "complete", dayState: "clocked_in" };
    }
    // Dev-only bootstrap: /?offline boots straight into the offline playground
    // (same scenario the debugger's "Offline playground" preset applies).
    const devParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
    if (devParams?.has("ai")) {
      const aiDay = devParams.get("day");
      const allowed = ["no_shift", "scheduled", "shift_start", "clocked_in", "paused", "catch_up", "optional", "final_hour", "eod_due", "eod", "clocked_out"];
      return { ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: false, liveWrites: true, authState: "real", onboardingState: "complete", dayState: (allowed.includes(aiDay ?? "") ? aiDay : "clocked_in") as DebugScenario["dayState"] };
    }
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("offline")) {
      const params = new URLSearchParams(window.location.search);
      const dayState = devParams?.get("day");
      const allowedDayStates = ["no_shift", "scheduled", "shift_start", "clocked_in", "paused", "catch_up", "optional", "final_hour", "eod_due", "eod", "clocked_out"];
      return {
        ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: true, authState: "real",
        onboardingState: "complete", dayState: allowedDayStates.includes(dayState ?? "") ? dayState as DebugScenario["dayState"] : "clocked_in",
        companionForce: params.get("companion"),
      };
    }
    return DEFAULT_DEBUG_SCENARIO;
  });
  const [pulseNow, setPulseNow] = useState(() => new Date());
  const debugRef = useRef(debugScenario);
  const syncBypass = debugScenario.enabled && debugScenario.syncBypass;
  const syncBypassRef = useRef(syncBypass);
  syncBypassRef.current = syncBypass;
  const visibleDay = useMemo(() => applyDayScenario(day, debugScenario), [day, debugScenario]);
  /* The onboarding record and the session that gates the shell are read early:
   * which workspace branch is on screen decides which overlays mount, and that
   * decision feeds the App-level scroll lock below (design §9). */
  const visibleOnboarding = useMemo(() => applyOnboardingScenario(onboarding, debugScenario), [onboarding, debugScenario]);
  const visibleSession = debugScenario.enabled
    ? debugScenario.authState === "unauthenticated" ? null : session ?? { token: "debug-local", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), organizationId: "debug", apiBase: "Local scenario" }
    : session;

  const signedIn = !!session;

  // Whether this account may open the administration workspace is read
  // independently of the employee day payload, so an admin reaches
  // administration even before their own onboarding or day query settles.
  const workSessionQuery = useQuery<SessionResponse>({
    queryKey: adminKeys.session(),
    // The dev-only `?admin-shell` harness has no live account: it answers from
    // a fabricated admin session and keeps the query enabled without one, so
    // the real shell renders the administration branch (see adminShell.ts).
    queryFn: ADMIN_SHELL_BOOT ? async () => ADMIN_SHELL_SESSION : fetchSession,
    enabled: (signedIn || ADMIN_SHELL_BOOT) && !syncBypass,
    staleTime: 5 * 60_000,
  });
  /* Administration reads its own explicit context before any personal
     bootstrap. The POST is the first-use activation and recovery seam; its
     response stays in the non-persisted admin Otto query namespace. */
  const adminOttoContextQuery = useQuery<AdminOttoContextResponse>({
    queryKey: adminOttoKeys({
      userId: workSessionQuery.data?.userId ?? "pending",
      organizationId: workSessionQuery.data?.organizationId ?? "pending",
      mode: "admin",
    }).context,
    queryFn: fetchAdminOttoContext,
    enabled: signedIn && !syncBypass && adminOttoRoleAllowed(workSessionQuery.data?.role ?? null) && !ADMIN_SHELL_BOOT,
    staleTime: 5 * 60_000,
    retry: 0,
  });
  const adminContextState = workSessionQuery.data?.role === "admin" && !ADMIN_SHELL_BOOT
    ? adminOttoContextQuery.isSuccess
      ? { status: "ready" as const, personId: adminOttoContextQuery.data.personId }
      : adminOttoContextQuery.isError
        ? { status: "failed" as const, personId: null }
        : { status: "loading" as const, personId: null }
    : null;
  const adminOttoBootstrap = planAdminOttoBootstrap({
    signedIn,
    syncBypass,
    sessionSettled: workSessionQuery.isSuccess || workSessionQuery.isError,
    sessionFailed: workSessionQuery.isError,
    role: workSessionQuery.data?.role ?? null,
    workspace,
    adminContext: adminContextState,
  });
  const adminShellActive = ADMIN_SHELL_BOOT
    ? workspace === "admin"
    : adminOttoBootstrap.adminShell && !!session;
  const bootstrapEnabled = personalBootstrapFlags({
    syncBypass,
    plan: ADMIN_SHELL_BOOT
      ? { personalBootstrapEnabled: false, personalNotificationsEnabled: true }
      : adminOttoBootstrap,
  });
  const employeeBootstrapEnabled = bootstrapEnabled.personal;
  const personalNotificationReadsEnabled = bootstrapEnabled.notifications;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const personalContextState = adminContextState ? { ...adminContextState, scope: adminOttoContextQuery.data?.scope } : null;
  const adminContextStateRef = useRef(personalContextState);
  adminContextStateRef.current = personalContextState;
  const adminOttoScope = adminOttoSnapshot?.scope ?? (ADMIN_SHELL_BOOT
    ? { userId: ADMIN_SHELL_SESSION.userId, organizationId: ADMIN_SHELL_SESSION.organizationId, mode: "admin" as const }
    : adminOttoContextQuery.data?.scope ?? null);
  // The follow group belongs to the administrator's own account even when no
  // employee workday is mapped, so it falls back to the authoritative session
  // while the admin context is still loading. The shell fixture can point it at
  // a second synthetic admin to prove two accounts keep independent revisions.
  const followSettingsScope: OttoScope | null = adminOttoScope
    ? {
        ...adminOttoScope,
        userId: ADMIN_SHELL_BOOT && ADMIN_SHELL_SETTINGS_ACCOUNT === "two" ? "user-admin-shell-two" : adminOttoScope.userId,
        mode: "admin",
      }
    : workSessionQuery.data
      ? {
          userId: ADMIN_SHELL_BOOT && ADMIN_SHELL_SETTINGS_ACCOUNT === "two" ? "user-admin-shell-two" : workSessionQuery.data.userId,
          organizationId: workSessionQuery.data.organizationId,
          mode: "admin" as const,
        }
      : null;
  const followSettingsScopeRef = useRef<OttoScope | null>(null);
  followSettingsScopeRef.current = followSettingsScope;
  const adminOttoFollowFixture = useMemo(() => (ADMIN_SHELL_BOOT
    ? createAdminOttoFollowFixture({
        account: ADMIN_SHELL_SETTINGS_ACCOUNT === "two" ? "two" : "one",
        scenario: ADMIN_SHELL_SETTINGS ?? "all",
        persist: true,
      })
    : null), []); // the fixture boot is fixed at module load
  const adminOttoEpoch = adminOttoSnapshot?.epoch ?? 1;
  const adminAudio = useAdminOttoRecapAudio({
    scope: adminOttoScope,
    epoch: adminOttoEpoch,
    voice: recapVoice,
    enabled: !!adminOttoScope && adminOttoScope.mode === "admin" && (ADMIN_SHELL_BOOT || adminOttoContextQuery.data?.voiceAvailable === true),
    speak: ADMIN_SHELL_BOOT ? adminFixtureSpeak : undefined,
    onListened: async (eventId) => {
      const requested = adminOttoModeRef.current?.snapshot() ?? null;
      if (!ADMIN_SHELL_BOOT) await updateAdminOttoDelivery({ eventIds: [eventId], action: "listened" });
      const current = adminOttoModeRef.current?.snapshot() ?? null;
      if (requested && (!current
        || current.epoch !== requested.epoch
        || !sameOttoScope(current.scope, requested.scope))) return;
      setAdminOttoArrivalRevision((value) => value + 1);
    },
  });
  const adminAudioRef = useRef(adminAudio);
  adminAudioRef.current = adminAudio;

  const workspaceDefaultApplied = useRef(false);
  useEffect(() => {
    if (workspaceDefaultApplied.current || !workSessionQuery.data) return;
    workspaceDefaultApplied.current = true;
    if (!localStorage.getItem(WORKSPACE_MODE_KEY) && workSessionQuery.data.role === "admin") setWorkspace("admin");
  }, [workSessionQuery.data]);
  useEffect(() => {
    // A saved employee workspace cannot strand an admin with no person record.
    if (workSessionQuery.data?.role !== "admin" || workspace !== "employee") return;
    if (adminContextState?.status === "ready" && adminContextState.personId === null) {
      setWorkspace("admin");
      try { localStorage.setItem(WORKSPACE_MODE_KEY, "admin"); } catch { /* best effort */ }
    }
  }, [workSessionQuery.data?.role, workspace, adminContextState?.status, adminContextState?.personId]);

  /* Which workspace branch is on screen comes from the same boot decision the
   * early returns use: the administration shell must never hold a lock for an
   * employee-only overlay it does not mount, and the boot screens mount no
   * overlays at all. It is resolved this early because the page-guide seam
   * keys its flags by the surface on screen, and the admin section is a
   * different guided surface from the employee pages. The dev-only shell
   * fixture boots without a vault session, so its fabricated session counts as
   * the settled one. */
  const landing = bootSurface({
    vault: vaultGate.status === "failed" ? "failed" : vaultGate.status === "pending" ? "pending" : "ready",
    signedIn: !!visibleSession,
    onboardingLoaded: !!visibleOnboarding,
    onboardingRequired: visibleOnboarding?.onboardingRequired === true,
    workspace,
    role: workSessionQuery.data?.role ?? null,
    syncBypass,
    dayReady: !!visibleDay,
    dayFailed: !!dayLoadFailed,
    adminOtto: workSessionQuery.data?.role === "admin" && !syncBypass && !ADMIN_SHELL_BOOT
      ? { ...(adminContextState ?? { status: "loading" as const, personId: null }), active: adminOttoBootstrap.adminShell }
      : undefined,
  });
  const bootRise = useBootRise(landing);
  const adminWorkspaceBranch = landing === "admin" && (!!session || ADMIN_SHELL_BOOT);
  const employeeWorkspaceBranch = landing === "workspace";

  /* The organization flag says the workspace may use voice input; the server
     capability says this deployment can actually transcribe. The record
     control appears only when both are true, so a companion that shipped ahead
     of its server never offers a control that cannot work (design §8.8). */
  const voiceAvailable = visibleDay?.access?.featureFlags?.voice_input === true
    && visibleDay?.access?.capabilities?.voice_input === true;
  const employeeRecordingLease = useRef<OttoAudioLease | null>(null);
  /* Plain employees have no admin mode controller, so the post-lease fence
   * compares the authoritative session itself; an admin controller, when one
   * exists, must also still be on the same mode/epoch. */
  const workSessionRef = useRef(workSessionQuery.data);
  workSessionRef.current = workSessionQuery.data;
  const voice = useVoiceInput({
    enabled: voiceAvailable,
    surface: "dock",
    onTranscript: (text) => {
      setInput((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
      setProgressPanel("update");
      setProgressComposerOpen(true);
    },
    onRecordingStart: () => {
      setProgressPanel("update");
      setProgressComposerOpen(true);
      // Stop narration in this window only. The microphone waits for the
      // recording lease in `beforeCapture`; the all-audio seam would cancel
      // the capture that is opening.
      requestOttoSpeechStop();
    },
    beforeCapture: async () => {
      const actor = workSessionQuery.data;
      if (!actor) return null;
      const requested = {
        scope: { userId: actor.userId, organizationId: actor.organizationId, mode: "employee" as const },
        epoch: adminOttoEpoch,
      };
      let lease: OttoAudioLease;
      try {
        lease = await requestOttoAudio(requested.scope, requested.epoch, "recording");
      } catch (failure) {
        return failure instanceof Error && failure.message
          ? failure.message
          : "Audio is busy in another companion window.";
      }
      const current = adminOttoModeRef.current?.snapshot() ?? null;
      if (!lease.isActive()
        || !captureScopeStillCurrent({
          requested: requested.scope,
          requestedEpoch: requested.epoch,
          actor,
          session: workSessionRef.current ?? null,
          mode: current,
        })) {
        lease.release();
        return "Audio is busy in another companion window.";
      }
      employeeRecordingLease.current?.release();
      employeeRecordingLease.current = lease;
      return null;
    },
  });
  /* The hold-to-talk listener is registered once; this ref keeps it on the
     newest recorder without re-subscribing on every render. */
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  useEffect(() => {
    if (voice.state !== "idle" && voice.state !== "transcribing") return;
    employeeRecordingLease.current?.release();
    employeeRecordingLease.current = null;
  }, [voice.state]);
  useEffect(() => onOttoAudioStop(() => {
    employeeRecordingLease.current?.release();
    employeeRecordingLease.current = null;
    // A revoked recording or a mode/session boundary closes the microphone
    // before the broker receives the stopped acknowledgement.
    voiceRef.current.cancel();
  }), []);
  const planEditVersion = useRef(0);
  const shiftStartScenarioOpened = useRef(false);
  /* Overlay flags split by the branch that renders them. The App-level scroll
   * lock may only count overlays the branch on screen actually mounts; the
   * administration shell returns before the employee-only overlays, so a stale
   * or auto-opened employee flag there (and equally on the boot screens, which
   * mount no overlays) can never freeze the window with no modal to close.
   * Employee-only flags are ignored, not closed, so a half-finished draft or
   * confirmation survives a visit to administration (design §9). */
  const employeeOnlyOverlaysOpen = taskComposerOpen || !!taskDetails || !!taskEvidenceRequest || !!deleteRequest || !!editRequest || !!clockInConfirmation || !!missedClockOut || !!clockOutConfirmation || !!eodDeleteConfirmation || carryOverOpen || planningSessionOpen || tourScope === "employee";
  /** The profile modal needs the onboarding record it edits; without it the
   * flag renders nothing and must therefore count for nothing. */
  const profileModalOpen = profileOpen && !!visibleOnboarding;
  /** Any overlay but the page guide itself; the guide's auto-open waits for a
   * free screen, so counting an open guide here would be circular. The admin
   * tour renders only in the administration branch, so it blocks the admin
   * guide's auto-open without counting against the employee one. */
  const baseModalOpen = !!whatsNew || profileModalOpen || !!debugPageGuide || memoryOpen || employeeOnlyOverlaysOpen || tourScope === "admin";
  /** The guide that answers for the page on screen: the administration
   * sections have their own guides, keyed and worded for that surface. */
  const pageGuideView = adminWorkspaceBranch ? guideViewForAdminSection(adminSection) : guideViewForSidebar(view);
  const pageGuideLabel = views.find((item) => item.id === view)?.label ?? "this page";
  const {
    open: openPageGuide,
    autoOpen: pageGuideAutoOpen,
    firstVisit: pageGuideFirstVisit,
    openGuide,
    closeGuide,
    disableAutoOpen,
    setAutoOpen: setPageGuideAutoOpen,
  } = usePageGuides({
    // The dev-only `?admin-shell` boot has no vault session, so the fabricated
    // one stands in; its guide flags come from the harness fixture.
    enabled: (!!session || ADMIN_SHELL_BOOT) && !syncBypass,
    organizationId: session?.organizationId ?? (ADMIN_SHELL_BOOT ? ADMIN_SHELL_SESSION.organizationId : null),
    activeView: pageGuideView,
    blocked: baseModalOpen,
    fixture: ADMIN_SHELL_GUIDE_STATE ?? undefined,
  });
  const navigateAdmin = useCallback((next: AdminSection, focus?: AdminSectionFocus) => {
    setAdminSection(next);
    setAdminFocus(focus ?? {});
  }, []);
  /** Open the shared admin surface. The grouped arrival uses this without
   * opening it on its own; only the person's explicit Listen/View action does. */
  const openAdminOttoSurface = useCallback((options: { tab?: "chat" | "recaps"; recap?: ReviewedRecap | null; listen?: boolean; newChat?: boolean } = {}) => {
    const newChat = options.newChat === true;
    setAdminOttoInitialTab(newChat ? "chat" : options.tab ?? "chat");
    setAdminOttoRequestedRecap(newChat ? null : options.recap ?? null);
    if (newChat) {
      setAdminOttoConversationId(null);
      setAdminOttoDraft("");
      setAdminOttoResetToken((value) => value + 1);
    }
    if (options.listen && options.recap) void adminAudioRef.current.listen(options.recap);
    const attempt = ++adminOttoOpenAttemptRef.current;
    if (ADMIN_SHELL_BOOT) {
      setAdminOttoEntryOpen(true);
      return;
    }
    if (adminOttoContextQuery.isSuccess && adminOttoContextQuery.data) {
      setAdminOttoEntryOpen(true);
      return;
    }
    const retry = createAdminOttoContextRetry(async () => {
      const result = await adminOttoContextQuery.refetch();
      return { data: result.data ?? null, error: result.error };
    });
    void retry.retry(null).then((result) => {
      if (attempt !== adminOttoOpenAttemptRef.current || result.stale) return;
      if (result.status !== "ready" || !result.context) {
        notifications.info("Admin Otto could not load its administration context. Try again from New chat.", "Otto unavailable");
        return;
      }
      setAdminOttoEntryOpen(true);
    }).catch(() => {
      if (attempt === adminOttoOpenAttemptRef.current) {
        notifications.info("Admin Otto could not load its administration context. Try again from New chat.", "Otto unavailable");
      }
    });
  }, [adminOttoContextQuery, notifications]);

  /** A result card's record destination. Only a validated same-app admin URL
   * reaches this handler; a reviewed recap opens the real recap focus target,
   * never a fabricated EOD report. */
  const openAdminRecord = useCallback((url: string) => {
    const target = parseAdminRecordHref(url);
    if (!target) {
      notifications.error("That record link is not available in this workspace.", "Record unavailable");
      return;
    }
    const requestedSnapshot = adminOttoModeRef.current?.snapshot() ?? null;
    const requestedToken = session?.token;
    const stillCurrent = () => {
      const current = adminOttoModeRef.current?.snapshot();
      if (session?.token !== requestedToken) return false;
      if (!requestedSnapshot) return !current;
      return !!current
        && current.epoch === requestedSnapshot.epoch
        && current.scope.userId === requestedSnapshot.scope.userId
        && current.scope.organizationId === requestedSnapshot.scope.organizationId
        && current.scope.mode === requestedSnapshot.scope.mode;
    };
    setAdminOttoEntryOpen(false);
    if (target.focus.recapId) {
      const recapId = target.focus.recapId;
      if (ADMIN_SHELL_BOOT) {
        if (recapId === FIXTURE_REVIEWED_RECAP.intervalId) {
          setAdminOttoInitialTab("recaps");
          setAdminOttoRequestedRecap(FIXTURE_REVIEWED_RECAP);
          setAdminOttoEntryOpen(true);
        }
        return;
      }
      void fetchAdminOttoRecap(recapId).then((recap) => {
        if (!stillCurrent()) return;
        setAdminOttoInitialTab("recaps");
        setAdminOttoRequestedRecap(recap);
        setAdminOttoEntryOpen(true);
      }).catch(() => {
        if (!stillCurrent()) return;
        notifications.error("That reviewed recap could not be opened. Try again from the inbox.", "Recap unavailable");
        navigateAdmin(target.section, { personId: target.focus.personId, recapId });
      });
      return;
    }
    if (!stillCurrent()) return;
    navigateAdmin(target.section, target.focus);
  }, [navigateAdmin, notifications, session?.token]);

  /** One grouped-arrival presentation used by both the local delivery owner and
   * an avatar-owned arrival forwarded over the changed event. It never opens a
   * window, switches tabs, starts audio, or moves focus. */
  const presentAdminOttoArrival = useCallback(async (input: {
    count: number;
    unread: number;
    eventIds: string[];
  }): Promise<boolean> => {
    const requestedSnapshot = adminOttoModeRef.current?.snapshot() ?? null;
    const requestedToken = session?.token;
    const isCurrent = () => {
      const current = adminOttoModeRef.current?.snapshot();
      if (session?.token !== requestedToken) return false;
      if (!requestedSnapshot) return !current;
      return !!current
        && current.epoch === requestedSnapshot.epoch
        && current.scope.userId === requestedSnapshot.scope.userId
        && current.scope.organizationId === requestedSnapshot.scope.organizationId
        && current.scope.mode === requestedSnapshot.scope.mode;
    };
    const page = await (ADMIN_SHELL_BOOT ? Promise.resolve(null) : fetchAdminOttoInbox({ limit: 12 })).catch(() => null);
    if (!isCurrent()) return false;
    const recap = page?.items.find((item) => input.eventIds.includes(item.deliveryId))?.recap ?? null;
    setAdminOttoArrival({
      count: input.count,
      unread: page?.unread ?? input.unread,
      eventIds: [...input.eventIds],
      recap,
    });
    setAdminOttoArrivalRevision((value) => value + 1);
    const copy = {
      title: "Reviewed recaps are ready",
      body: input.count === 1
        ? "1 reviewed recap is waiting in the administration inbox."
        : `${input.count} reviewed recaps are waiting in the administration inbox.`,
    };
    const listen = input.count === 1 && recap
      ? [{
          label: "Listen",
          kind: "primary" as const,
          onClick: () => {
            notifications.clearPersistent("admin-otto-recap-arrival");
            setAdminOttoArrival(null);
            openAdminOttoSurface({ tab: "recaps", recap, listen: true });
          },
        }]
      : [];
    const view = [{
      label: input.count === 1 ? "View recap" : "View inbox",
      kind: "quiet" as const,
      onClick: () => openAdminOttoSurface({
        tab: "recaps",
        recap: input.count === 1 ? recap : null,
      }),
    }];
    notifications.persistent("admin-otto-recap-arrival", copy.body, copy.title, "info", {
      icon: "otto",
      actions: [...listen, ...view],
    });
    return true;
  }, [notifications, openAdminOttoSurface, session?.token]);
  /** The admin tour walks the sections for real, so it drives the workspace. */
  const navigateAdminGuide = useCallback((guide: GuideView) => {
    const section = adminSectionForGuideView(guide);
    if (section) navigateAdmin(section);
  }, [navigateAdmin]);
  /** The employee tour lands on sidebar pages and leaves admin views alone. */
  const navigateEmployeeGuide = useCallback((guide: GuideView) => {
    if (!isAdminGuideView(guide)) setView(guide);
  }, []);
  /** The global layer mounts from both branches; it includes the page guide.
   * The admin tour renders only in the administration branch, so it may only
   * hold the lock there. */
  const globalOverlaysOpen = !!whatsNew || profileModalOpen || !!debugPageGuide || openPageGuide !== null || memoryOpen || (tourScope === "admin" && adminWorkspaceBranch);

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | null = null;
    void listen("work-os://debug-show-page-guide", () => {
      if (disposed) return;
      const opened = pageGuideView !== null;
      if (opened && !openPageGuide) setDebugPageGuide(pageGuideView);
      void emit("work-os://debug-page-guide-result", { opened }).catch(() => undefined);
    }).then((off) => {
      if (disposed) off();
      else stop = off;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [openPageGuide, pageGuideView]);

  const showError = useCallback((value: unknown, fallback = "Something went wrong.", title?: string) => {
    const message = errorMessage(value, fallback);
    setError(message);
    notifications.error(message, title);
    return message;
  }, [notifications]);

  /** Either announcement choice marks the running build seen: the success
   * flyout is a one-time notice per version per device (design §19.8). */
  const markUpdateAnnounced = useCallback((version: string) => {
    writeAnnouncedVersion(version);
    notifications.clearPersistent(WHATS_NEW_ANNOUNCE_KEY);
  }, [notifications]);

  const dismissTopLayer = useCallback(() => {
    if (busy) return;
    if (taskEvidenceRequest) { setTaskEvidenceRequest(null); return; }
    if (debugPageGuide) { setDebugPageGuide(null); return; }
    if (tourScope) { setTourScope(null); return; }
    if (openPageGuide) { closeGuide(); return; }
    if (moveMenuId) { setMoveMenuId(null); return; }
    if (subtaskMenuId) { setSubtaskMenuId(null); return; }
    if (deleteRequest) { setDeleteRequest(null); return; }
    if (eodDeleteConfirmation) { setEodDeleteConfirmation(false); return; }
    if (editRequest) { setEditRequest(null); return; }
    if (clockInConfirmation) { setClockInConfirmation(null); return; }
    if (missedClockOut) { setMissedClockOut(null); return; }
    if (clockOutConfirmation) { setClockOutConfirmation(false); return; }
    if (taskDetails) { setTaskDetails(null); return; }
    if (taskComposerOpen) { closeTaskComposer(); return; }
    if (planningSessionOpen) { setPlanningSessionOpen(false); return; }
    if (carryOverOpen) { setCarryOverOpen(false); return; }
    if (profileOpen) { setProfileOpen(false); return; }
    if (whatsNew) setWhatsNew(null);
  }, [busy, carryOverOpen, clockInConfirmation, clockOutConfirmation, closeGuide, debugPageGuide, deleteRequest, editRequest, eodDeleteConfirmation, missedClockOut, moveMenuId, openPageGuide, planningSessionOpen, profileOpen, subtaskMenuId, taskComposerOpen, taskDetails, taskEvidenceRequest, tourScope, whatsNew]);

  // A compact refresh returns empty history/evidence/proposals arrays; the
  // details payload owns those records. Merge so a cheap poll never wipes
  // loaded detail data, and a details load never regresses fresher scalars.
  function mergeDayPayload(current: DayData | null, next: DayData): DayData {
    if (!current) return next;
    const keepFilled = <T,>(incoming: T[] | undefined, existing: T[] | undefined): T[] | undefined =>
      Array.isArray(incoming) && incoming.length === 0 && Array.isArray(existing) && existing.length > 0 ? existing : incoming;
    const nextReport = next.report && typeof next.report === "object" && "markdown" in (next.report as Record<string, unknown>) ? next.report : current.report ?? next.report;
    return {
      ...current,
      ...next,
      tasks: Array.isArray(next.tasks) ? next.tasks : current.tasks,
      taskHistory: keepFilled(next.taskHistory, current.taskHistory),
      evidence: keepFilled(next.evidence, current.evidence),
      proposals: keepFilled(next.proposals, current.proposals),
      report: nextReport,
    } as DayData;
  }

  const appliedPlanKeyRef = useRef<string>("none");
  const planDirtyRef = useRef(false);
  const applyDayPayload = useCallback((nextDay: DayData) => {
    setError("");
    setDayLoadFailed(false);
    setReport(nextDay.report?.markdown ?? "");
    setDay((current) => mergeDayPayload(current, nextDay));
    const plan = nextDay.plan;
    const planKey = plan ? `${plan.id}:${plan.revision ?? 0}:${plan.status ?? ""}` : "none";
    // Never clobber in-progress local plan edits, and only re-apply the plan
    // fields when the server revision actually changed.
    if (!planDirtyRef.current && appliedPlanKeyRef.current !== planKey) {
      appliedPlanKeyRef.current = planKey;
      setPlanIntent(plan?.focus_summary ?? plan?.freeform_intent ?? "");
      setGoalProvenance(plan?.goal_provenance === "suggested" ? "suggested" : plan?.goal_provenance === "ai_draft" ? "ai_draft" : plan?.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : plan?.freeform_intent ? "employee" : null);
      setSuggestionTaskIds(plan?.suggestion_task_ids ?? []);
      setPlanItems([...(plan?.items ?? [])].sort((a, b) => a.rank - b.rank));
      setPlanDirty(false); setPlanSaveState("saved");
    }
    setPlanHistoryDate((current) => current || nextDay.shiftDate);
  }, []);

  useEffect(() => { planDirtyRef.current = planDirty; }, [planDirty]);

  const queryClient = useQueryClient();

  /* Dev-only `?admin-shell` boot (see adminShell.ts): seed the administration
   * fixtures so the real shell renders its sections with data and without live
   * calls, seed the masthead bell's own reads for the states that flow through
   * the queries, and open the requested overlay once. Inert in a packaged
   * build. */
  useMemo(() => {
    if (!ADMIN_SHELL_BOOT) return;
    seedAdminFixtures(queryClient, "dense");
    if (ADMIN_SHELL_NOTIFICATIONS === "populated" || ADMIN_SHELL_NOTIFICATIONS === "empty") {
      seedAdminShellNotifications(queryClient, ADMIN_SHELL_NOTIFICATIONS, visibleDay?.shiftDate ?? null);
    }
  }, [queryClient]); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot fixture boot; the day scenario is fixed at boot
  useEffect(() => {
    if (!ADMIN_SHELL_BOOT || !ADMIN_SHELL_OTTO) return;
    setAdminOttoEntryOpen(true);
    setAdminOttoInitialTab(ADMIN_SHELL_OTTO === "recaps" || ADMIN_SHELL_OTTO === "single" || ADMIN_SHELL_OTTO === "multiple" || ADMIN_SHELL_OTTO === "empty" ? "recaps" : "chat");
  }, []);
  useEffect(() => {
    if (!ADMIN_SHELL_BOOT || !ADMIN_SHELL_OVERLAY) return;
    if (ADMIN_SHELL_OVERLAY === "whats-new") setWhatsNew({ version: changelogHistory(CHANGELOG_RAW)[0]?.version ?? "0.0.0" });
    else if (ADMIN_SHELL_OVERLAY === "profile") setProfileOpen(true);
    else if (ADMIN_SHELL_OVERLAY === "guide") setDebugPageGuide(guideViewForSidebar("day"));
    else if (ADMIN_SHELL_OVERLAY === "memory") setMemoryOpen(true);
    else setTaskComposerOpen(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- one-shot fixture boot; only stable setters are used
  /** Invalidate the day, backlog, and insight surfaces that depend on task mutations. */
  const invalidateDayData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") });
    void queryClient.invalidateQueries({ queryKey: workOsKeys.day("details") });
    void queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() });
    void queryClient.invalidateQueries({ queryKey: ["work-os", "insights"] });
  }, [queryClient]);
  /** One inline decision on a recap next-step suggestion from the shared
   * conversation, filed through the same owner-scoped proposal endpoint as the
   * companion's card (with the employee's inline title edit when present). */
  const decideNextStepFromHistory = useCallback(async (turnId: string, item: RecapNextStepItem, decision: "accept" | "skip", edits?: { name?: string }) => {
    const patchMoment = (patch: (moment: NonNullable<WorkOsConversationTurn["nextSteps"]>) => NonNullable<WorkOsConversationTurn["nextSteps"]>) => {
      setComposerHistory((current) => current.map((turn) => turn.id === turnId && turn.nextSteps
        ? { ...turn, nextSteps: patch(turn.nextSteps) }
        : turn));
    };
    patchMoment((moment) => ({ ...moment, states: { ...moment.states, [item.proposalId]: "processing" } }));
    try {
      const row = await apiRequest<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${encodeURIComponent(item.proposalId)}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ decision: decision === "skip" ? "reject" : "accept", ...(edits ? { edits } : {}) }),
        signal: AbortSignal.timeout(60_000),
      });
      const outcome = row?.outcome ?? "";
      const state: RecapNextStepState = decision === "skip" || outcome === "rejected" ? "skipped"
        : outcome === "applied" ? "applied"
          : outcome === "applying" ? "processing"
            : "failed";
      patchMoment((moment) => ({
        ...moment,
        states: { ...moment.states, [item.proposalId]: state },
        failures: state === "failed"
          ? { ...moment.failures, [item.proposalId]: row?.failure_reason ?? "The change could not be applied." }
          : moment.failures,
      }));
      if (state === "applied" || state === "skipped") invalidateDayData();
    } catch (value) {
      patchMoment((moment) => ({
        ...moment,
        states: { ...moment.states, [item.proposalId]: "failed" },
        failures: { ...moment.failures, [item.proposalId]: value instanceof Error ? value.message : "The change could not be applied." },
      }));
    }
  }, [invalidateDayData]);

  /** Refresh outstanding EOD state after actions that may change review readiness. */
  const invalidateOutstandingEods = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workOsKeys.outstandingEods() });
  }, [queryClient]);

  /** Stable row identity shared by optimistic cache updates and provider-backed rows. */
  const taskRowId = (task: Record<string, any>) => String(task.provider_task_id || task.id);
  /** The employee's current day, used to recompute the overdue lock when a cache
   * patch flips completion without a server payload to read it from. */
  const taskCalendarDate = visibleDay?.shiftDate || new Date().toISOString().slice(0, 10);
  /** Merge a partial patch into one row and keep its capability payload truthful
   * when completion flips: a just-completed row offers Reopen immediately, and
   * a just-reopened row offers Mark complete, without waiting for a refetch. */
  const taskAfterPatch = (task: Record<string, any>, patch: Record<string, any>) => {
    const next = { ...task, ...patch };
    if (typeof patch.completed === "boolean" && next.capabilities && typeof next.capabilities === "object") {
      next.capabilities = completionTaskCapabilities(next, next.completed === true, taskCalendarDate);
    }
    return next;
  };
  /** Apply a partial task patch only to the matching provider-backed cache row. */
  const patchTaskRow = (task: Record<string, any>, rowId: string, patch: Record<string, any>) =>
    taskRowId(task) === rowId ? taskAfterPatch(task, patch) : task;

  /** Update every loaded sorted-history variant, then revalidate active ones so
   * completion filters and page boundaries stay authoritative after writes. */
  const updateTaskHistoryVariants = useCallback((
    updater: (current: InfiniteData<TaskHistoryPage>, completedOnly: boolean) => InfiniteData<TaskHistoryPage>,
  ) => {
    const queries = queryClient.getQueryCache().findAll({ queryKey: workOsKeys.taskHistory() });
    for (const query of queries) {
      const completedOnly = query.queryKey[2] === "completed";
      queryClient.setQueryData<InfiniteData<TaskHistoryPage>>(query.queryKey, (current) =>
        current ? updater(current, completedOnly) : current);
    }
  }, [queryClient]);
  /** Refetch active sorted-history variants after a mutation changes membership or order. */
  const revalidateTaskHistoryVariants = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workOsKeys.taskHistory(), refetchType: "active" });
  }, [queryClient]);

  /** Surgical cache updates: a task write patches loaded rows immediately, then
   * active sorted pages revalidate so changed sort keys cannot stay misplaced. */
  const patchTaskCaches = useCallback((rowId: string, patch: Record<string, any>) => {
    updateTaskHistoryVariants((current, completedOnly) => ({
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        tasks: page.tasks.flatMap((task) => {
          if (taskRowId(task) !== rowId) return [task];
          const next = taskAfterPatch(task, patch);
          return completedOnly && next.completed !== true ? [] : [next];
        }),
      })),
    }));
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.map((task) => patchTaskRow(task, rowId, patch)),
      } : current);
    }
    if (patch.completed === true) {
      // The backlog is open-only: completing a task removes it and shifts the
      // counts immediately, then a refetch confirms the server totals.
      queryClient.setQueryData<TaskBacklog>(workOsKeys.taskBacklog(), (current) => {
        if (!current || !current.counts || !current.tasks.some((task) => taskRowId(task) === rowId)) return current;
        return {
          tasks: current.tasks.filter((task) => taskRowId(task) !== rowId),
          counts: { total: Math.max(0, current.counts.total - 1), open: Math.max(0, current.counts.open - 1), completed: current.counts.completed + 1 },
        };
      });
      void queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() });
    } else {
      queryClient.setQueryData<TaskBacklog>(workOsKeys.taskBacklog(), (current) => current ? {
        ...current,
        tasks: current.tasks.map((task) => patchTaskRow(task, rowId, patch)),
      } : current);
      if (patch.completed === false) void queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() });
    }
    revalidateTaskHistoryVariants();
  }, [queryClient, revalidateTaskHistoryVariants, updateTaskHistoryVariants, taskCalendarDate]);

  /** Remove a task from every loaded task-history, day, and backlog cache. */
  const removeTaskFromCaches = useCallback((rowId: string) => {
    updateTaskHistoryVariants((current) => ({
      ...current,
      pages: current.pages.map((page) => ({ ...page, tasks: page.tasks.filter((task) => taskRowId(task) !== rowId) })),
    }));
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.filter((task) => taskRowId(task) !== rowId),
      } : current);
    }
    queryClient.setQueryData<TaskBacklog>(workOsKeys.taskBacklog(), (current) => {
      if (!current) return current;
      const tasks = current.tasks.filter((task) => taskRowId(task) !== rowId);
      if (!current.counts) return { ...current, tasks };
      const removed = current.tasks.length - tasks.length;
      return { tasks, counts: { ...current.counts, total: Math.max(0, current.counts.total - removed), open: Math.max(0, current.counts.open - removed) } };
    });
    revalidateTaskHistoryVariants();
  }, [queryClient, revalidateTaskHistoryVariants, updateTaskHistoryVariants]);

  /** Swap a pending row for the server row in the same slot, so the list
   * never loses or gains a row while the swap happens. */
  const replaceTaskInCaches = useCallback((rowId: string, task: Record<string, any>) => {
    updateTaskHistoryVariants((current, completedOnly) => ({
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        tasks: page.tasks.flatMap((row) => {
          if (taskRowId(row) !== rowId) return [row];
          return completedOnly && task.completed !== true ? [] : [task];
        }),
      })),
    }));
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.map((row) => taskRowId(row) === rowId ? task : row),
      } : current);
    }
    queryClient.setQueryData<TaskBacklog>(workOsKeys.taskBacklog(), (current) => current ? {
      ...current,
      tasks: current.tasks.map((row) => taskRowId(row) === rowId ? task : row),
    } : current);
    revalidateTaskHistoryVariants();
  }, [queryClient, revalidateTaskHistoryVariants, updateTaskHistoryVariants]);

  /** Optimistically insert a task into loaded list caches, respecting completed-only history variants. */
  const insertTaskIntoCaches = useCallback((task: Record<string, any>) => {
    updateTaskHistoryVariants((current, completedOnly) => {
      if (completedOnly && task.completed !== true) return current;
      if (!current.pages.length) return current;
      const exists = current.pages.some((page) => page.tasks.some((row) => taskRowId(row) === taskRowId(task)));
      if (exists) return current;
      return { ...current, pages: [{ ...current.pages[0], tasks: [task, ...current.pages[0].tasks] }, ...current.pages.slice(1)] };
    });
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => {
        if (!current) return current;
        if (current.tasks.some((row) => taskRowId(row) === taskRowId(task))) return current;
        return { ...current, tasks: [task, ...current.tasks] };
      });
    }
    queryClient.setQueryData<TaskBacklog>(workOsKeys.taskBacklog(), (current) => {
      if (!current || current.tasks.some((row) => taskRowId(row) === taskRowId(task))) return current;
      if (!current.counts) return { ...current, tasks: [task, ...current.tasks] };
      return { tasks: [task, ...current.tasks], counts: { ...current.counts, total: current.counts.total + 1, open: current.counts.open + 1 } };
    });
  }, [queryClient, updateTaskHistoryVariants]);
  /** Optimistic adds are cache rows like any other, carrying `pending_status`
   * until the server record replaces them in place. Two commits (one for the
   * pending row, one for the real row) would move the list down and back up
   * around a task that never actually moved. */
  const insertPendingTaskIntoCaches = useCallback((pending: { id: string; title: string; description: string; dueDate?: string | null }) => {
    insertTaskIntoCaches({
      id: pending.id,
      title: pending.title,
      description: pending.description,
      completed: false,
      due_date: pending.dueDate ?? null,
      pending_status: "syncing",
    });
  }, [insertTaskIntoCaches]);

  const detailsViews = view === "tasks" || view === "review" || view === "evidence";
  const selectedTaskDate = planHistoryDate || visibleDay?.shiftDate || "";
  const selectedTaskDateIsHistorical = !!visibleDay?.shiftDate && selectedTaskDate !== visibleDay.shiftDate;

  // Reads are cached with TTLs and de-duplicated by react-query. The compact
  // snapshot refreshes every minute in the background; heavy details load only
  // when a workspace that needs them opens.
  const compactDayQuery = useDayQuery({ enabled: employeeBootstrapEnabled, variant: "compact", pollMs: 60_000 });
  const detailsDayQuery = useDayQuery({ enabled: employeeBootstrapEnabled && detailsViews, variant: "details" });
  // Share the scoped options cache between the drawer and the composer.
  const drawerAssigneeQuery = useTaskOptionsQuery({ enabled: employeeBootstrapEnabled && !!taskDetails && !taskDetailsReadOnly });
  const onboardingQuery = useOnboardingQuery({ enabled: employeeBootstrapEnabled });
  const setWorkspaceMode = (next: "employee" | "admin") => {
    if (next === workspace) return;
    if (next === "employee" && adminContextState?.status === "ready" && adminContextState.personId === null) {
      notifications.info("This account has no personal workday mapped, so the administration workspace stays open.", "Employee view unavailable");
      return;
    }
    // Cross the epoch before the shell swaps branches: the old mode's
    // microphone, prepared audio and visible Otto results are fenced, while
    // the employee prompt state remains its own store.
    void adminOttoModeRef.current?.switchMode(next).catch(() => undefined);
    if (next === "employee") {
      setAdminOttoEntryOpen(false);
      setAdminOttoConversationId(null);
      setAdminOttoDraft("");
    }
    setWorkspace(next);
    // Opening the administration workspace lands on Overview, the same way
    // the shell did when it owned the section itself.
    if (next === "admin") {
      setAdminSection("overview");
      setAdminFocus({});
    }
    try {
      localStorage.setItem(WORKSPACE_MODE_KEY, next);
    } catch {
      // The preference is best-effort; the live state above still applies.
    }
  };

  /* The avatar window is the normal notification owner. Main only needs its
     visibility, checked on the same minute cadence as the delivery loop, so a
     hidden or destroyed avatar falls back without a second owner. */
  useEffect(() => {
    if (!isTauri()) {
      setAvatarWindowVisible(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const windows = await getAllWebviewWindows();
        const avatar = windows.find((candidate) => candidate.label === "avatar");
        const visible = avatar ? await avatar.isVisible() : false;
        if (!cancelled) setAvatarWindowVisible(visible);
      } catch {
        if (!cancelled) setAvatarWindowVisible(false);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  /* One mode controller owns actor + organization + mode + epoch. It is
     created from a validated context, updates as the context query resolves,
     and follows the selected workspace. */
  useEffect(() => {
    const sessionData = workSessionQuery.data;
    if (!signedIn || syncBypass || !sessionData || !adminOttoRoleAllowed(sessionData.role)) {
      // Employees and managers never create an admin controller, publish an
      // admin epoch, or start the admin delivery loop.
      if (adminOttoSnapshot) void emit(OTTO_CONTEXT_CLEARED_EVENT, ottoContextEvent(adminOttoSnapshot));
      void adminOttoDeliveryRef.current?.stop();
      adminOttoDeliveryRef.current = null;
      adminOttoModeRef.current?.dispose();
      adminOttoModeRef.current = null;
      setAdminOttoSnapshot(null);
      setAdminOttoEntryOpen(ADMIN_SHELL_BOOT && ADMIN_SHELL_OTTO !== null);
      setAdminOttoConversationId(null);
      setAdminOttoDraft("");
      return;
    }
    const adminCtx: AdminOttoContext | null = adminContextState?.status === "ready" && adminOttoContextQuery.data
      ? {
          scope: adminOttoContextQuery.data.scope,
          personId: adminOttoContextQuery.data.personId,
          voiceAvailable: adminOttoContextQuery.data.voiceAvailable,
          transcriptionAvailable: adminOttoContextQuery.data.transcriptionAvailable,
        }
      : null;
    const employeeCtx: AdminOttoContext | null = sessionData.personId
      ? {
          scope: { userId: sessionData.userId, organizationId: sessionData.organizationId, mode: "employee" },
          personId: sessionData.personId,
          voiceAvailable: false,
          transcriptionAvailable: false,
        }
      : null;
    const desired: "admin" | "employee" = adminShellActive ? "admin" : "employee";
    if (!adminCtx) {
      // An admin role always waits for its authoritative context. Never keep
      // an employee-scope controller underneath a loading/failed admin shell.
      void adminOttoDeliveryRef.current?.stop();
      adminOttoDeliveryRef.current = null;
      if (adminOttoSnapshot) void emit(OTTO_CONTEXT_CLEARED_EVENT, ottoContextEvent(adminOttoSnapshot));
      adminOttoModeRef.current?.dispose();
      adminOttoModeRef.current = null;
      requestOttoAudioStop();
      voiceRef.current.cancel();
      setAdminOttoSnapshot(null);
      setAdminOttoEntryOpen(false);
      return;
    }
    let current = adminOttoModeRef.current;
    if (current && (current.snapshot().scope.userId !== sessionData.userId
      || current.snapshot().scope.organizationId !== sessionData.organizationId)) {
      // A different account must never inherit the previous epoch or results.
      if (adminOttoSnapshot) void emit(OTTO_CONTEXT_CLEARED_EVENT, ottoContextEvent(adminOttoSnapshot));
      current.dispose();
      adminOttoModeRef.current = null;
      current = null;
      setAdminOttoSnapshot(null);
      setAdminOttoEntryOpen(false);
      setAdminOttoConversationId(null);
      setAdminOttoDraft("");
    }
    if (!current) {
      const initial = desired === "admin" ? adminCtx : employeeCtx ?? adminCtx;
      if (!initial) return;
      const controller = createOttoModeController({
        initialEpoch: ++adminOttoEpochRef.current,
        initialContext: initial,
        adminContext: adminCtx,
        employeeContext: employeeCtx,
        abort: () => {
          void adminOttoDeliveryRef.current?.stop();
          setAdminOttoEntryOpen(false);
        },
        stopAudio: () => { requestOttoAudioStop(); },
        stopMicrophone: () => { voiceRef.current.cancel(); },
        clearResults: (_mode, reason) => {
          setAdminOttoEntryOpen(false);
          setAdminOttoConversationId((current) => clearAdminOttoSurface(reason, current).conversationId);
        },
        publish: (snapshot) => {
          adminOttoEpochRef.current = snapshot.epoch;
          setAdminOttoSnapshot(snapshot);
          void emit(OTTO_CONTEXT_EVENT, ottoContextEvent(snapshot));
        },
      });
      adminOttoModeRef.current = controller;
      setAdminOttoSnapshot(controller.snapshot());
      return;
    }
    current.setContexts({ adminContext: adminCtx, employeeContext: employeeCtx });
    if (current.snapshot().scope.mode !== desired) {
      void current.switchMode(desired).catch((error) => {
        if (desired === "employee") {
          notifications.info(errorMessage(error, "This account has no personal workday mapped."), "Employee view unavailable");
        }
      });
    }
  }, [signedIn, syncBypass, workSessionQuery.data, adminContextState?.status, adminContextState?.personId, adminShellActive, adminOttoContextQuery.data, adminOttoSnapshot, notifications]);

  /* A reconnect or focus re-reads the explicit context (activation/role can
     have changed on the server) without touching personal bootstrap. */
  useEffect(() => {
    if (!adminShellActive) return;
    const refresh = () => { void adminOttoContextQuery.refetch(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [adminShellActive, adminOttoContextQuery.refetch]);

  useEffect(() => {
    if (adminContextState?.status !== "failed") return;
    notifications.error("Admin Otto could not load its administration context. The workspace record remains available; retry from New chat.", "Otto unavailable");
  }, [adminContextState?.status, notifications]);

  useEffect(() => () => {
    void adminOttoDeliveryRef.current?.stop();
    adminOttoModeRef.current?.dispose();
  }, []);

  /* One audio broker for every companion window. The persistent main process
     owns it even while hidden; the avatar's requests reach it through Tauri.
     The local bus keeps this window's own request/revoke/grant path synchronous
     and is exercisable without a second webview. */
  useEffect(() => {
    const local = createLocalAudioBus();
    const broker = createOttoAudioBroker({ local, remote: tauriAudioBus() });
    const requester = createOttoAudioRequester({ windowId: "main", bus: local });
    void broker.start();
    const uninstall = installOttoAudioRequester(requester);
    return () => {
      uninstall();
      requester.dispose();
      void broker.stop();
    };
  }, []);

  useEffect(() => {
    adminOttoOpenAttemptRef.current++;
    adminOttoRetryRequestId.current = null;
    setAdminOttoEntryOpen(false);
    setAdminOttoConversationId(null);
    setAdminOttoDraft("");
  }, [session?.token, session?.organizationId]);

  /* A late avatar boot needs the current context again: publish when the
     avatar becomes visible, not only when this window crosses an epoch. */
  useEffect(() => {
    if (!isTauri() || avatarWindowVisible !== true || !adminOttoSnapshot) return;
    const publish = () => { void emit(OTTO_CONTEXT_EVENT, ottoContextEvent(adminOttoSnapshot)); };
    publish();
    // A late avatar listener still adopts the current epoch even when this
    // main window has not crossed a boundary since it booted.
    const timer = window.setInterval(publish, 30_000);
    return () => window.clearInterval(timer);
  }, [avatarWindowVisible, adminOttoSnapshot]);

  /* Heartbeats belong to a stable subscription, not the poll effect. Renewing
     a remote lease must not tear down and restart the local delivery loop. */
  useEffect(() => {
    if (!adminOttoSnapshot || (isTauri() && avatarWindowVisible === null)) return;
    const key = deliveryOwnershipKey(adminOttoSnapshot);
    return startDeliveryOwnership({
      window: "main", context: adminOttoSnapshot, avatarVisible: isTauri() && avatarWindowVisible === true,
      onChange: (owns) => setDeliveryOwnedContext(owns ? key : null),
    });
  }, [adminOttoSnapshot, avatarWindowVisible]);

  /* Main-window fallback delivery. The avatar owns this normally; main starts
     only when the avatar is known to be unavailable, still polls while hidden,
     drains catch-up pages once, and releases leases on cleanup. */
  useEffect(() => {
    const snapshot = adminOttoSnapshot;
    if (!snapshot) return;
    // Wait for the first visibility read before choosing an owner in Tauri;
    // starting on "unknown" would race the avatar's own loop.
    if (isTauri() && avatarWindowVisible === null) return;
    if (deliveryOwnedContext !== deliveryOwnershipKey(snapshot)) return;
    const controller = startAuthorizedAdminRecapDelivery({
      signedIn, syncBypass, session: workSessionQuery.data ?? null,
      scope: snapshot.scope,
      epoch: snapshot.epoch,
      deviceId: adminOttoDeviceId.current,
      windowId: "main",
      api: {
        fetchInbox: (input) => fetchAdminOttoInbox(input),
        claim: (input) => claimAdminOttoDelivery(input),
        updateState: (input) => updateAdminOttoDelivery(input),
      },
      isCurrent: (epoch, scope) => {
        if (adminOttoSessionRef.current?.token !== session?.token
          || adminOttoSessionRef.current?.organizationId !== session?.organizationId) return false;
        const controller = adminOttoModeRef.current;
        const current = controller?.snapshot();
        return !!controller?.isCurrent(epoch) && current?.scope.userId === scope.userId
          && current.scope.organizationId === scope.organizationId && current.scope.mode === scope.mode;
      },
      getMode: () => snapshot.scope.mode,
      canPresent: () => true,
      onArrival: (arrival, fence) => presentAdminRecapArrival(arrival.count, {
        ...fence,
        isWindowVisible: async () => {
          try {
            return isTauri() ? await getCurrentWindow().isVisible() : document.visibilityState !== "hidden";
          } catch {
            return false;
          }
        },
        inApp: async (_copy, current) => {
          if (!current.isCurrent()) return false;
          return presentAdminOttoArrival({
            count: arrival.count,
            unread: arrival.unread,
            eventIds: arrival.eventIds,
          });
        },
      }),
      onError: (error) => diagnostics.warn("admin_otto.delivery_failed", errorMessage(error, "Recap delivery failed.")),
    });
    if (!controller) return;
    adminOttoDeliveryRef.current = controller;
    void controller.pollNow("manual");
    const refresh = () => { void controller.pollNow("focus"); };
    const reconnect = () => { void controller.pollNow("reconnect"); };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", reconnect);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", reconnect);
      void controller.stop();
      if (adminOttoDeliveryRef.current === controller) adminOttoDeliveryRef.current = null;
    };
  }, [signedIn, syncBypass, session?.token, session?.organizationId, workSessionQuery.data, adminOttoSnapshot, avatarWindowVisible, deliveryOwnedContext, notifications, presentAdminOttoArrival]);

  /* The avatar can be the process-local delivery owner. It forwards only the
     accepted arrival's event ids and scope/epoch; the main window fetches the
     records itself, then offers the same counted Listen/View arrival without
     opening or focusing the chat. */
  useEffect(() => {
    const snapshot = adminOttoSnapshot;
    if (!snapshot) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listen<Record<string, unknown>>(OTTO_CHANGED_EVENT, (event) => {
      if (cancelled) return;
      const changed = parseAdminOttoChangedEvent(event.payload);
      const current = adminOttoModeRef.current?.snapshot();
      if (!changed || !current || !changed.eventIds.length) return;
      if (changed.scope.userId !== current.scope.userId
        || changed.scope.organizationId !== current.scope.organizationId
        || changed.scope.mode !== current.scope.mode
        || changed.epoch !== current.epoch) return;
      void presentAdminOttoArrival({
        count: changed.eventIds.length,
        unread: changed.eventIds.length,
        eventIds: changed.eventIds,
      });
    }).then((off) => {
      if (cancelled) off(); else unlisten = off;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [adminOttoSnapshot, presentAdminOttoArrival]);

  /* A follow save changes which reviewed arrivals the existing feed may
     deliver. The signal carries only scope/ids/revision: this window refreshes
     the open inbox revision and wakes the one delivery controller; it never
     copies a settings object into a shared store. */
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void listenAdminOttoFollowChanged((changed) => {
      if (cancelled) return;
      const current = followSettingsScopeRef.current;
      if (!current || !adminOttoFollowChangedAppliesTo(changed, current)) return;
      setAdminOttoFollowRevision((value) => value + 1);
      void adminOttoDeliveryRef.current?.pollNow("manual");
    }).then((off) => {
      if (cancelled) off(); else unlisten = off;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  /* Cross-workspace bell handoffs: the memory row resolves in place, but the
   * recap and EOD rows name employee surfaces, so administration switches
   * there first and then opens the exact destination the row promises. The
   * switch is never the only visible effect. */
  const openRecapInEmployeeView = () => {
    setNotificationsOpen(false);
    setWorkspaceMode("employee");
    openGoalComposer();
  };
  const openEodDayInEmployeeView = (day: OutstandingEodDay) => {
    setNotificationsOpen(false);
    setWorkspaceMode("employee");
    setEodLanding(false);
    setEodDate(day.date);
    setView("review");
  };
  const openOverdueInEmployeeView = () => {
    setNotificationsOpen(false);
    setWorkspaceMode("employee");
    openOverdueTasks();
  };
  const historyQuery = useTaskHistoryQuery({
    enabled: employeeBootstrapEnabled,
  });
  const workspaceHistoryQuery = useTaskHistoryQuery({
    enabled: employeeBootstrapEnabled && view === "tasks" && taskView === "all" && !!visibleDay?.shiftDate,
    workspace: true,
    view: "history",
    sort: taskWorkspaceSort,
    currentDate: visibleDay?.shiftDate ?? "",
    search: taskSearchQuery,
    fromDate: taskFilterFrom,
    toDate: taskFilterTo,
  });
  const completedHistoryQuery = useTaskHistoryQuery({
    enabled: employeeBootstrapEnabled && view === "tasks" && taskView === "completed" && !!visibleDay?.shiftDate,
    workspace: true,
    view: "history",
    sort: taskWorkspaceSort,
    currentDate: visibleDay?.shiftDate ?? "",
    completedOnly: true,
    search: taskSearchQuery,
    fromDate: taskFilterFrom,
    toDate: taskFilterTo,
  });
  const unfinishedHistoryQuery = useTaskHistoryQuery({
    enabled: employeeBootstrapEnabled && view === "tasks" && taskView === "unfinished" && !!visibleDay?.shiftDate,
    workspace: true,
    view: "open",
    sort: taskWorkspaceSort,
    currentDate: visibleDay?.shiftDate ?? "",
    search: taskSearchQuery,
    fromDate: taskFilterFrom,
    toDate: taskFilterTo,
    excludeToday: true,
  });
  const todayTaskHistoryQuery = useTaskHistoryQuery({
    enabled: employeeBootstrapEnabled && view === "tasks" && (taskView === "today" || selectedTaskDateIsHistorical) && !!selectedTaskDate,
    workspace: true,
    view: "day",
    sort: taskWorkspaceSort,
    currentDate: selectedTaskDate,
    search: taskSearchQuery,
    fromDate: taskFilterFrom,
    toDate: taskFilterTo,
  });
  const workspaceTaskHistory = syncBypass ? taskHistory : workspaceHistoryQuery.data?.pages.flatMap((page) => page.tasks) ?? [];
  const completedTaskHistory = syncBypass
    ? null
    : taskView === "completed"
      ? completedHistoryQuery.data
        ? completedHistoryQuery.data.pages.flatMap((page) => page.tasks)
        : []
      : null;
  const unfinishedTaskHistory = syncBypass || !unfinishedHistoryQuery.data ? null : unfinishedHistoryQuery.data.pages.flatMap((page) => page.tasks);
  const activeTaskHistoryQuery = view !== "tasks" ? historyQuery
    : selectedTaskDateIsHistorical ? todayTaskHistoryQuery
      : taskView === "completed" ? completedHistoryQuery
      : taskView === "all" ? workspaceHistoryQuery
        : taskView === "unfinished" ? unfinishedHistoryQuery
          : todayTaskHistoryQuery;
  const backlogQuery = useTaskBacklogQuery({ enabled: employeeBootstrapEnabled, sortDate: visibleDay?.shiftDate });
  const insightsQuery = useInsightsQuery({ enabled: employeeBootstrapEnabled && !debugScenario.enabled && view === "insights", range: insightRange, through: day?.shiftDate ?? "" });
  const historicalQuery = useHistoricalDayQuery({ date: planHistoryDate, currentDate: day?.shiftDate ?? "" });
  // The masthead bell's owner-scoped reads run in both workspaces — the
  // administration bell lists the signed-in account's own notifications — so
  // they follow the session, not the rendered workspace. The dev-only shell
  // harness seeds them; its loading/error states are pinned props instead,
  // because there is no backend to answer a request.
  const notificationReadsEnabled = (signedIn || ADMIN_SHELL_BOOT) && !syncBypass && personalNotificationReadsEnabled
    && ADMIN_SHELL_NOTIFICATIONS !== "loading" && ADMIN_SHELL_NOTIFICATIONS !== "error";
  const outstandingQuery = useOutstandingEodsQuery({ enabled: notificationReadsEnabled });
  // Review-notification sources: what Otto remembers waiting for review, and a
  // recap waiting to be confirmed. Both poll only while the app is open.
  const memoryQuery = useMemoryQuery({ enabled: notificationReadsEnabled, pollMs: NOTIFICATION_POLL_MS });
  const notificationIntervalsQuery = useActivityIntervalsQuery({ enabled: notificationReadsEnabled, date: visibleDay?.shiftDate ?? null, pollMs: NOTIFICATION_POLL_MS });
  // The bell only needs the newest ready recap, which always lives on the
  // first page; later pages stay unloaded until the stream asks for them.
  const readyRecapInterval = useMemo(() => readyRecap(notificationIntervalsQuery.data?.pages[0]?.intervals), [notificationIntervalsQuery.data]);
  const recapSummary = useMemo(() => readyRecapInterval ? { id: readyRecapInterval.id, label: readyRecapInterval.label } : null, [readyRecapInterval]);
  const memoryCandidateCount = useMemo(() => memoryQuery.data ? memoryCandidateIds(memoryQuery.data.facts).length : 0, [memoryQuery.data]);
  const reportDayQuery = useReportDayQuery({ date: eodDate, currentDate: day?.shiftDate ?? "" });
  const screenshotGalleryQuery = useEodScreenshotsQuery({
    enabled: employeeBootstrapEnabled,
    date: eodDate ?? day?.shiftDate ?? null,
    pollWhilePending: eodPreparing != null && eodPreparing.date === (eodDate ?? day?.shiftDate ?? null),
  });

  useEffect(() => {
    if (compactDayQuery.data) applyDayPayload(compactDayQuery.data);
  }, [applyDayPayload, compactDayQuery.data]);
  useEffect(() => {
    if (detailsDayQuery.data) {
      applyDayPayload(detailsDayQuery.data);
      setDayDetailsLoaded(true);
    }
  }, [applyDayPayload, detailsDayQuery.data]);
  useEffect(() => {
    if (onboardingQuery.data) setOnboarding(onboardingQuery.data);
  }, [onboardingQuery.data]);
  useEffect(() => {
    if (!historyQuery.data) return;
    setTaskHistory(historyQuery.data.pages.flatMap((page) => page.tasks));
  }, [historyQuery.data]);
  useEffect(() => {
    if (historyQuery.error) showError(historyQuery.error, "Task history could not be loaded.", "Tasks unavailable");
  }, [historyQuery.error, showError]);
  useEffect(() => {
    if (workspaceHistoryQuery.error) showError(workspaceHistoryQuery.error, "Task history could not be loaded.", "Tasks unavailable");
  }, [workspaceHistoryQuery.error, showError]);
  useEffect(() => {
    if (completedHistoryQuery.error) showError(completedHistoryQuery.error, "Completed tasks could not be loaded.", "Tasks unavailable");
  }, [completedHistoryQuery.error, showError]);
  useEffect(() => {
    if (unfinishedHistoryQuery.error) showError(unfinishedHistoryQuery.error, "Unfinished tasks could not be loaded.", "Tasks unavailable");
  }, [unfinishedHistoryQuery.error, showError]);
  useEffect(() => {
    if (todayTaskHistoryQuery.error) showError(todayTaskHistoryQuery.error, "Tasks for this day could not be loaded.", "Tasks unavailable");
  }, [showError, todayTaskHistoryQuery.error]);
  useEffect(() => {
    if (insightsQuery.data) {
      setInsights(insightsQuery.data);
      if (insightsQuery.data.freshness.stale) notifications.info(`Showing retained insight data${insightsQuery.data.freshness.staleAt ? ` from ${formatWorkOsDateTime(insightsQuery.data.freshness.staleAt)}` : ""}.`, "Insights refresh delayed");
    }
    setInsightsLoading(insightsQuery.isFetching && insightsQuery.data === undefined);
  }, [insightsQuery.data, insightsQuery.isFetching, notifications]);
  useEffect(() => {
    if (insightsQuery.error) showError(insightsQuery.error, "Insights could not be refreshed.", "Insights unavailable");
  }, [insightsQuery.error, showError]);
  useEffect(() => {
    if (historicalQuery.data) {
      setHistoricalPlan(historicalQuery.data.plan);
      setHistoricalTasks(historicalQuery.data.tasks);
    }
  }, [historicalQuery.data]);
  useEffect(() => {
    // Switching days abandons any preparation still running for the old one:
    // the in-flight draft for the previous day must not continue against it.
    eodPrepareCancelRef.current = true;
    eodPrepareAbandonRef.current = true;
    eodPrepareAbortRef.current?.abort();
    setEodDraft(null); setEodSubmitted(false); setEodQueued(false); setEodGate(null); setEodRedrafting(false); setEodClockedOut(false); setEodPreparing(null); setEodScreenshotNotice(null); setEodShiftRefused(null); setEodDeleteConfirmation(false);
  }, [eodDate]);
  useEffect(() => {
    if (historicalQuery.error) showError(historicalQuery.error, "Daily workspace history could not be loaded.", "History unavailable");
  }, [historicalQuery.error, showError]);

  const refreshInternal = useCallback(async (options: {
    refreshProviders?: boolean;
    refreshAttendance?: boolean;
    dayOnly?: boolean;
    details?: boolean;
    source?: PersonalBootstrapSource;
  } = {}) => {
    if (syncBypassRef.current) return null;
    const variant = options.details ? "details" : "compact";
    // The authoritative role is resolved before any personal read. A boot
    // refresh can run before the session query paints; fetchQuery joins it.
    const sessionData = await queryClient.fetchQuery({
      queryKey: adminKeys.session(),
      queryFn: fetchSession,
      staleTime: 0,
    }).catch(() => null);
    const access = personalBootstrapAccess({
      signedIn,
      syncBypass: syncBypassRef.current,
      role: sessionData?.role ?? null,
      identity: sessionData ?? undefined,
      workspace: workspaceRef.current,
      adminContext: adminContextStateRef.current,
    });
    const outcome = await runPersonalBootstrapRefresh({
      source: options.source ?? "manual",
      access,
      dayOnly: options.dayOnly === true,
      fetchOnboarding: () => queryClient.fetchQuery({ queryKey: workOsKeys.onboarding(), queryFn: fetchOnboarding, staleTime: 0 }),
      fetchDay: () => queryClient.fetchQuery({
        queryKey: workOsKeys.day(variant),
        queryFn: () => fetchDay({ variant, refreshProviders: options.refreshProviders, refreshAttendance: options.refreshAttendance }),
        staleTime: 0,
      }),
    });
    if (!outcome.ran) return null;
    const onboardingResult = outcome.onboarding;
    const dayResult = outcome.day;
    if (onboardingResult?.status === "rejected") throw onboardingResult.reason;
    if (!dayResult) return null;
    if (dayResult.status === "rejected") {
      const rawMessage = errorMessage(dayResult.reason, "Your profile loaded, but the workday could not be refreshed.");
      const message = /timed out|abort/i.test(rawMessage)
        ? "The provider sync is taking longer than usual. Give it a moment and retry — nothing was lost."
        : rawMessage;
      diagnostics.warn("bootstrap.day.degraded", message);
      setDayLoadFailed(true);
      showError(message, message, "Workday refresh failed");
      return null;
    }
    const nextDay = dayResult.value as DayData;
    applyDayPayload(nextDay);
    setDayLive(true);
    if (options.details) setDayDetailsLoaded(true);
    return nextDay;
  }, [applyDayPayload, queryClient, showError, signedIn]);

  const refresh = useCallback(async (options: {
    refreshProviders?: boolean;
    refreshAttendance?: boolean;
    dayOnly?: boolean;
    details?: boolean;
    source?: PersonalBootstrapSource;
  } = {}) => {
    setRefreshing(true);
    try { return await refreshInternal(options); } finally { setRefreshing(false); }
  }, [refreshInternal]);

  /* Once a mapped admin context is authoritative, load their own settings
   * through the same gated refresh; an unmapped admin has no personal record
   * to load and is routed to the console instead. */
  useEffect(() => {
    if (!signedIn || workSessionQuery.data?.role !== "admin") return;
    if (adminContextState?.status !== "ready" || adminContextState.personId === null) return;
    void refresh({ refreshAttendance: true, source: "context" }).catch(() => undefined);
  }, [signedIn, workSessionQuery.data?.role, adminContextState?.status, adminContextState?.personId, refresh]);

  // Activity can clock an employee in or out without anyone touching Work OS.
  // Re-check Worktivity on the adaptive cadence (30s while a transition is
  // expected, 60s once steady) and refresh the workspace only when the tracked
  // state actually moved, then relay the change to the floating companion.
  const onAttendanceChange = useCallback(() => {
    invalidateDayData();
    void refresh({ dayOnly: true, source: "attendance" }).catch(() => undefined);
    void emit("work-os://main-day-changed");
  }, [invalidateDayData, refresh]);
  useAttendanceWatch({ enabled: employeeBootstrapEnabled, input: attendanceWatchInput(visibleDay), onChange: onAttendanceChange });

  /** A conflicting write means the workspace holds an authoritative newer plan;
   * drop the rejected local draft and render the server record instead of
   * retrying the same payload. */
  const resyncPlanFromServer = useCallback(() => {
    planDirtyRef.current = false;
    appliedPlanKeyRef.current = "none";
    setPlanDirty(false);
    setPlanSaveState("saved");
    void refresh({ dayOnly: true, details: true });
  }, [refresh]);

  const reloadOpenTaskDetails = useCallback(async () => {
    const openTask = taskDetails?.task as Record<string, unknown> | undefined;
    const taskId = openTask ? String(openTask.provider_task_id || openTask.id || "") : "";
    if (!taskId) return;
    const details = await loadTaskDetails(taskId);
    setTaskDetails({ ...details, task: details.task ?? openTask, subtasks: Array.isArray(details.subtasks) ? details.subtasks : [], moveTargets: Array.isArray(details.moveTargets) ? details.moveTargets : [] });
  }, [taskDetails]);

  /** The masthead refresh revalidates the page the employee is looking at —
   * never a blanket app refresh. The Day view also asks the provider to sync. */
  /** Refresh the data source currently backing the active workspace without swapping views. */
  const refreshActiveView = useCallback(async () => {
    if (syncBypassRef.current) {
      setRefreshing(true);
      window.setTimeout(() => setRefreshing(false), 300);
      return;
    }
    setRefreshing(true);
    try {
      switch (view) {
        case "day":
          await refresh({ refreshProviders: true, refreshAttendance: true });
          return;
        case "tasks": {
          const work: Promise<unknown>[] = [refresh({ dayOnly: true, details: true }), activeTaskHistoryQuery.refetch()];
          if (taskView === "completed") work.push(historyQuery.refetch());
          if (planHistoryDate && planHistoryDate !== visibleDay?.shiftDate) work.push(historicalQuery.refetch());
          if (taskDetails) work.push(reloadOpenTaskDetails());
          await Promise.allSettled(work);
          return;
        }
        case "review":
          await Promise.allSettled([
            refresh({ dayOnly: true, details: true }),
            outstandingQuery.refetch(),
            eodDate ? reportDayQuery.refetch() : Promise.resolve(),
          ]);
          return;
        case "evidence":
          await Promise.allSettled([refresh({ dayOnly: true, details: true })]);
          return;
        case "insights":
          if (debugScenario.enabled) {
            if (visibleDay) setInsights(insightsFixture(visibleDay, insightRange));
          } else {
            await Promise.allSettled([insightsQuery.refetch()]);
          }
          return;
        case "settings":
          await refresh();
          return;
      }
    } finally {
      setRefreshing(false);
    }
  }, [activeTaskHistoryQuery, debugScenario.enabled, eodDate, historicalQuery, historyQuery, insightRange, insightsQuery, outstandingQuery, planHistoryDate, queryClient, refresh, reloadOpenTaskDetails, reportDayQuery, setInsights, taskDetails, taskView, view, visibleDay]);

  // Boot: open this device's vault, apply what it holds, then keep listening
  // for desktop sign-in.
  //
  // The vault read is a gate that always settles — the credential store can
  // wait on a macOS password dialog, and a gate that only resolved on success
  // left the companion painted-but-dead on its loading screen. A gate failure
  // is a real screen now, with the recovery the host asked for; a retry retires
  // the previous attempt so a late answer cannot jump the screen the employee
  // is already looking at.
  const applyVaultState = useCallback(async () => {
    const [stored, queue, settings, snapshot, enabled, pendingAuth] = await Promise.all([secureState.sessionState(), secureState.queue(), secureState.settings(), secureState.daySnapshot(), isTauri() ? isEnabled() : Promise.resolve(false), secureState.pendingAuth()]);
    const current = stored.session;
    // An expired or unusable session is a signed-out state: the API layer
    // refuses it, so the workspace must not open on it. The employee is told
    // why on the connect screen instead of meeting a wall of failed requests.
    if (stored.reason !== "none") {
      setConnectNotice(sessionNotice(stored.reason));
      diagnostics.warn("auth.session.dropped", "This device's stored session is no longer usable", { reason: stored.reason });
      await secureState.clearSession().catch(() => undefined);
    }
    setSession(current); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length); setApiBase(settings.apiBase); setAutoStart(enabled); setAutoCheckUpdates(settings.autoCheckUpdates); setVoiceHotkeyEnabled(settings.voiceHotkey);
    if (!authResolutionHandledRef.current) setAwaitingApproval(Boolean(pendingAuth));
    void applyVoiceHotkey(settings.voiceHotkey);
    const appearance = normalizeAppearance(settings); setTextSize(appearance.textSize); setMascotSize(appearance.mascotSize); applyAppearance(appearance); setRecapVoice(normalizeRecapVoice(settings.recapVoice));
    if (snapshot && snapshot.access?.organizationId === current?.organizationId) {
      // Seed the cache with the last workday snapshot for an instant first
      // paint; the live query revalidates it in the background.
      queryClient.setQueryData(workOsKeys.day("compact"), snapshot);
      setPlanHistoryDate(snapshot.shiftDate);
    }
    if (current) void refresh({ refreshAttendance: true, source: "vault" }).catch((value) => showError(value, "Could not load your workday.", "Workday unavailable"));
    if (!launchUpdateCheckRef.current && shouldAutoCheckUpdate({ supported: isTauri(), debugEnabled: debugRef.current.enabled, hasSession: !!current, autoCheckUpdates: settings.autoCheckUpdates })) {
      launchUpdateCheckRef.current = true;
      void checkForUpdates({ silent: true });
    }
  }, [queryClient, refresh, showError]);

  // Declared before the boot effect so the first gate attempt opens the real
  // vault, never the placeholder above.
  useEffect(() => { applyVaultStateRef.current = applyVaultState; }, [applyVaultState]);

  const startVaultGate = useCallback(() => {
    // The opener is read through a ref so this stays identity-stable: the boot
    // effect must run once per mount, not once per view change.
    vaultAttemptRef.current?.abandon();
    const attempt = runVaultGate(
      () => applyVaultStateRef.current(),
      // A host panic (the Stronghold plugin panics instead of erroring) leaves
      // the open pending forever; asking about it turns a retry loop that can
      // never succeed into the one recovery that can.
      { probeTrouble: async () => isTauri() && await invoke<boolean>("vault_open_trouble").catch(() => false) },
    );
    vaultAttemptRef.current = attempt;
    void attempt.result.then((outcome: VaultGateSettled) => { vaultAttemptRef.current = null; setVaultGate(outcome); });
  }, []);

  // A retry must let go of the previous attempt's promise too: the one waiting
  // on a system dialog would otherwise be reused and wait forever. Raising the
  // window first matters on macOS, where the confirmation dialog can sit behind
  // the always-on-top companion and never reach the employee's attention.
  const retryVaultGate = useCallback(() => {
    if (isTauri()) void invoke("focus_main").catch(() => undefined);
    abandonVaultOpen();
    setVaultGate({ status: "pending" });
    startVaultGate();
  }, [startVaultGate]);

  const startFreshOnThisDevice = useCallback(async () => {
    try {
      await resetLocalVault();
    } catch (value) {
      // The screen stays up with its own explanation; the notification says why
      // the reset itself could not run.
      showError(value, "This device's local data could not be replaced.", "Start fresh failed");
      return;
    }
    retryVaultGate();
  }, [retryVaultGate, showError]);

  useEffect(() => {
    // StrictMode mounts, cleans up, and mounts again: the cleanup retires the
    // first attempt, so this must start a live one on the second run instead of
    // remembering that a start already happened. Restarting is cheap — the host
    // answers a repeat read from the value it already holds, and a read still
    // waiting on a system dialog is joined rather than asked again.
    startVaultGate();
    return () => vaultAttemptRef.current?.abandon();
  }, [startVaultGate]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listenForAuthentication((saved) => { authResolutionHandledRef.current = true; setAwaitingApproval(false); setSession(saved); setConnectNotice(null); notifications.success("This device is connected to your workspace.", "Workspace connected"); void emit("work-os://main-session-changed"); void refresh({ refreshAttendance: true, source: "sign_in" }); }, (value) => { authResolutionHandledRef.current = true; setAwaitingApproval(false); showError(value, "Desktop authorization failed.", "Authorization failed"); }).then((fn) => { cleanup = fn; }).catch((value) => showError(value, "Could not listen for desktop sign-in.", "Sign-in listener failed"));
    return () => cleanup?.();
  }, [notifications, refresh, showError]);

  // The workspace can reject this device's session at any time (revoked in the
  // browser, or expired while the clocks disagreed). Following it out of the
  // workspace is what keeps the screen honest about being signed out.
  useEffect(() => {
    const unlisten = listen("work-os://desktop-session-rejected", () => {
      void emit(OTTO_CONTEXT_CLEARED_EVENT, adminOttoSnapshot ? ottoContextEvent(adminOttoSnapshot) : null);
      requestOttoAudioStop();
      void adminOttoDeliveryRef.current?.stop();
      setSession(null);
      setConnectNotice(sessionNotice("invalid"));
      notifications.error("This device's connection is no longer accepted. Connect it again to keep working.", "Connect this device");
    });
    return () => { unlisten.then((fn) => fn()).catch(() => { /* noop */ }); };
  }, [notifications, refresh, showError]);

  useEffect(() => {
    if (!isTauri()) {
      setInstalledVersion("Unavailable in browser preview");
      return;
    }
    void getVersion().then((value) => {
      setInstalledVersionRaw(value);
      setInstalledVersion(displayUpdateVersion(value));
      if (!shouldAnnounceUpdate(value, readAnnouncedVersion())) return;
      const copy = updateInstalledCopy(value);
      notifications.persistent(WHATS_NEW_ANNOUNCE_KEY, copy.message, copy.title, "success", {
        actions: [
          { label: copy.changelogLabel, kind: "primary", onClick: () => { markUpdateAnnounced(value); setWhatsNew({ version: value }); } },
          { label: copy.dismissLabel, kind: "quiet", onClick: () => markUpdateAnnounced(value) },
        ],
      });
    }).catch(() => setInstalledVersion("Unavailable"));
  }, [markUpdateAnnounced, notifications]);

  // The companion is a long-lived tray app, so releases dropped mid-session
  // would otherwise go unnoticed until a restart. Re-check silently on the
  // shared cadence; a downloaded-but-uninstalled update still allows checks
  // (a newer release replaces it), while a live download or install blocks.
  useEffect(() => { updateFlowRef.current = updateFlow; }, [updateFlow]);
  useEffect(() => {
    if (!isTauri() || !session || !autoCheckUpdates) return;
    const timer = window.setInterval(() => {
      const flow = updateFlowRef.current;
      if (!canRunBackgroundUpdateCheck(flow.status)) return;
      void checkForUpdates({ silent: true });
    }, UPDATE_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoCheckUpdates, session]);

  useEffect(() => {
    if (!session) return;
    const recover = async () => {
      if (syncBypassRef.current || !navigator.onLine) return;
      const result = await flushQueue();
      setQueueCount(result.remaining);
      setQueueAttentionCount(result.needsAttention);
      if (result.retiredAttendanceControls) {
        const count = result.retiredAttendanceControls;
        notifications.info(`${count} saved attendance change${count === 1 ? " was" : "s were"} not replayed. Check Worktivity, then start a new action from the Windows Companion.`, "Worktivity now controls attendance");
      }
    };
    window.addEventListener("online", recover); const timer = window.setInterval(() => void recover().catch(() => undefined), 60_000);
    return () => { window.removeEventListener("online", recover); clearInterval(timer); };
  }, [session]);

  // The details payload loads lazily when a workspace that needs heavier
  // history, evidence, or EOD records opens (driven by detailsDayQuery).

  // The avatar is a separate window. Its confirmed writes should be visible in
  // the main workspace immediately, not only after the next periodic refresh.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://avatar-day-changed", () => { void refresh({ dayOnly: true, source: "attendance" }).catch(() => undefined); }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [refresh]);

  // EOD clicks can originate in the floating avatar or a Windows toast. Both
  // routes land on the same review workspace, then refresh its current record.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://avatar-open-eod", () => {
      setView("review");
      void refresh({ dayOnly: true, source: "attendance" }).catch(() => undefined);
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [refresh]);

  // The floating Tasks tab's "View in app" jumps straight to the dock's Focus
  // tab, where the same interval stream lives beneath the daily goal.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://avatar-open-focus", () => {
      openGoalComposer();
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- openGoalComposer only calls stable setters

  // A Windows toast click on the memory reminder lands on the same review
  // modal the notifications panel opens.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://open-memory", () => { setMemoryOpen(true); }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, []);

  // Memory arrivals announce themselves once per proposal: a flyout with the
  // agent's own mark, a system toast when the window is hidden, and a standing
  // row in the notifications panel until they are reviewed. The registry keeps
  // a reload from re-announcing what the employee already saw.
  const memorySeenRef = useRef<string[] | null>(null);
  useEffect(() => {
    const facts = memoryQuery.data?.facts;
    if (!facts) return;
    const ids = memoryCandidateIds(facts);
    const seen = memorySeenRef.current ?? readSeenIds(MEMORY_SEEN_KEY);
    const unseen = unseenMemoryIds(ids, seen);
    if (unseen.length > 0) {
      notifications.info(
        `${unseen.length} proposed fact${unseen.length === 1 ? "" : "s"} waiting for your review.`,
        `This is what ${MASCOT.name} remembers about you so far`,
        { label: "Review", onClick: () => setMemoryOpen(true) },
        { icon: "otto" },
      );
      if (document.hidden) {
        void fireCompanionToast({
          title: `This is what ${MASCOT.name} remembers so far`,
          body: `${unseen.length} new memor${unseen.length === 1 ? "y" : "ies"} waiting for your review.`,
          target: "memory",
        });
      }
    }
    const merged = mergeSeenIds(seen, ids);
    memorySeenRef.current = merged;
    writeSeenIds(MEMORY_SEEN_KEY, merged);
  }, [memoryQuery.data, notifications]);

  // A ready recap announces itself once per interval: the panel row stands
  // until the recap is confirmed, while the floating companion keeps owning
  // system-level delivery so one recap never fires two system toasts.
  const recapNotifiedRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (!readyRecapInterval) return;
    const key = recapNotifyKey(readyRecapInterval.id);
    const seen = recapNotifiedRef.current ?? readSeenIds(RECAP_NOTIFIED_KEY);
    if (seen.includes(key)) return;
    notifications.info(
      "Confirm or correct what Otto saw during your last interval.",
      "Your recap is ready",
      { label: "Review", onClick: openGoalComposer },
      { icon: "otto" },
    );
    const next = [...seen, key].slice(-120);
    recapNotifiedRef.current = next;
    writeSeenIds(RECAP_NOTIFIED_KEY, next);
  }, [readyRecapInterval, notifications]); // eslint-disable-line react-hooks/exhaustive-deps -- openGoalComposer only calls stable setters

  // Overdue work for the bell and the reminder. The set matches the Unfinished
  // destination exactly: tasks day-scoped to today belong to My day (and to the
  // check-in mention), so the bell never counts work its Review action cannot
  // show. The count itself stays the server's overdue backlog total.
  const overdueBacklog = useMemo(() => {
    // The same day-scoped set the Tasks workspace builds for My day; those
    // tasks are excluded so the bell's count matches its Review destination.
    const myDayIds = new Set(parentTasks(uniqueTasks(dayScopedTasks(visibleDay?.tasks ?? [], planItems, visibleDay?.shiftDate ?? "", taskHistory)))
      .map((task) => String(task.provider_task_id || task.id)));
    return parentTasks(uniqueTasks(backlogQuery.data?.tasks ?? []))
      .filter((task) => isOverdueTask(task, visibleDay?.shiftDate ?? "") && !myDayIds.has(String(task.provider_task_id || task.id)))
      .map((task) => ({ id: String(task.id ?? task.provider_task_id ?? ""), title: safeTaskText(task.title, "Untitled task"), dueDate: String(task.due_date ?? "").slice(0, 10) }))
      .filter((task) => task.id);
  }, [backlogQuery.data?.tasks, visibleDay?.tasks, visibleDay?.shiftDate, planItems, taskHistory]);
  const overdueTaskCount = overdueBacklog.length;
  const openOverdueTasks = useCallback(() => {
    setNotificationsOpen(false);
    // Restore the current workday and drop active filters — including the
    // visible search text — so the overdue section is actually visible
    // wherever the employee navigates from.
    setPlanHistoryDate("");
    setTaskSearch("");
    setTaskSearchQuery("");
    setTaskFilterFrom("");
    setTaskFilterTo("");
    setTaskView("unfinished");
    setView("tasks");
  }, []);

  // Newly overdue tasks announce themselves once per task and due date: an in-app
  // reminder with Otto's mark, and a system notification when the window is
  // hidden. The shared registry keeps a reload from re-announcing what the
  // employee already saw.
  const overdueNotifiedRef = useRef<string[] | null>(null);
  useEffect(() => {
    if (!overdueBacklog.length) return;
    const keys = overdueBacklog.map((task) => overdueNotifyKey(task));
    const seen = overdueNotifiedRef.current ?? readSeenIds(OVERDUE_NOTIFIED_KEY);
    const unseen = unseenOverdueKeys(keys, seen);
    if (unseen.length > 0) {
      notifications.notify(
        "warning",
        "Unfinished work is past its due date — review the Unfinished view.",
        overdueSummary(unseen.length),
        { label: "Review", onClick: openOverdueTasks },
        { icon: "otto" },
      );
      if (document.hidden) {
        void fireCompanionToast({
          title: overdueSummary(unseen.length),
          body: "Unfinished work is past its due date.",
          target: "main",
        });
      }
    }
    const merged = mergeOverdueKeys(seen, keys);
    overdueNotifiedRef.current = merged;
    writeSeenIds(OVERDUE_NOTIFIED_KEY, merged);
  }, [overdueBacklog, notifications]); // eslint-disable-line react-hooks/exhaustive-deps -- openOverdueTasks only calls stable setters

  /** Keep, reject, or forget a memory fact, then refresh every surface that
   * shows the same list (panel badge, settings band, modal). */
  const reviewMemory = async (id: string, status: "confirmed" | "rejected") => {
    setMemoryBusy(true);
    setMemoryError(null);
    try {
      await reviewMemoryFact(id, status);
      await queryClient.invalidateQueries({ queryKey: workOsKeys.memory() });
    } catch (value) {
      setMemoryError(errorMessage(value, "That fact could not be updated."));
    } finally {
      setMemoryBusy(false);
    }
  };
  const forgetMemory = async (id: string) => {
    setMemoryBusy(true);
    setMemoryError(null);
    try {
      await forgetMemoryFact(id);
      await queryClient.invalidateQueries({ queryKey: workOsKeys.memory() });
    } catch (value) {
      setMemoryError(errorMessage(value, "That memory could not be forgotten."));
    } finally {
      setMemoryBusy(false);
    }
  };

  // "Set today's goal" on the floating agenda bubble lands on the SOD planning
  // modal, ready for the day's focus.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://avatar-open-plan", () => {
      openPlanningSession();
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- openPlanningSession only calls stable setters

  /* Hold-to-talk: the global shortcut is registered in Rust so it reaches the
     app from any window, then routed here as press/release/cancel. The hold
     owns the whole capture, so a release always ends it.
     Two guards, because `emit_to` alone is not enough: the listener names this
     window as its target so Tauri's filter applies, and the event's own
     address is checked before acting, so a broadcast cannot start a capture
     meant for the other delivery surface. */
  useEffect(() => {
    if (!isTauri()) return;
    const label = getCurrentWindow().label;
    const unlisteners: Array<() => void> = [];
    void listen<{ target?: string }>("work-os://voice/start", (event) => {
      if (!isVoiceEventFor(event.payload, label)) return;
      voiceRef.current.start("hotkey");
    }, { target: label })
      .then((fn) => unlisteners.push(fn)).catch(() => undefined);
    void listen<{ target?: string }>("work-os://voice/stop", (event) => {
      if (!isVoiceEventFor(event.payload, label)) return;
      voiceRef.current.stop();
    }, { target: label })
      .then((fn) => unlisteners.push(fn)).catch(() => undefined);
    void listen<{ target?: string }>("work-os://voice/cancel", (event) => {
      if (!isVoiceEventFor(event.payload, label)) return;
      voiceRef.current.cancel();
    }, { target: label })
      .then((fn) => unlisteners.push(fn)).catch(() => undefined);
    return () => unlisteners.forEach((fn) => fn());
  }, []);

  // Assistant navigation shortcuts from the floating avatar land on the
  // requested destination. The page name is validated before it can move.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ view?: unknown }>("work-os://avatar-navigate", (event) => {
      const view = event.payload?.view;
      if (view === "day" || view === "tasks" || view === "review" || view === "insights" || view === "evidence" || view === "settings") {
        setView(view);
        void refresh({ dayOnly: true, source: "attendance" }).catch(() => undefined);
      }
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [refresh]);

  // Ctrl + , (Cmd + , on macOS) opens Settings from anywhere in the window:
  // the employee page, or the administration workspace's own Settings section
  // while that workspace is the one on screen.
  useEffect(() => {
    const onSettingsHotkey = (event: KeyboardEvent) => {
      if (!isSettingsHotkey(event)) return;
      event.preventDefault();
      if (adminWorkspaceBranch) navigateAdmin("settings");
      else setView("settings");
    };
    window.addEventListener("keydown", onSettingsHotkey);
    return () => window.removeEventListener("keydown", onSettingsHotkey);
  }, [adminWorkspaceBranch, navigateAdmin]);

  useEffect(() => {
    const timer = window.setInterval(() => setPulseNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Offline sync bypass: activate the hard network gate and hydrate the
  // workspace from the scenario fixture when no day has been loaded.
  useEffect(() => {
    setSyncBypass(syncBypass);
    setDebugSession(debugScenario.enabled && !syncBypass && !session ? { token: "debug-local", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), organizationId: "debug", apiBase: "" } : null);
    if (syncBypass && !day) {
      const fixture = applyDayScenario(null, debugScenario) as DayData;
      setDay(fixture);
      setTaskHistory(fixture.tasks ?? []);
    }
    if (!syncBypass) return;
    setError("");
    setDay((current) => current ?? (applyDayScenario(null, debugScenario) as DayData));
  }, [day, debugScenario, syncBypass]);

  /** Bounded on-demand Worktivity analysis before drafting. The composer shows
   * honest frame counts while this runs; "Draft Anyway" cancels the remaining
   * rounds and drafts from whatever is already analyzed. A disabled feature or
   * an unavailable provider never blocks the draft. */
  const prepareEodForDraft = async (target: DayData | null): Promise<{ abandoned: boolean }> => {
    if (!target || syncBypassRef.current) return { abandoned: false };
    const date = target.shiftDate;
    eodPrepareCancelRef.current = false;
    eodPrepareAbandonRef.current = false;
    // A new attempt starts from a clean slate: any notice from an earlier try
    // must not linger while this preparation runs.
    setEodScreenshotNotice(null);
    setEodPreparing({ date, analyzed: 0, total: 0, pending: null, failed: 0 });
    try {
      for (let round = 0; round < EOD_PREPARE_ROUNDS; round += 1) {
        if (eodPrepareCancelRef.current) break;
        const controller = new AbortController();
        eodPrepareAbortRef.current = controller;
        let preparation: Awaited<ReturnType<typeof prepareEodScreenshots>>;
        try {
          preparation = await prepareEodScreenshots(date, controller.signal);
        } catch {
          break;
        } finally {
          eodPrepareAbortRef.current = null;
        }
        // `analyzed` is cumulative for the day, not just this batch, so the
        // waiting counts match the frames the gallery can already show.
        const analyzed = Math.max(0, preparation.total - preparation.pending);
        setEodPreparing({ date, analyzed, total: preparation.total, pending: preparation.pending, failed: preparation.failed });
        if (preparation.unavailable || preparation.total === 0) {
          // Worktivity serves no frames for this day (older than its retention
          // or a transient empty response): waiting longer cannot help.
          setEodScreenshotNotice("Worktivity has no retrievable screenshots for this day.");
          break;
        }
        setEodScreenshotNotice(null);
        if (preparation.pending <= 0) break;
      }
    } finally {
      eodPrepareAbortRef.current = null;
      setEodPreparing(null);
      void queryClient.invalidateQueries({ queryKey: workOsKeys.eodScreenshots(date) });
    }
    return { abandoned: eodPrepareAbandonRef.current };
  };

  const draftEodAnyway = () => {
    // Deliberate escape hatch: stop the remaining rounds and draft from the
    // frames that are ready (this is not an abandonment).
    eodPrepareCancelRef.current = true;
    eodPrepareAbortRef.current?.abort();
  };

  const redraftEod = async (target: DayData | null) => {
    if (!target?.report) return;
    if (syncBypassRef.current) {
      setEodDraft({ markdown: simulateAiEod({ tasks: target.tasks, plan: target.plan, shiftDate: target.shiftDate }), source: "simulated" });
      notifications.success("Simulated an assistant draft on-device — nothing reached the server.", "AI draft (playground)");
      return;
    }
    setEodRedrafting(true);
    try {
      const preparation = await prepareEodForDraft(target);
      if (preparation.abandoned) return;
      const result = await apiRequest<{ markdown: string; model: string; clockedOut?: boolean; screenshots?: EodScreenshotContext; screenshotSyncUnavailable?: boolean }>("/api/work-os/me/eod/ai-draft", {
        method: "POST", signal: AbortSignal.timeout(60_000), body: JSON.stringify({ date: target.shiftDate }),
      });
      setEodGate(null);
      setEodClockedOut(result.clockedOut === true);
      setEodDraft({ markdown: result.markdown, source: "ai", screenshots: result.screenshots ?? null, screenshotSyncUnavailable: result.screenshotSyncUnavailable === true });
      notifications.success(result.clockedOut ? "You were clocked out automatically and the assistant drafted your EOD. Review every line." : "The assistant drafted your EOD from the recorded work. Review every line.", "AI draft ready");
    } catch (value) {
      if (value instanceof ApiRequestError && (value as { status?: number | null }).status === 409) {
        // The shift is still open: the day is not finished, so the draft is
        // refused and the prompt explains it.
        if ((value as { reason?: string | null }).reason === EOD_SHIFT_OPEN_REASON) {
          setEodShiftRefused({ date: target.shiftDate, at: target.at ?? null });
          setEodDraft(null);
          return;
        }
        const message = value instanceof Error ? value.message : "EOD drafting is gated";
        setEodGate({ gate: /no tasks/i.test(message) ? "no_tasks" : "no_activity", detail: message });
        setEodDraft(null);
        return;
      }
      setEodDraft({ markdown: target.report.markdown ?? "", source: "deterministic" });
      notifications.info("The assistant is unavailable — showing the standard draft.", "Standard draft");
    } finally { setEodRedrafting(false); }
  };

  const refineEod = async (target: DayData | null, markdown: string, feedback: string, annotations: Array<{ quote: string; comment: string }> = []) => {
    if (!target || syncBypassRef.current) return false;
    setEodRedrafting(true);
    try {
      // The assistant must not rewrite the Bottleneck section, so it is held
      // back from the refine request and restored onto the refined draft.
      const bottleneckSection = extractBottleneckSection(markdown);
      const result = await apiRequest<{ markdown: string }>('/api/work-os/me/eod/ai-draft', {
        method: "POST", body: JSON.stringify({ date: target.shiftDate, draft: stripBottleneckSection(markdown), feedback, annotations }),
      });
      const refined = restoreBottleneckSection(String(result.markdown ?? ""), bottleneckSection);
      setEodDraft((current) => current ? { ...current, markdown: refined, source: "ai" } : { markdown: refined, source: "ai" });
      notifications.success("The draft was refined from your feedback.", "Draft refined");
      return true;
    } catch (value) {
      showError(value, "Your feedback was not applied. Your draft is unchanged.", "Draft refinement failed");
      return false;
    } finally { setEodRedrafting(false); }
  };

  /** Reads a pasted Loom link's public metadata and day verdict for the
   * target day the caller is actually working with. */
  const previewLoomLink = async (url: string, targetDate?: string) => {
    const day = targetDate ?? reviewDay?.shiftDate ?? visibleDay?.shiftDate ?? "";
    try {
      const result = await apiRequest<{
        title: string | null;
        durationSeconds: number | null;
        createdAt: string | null;
        metadataAvailable: boolean;
        usableForDay: boolean;
        temporal?: { verdict?: string; createdLocalDate?: string | null };
      }>("/api/work-os/me/loom/preview", {
        method: "POST",
        body: JSON.stringify({ url, targetDate: day }),
      });
      return {
        title: result.title,
        durationSeconds: result.durationSeconds,
        createdLocalDate: result.temporal?.createdLocalDate ?? null,
        verdict: result.temporal?.verdict ?? "unknown",
        usableForDay: result.usableForDay !== false,
        metadataAvailable: result.metadataAvailable,
      };
    } catch (value) {
      showError(value, "The Loom link could not be read.", "Loom read failed");
      return null;
    }
  };

  /** Rebuilds the draft from an analyzed recording. Draft context only —
   * nothing is filed, and a recording from another day is refused. */
  const draftEodWithLoom = async (loom: { url: string; transcript?: string }) => {
    if (!reviewDay?.report) return { ok: false, message: "Load the report before analyzing a Loom." };
    try {
      const result = await apiRequest<{
        markdown: string;
        model: string;
        screenshots?: EodScreenshotContext;
        screenshotSyncUnavailable?: boolean;
        loom?: { title: string | null; durationSeconds: number | null; createdLocalDate: string | null; verdict: string; url: string } | null;
      }>("/api/work-os/me/eod/ai-draft", {
        method: "POST",
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ date: reviewDay.shiftDate, loom }),
      });
      setEodGate(null);
      setEodDraft({
        markdown: result.markdown,
        source: "ai",
        screenshots: result.screenshots ?? null,
        screenshotSyncUnavailable: result.screenshotSyncUnavailable === true,
        loom: result.loom ?? null,
      });
      notifications.success("Draft rebuilt from your Loom recording.", "Loom analyzed");
      return { ok: true };
    } catch (value) {
      const message = value instanceof Error ? value.message : "The Loom could not be analyzed.";
      showError(value, message, "Loom analysis failed");
      return { ok: false, message };
    }
  };

  const applyReportToDay = useCallback((date: string | null, report: NonNullable<DayData["report"]>) => {
    if (!date) {
      setDay((current) => current ? { ...current, report } : current);
      return;
    }
    queryClient.setQueryData<DayData>(workOsKeys.reportDay(date), (current) => current ? { ...current, report } : current);
  }, [queryClient]);

  const createEodDraft = async (target: DayData | null) => {
    if (!target) return;
    if (syncBypassRef.current) {
      setEodDraft({ markdown: simulateAiEod({ tasks: target.tasks, plan: target.plan, shiftDate: target.shiftDate }), source: "simulated" });
      return;
    }
    setEodRedrafting(true);
    try {
      const preparation = await prepareEodForDraft(target);
      if (preparation.abandoned) return;
      const result = await apiRequest<{ report: NonNullable<DayData["report"]> }>("/api/work-os/reports/eod", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ date: target.shiftDate }),
      });
      applyReportToDay(eodDate, result.report);
      setEodDraft({ markdown: String(result.report.markdown ?? ""), source: "deterministic" });
      setEodGate(null);
      invalidateOutstandingEods();
      // The assistant draft is the default: the standard draft above is the
      // fallback when the assistant is unavailable or the day is gated.
      try {
        const ai = await apiRequest<{ markdown: string; model: string; clockedOut?: boolean; screenshots?: EodScreenshotContext; screenshotSyncUnavailable?: boolean }>("/api/work-os/me/eod/ai-draft", {
          method: "POST", signal: AbortSignal.timeout(60_000), body: JSON.stringify({ date: target.shiftDate }),
        });
        setEodClockedOut(ai.clockedOut === true);
        setEodDraft({ markdown: ai.markdown, source: "ai", screenshots: ai.screenshots ?? null, screenshotSyncUnavailable: ai.screenshotSyncUnavailable === true });
        notifications.success("The assistant drafted your EOD from the recorded work. Review every line.", "AI draft ready");
      } catch {
        notifications.info("The assistant is unavailable — showing the standard draft.", "Standard draft");
      }
    } catch (value) {
      // The shift is still open: the draft is refused and the prompt explains
      // it instead of a failure.
      if (value instanceof ApiRequestError && value.status === 409 && value.reason === EOD_SHIFT_OPEN_REASON) {
        setEodShiftRefused({ date: target?.shiftDate ?? "", at: target?.at ?? null });
        return;
      }
      showError(value, "Your EOD draft could not be created.", "EOD draft failed");
    } finally { setEodRedrafting(false); }
  };

  /** Deletes the current EOD draft after the employee confirms it. The
   * server refuses a report that is already with a manager. */
  const deleteEodDraft = async () => {
    const reportId = String(reviewDay?.report?.id ?? "");
    if (!reportId) {
      setEodDeleteConfirmation(false);
      notifications.info("There is no draft to delete.", "No draft");
      return;
    }
    setEodDeleting(true);
    try {
      await apiRequest(`/api/work-os/reports/${encodeURIComponent(reportId)}`, { method: "DELETE" });
      setEodDeleteConfirmation(false);
      setEodDraft(null);
      setEodRedrafting(false);
      setEodClockedOut(false);
      setEodLanding(true);
      setEodScreenshotNotice(null);
      if (eodDate) {
        // The day's payload still carries the deleted report; drop it so the
        // composer cannot come back with a record that no longer exists.
        queryClient.setQueryData(workOsKeys.reportDay(eodDate), (current: DayData | null) => current ? { ...current, report: null } : current);
        void queryClient.invalidateQueries({ queryKey: workOsKeys.reportDay(eodDate) });
      } else {
        setDay((current) => current ? { ...current, report: null } : current);
        void refresh();
      }
      invalidateOutstandingEods();
      notifications.success("Your EOD draft was deleted.", "Draft deleted");
    } catch (value) {
      showError(value, "Your EOD draft could not be deleted.", "Draft not deleted");
    } finally {
      setEodDeleting(false);
    }
  };



  function submitEod(target: DayData | null, markdown: string, idempotencyKey: string) {
    const reportId = String(target?.report?.id ?? "");
    if (!reportId) return;
    const finish = () => {
      setEodSubmitted(true);
      invalidateOutstandingEods();
      if (eodDate) void queryClient.invalidateQueries({ queryKey: workOsKeys.reportDay(eodDate) });
    };
    if (syncBypassRef.current || (debugRef.current.enabled && !debugScenario.liveWrites)) {
      finish();
      notifications.success("Your EOD was submitted (offline playground — nothing reached the server).", "EOD submitted");
      return;
    }
    void act("report.submit", async () => {
      const result = await sendOrQueue(`/api/work-os/reports/${encodeURIComponent(reportId)}/submit`, "PATCH", { markdown, submission_idempotency_key: idempotencyKey }) as { queued?: boolean } | null;
      // A queued write has not reached the server: the confirmation says so
      // instead of claiming the report is already with the manager, and the
      // action's queued handling keeps the notification honest too.
      const queued = Boolean(result?.queued);
      setEodQueued(queued);
      finish();
      if (queued) return { queued: true } as const;
    });
  }

  function bypassAct(label: string, mutator?: (day: DayData) => DayData) {
    diagnostics.info("ui.action.bypass", label, { activeView: view });
    if (mutator) setDay((current) => mutator(current ?? (applyDayScenario(null, debugScenario) as DayData)));
    notifications.success(actionSuccessMessages[label] ?? "The change was saved on this device.");
  }

  useEffect(() => {
    if (syncBypassRef.current) { setPlanSaveState("saved"); setPlanDirty(false); return; }
    if (!planDirty || !day?.plan || debugRef.current.enabled || day.plan.status === "closed") return;
    const version = planEditVersion.current;
    const timer = window.setTimeout(() => {
      setPlanSaveState("saving");
      void sendOrQueue("/api/work-os/me/plan", "PUT", {
        shift_date: day.shiftDate,
        revision: day.plan!.revision,
        freeform_intent: planIntent,
        focus_summary: null,
        goal_provenance: goalProvenance,
        suggestion_task_ids: suggestionTaskIds,
      }).then((result) => {
        const response = result as DailyPlan & { queued?: boolean };
        if (response.queued) {
          if (planEditVersion.current === version) setPlanDirty(false);
          setPlanSaveState("offline");
          notifications.info("Your goal is queued and will sync when the connection recovers.", "Saved offline");
          return;
        }
        setDay((current) => current ? { ...current, plan: response } : current);
        void emit("work-os://main-day-changed");
        if (planEditVersion.current === version) {
          setPlanItems([...response.items].sort((a, b) => a.rank - b.rank));
          setPlanDirty(false);
          setPlanSaveState("saved");
          notifications.success("Your daily goal was saved.", "Goal updated");
        }
      }).catch((value) => {
        const message = errorMessage(value, "Your daily goal could not be saved.");
        if (/changed on another device/i.test(message)) {
          resyncPlanFromServer();
          notifications.info("Showing the saved plan from your workspace. Reopen the focus editor to change it.", "Plan refreshed");
          return;
        }
        setPlanSaveState("offline");
        showError(message, message, "Goal not saved");
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [day?.plan?.id, day?.plan?.revision, day?.plan?.status, day?.shiftDate, goalProvenance, notifications, planDirty, planIntent, resyncPlanFromServer, showError, suggestionTaskIds]);

  useEffect(() => {
    let disposed = false;
    const cleaners: Array<() => void> = [];
    const register = (off: () => void) => { if (disposed) off(); else cleaners.push(off); };
    void listen<DebugScenario>("work-os://debug-scenario", (event) => {
      if (disposed || !event.payload || typeof event.payload.enabled !== "boolean") return;
      const next = { ...DEFAULT_DEBUG_SCENARIO, ...event.payload };
      debugRef.current = next;
      setDebugScenario(next);
      void emit("work-os://debug-current", next).catch(() => undefined);
    }).then(register).catch(() => undefined);
    void listen("work-os://debug-request", () => {
      if (!disposed) void emit("work-os://debug-current", debugRef.current).catch(() => undefined);
    }).then(register).catch(() => undefined);
    return () => { disposed = true; cleaners.forEach((off) => off()); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void openDebugger();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** One honest voice for "saved here, not delivered": queue counts plus a
   * waiting-to-sync notice. Never used for delivered work. */
  async function announceQueued() {
    const queue = await secureState.queue();
    setQueueCount(queue.length);
    setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length);
    notifications.info("Saved on this device — it will sync automatically when the connection is back.", "Waiting to sync");
  }

  async function act(label: string, action: () => Promise<unknown>) {
    setBusy(true); setError("");
    diagnostics.info("ui.action.requested", label, { activeView: view });
    try {
      if (syncBypassRef.current) {
      diagnostics.info("ui.action.bypass", label, { activeView: view });
      notifications.success(actionSuccessMessages[label] ?? "The change was saved on this device.");
      return;
    }
    if (debugRef.current.enabled && !debugScenario.liveWrites) throw new Error("Scenario mode is active. Reset the debugger scenario before submitting real changes.");
      const result = await action();
      if (isQueuedResult(result)) {
        // Saved on this device, not delivered. Never claim success for it.
        diagnostics.info("ui.action.queued", label, { activeView: view });
        await announceQueued();
        return;
      }
      if (isWorktivityControlResult(result)) {
        if (result.status === "confirmation_required") {
          if (result.requirement === "late" || result.requirement === "exception") {
            setClockInConfirmation({ kind: result.requirement, reason: "", operationId: result.operation_id });
          } else if (result.requirement === "extended") {
            setClockOutExtendedPrompt(true);
            setClockOutConfirmation(true);
          }
          return;
        }
        if (result.status === "pending") {
          setWorktivityPending({ action: result.action, operationId: result.operation_id, body: result.body ?? {}, message: result.message });
          diagnostics.warn("worktivity.control.pending", result.message, { action: result.action, operationId: result.operation_id });
          notifications.info(result.message, "Worktivity confirmation pending");
          if (result.restore_warning) notifications.notify("warning", result.restore_warning, "Worktivity control connection needs attention");
          return;
        }
        if ("restore_warning" in result && result.restore_warning) notifications.notify("warning", result.restore_warning, "Worktivity control connection needs attention");
        if (result.status === "not_applied") {
          setWorktivityPending((current) => current?.operationId === result.operation_id ? null : current);
          notifications.info(result.message, "Worktivity did not change");
          return;
        }
        if (result.status === "desktop_failed" || result.status === "blocked") throw new Error(result.message || "Worktivity could not complete this action.");
        if (result.status === "confirmed") setWorktivityPending((current) => current?.operationId === result.operation_id ? null : current);
      }
      // Task/workspace writes already patched the caches surgically; just mark
      // them for the next natural revalidation (focus, TTL, view entry) so the
      // page never refetches everything for one row. Everything else (shift,
      // report, proposal, check-in) materially changes the day and refreshes it.
      if (label.startsWith("task.") || label.startsWith("workspace.")) {
        void queryClient.invalidateQueries({ queryKey: workOsKeys.taskHistory(), refetchType: "none" });
        void queryClient.invalidateQueries({ queryKey: workOsKeys.day("details"), refetchType: "none" });
        void queryClient.invalidateQueries({ queryKey: ["work-os", "insights"], refetchType: "none" });
      } else {
        invalidateDayData();
        await refresh();
      }
      const queue = await secureState.queue(); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length);
      void emit("work-os://main-day-changed");
      diagnostics.info("ui.action.completed", label, { activeView: view });
      notifications.success(isWorktivityControlResult(result) && result.status === "confirmed" && result.already_target
        ? "Worktivity already reflects this attendance state."
        : actionSuccessMessages[label] ?? "The change was saved.");
    }
    catch (value) {
      const message = value instanceof Error ? value.message : "Action failed";
      diagnostics.error("ui.action.failed", message, { action: label, activeView: view });
      showError(message, message);
    }
    finally { setBusy(false); }
  }
  /** The composer plays its exit before it unmounts, so finishing an add
   * shifts the list behind a closing modal instead of snapping it away. */
  function closeTaskComposer() {
    if (taskComposerClosing) return;
    setTaskComposerClosing(true);
    window.setTimeout(() => {
      setTaskComposerOpen(false);
      setTaskComposerClosing(false);
    }, prefersReducedMotion() ? 0 : 200);
  }

  function setScenario(next: DebugScenario) { debugRef.current = next; setDebugScenario(next); void emit("work-os://debug-current", next); }

  async function openDebugger() {
    try {
      await openDebuggerWindow();
      diagnostics.info("debug.window.open", "Opened Work OS Debugger");
    } catch (value) {
      const message = errorMessage(value, "Debugger window could not open.");
      diagnostics.error("debug.window.open_failed", message);
      setError(message);
      notifications.error(message, "Debugger unavailable", { label: "Open logs folder", onClick: () => void openLogsDir() });
    }
  }

  async function toggleAutoStart(enabled: boolean) {
    try {
      if (enabled) await enable(); else await disable();
      setAutoStart(enabled);
      notifications.success(enabled ? "Work OS will start with Windows." : "Work OS will no longer start with Windows.", "Launch setting updated");
    } catch (value) {
      showError(value, "The Windows launch setting could not be changed.", "Launch setting not saved");
    }
  }

  async function exportAppDiagnostics() {
    try {
      const queue = await secureState.queue();
      const path = await exportDiagnostics({ runtimeHealth: { online: navigator.onLine, queueCount }, queueSummary: { count: queue.length, paths: queue.map((item) => item.path), attempts: queue.map((item) => item.attempts) }, sanitizedConfig: { apiBase: visibleSession?.apiBase ?? apiBase, autoStart } });
      notifications.success(`Saved to ${path}`, "Diagnostics exported");
    } catch (value) {
      showError(value, "Diagnostics could not be exported.", "Export failed");
    }
  }

  /** Closes the plugin's native download resource when a pending entry is
   * replaced, so superseded installers cannot pin memory. Downloaded entries
   * hold the same native resource as available/failed ones. */
  function discardUpdateEntry(flow: UpdateFlow) {
    if (flow.status === "available" || flow.status === "failed" || flow.status === "downloaded") {
      void flow.update.close().catch(() => undefined);
    }
  }

  /** Raises the persistent install prompt for a downloaded update. Reusing the
   * stable key replaces a visible prompt and re-raises one the user dismissed
   * with "Later". */
  function raiseDownloadedUpdateNotification(version: string) {
    const copy = updateDownloadedCopy(version);
    notifications.persistent(UPDATE_AVAILABLE_KEY, copy.message, copy.title, "info", {
      actions: [
        { label: "Update now", kind: "primary", onClick: () => void installDownloadedUpdate() },
        { label: "Later", kind: "quiet", onClick: () => notifications.clearPersistent(UPDATE_AVAILABLE_KEY) },
      ],
    });
  }

  async function beginUpdateDownload() {
    const flow = updateFlowRef.current;
    if (flow.status !== "available" && flow.status !== "failed") return;
    const { update, headers } = flow;
    const display = displayUpdateVersion(update.version);
    updatePaintRef.current = null;
    setUpdateFlow({ status: "downloading", update, headers, progress: INITIAL_UPDATE_DOWNLOAD_PROGRESS });
    const publishProgress = (progress: UpdateDownloadProgress, force = false) => {
      const details = updateProgressDetails(progress);
      const paintKey = details.percent ?? Math.floor(progress.receivedBytes / (256 * 1024));
      if (!force && updatePaintRef.current === paintKey) return;
      updatePaintRef.current = paintKey;
      notifications.persistent(UPDATE_AVAILABLE_KEY, `Downloading ${display}… ${details.valueText}`, "Downloading update", "info", {
        progress: { value: details.percent, max: 100, valueText: details.valueText },
        locked: true,
      });
    };
    publishProgress(INITIAL_UPDATE_DOWNLOAD_PROGRESS, true);
    let progress = INITIAL_UPDATE_DOWNLOAD_PROGRESS;
    try {
      await update.download((event) => {
        progress = applyDownloadEvent(progress, event);
        setUpdateFlow((current) => current.status === "downloading" ? { ...current, progress } : current);
        publishProgress(progress);
      }, { headers });
    } catch (value) {
      const message = errorMessage(value, "The download did not finish.");
      diagnostics.warn("updater.download_failed", message);
      setUpdateFlow({ status: "failed", update, headers, message });
      const copy = updateDownloadFailedCopy(update.version, message);
      notifications.persistent(UPDATE_AVAILABLE_KEY, copy.message, copy.title, "error", {
        actions: [{ label: "Retry", kind: "primary", onClick: () => void beginUpdateDownload() }],
      });
      return;
    }
    setUpdateFlow({ status: "downloaded", update });
    raiseDownloadedUpdateNotification(update.version);
  }

  async function installDownloadedUpdate() {
    const flow = updateFlowRef.current;
    if (flow.status !== "downloaded") return;
    // The install step ends in the process exiting on Windows (the installer
    // closes and relaunches the app), so the exit watchdog is armed first and
    // disarmed again if the install rejects, keeping the app alive. Arming is a
    // safety net, not a prerequisite: if the command is unavailable (for
    // example after an ACL regression) the install still proceeds and the gap is
    // reported to diagnostics instead of blocking the update.
    notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
    setUpdateFlow({ status: "installing", update: flow.update });
    // The install step ends this process on purpose, so the next launch must not
    // report the exit as a crash.
    markCleanExit();
    let watchdogArmed = false;
    try {
      await invoke("arm_update_exit_watchdog");
      watchdogArmed = true;
    } catch (value) {
      diagnostics.warn("updater.watchdog_unavailable", errorMessage(value, "The exit watchdog could not be armed."));
    }
    try {
      await flow.update.install();
    } catch (value) {
      if (watchdogArmed) await invoke("disarm_update_exit_watchdog").catch(() => undefined);
      const message = errorMessage(value, "The update could not be installed.");
      diagnostics.warn("updater.install_failed", message);
      setUpdateFlow({ status: "downloaded", update: flow.update });
      // A failed install must stay visible and retryable: antivirus holds can
      // reject the first attempt, and a transient toast would strand the user
      // with no path back. The downloaded artifact is kept, so Retry resumes.
      notifications.persistent(UPDATE_AVAILABLE_KEY, `${message} Retry the install, or quit Work OS from the system tray and run the setup installer again.`, "Update failed", "error", {
        actions: [
          { label: "Retry", kind: "primary", onClick: () => void installDownloadedUpdate() },
          { label: "Later", kind: "quiet", onClick: () => notifications.clearPersistent(UPDATE_AVAILABLE_KEY) },
        ],
      });
      return;
    }
    await relaunch();
  }

  async function checkForUpdates({ silent = false }: { silent?: boolean } = {}) {
    if (updateCheckInFlightRef.current) return;
    const previous = updateFlowRef.current;
    if (!canRunBackgroundUpdateCheck(previous.status)) return;
    updateCheckInFlightRef.current = true;
    setUpdateFlow({ status: "checking" });
    try {
      const saved = await secureState.session();
      if (!saved) {
        setUpdateFlow(previous);
        if (!silent) notifications.info("Sign in first, then check for updates.", "Not signed in");
        return;
      }
      const result = await queryAvailableUpdate(saved);
      if (result.status === "managed") {
        setUpdateFlow(previous);
        if (!silent) notifications.info("Updates are managed by your WrazyOS server.", "Managed update channel");
        return;
      }
      if (result.status === "current") {
        // A pending entry may be stale (for example a pulled release).
        if (previous.status === "available" || previous.status === "failed" || previous.status === "downloaded") discardUpdateEntry(previous);
        setUpdateFlow({ status: "idle" });
        if (!silent) notifications.success("You already have the latest internal build.", "Work OS is up to date");
        return;
      }
      if (previous.status === "available" || previous.status === "failed" || previous.status === "downloaded") {
        const resolution = resolvePendingUpdate({ status: previous.status, version: previous.update.version }, result.update.version);
        if (resolution !== "replace") {
          // Same version already pending: keep its state and release the
          // redundant check result. A downloaded update re-raises the install
          // prompt, so a "Later" dismissal comes back on the next check.
          void result.update.close().catch(() => undefined);
          setUpdateFlow(previous);
          if (resolution === "re-raise") raiseDownloadedUpdateNotification(previous.update.version);
          return;
        }
        // A newer release supersedes the pending entry; release its native
        // resource before surfacing the replacement.
        discardUpdateEntry(previous);
      }
      setUpdateFlow({ status: "available", update: result.update, headers: result.headers });
      const copy = updateAvailableCopy(result.update.version);
      notifications.persistent(UPDATE_AVAILABLE_KEY, copy.message, copy.title, "info", {
        action: { label: copy.actionLabel, onClick: () => void beginUpdateDownload() },
      });
    } catch (value) {
      const message = errorMessage(value, "The update catalog could not be checked.");
      diagnostics.warn("updater.check_failed", message);
      // A failed check must never drop a pending entry: a downloaded update
      // stays installable and an available/failed entry keeps its retry.
      const keepPrevious = previous.status === "available" || previous.status === "failed" || previous.status === "downloaded";
      setUpdateFlow(keepPrevious ? previous : { status: "idle" });
      if (!silent) showError(message, message, "Update failed");
    } finally {
      updateCheckInFlightRef.current = false;
    }
  }

  async function toggleAutoCheckUpdates(enabled: boolean) {
    const previous = autoCheckUpdates;
    setAutoCheckUpdates(enabled);
    try {
      await secureState.saveSettings({ apiBase, autoCheckUpdates: enabled });
      notifications.success(enabled ? `Work OS will check for updates on launch and ${UPDATE_CHECK_CADENCE_COPY}.` : "Work OS will no longer check for updates automatically.", "Update setting saved");
    } catch (value) {
      setAutoCheckUpdates(previous);
      showError(errorMessage(value, "The update setting could not be saved."), "The update setting could not be saved.", "Setting not saved");
    }
  }

  /** Apply first, persist second: the choice must land instantly in both
   * windows, and a failed save rolls the visible state back rather than
   * leaving the control and the rendering disagreeing. */
  async function chooseTextSize(next: TextSize) {
    const previous = textSize;
    setTextSize(next);
    applyAppearance({ textSize: next, mascotSize });
    try {
      await secureState.saveSettings({ textSize: next });
      void emit(APPEARANCE_EVENT, { textSize: next, mascotSize });
    } catch (value) {
      setTextSize(previous);
      applyAppearance({ textSize: previous, mascotSize });
      showError(errorMessage(value, "The text size could not be saved."), "The text size could not be saved.", "Setting not saved");
    }
  }

  async function chooseMascotSize(next: MascotSize) {
    const previous = mascotSize;
    setMascotSize(next);
    applyAppearance({ textSize, mascotSize: next });
    try {
      await secureState.saveSettings({ mascotSize: next });
      void emit(APPEARANCE_EVENT, { textSize, mascotSize: next });
    } catch (value) {
      setMascotSize(previous);
      applyAppearance({ textSize, mascotSize: previous });
      showError(errorMessage(value, "The mascot size could not be saved."), "The mascot size could not be saved.", "Setting not saved");
    }
  }

  async function chooseRecapVoice(next: string) {
    const previous = recapVoice;
    setRecapVoice(next);
    try {
      await secureState.saveSettings({ recapVoice: next });
      // The floating companion is a separate window; tell it now instead of at
      // its next launch.
      void emit(RECAP_VOICE_EVENT, { recapVoice: next });
    } catch (value) {
      setRecapVoice(previous);
      showError(errorMessage(value, "Otto's voice could not be saved."), "Otto's voice could not be saved.", "Setting not saved");
    }
  }

  async function logout() {
    if (!window.confirm("Sign out of Work OS? You will need to sign in again to file updates and reach your workspace.")) return;
    setBusy(true); setError("");
    try {
      if (session && !debugRef.current.enabled) await apiRequest("/api/work-os/desktop/session", { method: "DELETE" });
    } catch {
      // Local sign-out must still succeed if the server is unavailable.
    } finally {
      void emit(OTTO_CONTEXT_CLEARED_EVENT, adminOttoSnapshot ? ottoContextEvent(adminOttoSnapshot) : null);
      requestOttoAudioStop();
      void adminOttoDeliveryRef.current?.stop();
      await secureState.clearAccount();
      queryClient.clear();
      setSession(null); setDay(null); setDayLive(false); planningAutoOpenedRef.current = false; setOnboarding(null); setQueueCount(0); setQueueAttentionCount(0); setView("day"); setProfileOpen(false);
      setScenario(DEFAULT_DEBUG_SCENARIO); setBusy(false);
    }
  }

  async function resetOnboarding() {
    if (!window.confirm("Restart onboarding? Your personal setup answers will be cleared. Your role, team, manager, official schedule, and consent history will remain intact.")) return;
    if (debugRef.current.enabled) {
      setScenario({ ...debugRef.current, onboardingState: "missing", invalidateOnboardingData: true });
      setView("day");
      return;
    }
    setBusy(true); setError("");
    try {
      const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "DELETE" });
      queryClient.setQueryData(workOsKeys.onboarding(), next);
      setOnboarding(next); setView("day");
      notifications.success("Your personal setup answers were cleared.", "Onboarding restarted");
    } catch (value) {
      showError(value, "Onboarding could not be reset.", "Reset failed");
    } finally { setBusy(false); }
  }

  async function saveProfileSettings(patch: ProfileSettingsPatch, avatar: File | null, removeAvatar: boolean) {
    if (debugRef.current.enabled) {
      setOnboarding((current) => current ? {
        ...current,
        profile: {
          ...current.profile,
          displayName: patch.displayName,
          timezone: patch.timezone,
          language: patch.language,
          weekStart: patch.weekStart,
          timeFormat: patch.timeFormat,
          schedule: patch.schedule,
          notifications: patch.notifications,
          privacy: { ...current.profile.privacy, ...patch.privacy },
          workPreferences: {
            ...current.profile.workPreferences,
            ...patch.workPreferences,
            responsibilities: patch.workPreferences.items.filter((item) => item.kind === "responsibility").map((item) => item.label),
            outputTypes: patch.workPreferences.items.filter((item) => item.kind === "deliverable").map((item) => item.label),
            evidenceSources: patch.workPreferences.items.filter((item) => item.kind === "evidence").map((item) => item.label),
          },
        },
      } : current);
      void avatar;
      void removeAvatar;
      return;
    }
    const form = new FormData();
    form.append("settings", JSON.stringify(patch));
    if (avatar) form.append("avatar", avatar, avatar.name);
    if (removeAvatar) form.append("removeAvatar", "true");
    const next = await apiRequest<OnboardingData>("/api/work-os/me/profile", { method: "PATCH", body: form });
    queryClient.setQueryData(workOsKeys.onboarding(), next);
    setOnboarding(next);
  }

  // Only the record for the selected range and shift day may render: switching
  // tabs shows the skeleton instead of the previous range's data.
  const activeInsights = useMemo(() => {
    if (!insights) return null;
    const through = visibleDay?.shiftDate ?? "";
    return insights.range === insightRange && (!through || insights.through === through) ? insights : null;
  }, [insights, insightRange, visibleDay?.shiftDate]);
  const activeInsightsLoading = insightsLoading || (insightsQuery.isFetching && !activeInsights);

  // The workspace shows skeletons until the data for the active view exists;
  // the empty copy only ever appears after a completed load found nothing.
  const viewingHistorical = !!planHistoryDate && planHistoryDate !== (visibleDay?.shiftDate ?? "");
  const tasksInitialLoading = !visibleDay
    || (viewingHistorical && historicalQuery.isPending && !historicalQuery.data)
    || (view === "tasks" && taskSearchQuery !== taskSearch.trim())
    || (view === "tasks" && !syncBypass && activeTaskHistoryQuery.isPending && !activeTaskHistoryQuery.data);

  useEffect(() => {
    // Scenario/offline insights are computed on-device; live insights come
    // from the cached query above.
    if ((syncBypassRef.current || debugRef.current.enabled) && view === "insights" && visibleDay) {
      setInsights(insightsFixture(visibleDay, insightRange));
      setInsightsLoading(false);
    }
  }, [view, insightRange, visibleDay]);

  useEffect(() => {
    if (!visibleDay || syncBypassRef.current || queuedInterpretationId) return;
    void secureState.queue().then((queue) => {
      const action = readyInterpretations(queue)[0] as OfflineAction | undefined;
      const text = typeof action?.body.input === "string" ? action.body.input.trim() : "";
      const raw = action?.result && typeof action.result === "object" ? (action.result as { interpretation?: unknown }).interpretation : null;
      if (!action || !text || !raw) return;
      const review = normalizeInterpretation(raw, text, interpretationTaskOptions());
      setQueuedInterpretationId(action.id);
      if (!review?.operations.length) {
        setAiUnavailable("The queued assistant result could not be safely reviewed. Choose the update type instead.");
        return;
      }
      setPendingProgressUpdate(text);
      setProgressPanel("update");
      setProgressComposerOpen(true);
      setInterpretation({ status: "ready", operations: review.operations, taskOptions: interpretationTaskOptions(), reviewId: crypto.randomUUID() });
      notifications.info("Your queued update is ready for review. Nothing has been recorded yet.", "Review queued update");
    }).catch((value) => diagnostics.warn("offline_queue.restore_interpretation", errorMessage(value, "Could not restore queued interpretation")));
  }, [notifications, queuedInterpretationId, taskHistory, visibleDay]);
  const composerConversationScope = visibleSession?.organizationId && visibleDay?.access?.personId && visibleDay.shiftDate
    ? `workday:${visibleSession.organizationId}:${visibleDay.access.personId}:${visibleDay.shiftDate}`
    : null;
  useEffect(() => {
    let cancelled = false;
    composerConversationSignature.current = "";
    setLoadedComposerConversation(null);
    setComposerHistory([]);
    if (!composerConversationScope) return () => { cancelled = true; };
    void secureState.conversation(composerConversationScope).then((turns) => {
      if (!cancelled) {
        composerConversationSignature.current = JSON.stringify(turns);
        setComposerHistory(turns);
        setLoadedComposerConversation(composerConversationScope);
      }
    }).catch(() => {
      if (!cancelled) setLoadedComposerConversation(composerConversationScope);
    });
    return () => { cancelled = true; };
  }, [composerConversationScope]);
  useEffect(() => {
    if (!composerConversationScope || loadedComposerConversation !== composerConversationScope) return;
    const signature = JSON.stringify(composerHistory);
    if (composerConversationSignature.current === signature) return;
    composerConversationSignature.current = signature;
    void secureState.saveConversation(composerConversationScope, composerHistory).then(() => emit("work-os://conversation-changed", { scope: composerConversationScope })).catch(() => undefined);
  }, [composerConversationScope, composerHistory, loadedComposerConversation]);
  const sharedToolsSig = useRef("");
  const sharePendingTools = useCallback(async (review: Omit<PendingToolReview, "origin" | "updatedAt">) => {
    if (!composerConversationScope) return;
    const record: PendingToolReview = { ...review, updatedAt: new Date().toISOString(), origin: "main" };
    const signature = JSON.stringify(record);
    if (sharedToolsSig.current === signature) return;
    sharedToolsSig.current = signature;
    await secureState.savePendingTools(composerConversationScope, record).catch(() => undefined);
    emit("work-os://pending-tools-changed", { scope: composerConversationScope }).catch(() => undefined);
  }, [composerConversationScope]);
  const adoptSharedTools = useCallback(async () => {
    if (!composerConversationScope) return;
    const shared = await secureState.pendingTools(composerConversationScope).catch(() => null);
    if (!shared || shared.origin === "main") return;
    const signature = JSON.stringify(shared);
    if (sharedToolsSig.current === signature) return;
    sharedToolsSig.current = signature;
    setInterpretation((current) => {
      if (!current) {
        if (!shared.operations.length) return current;
        setPendingProgressUpdate(shared.input);
        setComposerHistory((history) => {
          const turn: WorkOsConversationTurn = {
            id: shared.reviewId, role: "assistant", text: shared.reply || "Tool calls shared from the companion.",
            createdAt: new Date().toISOString(), operations: shared.operations,
            toolResults: shared.results.length ? shared.results : undefined,
          };
          const index = history.findIndex((entry) => entry.id === shared.reviewId);
          if (index < 0) return [...history, turn];
          const next = [...history];
          next[index] = { ...history[index], ...turn };
          return next;
        });
        if (typeof document !== "undefined" && document.hasFocus()) setProgressComposerOpen(true);
        else notifications.info("Tool calls shared from the companion.", "Review shared tools");
        return { status: "ready", operations: shared.operations, taskOptions: shared.taskOptions, reply: shared.reply, results: shared.results.length ? shared.results : undefined, reviewId: shared.reviewId };
      }
      const localKeys = new Set(current.operations.map(toolCallKey));
      const fresh = shared.results.filter((result) => localKeys.has(toolCallKey(result.op)));
      if (!fresh.length) return current;
      return { ...current, results: mergeToolResults(current.results ?? [], fresh) };
    });
  }, [composerConversationScope, notifications]);
  // Pending tool calls raised in the avatar appear here too, and results
  // filed in either window merge by stable key. Adopt a fresh review only
  // when this window has none active; never clobber an in-progress review.
  useEffect(() => {
    if (!composerConversationScope) return;
    void adoptSharedTools();
  }, [composerConversationScope, adoptSharedTools]);
  useEffect(() => {
    if (!composerConversationScope || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ scope?: string }>("work-os://pending-tools-changed", (event) => {
      if (event.payload?.scope !== composerConversationScope) return;
      void adoptSharedTools();
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [composerConversationScope, adoptSharedTools]);
  useEffect(() => {
    if (!composerConversationScope || !isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ scope?: string }>("work-os://conversation-changed", (event) => {
      if (event.payload?.scope !== composerConversationScope) return;
      void secureState.conversation(composerConversationScope).then((turns) => {
        composerConversationSignature.current = JSON.stringify(turns);
        setComposerHistory(turns);
      }).catch(() => undefined);
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [composerConversationScope]);
  useEffect(() => {
    if (debugScenario.enabled && visibleDay?.plan) {
      setPlanIntent(visibleDay.plan.focus_summary ?? visibleDay.plan.freeform_intent ?? "");
      setGoalProvenance(visibleDay.plan.goal_provenance === "suggested" ? "suggested" : visibleDay.plan.goal_provenance === "ai_draft" ? "ai_draft" : visibleDay.plan.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : visibleDay.plan.freeform_intent ? "employee" : null);
      setSuggestionTaskIds(visibleDay.plan.suggestion_task_ids ?? []);
      setPlanItems([...visibleDay.plan.items].sort((a, b) => a.rank - b.rank));
    }
  }, [debugScenario.enabled, visibleDay?.plan]);
  const workSession = visibleDay?.session;
  const gate = sessionGate(visibleDay);
  useMascotRuntime({
    window: "main",
    scope: debugScenario.enabled ? "debug:scenario" : visibleSession && visibleDay?.access?.personId
      ? `${visibleSession.organizationId}/${visibleDay.access.personId}/${visibleDay.shiftDate}` : "",
    facts: mascotFactsFromDay(visibleDay, !!visibleSession), scenario: debugScenario,
    working: !!composerThinking || interpretation?.status === "loading" || busy || eodRedrafting || !!eodPreparing
      || !!interpretation?.results?.some((result) => result.status === "processing")
      || completingTaskIds.size > 0 || pendingTasks.some((task) => task.status === "syncing"),
    failed: !!error || (!!aiUnavailable && !syncBypass) || pendingTasks.some((task) => task.status === "failed")
      || !!interpretation?.results?.some((result) => result.status === "failed"),
    needsInput: interpretation?.status === "ready" && hasPendingMascotApproval(interpretation.operations, interpretation.results),
    receipt: mascotReceipt,
  });
  const active = gate.active;
  const sessionActive = !!workSession && ["clocked_in", "active", "paused", "eod_due"].includes(workSession.state);
  const observedOnly = gate.worktivitySynced && !sessionActive;
  const paused = sessionActive ? workSession?.state === "paused" : observedOnly && visibleDay?.attendance?.state === "paused";
  const providerAttendanceActive = visibleDay?.attendance?.source === "worktivity" && !visibleDay.attendance.stale
    && (visibleDay.attendance.state === "active" || visibleDay.attendance.state === "paused");
  const attendanceControlsSupported = !isMacOS();
  const canControlWorktivity = attendanceControlsSupported && (sessionActive || providerAttendanceActive);
  const hasVisibleSession = Boolean(visibleSession);
  const lateReasonMissing = lateReasonRequired(visibleDay?.session);
  const clockInLateProlonged = clockInConfirmation?.kind === "late" && !!visibleDay?.shift
    && Date.now() >= Date.parse(visibleDay.shift.startsAt) + PROLONGED_ABSENCE_MINUTES * 60_000;
  useEffect(() => {
    if (!hasVisibleSession || (adminShellActive && !personalNotificationReadsEnabled) || visibleOnboarding?.onboardingRequired || !gate.persistentMessage) {
      notifications.clearPersistent("work-os-session-gate");
      return;
    }
    notifications.persistent("work-os-session-gate", gate.persistentMessage, gate.persistentTitle, "info");
  }, [adminShellActive, personalNotificationReadsEnabled, gate.persistentMessage, gate.persistentTitle, hasVisibleSession, notifications, visibleOnboarding?.onboardingRequired]);
  const todayParentTasks = useMemo(
    () => dayScopedTasks(visibleDay?.tasks ?? [], planItems, visibleDay?.shiftDate ?? "", taskHistory),
    [visibleDay?.tasks, planItems, visibleDay?.shiftDate, taskHistory],
  );
  const todayCompletedCount = todayParentTasks.filter((task) => task.completed === true).length;
  // Optimistic adds render instantly as rows with a sync state and retry.
  // The hero, its counts, and the tasks workspace all render this exact set, so
  // no surface can disagree with another about what "today" contains. Optimistic
  // adds are cache rows already, so a swap never changes the list's membership.
  const visibleTodayTasks = todayParentTasks;
  // One lookup for every checkbox surface: "completing" spins, "leaving" shows
  // its check while the row plays its exit.
  const taskFlight = useMemo(() => {
    const flight = new Map<string, "completing" | "leaving">();
    for (const id of completingTaskIds) flight.set(id, "completing");
    for (const id of leavingTaskIds) flight.set(id, "leaving");
    return flight;
  }, [completingTaskIds, leavingTaskIds]);
  const dashboardGridRef = useRef<HTMLDivElement | null>(null);
  useListShift(dashboardGridRef);
  const openTasks = visibleTodayTasks.filter((task) => !task.completed);
  const reviewDay = eodDate ? reportDayQuery.data ?? null : visibleDay;
  /* Today's report opens in the final ten minutes before its scheduled
     clock-out. The server and the web use the same predicate; this prompt
     explains the wait before the employee reaches for the button. */
  const reviewShiftDate = eodDate ?? reviewDay?.shiftDate ?? "";
  /* The gate belongs to the running shift: today. An earlier day has ended,
     so it stays draftable even when one of its sessions was never closed. */
  const reviewIsCurrentDay = !eodDate || eodDate === visibleDay?.shiftDate;
  const reviewShiftOpen = reviewIsCurrentDay && (eodDraftBlocked({
    session: reviewDay?.session ?? null,
    attendance: reviewDay?.attendance ?? null,
    scheduledEndsAt: reviewDay?.dayShift?.endsAt ?? null,
    now: pulseNow.getTime(),
  }) || (eodShiftRefused?.date === reviewShiftDate && eodShiftRefused.at === (reviewDay?.at ?? null) && !eodDraftWindowOpen({
    session: reviewDay?.session ?? null,
    scheduledEndsAt: reviewDay?.dayShift?.endsAt ?? null,
    now: pulseNow.getTime(),
  })));
  const outstandingDays = outstandingQuery.data?.days ?? [];
  const goalSuggestion = useMemo(() => suggestDailyGoal(parentTasks(visibleDay?.tasks ?? []), visibleDay?.shiftDate ?? "", planItems), [visibleDay?.tasks, visibleDay?.shiftDate, planItems]);
  // The server backlog is the complete open set (not the paginated history
  // window), so removing today's day-scoped work yields exactly what the Tasks
  // page shows as Unfinished — one membership rule for both surfaces. Until the
  // backlog arrives (or if it fails) fall back to the computed carry-over so
  // the tabs are never silently empty.
  const openBacklog = useMemo(() => (backlogQuery.data ? parentTasks(uniqueTasks(backlogQuery.data.tasks)) : null), [backlogQuery.data]);
  const unfinishedCarryOver = useMemo(() => {
    if (openBacklog) {
      const todayIds = new Set(todayParentTasks.map((task) => taskRowId(task)));
      return unfinishedBefore(openBacklog.filter((task) => !todayIds.has(taskRowId(task))), visibleDay?.shiftDate ?? "");
    }
    const computed = unfinishedBefore(parentTasks(taskHistory), visibleDay?.shiftDate ?? "");
    const groups = visibleDay?.workspaceSummary?.carryOverGroups;
    if (!groups) return computed;
    const seen = new Set(computed.map(({ task }) => String(task.provider_task_id || task.id)));
    const extra = groups.flatMap((group) => group.tasks)
      .filter((task) => !seen.has(String(task.provider_task_id || task.id)))
      .map((task) => ({ task, attribution: { date: task.due_date ?? null, reason: "carried" as const } }));
    return [...computed, ...extra];
  }, [openBacklog, todayParentTasks, visibleDay?.shiftDate, visibleDay?.workspaceSummary, taskHistory]);
  const yesterdayDate = moveDate(visibleDay?.shiftDate ?? "", -1);
  const yesterdayDueTasks = unfinishedCarryOver.filter(({ task }) => !task.completed && task.due_date?.slice(0, 10) === yesterdayDate);
  const recencyOrder = (task: TaskRow) => {
    const value = task.updated_at ?? task.provider_updated_at ?? task.provider_created_at ?? task.created_at ?? "";
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? -parsed : 0;
  };
  const sortedDashboardTasks = [...openTasks.filter((task) => !task.pending_status)]
    .sort((left, right) => {
      const leftDue = typeof left.due_date === "string" ? left.due_date.slice(0, 10) : null;
      const rightDue = typeof right.due_date === "string" ? right.due_date.slice(0, 10) : null;
      if (leftDue && rightDue && leftDue !== rightDue) return leftDue.localeCompare(rightDue);
      if (leftDue && !rightDue) return -1;
      if (!leftDue && rightDue) return 1;
      return recencyOrder(left) - recencyOrder(right);
    })
    .slice(0, 3);
  const dashboardTopTasks = [...openTasks.filter((task) => task.pending_status), ...sortedDashboardTasks].slice(0, 3);
  const dashboardTimezone = visibleDay?.shift?.timezone ?? visibleOnboarding?.profile.timezone ?? null;
  const dashboardSchedule = visibleOnboarding?.organizationSetup.officialSchedule
    ?? (visibleOnboarding?.employeeRequirements.scheduleProvided ? visibleOnboarding.profile.schedule : null);
  const dashboardShift = useMemo(() => resolveDashboardShift({
    shift: visibleDay?.shift ?? null,
    session: workSession,
    schedule: dashboardSchedule,
    currentDate: visibleDay?.shiftDate ?? "",
    timezone: dashboardTimezone,
    now: pulseNow,
  }), [dashboardSchedule, dashboardTimezone, pulseNow, visibleDay?.shift, visibleDay?.shiftDate, workSession]);
  const pulse = shiftPulse(workSession, dashboardShift, pulseNow, visibleDay?.breakPolicy?.worktivityAuthoritative === true, visibleDay?.attendance);
  const dashboardModel = useMemo(() => buildWorkdayDashboardModel({
    active,
    paused,
    observedOnly,
    currentDate: visibleDay?.shiftDate ?? "",
    shift: dashboardShift,
    session: workSession,
    schedule: dashboardSchedule,
    timezone: dashboardTimezone,
    attendance: visibleDay?.attendance ?? null,
    activityWatch: attendanceWatchExpectation(attendanceWatchInput(visibleDay), pulseNow.getTime()),
    pulse,
    tasks: visibleTodayTasks,
    carryover: unfinishedCarryOver.map(({ task }) => task),
    overdueCount: backlogQuery.data?.counts?.overdue,
    focus: planIntent || goalSuggestion?.text || "Your open tasks define today’s work.",
    focusSource: planIntent
      ? goalProvenance === "suggested" ? `Suggested by ${MASCOT.name}` : goalProvenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : goalProvenance === "accepted_suggestion" ? "Derived from today’s tasks" : "Your focus note"
      : goalSuggestion ? "Suggested from today’s tasks" : "Task record",
    niftySync: visibleDay?.niftySync,
  }), [active, paused, observedOnly, dashboardSchedule, dashboardShift, dashboardTimezone, workSession, visibleDay?.shiftDate, visibleDay?.attendance, pulse, pulseNow, visibleTodayTasks, unfinishedCarryOver, planIntent, goalSuggestion, goalProvenance, visibleDay?.niftySync]);
  const extendedClockOut = !!dashboardShift?.endsAt && pulseNow.getTime() > Date.parse(dashboardShift.endsAt) + 15 * 60_000;

  useEffect(() => {
    const autoOpen = shouldAutoOpenPlanning({
      active,
      dayLive,
      promptKind: visibleDay?.prompt.kind,
      promptRequired: visibleDay?.prompt.required,
      planStatus: visibleDay?.plan?.status,
    });
    if (debugScenario.planningState === "required" || autoOpen) {
      openPlanningSession();
      planningAutoOpenedRef.current = autoOpen;
    }
    // Debugger-only: choosing the Shift start scenario opens the Plan modal directly
    // so the plan/build/refine flow can be exercised from fixtures. Production behavior
    // is unchanged (debugScenario.enabled is only true from the debugger window).
    if (debugScenario.enabled && debugScenario.dayState === "shift_start" && !shiftStartScenarioOpened.current) {
      shiftStartScenarioOpened.current = true;
      openPlanningSession();
    }
    if (!debugScenario.enabled || debugScenario.dayState !== "shift_start") shiftStartScenarioOpened.current = false;
  }, [active, dayLive, debugScenario.planningState, debugScenario.enabled, debugScenario.dayState, visibleDay?.plan?.status, visibleDay?.prompt.kind, visibleDay?.prompt.required]);

  // The launch snapshot can auto-open the modal for a plan that the live read
  // then proves confirmed; close it again instead of leaving a stale demand.
  useEffect(() => {
    if (!shouldCloseAutoOpenedPlanning({ open: planningSessionOpen, autoOpened: planningAutoOpenedRef.current, planStatus: visibleDay?.plan?.status })) return;
    planningAutoOpenedRef.current = false;
    setPlanningSessionOpen(false);
  }, [planningSessionOpen, visibleDay?.plan?.status]);

  function editPlan(mutator: () => void) {
    planEditVersion.current += 1;
    mutator();
    setPlanDirty(true);
  }

  /** Explicit Focus-panel Apply. Commits the goal text (and its provenance) and,
   * when no goal existed yet, hands off to the SOD planning modal so the first
   * goal of the day builds tasks/subtasks exactly like shift start. Editing an
   * existing goal only updates the text — it never creates work. */
  function applyGoal(value: string, fromSuggestion: boolean) {
    const next = value.trim();
    const hadGoal = Boolean(planIntent.trim());
    editPlan(() => {
      setPlanIntent(next);
      setGoalProvenance(next ? (fromSuggestion ? "accepted_suggestion" : "employee") : null);
      setSuggestionTaskIds(fromSuggestion ? (goalSuggestion?.taskIds ?? []) : []);
    });
    if (!hadGoal && next) {
      setPlanningSeed(next);
      setPlanningSessionOpen(true);
    }
  }

  async function interpretPlanning(input: string, loom?: { url?: string; transcript?: string }): Promise<PlanningInterpretation> {
    if (!visibleDay) throw new Error("Your workday is still loading.");
    if (debugScenario.enabled && debugScenario.planningState === "ai_unavailable") throw new Error("Planning assistance is unavailable in this scenario.");
    if (syncBypassRef.current) {
      const task = planItems.find((item) => item.task_id) ?? null;
      return {
        buildId: "debug-ai-build",
        rawIntent: input,
        summary: input,
        commitments: [{
          clientId: "offline-plan", linkedTaskId: task?.task_id ?? undefined, title: task?.title_snapshot ?? "Today's work", objective: input,
          successCriteria: [], sourceRefs: task?.task_id ? [{ provider: "work_os", type: "task", id: task.task_id, label: task.title_snapshot }] : [{ provider: "employee", type: "intent", id: "raw_intent", label: "Employee planning input" }], confidence: 1,
        }],
        clarifications: [], readiness: "ready",
      };
    }
    const result = await apiRequest<{ interpretation: PlanningInterpretation; build_id: string }>("/api/work-os/me/plan/interpret", {
      method: "POST",
      signal: AbortSignal.timeout(PLAN_INTERPRET_TIMEOUT_MS),
      body: JSON.stringify({ input, date: visibleDay.shiftDate, conversation: composerHistory.slice(-8).map((turn) => ({ role: turn.role, text: turn.text })), ...(loom ? { loom } : {}) }),
    });
    return { ...result.interpretation, buildId: result.build_id };
  }

  async function refinePlanning(input: string, draft: PlanningInterpretation, annotations: PlanAnnotation[], edits: PlanDraftEdit[], clarificationAnswers: Record<string, string>): Promise<PlanningInterpretation> {
    if (!visibleDay) throw new Error("Your workday is still loading.");
    if (debugScenario.enabled && debugScenario.planningState === "ai_unavailable") throw new Error("Planning assistance is unavailable in this scenario.");
    if (syncBypassRef.current) {
      // Offline fixture stub: apply the employee edits locally so the refine loop
      // (annotate → refine → review → confirm) is fully exercisable without a backend.
      const remaining = draft.clarifications.filter((question) => !clarificationAnswers[question.id]?.trim());
      const readiness: PlanningInterpretation["readiness"] = remaining.length === 0 ? "ready" : remaining.length === 1 ? "needs_one_clarification" : "needs_multiple_clarifications";
      return {
        ...draft,
        buildId: "debug-ai-build",
        rawIntent: input,
        clarifications: remaining,
        readiness,
        commitments: draft.commitments.map((commitment) => {
          const edit = edits.find((entry) => entry.clientId === commitment.clientId);
          return edit ? { ...commitment, title: edit.title ?? commitment.title, objective: edit.objective ?? commitment.objective, successCriteria: edit.successCriteria ?? commitment.successCriteria } : commitment;
        }),
      };
    }
    const result = await apiRequest<{ interpretation: PlanningInterpretation; build_id: string }>("/api/work-os/me/plan/refine", {
      method: "POST",
      signal: AbortSignal.timeout(PLAN_REFINE_TIMEOUT_MS),
      body: JSON.stringify({
        input,
        date: visibleDay.shiftDate,
        draft: { summary: draft.summary, commitments: draft.commitments.map((commitment) => ({ clientId: commitment.clientId, title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria })) },
        annotations: annotations.map((annotation) => ({ target: annotation.target, quote: annotation.quote, comment: annotation.comment })),
        edits,
        clarifications: draft.clarifications.map((question) => ({ id: question.id, question: question.question, ...(question.commitmentId ? { commitmentId: question.commitmentId } : {}) })),
        clarificationAnswers: Object.fromEntries(draft.clarifications.flatMap((question) => {
          const answer = clarificationAnswers[question.id]?.trim();
          return answer ? [[question.id, answer]] : [];
        })),
      }),
    });
    return { ...result.interpretation, buildId: result.build_id };
  }

  async function confirmPlanning(input: string, interpretation: PlanningInterpretation | null, clarificationAnswers: Record<string, string>): Promise<"confirmed" | "saved" | "queued" | "conflict" | "failed" | "rebuild"> {
    if (syncBypassRef.current) {
      // Offline fixtures stay on-device. Debugger fixtures without a server plan
      // (e.g. Shift start) simply resolve — the modal owns its confirmed state.
      if (visibleDay?.plan) {
        const nextPlan = { ...visibleDay.plan, status: active ? "confirmed" as const : "draft" as const, freeform_intent: input, focus_summary: interpretation?.summary ?? null, goal_provenance: interpretation ? ("ai_draft" as const) : ("employee" as const) };
        setDay((current) => current ? { ...current, plan: nextPlan } : current);
        setPlanIntent(interpretation?.summary ?? input);
        setPlanItems(nextPlan.items);
      }
      return active ? "confirmed" : "saved";
    }
    if (!visibleDay?.plan) return "conflict";
    if (debugScenario.enabled && debugScenario.planningState === "conflict") return "conflict";
    if (debugScenario.enabled && debugScenario.planningState === "offline") return "queued";
    setBusy(true);
    try {
      const items = interpretation ? buildPlanItemsFromInterpretation(planItems, interpretation, clarificationAnswers) : planItems.map((item) => ({
        id: item.id, task_id: item.task_id, title_snapshot: item.title_snapshot, disposition: item.disposition,
        item_kind: item.item_kind, completion_state: item.completion_state,
      }));
      const saved = await sendOrQueue("/api/work-os/me/plan", "PUT", {
        shift_date: visibleDay.shiftDate,
        revision: visibleDay.plan.revision,
        confirm: active,
        ...(active && interpretation?.buildId ? { build_id: interpretation.buildId } : {}),
        freeform_intent: input,
        goal_provenance: interpretation ? "ai_draft" : "employee",
        focus_summary: interpretation ? interpretation.summary : null,
        interpretation_metadata: interpretation ? { model: "work-os-plan", promptVersion: "work-os-plan-v1", interpretedAt: new Date().toISOString(), clarificationCount: interpretation.clarifications.length, sourceContext: ["tasks", "carry_over", "previous_plan", "blockers", "recent_updates"], clarifications: interpretation.clarifications } : undefined,
        ...(interpretation ? { clarification_answers: clarificationAnswers } : {}),
        items,
      }) as DailyPlan & { queued?: boolean; taskCreation?: { tasks?: number; subtasks?: number; failed?: number; reused?: number } };
      if (saved.queued) {
        setPlanSaveState("offline");
        return "queued";
      }
      if (active && saved.taskCreation && ((saved.taskCreation.tasks ?? 0) > 0 || (saved.taskCreation.subtasks ?? 0) > 0 || (saved.taskCreation.failed ?? 0) > 0 || (saved.taskCreation.reused ?? 0) > 0)) {
        const createdTasks = saved.taskCreation.tasks ?? 0;
        const createdSubtasks = saved.taskCreation.subtasks ?? 0;
        const reusedTasks = saved.taskCreation.reused ?? 0;
        const failedTasks = saved.taskCreation.failed ?? 0;
        const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
        // Build the receipt from the counts that actually happened: a
        // reuse-only confirm must never say "Created 0 Work OS tasks".
        const pieces: string[] = [];
        if (createdTasks) pieces.push(`created ${plural(createdTasks, "Work OS task")}`);
        if (reusedTasks) pieces.push(`continued ${plural(reusedTasks, "existing task")}`);
        if (createdSubtasks) pieces.push(`added ${plural(createdSubtasks, "subtask")}`);
        const summary = pieces.length ? `Plan applied: ${pieces.join(", ")}.` : "Plan saved.";
        notifications.success(
          failedTasks
            ? `${summary} ${plural(failedTasks, "task")} could not be created and will retry.`
            : summary,
          "Plan materialized",
        );
      }
      if (!active) {
        setDay((current) => current ? { ...current, plan: saved } : current);
        setPlanIntent(saved.focus_summary ?? saved.freeform_intent ?? "");
        setGoalProvenance(saved.goal_provenance === "suggested" ? "suggested" : saved.goal_provenance === "ai_draft" ? "ai_draft" : saved.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : saved.freeform_intent ? "employee" : null);
        setPlanItems(saved.items);
        return "saved";
      }
      setDay((current) => current ? { ...current, plan: saved } : current);
      setPlanIntent(saved.focus_summary ?? saved.freeform_intent ?? "");
      setGoalProvenance(saved.goal_provenance === "suggested" ? "suggested" : saved.goal_provenance === "ai_draft" ? "ai_draft" : saved.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : saved.freeform_intent ? "employee" : null);
      setPlanItems(saved.items);
      setPlanSaveState("saved");
      void emit("work-os://main-day-changed");
      return "confirmed";
    } catch (value) {
      const message = errorMessage(value, "Your plan could not be saved.");
      if (/changed on another device/i.test(message)) {
        resyncPlanFromServer();
        notifications.info("Showing the saved plan from your workspace. Close and reopen the focus editor to change it.", "Plan refreshed");
        return "conflict";
      }
      // An expired/used AI build cannot be retried with the same build id;
      // surface it so the editor drops the stale draft and offers Build again.
      if (/AI build/i.test(message)) {
        notifications.info("The AI plan build expired. Build the plan again to confirm it.", "Build again");
        return "rebuild";
      }
      setPlanSaveState("offline");
      return "failed";
    } finally {
      setBusy(false);
    }
  }

  function openPlanningSession() { planningAutoOpenedRef.current = false; setPlanningSeed(null); setPlanningSessionOpen(true); }

  async function loadPlanHistory(date: string) {
    setPlanHistoryDate(date);
    if (syncBypassRef.current) return;
    if (!date || date === visibleDay?.shiftDate) { setHistoricalPlan(null); setHistoricalTasks([]); return; }
    // The historical query fetches automatically once its key changes.
  }

  async function openInsightReference(reference: InsightDay["references"][number]) {
    if (reference.type === "task" || reference.type === "plan") {
      await loadPlanHistory(reference.date);
      setView("tasks");
      if (reference.type === "task") await openTaskDetails({ id: reference.id, title: reference.label }, reference.date !== visibleDay?.shiftDate);
      return;
    }
    if (reference.type === "evidence" && !FEATURES.evidence) { setView("day"); return; }
    setView(reference.type === "evidence" ? "evidence" : "day");
  }

  /** Fetch the next page from whichever paginated task list is currently visible. */
  async function loadMoreTasks() {
    if (syncBypassRef.current || !activeTaskHistoryQuery.hasNextPage || activeTaskHistoryQuery.isFetchingNextPage) return;
    try {
      await activeTaskHistoryQuery.fetchNextPage();
    } catch (value) {
      showError(value, "More tasks could not be loaded.", "Task history unavailable");
    }
  }

  async function openTaskComposer() {
    setTaskComposerTitle(""); setTaskComposerDescription("");
    setTaskComposerAssignees(visibleDay?.access?.personId ? [visibleDay.access.personId] : []);
    setTaskComposerOpen(true);
    if (syncBypassRef.current) {
      setTaskAssigneeOptions([{ id: "debug-person-1", displayName: visibleOnboarding?.profile.displayName || "David Z", email: visibleOnboarding?.profile.email ?? null }]);
      return;
    }
    if (taskAssigneeOptions.length || taskOptionsLoading) return;
    setTaskOptionsLoading(true);
    try {
      const result = await queryClient.ensureQueryData({
        queryKey: workOsKeys.taskOptions(),
        queryFn: () => apiRequest<{ people: TaskAssigneeOption[] }>("/api/work-os/me/tasks?view=options"),
        staleTime: TASK_OPTIONS_STALE_MS,
      });
      setTaskAssigneeOptions(result.people);
    } catch (value) {
      showError(value, "Could not load organization assignees.", "Assignees unavailable");
    } finally { setTaskOptionsLoading(false); }
  }

  async function loadTaskDetails(taskId: string) {
    return queryClient.fetchQuery({
      queryKey: workOsKeys.taskDetails(taskId),
      queryFn: () => fetchTaskDetails(taskId),
      staleTime: 0,
    });
  }

  async function openTaskDetails(task: Record<string, any>, readOnly = false) {
    const taskId = String(task.provider_task_id || task.id);
    setTaskDetailsReadOnly(readOnly); setSubtaskTitle(""); setSubtaskDescription(""); setSubtaskMenuId(null); setMoveMenuId(null);
    const cached = queryClient.getQueryData<TaskDetails>(workOsKeys.taskDetails(taskId));
    setTaskDetails(cached ?? { task, subtasks: [], moveTargets: [] });
    if (syncBypassRef.current) {
      // The debug fixture has no options endpoint; mirror the composer so the
      // drawer's assignment control exercises the same list shape.
      setTaskAssigneeOptions([{ id: "debug-person-1", displayName: visibleOnboarding?.profile.displayName || "David Z", email: visibleOnboarding?.profile.email ?? null }]);
      setTaskDetailsLoading(false);
      return;
    }
    setTaskDetailsLoading(!cached);
    try {
      const details = await loadTaskDetails(taskId);
      setTaskDetails({ ...details, task: details.task ?? task, subtasks: Array.isArray(details.subtasks) ? details.subtasks : [], moveTargets: Array.isArray(details.moveTargets) ? details.moveTargets : [] });
      if (details.subtaskSync?.error) notifications.error("Couldn’t refresh subtasks. Showing the last records.", "Subtasks may be stale");
    }
    catch (value) { setTaskDetails(null); showError(value, "Could not open this task.", "Task unavailable"); }
    finally { setTaskDetailsLoading(false); }
  }

  /** Sends one optimistic task; resolves on success and rejects on failure. */
  async function sendPendingTask(pending: { id: string; title: string; description: string; assignees: string[] }) {
    const result = await apiRequest<{ task: Record<string, any>; providerStatus: string; mirrorStatus: string }>("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: pending.title, description: pending.description || undefined, assignee_person_ids: pending.assignees }) });
    // The server row takes the pending row's slot; the list never loses or
    // gains a row, so nothing slides around a task that never moved.
    if (result.task) replaceTaskInCaches(pending.id, result.task);
    setPendingTasks((current) => current.filter((item) => item.id !== pending.id));
    // Draw the server record into the open lists without waiting on a manual
    // refresh; replaceTaskInCaches revalidates the active history variants.
    void queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() });
    if (result.providerStatus !== "work_os_confirmed" && result.providerStatus !== "nifty_confirmed") notifications.info(`Task submitted · ${result.mirrorStatus}`, "Task processing");
  }

  function failPendingTask(id: string, value: unknown) {
    const message = errorMessage(value, "The task could not be added.");
    diagnostics.warn("task.create.failed", "Optimistic task add failed", { id, message });
    setPendingTasks((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error: message } : item));
    patchTaskCaches(id, { pending_status: "failed", pending_error: message });
  }

  function submitTaskFromDesktop() {
    const title = taskComposerTitle.trim();
    if (!title) return;
    const description = taskComposerDescription.trim();
    const assignees = taskComposerAssignees;
    setTaskComposerTitle(""); setTaskComposerDescription(""); setTaskComposerAssignees([]);
    closeTaskComposer();
    if (syncBypassRef.current) {
      const id = `debug-task-${Date.now()}`;
      setDay((current) => {
        const base = current ?? (applyDayScenario(null, debugScenario) as DayData);
        return { ...base, tasks: [...base.tasks, { id, title, completed: false, due_date: base.shiftDate }] };
      });
      notifications.success(actionSuccessMessages["task.create"]);
      return;
    }
    const pending = { id: `pending-${crypto.randomUUID()}`, title, description, assignees, status: "syncing" as const };
    setPendingTasks((current) => [pending, ...current]);
    void queryClient.cancelQueries({ queryKey: workOsKeys.taskHistory() }).then(() => {
      insertPendingTaskIntoCaches({ id: pending.id, title, description, dueDate: visibleDay?.shiftDate ?? null });
      return sendPendingTask(pending);
    }).catch((value) => failPendingTask(pending.id, value));
  }

  function retryPendingTask(task: TaskRow) {
    const pending = pendingTasks.find((item) => item.id === String(task.id));
    if (!pending || pending.status === "syncing") return;
    const next = { ...pending, status: "syncing" as const, error: undefined };
    setPendingTasks((current) => current.map((item) => item.id === pending.id ? next : item));
    patchTaskCaches(pending.id, { pending_status: "syncing", pending_error: null });
    void sendPendingTask(next).catch((value) => failPendingTask(pending.id, value));
  }

  function dismissPendingTask(task: TaskRow) {
    setPendingTasks((current) => current.filter((item) => item.id !== String(task.id)));
    removeTaskFromCaches(String(task.id));
  }

  function surfaceTask(task: TaskRow, disposition: "selected" | "deferred" = "selected") {
    if (syncBypassRef.current) { bypassAct(disposition === "selected" ? "workspace.task_surface" : "workspace.task_defer"); return; }
    void act(disposition === "selected" ? "workspace.task_surface" : "workspace.task_defer", () => sendOrQueue("/api/work-os/me/plan", "PATCH", {
      [disposition === "selected" ? "surface_task_id" : "defer_task_id"]: task.id,
    }));
  }

  function applyScenarioTaskCompletion(task: TaskRow, completed: boolean, refreshDetails = false) {
    const taskId = String(task.provider_task_id || task.id);
    setDay((current) => ({ ...current ?? (applyDayScenario(null, debugScenario) as DayData), tasks: current?.tasks?.map((row) => String(row.provider_task_id || row.id) === taskId ? { ...row, completed, ...(row.capabilities ? { capabilities: completionTaskCapabilities(row, completed, taskCalendarDate) } : {}) } : row) ?? [] }));
    if (refreshDetails && taskDetails) {
      setTaskDetails((current) => current ? {
        ...current,
        task: String(current.task.provider_task_id || current.task.id) === taskId ? { ...current.task, completed, ...(current.task.capabilities ? { capabilities: completionTaskCapabilities(current.task, completed, taskCalendarDate) } : {}) } : current.task,
        subtasks: current.subtasks.map((row) => String(row.provider_task_id || row.id) === taskId ? { ...row, completed, ...(row.capabilities ? { capabilities: completionTaskCapabilities(row, completed, taskCalendarDate) } : {}) } : row),
      } : current);
    }
    notifications.success(actionSuccessMessages[completed ? "task.complete" : "task.reopen"]);
  }

  async function refreshTaskDetailsFor(taskId: string, force = false) {
    const current = taskDetailsRef.current;
    if (!current) return;
    const openId = String(current.task.provider_task_id || current.task.id);
    if (!force && openId !== taskId) return;
    const details = await loadTaskDetails(openId);
    // The drawer can close (or switch tasks) while the refresh is in flight.
    // Never reopen or overwrite it from a stale completion response.
    const stillOpen = taskDetailsRef.current;
    if (!stillOpen || String(stillOpen.task.provider_task_id || stillOpen.task.id) !== openId) return;
    setTaskDetails(details);
  }

  /** Confirmed completion: the row plays its short exit, then the caches drop
   * it. Only called after the server (or the offline scenario fixture) has
   * confirmed the state, so the checkbox never reports a false success. */
  async function applyConfirmedTaskCompletion(task: TaskRow, completed: boolean, refreshDetails = false, evidence?: TaskEvidenceRecord) {
    const taskId = String(task.provider_task_id || task.id);
    setCompletingTaskIds((current) => { const next = new Set(current); next.delete(taskId); return next; });
    setLeavingTaskIds((current) => new Set([...current, taskId]));
    setMascotReceipt({});
    await new Promise((resolve) => window.setTimeout(resolve, prefersReducedMotion() ? 0 : 150));
    patchTaskCaches(taskId, {
      completed,
      status: completed ? "completed" : "open",
      ...(evidence ? { completion_evidence_count: Number(task.completion_evidence_count ?? 0) + 1 } : {}),
    });
    setLeavingTaskIds((current) => { const next = new Set(current); next.delete(taskId); return next; });
    if (refreshDetails) await refreshTaskDetailsFor(taskId, true);
    else if (evidence) await refreshTaskDetailsFor(taskId);
  }

  function setTaskCompletion(task: TaskRow, completed: boolean, refreshDetails = false) {
    const taskId = String(task.provider_task_id || task.id);
    if (syncBypassRef.current) {
      applyScenarioTaskCompletion(task, completed, refreshDetails);
      return;
    }
    if (completingTaskIds.has(taskId) || leavingTaskIds.has(taskId)) return;
    setCompletingTaskIds((current) => new Set([...current, taskId]));
    void act(completed ? "task.complete" : "task.reopen", async () => {
      try {
        await updateTaskCompletion(taskId, completed);
      } catch (value) {
        // A failed completion must restore the checkbox, not leave it spinning.
        setCompletingTaskIds((current) => { const next = new Set(current); next.delete(taskId); return next; });
        throw value;
      }
      await applyConfirmedTaskCompletion(task, completed, refreshDetails);
    });
  }

  async function requestTaskCompletion(task: TaskRow, completed: boolean, refreshDetails = false) {
    const sequence = ++taskEvidenceRequestSeq.current;
    if (!completed) { setTaskCompletion(task, false, refreshDetails); return; }
    if (syncBypassRef.current || (taskKind(task) === "subtask" && !taskRequiresCompletionEvidence(task))) { setTaskCompletion(task, true, refreshDetails); return; }
    if (carryOverOpen) setCarryOverOpen(false);
    const taskId = String(task.provider_task_id || task.id);
    const openDetails = taskDetails && String(taskDetails.task.provider_task_id || taskDetails.task.id) === taskId ? taskDetails : null;
    let savedEvidence = openDetails?.completionEvidence?.[0] ?? null;
    // An output task may already have evidence from an earlier completion
    // attempt. Read it before showing the form so recovery never asks for a
    // second upload. A simple task skips the lookup: its evidence is optional.
    if (!savedEvidence && taskRequiresCompletionEvidence(task)) {
      setCompletingTaskIds((current) => new Set([...current, taskId]));
      try {
        const details = await loadTaskDetails(taskId);
        savedEvidence = details.completionEvidence?.[0] ?? null;
      } catch {
        // Opening the form is the recovery path; a failed lookup never blocks it.
      } finally {
        setCompletingTaskIds((current) => { const next = new Set(current); next.delete(taskId); return next; });
      }
    }
    if (sequence !== taskEvidenceRequestSeq.current) return;
    setTaskEvidenceRequest({ task, mode: "complete", refreshDetails, savedEvidence });
  }

  function requestTaskEvidence(task: TaskRow) {
    taskEvidenceRequestSeq.current += 1;
    if (carryOverOpen) setCarryOverOpen(false);
    setTaskEvidenceRequest({ task, mode: "attach", refreshDetails: true });
  }

  async function completeTaskWithoutEvidence(task: TaskRow, refreshDetails: boolean): Promise<{ completed: boolean; error?: string }> {
    const taskId = String(task.provider_task_id || task.id);
    if (syncBypassRef.current) {
      applyScenarioTaskCompletion(task, true, refreshDetails);
      return { completed: true };
    }
    setBusy(true); setError("");
    setCompletingTaskIds((current) => new Set([...current, taskId]));
    try {
      await updateTaskCompletion(taskId, true);
      await applyConfirmedTaskCompletion(task, true, refreshDetails);
      notifications.success(actionSuccessMessages["task.complete"]);
      return { completed: true };
    } catch (value) {
      setCompletingTaskIds((current) => { const next = new Set(current); next.delete(taskId); return next; });
      const message = errorMessage(value, "The task could not be completed.");
      setError(message);
      diagnostics.error("ui.task.completion_failed", message, { taskId, evidence: false });
      return { completed: false, error: message };
    } finally { setBusy(false); }
  }

  async function attachTaskEvidence(request: TaskEvidenceRequest, file: File, note: string, idempotencyKey: string): Promise<TaskEvidenceAttachResult> {
    const taskId = String(request.task.provider_task_id || request.task.id);
    if (syncBypassRef.current) {
      const evidence: TaskEvidenceRecord = {
        id: `debug-evidence-${Date.now()}`,
        title: `${String(request.task.title ?? "Task")} — completion evidence`,
        note,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        createdAt: new Date().toISOString(),
        url: "",
      };
      if (request.mode === "complete") applyScenarioTaskCompletion(request.task, true, request.refreshDetails);
      else notifications.success("Evidence attached to this task.", "Evidence saved");
      return { outcome: request.mode === "complete" ? "completed" : "attached", evidence };
    }
    setBusy(true); setError("");
    try {
      const result = await uploadTaskCompletionEvidence(taskId, file, note, request.mode === "complete", idempotencyKey);
      if (result.outcome === "completed") {
        await applyConfirmedTaskCompletion(request.task, true, request.refreshDetails, result.evidence);
        notifications.success("Task complete — evidence attached.", "Task completed");
      } else if (result.outcome === "attached" && request.mode === "attach") {
        await refreshTaskDetailsFor(taskId);
        notifications.success("Evidence attached to this task.", "Evidence saved");
      } else if (result.outcome === "completion_failed") {
        await refreshTaskDetailsFor(taskId);
        diagnostics.warn("ui.task.completion_after_evidence_failed", result.error, { taskId });
      }
      return result;
    } finally { setBusy(false); }
  }

  async function retryTaskCompletionForEvidence(evidence: TaskEvidenceRecord): Promise<{ completed: boolean; error?: string }> {
    const request = taskEvidenceRequest;
    if (!request) return { completed: false, error: "The task is no longer open." };
    const taskId = String(request.task.provider_task_id || request.task.id);
    if (syncBypassRef.current) {
      applyScenarioTaskCompletion(request.task, true, request.refreshDetails);
      return { completed: true };
    }
    setBusy(true); setError("");
    try {
      await updateTaskCompletion(taskId, true);
      await applyConfirmedTaskCompletion(request.task, true, request.refreshDetails, evidence);
      notifications.success("Task complete — evidence attached.", "Task completed");
      return { completed: true };
    } catch (value) {
      const message = errorMessage(value, "The task could not be completed.");
      setError(message);
      diagnostics.error("ui.task.completion_retry_failed", message, { taskId, evidence: true });
      return { completed: false, error: message };
    } finally { setBusy(false); }
  }

  function loadTaskEvidence(evidence: TaskEvidenceRecord) {
    return apiRequestBlob(evidence.url, "Evidence file");
  }

  async function downloadTaskEvidence(evidence: TaskEvidenceRecord) {
    try {
      const blob = await apiRequestBlob(evidence.url, "Evidence file");
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = evidence.fileName || "completion-evidence";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch (value) {
      showError(value, "The evidence file could not be downloaded.", "Download unavailable");
    }
  }

  function editTask(task: TaskRow) {
    setEditRequest({ task, kind: taskKind(task) });
    setEditTitle(String(task.title ?? ""));
    setEditDescription(String(task.description ?? ""));
    setEditDueDate(taskDueDateSeed(task.due_date));
    setSubtaskMenuId(null); setMoveMenuId(null);
  }

  /** The drawer's assignment menu sends the full next set of person ids. */
  function assignTask(task: TaskRow, personIds: string[]) {
    const taskId = String(task.provider_task_id || task.id);
    if (syncBypassRef.current) {
      setTaskDetails((current) => current ? {
        ...current,
        task: {
          ...current.task,
          assignee_person_ids: personIds,
          assigned_by_person_id: visibleDay?.access?.personId ?? current.task.assigned_by_person_id,
          assignees: personIds.flatMap((id) => {
            const person = taskAssigneeOptions.find((option) => option.id === id);
            return person ? [{ personId: person.id, displayName: person.displayName, email: person.email }] : [];
          }),
        },
      } : current);
      notifications.success(actionSuccessMessages["task.update"]);
      return;
    }
    void act("task.update", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ assignee_person_ids: personIds }) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.day("details") }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskHistory() }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskDetails(taskId) }),
      ]);
      // Never resurrect a drawer the employee already closed while the request
      // was in flight.
      const refreshed = await loadTaskDetails(taskId);
      setTaskDetails((current) => current && String(current.task.provider_task_id || current.task.id) === taskId ? refreshed : current);
    });
  }

  function setTaskStatus(task: TaskRow, workflow_status: "pending" | "in_progress") {
    // Choosing the status a task already holds would write and audit a no-op;
    // a payload with no stored value is pending, the server's own default.
    if (!taskStatusWriteRequired(task, workflow_status)) return;
    const taskId = String(task.provider_task_id || task.id);
    if (syncBypassRef.current) {
      setDay((current) => current ? { ...current, tasks: current.tasks.map((row) => String(row.provider_task_id || row.id) === taskId ? { ...row, workflow_status } : row) } : current);
      setTaskDetails((current) => current && String(current.task.provider_task_id || current.task.id) === taskId
        ? { ...current, task: { ...current.task, workflow_status } }
        : current);
      return;
    }
    void act("task.update", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ workflow_status }) });
      patchTaskCaches(taskId, { workflow_status });
      setTaskDetails((current) => current && String(current.task.provider_task_id || current.task.id) === taskId
        ? { ...current, task: { ...current.task, workflow_status } }
        : current);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.day("details") }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskHistory() }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskDetails(taskId) }),
      ]);
    });
  }

  function submitTaskEdit() {
    if (!editRequest || !editTitle.trim()) return;
    // The due date is only part of the patch for an actor the server will let
    // edit this record; an empty field clears it rather than keeping the old one.
    const dueDateEditable = editRequest.task.capabilities?.canEdit === true;
    const dueDate = editDueDate.trim() ? editDueDate.trim() : null;
    const dueDatePatch = dueDateEditable ? { due_date: dueDate } : {};
    if (syncBypassRef.current) {
      const taskId = String(editRequest.task.provider_task_id || editRequest.task.id);
      const patch = (row: Record<string, any>) => String(row.provider_task_id || row.id) === taskId ? { ...row, title: editTitle.trim(), description: editDescription, ...dueDatePatch } : row;
      setDay((current) => current ? { ...current, tasks: current.tasks.map((row) => patch(row as Record<string, any>)) } : current);
      setTaskDetails((current) => current ? { ...current, task: patch(current.task), subtasks: current.subtasks.map(patch) } : current);
      setEditRequest(null);
      notifications.success(actionSuccessMessages["task.update"]);
      return;
    }
    const taskId = String(editRequest.task.provider_task_id || editRequest.task.id);
    void act("task.update", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ name: editTitle.trim(), description: editDescription, ...dueDatePatch }) });
      patchTaskCaches(taskId, { title: editTitle.trim(), description: editDescription, ...dueDatePatch });
      setEditRequest(null);
      if (taskDetails) {
        const parentId = String(taskDetails.task.provider_task_id || taskDetails.task.id);
        setTaskDetails(await loadTaskDetails(parentId));
      }
    });
  }

  function submitInlineSubtask() {
    if (!taskDetails || !subtaskTitle.trim()) return;
    if (syncBypassRef.current) {
      const subtaskId = `debug-subtask-${Date.now()}`;
      setTaskDetails((current) => current ? { ...current, subtasks: [...current.subtasks, { id: subtaskId, provider_task_id: subtaskId, title: subtaskTitle.trim(), description: subtaskDescription.trim() || "", completed: false }] } : current);
      setSubtaskTitle(""); setSubtaskDescription("");
      notifications.success(actionSuccessMessages["task.subtask_create"]);
      return;
    }
    const parentId = String(taskDetails.task.provider_task_id || taskDetails.task.id);
    void act("task.subtask_create", async () => {
      await apiRequest("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: subtaskTitle.trim(), description: subtaskDescription.trim() || undefined, parent_task_id: parentId, assignee_person_ids: [] }) });
      setSubtaskTitle(""); setSubtaskDescription(""); setTaskDetails(await loadTaskDetails(parentId));
    });
  }

  function requestTaskRemoval(task: Record<string, any>, closeParent = false, mode: "archive" | "delete" = "archive") {
    setSubtaskMenuId(null); setMoveMenuId(null); setDeleteRequest({ task, closeParent, mode });
  }

  function confirmTaskRemoval() {
    if (!deleteRequest) return;
    if (syncBypassRef.current) {
      const { task, closeParent, mode } = deleteRequest;
      const removedId = String(task.provider_task_id || task.id);
      setDay((current) => current ? { ...current, tasks: current.tasks.filter((row) => String(row.provider_task_id || row.id) !== removedId) } : current);
      setTaskDetails((current) => current ? { ...current, subtasks: current.subtasks.filter((row) => String(row.provider_task_id || row.id) !== removedId) } : current);
      if (closeParent) setTaskDetails(null);
      setDeleteRequest(null);
      notifications.success(actionSuccessMessages[mode === "delete" ? "task.delete" : "task.archive"]);
      return;
    }
    const { task, closeParent, mode } = deleteRequest;
    const taskId = String(task.provider_task_id || task.id);
    void act(mode === "delete" ? "task.delete" : "task.archive", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}?mode=${mode}`, { method: "DELETE" });
      removeTaskFromCaches(taskId);
      setDeleteRequest(null);
      if (closeParent) setTaskDetails(null);
      else if (taskDetails) setTaskDetails(await loadTaskDetails(String(taskDetails.task.provider_task_id || taskDetails.task.id)));
    });
  }

  function moveSubtask(subtask: Record<string, any>, target: Record<string, any>) {
    if (!taskDetails) return;
    if (syncBypassRef.current) {
      const movingId = String(subtask.provider_task_id || subtask.id);
      setTaskDetails((current) => current ? { ...current, subtasks: current.subtasks.filter((row) => String(row.provider_task_id || row.id) !== movingId) } : current);
      setSubtaskMenuId(null); setMoveMenuId(null);
      notifications.success(actionSuccessMessages["task.subtask_move"]);
      return;
    }
    const subtaskId = String(subtask.provider_task_id || subtask.id);
    const targetId = String(target.provider_task_id || target.id);
    const currentParentId = String(taskDetails.task.provider_task_id || taskDetails.task.id);
    void act("task.subtask_move", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(subtaskId)}`, { method: "PATCH", body: JSON.stringify({ parent_task_id: targetId }) });
      setSubtaskMenuId(null); setMoveMenuId(null);
      setTaskDetails(await loadTaskDetails(currentParentId));
    });
  }

  async function connectWorkspace(reopen = false) {
    authResolutionHandledRef.current = false;
    setConnecting(true); setError("");
    try {
      const reused = reopen ? await reopenPendingAuthentication() : false;
      if (!reused) await beginAuthentication(apiBase);
      if (!authResolutionHandledRef.current) setAwaitingApproval(true);
      notifications.info(
        reused
          ? "Finish approving this device in your browser. I’ll be here when you’re back."
          : "Sign in to WrazyOS if asked, then authorize this device.",
        "Browser opened",
      );
    } catch (value) {
      setAwaitingApproval(false);
      showError(value, "Could not open workspace sign-in.", "Sign-in could not open");
    } finally {
      setConnecting(false);
    }
  }

  function performWorktivityControl(action: WorktivityControlAction, body: Record<string, unknown> = {}, operationId?: string) {
    if (!attendanceControlsSupported) throw new Error("Use Worktivity on your Mac for clock actions. Work OS shows its confirmed status.");
    if (worktivityPending) throw new Error("A Worktivity action is waiting for confirmation. Check its status before starting another clock action.");
    return runWorktivityControl(action, body, worktivityControlTransport, {
      operationId,
      attempts: 16,
      intervalMs: 2_000,
      timeoutMs: 20_000,
      onPhase: setWorktivityControlPhase,
    }).finally(() => setWorktivityControlPhase(null));
  }

  function clockIn() {
    const shift = visibleDay?.shift;
    const now = pulseNow.getTime();
    const starts = shift ? Date.parse(shift.startsAt) : NaN;
    const ends = shift ? Date.parse(shift.endsAt) : NaN;
    const startable = Number.isFinite(starts) && now >= starts - 30 * 60_000 && now < ends;
    if (!startable) {
      setClockInConfirmation({ kind: "exception", reason: "", operationId: crypto.randomUUID() });
      return;
    }
    if (now > starts + 15 * 60_000) {
      setClockInConfirmation({ kind: "late", reason: "", operationId: crypto.randomUUID() });
      return;
    }
    if (syncBypassRef.current) { bypassAct("shift.clock_in", (base) => ({ ...base, session: { id: base.session?.id ?? "debug-local", state: "active", scheduled_starts_at: base.shift?.startsAt ?? null, scheduled_ends_at: base.shift?.endsAt ?? null, clocked_in_at: new Date().toISOString(), clocked_out_at: null, paused_seconds: 0 } as DayData["session"] })); return; }
    void act("shift.clock_in", () => performWorktivityControl("clock_in"));
  }

  function confirmClockIn() {
    if (!clockInConfirmation) return;
    if (syncBypassRef.current) {
      setClockInConfirmation(null);
      bypassAct("shift.clock_in", (base) => ({ ...base, session: { id: base.session?.id ?? "debug-local", state: "active", scheduled_starts_at: base.shift?.startsAt ?? null, scheduled_ends_at: base.shift?.endsAt ?? null, clocked_in_at: new Date().toISOString(), clocked_out_at: null, paused_seconds: 0 } as DayData["session"] }));
      return;
    }
    if (clockInConfirmation.kind === "exception" && !clockInConfirmation.reason.trim()) return;
    const confirmation = clockInConfirmation;
    setClockInConfirmation(null);
    void act("shift.clock_in", () => performWorktivityControl("clock_in", confirmation.kind === "late"
      ? { late_acknowledged: true, late_reason: confirmation.reason.trim() || undefined }
      : { exception_acknowledged: true, exception_reason: confirmation.reason.trim() }, confirmation.operationId));
  }

  /** Records the late-start reason on the active session (design.md §8). */
  async function saveLateReason(reason: string) {
    const result = await sendOrQueue("/api/work-os/me/workday", "PATCH", { action: "late_reason", reason });
    if (isQueuedResult(result)) {
      await announceQueued();
      return;
    }
    await refresh({ dayOnly: true, details: true });
    notifications.success("Your late-start reason was recorded.", "Reason saved");
  }

  function confirmClockOut() {
    const extendedAcknowledged = extendedClockOut || clockOutExtendedPrompt;
    setClockOutConfirmation(false);
    setClockOutExtendedPrompt(false);
    if (syncBypassRef.current) {
      bypassAct("shift.clock_out", (base) => ({ ...base, session: base.session ? { ...base.session, state: "clocked_out", clocked_out_at: new Date().toISOString() } : null }));
      return;
    }
    void act("shift.clock_out", () => performWorktivityControl("clock_out", { ...(extendedAcknowledged ? { extended_acknowledged: true } : {}) }));
  }

  function retryWorktivityStatus() {
    if (!worktivityPending) return;
    const pending = worktivityPending;
    void act(`shift.verify_${pending.action}`, () => retryWorktivityConfirmation(pending.action, pending.operationId, worktivityControlTransport, pending.body));
  }

  function correctMissedClockOut() {
    if (!missedClockOut || !missedClockOutAt) return;
    const timestamp = new Date(missedClockOutAt);
    if (Number.isNaN(timestamp.getTime())) return void showError("Enter a valid clock-out timestamp.", "Enter a valid clock-out timestamp.", "Invalid clock-out time");
    const correction = missedClockOut;
    setMissedClockOut(null);
    void act("shift.resolve_missed_clock_out", () => sendOrQueue("/api/work-os/me/workday", "PATCH", {
      action: "resolve_missed_clock_out", session_id: correction.sessionId,
      clocked_out_at: timestamp.toISOString(), provenance: "employee_entered", reason: missedClockOutReason.trim() || undefined,
    }));
  }

  function openGoalComposer() {
    setProgressPanel("goal");
    setProgressComposerOpen(true);
    setPendingProgressUpdate("");
    setProgressReceipt(null);
  }

  function startProgressUpdate() {
    const text = input.trim();
    if (!text) return;
    const userTurn: WorkOsConversationTurn = { id: crypto.randomUUID(), role: "user", text, createdAt: new Date().toISOString() };
    const history = [...composerHistory, userTurn];
    setComposerHistory(history);
    setPendingProgressUpdate(text);
    setProgressReceipt(null);
    setProgressPanel("update");
    setProgressComposerOpen(true);
    setInput("");
    if (syncBypassRef.current) { setInterpretation(null); setAiUnavailable("The assistant is unavailable in the offline playground."); return; }
    const taskOptions = interpretationTaskOptions();
    setInterpretation({ status: "loading", operations: [], taskOptions });
    setAiUnavailable(null);
    const traceStartedAt = Date.now();
    const trace: AvatarThinkingStage[] = [{ label: "Sending your update" }];
    setComposerThinking({ stages: [...trace], active: 0, startedAt: traceStartedAt });
    const advanceTrace = (label: string) => {
      trace.push({ label });
      setComposerThinking({ stages: [...trace], active: trace.length - 1, startedAt: traceStartedAt });
    };
    void apiRequest<{ interpretation: unknown }>("/api/work-os/me/interpret", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ input: text, planIntent: planIntent || null, today: visibleDay?.shiftDate ?? null, history: history.slice(-24).map(({ role, text: turnText }) => ({ role, text: turnText })) }),
    }).then(async (result) => {
      const review = normalizeInterpretation(result.interpretation, text, taskOptions);
      if (!review || (!review.operations.length && !review.reply)) throw new Error("The assistant couldn't map that to work yet.");
      const mutating = review.operations.map((op, index) => ({ op, index })).filter(({ op }) => isMutatingToolOp(op));
      if (mutating.length) advanceTrace("Filing proposals");
      const filing = mutating.length ? await apiRequest<{
        proposals: FiledProposalRow[];
        failures?: Array<{ client_operation_index: number; error: string }>;
      }>("/api/work-os/me/proposals", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ input_text: text, operations: mutating.map(({ op }) => ({ op: op.op, statement: op.statement, task_id: op.taskId, task_title: op.taskTitle, task_group_id: op.taskGroupId, limit: op.limit, tasks: op.tasks ?? null })) }),
      }) : { proposals: [] as FiledProposalRow[], failures: [] as Array<{ client_operation_index: number; error: string }> };
      const filedByOriginal = filedProposalGroups(filing.proposals, (clientOperationIndex) => mutating[clientOperationIndex]?.index);
      const failureByOriginal = new Map((filing.failures ?? []).map((failure) => [mutating[failure.client_operation_index]?.index, failure.error]));
      if (failureByOriginal.size) notifications.error([...failureByOriginal.values()][0]!, "Some updates could not be filed");
      const operations = review.operations.map((op, index) => {
        const failure = failureByOriginal.get(index);
        return { ...attachFiledProposals(op, filedByOriginal.get(index) ?? []), enabled: isMutatingToolOp(op) && !failure, failure };
      });
      // Read-only display tools fetch immediately — viewing tasks mutates
      // nothing, so there is nothing to approve.
      const displayResults: ToolCallResult[] = [];
      const displayOps = operations.filter(isDisplayToolOp);
      if (displayOps.length) advanceTrace("Loading task views");
      for (const op of displayOps) {
        const view = op.op === "display_overdue_tasks" ? "overdue" : "pending";
        try {
          const data = await apiRequest<{ tasks: Array<Record<string, unknown>> }>(`/api/work-os/me/tasks?view=${view}&limit=${op.limit ?? 20}`);
          displayResults.push({ op, status: "recorded", message: view === "overdue" ? "Overdue tasks loaded." : "Pending tasks loaded.", data: { provider_result: { view, tasks: data.tasks ?? [] } } });
        } catch (value) {
          displayResults.push({ op, status: "failed", message: value instanceof Error ? value.message : "The task list could not be loaded." });
        }
      }
      const reviewId = crypto.randomUUID();
      setInterpretation({ status: "ready", operations, taskOptions, reply: review.reply, results: displayResults.length ? displayResults : undefined, reviewId });
      setComposerThinking(null);
      setComposerHistory((current) => [...current, { id: reviewId, role: "assistant", text: review.reply || "Here's what I understood.", meta: filing.proposals.length ? `${filing.proposals.length} proposed update${filing.proposals.length === 1 ? "" : "s"}` : displayResults.length ? "tasks shown" : undefined, createdAt: new Date().toISOString(), operations, toolResults: displayResults.length ? displayResults : undefined }]);
      // The turn above is the record now: keeping the live interpretation too
      // would render the same reply (and cards) twice, and the persisted turn
      // is what survives a reload (design §25.11).
      setInterpretation(null);
      void sharePendingTools({ reviewId, input: text, reply: review.reply, operations, results: displayResults, taskOptions });
    }).catch((value) => {
      setInterpretation(null);
      setComposerThinking(null);
      setAiUnavailable(interpretationFallbackReason(value));
      diagnostics.info("composer.ai_fallback", value instanceof Error ? value.message : "interpretation failed", { activeView: view });
    });
  }

  function clearComposerChat() {
    setComposerHistory([]);
    composerConversationSignature.current = "";
    if (composerConversationScope) {
      void secureState.clearConversation(composerConversationScope).then(() => emit("work-os://conversation-changed", { scope: composerConversationScope })).catch(() => undefined);
      void secureState.clearPendingTools(composerConversationScope).then(() => emit("work-os://pending-tools-changed", { scope: composerConversationScope })).catch(() => undefined);
    }
    setProgressReceipt(null);
    setInterpretation(null);
    setComposerThinking(null);
    setPendingProgressUpdate("");
    setInput("");
  }

  function approveInterpretation(operations: ProposedOperation[], rejected: ProposedOperation[] = []) {
    const text = pendingProgressUpdate.trim();
    const enabled = operations.filter((op) => op.enabled);
    if (!text || (!enabled.length && !rejected.length)) return;
    const dominant: ProgressUpdateKind = enabled.some((op) => op.op === "record_blocker") ? "blocked"
      : enabled.some((op) => op.op === "complete_task") ? "completion_claim"
      : enabled.some((op) => op.op === "create_task") ? "new_task" : "material_progress";
    const close = (results?: ToolCallResult[], reviewedMessage?: string) => {
      const message = reviewedMessage ?? (enabled.length === 0
        ? `Skipped ${rejected.length} proposed action${rejected.length === 1 ? "" : "s"}. Nothing was recorded.`
        : enabled.length === 1
        ? `Recorded your update: “${enabled[0]!.statement.slice(0, 140)}”`
        : `Recorded ${enabled.length} updates on your behalf.`);
      if (results) setProgressReceipt(null);
      else setProgressReceipt({ kind: dominant, text, queued: false, message, createdAt: new Date().toISOString() });
      setComposerHistory((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: message, meta: results ? "reviewed" : "recorded", createdAt: new Date().toISOString() }]);
      setInterpretation((current) => current ? { ...current, operations: current.operations.map((op) => ({ ...op, enabled: false })), results: mergeToolResults(current.results ?? [], results ?? []) } : current);
      setPendingProgressUpdate(results ? "tool calls reviewed" : "");
    };
    if (syncBypassRef.current || (debugRef.current.enabled && !debugScenario.liveWrites)) {
      const denied = rejected.map((op): ToolCallResult => ({ op, status: "denied", message: "Skipped. This action did not run." }));
      close(denied.length ? denied : undefined);
      notifications.success(enabled.length ? `${enabled.length} update${enabled.length === 1 ? "" : "s"} saved on this device.` : "No actions were recorded.", "Offline playground");
      return;
    }
    setBusy(true); setError("");
    diagnostics.info("composer.approve", `filing ${enabled.length} operation(s)`, { activeView: view });
    (async () => {
      const [outcome, deniedResults] = await Promise.all([
        enabled.length ? fileApprovedOperations(enabled, proposalFilingTransport()) : Promise.resolve({ recorded: 0, queued: 0, processing: 0, failed: [], results: [] as ToolCallResult[] }),
        Promise.all(rejected.map(async (op): Promise<ToolCallResult> => {
          try {
            if (isBatchToolOp(op) || isPlanImportOp(op)) return await skipBatchOperation(op, proposalFilingTransport());
            if (!op.proposalId) throw new Error("This proposal is no longer available. Interpret it again before dismissing it.");
            const row = await apiRequest<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${encodeURIComponent(op.proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "reject" }), signal: AbortSignal.timeout(60_000) });
            if (row?.outcome === "rejected" || !row?.outcome) return { op, status: "denied", message: "Skipped. This action did not run." };
            if (row.outcome === "applying") return { op, status: "processing", message: "The server is still applying this action — it cannot be skipped right now." };
            return { op, status: "failed", message: row.failure_reason?.trim() || (row.outcome === "applied" ? "This action was already applied and cannot be skipped." : "This action could not be skipped.") };
          } catch (value) {
            return { op, status: "failed", message: errorMessage(value, "This action could not be skipped.") };
          }
        })),
      ]);
      if (outcome.recorded > 0 && !outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});
      const parts: string[] = [];
      if (outcome.recorded) parts.push(`Recorded ${outcome.recorded} update${outcome.recorded === 1 ? "" : "s"}`);
      if (outcome.queued) parts.push(`${outcome.queued} queued for sync`);
      if (outcome.processing) parts.push(`${outcome.processing} still processing`);
      if (outcome.failed.length) parts.push(`${outcome.failed.length} failed`);
      const skipped = deniedResults.filter((result) => result.status === "denied").length;
      const skipFailures = deniedResults.length - skipped;
      if (skipped) parts.push(`${skipped} skipped`);
      if (skipFailures) parts.push(`${skipFailures} skip failed`);
      const reviewedResults = [...outcome.results, ...deniedResults];
      close(reviewedResults, parts.join(" · ") || "No actions were recorded");
      void sharePendingTools({
        reviewId: interpretation?.reviewId ?? crypto.randomUUID(),
        input: text,
        reply: interpretation?.reply,
        operations: (interpretation?.operations ?? [...enabled, ...rejected]).map((op) => ({ ...op, enabled: false })),
        results: mergeToolResults(interpretation?.results ?? [], reviewedResults),
        taskOptions: interpretation?.taskOptions ?? [],
      });
      if (outcome.failed.length || skipFailures) {
        const firstFailure = outcome.failed[0]?.message ?? deniedResults.find((result) => result.status === "failed")?.message ?? "A review decision failed.";
        notifications.error(`${parts.join(" · ")}. First failure: ${firstFailure}`, "Some updates did not file");
      } else {
        notifications.success(parts.join(" · ") || "No actions were recorded", enabled.length ? "Updates filed" : "Review complete");
      }
      // Filed changes (new tasks, completions) only become visible once the
      // workday payload is refetched — don't make the employee refresh by hand.
      if (enabled.length) void refresh();
    })().catch((value) => {
      showError(value, "Your approved updates could not be filed.", "Filing failed");
    }).finally(() => setBusy(false));
  }

  function retryInterpretationOperation(result: ToolCallResult) {
    const op = { ...result.op, enabled: true };
    if ((!op.proposalId && !op.batchId) || busy) return;
    const review = interpretation;
    setBusy(true); setError("");
    void fileApprovedOperations([op], proposalFilingTransport(), result.createResolution ? { createResolution: result.createResolution } : undefined).then((outcome) => {
      const mergedResults = mergeToolResults(review?.results ?? [], outcome.results);
      setInterpretation((current) => current ? { ...current, results: mergeToolResults(current.results ?? [], outcome.results) } : current);
      // Mirror the normal approval path so the avatar window replaces the
      // stale failure with the retried result instead of keeping it.
      if (review) {
        void sharePendingTools({
          reviewId: interpretation?.reviewId ?? crypto.randomUUID(),
          input: pendingProgressUpdate || op.statement,
          reply: review.reply,
          operations: review.operations.map((candidate) => ({ ...candidate, enabled: false })),
          results: mergedResults,
          taskOptions: review.taskOptions,
        });
      }
      if (outcome.recorded > 0) {
        if (!outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});
        notifications.success("Recorded the retried update.", "Retry succeeded");
        void refresh();
        return;
      }
      notifications.error(outcome.failed[0]?.message ?? outcome.results[0]?.message ?? "The retry did not record.", "Retry failed");
    }).catch((value) => showError(value, "The retry could not be filed.", "Retry failed"))
      .finally(() => setBusy(false));
  }

  function turnText(turnId: string): string {
    const index = composerHistory.findIndex((turn) => turn.id === turnId);
    const before = index < 0 ? composerHistory : composerHistory.slice(0, index);
    return [...before].reverse().find((turn) => turn.role === "user")?.text ?? "tool calls reviewed";
  }

  /** Approvals for a persisted turn patch that turn in history (the avatar's
   * approveOperations does the same), so cards keep their outcome after a
   * reload without a second live copy of the turn. */
  function approveHistoryOperations(turnId: string, approved: ProposedOperation[], rejected: ProposedOperation[] = []) {
    const enabled = approved.map((op) => ({ ...op, enabled: true }));
    if (!enabled.length && !rejected.length) return;
    if (syncBypassRef.current || (debugRef.current.enabled && !debugScenario.liveWrites)) {
      const denied = rejected.map((op): ToolCallResult => ({ op, status: "denied", message: "Skipped. This action did not run." }));
      patchHistoryTurn(turnId, denied);
      notifications.success(enabled.length ? `${enabled.length} update${enabled.length === 1 ? "" : "s"} saved on this device.` : "No actions were recorded.", "Offline playground");
      return;
    }
    setBusy(true); setError("");
    diagnostics.info("composer.approve", `filing ${enabled.length} operation(s)`, { activeView: view });
    (async () => {
      const [outcome, denialResults] = await Promise.all([
        enabled.length ? fileApprovedOperations(enabled, proposalFilingTransport()) : Promise.resolve({ recorded: 0, queued: 0, processing: 0, failed: [], results: [] as ToolCallResult[] }),
        Promise.all(rejected.map(async (op): Promise<ToolCallResult> => {
          try {
            if (usesGroupedCard(op)) return await skipBatchOperation(op, proposalFilingTransport());
            if (!op.proposalId) throw new Error("This proposal is no longer available. Interpret it again before dismissing it.");
            const row = await apiRequest<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${encodeURIComponent(op.proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "reject" }), signal: AbortSignal.timeout(60_000) });
            if (row?.outcome === "rejected" || !row?.outcome) return { op, status: "denied", message: "Skipped. This action did not run." };
            if (row.outcome === "applying") return { op, status: "processing", message: "The server is still applying this action — it cannot be skipped right now." };
            return { op, status: "failed", message: row.failure_reason?.trim() || (row.outcome === "applied" ? "This action was already applied and cannot be skipped." : "This action could not be skipped.") };
          } catch (value) {
            return { op, status: "failed", message: errorMessage(value, "This action could not be skipped.") };
          }
        })),
      ]);
      if (outcome.recorded > 0 && !outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});
      patchHistoryTurn(turnId, [...outcome.results, ...denialResults]);
      const parts: string[] = [];
      if (outcome.recorded) parts.push(`Recorded ${outcome.recorded} update${outcome.recorded === 1 ? "" : "s"}`);
      if (outcome.queued) parts.push(`${outcome.queued} queued for sync`);
      if (outcome.processing) parts.push(`${outcome.processing} still processing`);
      if (outcome.failed.length) parts.push(`${outcome.failed.length} failed`);
      if (denialResults.length) parts.push(`skipped ${denialResults.length}`);
      const message = parts.length ? `${parts.join(" · ")}.` : "Nothing was recorded.";
      if (outcome.recorded > 0) {
        if (!outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});
        notifications.success(message, "Update recorded");
        void refresh();
      } else if (outcome.failed.length || denialResults.some((result) => result.status === "failed")) {
        notifications.error(message, "Some actions failed");
      }
    })().catch((value) => showError(value, "The review could not be filed.", "Review failed"))
      .finally(() => setBusy(false));
  }

  function patchHistoryTurn(turnId: string, results: ToolCallResult[]) {
    setComposerHistory((current) => current.map((turn) => turn.id === turnId
      ? { ...turn, operations: turn.operations?.map((op) => ({ ...op, enabled: false })), toolResults: mergeToolResults(turn.toolResults ?? [], results) }
      : turn));
    // Mirror the decision into the shared record so the companion window shows
    // the same outcome instead of a stale pending review.
    const turn = composerHistory.find((entry) => entry.id === turnId);
    if (turn?.operations?.length) {
      void sharePendingTools({
        reviewId: turnId,
        input: turnText(turnId),
        reply: turn.text,
        operations: turn.operations.map((op) => ({ ...op, enabled: false })),
        results: mergeToolResults(turn.toolResults ?? [], results),
        taskOptions: [],
      });
    }
  }

  function retryHistoryOperation(turnId: string, result: ToolCallResult) {
    const op = { ...result.op, enabled: true };
    if ((!op.proposalId && !op.batchId) || busy) return;
    setBusy(true); setError("");
    void fileApprovedOperations([op], proposalFilingTransport(), result.createResolution ? { createResolution: result.createResolution } : undefined).then((outcome) => {
      patchHistoryTurn(turnId, outcome.results);
      if (outcome.recorded > 0) {
        if (!outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});
        notifications.success("Recorded the retried update.", "Retry succeeded");
        void refresh();
        return;
      }
      notifications.error(outcome.failed[0]?.message ?? outcome.results[0]?.message ?? "The retry did not record.", "Retry failed");
    }).catch((value) => showError(value, "The retry could not be filed.", "Retry failed"))
      .finally(() => setBusy(false));
  }

  const loadComposerSubtasks = async (taskId: string) => {
    const details = await fetchTaskDetails(taskId);
    return (details.subtasks ?? []).map((child) => ({
      id: String(child.id),
      title: typeof child.title === "string" ? child.title : "Untitled subtask",
      completed: child.completed === true,
    }));
  };

  async function proposeSelectedTaskCompletions(tasks: Array<{ id: string; title: string }>) {
    if (!tasks.length || syncBypassRef.current) return;
    if (tasks.some((task) => !task.title.trim())) throw new Error("A selected task could not be resolved. Nothing was proposed.");
    const inputText = `Employee selected ${tasks.length} task${tasks.length === 1 ? "" : "s"} for completion.`;
    setBusy(true); setError("");
    try {
      const { proposals, failures } = await apiRequest<{
        proposals: Array<{ id: string; client_operation_index: number }>;
        failures?: Array<{ client_operation_index: number; error: string }>;
      }>("/api/work-os/me/proposals", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          input_text: inputText,
          operations: tasks.map((task) => ({ op: "complete_task", statement: `Employee confirmed completion of ${task.title}.`, task_id: task.id, task_title: task.title })),
        }),
      });
      const byIndex = new Map(proposals.map((proposal) => [proposal.client_operation_index, proposal.id]));
      const operations: ProposedOperation[] = tasks.flatMap((task, index) => byIndex.has(index)
        ? [{ op: "complete_task" as const, statement: `Employee confirmed completion of ${task.title}.`, taskId: task.id, taskTitle: task.title, proposalId: byIndex.get(index), enabled: true }]
        : []);
      const failed = (failures ?? []).map((failure) => ({ title: tasks[failure.client_operation_index]?.title, error: failure.error }));
      if (operations.length) {
        setPendingProgressUpdate(inputText);
        const reviewId = interpretation?.reviewId ?? crypto.randomUUID();
        setInterpretation((current) => current ? { ...current, operations: [...current.operations, ...operations], reviewId: current.reviewId ?? reviewId } : {
          status: "ready", operations, taskOptions: interpretationTaskOptions(), reply: "Review the selected task completions before anything changes.", reviewId,
        });
        void sharePendingTools({ reviewId, input: inputText, reply: "Review the selected task completions before anything changes.", operations, results: [], taskOptions: interpretationTaskOptions() });
      }
      if (failed.length) {
        // Some selections were stale (usually a task that left the list).
        // Refresh so those rows drop out, keep the filed proposals, and
        // surface the reason without discarding the successful ones.
        void refresh({ dayOnly: true, source: "attendance" }).catch(() => undefined);
        throw new Error(partialFilingMessage(operations.length, failed));
      }
    } finally {
      setBusy(false);
    }
  }

  function classifyProgressUpdate(kind: ProgressUpdateKind) {
    const text = pendingProgressUpdate.trim();
    if (!text) return;
    setComposerHistory((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: `Recorded “${text.slice(0, 140)}” as ${kind === "completion_claim" ? "completed work" : kind === "blocked" ? "a blocker" : kind === "new_task" ? "a new task" : "progress"}.`, meta: "recorded", createdAt: new Date().toISOString() }]);
    if (queuedInterpretationId) {
      void discardReadyInterpretation(queuedInterpretationId);
      setQueuedInterpretationId(null);
    }
    if (syncBypassRef.current) {
      const label = kind === "completion_claim" ? "completed work" : kind === "priority_change" ? "a priority change" : kind === "blocked" ? "a blocker" : kind === "new_task" ? "a new task" : "progress";
      setProgressReceipt({
        kind, text, queued: false, createdAt: new Date().toISOString(),
        message: kind === "new_task" ? `Added “${text}” to today’s tasks.` : `Recorded “${text}” as ${label} for today.`,
      });
      setPendingProgressUpdate("");
      return;
    }
    void act("check_in.classify", async () => {
      if (kind === "new_task") {
        const title = text.replace(/\s+/g, " ").slice(0, 240);
        const taskResult = await sendOrQueue("/api/work-os/me/tasks", "POST", {
          name: title,
          description: "Added from the Work OS daily composer.",
          due_date: visibleDay?.shiftDate,
          assignee_person_ids: visibleDay?.access?.personId ? [visibleDay.access.personId] : [],
        }) as { queued?: boolean; providerStatus?: string; mirrorStatus?: string };
        const updateResult = await sendOrQueue("/api/work-os/check-ins", "POST", {
          source: "desktop",
          kind: visibleDay?.prompt?.kind || "optional",
          update_kind: "unplanned_work",
          input_text: text,
        }) as { queued?: boolean };
        const queued = taskResult.queued === true || updateResult.queued === true;
        setProgressReceipt({
          kind,
          text,
          queued,
          createdAt: new Date().toISOString(),
          message: queued
            ? `“${title}” is queued as a task and workday update. It will be confirmed after reconnection.`
             : taskResult.providerStatus === "work_os_confirmed"
               ? `Added “${title}” to today’s Work OS tasks and recorded the update.`
               : taskResult.providerStatus === "nifty_confirmed"
                 ? `Added “${title}” to today’s tasks and recorded the update.`
                 : `Recorded “${title}”; task confirmation is still pending.`,
        });
      } else {
        const result = await sendOrQueue("/api/work-os/check-ins", "POST", {
          source: "desktop",
          kind: visibleDay?.prompt?.kind || "optional",
          update_kind: kind,
          input_text: text,
        }) as { queued?: boolean };
        const label = kind === "completion_claim" ? "completed work" : kind === "priority_change" ? "a priority change" : kind === "blocked" ? "a blocker" : "progress";
        setProgressReceipt({
          kind,
          text,
          queued: result.queued === true,
          createdAt: new Date().toISOString(),
          message: result.queued === true ? `“${text}” is queued as ${label} and will sync after reconnection.` : `Recorded “${text}” as ${label} for today.`,
        });
      }
      setPendingProgressUpdate("");
    });
  }

  // Boot breadcrumb: the phase a crash would leave behind, reported on the next
  // launch when the previous session never reached a clean exit. A gate that
  // failed is a phase of its own — it is a screen the employee can act on, not
  // a launch stuck before the app ever got a chance to say what happened.
  const vaultFailure = vaultGate.status === "failed" ? vaultGate.failure : null;
  const bootPhase = vaultGate.status === "pending" ? "boot:loading"
    : vaultGate.status === "failed" ? "boot:vault_failed"
      : !visibleSession ? "boot:connect_screen"
        : !visibleOnboarding ? "boot:waiting_for_data"
          : visibleOnboarding.onboardingRequired ? "boot:onboarding"
            : (visibleDay || dayLoadFailed) ? "boot:workspace_ready"
              : "boot:waiting_for_data";
  useEffect(() => {
    markBootPhase(bootPhase);
    if (bootPhase === "boot:vault_failed") {
      diagnostics.error("vault.gate.failed", "The local vault gate failed; the retry screen is up", {
        code: vaultFailure?.requiresReset ? "unlock_failed" : vaultFailure?.confirmationRequired ? "confirmation_required" : "unknown",
        message: vaultFailure?.message,
        requiresReset: vaultFailure?.requiresReset === true,
        confirmationRequired: vaultFailure?.confirmationRequired === true,
      });
    }
  }, [bootPhase, vaultFailure?.confirmationRequired, vaultFailure?.requiresReset]);

  // Prove this window is alive so the host can tell a running instance from a
  // leftover process that died without exiting, which would otherwise swallow
  // every later launch through the single-instance handoff.
  useEffect(() => {
    if (!isTauri()) return;
    return startInstanceHeartbeat(() => { void invoke("app_heartbeat").catch(() => undefined); });
  }, []);

  // A quit tears the webview down without running its unload handler, so the
  // host asks for the clean-exit breadcrumb first. Without this answer every
  // normal quit reads as a crash on the next launch.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://app-quit", () => markCleanExit()).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, []);

  // The app's own config file: created the first time from the cadence the
  // workspace reports for this person, then read back. An edit there wins over
  // the workspace on this machine, which is what the API layer reports.
  const workspaceCadence = visibleDay?.cadence;
  useEffect(() => {
    if (!isTauri() || !workspaceCadence) return;
    void loadMachineCadence({
      checkInIntervalMinutes: workspaceCadence.checkInIntervalMinutes,
      firstFollowUpMinutes: workspaceCadence.firstFollowUpMinutes,
    });
  }, [workspaceCadence?.checkInIntervalMinutes, workspaceCadence?.firstFollowUpMinutes]);

  /* The whole-workspace tour walks the pages of the branch that offers it:
   * the employee pages or the administration sections. */
  const offerWorkspaceTour = pageGuideAutoOpen && pageGuideFirstVisit && (employeeWorkspaceBranch || adminWorkspaceBranch);

  /* The global overlay layer: every branch that can show these surfaces mounts
   * this exact fragment — the employee workspace and the administration shell —
   * so a flag the scroll lock counts always has a rendered owner on screen
   * (design §9). Employee-only overlays stay in the employee return, and the
   * lock scoping below keeps them out of the admin branch. */
  const renderGlobalOverlays = () => <>
    {whatsNew && <WhatsNewModal displayVersion={displayUpdateVersion(whatsNew.version)} bullets={changelogBulletsFor(CHANGELOG_RAW, whatsNew.version)} history={changelogHistory(CHANGELOG_RAW, whatsNew.version)} onClose={() => setWhatsNew(null)} />}
    {debugPageGuide && <PageGuide view={debugPageGuide} autoOpen={pageGuideAutoOpen} developerPreview onClose={() => setDebugPageGuide(null)} onDisableAutoOpen={() => undefined} />}
    {!debugPageGuide && openPageGuide && <PageGuide view={openPageGuide} autoOpen={pageGuideAutoOpen} onClose={closeGuide} onDisableAutoOpen={disableAutoOpen} onStartTour={offerWorkspaceTour ? () => { const scope = isAdminGuideView(openPageGuide) ? "admin" : "employee"; closeGuide(); setTourScope(scope); } : undefined} />}
    {/* The tour walks the pages of the branch that offered it: the employee
        sidebar or the administration sections, each of which it navigates for
        real. It never mounts outside its own branch. */}
    {tourScope === "employee" && employeeWorkspaceBranch && <GuideTour onNavigate={navigateEmployeeGuide} onClose={() => setTourScope(null)} />}
    {tourScope === "admin" && adminWorkspaceBranch && <GuideTour pages={ADMIN_TOUR_PAGES} subject="the administration workspace" onNavigate={navigateAdminGuide} onClose={() => setTourScope(null)} />}
    {memoryOpen && <MemoryModal
      facts={memoryQuery.data?.facts ?? []}
      recent={memoryQuery.data?.recent ?? []}
      busy={memoryBusy}
      error={memoryError}
      onReview={(id, status) => void reviewMemory(id, status)}
      onForget={(id) => void forgetMemory(id)}
      onClose={() => { setMemoryOpen(false); setMemoryError(null); }}
    />}
    {profileModalOpen && visibleOnboarding && <div className="task-modal-backdrop profile-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setProfileOpen(false); }}><section className="task-modal profile-modal" role="dialog" aria-modal="true" aria-labelledby="profile-settings-title" aria-describedby="profile-settings-description"><header><div><span>Workspace settings</span><h2 id="profile-settings-title">Profile settings</h2><p id="profile-settings-description">Identity, schedule, privacy, notifications, and work context.</p></div><button type="button" aria-label="Close profile settings" onClick={() => setProfileOpen(false)}><X size={18} /></button></header><ProfileSettings data={visibleOnboarding} mode="modal" busy={busy} onSave={saveProfileSettings} onNotify={notifications.notify} /></section></div>}
  </>;

  /* The administration masthead and its workspace menu reach the same global
   * overlays the employee surfaces do: the account's own profile settings from
   * the avatar, and the bundled changelog from the menu's What's new item.
   * Both close the bell panel first — in administration that panel owns the
   * layer above the receipt stack while open, so an open panel could otherwise
   * float above the modal scrim. The menu has no installed version to name on a
   * browser preview or in the dev shell harness, so it opens the newest logged
   * release there; the desktop reports one and opens exactly that. */
  const openProfileFromAdmin = () => {
    setNotificationsOpen(false);
    setProfileOpen(true);
  };
  const openChangelogFromAdmin = () => {
    setNotificationsOpen(false);
    setWhatsNew({ version: installedVersionRaw ?? changelogHistory(CHANGELOG_RAW)[0]?.version ?? "0.0.0" });
  };

  /* The account's own settings, rendered by one shared component on both
   * surfaces: the employee Settings page and the administration shell's
   * Settings section. Only the surface-specific openers differ — whose profile
   * modal the row opens, whose tour the replay launches, and whether the
   * changelog action goes through the administration menu's fallback-aware
   * opener. */
  const renderPersonalSettings = (surface: "employee" | "admin") => (
    <PersonalSettings
      hasPersonalRecord={!!visibleOnboarding}
      adminOttoSettings={surface === "admin" && followSettingsScope ? (
        <AdminOttoSettings
          key={`admin-otto-follows:${followSettingsScope.userId}:${followSettingsScope.organizationId}`}
          scope={followSettingsScope}
          {...(adminOttoFollowFixture ? { transport: adminOttoFollowFixture.transport } : {})}
        />
      ) : undefined}
      tourScope={surface}
      onReplayTour={() => setTourScope(surface)}
      onOpenProfile={surface === "admin" ? openProfileFromAdmin : () => setProfileOpen(true)}
      autoStart={autoStart}
      onAutoStart={(value) => void toggleAutoStart(value)}
      voiceHotkeyEnabled={voiceHotkeyEnabled}
      voiceHotkeyError={voiceHotkeyError}
      onVoiceHotkey={(value) => void toggleVoiceHotkey(value)}
      recapVoice={recapVoice}
      onRecapVoice={(next) => void chooseRecapVoice(next)}
      autoCheckUpdates={autoCheckUpdates}
      onAutoCheckUpdates={(value) => void toggleAutoCheckUpdates(value)}
      updateDetail={updateRowCopy(updateRowSummary, installedVersion)}
      updateStatus={updateFlow.status}
      installedVersion={installedVersionRaw}
      onCheckForUpdates={() => void checkForUpdates()}
      onDownloadUpdate={() => void beginUpdateDownload()}
      onInstallUpdate={() => void installDownloadedUpdate()}
      onOpenWhatsNew={surface === "admin" ? openChangelogFromAdmin : (version) => setWhatsNew({ version })}
      pageGuideAutoOpen={pageGuideAutoOpen}
      onPageGuideAutoOpen={setPageGuideAutoOpen}
      textSize={textSize}
      mascotSize={mascotSize}
      onTextSize={(value) => void chooseTextSize(value)}
      onMascotSize={(value) => void chooseMascotSize(value)}
      queueCount={queueCount}
      queueAttentionCount={queueAttentionCount}
      sessionApiBase={visibleSession?.apiBase ?? ""}
      onSignOut={() => void logout()}
      memory={{
        facts: memoryQuery.data?.facts ?? [],
        loading: memoryQuery.isPending && !memoryQuery.data,
        error: !memoryQuery.data && memoryQuery.error ? errorMessage(memoryQuery.error, "Memory could not be loaded.") : null,
      }}
      onOpenMemory={() => setMemoryOpen(true)}
      onRetryMemory={() => void memoryQuery.refetch()}
      onOpenDebugger={() => void openDebugger()}
      onExportDiagnostics={() => void exportAppDiagnostics()}
      onResetOnboarding={() => void resetOnboarding()}
      busy={busy}
    />
  );

  /* Only a branch that mounts an overlay may hold the lock or trap focus for
   * it: nothing counts on the boot screens, and within a workspace branch the
   * employee-only flags count only where they render (design §9). */
  const modalOpen = (adminWorkspaceBranch || employeeWorkspaceBranch) && overlayScrollLockActive(employeeWorkspaceBranch, { global: globalOverlaysOpen, employeeOnly: employeeOnlyOverlaysOpen });
  useModalScrollLock(modalOpen);

  useEffect(() => {
    if (!modalOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      const dialog = dialogs.item(dialogs.length - 1);
      if (!dialog || dialog.contains(document.activeElement)) return;
      dialog.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (moveMenuFocus(event)) return;
      const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]');
      const dialog = dialogs.item(dialogs.length - 1);
      if (!dialog) return;
      if (event.key === "Escape") { event.preventDefault(); dismissTopLayer(); return; }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((item) => item.offsetParent !== null);
      if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dismissTopLayer, modalOpen]);

  if (landing === "vault_failed") {
    // The seam decides the surface; the gate's own state carries the failure.
    const vaultFailure = vaultGate.status === "failed" ? vaultGate.failure : null;
    return <LoadingScreen
      failed
      retry={retryVaultGate}
      note={vaultFailure?.message}
      onReset={vaultFailure?.requiresReset ? startFreshOnThisDevice : undefined}
      onDebug={() => void openDebugger()}
    />;
  }
  const renderConnect = () => <ConnectScreen notice={connectNotice} apiBase={apiBase} setApiBase={setApiBase} connecting={connecting} awaiting={awaitingApproval} onConnect={() => void connectWorkspace(awaitingApproval)} onSave={async () => { try { await secureState.saveSettings({ apiBase }); authResolutionHandledRef.current = true; await discardPendingAuthentication(); setAwaitingApproval(false); notifications.success("The server address was saved.", "Settings saved"); } catch (value) { showError(value, "The server address could not be saved.", "Settings not saved"); } }} />;
  const renderOnboarding = () => visibleOnboarding ? <Onboarding data={visibleOnboarding} simulated={debugScenario.enabled} busy={busy} onNotify={notifications.notify} onOpenDebug={() => void openDebugger()} onLogout={() => void logout()} onComplete={async () => { notifications.success("Your workspace setup is complete.", "Welcome to Work OS"); await refresh(); }} onSaveDraft={async (body) => { if (debugScenario.enabled) return visibleOnboarding ?? undefined; const next = await sendOrQueue("/api/work-os/me/onboarding", "PUT", body); if ((next as { queued?: boolean }).queued) { setQueueCount((await secureState.queue()).length); return { queued: true }; } const onboarding = next as OnboardingData; queryClient.setQueryData(workOsKeys.onboarding(), onboarding); setOnboarding(onboarding); return onboarding; }} onSubmit={async (body) => { if (debugScenario.enabled) { setScenario({ ...debugScenario, onboardingState: "complete", missingDetails: [] }); return visibleDay?.attendance; } const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "POST", headers: { "Idempotency-Key": String(body.clientMutationKey ?? "") }, body: JSON.stringify(body) }); queryClient.setQueryData(workOsKeys.onboarding(), next); setOnboarding(next); const result = await apiRequest<{ attendance?: DayData["attendance"] }>("/api/work-os/me/workday"); return result.attendance; }} /> : null;

  /*
   * Administration sits below setup, and that order is the contract: see
   * bootSurface. Until this moved, an administrator on a fresh device landed
   * here first and never completed onboarding, so the account went on reporting
   * that setup was required for the rest of its life.
   *
   * The dev-only `?admin-shell` fixture boots without a vault session, so the
   * fabricated admin session stands in for one (see adminShell.ts); the global
   * overlay layer mounts on this branch too, so a counted flag always has a
   * rendered owner here (design §9).
   */
  const renderAdmin = () => {
    // The administration branch only renders with a session; the seam's string
    // cannot narrow that for TypeScript.
    if (!workSessionQuery.data) return null;
    /* The administration masthead's bell is the same surface the employee
     * masthead mounts, reading the signed-in account's own notifications. The
     * loading/error pins exist only in the dev-only shell harness, which has no
     * backend to answer the bell's reads (see adminShell.ts). */
    const adminNotifications: AdminNotifications = {
      memoryCandidates: memoryCandidateCount,
      recap: recapSummary,
      overdueTasks: overdueTaskCount,
      days: outstandingQuery.data?.days ?? [],
      loading: ADMIN_SHELL_NOTIFICATIONS === "loading" || (outstandingQuery.isFetching && !outstandingQuery.data),
      error: ADMIN_SHELL_NOTIFICATIONS === "error"
        ? "Outstanding EODs could not be loaded."
        : outstandingQuery.error ? errorMessage(outstandingQuery.error, "Outstanding EODs could not be loaded.") : null,
      open: notificationsOpen,
      onToggle: () => {
        const next = !notificationsOpen;
        setNotificationsOpen(next);
        // The harness has no backend to refetch from; the live path re-reads
        // the outstanding days whenever the panel opens.
        if (next && !ADMIN_SHELL_BOOT) void outstandingQuery.refetch();
      },
      onClose: () => setNotificationsOpen(false),
      onSelect: openEodDayInEmployeeView,
      onOpenMemory: () => { setNotificationsOpen(false); setMemoryOpen(true); },
      onOpenRecap: openRecapInEmployeeView,
      onOpenOverdue: openOverdueInEmployeeView,
      onRetry: () => void outstandingQuery.refetch(),
    };
    const openAdminOtto = () => openAdminOttoSurface({ newChat: true });
    return <>
      <AdminWorkspace
        session={workSessionQuery.data}
        notifications={personalNotificationReadsEnabled ? adminNotifications : null}
        section={adminSection}
        focus={adminFocus}
        onNavigate={navigateAdmin}
        guideView={pageGuideView}
        onOpenGuide={openGuide}
        onNewChat={openAdminOtto}
        ottoNotice={adminContextState?.status === "failed"
          ? "Admin Otto could not load its administration context. Retry from New chat; the workspace record remains available."
          : adminContextState?.status === "loading"
            ? "Loading the administration context…"
            : null}
        personalSettings={renderPersonalSettings("admin")}
        profile={visibleOnboarding ? { name: visibleOnboarding.profile.displayName, avatarUrl: visibleOnboarding.profile.avatarUrl, onOpen: openProfileFromAdmin } : null}
        onOpenWhatsNew={openChangelogFromAdmin}
        onSwitchToEmployee={adminOttoBootstrap.switchToEmployeeAvailable ? () => setWorkspaceMode("employee") : undefined}
        onSignOut={() => { void logout(); }}
      />
      {adminOttoEntryOpen && (adminOttoContextQuery.data || ADMIN_SHELL_BOOT) ? (
        <AdminOttoChat
          key={`${JSON.stringify(adminOttoContextQuery.data?.scope ?? ADMIN_SHELL_SESSION.userId)}:${adminOttoInitialTab}:${adminOttoRequestedRecap?.intervalId ?? "none"}:${adminOttoEpoch}`}
          scope={adminOttoContextQuery.data?.scope ?? {
            userId: ADMIN_SHELL_SESSION.userId,
            organizationId: ADMIN_SHELL_SESSION.organizationId,
            mode: "admin",
          }}
          conversationId={adminOttoConversationId}
          initialTab={adminOttoInitialTab}
          initialRecap={adminOttoRequestedRecap}
          arrival={adminOttoArrival}
          arrivalRevision={adminOttoArrivalRevision}
          followRevision={adminOttoFollowRevision}
          playback={adminAudio.playback}
          recapUpdates={adminAudio.recapUpdates}
          initialDraft={adminOttoDraft}
          initialRequestId={adminOttoRetryRequestId.current}
          resetToken={adminOttoResetToken}
          onRecoveryChange={rememberAdminOttoRecovery}
          onListen={(recap) => void adminAudio.listen(recap)}
          onStopListening={adminAudio.stop}
          onOpenRecord={openAdminRecord}
          transcriptionEnabled={ADMIN_SHELL_BOOT || adminOttoContextQuery.data?.transcriptionAvailable === true}
          audioEpoch={adminOttoEpoch}
          transcribe={ADMIN_SHELL_BOOT
            ? async () => ({ text: "This local fixture has no microphone transcription; the draft was not sent." })
            : (clip, _mime, language) => transcribeAdminOttoAudio(clip, language)}
          transport={ADMIN_SHELL_BOOT ? {
            ...ADMIN_FIXTURE_TRANSPORT,
            inbox: async (input) => fixtureInboxPage({
              count: ADMIN_SHELL_OTTO === "empty" ? 0 : 2,
              total: ADMIN_SHELL_OTTO === "empty" ? 0 : ADMIN_SHELL_OTTO === "multiple" ? 25 : 2,
              nextCursor: ADMIN_SHELL_OTTO === "multiple" && !input?.cursor ? "fixture-next-page" : null,
              unread: ADMIN_SHELL_OTTO === "empty" ? 0 : 2,
              offset: input?.cursor ? 2 : 0,
            }),
          } : undefined}
          previewOnly={false}
          onArrivalSeen={() => {
            notifications.clearPersistent("admin-otto-recap-arrival");
            setAdminOttoArrival(null);
          }}
          onConversation={handleAdminOttoConversation}
          onClose={() => { adminAudio.stop(); setAdminOttoEntryOpen(false); }}
        />
      ) : null}
      {renderGlobalOverlays()}
    </>;
  };

  const renderWorkspace = () => {
  // The seam's string cannot narrow the data for TypeScript; this branch only
  // renders with a session and a loaded onboarding record.
  if (!visibleSession || !visibleOnboarding) return null;
  const dockVisible = view === "day" || (view === "tasks" && planHistoryDate === visibleDay?.shiftDate);
  const startNewChat = () => {
    clearComposerChat();
    setView("day");
    setInput("");
    setProgressPanel("update");
    setProgressComposerOpen(true);
    setPendingProgressUpdate("");
    setProgressReceipt(null);
    setInterpretation(null);
    setAiUnavailable(null);
    setComposerThinking(null);
  };
  return <div className={`workspace${bootRise ? " boot-rise" : ""}`}>
    <SidebarNav
      activeView={view}
      onNavigate={(nextView) => setView(nextView)}
      onNewChat={startNewChat}
      onSignOut={() => { void logout(); }}
      onSwitchWorkspace={workSessionQuery.data?.role === "admin" ? () => setWorkspaceMode("admin") : undefined}
      switchLabel="Open administration"
    />
    <section className={`stage${dockVisible ? " has-dock" : ""}`}>
      <header className="masthead"><div><p>{formatWorkOsDate(visibleDay?.shiftDate)}</p><div className="masthead-title-row"><h1>{views.find((item) => item.id === view)?.label}</h1>{lateReasonMissing && <button type="button" className="late-attention-pill" onClick={() => openPlanningSession()} aria-label="This workday started 30 or more minutes late. Open the focus editor to record the reason."><AlertTriangle size={12} />Late start — add a reason</button>}{view === "review" && outstandingDays.length > 0 && <button type="button" className="eod-attention-pill" onClick={() => setNotificationsOpen(true)} aria-label={`${outstandingDays.length} prior EOD${outstandingDays.length === 1 ? "" : "s"} need attention. Open the outstanding list.`}><AlertTriangle size={12} />{outstandingDays.length} prior EOD{outstandingDays.length === 1 ? "" : "s"} need{outstandingDays.length === 1 ? "s" : ""} attention</button>}</div></div><div className="mast-actions">{pageGuideView && <button className="icon guide-launch" title={`How ${pageGuideLabel} works`} aria-label={`How ${pageGuideLabel} works`} onClick={() => openGuide(pageGuideView)}><CircleHelp size={17} /></button>}{view === "tasks" && visibleDay?.shiftDate && <TaskDateNavigator currentDate={visibleDay.shiftDate} selectedDate={planHistoryDate || visibleDay.shiftDate} onDate={loadPlanHistory} />}{workSessionQuery.data?.role === "admin" && <button type="button" className="admin-switch-ghost" title="Open the administration workspace" onClick={() => setWorkspaceMode("admin")}><LayoutDashboard size={15} aria-hidden />Administration</button>}{signedIn && !syncBypass && <NotificationsBell
        memoryCandidates={memoryCandidateCount}
        recap={recapSummary}
        overdueTasks={overdueTaskCount}
        days={outstandingQuery.data?.days ?? []}
        loading={outstandingQuery.isFetching && !outstandingQuery.data}
        error={outstandingQuery.error ? errorMessage(outstandingQuery.error, "Outstanding EODs could not be loaded.") : null}
        open={notificationsOpen}
        onToggle={() => { const next = !notificationsOpen; setNotificationsOpen(next); if (next) void outstandingQuery.refetch(); }}
        onClose={() => setNotificationsOpen(false)}
        onSelect={(day: OutstandingEodDay) => { setNotificationsOpen(false); setEodLanding(false); setEodDate(day.date); setView("review"); }}
        onOpenMemory={() => { setNotificationsOpen(false); setMemoryOpen(true); }}
        onOpenRecap={() => { setNotificationsOpen(false); openGoalComposer(); }}
        onOpenOverdue={openOverdueTasks}
        onRetry={() => void outstandingQuery.refetch()}
      />}<button className="icon" title="Refresh this page" disabled={refreshing} onClick={() => void refreshActiveView()}>{refreshing ? <FadeArc size={17} /> : <RefreshCw size={17} />}</button><button className="avatar" aria-label={`Profile for ${visibleOnboarding.profile.displayName}`} title="Open profile settings" onClick={() => setProfileOpen(true)}><ProfileAvatar name={visibleOnboarding.profile.displayName} avatarUrl={visibleOnboarding.profile.avatarUrl} /></button></div></header>
      {debugScenario.enabled && <div className="notice debug"><Bug size={15} /> {syncBypass ? "Offline playground — the backend is never contacted and changes stay on this device." : debugScenario.liveWrites ? "Scenario mode — filing real updates against the connected server." : "Scenario mode is active. Writes are disabled."}<button onClick={() => setScenario(DEFAULT_DEBUG_SCENARIO)}>Reset</button></div>}
      {worktivityPending && <WorktivityControlNotice state={{ status: "pending", message: worktivityPending.message }} busy={busy} onCheckStatus={retryWorktivityStatus} />}
      {!worktivityPending && worktivityControlPhase && <WorktivityControlNotice state={{ status: "starting", phase: worktivityControlPhase }} />}
      {view === "day" && (!visibleDay ? <DashboardSkeleton /> : !active ? <OffShiftDashboard
        onStatusTask={setTaskStatus}
        onAssignTask={(task) => void openTaskDetails(task)}
        onEditTask={editTask}
        onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")}
        onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")}
        model={dashboardModel}
        tasks={visibleTodayTasks}
        currentDate={visibleDay.shiftDate}
        busy={busy}
        attendanceControlsSupported={attendanceControlsSupported}
        canClockIn={attendanceControlsSupported && gate.canClockIn && !worktivityPending}
        goalSaveState={planSaveState}
        onClockIn={clockIn}
        onOpenTasks={(nextView = "today") => { setTaskView(nextView); setView("tasks"); }}
        onOpenCarryover={() => { setCarryOverOpen(true); setView("tasks"); }}
        onOpenFocus={openGoalComposer}
        onOpenTask={(task) => void openTaskDetails(task)}
        onToggleTask={requestTaskCompletion}
        taskFlight={taskFlight}
        onRetryPendingTask={retryPendingTask}
        onDismissPendingTask={dismissPendingTask}
      /> : <ActiveWorkdayDashboard
        onStatusTask={setTaskStatus}
        onAssignTask={(task) => void openTaskDetails(task)}
        onEditTask={editTask}
        onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")}
        onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")}
        model={dashboardModel}
        tasks={visibleTodayTasks}
        previousTasks={unfinishedCarryOver.filter((item) => item.attribution.date === moveDate(visibleDay.shiftDate, -1)).map((item) => item.task)}
        otherTasks={unfinishedCarryOver.filter((item) => !!item.attribution.date && item.attribution.date < moveDate(visibleDay.shiftDate, -1)).map((item) => item.task)}
        currentDate={visibleDay.shiftDate}
        busy={busy || !!worktivityPending || !!worktivityControlPhase}
        attendanceControlsSupported={attendanceControlsSupported}
        canPause={canControlWorktivity}
        canClockOut={canControlWorktivity}
        observedOnly={observedOnly}
        goalSaveState={planSaveState}
        onRetryGoalSave={() => setPlanDirty(true)}
        onOpenTasks={(nextView = "today") => { setTaskView(nextView); setView("tasks"); }}
        onOpenCarryover={() => { setCarryOverOpen(true); setTaskView("unfinished"); setView("tasks"); }}
        onOpenFocus={openPlanningSession}
        onOpenTask={(task) => void openTaskDetails(task)}
        onToggleTask={requestTaskCompletion}
        onPause={() => {
          if (syncBypassRef.current) { bypassAct("shift.pause_toggle", (base) => ({ ...base, session: base.session ? { ...base.session, state: paused ? "active" as const : "paused" as const, paused_seconds: paused ? base.session.paused_seconds : (base.session.paused_seconds ?? 0) + 900 } : null })); return; }
          void act("shift.pause_toggle", () => performWorktivityControl(paused ? "resume" : "pause"));
        }}
        onClockOut={() => { setClockOutExtendedPrompt(false); setClockOutConfirmation(true); }}
        onAddTask={() => void openTaskComposer()}
        taskFlight={taskFlight}
        onRetryPendingTask={retryPendingTask}
        onDismissPendingTask={dismissPendingTask}
      />)}
      {false && view === "day" && visibleDay && (!active ? <main className="day-grid off-shift-day">
        <section className="hero-card">
          <div className="hero-copy"><span className="kicker">{gate.worktivitySynced ? "Worktivity connected" : "Ready when you are"}</span><h2>{gate.worktivitySynced ? "Ready to start." : "Ready when Worktivity is."}</h2><p>{visibleDay?.shift ? `Scheduled ${formatTime(visibleDay?.shift?.startsAt, visibleDay?.shift?.timezone)}–${formatTime(visibleDay?.shift?.endsAt, visibleDay?.shift?.timezone)}.` : "Worktivity will start a synchronized workday when activity begins."}</p>
            <div className="hero-actions"><button className="primary" disabled={busy || !gate.canClockIn} onClick={clockIn}><CirclePlay size={17} /> Clock in</button></div>
            {visibleDay?.attendance && <small className="attendance-context">Observed context: {visibleDay?.attendance?.message}</small>}
            <div className="hero-focus-line"><small>Today’s focus</small><button onClick={openGoalComposer} aria-label="Update today’s focus"><span>{planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}</span></button>{planSaveState === "saving" ? <FadeArc size={13} /> : planSaveState === "offline" || planSaveState === "conflict" ? <button type="button" className="goal-retry" title={planSaveState === "conflict" ? "Goal not saved — refresh the day, then retry." : "Goal not saved — click to retry."} aria-label="Retry saving the goal" onClick={() => setPlanDirty(true)}><RefreshCw size={13} /></button> : null}<em>{planIntent ? goalProvenance === "suggested" ? `Suggested by ${MASCOT.name} · tap to update` : goalProvenance === "ai_draft" ? `Drafted with ${MASCOT.name} · tap to update` : goalProvenance === "accepted_suggestion" ? "Derived from your tasks · tap to update" : "Written by you · tap to update" : goalSuggestion ? "Suggested from your tasks" : "Task record · tap to set a focus"}</em></div>
          </div><div className="hero-companion-art"><MascotPet workday="off-shift" className="mascot-hero" artClassName="mascot-hero-art" /></div>
        </section>
        <ShiftPulseCard pulse={pulse} now={pulseNow} shift={visibleDay?.shift ?? null} active={active} attendance={visibleDay?.attendance ?? null} />
        <KpiStrip scheduledCount={visibleTodayTasks.length} yesterdayDueCount={yesterdayDueTasks.length} completedCount={todayCompletedCount} onScheduled={() => { setTaskView("today"); setView("tasks"); }} onYesterday={() => { setCarryOverOpen(true); setView("tasks"); }} onCompleted={() => { setTaskView("completed"); setView("tasks"); }} />
                <section className="panel dashboard-tasks-card">
          <div className="card-title"><span><BriefcaseBusiness size={17} /> Today’s tasks</span><button onClick={() => { setTaskView("today"); setView("tasks"); }}>View all <ChevronRight size={14} /></button></div>
          {dashboardTopTasks.length ? <div className="dashboard-task-grid" ref={dashboardGridRef}>{dashboardTopTasks.map((task) => { const taskId = String(task.provider_task_id || task.id); return <DashboardTaskCard key={taskId} task={task} currentDate={visibleDay?.shiftDate ?? ""} flight={taskFlight.get(taskId) ?? null} onComplete={() => setTaskCompletion(task, true)} onOpen={() => void openTaskDetails(task)} onRetryPendingTask={retryPendingTask} onDismissPendingTask={dismissPendingTask} />; })}</div> : <div className="dashboard-task-empty"><strong>{yesterdayDueTasks.length ? "Nothing scheduled yet" : "Your agenda is open"}</strong><span>{yesterdayDueTasks.length ? "Review unfinished work or add today’s first priority." : "Add your first priority — the composer below plans without clocking you in."}</span></div>}
        </section>
      </main> : <ActiveDayWorkspace
        focus={planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}
        focusSource={planIntent ? goalProvenance === "suggested" ? `Suggested by ${MASCOT.name}` : goalProvenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : goalProvenance === "accepted_suggestion" ? "Derived from today’s tasks" : "Your focus note" : goalSuggestion ? "Suggested from today’s tasks" : "Task record"}
        tasks={visibleTodayTasks}
        goalSaveState={planSaveState}
        onRetryGoalSave={() => setPlanDirty(true)}
        onRetryPendingTask={retryPendingTask}
        onDismissPendingTask={dismissPendingTask}
        previousTasks={unfinishedCarryOver.filter((item) => item.attribution.date === moveDate(visibleDay?.shiftDate ?? "", -1)).map((item) => item.task)}
        otherTasks={unfinishedCarryOver.filter((item) => !!item.attribution.date && item.attribution.date < moveDate(visibleDay?.shiftDate ?? "", -1)).map((item) => item.task)}
        elapsed={observedOnly ? pulse.observedElapsedLabel : pulse.elapsedLabel}
        progressPercent={pulse.progressPercent}
        shiftStart={formatTime(visibleDay?.shift?.startsAt, visibleDay?.shift?.timezone)}
        shiftEnd={formatTime(visibleDay?.shift?.endsAt, visibleDay?.shift?.timezone)}
        remaining={timeRemaining(visibleDay?.shift?.endsAt)}
        timezone={visibleDay?.shift?.timezone}
        attendance={visibleDay?.attendance}
        providerBreakSeconds={workSession?.provider_break_seconds ?? visibleDay?.attendance?.providerBreakSeconds ?? 0}
        paused={paused}
        busy={busy}
        observedOnly={observedOnly}
        canPause={canControlWorktivity && !worktivityPending}
        canClockOut={canControlWorktivity && !worktivityPending}
        onEditFocus={openPlanningSession}
        onAddTask={() => void openTaskComposer()}
        onManageTasks={() => setView("tasks")} onOpenOverdue={openOverdueTasks} currentDate={visibleDay?.shiftDate ?? ""}
        onOpenTask={(task) => void openTaskDetails(task)}
        onToggleTask={requestTaskCompletion}
        taskFlight={taskFlight}
        onEditTask={editTask}
        onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")}
        onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")}
        onStatusTask={setTaskStatus}
        onAssignTask={(task) => void openTaskDetails(task)}
        onPause={() => {
          if (syncBypassRef.current) { bypassAct("shift.pause_toggle", (base) => ({ ...base, session: base.session ? { ...base.session, state: paused ? "active" : "paused", paused_seconds: paused ? base.session.paused_seconds : (base.session.paused_seconds ?? 0) + 900 } : null })); return; }
          void act("shift.pause_toggle", () => performWorktivityControl(paused ? "resume" : "pause"));
        }}
        onClockOut={() => { setClockOutExtendedPrompt(false); setClockOutConfirmation(true); }}
        kpiStrip={<KpiStrip scheduledCount={visibleTodayTasks.length} yesterdayDueCount={yesterdayDueTasks.length} completedCount={todayCompletedCount} onScheduled={() => { setTaskView("today"); setView("tasks"); }} onYesterday={() => { setCarryOverOpen(true); setView("tasks"); }} onCompleted={() => { setTaskView("completed"); setView("tasks"); }} />}
      />)}
      {view === "tasks" && <TasksWorkspace
        currentDate={visibleDay?.shiftDate ?? ""}
        historyDate={planHistoryDate}
        backlog={backlogQuery.data ?? null}
        backlogLoading={backlogQuery.isLoading}
        backlogError={backlogQuery.isError}
        currentPlan={visibleDay?.plan ?? null}
        historicalPlan={historicalPlan}
        historicalTasks={selectedTaskDateIsHistorical
          ? todayTaskHistoryQuery.data?.pages.flatMap((page) => page.tasks) ?? []
          : historicalTasks}
        goal={planIntent}
        goalProvenance={goalProvenance}
        suggestion={goalSuggestion}
        saveState={planSaveState}
        taskView={taskView}
        taskSort={taskWorkspaceSort}
        todayTasks={syncBypass
          ? visibleTodayTasks
          : todayTaskHistoryQuery.data
            ? uniqueTasks([
              ...todayTaskHistoryQuery.data.pages.flatMap((page) => page.tasks),
              ...visibleTodayTasks.filter((task) => !!task.pending_status),
            ])
            : uniqueTasks([
              ...(!taskSearchQuery && !taskFilterFrom && !taskFilterTo ? visibleTodayTasks : []),
              ...visibleTodayTasks.filter((task) => !!task.pending_status),
            ])}
        taskHistory={taskHistory}
        workspaceHistory={workspaceTaskHistory}
        completedHistory={completedTaskHistory}
        unfinishedHistory={unfinishedTaskHistory}
        pageCounts={syncBypass ? null : activeTaskHistoryQuery.data?.pages[0]?.counts ?? null}
        pageTotal={syncBypass ? null : activeTaskHistoryQuery.data?.pages[0]?.totalCount ?? null}
        taskSearch={taskSearch}
        filterFrom={taskFilterFrom}
        filterTo={taskFilterTo}
        historyOrder={syncBypass ? "local" : "server"}
        historyError={!syncBypass && activeTaskHistoryQuery.isError}
        historyHasData={Boolean(activeTaskHistoryQuery.data)}
        onRetryHistory={() => void activeTaskHistoryQuery.refetch()}
        carryOver={unfinishedCarryOver}
        carryOverOpen={carryOverOpen}
        loadingMore={activeTaskHistoryQuery.isFetchingNextPage}
        loadMoreError={activeTaskHistoryQuery.isFetchNextPageError}
        hasMore={!!activeTaskHistoryQuery.hasNextPage}
        busy={busy}
        loading={tasksInitialLoading}
        onTaskView={setTaskView}
        onTaskSort={setTaskWorkspaceSort}
        onTaskSearch={setTaskSearch}
        onFilterFrom={setTaskFilterFrom}
        onFilterTo={setTaskFilterTo}
        onDate={loadPlanHistory}
        onEditFocus={openPlanningSession}
        onAddTask={() => void openTaskComposer()}
        onOpenTask={(task, readOnly) => void openTaskDetails(task, readOnly)}
        onEditTask={editTask}
        onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")}
        onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")}
        onStatusTask={setTaskStatus}
        onAssignTask={(task) => void openTaskDetails(task)}
        onSurfaceTask={surfaceTask}
        onTaskCompletion={requestTaskCompletion}
        taskFlight={taskFlight}
        onCarryOverOpen={setCarryOverOpen}
        onLoadMore={() => void loadMoreTasks()}
        onRetryPendingTask={retryPendingTask}
        onDismissPendingTask={dismissPendingTask}
        onRetryGoalSave={() => setPlanDirty(true)}
      />}
      {view === "review" && <main className="page">
        {eodDate && !eodSubmitted && <div className="eod-day-context"><button type="button" onClick={() => setEodDate(null)}><ArrowLeft size={14} /> Back to today</button><span>EOD for {formatWorkOsDate(eodDate)}.</span></div>}
        {eodDate && reportDayQuery.isLoading ? <EodLoadingState title="Loading that day…" detail={`Fetching the recorded work for ${formatWorkOsDate(eodDate)}.`} />
          : eodDate && reportDayQuery.error ? <section className="panel"><Empty title="That day could not be loaded" body="The day's recorded work is unavailable right now. Check your connection and try again." /><div className="today-actions"><button onClick={() => void reportDayQuery.refetch()}>Try again</button></div></section>
            : eodGate && !eodSubmitted ? <section className="panel"><Empty
                title={eodGate.gate === "no_tasks" ? "No tasks submitted for this day" : "No work activity recorded"}
                body={eodGate.detail}
              /><div className="today-actions"><button onClick={() => setView("tasks")}>Open Tasks <ChevronRight size={14} /></button><button onClick={() => { setEodGate(null); void redraftEod(reviewDay); }}>{eodRedrafting ? "Checking…" : "Try again"}</button></div></section>
              : eodPreparing && !eodDraft ? <EodLoadingState
                title="Preparing Worktivity analysis…"
                detail={`Checking ${eodDate ? "that day’s" : "today’s"} screenshots.`}
                progress={eodPreparing.pending == null
                  ? null
                  : `${eodPreparing.analyzed} of ${eodPreparing.total} frames analyzed${eodPreparing.pending > 0 ? ` — ${eodPreparing.pending} still analyzing` : ""}.`}
                onDraftAnyway={draftEodAnyway}
              />
                : reviewDay?.report && !eodSubmitted && eodRedrafting && !eodDraft ? <EodLoadingState title="Drafting your EOD…" detail={`Checking ${eodDate ? "that day’s" : "today’s"} recorded work and writing a draft for you to review.`} />
                : reviewDay?.report && !eodSubmitted && !eodLanding && (!eodRedrafting || eodDraft) ? <EodComposer
                    initialMarkdown={eodDraft?.markdown ?? String(reviewDay.report.markdown ?? "")}
                    source={eodDraft?.source ?? "deterministic"}
                    dayLabel={eodDate ? formatWorkOsDate(eodDate) : "today"}
                    redrafting={eodRedrafting}
                    clockedOut={eodClockedOut}
                    screenshotContext={eodDraft?.screenshots ?? null}
                    screenshotGallery={screenshotGalleryQuery.data ?? null}
                    screenshotSyncUnavailable={eodDraft?.screenshotSyncUnavailable === true}
                    screenshotNotice={eodScreenshotNotice}
                    preparing={eodPreparing}
                    onDraftAnyway={draftEodAnyway}
                    loomEnabled={visibleDay?.access?.featureFlags?.loom_updates === true}
                    loomAttached={eodDraft?.loom ?? null}
                    onLoomPreview={(url) => previewLoomLink(url, reviewDay?.shiftDate)}
                    onLoomDraft={draftEodWithLoom}
                    busy={busy}
                    onRedraft={() => void redraftEod(reviewDay)}
                    onRefresh={reviewDay.report.status === "draft" || reviewDay.report.status === "rejected" ? () => void createEodDraft(reviewDay) : undefined}
                    onDelete={["draft", "rejected"].includes(String(reviewDay.report.status)) && !reviewDay.report.submitted_at ? () => setEodDeleteConfirmation(true) : undefined}
                    shiftOpen={reviewShiftOpen}
                    onOpenDashboard={() => setView("day")}
                    onRefine={(markdown, feedback, annotations) => refineEod(reviewDay, markdown, feedback, annotations)}
                    onSubmit={(markdown, idempotencyKey) => submitEod(reviewDay, markdown, idempotencyKey)}
                  />
                  : eodSubmitted ? <section className="panel eod-submitted" role="status">
                      <div className="eod-submitted-head"><button type="button" className="quiet-action" onClick={() => { setEodSubmitted(false); setEodDate(null); setEodLanding(true); }}><ArrowLeft size={14} aria-hidden="true" /> All EODs</button></div>
                      <CheckedMoment />
                      <strong>EOD submitted</strong>
                      <p>{eodQueued ? "Queued on this device — your report will be sent when the connection returns." : eodDate ? `Your report for ${formatWorkOsDate(eodDate)} is with your manager.` : "Your report is with your manager. You are done for today."}</p>
                    </section>
                    : eodLanding || !reviewDay?.report ? <section className="panel eod-start">
                        <header className="eod-start-head">
                          <FileCheck2 size={20} />
                          <div>
                            <h2>{eodDate ? `Draft the EOD for ${formatWorkOsDate(eodDate)}` : "Prepare today’s EOD"}</h2>
                            <p>{eodDate ? "Build the report from that day’s recorded work, review every line, then submit it. Drafting does not submit anything." : "Build the report from today’s recorded work, review every line, then submit it. Drafting does not submit anything."}</p>
                          </div>
                        </header>
                        {!eodDate && outstandingDays.length > 0 ? <section className="eod-start-earlier" aria-label="Earlier days without a submitted EOD">
                          <header><strong>Earlier days</strong><small>{outstandingDays.length} still need an EOD</small></header>
                          <ul>{outstandingDays.slice(0, 5).map((day) => {
                            const status = OUTSTANDING_STATUS_META[day.status];
                            return <li key={day.date}><button type="button" onClick={() => { setEodLanding(false); setEodDate(day.date); }}>
                              <span className="eod-start-earlier-main"><strong>{formatWorkOsDate(day.date)}</strong><small>{outstandingRowMeta(day) || "Recorded workday"}</small></span>
                              <span className={`eod-pill ${status.className}`}>{status.label}</span>
                              <ChevronRight size={14} />
                            </button></li>;
                          })}</ul>
                          {outstandingDays.length > 5 ? <button type="button" className="eod-start-more" onClick={() => setNotificationsOpen(true)}>Show all {outstandingDays.length} days</button> : null}
                        </section> : null}
                        {reviewShiftOpen ? <EodShiftOpenNotice prefix={EOD_SHIFT_OPEN_PREFIX} suffix={EOD_SHIFT_OPEN_SUFFIX.companion} onClockOut={() => setView("day")} /> : null}
                        <div className="eod-start-actions">
                          {!eodDate && <button type="button" className="quiet-action" onClick={() => setView("day")}>Return to today <ChevronRight size={14} /></button>}
                          {reviewShiftOpen ? null
                            : reviewDay?.report && !["draft", "rejected"].includes(String(reviewDay.report.status))
                              ? <small className="eod-start-status" role="status">{String(reviewDay.report.status) === "approved" ? "This day’s report is approved." : "This day’s report is already with your manager."}</small>
                              : <button className="primary" disabled={busy || eodRedrafting} onClick={() => { setEodLanding(false); void createEodDraft(reviewDay); }}>{eodRedrafting ? "Preparing…" : eodDate ? "Create draft for this day" : "Draft today’s EOD"}</button>}
                        </div>
                      </section>
                      : null}
      </main>}
      {view === "insights" && <PersonalInsights key={`${insightRange}:${visibleDay?.shiftDate ?? ""}`} data={activeInsights} loading={activeInsightsLoading} range={insightRange} onRange={setInsightRange} onReference={(reference) => void openInsightReference(reference)} onCorrect={(quality, date) => { if (!quality.sessionId) return; setMissedClockOut({ sessionId: quality.sessionId, date, clockedInAt: quality.clockedInAt ?? null }); setMissedClockOutAt(""); setMissedClockOutReason(""); }} />}
      {view === "evidence" && <main className="page"><PageIntro eyebrow="Provenance" title="Evidence with its labels intact." body="Claims, activity observations, and output artifacts are never collapsed into one misleading score." /><section className="evidence-list">{visibleDay?.evidence?.length ? visibleDay.evidence.map((item) => <article key={item.id}><span className={`evidence-kind ${item.source === "worktivity" ? "activity" : "output"}`}>{item.source === "worktivity" ? "Activity context" : item.source === "loom" ? "Loom recording" : "Output evidence"}</span><div><h3>{item.source === "loom" && item.url ? <a href={String(item.url)} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3><p>{item.summary || "No summary available."}</p></div><time>{item.occurred_at ? formatTime(item.occurred_at, visibleDay.shift?.timezone) : "Today"}</time></article>) : <Empty title="No evidence yet" body="Verified provider events and purpose-limited activity context will appear here." />}</section></main>}
       {view === "settings" && (
        <main className="page settings-page">
           <p className="settings-lead">Personalize Work OS on this device and keep account, sync, and privacy controls in one calm place.</p>
           {renderPersonalSettings("employee")}
        </main>
      )}
      {dockVisible && <ProgressComposer
        recapVoice={recapVoice}
        audioScope={workSessionQuery.data ? { userId: workSessionQuery.data.userId, organizationId: workSessionQuery.data.organizationId, mode: "employee" } : null}
        audioEpoch={adminOttoEpoch}
        onRecapStale={() => { void queryClient.invalidateQueries({ queryKey: ["work-os", "activity-intervals"] }); }}
        mode={sessionActive && view === "day" ? "progress" : "agenda"}
        displayName={visibleOnboarding.profile.displayName}
        input={input}
        open={progressComposerOpen}
        panel={progressPanel}
        pending={pendingProgressUpdate}
        receipt={progressReceipt}
        history={composerHistory}
        onClearChat={clearComposerChat}
        busy={busy}
        required={false}
        goal={planIntent}
        goalProvenance={goalProvenance}
        goalSuggestion={goalSuggestion}
        saveState={planSaveState}
        activityDate={visibleDay?.shiftDate ?? null}
        activityTimezone={dashboardTimezone}
        activityPollMs={60_000}
        voice={voiceAvailable ? voice : undefined}
        onInput={setInput}
        onOpen={() => { setProgressPanel("update"); setProgressComposerOpen(true); }}
        onOpenGoal={openGoalComposer}
        onClose={() => { setProgressComposerOpen(false); setPendingProgressUpdate(""); setProgressReceipt(null); setInterpretation(null); setComposerThinking(null); }}
        onSubmit={startProgressUpdate}
        interpretation={interpretation}
        thinking={composerThinking}
        toolContext={{ shiftDate: visibleDay?.shiftDate ?? null, personId: visibleDay?.access?.personId ?? null, promptKind: visibleDay?.prompt?.kind || "optional" }}
        aiUnavailable={aiUnavailable}
        onReviewOperations={approveInterpretation}
        onMarkSelectedDone={proposeSelectedTaskCompletions}
        onLoadSubtasks={loadComposerSubtasks}
        onReviewHistoryOperations={approveHistoryOperations}
        onRetryHistoryOperation={retryHistoryOperation}
        onDecideNextStep={decideNextStepFromHistory}
        onNavigateView={(page) => setView(page)}
        onRetryOperation={retryInterpretationOperation}
        onClassify={classifyProgressUpdate}
        onApplyGoal={applyGoal}
        onRetryGoalSave={() => setPlanDirty(true)}
      />}
    </section>
    {taskComposerOpen && <TaskComposerModal closing={taskComposerClosing} busy={busy} title={taskComposerTitle} description={taskComposerDescription} assignees={taskComposerAssignees} options={taskAssigneeOptions} optionsLoading={taskOptionsLoading} onTitle={setTaskComposerTitle} onDescription={setTaskComposerDescription} onToggleAssignee={(id) => setTaskComposerAssignees((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onClose={closeTaskComposer} onSubmit={submitTaskFromDesktop} />}
        {taskDetails && <TaskDetailsModal details={taskDetails} loading={taskDetailsLoading} readOnly={taskDetailsReadOnly} currentDate={visibleDay?.shiftDate ?? ""} busy={busy} subtaskTitle={subtaskTitle} subtaskDescription={subtaskDescription} subtaskMenuId={subtaskMenuId} moveMenuId={moveMenuId} onSubtaskTitle={setSubtaskTitle} onSubtaskDescription={setSubtaskDescription} onSubtaskMenu={setSubtaskMenuId} onMoveMenu={setMoveMenuId} onSubtaskCreate={submitInlineSubtask} onEditTask={editTask} onCompleteTask={(completed) => requestTaskCompletion(taskDetails.task as TaskRow, completed, true)} onAttachEvidence={() => requestTaskEvidence(taskDetails.task as TaskRow)} onDownloadEvidence={(evidence) => void downloadTaskEvidence(evidence)} completionEvidence={taskDetails.completionEvidence ?? []} loadEvidence={loadTaskEvidence} onMoveSubtask={moveSubtask} onToggleSubtask={(subtask) => setTaskCompletion(subtask, !subtask.completed, true)} onArchiveSubtask={(subtask) => requestTaskRemoval(subtask, false, "archive")} onDeleteSubtask={(subtask) => requestTaskRemoval(subtask, false, "delete")} currentPersonId={visibleDay?.access?.personId ?? null} assignablePeople={drawerAssigneeQuery.data?.people ?? taskAssigneeOptions} onStatus={(status) => setTaskStatus(taskDetails.task as TaskRow, status)} onAssign={(personIds) => assignTask(taskDetails.task as TaskRow, personIds)} onArchive={() => requestTaskRemoval(taskDetails.task, true, "archive")} onDelete={() => requestTaskRemoval(taskDetails.task, true, "delete")} onClose={() => setTaskDetails(null)} />}
        {taskEvidenceRequest && <TaskEvidenceDialog
          task={taskEvidenceRequest.task}
          mode={taskEvidenceRequest.mode}
          initialPhase={taskEvidenceRequest.savedEvidence ? "evidence_saved" : "idle"}
          initialEvidence={taskEvidenceRequest.savedEvidence ?? null}
          onAttach={(file, note, idempotencyKey) => attachTaskEvidence(taskEvidenceRequest, file, note, idempotencyKey)}
          onRetryCompletion={retryTaskCompletionForEvidence}
          onCompleteWithoutEvidence={taskEvidenceRequest.mode === "complete" ? () => completeTaskWithoutEvidence(taskEvidenceRequest.task, taskEvidenceRequest.refreshDetails) : undefined}
          onClose={() => { taskEvidenceRequestSeq.current += 1; setTaskEvidenceRequest(null); }}
        />}
    {deleteRequest && <TaskRemovalConfirmation mode={deleteRequest.mode} scope={deleteRequest.closeParent ? "task" : "subtask"} title={String(deleteRequest.task.title ?? "Untitled task")} subtaskCount={deleteRequest.closeParent && taskDetails?.subtasks?.length ? taskDetails.subtasks.length : 0} busy={busy} localTask={String(deleteRequest.task.provider ?? "") === "local"} onCancel={() => setDeleteRequest(null)} onConfirm={confirmTaskRemoval} />}
    {eodDeleteConfirmation && <TaskRemovalConfirmation mode="delete" scope="draft" title={String(reviewDay?.report?.title ?? "Your EOD draft")} subtaskCount={0} busy={eodDeleting} onCancel={() => setEodDeleteConfirmation(false)} onConfirm={() => void deleteEodDraft()} />}
    {editRequest && <TaskEditModal kind={editRequest.kind} title={editTitle} description={editDescription} dueDate={editDueDate} busy={busy} localTask={String(editRequest.task.provider ?? "") === "local"} onTitle={setEditTitle} onDescription={setEditDescription} onDueDate={editRequest.task.capabilities?.canEdit === true ? setEditDueDate : undefined} onClose={() => setEditRequest(null)} onSubmit={submitTaskEdit} />}
    {renderGlobalOverlays()}
     <PlanningSession open={planningSessionOpen} plan={visibleDay?.plan ?? null} active={active} busy={busy} seedInput={planningSeed ?? undefined} onClose={() => { planningAutoOpenedRef.current = false; setPlanningSessionOpen(false); }} onInterpret={interpretPlanning} onRefine={refinePlanning} onConfirm={confirmPlanning} lateReasonRequired={lateReasonMissing} onSaveLateReason={saveLateReason} loomEnabled={visibleDay?.access?.featureFlags?.loom_updates === true} onLoomPreview={(url) => previewLoomLink(url, visibleDay?.shiftDate)} />
    {clockInConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{clockInConfirmation.kind === "late" ? "Confirm late start" : "Confirm exception start"}</h2><p>{clockInConfirmation.kind === "late" ? clockInLateProlonged ? "This clock-in is 30+ minutes after the scheduled start. Add the reason now, or from the reminder in your dashboard." : "This clock-in is after the scheduled start. Your acknowledgement will be retained in the audit record." : "There is no startable scheduled shift right now. Explain the exception before Work OS starts a separate exception session."}</p>{(clockInConfirmation.kind === "exception" || clockInLateProlonged) && <textarea autoFocus maxLength={1000} value={clockInConfirmation.reason} onChange={(event) => setClockInConfirmation({ ...clockInConfirmation, reason: event.target.value })} placeholder={clockInConfirmation.kind === "late" ? "Reason for the late start (optional)" : "Reason for starting outside the scheduled window"} />}<div><button disabled={busy} onClick={() => setClockInConfirmation(null)}>Cancel</button><button className="primary" disabled={busy || (clockInConfirmation.kind === "exception" && !clockInConfirmation.reason.trim())} onClick={confirmClockIn}>Confirm clock-in</button></div></section></div>}
    {missedClockOut && <div className="task-modal-backdrop"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="missed-clockout-title"><header><div><span>Session correction · {formatWorkOsDate(missedClockOut.date)}</span><h2 id="missed-clockout-title">Enter the exact clock-out time</h2></div><button aria-label="Close correction" onClick={() => setMissedClockOut(null)}><X size={18} /></button></header><div className="task-modal-body"><p>Work OS will not infer this timestamp. Enter the time you actually stopped working.</p>{missedClockOut.clockedInAt && <small>Clocked in {formatWorkOsDateTime(missedClockOut.clockedInAt)}</small>}<label><span>Clock-out timestamp</span><input type="datetime-local" value={missedClockOutAt} onChange={(event) => setMissedClockOutAt(event.target.value)} /></label><label><span>Correction note <em>optional</em></span><textarea value={missedClockOutReason} onChange={(event) => setMissedClockOutReason(event.target.value)} /></label></div><footer><button onClick={() => setMissedClockOut(null)}>Cancel</button><button className="primary" disabled={busy || !missedClockOutAt} onClick={correctMissedClockOut}>Save correction</button></footer></section></div>}
    {clockOutConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{extendedClockOut || clockOutExtendedPrompt ? "Confirm extended shift" : "Confirm clock-out"}</h2><p>{extendedClockOut || clockOutExtendedPrompt ? "This clock-out is more than 15 minutes after the scheduled end. Confirm that you intentionally worked the extended shift; the acknowledgement will be retained in the audit record." : "Clock out and close today’s workspace?"}</p><div><button disabled={busy} onClick={() => { setClockOutConfirmation(false); setClockOutExtendedPrompt(false); }}>Cancel</button><button className="primary" disabled={busy} onClick={confirmClockOut}>{extendedClockOut || clockOutExtendedPrompt ? "Confirm extended shift" : "Clock out"}</button></div></section></div>}
  </div>;
  };

  let bootContent: ReactNode = null;
  if (landing === "connect" || landing === "onboarding" || landing === "admin" || landing === "workspace") {
    switch (landing) {
      case "connect": bootContent = renderConnect(); break;
      case "onboarding": bootContent = renderOnboarding(); break;
      case "admin": bootContent = renderAdmin(); break;
      case "workspace": bootContent = renderWorkspace(); break;
    }
  }
  return <BootOverlay surface={landing}>{bootContent}</BootOverlay>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <article className="metric"><Icon size={18} /><small>{label}</small><strong>{value}</strong></article>; }
function moveDate(date: string, amount: number) {
  return shiftWorkOsDate(date, amount);
}


type ConnectScreenProps = {
  apiBase: string;
  setApiBase: (value: string) => void;
  connecting: boolean;
  /** The browser is open and the app is waiting for the deep-link callback. */
  awaiting?: boolean;
  onConnect: () => void;
  onSave: () => Promise<void>;
  /** Why this device was signed out, when it was. */
  notice?: string | null;
};

function ConnectSettings({ apiBase, setApiBase, onSave, summary = "Advanced settings" }: Pick<ConnectScreenProps, "apiBase" | "setApiBase" | "onSave"> & { summary?: string }) {
  return <details className="connect-settings">
    <summary>{summary}</summary>
    <div className="connect-settings-row">
      <label htmlFor="workspace-server-url">Workspace server URL</label>
      <div className="connect-settings-controls">
        <input id="workspace-server-url" value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://work.example.com" />
        <button onClick={() => void onSave()}>Save</button>
      </div>
    </div>
  </details>;
}

/** The first frame of first run. The connect screen is the same stage the
 *  setup flow opens on, so the sign-in round-trip never leaves Otto's world:
 *  he carries the sequence in his own voice, and the stage carries the one
 *  action. The advanced server override stays a quiet disclosure in the
 *  bubble, beside the action it changes. */
export function ConnectScreen({ apiBase, setApiBase, connecting, awaiting = false, onConnect, onSave, notice }: ConnectScreenProps) {
  return <main className="guided-onboarding" data-stage="welcome">
    <OnboardingStage
      pose="waiting"
      eyebrow="Desktop companion"
      title="Connect your workspace."
      line={awaiting
        ? "I’ve opened your browser. Approve this device there, and I’ll be waiting here when you’re back."
        : "I’m Otto. First, let me get you in — I’ll open your browser for a secure sign-in. Approve this device, and I’ll be right here when you’re back."}
      replayKey="connect"
    >
      <div className="otto-bubble-actions">
        <button className="primary" disabled={connecting} onClick={onConnect}>{connecting ? <FadeArc size={17} /> : awaiting ? <ExternalLink size={17} /> : <LogIn size={17} />} {connecting ? "Opening browser…" : awaiting ? "Reopen browser" : "Connect workspace"}</button>
        {awaiting ? null : <span className="otto-bubble-note">About a minute.</span>}
      </div>
      {awaiting && !connecting && <p className="otto-bubble-status" role="status">Waiting for approval in your browser. I’ll finish connecting here.</p>}
      {notice && <p className="otto-bubble-notice" role="status">{notice}</p>}
      <ConnectSettings apiBase={apiBase} setApiBase={setApiBase} onSave={onSave} />
    </OnboardingStage>
  </main>;
}
export function LoadingScreen({ failed, retry, note, stage, onReset, onDebug, onOffline }: {
  failed: boolean;
  retry: () => void;
  /** Bounded explanation of what is wrong, replacing the generic hint. */
  note?: string;
  /** What is actually happening right now. Only ever pass what is true. */
  stage?: string;
  /** Starts this device fresh; only offered when nothing else can recover. */
  onReset?: () => void | Promise<void>;
  onDebug: () => void;
  /** Only surfaces that can actually run offline pass this. */
  onOffline?: () => void;
}) {
  // A destructive recovery is armed on the first click and only runs on the
  // second, so a stray click on a failure screen can never discard local data.
  const [resetArmed, setResetArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  useEffect(() => {
    if (!resetArmed) return;
    const timer = setTimeout(() => setResetArmed(false), 8_000);
    return () => clearTimeout(timer);
  }, [resetArmed]);
  // The non-failed launch surface lives in BootHandoff.tsx (First Light); this
  // component is the local-vault recovery path only.
  const hint = onReset
    ? resetArmed
      ? "This deletes this device's saved session and queued updates. Tasks and updates already filed with the server stay, and you'll connect this device again."
      : "Start fresh only if the saved data can't be opened — it replaces this device's local copy."
    : onOffline
      ? "Offline mode uses local fixtures only — nothing reaches the server."
      : "Retry re-checks this device's saved key.";
  return <main className="loading"><div className="loading-shell">
    <MascotPet isolated agent="blocked" workday="active" className="mascot-loading" artClassName="mascot-loading-art" />
    <h1>Work OS needs another try</h1>
    <p>{note ?? "The details are in the notification above."}</p>
    <button className="primary" onClick={retry} disabled={resetting}>Retry</button>
    <div className="loading-alternatives">
      {onOffline && <button onClick={onOffline} disabled={resetting}>Continue offline</button>}
      {onReset && <button
        className={resetArmed ? "danger" : ""}
        disabled={resetting}
        title={resetArmed ? "This deletes this device's saved Work OS data" : "Replace this device's unreadable local data"}
        onClick={async () => {
          if (!resetArmed) { setResetArmed(true); return; }
          setResetting(true);
          try { await onReset(); } finally { setResetting(false); setResetArmed(false); }
        }}
      >{resetting ? "Starting fresh…" : resetArmed ? "Delete local data and start fresh" : "Start fresh on this device"}</button>}
      <button className="quiet" onClick={onDebug} disabled={resetting}><Bug size={14} /> Scenario debugger</button>
    </div>
    <small>{hint}</small>
  </div></main>;
}

function remainingShiftLabel(endsAt: string | undefined, now: Date) {
  const remaining = endsAt ? Math.max(0, Date.parse(endsAt) - now.getTime()) : 0;
  if (!endsAt || !Number.isFinite(remaining)) return "—";
  const minutes = Math.ceil(remaining / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function ShiftDetailsFloatingCard({ view, progressPercent, shiftStart, remaining, shiftEnd, elapsed, openTasks, attendance, timezone, observedActive, providerBreak, onBack, onClose }: {
  view: "shift" | "worktivity"; progressPercent: number; shiftStart: string; remaining: string; shiftEnd: string; elapsed: string;
  openTasks: number; attendance: DayData["attendance"] | null; timezone?: string; observedActive: string; providerBreak: string; onBack: () => void; onClose: () => void;
}) {
  return <section className="shift-detail-popover" role="dialog" aria-label={view === "shift" ? "Workday status" : "Worktivity details"}>
    <header><button className="detail-back" aria-label="Back to detail options" onClick={onBack}><ChevronLeft size={16} /></button><div><span>{view === "shift" ? <Clock3 size={15} /> : <Activity size={15} />}{view === "shift" ? "Workday status" : "Worktivity details"}</span><small>{view === "shift" ? "Schedule and mirrored session context" : "Provider attendance and activity details"}</small></div><button aria-label="Close details" onClick={onClose}><X size={16} /></button></header>
    {view === "shift" ? <><div className="shift-pulse-visual"><div className="shift-progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as CSSProperties}><span><small>Scheduled shift</small><strong>{Math.round(progressPercent)}%</strong><em>elapsed</em></span></div><div className="shift-track-summary"><div><span><small>Shift start</small><strong>{shiftStart}</strong></span><span><small>Time remaining</small><strong>{remaining}</strong></span><span><small>Shift end</small><strong>{shiftEnd}</strong></span></div><div className="shift-detail-track"><i style={{ width: `${progressPercent}%` }} /><b style={{ left: `${progressPercent}%` }} /></div></div></div><div className="shift-detail-grid"><span><small>Elapsed</small><strong>{elapsed}</strong></span><span><small>Open tasks</small><strong>{openTasks}</strong></span></div></> : <><div className="worktivity-state"><span className={`presence ${attendance?.state === "active" ? "live" : ""}`} /><div><small>Worktivity attendance</small><strong>{attendance?.status ? sentence(attendance.status) : "Unavailable"}</strong></div></div><div className="shift-detail-grid worktivity-grid"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{worktivityClockOutLabel(attendance, timezone)}</strong></span><span><small>Last activity</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>Observed active time</small><strong>{observedActive}</strong></span><span><small>Provider refresh</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>OnBreak deducted</small><strong>{providerBreak}</strong></span></div></>}
  </section>;
}

function worktivityClockOutLabel(attendance: DayData["attendance"] | null | undefined, timezone?: string) {
  if (attendance?.clockedOutAt) return `${attendance.clockedOutAtInferred ? "Inferred · " : ""}${formatTime(attendance.clockedOutAt, timezone)}`;
  if (attendance?.state === "active" || attendance?.state === "paused") return "Still active";
  return attendance?.clockedInAt ? "Not observed" : "—";
}

function TaskLifecycleMenu({ task, currentDate = "", busy, initialOpen = false, onStatus, onComplete, onEdit, onAssign, onArchive, onDelete }: {
  task: TaskRow; currentDate?: string; busy: boolean; initialOpen?: boolean; onStatus?: (status: "pending" | "in_progress") => void; onComplete?: (completed: boolean) => void; onEdit: (task: TaskRow) => void; onAssign?: (task: TaskRow) => void; onArchive: (task: TaskRow) => void; onDelete: (task: TaskRow) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  if (!hasTaskMenu(task, currentDate)) return null;
  return <div className={`dashboard-task-menu ${open ? "open" : ""}`} onClick={(event) => event.stopPropagation()}><EllipsisMenu open={open} label={`Actions for ${safeTaskText(task.title, "task")}`} disabled={busy} onToggle={() => setOpen((current) => !current)} onClose={() => setOpen(false)}>
    <TaskActionMenuItems task={task} currentDate={currentDate} busy={busy} onStatus={(status) => onStatus?.(status)} onComplete={(completed) => onComplete?.(completed)} onEdit={() => onEdit(task)} onAssign={onAssign ? () => onAssign(task) : undefined} onArchive={() => onArchive(task)} onDelete={() => onDelete(task)} onClose={() => setOpen(false)} />
  </EllipsisMenu></div>;
}

function PendingTaskControls({ status, error, onRetry, onDismiss }: { status: "syncing" | "failed"; error?: string; onRetry: () => void; onDismiss: () => void }) {
  if (status === "syncing") {
    return <span className="pending-indicator" role="status" title="Adding to your workspace…"><FadeArc size={15} /><span className="sr-only">Adding task</span></span>;
  }
  return <span className="pending-indicator failed">
    <button type="button" className="pending-retry" title={error ? `Failed to add this task — ${error}. Click to retry.` : "Failed to add this task — click to retry."} aria-label="Retry adding this task" onClick={(event) => { event.stopPropagation(); onRetry(); }}><RefreshCw size={14} /></button>
    <button type="button" className="pending-dismiss" title="Discard this task" aria-label="Discard this failed task" onClick={(event) => { event.stopPropagation(); onDismiss(); }}><X size={12} /></button>
  </span>;
}

export function ActiveDayWorkspace({ focus, focusSource, tasks, previousTasks, otherTasks, elapsed, progressPercent, shiftStart, shiftEnd, remaining, timezone, attendance, providerBreakSeconds, initialDetailView = null, initialDetailsMenuOpen = false, initialTaskMenuId = null, paused, busy, observedOnly = false, canPause, canClockOut = true, onEditFocus, onAddTask, onManageTasks, onOpenOverdue, currentDate = "", onOpenTask, onToggleTask, onEditTask, onArchiveTask, onDeleteTask, onAssignTask, onPause, onClockOut, kpiStrip = null, goalSaveState = "saved", onRetryGoalSave, onRetryPendingTask, onDismissPendingTask, taskFlight, onStatusTask }: {
  onStatusTask?: (task: TaskRow, status: "pending" | "in_progress") => void;
  focus: string; focusSource: string; tasks: TaskRow[]; previousTasks: TaskRow[]; otherTasks: TaskRow[]; elapsed: string; progressPercent: number;
  shiftStart: string; shiftEnd: string; remaining: string; timezone?: string; attendance: DayData["attendance"] | null; providerBreakSeconds: number;
  initialDetailView?: "shift" | "worktivity" | null; initialDetailsMenuOpen?: boolean; initialTaskMenuId?: string | null; paused: boolean; busy: boolean; observedOnly?: boolean; canPause: boolean; canClockOut?: boolean;
  onEditFocus: () => void; onAddTask: () => void; onManageTasks: () => void; onOpenOverdue?: () => void; currentDate?: string; onOpenTask: (task: TaskRow) => void; onToggleTask: (task: TaskRow, completed: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask: (task: TaskRow) => void; onAssignTask?: (task: TaskRow) => void; onPause: () => void; onClockOut: () => void; kpiStrip?: ReactNode; goalSaveState?: "saved" | "saving" | "offline" | "conflict"; onRetryGoalSave?: () => void; onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
}) {
  const [tab, setTab] = useState<"today" | "previous" | "other">("today");
  const [sort, setSort] = useState<TaskSort>(() => readTaskSort(DAY_SORT_STORAGE_KEY));
  useEffect(() => { writeTaskSort(DAY_SORT_STORAGE_KEY, sort); }, [sort]);
  const [detailsMenuOpen, setDetailsMenuOpen] = useState(initialDetailsMenuOpen || initialDetailView !== null);
  const [detailView, setDetailView] = useState<"shift" | "worktivity" | null>(initialDetailView);
  const today = currentDate || new Date().toISOString().slice(0, 10);
  // Completed work leaves the day list the moment it is checked off; the hero
  // ring and the KPI strip keep counting it.
  const openToday = tasks.filter((task) => task.completed !== true);
  const rawDisplayed = tab === "today" ? openToday : tab === "previous" ? previousTasks : otherTasks;
  const displayed = sortTaskList(rawDisplayed, sort, today);
  const completed = tasks.filter((task) => task.completed === true).length;
  const listRef = useRef<HTMLDivElement | null>(null);
  useListShift(listRef);
  // One strict overdue definition across the whole tab set (design §27.3):
  // due-dated open work before today. Undated older work stays carry-over.
  const overdueCount = uniqueTasks([...previousTasks, ...otherTasks]).filter((task) => isOverdueTask(task, today)).length;
  const tabLabel = tab === "today" ? "Today tasks" : tab === "previous" ? "Previous day tasks" : "Older tasks";
  const pendingPrevious = previousTasks.filter((task) => task.completed !== true).length;
  const observedStart = attendance?.clockedInAt ? Date.parse(attendance.clockedInAt) : Number.NaN;
  const observedEnd = attendance?.clockedOutAt ? Date.parse(attendance.clockedOutAt) : attendance?.observedAt ? Date.parse(attendance.observedAt) : Number.NaN;
  const observedSeconds = Number.isFinite(observedStart) && Number.isFinite(observedEnd) ? Math.max(0, Math.floor((observedEnd - observedStart) / 1000) - providerBreakSeconds) : 0;
  const observedActive = `${String(Math.floor(observedSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(observedSeconds % 3600 / 60)).padStart(2, "0")}`;
  const providerBreak = `${String(Math.floor(providerBreakSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(providerBreakSeconds % 3600 / 60)).padStart(2, "0")}`;
  return <main className="active-day-page">
    <section className="active-day-card">
      <header className="active-day-header">
        <div className="active-shift-status"><span className={`presence ${paused ? "" : "live"}`} /><div><small>{observedOnly ? paused ? "Worktivity break" : "Activity observed" : paused ? "Shift paused" : "On shift"}</small><strong>{elapsed}</strong></div><div className="active-shift-meter"><i style={{ width: `${progressPercent}%` }} /></div></div>
        <div className="active-day-actions">{canPause && <button className="shift-action-button" disabled={busy} onClick={onPause}>{paused ? <CirclePlay size={15} aria-hidden="true" /> : <CirclePause size={15} aria-hidden="true" />}<span>{paused ? "Resume" : "Pause"}</span></button>}{canClockOut && <button className="shift-action-button" disabled={busy} onClick={onClockOut}>Clock out</button>}<div className="shift-details-menu"><button className="ellipsis-button" aria-label="Open workday details" aria-expanded={detailsMenuOpen} onClick={() => { setDetailsMenuOpen((current) => !current); setDetailView(null); }}><MoreHorizontal size={17} /></button>{detailsMenuOpen && <><button className="shift-popover-scrim" aria-label="Close workday details" onClick={() => { setDetailsMenuOpen(false); setDetailView(null); }} />{detailView ? <ShiftDetailsFloatingCard view={detailView} progressPercent={progressPercent} shiftStart={shiftStart} remaining={remaining} shiftEnd={shiftEnd} elapsed={elapsed} openTasks={tasks.filter((task) => !task.completed).length} attendance={attendance} timezone={timezone} observedActive={observedActive} providerBreak={providerBreak} onBack={() => setDetailView(null)} onClose={() => { setDetailsMenuOpen(false); setDetailView(null); }} /> : <div className="shift-details-options" role="menu"><button role="menuitem" onClick={() => setDetailView("shift")}><Clock3 size={14} /> Workday status</button><button role="menuitem" onClick={() => setDetailView("worktivity")}><Activity size={14} /> Worktivity details</button></div>}</>}</div></div>
      </header>
      <div className="active-focus-block"><div className="active-focus-copy"><span>Today’s focus</span><div className="active-focus-heading"><h2>{focus}</h2><button className="focus-edit-button" onClick={onEditFocus}><Pencil size={14} /> Update focus</button></div><small><Sparkles size={13} /> {focusSource}{goalSaveState === "saving" ? <FadeArc size={11} /> : goalSaveState === "offline" || goalSaveState === "conflict" ? <button type="button" className="goal-retry" title="Goal not saved — click to retry." aria-label="Retry saving the goal" onClick={() => onRetryGoalSave?.()}><RefreshCw size={11} /></button> : null}</small></div><div className="hero-task-metrics">{overdueCount > 0 && <button className="overdue-metric" onClick={() => onOpenOverdue?.()} aria-label={`${overdueCount} overdue tasks. Show unfinished work in Tasks.`}><span><strong>{overdueCount}</strong></span><em>overdue<br />{overdueCount === 1 ? "task" : "tasks"}</em></button>}</div>
        <div className="hero-task-metrics"><button className="hero-metric-button" onClick={() => setTab("today")} aria-label={`${completed} of ${tasks.length} tasks done today. Show Today tasks.`}><ProgressRing completed={completed} total={tasks.length} size={44} stroke={5} label="tasks done" trailing="tasks done"><strong>{completed}</strong><small>of {tasks.length}</small></ProgressRing></button><button className={`carryover-metric ${pendingPrevious > 0 ? "pending" : "clear"}`} onClick={() => setTab("previous")} aria-label={`${pendingPrevious} pending task${pendingPrevious === 1 ? "" : "s"} from yesterday. Show Previous day tasks.`}><span><strong>{pendingPrevious}</strong></span><em>pending tasks<br />from yesterday</em></button></div></div>
      <div className="active-task-toolbar"><div className="active-task-tabs" role="tablist"><button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Today <em>{openToday.length}</em></button><button role="tab" aria-selected={tab === "previous"} className={tab === "previous" ? "active" : ""} onClick={() => setTab("previous")}>Previous day {previousTasks.length > 0 && <em className="alert-count">{previousTasks.length}</em>}</button><button role="tab" aria-selected={tab === "other"} className={tab === "other" ? "active" : ""} onClick={() => setTab("other")}>Other days {otherTasks.length > 0 && <em className="older-count">{otherTasks.length}</em>}</button></div><small className="active-task-sort-note">Sorted by {taskSortNote(sort)}</small><button className="primary add-day-task" onClick={onAddTask}><Plus size={15} /> Add task</button></div>
      {tab === "other" && otherTasks.length > 0 && <div className="older-task-notice" role="status"><span>{otherTasks.length}</span><strong>Older unfinished task{otherTasks.length === 1 ? "" : "s"}</strong><small>From before yesterday</small></div>}
      <div className="active-task-list" ref={listRef}>
        {displayed.length ? <SortHeaderRow columns={TASK_SORT_COLUMNS} sort={sort} fallback={DEFAULT_TASK_SORT} onChange={setSort} label={`Sort ${tabLabel.toLowerCase()}`} className="day-task-sort" /> : null}
        {displayed.length ? displayed.map((task) => { const taskId = String(task.provider_task_id || task.id); const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null; const progress = subtaskProgress(task); const flight = taskFlight?.get(taskId) ?? null; return <article className={`${task.completed ? "completed" : ""}${pendingStatus ? " pending" : ""}${flight === "leaving" ? " is-leaving" : ""}`} data-list-key={taskId} key={taskId}><button className={`task-check${flight === "completing" ? " is-completing" : ""}`} {...taskCheckboxA11y(task, flight === "completing", task.title)} aria-busy={flight === "completing"} disabled={pendingStatus !== null || !taskCheckboxEnabled(task)} onClick={() => { if (!pendingStatus && !flight) onToggleTask(task, !task.completed); }}>{flight === "completing" ? <FadeArc size={13} /> : (task.completed || flight === "leaving") ? <Check size={15} /> : null}</button><button className="active-task-copy" onClick={() => { if (!pendingStatus) onOpenTask(task); }}><strong>{task.title}</strong><small>{pendingStatus ? pendingStatus === "syncing" ? "Adding to your workspace…" : "Failed to add — retry or discard" : task.completed ? (typeof task.completed_at === "string" && task.completed_at ? `Completed ${formatWorkOsDate(task.completed_at.slice(0, 10))}` : "Completed") : task.priority ? `${sentence(String(task.priority))} priority` : task.due_date ? `Due ${formatWorkOsDate(task.due_date)}` : "Open today"}</small></button>{!pendingStatus && progress.total > 0 && <span className="task-row-ring"><ProgressRing completed={progress.completed} total={progress.total} label="subtasks" /></span>}{pendingStatus ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} /> : null}{!pendingStatus && <TaskLifecycleMenu task={task} currentDate={today} busy={busy} initialOpen={initialTaskMenuId === taskId} onStatus={(status) => onStatusTask?.(task, status)} onComplete={(completed) => onToggleTask(task, completed)} onEdit={onEditTask} onAssign={onAssignTask} onArchive={onArchiveTask} onDelete={onDeleteTask} />}</article>; }) : <Empty title={tab === "today" ? "A clear day" : tab === "previous" ? "Nothing left behind" : "No older work pending"} body={tab === "today" ? "Add the first task you want to move forward today." : tab === "previous" ? "Yesterday’s open work has been cleared." : "Everything from before yesterday is complete."} />}</div>
      <footer className="active-day-footer"><span>Changes save to your workday record.</span><button className="workspace-link-button" onClick={onManageTasks}><span>Open full Tasks workspace</span><ChevronRight size={14} aria-hidden="true" /></button></footer>
    </section>
    {kpiStrip}
  </main>;
}

export function KpiStrip({ scheduledCount, yesterdayDueCount, completedCount, onScheduled, onYesterday, onCompleted }: {
  scheduledCount: number; yesterdayDueCount: number; completedCount: number;
  onScheduled: () => void; onYesterday: () => void; onCompleted: () => void;
}) {
  return <section className="kpi-strip" aria-label="Today at a glance">
    <button className="kpi-card" onClick={onScheduled}><small><ListChecks size={13} aria-hidden="true" /> Scheduled today</small><strong>{scheduledCount}</strong><em>{scheduledCount ? "Open the day view" : "Plan your day"}</em></button>
    <button className="kpi-card" disabled={!yesterdayDueCount} onClick={onYesterday}><small><AlertTriangle size={13} aria-hidden="true" /> Due from yesterday</small><strong className={yesterdayDueCount ? "kpi-danger" : undefined}>{yesterdayDueCount}</strong><em className={yesterdayDueCount ? "kpi-attention" : undefined}>{yesterdayDueCount ? "Review unfinished work" : "Nothing carried forward"}</em></button>
    <button className="kpi-card" disabled={!completedCount} onClick={onCompleted}><small><CheckCircle2 size={13} aria-hidden="true" /> Completed today</small><strong>{completedCount}</strong><em>{completedCount ? "Review the record" : "Finish a task first"}</em></button>
  </section>;
}

export function DashboardTaskCard({ task, currentDate, onOpen, flight = null, onComplete, onRetryPendingTask, onDismissPendingTask }: { task: TaskRow; currentDate: string; onOpen: () => void; flight?: "completing" | "leaving" | null; onComplete?: () => void; onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void }) {
  const state = taskState(task, currentDate);
  const dueDate = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
  const title = safeTaskText(task.title, "Untitled task");
  const description = safeTaskText(task.description, "");
  const progress = subtaskProgress(task);
  const projectName = safeTaskText(task.project?.name, "Work OS");
  const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null;
  return <article className={`dashboard-task-card${pendingStatus ? " pending" : ""}${flight === "leaving" ? " is-leaving" : ""}`} role="button" tabIndex={0} data-list-key={String(task.provider_task_id || task.id)} onClick={() => { if (!pendingStatus && !flight) onOpen(); }} onKeyDown={(event) => { if (pendingStatus || flight) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} aria-label={`Open ${title}`}>
    <div className="dashboard-task-head">
      <span className={`task-due-chip ${state === "overdue" ? "danger" : ""}`}><CalendarDays size={12} aria-hidden="true" /> {pendingStatus ? "Adding to today" : dueDate ? `Due ${formatWorkOsDate(dueDate)}` : task.priority ? `${sentence(String(task.priority))} priority` : "No due date"}</span>
      {!pendingStatus && <button className={`task-check card-check${flight === "completing" ? " is-completing" : ""}`} aria-label={flight === "completing" ? `Completing ${title}` : `Complete ${title}`} aria-busy={flight === "completing"} onClick={(event) => { event.stopPropagation(); if (!flight) onComplete?.(); }}>{flight === "completing" ? <FadeArc size={12} /> : flight === "leaving" ? <Check size={13} /> : null}</button>}
    </div>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    <div className="dashboard-task-foot">
      {pendingStatus
        ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} />
        : progress.total > 0
          ? <ProgressRing completed={progress.completed} total={progress.total} label="subtasks" />
          : <span className="task-due">{projectName !== "Work OS" ? projectName : "Work OS task"}</span>}
    </div>
  </article>;
}

function AssistantOperations({ interpretation, busy, toolContext, onReviewOperations, onMarkSelectedDone, onLoadSubtasks, onNavigateView, onRetryOperation }: {
  interpretation: { operations: Array<import("./interpretation").ProposedOperation>; taskOptions: Array<{ id: string; title: string }>; reply?: string; results?: ToolCallResult[] };
  busy: boolean;
  toolContext: import("./interpretation").ApprovedOpContext;
  onReviewOperations?: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void;
  onMarkSelectedDone?: (tasks: Array<{ id: string; title: string }>) => void;
  onLoadSubtasks?: (taskId: string) => Promise<readonly { id: string; title: string; completed?: boolean }[]>;
  onNavigateView?: (page: import("./interpretation").NavigatePage) => void;
  onRetryOperation?: (result: ToolCallResult) => void;
}) {
  const mutating = interpretation.operations.filter(isMutatingToolOp);
  const actionable = mutating.filter((op) => !op.failure);
  const unfiled = mutating.filter((op) => !!op.failure);
  const allMutationResults = (interpretation.results ?? []).filter((result) => isMutatingToolOp(result.op));
  const mutationResults = allMutationResults.filter((result) => !usesGroupedCard(result.op));
  const hasResults = allMutationResults.length > 0;
  const hasPendingMutations = actionable.some((op) => !usesGroupedCard(op) && !mutationResults.some((result) => sameToolCall(result.op, op)));
  const proposedTaskIds = interpretation.operations
    .filter((op) => op.op === "complete_task" && !op.failure && !mutationResults.some((result) => sameToolCall(result.op, op)))
    .map((op) => op.taskId)
    .filter((id): id is string => !!id);
  // The assistant sometimes returns the same view twice; render one card.
  const seenDisplayCards = new Set<string>();
  return <>
    {hasResults ? null : <strong>{!actionable.length && unfiled.length ? "Updates not filed" : actionable.length ? "Review proposed actions" : "Assistant shortcuts"}</strong>}
    {interpretation.reply ? <ChatMarkdown text={interpretation.reply} /> : null}
    {hasResults ? null : <p>{!actionable.length && unfiled.length ? "Nothing was recorded. The reasons are listed below." : actionable.length ? "Choose what to record. Nothing changes until the final confirmation." : "Loaded inline below. Viewing never needs approval."}</p>}
    <ChatSectionBoundary label="assistant actions">
      <div className="interpretation-list">
        {interpretation.operations.map((op, index) => {
          const result = interpretation.results?.find((item) => sameToolCall(item.op, op));
          if (isMutatingToolOp(op)) return null;
          if (op.op === "navigate_to_page" && op.page) return <NavigateButton key={`${op.op}-${index}`} page={op.page} statement={op.statement} onNavigate={(page) => onNavigateView?.(page)} />;
          if (!isDisplayToolOp(op)) return null;
          if (result?.status === "failed") return <p key={`${op.op}-${index}`} className="tool-display-error">{result.message}</p>;
          const selection = taskSelectionFromResult(result);
          if (!selection) return null;
          const displayKey = `${op.op}:${selection.view}:${selection.tasks.map((task) => String(task.id ?? "")).join(",")}`;
          if (seenDisplayCards.has(displayKey)) return null;
          seenDisplayCards.add(displayKey);
          const selectionTasks: TaskSelectionCardTask[] = selection.tasks.map((task) => ({
            id: String(task.id ?? ""), title: typeof task.title === "string" ? task.title : "Untitled task",
            description: typeof task.description === "string" ? task.description : null,
            dueDate: typeof task.due_date === "string" ? task.due_date : null,
            projectName: typeof task.project_name === "string" ? task.project_name : null,
            priority: typeof task.priority === "string" ? task.priority : null,
            state: task.state === "overdue" || task.state === "pending" ? task.state : selection.view === "overdue" ? "overdue" : "pending",
            subtaskTotal: Number(task.subtask_total ?? 0) || 0,
            subtaskCompleted: Number(task.subtask_completed ?? 0) || 0,
          })).filter((task) => !!task.id);
          return <TaskSelectionCard key={`${op.op}-${index}`} presentation="table" title={selection.view === "overdue" ? "Overdue tasks" : "Pending tasks"} tasks={selectionTasks} onMarkSelectedDone={onMarkSelectedDone ?? (() => undefined)} onLoadSubtasks={onLoadSubtasks} proposedTaskIds={proposedTaskIds} approvalLocation="below" emptyTitle={selection.view === "overdue" ? "No overdue tasks" : "No pending tasks"} emptyMessage={selection.view === "overdue" ? "Nothing is past its due date." : "Tasks waiting to be completed will appear here."} />;
        })}
        {mutationResults.length ? <ApprovalResults results={mutationResults} onRetry={onRetryOperation} /> : null}
        {hasPendingMutations && mutating.some((op) => !isBatchToolOp(op) && !isPlanImportOp(op)) ? <ApprovalFlow operations={mutating.filter((op) => !isBatchToolOp(op) && !isPlanImportOp(op))} results={interpretation.results} context={toolContext} busy={busy} onSubmit={(approved, rejected) => onReviewOperations?.(approved, rejected)} onRetry={onRetryOperation} /> : null}
        <BatchApprovalCards operations={actionable.filter((op) => isBatchToolOp(op) || isPlanImportOp(op))} results={interpretation.results ?? []} busy={busy} context={toolContext} onApprove={(op) => onReviewOperations?.([op], [])} onSkip={(op) => onReviewOperations?.([], [op])} onRetry={onRetryOperation} />
        {unfiled.map((op, index) => <p key={`unfiled-${index}`} className="tool-display-error">{op.taskTitle ? `${op.taskTitle}: ` : ""}{op.failure}</p>)}
      </div>
    </ChatSectionBoundary>
  </>;
}

/** The working card for a pending update before the real trace starts. It owns
 * its start instant so the elapsed readout never resets on a re-render. */
function WorkingNowTrace({ label }: { label: string }) {
  const [startedAt] = useState(() => Date.now());
  return <AvatarThinking stages={[{ label }]} active={0} startedAt={startedAt} activeLabel="Thinking" />;
}

export function ProgressComposer({ mode = "progress", displayName = null, input, open, panel, pending, receipt, history = [], onClearChat, busy, required, goal, goalProvenance, goalSuggestion, saveState, recapVoice = DEFAULT_RECAP_VOICE, onRecapStale, activityDate = null, activityTimezone = null, activityPollMs, interpretation = null, thinking = null, toolContext = { shiftDate: null, personId: null, promptKind: "optional" }, aiUnavailable = null, voice, audioScope = null, audioEpoch = 1, onInput, onOpen, onOpenGoal, onClose, onSubmit, onClassify, onApplyGoal, onRetryGoalSave, onReviewOperations, onMarkSelectedDone, onLoadSubtasks, onNavigateView, onRetryOperation, onReviewHistoryOperations, onRetryHistoryOperation, onDecideNextStep }: {
  mode?: ComposerMode; displayName?: string | null;
  input: string; open: boolean; panel: ProgressPanel; pending: string; receipt: ProgressReceipt | null; history?: WorkOsConversationTurn[]; onClearChat?: () => void; busy: boolean; required: boolean; goal: string;
  goalProvenance: "employee" | "suggested" | "accepted_suggestion" | "ai_draft" | null; goalSuggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  activityDate?: string | null; activityTimezone?: string | null; activityPollMs?: number;
  /** How recaps are read aloud on this device (provider voice id). */
  recapVoice?: string;
  /** The recap behind a clip changed while it was synthesized. */
  onRecapStale?: () => void;
  /** The employee's cross-window audio scope. Absent in isolated previews. */
  audioScope?: OttoScope | null;
  audioEpoch?: number;
  onInput: (value: string) => void; onOpen: () => void; onOpenGoal: () => void; onClose: () => void; onSubmit: () => void; onClassify: (kind: ProgressUpdateKind) => void; onApplyGoal: (value: string, fromSuggestion: boolean) => void; onRetryGoalSave?: () => void;
  interpretation?: { status: "loading" | "ready"; reviewId?: string; operations: Array<import("./interpretation").ProposedOperation>; taskOptions: Array<{ id: string; title: string }>; reply?: string; results?: ToolCallResult[] } | null;
  thinking?: { stages: AvatarThinkingStage[]; active: number; startedAt: number } | null;
  toolContext?: import("./interpretation").ApprovedOpContext;
  aiUnavailable?: string | null;
  voice?: import("./chat/voiceInput").VoiceInput;
  onNavigateView?: (page: import("./interpretation").NavigatePage) => void; onReviewOperations?: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void; onMarkSelectedDone?: (tasks: Array<{ id: string; title: string }>) => void; onLoadSubtasks?: (taskId: string) => Promise<readonly { id: string; title: string; completed?: boolean }[]>; onRetryOperation?: (result: ToolCallResult) => void;
  onReviewHistoryOperations?: (turnId: string, approved: ProposedOperation[], rejected: ProposedOperation[]) => void; onRetryHistoryOperation?: (turnId: string, result: ToolCallResult) => void; onDecideNextStep?: (turnId: string, item: RecapNextStepItem, decision: "accept" | "skip", edits?: { name?: string }) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  // Focus panel: a saved goal renders as a card; the editor appears only when
  // no goal exists yet or the employee chose to edit. Nothing saves until Apply.
  const goalPanelOpen = open && panel === "goal";
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalCollapsed, setGoalCollapsed] = useState(() => readStoredFlag(GOAL_COLLAPSE_KEY));
  const toggleGoalCollapsed = () => setGoalCollapsed((current) => {
    const next = !current;
    writeStoredFlag(GOAL_COLLAPSE_KEY, next);
    return next;
  });
  const [goalDraft, setGoalDraft] = useState(goal);
  const [goalFromSuggestion, setGoalFromSuggestion] = useState(false);
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);

  /* Recaps are read with the same one-player machine the floating companion
     uses, so the Tasks tab's cards offer the same Listen control and the same
     rules: one audio owner, a prime inside the press (a webview forgets the
     gesture while the clip is synthesized), and a visible reason when a read
     cannot start instead of a silent press. */
  const [recapSpeech, setRecapSpeech] = useState<RecapSpeechSnapshot>({
    status: "idle", lines: [], progress: 0, activeIndex: 0, revision: null, reviewKey: null, intervalId: null, slow: false, retryIntervalId: null,
  });
  const [recapSpeechError, setRecapSpeechError] = useState<string | null>(null);
  const employeeAudioLease = useRef<OttoAudioLease | null>(null);
  const audioContextRef = useRef({ scope: audioScope, epoch: audioEpoch });
  // Before paint, so an async media callback cannot read a stale scope.
  useLayoutEffect(() => {
    audioContextRef.current = { scope: audioScope, epoch: audioEpoch };
  }, [audioScope, audioEpoch]);
  /* The exact read this player is speaking. A late snapshot from an account
   * or mode the window has already left cannot update the visible words. */
  const employeeReadRef = useRef<{ scope: OttoScope | null; epoch: number } | null>(null);
  // The factory records async callbacks; it never reads the refs during render.
  // eslint-disable-next-line react-hooks/refs
  const [recapPlayer] = useState(() => createRecapSpeechPlayer({
    fetchClip: (input) => apiRequestAudio("/api/work-os/voice/recap", input),
    createAudio: browserRecapAudio,
    isPlaybackAllowed: () => {
      const requested = employeeReadRef.current;
      if (!requested) return false;
      const current = audioContextRef.current;
      if (requested.scope && (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch)) return false;
      return requested.scope ? !!employeeAudioLease.current?.isActive() : true;
    },
    onSnapshot: (snapshot) => {
      const requested = employeeReadRef.current;
      if (!requested) return;
      const current = audioContextRef.current;
      if (requested.scope && (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch)) {
        employeeReadRef.current = null;
        return;
      }
      if (snapshot.status === "idle") employeeReadRef.current = null;
      setRecapSpeech(snapshot);
    },
    onFailure: (message) => {
      const requested = employeeReadRef.current;
      const current = audioContextRef.current;
      if (requested?.scope && (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch)) return;
      setRecapSpeechError(message);
    },
    // The card moved on while the clip was made: the host refreshes the stream
    // so the words on screen are the words that play next time.
    onStaleCard: () => { onRecapStale?.(); },
  }));
  const toggleRecapRead = useCallback((id: string, revision: number | null): void => {
    const active = recapPlayer.snapshot();
    if (active.intervalId === id && active.status !== "idle") {
      employeeAudioLease.current?.release();
      employeeAudioLease.current = null;
      employeeReadRef.current = null;
      recapPlayer.stop();
      return;
    }
    if (active.status !== "idle") {
      // Stop the old read before releasing or requesting ownership, so the
      // next owner never starts beside audio that is still playing here.
      employeeAudioLease.current?.release();
      employeeAudioLease.current = null;
      employeeReadRef.current = null;
      recapPlayer.stop();
    }
    setRecapSpeechError(null);
    const requested = { scope: audioScope, epoch: audioEpoch };
    if (!requested.scope) {
      employeeReadRef.current = requested;
      void recapPlayer.toggle({ intervalId: id, revision, voice: recapVoice, enabled: !!voice });
      return;
    }
    void requestOttoAudio(requested.scope, requested.epoch, "speech").then(async (lease) => {
      if (!lease.isActive()) { lease.release(); return; }
      const current = audioContextRef.current;
      if (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch) {
        lease.release();
        return;
      }
      employeeAudioLease.current?.release();
      employeeAudioLease.current = lease;
      employeeReadRef.current = requested;
      await recapPlayer.toggle({ intervalId: id, revision, voice: recapVoice, enabled: !!voice });
    }).catch((failure: unknown) => {
      setRecapSpeechError(failure instanceof Error && failure.message ? failure.message : "Audio is busy in another companion window.");
    });
  }, [audioEpoch, audioScope, recapPlayer, recapVoice, voice]);
  /* A new actor/org/mode/epoch drops the old words, error and ownership. */
  useEffect(() => {
    employeeAudioLease.current?.release();
    employeeAudioLease.current = null;
    employeeReadRef.current = null;
    recapPlayer.stop();
    setRecapSpeech({
      status: "idle", lines: [], progress: 0, activeIndex: 0, revision: null, reviewKey: null, intervalId: null, slow: false, retryIntervalId: null,
    });
    setRecapSpeechError(null);
  }, [audioEpoch, audioScope?.mode, audioScope?.organizationId, audioScope?.userId, recapPlayer]);
  useEffect(() => onOttoSpeechStop(() => {
    employeeAudioLease.current?.release();
    employeeAudioLease.current = null;
    employeeReadRef.current = null;
    recapPlayer.stop();
  }), [recapPlayer]);
  useEffect(() => {
    if (recapSpeech.status !== "idle" && recapSpeech.status !== "finished") return;
    employeeAudioLease.current?.release();
    employeeAudioLease.current = null;
  }, [recapSpeech.status]);
  /* One audio owner: a recording never starts on top of a read, and a hidden
     window never speaks to an empty room. */
  useEffect(() => {
    if (voice && voice.state !== "idle") {
      employeeAudioLease.current?.release();
      employeeAudioLease.current = null;
      employeeReadRef.current = null;
      recapPlayer.stop();
    }
  }, [voice, recapPlayer]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") recapPlayer.stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      recapPlayer.dispose();
    };
  }, [recapPlayer]);
  useEffect(() => {
    if (!goalPanelOpen || goalEditing) return;
    setGoalDraft(goal);
    setGoalFromSuggestion(false);
  }, [goalPanelOpen, goalEditing, goal]);
  // The card shows the applied text until the saved plan catches up, and falls
  // back to the authoritative goal whenever that changes (save, resync, conflict).
  useEffect(() => { setPendingGoal(null); }, [goal]);
  const cardGoal = pendingGoal ?? goal;
  const goalApplyDisabled = saveState === "saving" || goalDraft.trim() === cardGoal.trim();
  const applyGoalDraft = () => {
    const next = goalDraft.trim();
    onApplyGoal(next, goalFromSuggestion);
    setPendingGoal(next);
    setGoalEditing(false);
  };
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const [sweepSignal, setSweepSignal] = useState(0);
  const bumpSweep = () => setSweepSignal((value) => value + 1);
  const wasOpenRef = useRef(open);
  const threadMetricsRef = useRef<{ scrollHeight: number } | null>(null);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    const el = conversationRef.current;
    if (!el) return;
    const newest = el.lastElementChild as HTMLElement | null;
    const isTurn = !!newest && !newest.classList.contains("progress-history");
    /* Compare the reader's position against the height before this arrival, so a
       reply that grows the thread does not look like a scroll-up. */
    const previousHeight = threadMetricsRef.current?.scrollHeight ?? el.scrollHeight;
    const wasAtBottom = previousHeight - el.scrollTop - el.clientHeight < 48;
    const target = threadScrollTarget({
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      newestHeight: isTurn ? newest!.offsetHeight : 0,
      newestTop: isTurn ? newest!.getBoundingClientRect().top - el.getBoundingClientRect().top : 0,
      wasAtBottom,
      forceBottom: justOpened,
    });
    if (target !== null) el.scrollTop = target;
    threadMetricsRef.current = { scrollHeight: el.scrollHeight };
  }, [history.length, interpretation, pending, receipt, open]);
  const previousOpenRef = useRef(open);
  useEffect(() => {
    if (!open && previousOpenRef.current) {
      const frame = window.requestAnimationFrame(() => launcherRef.current?.focus());
      previousOpenRef.current = open;
      return () => window.cancelAnimationFrame(frame);
    }
    previousOpenRef.current = open;
    return undefined;
  }, [open]);
  const options: Array<{ kind: ProgressUpdateKind; label: string }> = [
    { kind: "material_progress", label: "Progress" }, { kind: "completion_claim", label: "Completed work" },
    { kind: "blocked", label: "Blocker" }, { kind: "priority_change", label: "Priority change" }, { kind: "new_task", label: "New task" },
  ];
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  const agendaMode = mode === "agenda";
  const visibleHistory = collapseConsecutiveAssistantDuplicates(history);
  const showLiveAssistantMark = visibleHistory.at(-1)?.role !== "assistant";
  const lastAssistantText = [...visibleHistory].reverse().find((turn) => turn.role === "assistant")?.text.trim() ?? null;
  const echoReply = interpretation?.status === "ready" && !interpretation.operations.length && interpretation.reply && interpretation.reply.trim() !== lastAssistantText ? interpretation.reply : null;
  // A live turn's clock is the moment it first appeared; once it lands in
  // history, the persisted turn's own createdAt takes over.
  const echoReplyAt = useMemo(() => new Date().toISOString(), [echoReply]);
  // One live reply keeps one arrival time: key on the review identity and
  // status, not the object, so result merges never reset the clock.
  const interpretationAt = useMemo(() => new Date().toISOString(), [interpretation?.reviewId, interpretation?.status]);
  const receiptTitle = receipt?.kind === "new_task"
    ? receipt.queued ? "Task queued" : "Task added"
    : receipt?.queued ? "Update queued" : "Update recorded";
  return <ConversationSurface
    surface="in-app"
    open={open}
    ariaLabel={panel === "goal" ? "Daily focus editor" : "Daily update conversation"}
    className={`progress-dock ${agendaMode ? "agenda-dock" : "progress-mode"} ${open ? "open" : ""}`}
  >
    {open ? <div className="chat-surface is-open" id="conversation-panel">
    <section className={`progress-flyout ${panel === "goal" ? "goal-flyout" : agendaMode ? "agenda-flyout" : ""}`} role="dialog" aria-label={panel === "goal" ? "Daily focus editor" : "Daily update composer"}>
      <header className="workos-chat-head"><span className="conversation-pane-title">{MASCOT.name}</span><ChatTabs tabs={[{ id: "update", label: agendaMode ? "Chat" : "Update" }, { id: "goal", label: "Focus" }]} active={panel} onSelect={(id) => { if (id === "goal") onOpenGoal(); else onOpen(); }} ariaLabel="Composer view" /><span className="progress-header-actions">{panel !== "goal" && <button aria-label="Start a new chat" title="Start a new chat" onClick={onClearChat}><SquarePen size={15} /></button>}<button aria-label="Close composer" onClick={onClose}><X size={16} /></button></span></header>
      {panel === "goal" ? <p className="workos-chat-sub">{`${goalProvenance === "suggested" ? `Suggested by ${MASCOT.name}` : goalProvenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : goalProvenance === "accepted_suggestion" ? "Accepted suggestion" : goal ? "Written by you" : "Optional context"} · ${saveLabel}`}{onRetryGoalSave && (saveState === "offline" || saveState === "conflict") ? <button type="button" className="goal-retry" aria-label="Retry saving the goal" title={saveState === "conflict" ? "Goal not saved — refresh the day, then retry." : "Goal not saved — click to retry."} onClick={onRetryGoalSave}><RefreshCw size={12} /></button> : null}</p> : required ? <p className="workos-chat-sub">An update is due</p> : null}
        {panel === "goal" ? <div className="conversation-scroll-region"><div className="goal-composer-panel">
          <section className={`focus-goal${goalCollapsed ? " is-collapsed" : ""}`} aria-labelledby="focus-goal-heading">
            <header className="focus-goal-head">
              <span className="focus-goal-eyebrow" id="focus-goal-heading">Today’s focus</span>
              <button type="button" className="focus-goal-disclosure" aria-expanded={!goalCollapsed} aria-controls="focus-goal-body" aria-label={goalCollapsed ? "Show today’s focus" : "Hide today’s focus"} title={goalCollapsed ? "Show today’s focus" : "Hide today’s focus"} onClick={toggleGoalCollapsed}>
                <ChevronDown size={16} aria-hidden="true" className={`chat-task-chevron${goalCollapsed ? "" : " is-open"}`} />
              </button>
            </header>
            <div id="focus-goal-body" className="focus-goal-body" hidden={goalCollapsed}>{cardGoal && !goalEditing ? <div className="goal-card">
         <button type="button" className="goal-card-edit" aria-label="Edit today’s focus" title="Edit today’s focus" onClick={() => { setGoalDraft(cardGoal); setGoalFromSuggestion(false); setGoalEditing(true); }}><Pencil size={14} aria-hidden="true" /></button>
         <p className="goal-card-text">{cardGoal}</p>
       </div> : <>
         <div className="goal-editor-field"><label htmlFor="daily-focus-input">What is the goal for today?</label><small id="daily-focus-help">Tasks remain the source of work intent. This note adds context and does not affect attendance.</small><textarea id="daily-focus-input" aria-describedby="daily-focus-help" autoFocus maxLength={4000} value={goalDraft} onChange={(event) => { setGoalDraft(event.target.value); setGoalFromSuggestion(false); }} placeholder="Add context that is not obvious from your tasks" /></div>
         {!cardGoal && goalSuggestion && <div className="goal-suggestion composer-goal-suggestion"><Sparkles size={16} /><div><strong>Suggested from today’s tasks</strong><p>{goalSuggestion.text}</p></div><button type="button" onClick={() => { setGoalDraft(goalSuggestion.text); setGoalFromSuggestion(true); }}>Use suggestion</button></div>}
         <div className="goal-editor-actions"><button type="button" className="primary" disabled={goalApplyDisabled} onClick={applyGoalDraft}>{cardGoal ? "Apply" : "Apply goal"}</button>{cardGoal ? <button type="button" className="secondary" onClick={() => { setGoalEditing(false); setGoalDraft(cardGoal); setGoalFromSuggestion(false); }}>Cancel</button> : null}</div>
               </>}</div>
          </section>
          {recapSpeechError ? <p className="chat-activity-error" role="alert">{recapSpeechError}</p> : null}
          {activityDate ? <ActivityIntervalStream date={activityDate} timezone={activityTimezone} pollMs={activityPollMs} onListen={voice ? toggleRecapRead : undefined} listeningId={recapSpeech.status !== "idle" ? recapSpeech.intervalId : null} /> : null}</div></div> : <div className="conversation-scroll-region"><div className="progress-conversation workos-thread" ref={conversationRef}>{visibleHistory.length > 0 && <div className="progress-history">{visibleHistory.map((turn, index) => <Fragment key={turn.id ?? index}>
  {shouldShowChatDivider(visibleHistory, index) ? <ChatTimeDivider at={turn.createdAt} /> : null}
  <HistoryTurn
  turn={{
    ...turn,
    meta: turn.meta === "recorded" ? "Recorded" : turn.meta ? `${turn.meta} · Review below` : null,
    operations: turn.operations as HistoryTurnData["operations"],
    toolResults: turn.toolResults as HistoryTurnData["toolResults"],
  }}
  busy={busy}
  toolContext={toolContext}
  showMark={index === 0 || visibleHistory[index - 1]?.role !== "assistant"}
  collapseCards={index < visibleHistory.length - 1}
  onReviewOperations={(approved, rejected) => onReviewHistoryOperations?.(turn.id, approved, rejected)}
  onMarkSelectedDone={onMarkSelectedDone}
  onLoadSubtasks={onLoadSubtasks}
  onNavigateView={onNavigateView}
  onDecideNextStep={(item, decision, edits) => onDecideNextStep?.(turn.id, item, decision, edits)}
  onRetryOperation={(result) => onRetryHistoryOperation?.(turn.id, result)}
  />
</Fragment>)}</div>}{receipt ? <ChatTurn role="assistant" showMark={showLiveAssistantMark} receipt meta={receiptTitle} text={receipt.message} copySource={{ role: "assistant", receipt: receipt.message }} timestamp={receipt.createdAt} /> : pending ? <>{interpretation?.status === "loading" ? <ChatTurn role="assistant" variant="tool">{thinking ? <AvatarThinking stages={thinking.stages} active={thinking.active} startedAt={thinking.startedAt} activeLabel="Thinking" /> : <WorkingNowTrace label="Sending your update" />}</ChatTurn>
   : echoReply ? <ChatTurn role="assistant" showMark={showLiveAssistantMark} text={echoReply} stream onSettled={bumpSweep} timestamp={echoReplyAt} />
       : interpretation?.status === "ready" && interpretation.operations.length ? <ChatTurn role="assistant" showMark={showLiveAssistantMark} copySource={{ role: "assistant", text: interpretation.reply, operations: interpretation.operations, toolResults: interpretation.results }} timestamp={interpretationAt}><AssistantOperations interpretation={interpretation} busy={busy} toolContext={toolContext} onReviewOperations={onReviewOperations} onMarkSelectedDone={onMarkSelectedDone} onLoadSubtasks={onLoadSubtasks} onNavigateView={onNavigateView} onRetryOperation={onRetryOperation} /></ChatTurn>

  : interpretation?.status === "ready" ? null
   : <ChatTurn role="assistant" showMark={showLiveAssistantMark}><strong>{aiUnavailable ?? "What kind of update is this?"}</strong><p>Choose one so Work OS records it correctly.{aiUnavailable ? "" : " Nothing is inferred yet."}</p><div className="chat-kind-options">{options.map((option) => <button disabled={busy} key={option.kind} onClick={() => onClassify(option.kind)}>{option.label}</button>)}</div></ChatTurn>}</> : history.length ? null : <ChatWelcome displayName={displayName} mode={agendaMode ? "agenda" : "update"} seed={`in-app:${toolContext.shiftDate ?? "today"}`} />}</div></div>}
    </section>
    <div className="progress-input-shell">
      <WorkOsPromptBar autoFocus={open && panel === "update"} voice={voice} hotkeyLabel={VOICE_HOTKEY_LABEL} sweepSignal={sweepSignal} value={input} onChange={onInput} onSend={onSubmit} onFocus={onOpen} onPlus={onOpen} placeholder={agendaMode ? "Add a task — planning doesn't clock you in…" : "Share an update or add a task…"} ariaLabel="Share an update or add a task" canSend={!!input.trim()} busy={busy} commands={workOsChatCommands({ focus: () => onOpenGoal(), eod: () => onNavigateView?.("review") })} sendLabel="Review update type" />
    </div>
    </div>
    : <ConversationLauncher ref={launcherRef} mode={agendaMode ? "agenda" : "progress"} required={required} onOpen={onOpen} />}
  </ConversationSurface>;
}

export function ShiftPulseCard({ pulse, now, shift, active, attendance, initialDetailsOpen = false, initialMenuOpen = false }: {
  pulse: ReturnType<typeof shiftPulse>; now: Date; shift: DayData["shift"];
  active: boolean; attendance: DayData["attendance"] | null; initialDetailsOpen?: boolean; initialMenuOpen?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(initialMenuOpen);
  const [detailsOpen, setDetailsOpen] = useState(initialDetailsOpen);
  const disclosureRef = useRef<HTMLDivElement>(null);
  const timezone = shift?.timezone;
  const progress = Math.round(pulse.progressPercent);
  const observationEnded = Boolean(attendance?.clockedOutAt);
  const providerState = attendance?.stale
    ? "Stale"
    : observationEnded
      ? "Observed session ended"
      : attendance?.clockedInAt && attendance?.state === "off_shift"
        ? "Last activity observed"
      : attendance?.status
        ? sentence(attendance.status)
        : "Unavailable";
  const state = active
    ? "Work OS live"
    : attendance?.state === "active" || attendance?.state === "paused"
      ? "Activity observed"
      : observationEnded
        ? "Observation complete"
        : attendance?.clockedInAt && attendance?.state === "off_shift"
          ? "No current activity"
        : "Waiting";
  const observationClass = attendance?.stale
    ? "stale"
    : attendance?.status === "break"
      ? "break"
      : attendance?.state === "active"
        ? "active"
        : "idle";
  const providerClockOut = worktivityClockOutLabel(attendance, timezone);
  const scheduleLabel = pulse.schedulePhase === "upcoming" ? "Next shift" : "Scheduled shift";
  const scheduleStatus = pulse.schedulePhase === "upcoming" ? "upcoming" : pulse.schedulePhase === "complete" ? "complete" : "elapsed";
  const middleLabel = pulse.schedulePhase === "upcoming" ? "Starts in" : pulse.schedulePhase === "complete" ? "Shift status" : "Time remaining";
  const middleValue = pulse.schedulePhase === "upcoming"
    ? remainingShiftLabel(shift?.startsAt, now)
    : pulse.schedulePhase === "complete"
      ? "Complete"
      : remainingShiftLabel(shift?.endsAt, now);
  const scheduleAria = pulse.schedulePhase === "upcoming"
    ? "The next scheduled shift has not started"
    : `${progress}% of the scheduled shift has passed`;
  const phaseCaption = pulse.schedulePhase === "upcoming"
    ? `Starts at ${formatTime(shift?.startsAt, timezone)}`
    : pulse.schedulePhase === "complete"
      ? `Ended at ${formatTime(shift?.endsAt, timezone)}`
      : `Ends at ${formatTime(shift?.endsAt, timezone)}`;

  useEffect(() => {
    if (!menuOpen && !detailsOpen) return;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof MouseEvent && disclosureRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
      setDetailsOpen(false);
    };
    window.addEventListener("keydown", close);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("keydown", close);
      window.removeEventListener("pointerdown", close);
    };
  }, [detailsOpen, menuOpen]);

  return <section className="pulse-card pre-shift-pulse">
    <div className="card-title pulse-title"><span><Activity size={17} /> Shift pulse</span><div className="pulse-card-controls"><small><i className={active ? "live" : attendance?.state === "active" ? "observed" : ""} />{state}</small><div className="pulse-disclosure" ref={disclosureRef}><button className="ellipsis-button pulse-more" aria-label="Shift pulse options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen((value) => !value); setDetailsOpen(false); }}><MoreHorizontal size={17} /></button>{menuOpen && <div className="pulse-menu" role="menu" onKeyDown={(event) => moveMenuFocus(event.nativeEvent)}><button role="menuitem" autoFocus onClick={() => { setMenuOpen(false); setDetailsOpen(true); }}><Activity size={15} /><span><strong>Worktivity status</strong><small>View provider attendance</small></span><ChevronRight size={14} /></button></div>}{detailsOpen && <section className={`pulse-provider-popover ${observationClass}`} role="dialog" aria-label="Worktivity status"><header><div><Activity size={16} /><span><small>Worktivity attendance</small><strong>{providerState}</strong></span></div><button aria-label="Close Worktivity status" onClick={() => setDetailsOpen(false)}><X size={15} /></button></header><div className="pulse-provider-facts"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{providerClockOut}</strong></span><span><small>Last activity</small><strong>{attendance?.activityObservedAt ? formatTime(attendance.activityObservedAt, timezone) : "—"}</strong></span><span><small>Observed active time</small><strong>{pulse.observedElapsedLabel}</strong></span><span><small>Provider refresh</small><strong>{attendance?.observedAt ? formatTime(attendance.observedAt, timezone) : "—"}</strong></span><span><small>OnBreak deducted</small><strong>{pulse.observedBreakLabel}</strong></span></div><footer>Worktivity is the attendance source; Work OS mirrors fresh provider status.</footer></section>}</div></div></div>
    <div className="pulse-countdown" role="img" aria-label={scheduleAria}>
      <div className="pulse-countdown-copy"><small>{middleLabel}</small><strong>{middleValue}</strong><span>{phaseCaption}</span></div>
      <div className="pulse-window"><CalendarDays size={17} /><div><small>{scheduleLabel}</small><strong>{formatTime(shift?.startsAt, timezone)} <i>to</i> {formatTime(shift?.endsAt, timezone)}</strong></div></div>
    </div>
    <div className="pulse-compact-track" aria-hidden="true"><div><i style={{ width: `${pulse.progressPercent}%` }} /><b style={{ left: `clamp(5px, ${pulse.progressPercent}%, calc(100% - 5px))` }} /></div><span><small>{formatTime(shift?.startsAt, timezone)}</small><small>{scheduleStatus}</small><small>{formatTime(shift?.endsAt, timezone)}</small></span></div>
    <p className="pulse-separation-note"><Clock3 size={13} /> Worktivity owns clock actions; the Windows Companion waits for provider confirmation.</p>
  </section>;
}

/** Render the employee Tasks workspace with shared day history and sorted paginated views. */
export function TasksWorkspace({ currentDate, historyDate, backlog = null, backlogLoading = false, backlogError = false, currentPlan, historicalPlan, historicalTasks, goal, goalProvenance, suggestion, saveState, taskView, taskSort, todayTasks, taskHistory, workspaceHistory = taskHistory, completedHistory = null, unfinishedHistory = null, pageCounts = null, pageTotal = null, taskSearch = "", filterFrom = "", filterTo = "", historyOrder = "local", historyError = false, historyHasData = false, carryOver, carryOverOpen, loadingMore, loadMoreError = false, hasMore, busy, initialTaskMenuId = null, initialFiltersOpen = false, loading = false, onTaskView, onTaskSort, onTaskSearch, onFilterFrom, onFilterTo, onDate, onEditFocus, onAddTask, onOpenTask, onEditTask, onArchiveTask, onDeleteTask = () => undefined, onSurfaceTask, onTaskCompletion, onCarryOverOpen, onLoadMore, onRetryHistory, onRetryPendingTask, onDismissPendingTask, onRetryGoalSave, taskFlight, onStatusTask, onAssignTask }: {
  onStatusTask?: (task: TaskRow, status: "pending" | "in_progress") => void;
  onAssignTask?: (task: TaskRow) => void;
  currentDate: string; historyDate: string; currentPlan: DailyPlan | null; historicalPlan: DailyPlan | null; historicalTasks: TaskRow[]; goal: string;
  goalProvenance: "employee" | "suggested" | "accepted_suggestion" | "ai_draft" | null; suggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  taskView: TaskView; taskSort: TaskSort; todayTasks: TaskRow[]; taskHistory: TaskRow[]; workspaceHistory?: TaskRow[]; completedHistory?: TaskRow[] | null; unfinishedHistory?: TaskRow[] | null;
  pageCounts?: { total: number; open: number; completed: number } | null; pageTotal?: number | null;
  taskSearch?: string; filterFrom?: string; filterTo?: string;
  historyOrder?: "server" | "local"; historyError?: boolean; historyHasData?: boolean; onRetryHistory?: () => void;
  carryOver: ReturnType<typeof unfinishedBefore>; carryOverOpen: boolean;
  backlog?: TaskBacklog | null; backlogLoading?: boolean; backlogError?: boolean;
  loadingMore: boolean; loadMoreError?: boolean; hasMore: boolean; busy: boolean; onTaskView: (view: TaskView) => void; onTaskSort: (sort: TaskSort) => void; onDate: (date: string) => Promise<void>;
  onEditFocus: () => void; onAddTask: () => void; onOpenTask: (task: TaskRow, readOnly: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask?: (task: TaskRow) => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void; onTaskCompletion: (task: TaskRow, completed: boolean) => void; onCarryOverOpen: (open: boolean) => void; onLoadMore: () => void;
  taskFlight?: ReadonlyMap<string, "completing" | "leaving">;
  onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void; onRetryGoalSave?: () => void;
  initialTaskMenuId?: string | null; initialFiltersOpen?: boolean; loading?: boolean;
  onTaskSearch?: (value: string) => void; onFilterFrom?: (value: string) => void; onFilterTo?: (value: string) => void;
}) {
  const [taskMenuId, setTaskMenuId] = useState<string | null>(initialTaskMenuId);
  const [filtersOpen, setFiltersOpen] = useState(initialFiltersOpen);
  const taskTabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedDate = historyDate || currentDate;
  const historical = selectedDate !== currentDate;
  const shownPlan = historical ? historicalPlan : currentPlan;
  const historyById = new Map<string, TaskRow>();
  for (const task of [...taskHistory, ...workspaceHistory, ...(completedHistory ?? []), ...historicalTasks]) {
    historyById.set(String(task.id), task);
    if (task.provider_task_id) historyById.set(String(task.provider_task_id), task);
  }
  const surfaced = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => historyById.get(String(item.task_id)) ?? {
    id: item.task_id, title: item.title_snapshot, completed: item.completion_state === "completed", workspace_source: item.source,
  });
  const surfacedIds = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => String(item.task_id));
  const rowId = (task: TaskRow) => String(task.provider_task_id || task.id);
  // My day is strictly day-scoped and shares one definition with the dashboard
  // hero (design §27.3), so both surfaces count the identical set.
  const myDayTasks = dayScopedTasks(todayTasks, currentPlan?.items ?? [], currentDate, [...taskHistory, ...historicalTasks]);
  const myDayIds = new Set(myDayTasks.map(rowId));
  // Live Unfinished pages are server-filtered and cursor-paged. Until a page
  // exists, the complete backlog minus today's workspace is the exact
  // exclude-today set the Unfinished view renders.
  const backlogParents = parentTasks(uniqueTasks(backlog?.tasks ?? []));
  const unfinishedFallback = backlog
    ? backlogParents.filter((task) => !myDayIds.has(rowId(task)))
    : taskHistory.filter((task) => task.completed !== true && !myDayIds.has(rowId(task)));
  const unfinishedTasks = unfinishedHistory ?? unfinishedFallback;
  const completedTasks = completedHistory ?? taskHistory.filter((task) => task.completed === true);
  const datedTasks = parentTasks(tasksForDate([...historicalTasks, ...surfaced], selectedDate, surfacedIds));
  const displayedCandidates = historical
    ? datedTasks
    : taskView === "today" ? myDayTasks
      : taskView === "unfinished" ? unfinishedTasks
        : taskView === "completed" ? completedTasks
          : workspaceHistory;
  const unfiltered = parentTasks(uniqueTasks(displayedCandidates));
  // Paginated history views arrive already filtered and sorted by the server;
  // re-filtering here would re-apply the older client rules and could hide
  // rows the server (and its counts) kept. My day still filters locally
  // because `dayScopedTasks` merges plan-surfaced rows on the client.
  const serverBackedRows = !historical && taskView !== "today";
  const displayed = historyOrder === "server" && serverBackedRows
    ? unfiltered
    : filterWorkspaceTasks(unfiltered, currentDate, { query: taskSearch, from: filterFrom, to: filterTo });
  const hasFilters = taskSearch.trim().length > 0 || filterFrom.length > 0 || filterTo.length > 0;
  const viewLabel = taskView === "today" ? "My day" : taskView === "unfinished" ? "Unfinished" : taskView === "completed" ? "Completed" : "All tasks";
  // Every chip counts the exact parents its view will render, subtasks and
  // duplicates excluded, so a chip can never disagree with its own list.
  const serverCounts = backlog?.counts ?? null;
  // Null counts mean the server does not provide totals yet; chips fall back to
  // the loaded window and no pagination note is claimed.
  const chipCounts: Array<{ id: TaskView; label: string; count: number }> = [
    { id: "today", label: "My day", count: dayTaskGroups(myDayTasks, currentDate, taskSort).reduce((sum, group) => sum + group.tasks.filter((task) => task.completed !== true).length, 0) },
    { id: "unfinished", label: "Unfinished", count: taskView === "unfinished" ? pageCounts?.open ?? parentTasks(uniqueTasks(unfinishedTasks)).length : parentTasks(uniqueTasks(unfinishedFallback)).length },
    { id: "completed", label: "Completed", count: (taskView === "all" || taskView === "completed") && pageCounts ? pageCounts.completed : serverCounts?.completed ?? parentTasks(uniqueTasks(completedTasks)).length },
    { id: "all", label: "All tasks", count: (taskView === "all" || taskView === "completed") && pageCounts ? pageCounts.total : serverCounts?.total ?? parentTasks(uniqueTasks(workspaceHistory)).length },
  ];
  // Peer views keep one tab stop and move between views with the shared
  // ←/→/Home/End contract (design §8.13).
  const onTaskTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = taskViewTabIndex(index, event.key, chipCounts.length);
    if (next === null) return;
    event.preventDefault();
    onTaskView(chipCounts[next].id);
    requestAnimationFrame(() => taskTabRefs.current[next]?.focus());
  };
  // Paginated views say how much of the server total is on screen so a chip
  // can never look like it disagrees with its own list.
  const viewTotal = pageTotal ?? (historical ? null : taskView === "all" ? serverCounts?.total ?? null : taskView === "completed" ? serverCounts?.completed ?? null : null);
  const overflowNote = viewTotal !== null && unfiltered.length < viewTotal ? `Showing ${unfiltered.length} of ${viewTotal}` : null;
  // My day is open work only: completed tasks move to the Completed view.
  // All / Completed arrive globally ordered from SQL before pagination; do not
  // re-sort flattened pages on the client or rows can cross page boundaries.
  const rowsForDisplay = taskView === "today" && !historical
    ? displayed.filter((task) => task.completed !== true)
    : displayed;
  // Only server-backed views arrive pre-sorted. My day is assembled on the
  // client, so it must apply the active sort here or the header arrows lie.
  const displayedTasks = !historical && historyOrder === "server" && serverBackedRows
    ? rowsForDisplay
    : sortTaskList(rowsForDisplay, taskSort, currentDate);

  // My day renders urgency groups from the same rows the filters left behind.
  const dayGroupsForDisplay = taskView === "today" && !historical
    ? dayTaskGroups(displayedTasks, currentDate, taskSort)
    : [];

  // The project line only earns its space when the view actually mixes projects.
  const showRowProjects = new Set(displayedTasks.map((task) => safeTaskText(task.project?.name, "Work OS"))).size > 1;
  const listRef = useRef<HTMLDivElement | null>(null);
  useListShift(listRef);
  const selectedIds = new Set((currentPlan?.items ?? []).filter((item) => item.disposition === "selected" && item.task_id).map((item) => String(item.task_id)));
  const groups = new Map<string, typeof carryOver>();
  for (const item of carryOver) {
    const key = item.attribution.date ?? "Older";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const carryGroups = [...groups.entries()].map(([date, items]) => ({ date, label: date === moveDate(currentDate, -1) ? `Yesterday · ${formatWorkOsDate(date)}` : formatWorkOsDate(date), items }));
  const agendaText = historical
    ? shownPlan?.focus_summary ?? (shownPlan?.freeform_intent || "No focus note was recorded for this day.")
    : goal || suggestion?.text || "Your open tasks define today’s work.";
  const provenance = historical
    ? !shownPlan?.freeform_intent ? "Task record" : shownPlan.goal_provenance === "suggested" ? `Suggested by ${MASCOT.name}` : shownPlan.goal_provenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : shownPlan.goal_provenance === "accepted_suggestion" ? "Accepted from that day’s tasks" : "Written on this day"
    : goal ? goalProvenance === "suggested" ? `Suggested by ${MASCOT.name}` : goalProvenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : goalProvenance === "accepted_suggestion" ? "Accepted from today’s tasks" : "Written by you" : suggestion ? "Suggested from today’s tasks" : "Task record";
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  const dateFilterActive = !!filterFrom || !!filterTo;
  // One source for the day's groups: they are built from the same my-day list
  // the view renders, so a group's count can never contradict the rows beneath
  // it. The strip no longer restates those counts — it states the focus and the
  // carry action, and the groups and view chips carry the numbers.
  const dayGroups = dayTaskGroups(myDayTasks, currentDate, taskSort);
  useEffect(() => {
    if (!filtersOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".task-filters-wrap")) setFiltersOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setFiltersOpen(false); };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [filtersOpen]);
  const emptyCopy = hasFilters
    ? { title: "No tasks match these filters", body: "Try a different search or clear the date filters." }
    : historical
      ? { title: "No tasks surfaced", body: "No tasks were recorded for this day." }
      : taskView === "today"
        ? { title: "Nothing is scheduled for today yet", body: "Pull unfinished work forward or add a task to shape the day." }
        : taskView === "unfinished"
          ? { title: "No unfinished work", body: "Open tasks from previous days will appear here." }
          : taskView === "completed"
            ? { title: "No completed tasks", body: "Completed tasks will appear here." }
            : { title: "No tasks yet", body: "Add your first task to get started." };
  const renderTaskRow = (task: TaskRow) => {
      const attribution = taskDateAttribution(task, currentDate);
      const taskId = rowId(task);
      const menuOpen = taskMenuId === taskId;
      const progress = subtaskProgress(task);
      // "On today" is a plan fact, not a selection. It used to be published as
      // aria-selected, which is invalid on role="button" and — because every
      // My day row is on today's plan — made the whole list wear §6.3's selected
      // chrome at once, so selection stopped discriminating.
      const onTodayPlan = selectedIds.has(String(task.id)) || selectedIds.has(String(task.provider_task_id));
      const state = taskState(task, currentDate);
      const displayState = displayTaskState(task, currentDate);
      const title = safeTaskText(task.title, "Untitled task");
      const description = safeTaskText(task.description, "");
      // §6.2: the description renders only when it adds something beyond the
      // title. Literal containment only caught a description that repeated the
      // title's own words verbatim, so a reworded restatement still cost the row
      // a third line; counting the title's vocabulary catches both.
      const descriptionEchoesTitle = (() => {
        const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        const titleText = normalize(title);
        const descriptionText = normalize(description);
        if (descriptionText.length === 0) return true;
        if (titleText.length === 0) return false;
        if (descriptionText === titleText || descriptionText.includes(titleText)) return true;
        // Words of four letters or more carry the meaning; articles and
        // prepositions only dilute the comparison.
        const contentWords = (value: string) => value.split(" ").filter((word) => word.length > 3);
        const titleWords = new Set(contentWords(titleText));
        const descriptionWords = contentWords(descriptionText);
        if (titleWords.size === 0 || descriptionWords.length === 0) return false;
        const carried = descriptionWords.filter((word) => titleWords.has(word)).length;
        return carried / descriptionWords.length >= 0.8;
      })();
      const projectName = safeTaskText(task.project?.name, "Work OS");
      const milestoneName = safeTaskText(task.milestone?.name, "");
      const dueDate = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
      const dueInline = dueDate ? (state === "overdue" ? `Overdue · ${formatWorkOsDate(dueDate)}` : dueDate === currentDate ? "Due today" : `Due ${formatWorkOsDate(dueDate)}`) : null;
      const showProject = showRowProjects && projectName !== "Work OS";
      const metaParts = [milestoneName || null, task.priority ? `${sentence(String(task.priority))} priority` : null].filter(Boolean) as string[];
      // Per-row provenance is warning-only; a healthy "synced" chip on every
      // row is noise. The detail modal keeps the full provenance chip.
      const showSyncChip = !task.completed && (Boolean(task.sync_error) || !task.synced_at);
      const stateLabel = taskStatusLabel(displayState);
      const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null;
      const syncPending = !task.completed && (Boolean(task.sync_error) || !task.synced_at);
      const flight = taskFlight?.get(taskId) ?? null;
      // Surface / defer / open-original-day are not capability-gated, so the
      // trigger stays for open rows and for completed rows with a real action.
      const hasMenu = hasTaskMenu(task, currentDate) || !task.completed || Boolean(attribution.date && attribution.date < currentDate);
      return <article className={`task-record workspace-task ${task.completed ? "is-completed" : ""}${flight === "leaving" ? " is-leaving" : ""}`} role="button" data-pan-row="true" tabIndex={0} key={taskId} data-list-key={taskId} onClick={() => { if (!pendingStatus && !flight) onOpenTask(task, historical); }} onKeyDown={(event) => { if (pendingStatus || flight) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task, historical); } }}><button className={`task-check${flight === "completing" ? " is-completing" : ""}`} {...taskCheckboxA11y(task, flight === "completing", title)} aria-busy={flight === "completing"} disabled={historical || pendingStatus !== null || !taskCheckboxEnabled(task)} onClick={(event) => { event.stopPropagation(); if (!pendingStatus && !flight) onTaskCompletion(task, !task.completed); }}>{flight === "completing" ? <FadeArc size={13} /> : (task.completed || flight === "leaving") ? <Check size={14} /> : null}</button><div className="task-row-body"><div className="task-row-line primary-line"><h3><OverflowPanText>{title}</OverflowPanText></h3>{onTodayPlan && taskView !== "today" && task.completed !== true && <span className="surfaced-tag">On today</span>}</div>{(showProject || metaParts.length > 0 || syncPending) && <div className="task-row-line secondary-line"><AssigneeTags task={task} />{showProject ? <small className="task-meta-project">{projectName}</small> : null}{metaParts.length > 0 && <small>{metaParts.join(" · ")}</small>}{syncPending && <small className="sync-warn">sync pending</small>}</div>}{dueInline ? <small className={`task-meta-due${state === "overdue" ? " danger" : ""}`}>{dueInline}</small> : null}{description && !descriptionEchoesTitle ? <p className="task-row-desc"><OverflowPanText pan={false}>{description}</OverflowPanText></p> : null}</div>{!pendingStatus && progress.total > 0 && <span className="task-row-ring"><ProgressRing completed={progress.completed} total={progress.total} label="subtasks" /></span>}{!pendingStatus && dueDate && <span className={`task-due ${state === "overdue" ? "danger" : ""}`}>{formatWorkOsDate(dueDate)}</span>}{pendingStatus ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} /> : <span className={`task-state ${displayState}`}>{stateLabel}</span>}{!historical && !pendingStatus && hasMenu && <div className={`workspace-task-menu ${menuOpen ? "open" : ""}`} onClick={(event) => event.stopPropagation()}><EllipsisMenu open={menuOpen} label={`Actions for ${title}`} disabled={busy} onToggle={() => setTaskMenuId(menuOpen ? null : taskId)} onClose={() => setTaskMenuId(null)}>
        <TaskActionMenuItems task={task} currentDate={currentDate} busy={busy} onStatus={(status) => onStatusTask?.(task, status)} onComplete={(completed) => onTaskCompletion(task, completed)} onEdit={() => onEditTask(task)} onAssign={onAssignTask ? () => onAssignTask(task) : undefined} onArchive={() => onArchiveTask(task)} onDelete={() => onDeleteTask(task)} onClose={() => setTaskMenuId(null)} />
        {!task.completed && !onTodayPlan && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task); }}><Plus size={14} /> Add to today</button>}{!task.completed && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task, "deferred"); }}><CirclePause size={14} /> Defer</button>}{attribution.date && attribution.date < currentDate && <button role="menuitem" onClick={() => { setTaskMenuId(null); void onDate(attribution.date!); }}><ChevronLeft size={14} /> Open original day</button>}</EllipsisMenu></div>}</article>;
  };

  return <main className="page tasks-workspace">
    <section className={`panel task-agenda-strip ${historical ? "historical" : ""}`} aria-label="Agenda">
      <div className="agenda-strip-focus">
        <span className="task-focus-kicker"><Target size={12} aria-hidden="true" /> {historical ? "Workday focus" : "Today's focus"}</span>
        {!historical ? <button type="button" className="agenda-strip-edit" onClick={onEditFocus} title="Edit focus"><OverflowPanText className="agenda-strip-focus-scroll" lineClassName="agenda-strip-text">{agendaText}</OverflowPanText><Pencil size={13} aria-hidden="true" /></button> : <OverflowPanText className="agenda-strip-focus-scroll" lineClassName="agenda-strip-text">{agendaText}</OverflowPanText>}
        <small className="agenda-strip-meta">{provenance}{!historical ? ` · ${saveLabel}` : ""}{!historical && saveState === "saving" ? <FadeArc size={11} /> : null}{!historical && (saveState === "offline" || saveState === "conflict") ? <button type="button" className="goal-retry" title={saveState === "conflict" ? "Goal not saved — refresh the day, then retry." : "Goal not saved — click to retry."} aria-label="Retry saving the goal" onClick={() => onRetryGoalSave?.()}><RefreshCw size={11} /></button> : null}</small>
      </div>
      {!historical && carryOver.length > 0 && <button className="agenda-strip-carry" aria-label={`Review unfinished work — ${carryOver.length} unfinished task${carryOver.length === 1 ? "" : "s"}`} onClick={() => onCarryOverOpen(true)}><span className="carry-count" aria-hidden="true"><b>{carryOver.length > 99 ? "99+" : carryOver.length}</b><small>{carryOver.length === 1 ? "unfinished task" : "unfinished tasks"}</small></span><AlertTriangle size={13} aria-hidden="true" /> Review unfinished work <ChevronRight size={13} aria-hidden="true" /></button>}
    </section>
    <section className="panel task-list-panel" aria-label="Task list"><h2 className="sr-only">{historical ? `Tasks from ${formatWorkOsDate(selectedDate)}` : viewLabel}</h2>
      <header className="task-list-header">
        {!historical && <nav className="task-list-tabs" role="tablist" aria-label="Task views">{chipCounts.map(({ id, label, count }, index) => <button key={id} ref={(node) => { taskTabRefs.current[index] = node; }} id={`task-list-tab-${id}`} role="tab" aria-controls="task-list-panel" aria-selected={taskView === id} tabIndex={taskView === id ? 0 : -1} className={`task-list-tab ${taskView === id ? "active" : ""}`} onClick={() => onTaskView(id)} onKeyDown={(event) => onTaskTabKeyDown(event, index)}>{label}<em>{count}</em></button>)}</nav>}
        <section className="task-list-controls" aria-label="Task search and date filters">
          <label className="task-search"><Search size={16} aria-hidden="true" /><input value={taskSearch} onChange={(event) => onTaskSearch?.(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" />{taskSearch && <button aria-label="Clear task search" onClick={() => onTaskSearch?.("")}><X size={14} /></button>}</label>
          <div className="task-filters-wrap">
            <button type="button" className={`task-filters-toggle ${dateFilterActive ? "active" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><CalendarDays size={15} aria-hidden="true" /> Date range{dateFilterActive ? " · on" : ""}</button>
            {filtersOpen && <div className="task-filters-popover" role="group" aria-label="Task date range">
              <label><span>From</span><input aria-label="Filter from date" type="date" max={filterTo || currentDate} value={filterFrom} onChange={(event) => onFilterFrom?.(event.target.value)} /></label>
              <i aria-hidden="true">—</i>
              <label><span>To</span><input aria-label="Filter to date" type="date" min={filterFrom || undefined} max={currentDate} value={filterTo} onChange={(event) => onFilterTo?.(event.target.value)} /></label>
              {dateFilterActive && <button onClick={() => { onFilterFrom?.(""); onFilterTo?.(""); }}>Clear dates</button>}
            </div>}
          </div>
        </section>
      </header>
      {(hasFilters || overflowNote) && <p className="task-filter-summary" role="status">{overflowNote ?? `${displayedTasks.length} result${displayedTasks.length === 1 ? "" : "s"}`}</p>}
      <div className="evidence-list task-records" id="task-list-panel" ref={listRef} role={historical ? undefined : "tabpanel"} aria-labelledby={historical ? undefined : `task-list-tab-${taskView}`}>{historyError && <div className="task-history-error" role="alert"><span>{historyHasData ? "Task history could not be refreshed. Showing saved results." : "Task history could not be loaded."}</span>{onRetryHistory && <button type="button" onClick={onRetryHistory}>Try again</button>}</div>}<SortHeaderRow columns={TASKS_WORKSPACE_SORT_COLUMNS} sort={taskSort} fallback={DEFAULT_TASK_SORT} onChange={onTaskSort} label={historical ? "Sort recorded tasks" : `Sort ${viewLabel.toLowerCase()} tasks`} className="tasks-column-sort" action={!historical ? <button className="primary task-add-button" onClick={onAddTask}><Plus size={15} /> Add task</button> : null} />{loading && !displayed.length ? <TaskListSkeleton rows={6} /> : displayedTasks.length ? <>{taskView === "today" && !historical
        ? dayGroupsForDisplay.flatMap((group) => group.tasks).map(renderTaskRow)
        : displayedTasks.map(renderTaskRow)}</> : historyError && !historyHasData ? null : <div className="task-empty"><Empty title={emptyCopy.title} body={emptyCopy.body} />{taskView === "today" && !hasFilters && carryOver.length > 0 && <button className="task-empty-action" onClick={() => onCarryOverOpen(true)}><AlertTriangle size={14} aria-hidden="true" /> Review unfinished work</button>}</div>}</div>{loadingMore && <TaskListSkeleton rows={2} />}{hasMore && <button className="task-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <><FadeArc size={13} /> Loading tasks…</> : loadMoreError ? "Retry load more" : "Load more"}</button>}</section>
    {carryOverOpen && <TaskCarryOverFlyout groups={carryGroups} busy={busy} onClose={() => onCarryOverOpen(false)} onSurfaceTask={onSurfaceTask} onTaskCompletion={onTaskCompletion} taskFlight={taskFlight} onOpenDay={(date) => { onCarryOverOpen(false); void onDate(date); }} />}
  </main>;
}
