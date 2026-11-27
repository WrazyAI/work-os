import { hasPendingMascotApproval } from "./mascotApproval";
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lateReasonRequired, PROLONGED_ABSENCE_MINUTES } from "./lateStart";
import { emit, listen } from "./tauriEvents";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { isVoiceEventFor, useVoiceInput } from "./chat/voiceInput";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { displayUpdateVersion, shouldAutoCheckUpdate, updateRowCopy } from "./updater";
import { changelogBulletsFor, changelogHistory } from "./whatsNew";
import { WhatsNewModal } from "./WhatsNewModal";
import CHANGELOG_RAW from "../CHANGELOG.md?raw";
import { AlertTriangle, BriefcaseBusiness, Bug, ChevronRight, CircleHelp, CirclePlay, Clock3, LayoutDashboard, RefreshCw, X } from "lucide-react";
import { ApiRequestError, apiRequest, apiRequestBlob, discardReadyInterpretation, flushQueue, isQueuedResult, readyInterpretations, sendOrQueue, setDebugSession, setSyncBypass, updateTaskCompletion, uploadTaskCompletionEvidence } from "./api";
import { TaskEvidenceDialog, type TaskEvidenceAttachResult } from "./CompletionEvidence";
import { taskRequiresCompletionEvidence, type TaskEvidenceRecord } from "@wrazy/work-os-shared/completion-evidence";
import { PLAN_INTERPRET_TIMEOUT_MS, PLAN_REFINE_TIMEOUT_MS } from "@wrazy/work-os-shared/plan-timeouts";
import { beginAuthentication, discardPendingAuthentication, errorMessage, listenForAuthentication, reopenPendingAuthentication } from "./auth";
import { diagnostics, exportDiagnostics, openLogsDir } from "./diagnostics";
import { markBootPhase, markCleanExit, markStartupTiming } from "./bootTrace";
import { startInstanceHeartbeat } from "./instanceHeartbeat";
import { loadMachineCadence } from "./localSettings";
import { openDebuggerWindow } from "./openDebugger";
import { FEATURES } from "./features";
import { formatWorkOsDate, formatWorkOsDateTime, formatWorkOsTime as formatTime } from "./dateFormat";
import { useNotifications, type NotificationAction } from "./NotificationFlyouts";
import Onboarding from "./Onboarding";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO, insightsFixture } from "./scenarios";
import { alignOfflineClock } from "./offlineClock";
import { sessionGate } from "./sessionGate";
import { shiftPulse } from "./shiftPulse";
import { EOD_SHIFT_OPEN_REASON, eodDraftBlocked, eodDraftWindowOpen } from "@wrazy/work-os-shared/shift-gate";
import { TaskComposerModal, TaskDetailsModal, TaskEditModal, TaskRemovalConfirmation } from "./taskSurfaces";
import { completionClosesTaskPanel, completionTaskCapabilities, taskCompletionNeedsEvidenceStep, taskCompletionReceipt, taskDueDateSeed, taskStatusWriteRequired } from "./taskActions";
import type { AvatarThinkingStage } from "./AvatarThinking";
import type { RecapNextStepItem } from "./types";
import type { RecapNextStepState } from "./RecapNextStepsCard";
import { MASCOT } from "./mascot";
import { fileApprovedOperations, interpretationFallbackReason, isDisplayToolOp, isMutatingToolOp, mergeToolResults, normalizeInterpretation, partialFilingMessage, simulateAiEod, stripBottleneckSection, extractBottleneckSection, restoreBottleneckSection, toolCallKey, usesGroupedCard, type PendingToolReview, type ProposedOperation, type ToolCallResult } from "./interpretation";
import { attachFiledProposals, filedProposalGroups, isBatchToolOp, isPlanImportOp, skipBatchOperation, type FiledProposalRow } from "./interpretation";
import { dayScopedTasks, isOverdueTask, mergeDayTasks, parentTasks, readTaskSort, resolveTaskHistoryDate, safeTaskText, suggestDailyGoal, taskKind, unfinishedBefore, uniqueTasks, writeTaskSort, TASKS_SORT_STORAGE_KEY, type TaskRow, type TaskSort } from "./taskWorkspace";
import { filterFinderTasks } from "./taskFinderFilters";
import { useLatestActivityIntervalQuery } from "./workOsQueries";
import { prefersReducedMotion, useListShift } from "./listShift";
import type { DailyPlan, DailyPlanItem, DayData, DebugScenario, DesktopSession, InsightDay, InsightsData, OfflineAction, OnboardingData, OutstandingEodDay } from "./types";
import { secureState, abandonVaultOpen, resetLocalVault, type WorkOsConversationTurn } from "./vault";
import { sessionNotice } from "./sessionState";
import { runVaultGate, type VaultGateSettled, type VaultGateState, type VaultAttempt } from "./vaultGate";
import { clearWorkOsAccountCache, resetSessionScopedReads, restoreWorkOsQueryCache, TASK_OPTIONS_STALE_MS, workOsKeys } from "./queryClient";
import { fetchDay, fetchOnboarding, fetchTaskDetails, normalizeDay, prepareEodScreenshots, reviewMemoryFact, forgetMemoryFact, useDashboardInsightsQuery, useDayQuery, useEodScreenshotsQuery, useHistoricalDayQuery, useInsightsQuery, useMemoryQuery, useOnboardingQuery, useOpenTaskCountQuery, useOutstandingEodsQuery, useReportDayQuery, useTaskBacklogQuery, useTaskHistoryQuery, useTaskOptionsQuery, type TaskDetails } from "./workOsQueries";
import { MascotPet } from "./MascotPet";
import { mascotFactsFromDay, useMascotRuntime } from "./useMascotRuntime";
import { NotificationsBell } from "./NotificationsBell";
import { MEMORY_SEEN_KEY, OVERDUE_NOTIFIED_KEY, memoryCandidateIds, mergeOverdueKeys, mergeSeenIds, overdueNotifyKey, overdueSummary, recapSurfaceDecision, type RecapWatermark, unseenMemoryIds, unseenOverdueKeys } from "./notificationsLogic";
import { fireCompanionToast } from "./scheduler";
import { submittedEodStatus } from "./EodSubmittedReport";
import { BootOverlay, useBootRise } from "./BootHandoff";
import { DashboardSkeleton, FadeArc } from "./LoadingUi";
import { PlanningSession, type PlanningInterpretation } from "./PlanningSession";
import { classifyPlanSaveFailure, type PlanningConfirmResult } from "./planningSave";
import { applyMemoryReviewToCaches, requestMemoryFactPage, useMemoryFactsQuery } from "./workOsQueries";
import { buildPlanItemsFromInterpretation } from "./planItems";
import { WorktivityControlNotice } from "./WorktivityControlNotice";
import { isMacOS, isWindows } from "./platform";
import AppMenuBar, { type AppMenuGroup, type AppMenuItem } from "./AppMenuBar";
import NativeAppMenu from "./NativeAppMenu";
import { installContextMenuSuppression } from "./contextMenu";
import { SIDEBAR_TOGGLE_EVENT } from "./windowChrome";
import { COMPANION_VISIBILITY_EVENT, ottoVisibilityMenuItem, shouldApplyVisibilityPoll } from "./ottoVisibility";
import { retryWorktivityConfirmation, runWorktivityControl, type WorktivityControlAction, type WorktivityControlPhase } from "./worktivityControl";
import { MemoryModal } from "./MemorySettings";
import { SettingsContent } from "./SettingsContent";
import { SettingsSidebar } from "./SettingsSidebar";
import { useSettingsNavigation } from "./settingsNavigation";
import PageGuide from "./PageGuide";
import GuideTour, { ADMIN_TOUR_PAGES } from "./GuideTour";
import { usePageGuides } from "./usePageGuides";
import { adminSectionForGuideView, guideViewForAdminSection, guideViewForSidebar, isAdminGuideView, type GuideView } from "./guideState";
import { DEFAULT_RECAP_VOICE, normalizeRecapVoice, RECAP_VOICE_EVENT } from "./recapSpeech";
import { APPEARANCE_DEFAULTS, APPEARANCE_EVENT, applyAppearance, normalizeAppearance, rememberTheme, watchSystemTheme, type MascotSize, type TextSize, type ThemePreference } from "./appearance";
import ThemePrompt from "./ThemePrompt";
import { shouldOpenThemePrompt } from "./themePromptState";
import { ProfileAvatar, ProfileSettings, type ProfileSettingsPatch } from "./ProfileSettings";
import { PersonalInsights } from "./InsightsView";
const AdminWorkspace = lazy(() => import("./admin/AdminWorkspace"));
import type { AdminNotifications } from "./admin/AdminWorkspace";
import { emptyAdminNotificationOverview } from "./admin/adminNotificationModel";
import { bootSurface } from "./bootSurface";
import { seedAdminFixtures, seedAdminShellNotifications } from "./admin/adminFixtures";
import { adminKeys, fetchAdminOverview, fetchSession, normalizeAdminOverview, todayIso } from "./admin/data";
import type { AdminOverview, AdminSection, AdminSectionFocus, SessionResponse } from "./admin/types";
import type { AdminArrivalView } from "./adminOtto/AdminOttoChat";
import { CompanionViewSwitch } from "./adminOtto/CompanionViewSwitch";
const AdminOttoChat = lazy(() => import("./adminOtto/AdminOttoChat").then((module) => ({ default: module.AdminOttoChat })));
const AdminOttoSettings = lazy(() => import("./adminOtto/AdminOttoSettings").then((module) => ({ default: module.AdminOttoSettings })));
import { adminOttoFollowChangedAppliesTo, listenAdminOttoFollowChanged } from "./adminOtto/followSignal";
import type { ChatRequest, ChatResult, OttoScope, ReviewedRecap } from "@wrazy/work-os-shared/admin-otto/contracts";
import { fetchAdminOttoContext, claimAdminOttoDelivery, discardAdminOttoChat, fetchAdminOttoInbox, fetchAdminOttoRecap, sendAdminOttoChat, updateAdminOttoDelivery, transcribeAdminOttoAudio, type AdminOttoContextResponse } from "./adminOtto/api";
import { ADMIN_FIXTURE_TRANSPORT, adminFixtureSpeak, createAdminOttoFollowFixture, FIXTURE_REVIEWED_RECAP, fixtureInboxPage } from "./adminOtto/fixtures";
import { parseAdminRecordHref } from "./adminOtto/recordLinks";
import { useAdminOttoRecapAudio } from "./adminOtto/useAdminOttoRecapAudio";
import { adminOttoRoleAllowed, personalBootstrapFlags, planAdminOttoBootstrap } from "./adminOtto/bootstrap";
import { adminOttoKeys } from "./adminOtto/queryKeys";
import { adminOttoChangedEvent, captureScopeStillCurrent, createOttoModeController, ottoContextEvent, parseAdminOttoChangedEvent, sameOttoScope, OTTO_CHANGED_EVENT, OTTO_CONTEXT_CLEARED_EVENT, OTTO_CONTEXT_EVENT, type AdminOttoContext, type OttoModeController, type OttoModeSnapshot } from "./adminOtto/mode";
import { startAuthorizedAdminRecapDelivery, type AdminRecapDeliveryHandle } from "./adminOtto/delivery";
import { eodArrivalCopy, presentAdminArrival, recapArrivalCopy } from "./adminOtto/notifications";
import { OTTO_ADMIN_ATTENTION_EVENT, OTTO_ADMIN_ATTENTION_OPEN_EVENT, adminAttentionEvent, adminAttentionSeenKey, eodAttentionFromOverview, parseAdminAttentionEvent, recapAttentionItem, shouldAutoSwitchWorkspace, type AdminAttentionItem, type AdminAttentionSeen } from "./adminOtto/attention";
import { personalBootstrapAccess, runPersonalBootstrapRefresh, type PersonalBootstrapSource } from "./adminOtto/personalBootstrap";
import { deliveryOwnershipKey, startDeliveryOwnership } from "./adminOtto/ownership";
import { createAdminOttoContextRetry } from "./adminOtto/context";
import { createLocalAudioBus, createOttoAudioBroker, createOttoAudioRequester, installOttoAudioRequester, onOttoAudioStop, requestOttoAudio, requestOttoAudioStop, requestOttoSpeechStop, tauriAudioBus, type OttoAudioLease } from "./adminOtto/audioOwner";
import { clearAdminOttoSurface } from "./adminOtto/modeSurface";
import { createAdminConversationClient, createAdminConversationOwner, createLocalAdminConversationTransport, OTTO_CONVERSATION_EVENT, OTTO_CONVERSATION_REQUEST_EVENT, OTTO_CONVERSATION_RESULT_EVENT, parseAdminConversationRequest, type AdminConversationClient, type AdminConversationOwner, type AdminConversationState } from "./adminOtto/conversationSync";
import { buildOttoViewState, OTTO_RECORD_NAV_EVENT, OTTO_VIEW_REQUEST_EVENT, OTTO_VIEW_RESULT_EVENT, OTTO_VIEW_STATE_EVENT, parseOttoRecordNavigationEvent, parseOttoViewRequest, type OttoViewState } from "./adminOtto/viewSwitch";
import { createWorkspaceOwner, effectiveWorkspaceMode, type WorkspaceOwner } from "./adminOtto/workspaceOwner";
import { createViewWorkFence } from "./adminOtto/viewWorkFence";
import type { AdminOttoEntryRecovery } from "./adminOtto/chatEntry";
import { ADMIN_SHELL_SESSION, adminShellGuideStateFor, adminShellNotificationStateFor, adminShellOttoStateFor, adminShellOverlayFor, adminShellSettingsAccountFor, adminShellSettingsStateFor, isAdminShellBoot, type AdminShellNotificationState, type AdminShellOttoState, type AdminShellOverlay, type AdminShellSettingsState } from "./adminShell";
import type { PlanAnnotation, PlanDraftEdit } from "./planningAnnotations";
import { overlayScrollLockActive } from "./modalScrollLock";
import { ActiveWorkdayDashboard, OffShiftDashboard } from "./DashboardSurface";
import { buildWorkdayDashboardModel } from "./dashboardModel";
import SidebarNav from "./SidebarNav";
import { isSettingsHotkey } from "./settingsHotkey";
import { TaskDateNavigator } from "./TaskDateNavigator";
import { resolveDashboardShift } from "./dashboardModel";
import { shouldAutoOpenPlanning, shouldCloseAutoOpenedPlanning } from "./planningGate";
import { attendanceWatchExpectation, attendanceWatchInput } from "./attendanceWatch";
import { useAttendanceWatch } from "./useAttendanceWatch";
import { useDayMonitor } from "./useDayMonitor";
import "./plan-insights.css";
import "./insight-charts.css";
import type {
  ClockInConfirmation,
  EodScreenshotContext,
  MissedClockOutCorrection,
  PendingWorktivityControl,
  ProgressPanel,
  ProgressReceipt,
  ProgressUpdateKind,
  TaskAssigneeOption,
  TaskDeletionRequest,
  TaskEditRequest,
  TaskEvidenceRequest,
  TaskView,
  View,
} from "./app/types";
import {
  ADMIN_MENU_SECTIONS,
  ADMIN_SECTION_LABELS,
  actionSuccessMessages,
  EOD_PREPARE_ROUNDS,
  isWorktivityControlResult,
  moveDate,
  NOTIFICATION_POLL_MS,
  proposalFilingTransport,
  readAdminAttentionSeen,
  readSeenIds,
  timeRemaining,
  views,
  WORKSPACE_MODE_KEY,
  worktivityControlTransport,
  writeAdminAttentionSeen,
  writeSeenIds,
} from "./app/constants";
import { useModalFocusTrap } from "./app/hooks/useModalFocusTrap";
import { useTaskCacheMutations } from "./app/hooks/useTaskCacheMutations";
import { useUpdaterFlow } from "./app/hooks/useUpdaterFlow";
import { ActiveDayWorkspace, DashboardTaskCard, KpiStrip } from "./app/views/ActiveDayWorkspace";
import { ConnectScreen } from "./app/views/ConnectScreen";
import { EodReviewView } from "./app/views/EodReviewView";
import { eodStructuredFromReport, shouldPrepareStructuredEod, type EodCompositionInput } from "./eodStructured";
import { prepareStructuredEod, saveStructuredEod, streamEodSummary, submitStructuredEod } from "./eodStructuredApi";
import { EvidenceView } from "./app/views/EvidenceView";
import { LoadingScreen } from "./app/views/LoadingScreen";
import { ProgressComposer } from "./app/views/ProgressComposer";
import { ShiftPulseCard } from "./app/views/ShiftPulseCard";
import { TasksWorkspace } from "./app/views/TasksWorkspace";

export {
  ActiveDayWorkspace,
  ConnectScreen,
  DashboardTaskCard,
  KpiStrip,
  LoadingScreen,
  ProgressComposer,
  ShiftPulseCard,
  TasksWorkspace,
};

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
  /** One silent structured-EOD prepare attempt per day; the timer normally did it. */
  const preparedReviewDates = useRef(new Set<string>());
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [view, setView] = useState<View>("day");
  // The settings rail replaces the app rail while Settings is on screen; Back
  // to app returns to whichever workspace page opened it.
  const lastNonSettingsView = useRef<View>("day");
  function navigateToView(nextView: View) {
    if (nextView !== "settings") lastNonSettingsView.current = nextView;
    setView(nextView);
  }
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
  const [adminOttoTabRequest, setAdminOttoTabRequest] = useState<{ tab: "chat" | "recaps"; token: number }>({ tab: "chat", token: 0 });
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
  const adminOttoNewChatPending = useRef(false);
  const rememberAdminOttoRecovery = useCallback((recovery: { draft: string; requestId: string | null }) => {
    setAdminOttoDraft(recovery.draft);
    adminOttoRetryRequestId.current = recovery.requestId;
  }, []);
  const [adminOttoSnapshot, setAdminOttoSnapshot] = useState<OttoModeSnapshot | null>(null);
  const adminOttoSnapshotRef = useRef<OttoModeSnapshot | null>(null);
  useLayoutEffect(() => {
    adminOttoSnapshotRef.current = adminOttoSnapshot;
  }, [adminOttoSnapshot]);
  /** The last grounded admin arrival: a submitted EOD or a reviewed recap.
   * The overview read owns EODs; the delivery loop owns recaps. */
  const adminAttentionSeenRef = useRef<AdminAttentionSeen | null>(readAdminAttentionSeen());
  const adminAttentionAnnouncedRef = useRef<string | null>(null);
  /** Stable across App renders, including the New chat state updates. The
   * callback still reads the latest published scope from the ref. */
  const handleAdminOttoConversation = useCallback((conversationId: string) => {
    const owner = conversationOwnerRef.current;
    const ownerSnapshot = owner?.snapshot();
    if (ownerSnapshot && ownerSnapshot.conversationId !== conversationId) return;
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
  /** Bumped by every host visibility event. A poll that started before the
   * event must not land afterward and overwrite newer truth. */
  const avatarVisibilityRevision = useRef(0);
  const [deliveryOwnedContext, setDeliveryOwnedContext] = useState<string | null>(null);
  const adminOttoModeRef = useRef<OttoModeController | null>(null);
  const adminOttoEpochRef = useRef(0);
  const adminOttoDeliveryRef = useRef<AdminRecapDeliveryHandle | null>(null);
  const adminOttoOpenAttemptRef = useRef(0);
  const adminOttoDeviceId = useRef<string>(crypto.randomUUID());
  const viewFenceRef = useRef(createViewWorkFence());
  const adminChatLifecycleRef = useRef<{ suspend: () => AdminOttoEntryRecovery; voice: { start: (source?: "button" | "hotkey") => void; stop: () => void; cancel: () => void } } | null>(null);
  const adminVoiceStartedRef = useRef(false);
  const adminVoiceRecorderRef = useRef<{ start: (source?: "button" | "hotkey") => void; stop: () => void; cancel: () => void } | null>(null);
  const conversationOwnerRef = useRef<AdminConversationOwner | null>(null);
  const conversationClientRef = useRef<AdminConversationClient | null>(null);
  const conversationStateRef = useRef<AdminConversationState | null>(null);
  const [conversationState, setConversationState] = useState<AdminConversationState | null>(null);
  const viewStateRef = useRef<OttoViewState | null>(null);
  const workspaceOwnerRef = useRef<WorkspaceOwner | null>(null);
  const effectiveWorkspaceRef = useRef<"employee" | "admin">("employee");
  const [viewRevision, setViewRevision] = useState(1);
  const lastViewFingerprint = useRef("");
  const lastConversationGeneration = useRef<number | null>(null);
  const lastOwnerToken = useRef<string | null>(null);
  const lastPresentationMode = useRef<"employee" | "admin" | null>(null);
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
  // True only when the employee explicitly opened a historical Tasks day. A
  // cached snapshot or a workday rollover must not pin the list to yesterday.
  const taskDatePinnedRef = useRef(false);
  const [historicalPlan, setHistoricalPlan] = useState<DailyPlan | null>(null);
  const [historicalTasks, setHistoricalTasks] = useState<Array<Record<string, any>>>([]);
  const [taskView, setTaskView] = useState<TaskView>("today");
  const [taskWorkspaceSort, setTaskWorkspaceSort] = useState<TaskSort>(() => readTaskSort(TASKS_SORT_STORAGE_KEY));
  const [taskSearch, setTaskSearch] = useState("");
  const [taskFinderOpen, setTaskFinderOpen] = useState(false);
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
  const showError = useCallback((value: unknown, fallback = "Something went wrong.", title?: string) => {
    const message = errorMessage(value, fallback);
    setError(message);
    notifications.error(message, title);
    return message;
  }, [notifications]);
  const {
    updateFlow,
    updateRowSummary,
    autoCheckUpdates,
    setAutoCheckUpdates,
    updateChannel,
    setUpdateChannel,
    chooseUpdateChannel,
    installedVersion,
    installedVersionRaw,
    whatsNew,
    setWhatsNew,
    launchUpdateCheckRef,
    beginUpdateDownload,
    installDownloadedUpdate,
    checkForUpdates,
    toggleAutoCheckUpdates,
  } = useUpdaterFlow({ session, apiBase, notifications, showError });
  const [vaultGate, setVaultGate] = useState<VaultGateState>({ status: "pending" });
  const vaultAttemptRef = useRef<VaultAttempt | null>(null);
  /** The query cache hydrates only after the gate has opened the vault. */
  const queryCacheRestoredRef = useRef(false);
  // The latest vault opener, kept behind a ref so the boot effect's starter can
  // stay identity-stable across the state churn of an ordinary session. It
  // rejects until the first render supplies the real opener, so an ordering
  // mistake surfaces as a failure screen instead of a silently skipped vault.
  const applyVaultStateRef = useRef<() => Promise<void>>(() => Promise.reject(new Error("The vault opener is not ready yet.")));
  const [refreshing, setRefreshing] = useState(false);
  const [textSize, setTextSize] = useState<TextSize>("small");
  const [mascotSize, setMascotSize] = useState<MascotSize>("large");
  const [theme, setTheme] = useState<ThemePreference>(APPEARANCE_DEFAULTS.theme);
  const [themePreview, setThemePreview] = useState<ThemePreference>(APPEARANCE_DEFAULTS.theme);
  const [themePromptSeen, setThemePromptSeen] = useState(true);
  const [themePromptOpen, setThemePromptOpen] = useState(false);
  const [themePromptSaving, setThemePromptSaving] = useState(false);
  const [themePromptError, setThemePromptError] = useState<string | null>(null);
  const [themeSettingsLoaded, setThemeSettingsLoaded] = useState(false);
  const themeRequestRef = useRef(0);
  const confirmedThemeRef = useRef<ThemePreference>(APPEARANCE_DEFAULTS.theme);
  const appearanceRef = useRef({ textSize, mascotSize, theme });
  const [recapVoice, setRecapVoice] = useState<string>(DEFAULT_RECAP_VOICE);
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
      // `real` keeps the local fixture as the source after boot, allowing its
      // actual clock/task actions to change state instead of forcing a pose.
      const allowedDayStates = ["real", "no_shift", "scheduled", "shift_start", "clocked_in", "paused", "catch_up", "optional", "final_hour", "eod_due", "eod", "clocked_out"];
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
  const settingsNav = useSettingsNavigation(!!visibleOnboarding);
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
  const effectiveWorkspace: "employee" | "admin" = ADMIN_SHELL_BOOT
    ? "admin"
    : effectiveWorkspaceMode({
        selected: workspace,
        adminShell: adminOttoBootstrap.adminShell,
        waitingForContext: adminOttoBootstrap.waitingForAdminContext,
      });
  effectiveWorkspaceRef.current = effectiveWorkspace;
  const bootstrapEnabled = personalBootstrapFlags({
    syncBypass,
    plan: ADMIN_SHELL_BOOT
      ? { personalBootstrapEnabled: false, personalNotificationsEnabled: true }
      : adminOttoBootstrap,
  });
  const employeeBootstrapEnabled = bootstrapEnabled.personal && !adminShellActive;
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
  const debugOnboardingPreview = debugScenario.enabled
    && debugScenario.onboardingState === "missing"
    && visibleOnboarding?.onboardingRequired === true;
  const landing = bootSurface({
    vault: vaultGate.status === "failed" ? "failed" : vaultGate.status === "pending" ? "pending" : "ready",
    signedIn: !!visibleSession,
    onboardingLoaded: !!visibleOnboarding,
    onboardingRequired: visibleOnboarding?.onboardingRequired === true,
    onboardingPreview: debugOnboardingPreview,
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
  /* Windows and macOS both draw the Work OS caption bar; the dev flag keeps
     the real shell reviewable in a browser without giving the web app a fake
     title bar. */
  const macChromePreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has("mac-chrome");
  const forceThemePrompt = import.meta.env.DEV && new URLSearchParams(window.location.search).has("theme-prompt");
  const macChrome = (isTauri() && isMacOS()) || macChromePreview;
  const customWindowChrome = (isTauri() && (isWindows() || isMacOS()))
    || (import.meta.env.DEV && (new URLSearchParams(window.location.search).has("window-chrome") || macChromePreview));
  const contextMenuSuppressionEnabled = isTauri()
    || (import.meta.env.DEV && (new URLSearchParams(window.location.search).has("window-chrome") || macChromePreview));
  /* Menu labels follow the chrome being rendered, not just the user agent, so
     the macOS preview carries the shortcuts the real app would show. */
  const chromeUsesMacShortcuts = macChrome;

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

  useEffect(() => { conversationStateRef.current = conversationState; }, [conversationState]);

  useEffect(() => {
    const sessionData = workSessionQuery.data;
    if (!signedIn || syncBypass || ADMIN_SHELL_BOOT || !sessionData || sessionData.role !== "admin") {
      conversationOwnerRef.current?.dispose();
      conversationOwnerRef.current = null;
      conversationClientRef.current = null;
      conversationStateRef.current = null;
      setConversationState(null);
      return;
    }
    const existing = conversationOwnerRef.current;
    const existingScope = existing?.snapshot().scope;
    if (existing && existingScope?.userId === sessionData.userId
      && existingScope.organizationId === sessionData.organizationId) return;
    existing?.dispose();
    const tokenChanged = lastOwnerToken.current !== null && lastOwnerToken.current !== session?.token;
    lastOwnerToken.current = session?.token ?? null;
    let owner!: AdminConversationOwner;
    owner = createAdminConversationOwner({
      getLiveFence: () => {
        const snapshot = owner.snapshot();
        return { scope: snapshot.scope, epoch: snapshot.epoch, generation: snapshot.generation };
      },
      discard: (input) => discardAdminOttoChat(input),
      publish: (state) => {
        conversationStateRef.current = state;
        setConversationState(state);
        void emit(OTTO_CONVERSATION_EVENT, state);
      },
    });
    conversationOwnerRef.current = owner;
    let ownerDisposed = false;
    let stopRequests: (() => void) | undefined;
    void listen<Record<string, unknown>>(OTTO_CONVERSATION_REQUEST_EVENT, (event) => {
      const request = parseAdminConversationRequest(event.payload);
      if (!request || ownerDisposed) return;
      void owner.handle(request).then((result) => emit(OTTO_CONVERSATION_RESULT_EVENT, result)).catch(() => undefined);
    }).then((off) => {
      if (ownerDisposed) off();
      else stopRequests = off;
    }).catch(() => undefined);
    conversationClientRef.current = createAdminConversationClient({
      windowId: "main",
      getFence: () => {
        const snapshot = owner.snapshot();
        return { scope: snapshot.scope, epoch: snapshot.epoch, generation: snapshot.generation };
      },
      transport: createLocalAdminConversationTransport(owner),
    });
    const initialScope = adminOttoSnapshotRef.current?.scope ?? {
      userId: sessionData.userId,
      organizationId: sessionData.organizationId,
      mode: effectiveWorkspaceRef.current,
    };
    owner.setContext({
      scope: initialScope,
      epoch: Math.max(1, adminOttoSnapshotRef.current?.epoch ?? 0, adminOttoEpochRef.current),
      conversationId: tokenChanged ? null : adminOttoConversationId,
    });
    const initial = owner.snapshot();
    conversationStateRef.current = initial;
    setConversationState(initial);
    return () => {
      ownerDisposed = true;
      stopRequests?.();
      if (conversationOwnerRef.current === owner) {
        owner.dispose();
        conversationOwnerRef.current = null;
        conversationClientRef.current = null;
      }
    };
  }, [signedIn, syncBypass, workSessionQuery.data?.userId, workSessionQuery.data?.organizationId, workSessionQuery.data?.role, session?.token]);

  useEffect(() => {
    const owner = conversationOwnerRef.current;
    const sessionData = workSessionQuery.data;
    if (!owner || !sessionData) return;
    owner.setContext({
      scope: adminOttoSnapshot?.scope ?? {
        userId: sessionData.userId,
        organizationId: sessionData.organizationId,
        mode: effectiveWorkspace,
      },
      epoch: Math.max(1, adminOttoSnapshot?.epoch ?? 0, adminOttoEpochRef.current),
    });
    const next = owner.snapshot();
    conversationStateRef.current = next;
    setConversationState(next);
  }, [adminOttoSnapshot?.epoch, adminOttoSnapshot?.scope.mode, effectiveWorkspace, workSessionQuery.data?.userId, workSessionQuery.data?.organizationId]);

  useEffect(() => {
    const id = conversationState?.conversationId;
    if (id !== undefined && id !== adminOttoConversationId) setAdminOttoConversationId(id);
  }, [conversationState?.conversationId, adminOttoConversationId]);

  useEffect(() => {
    const generation = conversationState?.generation;
    if (generation === undefined) return;
    if (lastConversationGeneration.current !== null && lastConversationGeneration.current !== generation) {
      setAdminOttoDraft("");
      adminOttoRetryRequestId.current = null;
      setAdminOttoConversationId(null);
    }
    lastConversationGeneration.current = generation;
  }, [conversationState?.generation]);

  useEffect(() => {
    const sessionData = workSessionQuery.data;
    if (!sessionData || sessionData.role !== "admin" || adminOttoSnapshot) {
      if (adminOttoSnapshot) lastPresentationMode.current = adminOttoSnapshot.scope.mode;
      return;
    }
    if (lastPresentationMode.current === null) {
      lastPresentationMode.current = effectiveWorkspace;
      return;
    }
    if (lastPresentationMode.current === effectiveWorkspace) return;
    lastPresentationMode.current = effectiveWorkspace;
    adminOttoEpochRef.current += 1;
    setViewRevision((value) => value + 1);
  }, [effectiveWorkspace, adminOttoSnapshot, workSessionQuery.data?.role]);

  const activeViewScope = useMemo(() => {
    const sessionData = workSessionQuery.data;
    return adminOttoSnapshot?.scope ?? (sessionData ? {
      userId: sessionData.userId,
      organizationId: sessionData.organizationId,
      mode: effectiveWorkspace,
    } : null);
  }, [adminOttoSnapshot?.scope?.userId, adminOttoSnapshot?.scope?.organizationId, adminOttoSnapshot?.scope?.mode, effectiveWorkspace, workSessionQuery.data?.userId, workSessionQuery.data?.organizationId]);

  const adminViewRole = (workSessionQuery.data?.role ?? "employee") as "admin" | "manager" | "employee";
  const adminViewStatus = adminViewRole === "admin" ? adminContextState?.status ?? "loading" : "absent";
  const adminViewPersonId = adminContextState?.status === "ready"
    ? adminContextState.personId
    : workSessionQuery.data?.personId ?? null;
  const adminViewVoice = adminViewRole === "admin" && adminViewStatus === "ready" && adminOttoContextQuery.data?.voiceAvailable === true;
  const adminViewTranscription = adminViewRole === "admin" && adminViewStatus === "ready" && adminOttoContextQuery.data?.transcriptionAvailable === true;
  const adminViewConversationId = conversationState ? conversationState.conversationId : adminOttoConversationId;
  const viewFingerprint = JSON.stringify([
    activeViewScope?.userId, activeViewScope?.organizationId, effectiveWorkspace,
    Math.max(1, adminOttoSnapshot?.epoch ?? 0, adminOttoEpochRef.current),
    adminViewRole, adminViewStatus, adminViewPersonId, adminViewVoice, adminViewTranscription,
    adminViewConversationId, conversationState?.generation ?? 1, conversationState?.revision ?? 1,
    conversationState?.busy ?? false,
  ]);
  useEffect(() => {
    if (lastViewFingerprint.current === viewFingerprint) return;
    lastViewFingerprint.current = viewFingerprint;
    setViewRevision((value) => value + 1);
  }, [viewFingerprint]);

  const viewState = useMemo<OttoViewState | null>(() => {
    if (!activeViewScope) return null;
    return buildOttoViewState({
      scope: { ...activeViewScope, mode: effectiveWorkspace },
      epoch: Math.max(1, adminOttoSnapshot?.epoch ?? 0, adminOttoEpochRef.current),
      revision: viewRevision,
      workspace: effectiveWorkspace,
      role: adminViewRole,
      adminStatus: adminViewStatus,
      personId: adminViewPersonId,
      voiceAvailable: adminViewVoice,
      transcriptionAvailable: adminViewTranscription,
      adminConversationId: adminViewConversationId,
      adminConversationGeneration: conversationState?.generation ?? 1,
      adminConversationRevision: conversationState?.revision ?? 1,
      adminConversationBusy: conversationState?.busy ?? false,
    });
  }, [activeViewScope, adminOttoSnapshot?.epoch, viewRevision, effectiveWorkspace, adminViewRole, adminViewStatus, adminViewPersonId, adminViewVoice, adminViewTranscription, adminViewConversationId, conversationState?.generation, conversationState?.revision, conversationState?.busy]);
  viewStateRef.current = viewState;
  useEffect(() => {
    if (viewState) void emit(OTTO_VIEW_STATE_EVENT, viewState);
  }, [viewState]);

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
  const employeeOnlyOverlaysOpen = taskFinderOpen || taskComposerOpen || !!taskDetails || !!taskEvidenceRequest || !!deleteRequest || !!editRequest || !!clockInConfirmation || !!missedClockOut || !!clockOutConfirmation || !!eodDeleteConfirmation || carryOverOpen || planningSessionOpen || tourScope === "employee";
  /** The profile modal needs the onboarding record it edits; without it the
   * flag renders nothing and must therefore count for nothing. */
  const profileModalOpen = profileOpen && !!visibleOnboarding;
  /** Any overlay but the page guide itself; the guide's auto-open waits for a
   * free screen, so counting an open guide here would be circular. The admin
   * tour renders only in the administration branch, so it blocks the admin
   * guide's auto-open without counting against the employee one. */
  const baseModalOpen = !!whatsNew || profileModalOpen || !!debugPageGuide || memoryOpen || employeeOnlyOverlaysOpen || tourScope === "admin";
  /** Only the overlays the active branch actually renders may block the prompt,
   * the guide, or the lock. */
  const activeOverlaysOpen = adminWorkspaceBranch
    ? !!whatsNew || profileModalOpen || !!debugPageGuide || memoryOpen || tourScope === "admin"
    : baseModalOpen;
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
    blocked: activeOverlaysOpen || themePromptOpen || !themeSettingsLoaded,
    fixture: ADMIN_SHELL_GUIDE_STATE ?? undefined,
  });
  const navigateAdmin = useCallback((next: AdminSection, focus?: AdminSectionFocus) => {
    setAdminSection(next);
    setAdminFocus(focus ?? {});
  }, []);
  const adminContextQueryRef = useRef(adminOttoContextQuery);
  adminContextQueryRef.current = adminOttoContextQuery;
  /** Open the shared admin surface. The grouped arrival uses this without
   * opening it on its own; only the person's explicit Listen/View action does. */
  const openAdminOttoSurface = useCallback((options: { tab?: "chat" | "recaps"; recap?: ReviewedRecap | null; listen?: boolean; newChat?: boolean } = {}) => {
    const newChat = options.newChat === true;
    const requestedTab = newChat ? "chat" : options.tab ?? "chat";
    setAdminOttoInitialTab(requestedTab);
    setAdminOttoTabRequest((current) => ({ tab: requestedTab, token: current.token + 1 }));
    setAdminOttoRequestedRecap(newChat ? null : options.recap ?? null);
    const reveal = () => {
      if (options.listen && options.recap) void adminAudioRef.current.listen(options.recap);
      const attempt = ++adminOttoOpenAttemptRef.current;
      if (ADMIN_SHELL_BOOT) {
        setAdminOttoEntryOpen(true);
        return;
      }
      const contextQuery = adminContextQueryRef.current;
      if (contextQuery.isSuccess && contextQuery.data) {
        setAdminOttoEntryOpen(true);
        return;
      }
      const retry = createAdminOttoContextRetry(async () => {
        const result = await contextQuery.refetch();
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
    };
    if (!newChat) {
      reveal();
      return;
    }
    // The sidebar's New chat must reach the same durable boundary as the sheet
    // header. Clearing local state first would leave the old thread and its
    // previews confirmable behind it.
    const conversationId = adminOttoConversationId;
    const requestId = adminOttoRetryRequestId.current;
    if (ADMIN_SHELL_BOOT || (!conversationId && !requestId && !conversationClientRef.current)) {
      setAdminOttoDraft("");
      setAdminOttoResetToken((value) => value + 1);
      reveal();
      return;
    }
    if (adminOttoNewChatPending.current) return;
    adminOttoNewChatPending.current = true;
    adminChatLifecycleRef.current?.suspend();
    const discard = conversationClientRef.current
      ? conversationClientRef.current.discard({ conversationId, requestId })
      : discardAdminOttoChat({ conversationId, requestId });
    void discard.then(() => {
      setAdminOttoConversationId(null);
      setAdminOttoDraft("");
      adminOttoRetryRequestId.current = null;
      setAdminOttoResetToken((value) => value + 1);
      reveal();
    }).catch(() => {
      notifications.error("The old chat could not be discarded. Nothing was cleared; try New chat again.", "New chat failed");
    }).finally(() => { adminOttoNewChatPending.current = false; });
  }, [notifications, adminOttoConversationId]);

  /** A result card's record destination. Only a validated same-app admin URL
   * reaches this handler; a reviewed recap opens the real recap focus target,
   * never a fabricated EOD report. */
  const openAdminRecord = useCallback((url: string) => {
    const target = parseAdminRecordHref(url);
    if (!target) {
      notifications.error("That record link is not available in this workspace.", "Record unavailable");
      return;
    }
    if (isTauri()) void invoke("focus_main").catch(() => undefined);
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

  /** The admin tour walks the sections for real, so it drives the workspace. */
  const navigateAdminGuide = useCallback((guide: GuideView) => {
    const section = adminSectionForGuideView(guide);
    if (section) navigateAdmin(section);
  }, [navigateAdmin]);
  /** The employee tour lands on sidebar pages and leaves admin views alone. */
  const navigateEmployeeGuide = useCallback((guide: GuideView) => {
    if (!isAdminGuideView(guide)) setView(guide);
  }, []);
  const chooseTheme = useCallback(async (next: ThemePreference, options: { markSeen?: boolean } = {}) => {
    const request = ++themeRequestRef.current;
    setTheme(next);
    setThemePreview(next);
    applyAppearance({ ...appearanceRef.current, theme: next });
    rememberTheme(next);
    try {
      await secureState.saveSettings({ theme: next, ...(options.markSeen ? { themePromptSeen: true } : {}) });
      // A stale success still changed the persisted record, so it becomes the
      // rollback target; it just must not change the current visible choice.
      confirmedThemeRef.current = next;
      rememberTheme(next);
      if (options.markSeen) setThemePromptSeen(true);
      if (themeRequestRef.current !== request) return;
      void emit(APPEARANCE_EVENT, { ...appearanceRef.current, theme: next });
    } catch (value) {
      // A newer choice owns the visible theme; an older failure must not roll
      // it back or announce the stale value. Roll back to the last confirmed
      // theme, never an earlier optimistic choice.
      if (themeRequestRef.current !== request) return;
      const confirmed = confirmedThemeRef.current;
      setTheme(confirmed);
      setThemePreview(confirmed);
      applyAppearance({ ...appearanceRef.current, theme: confirmed });
      rememberTheme(confirmed);
      throw value;
    }
  }, []);

  const selectThemePreview = useCallback((next: ThemePreference) => {
    setThemePreview(next);
    setThemePromptError(null);
    applyAppearance({ ...appearanceRef.current, theme: next });
  }, []);

  const dismissThemePrompt = useCallback(() => {
    if (themePromptSaving) return;
    setThemePreview(theme);
    applyAppearance({ ...appearanceRef.current, theme });
    setThemePromptOpen(false);
    setThemePromptError(null);
    setThemePromptSeen(true);
    void secureState.saveSettings({ themePromptSeen: true }).catch(() => undefined);
  }, [theme, themePromptSaving]);

  const useThemePrompt = useCallback(async () => {
    const next = themePreview;
    setThemePromptSaving(true);
    setThemePromptError(null);
    try {
      await secureState.saveSettings({ theme: next, themePromptSeen: true });
      confirmedThemeRef.current = next;
      setTheme(next);
      setThemePromptSeen(true);
      rememberTheme(next);
      applyAppearance({ ...appearanceRef.current, theme: next });
      void emit(APPEARANCE_EVENT, { ...appearanceRef.current, theme: next });
      setThemePromptOpen(false);
    } catch (value) {
      setThemePromptError(errorMessage(value, "The theme could not be saved."));
    } finally {
      setThemePromptSaving(false);
    }
  }, [themePreview]);

  const otherOverlaysOpen = activeOverlaysOpen || openPageGuide !== null;
  const globalOverlaysOpen = otherOverlaysOpen || themePromptOpen;

  useEffect(() => {
    appearanceRef.current = { textSize, mascotSize, theme };
  }, [mascotSize, textSize, theme]);

  useEffect(() => {
    const activeTheme = themePromptOpen ? themePreview : theme;
    return watchSystemTheme(() => applyAppearance({ ...appearanceRef.current, theme: activeTheme }));
  }, [theme, themePreview, themePromptOpen]);

  useEffect(() => {
    if (themePromptOpen) return;
    const workspaceOnScreen = employeeWorkspaceBranch || adminWorkspaceBranch;
    const gateOpen = shouldOpenThemePrompt({
      signedIn,
      themePromptSeen,
      workspaceOnScreen,
      otherOverlayOpen: otherOverlaysOpen,
      hasSession: !!visibleSession,
    });
    const forced = forceThemePrompt && workspaceOnScreen && !otherOverlaysOpen;
    if (!gateOpen && !forced) return;
    // Open on the first eligible paint. A delay here races the page guide's
    // own beat, and the guide must never win that race.
    setThemePreview(theme);
    setThemePromptError(null);
    setThemePromptOpen(true);
  }, [adminWorkspaceBranch, employeeWorkspaceBranch, forceThemePrompt, otherOverlaysOpen, signedIn, theme, themePromptOpen, themePromptSeen, visibleSession]);

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


  const dismissTopLayer = useCallback(() => {
    if (busy) return;
    if (themePromptOpen) { if (!themePromptSaving) dismissThemePrompt(); return; }
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
  }, [busy, carryOverOpen, clockInConfirmation, clockOutConfirmation, closeGuide, debugPageGuide, deleteRequest, dismissThemePrompt, editRequest, eodDeleteConfirmation, missedClockOut, moveMenuId, openPageGuide, planningSessionOpen, profileOpen, subtaskMenuId, taskComposerOpen, taskDetails, taskEvidenceRequest, themePromptOpen, themePromptSaving, tourScope, whatsNew]);

  // A compact refresh returns empty history/evidence/proposals arrays; the
  // details payload owns those records. Merge so a cheap poll never wipes
  // loaded detail data, and a details load never regresses fresher scalars.
  function mergeDayPayload(current: DayData | null, next: DayData): DayData {
    if (!current) return next;
    const keepFilled = <T,>(incoming: T[] | undefined, existing: T[] | undefined): T[] | undefined =>
      Array.isArray(incoming) && incoming.length === 0 && Array.isArray(existing) && existing.length > 0 ? existing : incoming;
    const nextReport = next.report && typeof next.report === "object" && "markdown" in (next.report as Record<string, unknown>) ? next.report : current.report ?? next.report;
    const nextTasks = Array.isArray(next.tasks) ? next.tasks : current.tasks;
    return {
      ...current,
      ...next,
      tasks: mergeDayTasks(current.tasks, nextTasks),
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
    setPlanHistoryDate((current) => resolveTaskHistoryDate(current, nextDay.shiftDate, taskDatePinnedRef.current));
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

  /** The employee's current day, used to recompute the overdue lock when a cache
   * patch flips completion or moves a due date without a server payload to read
   * it from. */
  const taskCalendarDate = visibleDay?.shiftDate || new Date().toISOString().slice(0, 10);
  const {
    taskRowId,
    updateTaskHistoryVariants,
    revalidateTaskHistoryVariants,
    patchTaskCaches,
    removeTaskFromCaches,
    replaceTaskInCaches,
    insertTaskIntoCaches,
    insertPendingTaskIntoCaches,
  } = useTaskCacheMutations(queryClient, taskCalendarDate);

  const detailsViews = view === "review" || view === "evidence";
  const selectedTaskDate = planHistoryDate || visibleDay?.shiftDate || "";
  const selectedTaskDateIsHistorical = !!visibleDay?.shiftDate && selectedTaskDate !== visibleDay.shiftDate;
  const dayMonitor = useDayMonitor({ window: "main", session, enabled: personalNotificationReadsEnabled && !syncBypass,
    activePage: employeeBootstrapEnabled, onSnapshot: () => undefined });
  const sharedStatusQuery = useQuery({
    queryKey: ["work-os", "shared-status"], enabled: personalNotificationReadsEnabled && !employeeBootstrapEnabled && dayMonitor.owns,
    staleTime: 60_000, refetchInterval: 60_000,
    queryFn: async ({ signal }) => normalizeDay(await apiRequest<DayData>("/api/work-os/me/workday", { signal })),
  });
  useEffect(() => {
    if (sharedStatusQuery.data && dayMonitor.owns) void dayMonitor.publish(sharedStatusQuery.data);
  }, [sharedStatusQuery.data, dayMonitor.owns]);

  // Reads are cached with TTLs and de-duplicated by react-query. The compact
  // snapshot refreshes every minute in the background; heavy details load only
  // when a workspace that needs them opens.
  // Page reads belong to the one window that owns background monitoring. A
  // hidden main window therefore never duplicates the avatar's day work; a
  // focus/visibility change re-claims and enables them again.
  const employeePageEnabled = employeeBootstrapEnabled && dayMonitor.owns;
  const compactDayQuery = useDayQuery({ enabled: employeePageEnabled, variant: "compact", pollMs: 60_000 });
  useEffect(() => { if (compactDayQuery.data && dayMonitor.owns) void dayMonitor.publish(compactDayQuery.data); }, [compactDayQuery.data, dayMonitor.owns]);
  const detailsDayQuery = useDayQuery({ enabled: employeePageEnabled && detailsViews, variant: "details" });
  // Share the scoped options cache between the drawer and the composer.
  const drawerAssigneeQuery = useTaskOptionsQuery({ enabled: employeePageEnabled && !!taskDetails && !taskDetailsReadOnly });
  const onboardingQuery = useOnboardingQuery({ enabled: bootstrapEnabled.personal && (!adminShellActive || adminSection === "settings" || profileOpen) });
  if (!workspaceOwnerRef.current) {
    workspaceOwnerRef.current = createWorkspaceOwner({
      read: () => {
        const sessionData = workSessionRef.current;
        const controllerSnapshot = adminOttoSnapshotRef.current;
        const adminState = adminContextStateRef.current;
        const mode = effectiveWorkspaceRef.current;
        return {
          workspace: mode,
          scope: controllerSnapshot?.scope ?? (sessionData ? {
            userId: sessionData.userId,
            organizationId: sessionData.organizationId,
            mode,
          } : null),
          actor: sessionData ? { userId: sessionData.userId, organizationId: sessionData.organizationId } : null,
          role: (sessionData?.role ?? null) as "admin" | "manager" | "employee" | null,
          adminStatus: sessionData?.role === "admin" ? adminState?.status ?? "loading" : "absent",
          personId: adminState?.personId ?? sessionData?.personId ?? null,
          online: typeof navigator === "undefined" ? true : navigator.onLine,
          resetting: conversationStateRef.current?.resetting ?? false,
        };
      },
      suspend: () => {
        viewFenceRef.current.invalidate();
        adminChatLifecycleRef.current?.suspend();
        requestOttoAudioStop();
        voiceRef.current.cancel();
        setBusy(false);
        setComposerThinking(null);
        setInterpretation(null);
        setAdminOttoEntryOpen(false);
      },
      switchController: async (next) => {
        const controller = adminOttoModeRef.current;
        if (!controller) throw new Error("No administration mode controller is available.");
        return controller.switchMode(next);
      },
      commit: (next) => {
        setWorkspace(next);
        try { localStorage.setItem(WORKSPACE_MODE_KEY, next); } catch { /* best effort */ }
        setAdminOttoEntryOpen(false);
        if (next === "admin") {
          setAdminSection("overview");
          setAdminFocus({});
        }
      },
      retryContext: async () => {
        const result = await adminOttoContextQuery.refetch();
        return !result.error;
      },
    });
  }

  const requestWorkspaceMode = useCallback((next: "employee" | "admin") => {
    const owner = workspaceOwnerRef.current;
    return owner ? owner.request(next) : Promise.resolve({ ok: false as const, reason: "switch_failed" as const });
  }, []);
  const requestContextRetry = useCallback(() => {
    const owner = workspaceOwnerRef.current;
    return owner ? owner.retryContext() : Promise.resolve({ ok: false as const, reason: "admin_failed" as const });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    void listen<Record<string, unknown>>(OTTO_VIEW_REQUEST_EVENT, (event) => {
      const request = parseOttoViewRequest(event.payload);
      if (!request) return;
      const current = viewStateRef.current;
      if (!current || !sameOttoScope(request.scope, current.scope) || request.epoch !== current.epoch) {
        void emit(OTTO_VIEW_RESULT_EVENT, {
          requestId: request.requestId,
          scope: request.scope,
          epoch: request.epoch,
          action: request.action,
          mode: request.mode,
          accepted: false,
          reason: "stale_scope",
        });
        return;
      }
      const result = request.action === "retry-context"
        ? requestContextRetry()
        : requestWorkspaceMode(request.mode);
      void result.then((outcome) => emit(OTTO_VIEW_RESULT_EVENT, {
        requestId: request.requestId,
        scope: request.scope,
        epoch: request.epoch,
        action: request.action,
        mode: request.mode,
        accepted: outcome.ok,
        reason: outcome.ok ? null : outcome.reason,
      })).catch(() => emit(OTTO_VIEW_RESULT_EVENT, {
        requestId: request.requestId,
        scope: request.scope,
        epoch: request.epoch,
        action: request.action,
        mode: request.mode,
        accepted: false,
        reason: "switch_failed",
      }));
    }).then((cleanup) => {
      if (cancelled) cleanup(); else off = cleanup;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [requestContextRetry, requestWorkspaceMode]);

  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    void listen<Record<string, unknown>>(OTTO_RECORD_NAV_EVENT, (event) => {
      const navigation = parseOttoRecordNavigationEvent(event.payload);
      if (!navigation) return;
      const current = viewStateRef.current;
      if (!current || !sameOttoScope(navigation.scope, current.scope)
        || navigation.epoch !== current.epoch
        || navigation.generation !== (conversationStateRef.current?.generation ?? 1)) return;
      openAdminRecord(navigation.url);
    }).then((cleanup) => {
      if (cancelled) cleanup(); else off = cleanup;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [openAdminRecord]);

  /* The floating companion can be the only surface the administrator sees.
     Its card action names a real destination; this window brings the exact
     section forward after the same scope/epoch check as a record link. */
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    void listen<Record<string, unknown>>(OTTO_ADMIN_ATTENTION_OPEN_EVENT, (event) => {
      const parsed = parseAdminAttentionEvent(event.payload);
      const item = parsed?.item;
      const current = viewStateRef.current;
      if (!parsed || !item || !current) return;
      if (current.scope.userId !== parsed.scope.userId
        || current.scope.organizationId !== parsed.scope.organizationId
        || parsed.epoch > current.epoch) return;
      if (isTauri()) void invoke("focus_main").catch(() => undefined);
      void requestWorkspaceMode("admin").then((result) => {
        if (!result.ok) return;
        if (item.kind === "recap_reviewed") openAdminOttoSurface({ tab: "recaps" });
        else navigateAdmin("review", item.personId ? { personId: item.personId } : undefined);
      });
    }).then((cleanup) => {
      if (cancelled) cleanup(); else off = cleanup;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      off?.();
    };
  }, [navigateAdmin, openAdminOttoSurface, requestWorkspaceMode]);

  const coordinatedSend = useCallback(async (input: ChatRequest, signal?: AbortSignal): Promise<ChatResult> => {
    const client = conversationClientRef.current;
    if (!client) return sendAdminOttoChat(input, signal);
    const ticket = await client.beginSend({ requestId: input.requestId, conversationId: input.conversationId });
    try {
      const result = await sendAdminOttoChat(input, signal);
      await client.finishSend(ticket, result.conversationId);
      return result;
    } catch (error) {
      client.cancelSend(ticket);
      throw error;
    }
  }, []);
  const coordinatedDiscard = useCallback(async (input: { conversationId: string | null; requestId: string | null }) => {
    const client = conversationClientRef.current;
    if (client) return client.discard(input);
    return discardAdminOttoChat(input);
  }, []);

  const setWorkspaceMode = (next: "employee" | "admin") => requestWorkspaceMode(next).then((result) => {
    if (!result.ok) {
      const copy: Record<string, string> = {
        employee_unavailable: "This account has no personal workday mapped, so the administration workspace stays open.",
        admin_loading: "Administration is still loading. Try again in a moment.",
        admin_failed: "Administration could not load. Retry from Ask Otto in the Administration workspace.",
        admin_unavailable: "Administration is not available for this account.",
        offline: "You are offline. Connect and try again.",
        new_chat_pending: "A new chat is still being prepared. Try again in a moment.",
        switch_failed: "The view could not be changed. Try again.",
        stale_scope: "This view changed in another window. Try again.",
      };
      notifications.info(copy[result.reason] ?? "The view could not be changed.", "View unavailable");
    }
    return result;
  });

  /** Publish one grounded administration arrival to every Otto surface.
   *
   * The persistent card is the main window's durable record; the cross-window
   * event is the floating companion's bubble and card. A new arrival also
   * brings Administration forward once, quietly: the employee's own pending
   * prompt is untouched and returns when they switch back. */
  const announceAdminAttention = useCallback((item: AdminAttentionItem, options: {
    recap?: ReviewedRecap | null;
    toast?: boolean;
  } = {}): boolean => {
    if (adminAttentionAnnouncedRef.current === item.id) return false;
    adminAttentionAnnouncedRef.current = item.id;
    const scope = adminOttoContextQuery.data?.scope ?? adminOttoSnapshotRef.current?.scope ?? null;
    const epoch = adminOttoSnapshotRef.current?.epoch ?? 1;
    if (scope) {
      void emit(OTTO_ADMIN_ATTENTION_EVENT, adminAttentionEvent({ ...scope, mode: "admin" }, epoch, item));
    }
    const key = `admin-attention:${item.id}`;
    const clear = () => notifications.clearPersistent(key);
    const open = () => {
      clear();
      void setWorkspaceMode("admin").then((result) => {
        if (!result.ok) return;
        if (item.kind === "recap_reviewed") openAdminOttoSurface({ tab: "recaps", recap: options.recap ?? null });
        else navigateAdmin("review", item.personId ? { personId: item.personId } : undefined);
      });
    };
    const listen: NotificationAction[] = item.kind === "recap_reviewed" && item.count === 1 && options.recap
      ? [{
          label: "Listen",
          kind: "primary",
          onClick: () => {
            clear();
            setAdminOttoArrival(null);
            void setWorkspaceMode("admin").then((result) => {
              if (result.ok) openAdminOttoSurface({ tab: "recaps", recap: options.recap, listen: true });
            });
          },
        }]
      : [];
    const actions: NotificationAction[] = [...listen, {
      label: item.kind === "recap_reviewed" ? "View recaps" : "Review reports",
      kind: listen.length ? "quiet" : "primary",
      onClick: open,
    }];
    notifications.persistent(key, item.body, item.title, "info", { icon: "otto", actions });
    if (shouldAutoSwitchWorkspace({
      current: effectiveWorkspaceRef.current,
      target: "admin",
      available: adminContextState?.status === "ready",
    })) void requestWorkspaceMode("admin");
    if (options.toast !== false) {
      void presentAdminArrival(item.kind === "recap_reviewed" ? recapArrivalCopy(item.count) : eodArrivalCopy(item.count), {
        isWindowVisible: async () => {
          try {
            return isTauri() ? await getCurrentWindow().isVisible() : document.visibilityState !== "hidden";
          } catch {
            return false;
          }
        },
        // The persistent card above is a visible in-app surface even when the
        // employee workspace is the one on screen.
        inApp: () => true,
      });
    }
    return true;
  }, [adminContextState?.status, adminOttoContextQuery.data?.scope, navigateAdmin, notifications, openAdminOttoSurface, requestWorkspaceMode]);

  /** One grouped-arrival presentation used by both the local delivery owner and
   * an avatar-owned arrival forwarded over the changed event. It never opens a
   * window, switches tabs, starts audio, or moves focus. The OS toast is the
   * presentation when the main window is hidden; the persistent card is the
   * presentation when it is visible. */
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
      // Mode is deliberately not part of this fence: an admin arrival reaches
      // the person in either workspace, and the persisted record is the inbox.
      return !!current
        && current.epoch === requestedSnapshot.epoch
        && current.scope.userId === requestedSnapshot.scope.userId
        && current.scope.organizationId === requestedSnapshot.scope.organizationId;
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
    const announced = announceAdminAttention(recapAttentionItem({ count: input.count, eventIds: input.eventIds }), {
      recap,
      toast: false,
    });
    if (!announced) return true;
    return presentAdminArrival(recapArrivalCopy(input.count), {
      host: { isWindowVisible: async () => {
        try {
          return isTauri() ? await getCurrentWindow().isVisible() : document.visibilityState !== "hidden";
        } catch {
          return false;
        }
      } },
      inApp: () => true,
    });
  }, [announceAdminAttention, session?.token]);

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
      const revision = avatarVisibilityRevision.current;
      try {
        const windows = await getAllWebviewWindows();
        const avatar = windows.find((candidate) => candidate.label === "avatar");
        const visible = avatar ? await avatar.isVisible() : false;
        if (shouldApplyVisibilityPoll(revision, avatarVisibilityRevision.current, cancelled)) {
          setAvatarWindowVisible(visible);
        }
      } catch {
        if (shouldApplyVisibilityPoll(revision, avatarVisibilityRevision.current, cancelled)) {
          setAvatarWindowVisible(false);
        }
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  /* A hide from the avatar's own close button or the tray never passes through
     this window, so the host announces every transition. The menu label flips
     at once, and the minute poll stays as the fallback. */
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<boolean>(COMPANION_VISIBILITY_EVENT, (event) => {
      if (typeof event.payload !== "boolean") return;
      avatarVisibilityRevision.current += 1;
      setAvatarWindowVisible(event.payload);
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
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
      if (adminOttoSnapshot) {
        void emit(OTTO_CONTEXT_CLEARED_EVENT, ottoContextEvent(adminOttoSnapshot));
        adminOttoEpochRef.current = Math.max(adminOttoEpochRef.current, adminOttoSnapshot.epoch) + 1;
        setViewRevision((value) => value + 1);
      }
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
    viewFenceRef.current.invalidate();
    adminOttoEpochRef.current += 1;
    setViewRevision((value) => value + 1);
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
    const publish = () => {
      void emit(OTTO_CONTEXT_EVENT, ottoContextEvent(adminOttoSnapshot));
      if (viewStateRef.current) void emit(OTTO_VIEW_STATE_EVENT, viewStateRef.current);
    };
    publish();
    // A late avatar listener still adopts the current epoch even when this
    // main window has not crossed a boundary since it booted.
    const timer = window.setInterval(publish, 30_000);
    return () => window.clearInterval(timer);
  }, [avatarWindowVisible, adminOttoSnapshot]);

  useEffect(() => {
    if (!isTauri() || avatarWindowVisible !== true || !viewState) return;
    const publish = () => { void emit(OTTO_VIEW_STATE_EVENT, viewState); };
    publish();
    const timer = window.setInterval(publish, 30_000);
    return () => window.clearInterval(timer);
  }, [avatarWindowVisible, viewState]);

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
     drains catch-up pages once, and releases leases on cleanup. The delivery
     scope stays Administration even while the personal workspace is on screen:
     a reviewed recap is a team event, not a personal one. */
  useEffect(() => {
    const snapshot = adminOttoSnapshot;
    const adminContext = adminOttoContextQuery.data;
    if (!snapshot || !adminContext) return;
    // Wait for the first visibility read before choosing an owner in Tauri;
    // starting on "unknown" would race the avatar's own loop.
    if (isTauri() && avatarWindowVisible === null) return;
    if (deliveryOwnedContext !== deliveryOwnershipKey(snapshot)) return;
    const controller = startAuthorizedAdminRecapDelivery({
      signedIn, syncBypass, session: workSessionQuery.data ?? null,
      scope: { ...adminContext.scope, mode: "admin" },
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
          && current.scope.organizationId === scope.organizationId;
      },
      getMode: () => "admin",
      canPresent: () => true,
      onArrival: (arrival) => presentAdminOttoArrival({
        count: arrival.count,
        unread: arrival.unread,
        eventIds: arrival.eventIds,
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
  }, [signedIn, syncBypass, session?.token, session?.organizationId, workSessionQuery.data, adminOttoSnapshot, adminOttoContextQuery.data, avatarWindowVisible, deliveryOwnedContext, notifications, presentAdminOttoArrival]);

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
    void setWorkspaceMode("employee").then((result) => { if (result.ok) openGoalComposer(); });
  };
  const openEodDayInEmployeeView = (day: OutstandingEodDay) => {
    setNotificationsOpen(false);
    void setWorkspaceMode("employee").then((result) => {
      if (!result.ok) return;
      setEodLanding(false);
      setEodDate(day.date);
      setView("review");
    });
  };
  const openOverdueInEmployeeView = () => {
    setNotificationsOpen(false);
    void setWorkspaceMode("employee").then((result) => { if (result.ok) openOverdueTasks(); });
  };
  const historyQuery = useTaskHistoryQuery({
    enabled: employeePageEnabled && view === "evidence",
  });
  const workspaceHistoryQuery = useTaskHistoryQuery({
    enabled: employeePageEnabled && view === "tasks" && taskView === "all" && !!visibleDay?.shiftDate,
    workspace: true,
    view: "history",
    sort: taskWorkspaceSort,
    currentDate: visibleDay?.shiftDate ?? "",
    search: taskSearchQuery,
    fromDate: taskFilterFrom,
    toDate: taskFilterTo,
  });
  const completedHistoryQuery = useTaskHistoryQuery({
    enabled: employeePageEnabled && view === "tasks" && taskView === "completed" && !!visibleDay?.shiftDate,
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
    enabled: employeePageEnabled && view === "tasks" && taskView === "unfinished" && !!visibleDay?.shiftDate,
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
    enabled: employeePageEnabled && view === "tasks" && (taskView === "today" || selectedTaskDateIsHistorical) && !!selectedTaskDate,
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
  const backlogQuery = useTaskBacklogQuery({ enabled: employeePageEnabled && (view === "day" || carryOverOpen), sortDate: visibleDay?.shiftDate });
  const openTaskCountQuery = useOpenTaskCountQuery({
    enabled: personalNotificationReadsEnabled && !employeePageEnabled,
    date: sharedStatusQuery.data?.shiftDate ?? dayMonitor.sharedDay?.shiftDate,
  });
  const insightsQuery = useInsightsQuery({ enabled: employeePageEnabled && !debugScenario.enabled && view === "insights", range: insightRange, through: day?.shiftDate ?? "" });
  // The dashboard's margin rail reads the same seven-day record the web Today
  // page uses. It is a secondary instrument: a failed read leaves the command
  // center intact and the rail simply reports that the record is unavailable.
  const dashboardInsightsQuery = useDashboardInsightsQuery({ enabled: employeePageEnabled && !compactDayQuery.isFetching && compactDayQuery.isSuccess && !debugScenario.enabled && view === "day", through: day?.shiftDate ?? "" });
  const historicalQuery = useHistoricalDayQuery({ enabled: employeePageEnabled && view === "tasks", date: planHistoryDate, currentDate: day?.shiftDate ?? "" });
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
  const memoryPagesEnabled = memoryOpen && notificationReadsEnabled && !!memoryQuery.data?.factTotals;
  const rememberedQuery = useMemoryFactsQuery("confirmed", memoryPagesEnabled);
  const proposedMemoryQuery = useMemoryFactsQuery("candidate", memoryPagesEnabled);
  const memoryModalFacts = [
    ...new Map((rememberedQuery.data?.pages.flatMap(page => page.facts)
      ?? memoryQuery.data?.facts?.filter(fact => fact.review_status === "confirmed") ?? []).map(fact => [fact.id, fact])).values(),
    ...new Map((proposedMemoryQuery.data?.pages.flatMap(page => page.facts)
      ?? memoryQuery.data?.facts?.filter(fact => fact.review_status === "candidate") ?? []).map(fact => [fact.id, fact])).values(),
  ];
  const memoryFactPaging = memoryQuery.data?.factTotals ? {
    confirmed: {
      total: rememberedQuery.data?.pages[0]?.total ?? memoryQuery.data.factTotals.confirmed,
      hasMore: rememberedQuery.hasNextPage || (!rememberedQuery.data && !!memoryQuery.data.factNextCursors?.confirmed),
      loading: rememberedQuery.isFetching,
      error: rememberedQuery.error ? "Remembered facts could not be loaded. Please retry." : null,
      onLoadMore: () => { void requestMemoryFactPage(rememberedQuery); },
    },
    candidate: {
      total: proposedMemoryQuery.data?.pages[0]?.total ?? memoryQuery.data.factTotals.candidate,
      hasMore: proposedMemoryQuery.hasNextPage || (!proposedMemoryQuery.data && !!memoryQuery.data.factNextCursors?.candidate),
      loading: proposedMemoryQuery.isFetching,
      error: proposedMemoryQuery.error ? "Proposals could not be loaded. Please retry." : null,
      onLoadMore: () => { void requestMemoryFactPage(proposedMemoryQuery); },
    },
  } : undefined;
  const latestRecapQuery = useLatestActivityIntervalQuery({ enabled: notificationReadsEnabled,
    scope: workSessionQuery.data?.organizationId && workSessionQuery.data.personId
      ? { organizationId: workSessionQuery.data.organizationId, personId: workSessionQuery.data.personId } : null,
    pollMs: NOTIFICATION_POLL_MS });
  // Notices read only the authoritative latest recap; history pages are owned
  // by the stream and cannot influence which recap is announced.
  const readyRecapInterval = latestRecapQuery.data?.interval?.reviewStatus === "inferred" ? latestRecapQuery.data.interval : null;
  const recapSummary = useMemo(() => readyRecapInterval ? { id: readyRecapInterval.id, label: readyRecapInterval.label } : null, [readyRecapInterval]);
  const memoryCandidateCount = useMemo(() => memoryQuery.data?.factTotals?.candidate ?? (memoryQuery.data ? memoryCandidateIds(memoryQuery.data.facts).length : 0), [memoryQuery.data]);
  // The Admin tab reads the same live overview the administration pages use.
  // Its query key is shared, so opening the bell never starts a second record.
  // An administrator's overview also polls from the personal workspace: a
  // submitted EOD is a team event whether or not Administration is on screen.
  const adminNotificationReadsEnabled = (signedIn || ADMIN_SHELL_BOOT) && !syncBypass
    && workSessionQuery.data?.role === "admin";
  const adminNotificationQuery = useQuery<AdminOverview>({
    queryKey: adminKeys.overview(todayIso()),
    queryFn: () => fetchAdminOverview(),
    select: normalizeAdminOverview,
    enabled: adminNotificationReadsEnabled && !ADMIN_SHELL_BOOT,
    staleTime: 30_000,
    refetchInterval: adminNotificationReadsEnabled && !ADMIN_SHELL_BOOT ? 60_000 : false,
    refetchIntervalInBackground: true,
  });
  const adminShellNotificationPin = ADMIN_SHELL_BOOT ? ADMIN_SHELL_NOTIFICATIONS : null;

  /* EOD submissions are a team event in either workspace. The overview poll
     supplies the stable activity record; a watermark plus seen ids means a
     reload never re-announces the same report, while a report submitted while
     the app was closed is still caught on the next open. */
  useEffect(() => {
    if (ADMIN_SHELL_BOOT || syncBypass) return;
    const overview = adminNotificationQuery.data;
    const sessionData = workSessionQuery.data;
    if (!overview || !sessionData || sessionData.role !== "admin") return;
    const key = adminAttentionSeenKey({ userId: sessionData.userId, organizationId: sessionData.organizationId });
    const stored = adminAttentionSeenRef.current;
    const previous = stored && stored.scope === key && stored.day === overview.date ? stored : null;
    const result = eodAttentionFromOverview(overview, previous);
    const next = { ...result.seen, scope: key };
    adminAttentionSeenRef.current = next;
    writeAdminAttentionSeen(next);
    if (result.item) announceAdminAttention(result.item);
  }, [adminNotificationQuery.data, announceAdminAttention, syncBypass, workSessionQuery.data]);
  const adminNotificationFeed = workSessionQuery.data?.role === "admin" ? {
    overview: adminShellNotificationPin === "empty" && adminNotificationQuery.data
      ? emptyAdminNotificationOverview(adminNotificationQuery.data)
      : adminShellNotificationPin === "loading" || adminShellNotificationPin === "error"
        ? null
        : adminNotificationQuery.data ?? null,
    loading: adminShellNotificationPin === "loading"
      || (adminNotificationQuery.isFetching && !adminNotificationQuery.data),
    error: adminShellNotificationPin === "error"
      ? "Workspace notifications could not be loaded."
      : adminNotificationQuery.error
        ? errorMessage(adminNotificationQuery.error, "Workspace notifications could not be loaded.")
        : null,
    onRetry: () => void adminNotificationQuery.refetch(),
    onNavigate: (section: AdminSection, focus?: AdminSectionFocus) => {
      setNotificationsOpen(false);
      setWorkspaceMode("admin");
      navigateAdmin(section, focus);
    },
  } : undefined;
  const reportDayQuery = useReportDayQuery({ enabled: employeePageEnabled && view === "review", date: eodDate, currentDate: day?.shiftDate ?? "" });
  const screenshotGalleryQuery = useEodScreenshotsQuery({
    enabled: employeePageEnabled && view === "review" && !eodLanding,
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
      fetchOnboarding: () => queryClient.fetchQuery({ queryKey: workOsKeys.onboarding(), queryFn: () => fetchOnboarding(), staleTime: 0 }),
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
  useAttendanceWatch({ enabled: personalNotificationReadsEnabled && dayMonitor.owns, input: attendanceWatchInput(dayMonitor.sharedDay ?? sharedStatusQuery.data ?? visibleDay), onChange: () => {
    if (employeeBootstrapEnabled) onAttendanceChange();
    else void sharedStatusQuery.refetch();
  } });

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
    setSession(current); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length); setApiBase(settings.apiBase); setAutoStart(enabled); setAutoCheckUpdates(settings.autoCheckUpdates); setUpdateChannel(settings.updateChannel); setVoiceHotkeyEnabled(settings.voiceHotkey);
    if (!authResolutionHandledRef.current) setAwaitingApproval(Boolean(pendingAuth));
    void applyVoiceHotkey(settings.voiceHotkey);
    const appearance = normalizeAppearance(settings); setTextSize(appearance.textSize); setMascotSize(appearance.mascotSize); setTheme(appearance.theme); setThemePreview(appearance.theme); setThemePromptSeen(settings.themePromptSeen === true); setThemeSettingsLoaded(true); confirmedThemeRef.current = appearance.theme; rememberTheme(appearance.theme); applyAppearance(appearance); setRecapVoice(normalizeRecapVoice(settings.recapVoice));
    if (snapshot && snapshot.access?.organizationId === current?.organizationId) {
      // Seed the cache with the last workday snapshot for an instant first
      // paint; the live query revalidates it in the background. The snapshot
      // must not choose the Tasks date: it can describe yesterday after a
      // rollover, and the tasks header then hides its views and Add action.
      queryClient.setQueryData(workOsKeys.day("compact"), snapshot);
    }
    if (current) void refresh({ refreshAttendance: true, source: "vault" }).catch((value) => showError(value, "Could not load your workday.", "Workday unavailable"));
    if (!launchUpdateCheckRef.current && shouldAutoCheckUpdate({ supported: isTauri(), debugEnabled: debugRef.current.enabled, hasSession: !!current, autoCheckUpdates: settings.autoCheckUpdates })) {
      launchUpdateCheckRef.current = true;
      void checkForUpdates({ silent: true, channel: settings.updateChannel });
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
    void attempt.result.then(async (outcome: VaultGateSettled) => {
      vaultAttemptRef.current = null;
      // Hydrate from the vault only after its first open has settled. Starting
      // this restore at module load raced the gate's first open on a fresh
      // device and left the gate reporting ClientDataNotPresent.
      if (outcome.status === "ready" && !queryCacheRestoredRef.current) {
        queryCacheRestoredRef.current = true;
        const restoreStarted = performance.now();
        await restoreWorkOsQueryCache(queryClient);
        markStartupTiming("cache_restore", restoreStarted);
      }
      setVaultGate(outcome);
    });
  }, [queryClient]);

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
    void listenForAuthentication((saved) => { authResolutionHandledRef.current = true; setAwaitingApproval(false); resetSessionScopedReads(queryClient); setSession(saved); setConnectNotice(null); notifications.success("This device is connected to your workspace.", "Workspace connected"); void emit("work-os://main-session-changed"); void refresh({ refreshAttendance: true, source: "sign_in" }); }, (value) => { authResolutionHandledRef.current = true; setAwaitingApproval(false); showError(value, "Desktop authorization failed.", "Authorization failed"); }).then((fn) => { cleanup = fn; }).catch((value) => showError(value, "Could not listen for desktop sign-in.", "Sign-in listener failed"));
    return () => cleanup?.();
  }, [notifications, queryClient, refresh, showError]);

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

  // The floating Tasks tab's "View in app" jumps straight to the dock's Recaps
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

  // A ready recap announces itself per launch, but only the newest ready one.
  // Once that newest is approved an older recap never cascades into a flyout;
  // the floating companion keeps owning system-level delivery so one recap
  // never fires two system toasts.
  const latestRecapInterval = latestRecapQuery.data?.interval ?? null;
  const recapSurfaceWatermark = useRef<RecapWatermark | null>(null);
  const recapAccountRef = useRef<string | null>(null);
  const autoSwitchRecapWatermark = useRef<string | null>(null);
  useEffect(() => {
    const account = workSessionQuery.data ? `${workSessionQuery.data.organizationId}:${workSessionQuery.data.personId ?? workSessionQuery.data.userId}` : null;
    if (recapAccountRef.current === account) return;
    recapAccountRef.current = account;
    recapSurfaceWatermark.current = null;
    autoSwitchRecapWatermark.current = null;
  }, [workSessionQuery.data?.organizationId, workSessionQuery.data?.personId, workSessionQuery.data?.userId]);
  useEffect(() => {
    if (!latestRecapInterval) return;
    const decision = recapSurfaceDecision({ latest: latestRecapInterval, watermark: recapSurfaceWatermark.current, pendingRecap: null });
    recapSurfaceWatermark.current = decision.watermark;
    if (!decision.surface) return;
    // A recap is an employee notification even when Administration is on the
    // screen. Switch once for a genuinely new recap, never for the one already
    // waiting when the app opened.
    const recapId = latestRecapInterval.id;
    const firstObservation = autoSwitchRecapWatermark.current === null;
    const recapChanged = autoSwitchRecapWatermark.current !== recapId;
    autoSwitchRecapWatermark.current = recapId;
    if (recapChanged && shouldAutoSwitchWorkspace({
      current: effectiveWorkspaceRef.current,
      target: "employee",
      available: adminOttoBootstrap.switchToEmployeeAvailable,
      firstObservation,
    })) void requestWorkspaceMode("employee");
    notifications.info(
      "Confirm or correct what Otto saw during your last interval.",
      "Your recap is ready",
      { label: "Review", onClick: openGoalComposer },
      { icon: "otto" },
    );
  }, [latestRecapInterval, notifications]); // eslint-disable-line react-hooks/exhaustive-deps -- openGoalComposer only calls stable setters

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
  const overdueTaskCount = backlogQuery.data?.counts?.overdue ?? openTaskCountQuery.data?.counts?.overdue ?? overdueBacklog.length;
  const openOverdueTasks = useCallback(() => {
    setNotificationsOpen(false);
    // Restore the current workday and drop active filters — including the
    // visible search text — so the overdue section is actually visible
    // wherever the employee navigates from.
    taskDatePinnedRef.current = false;
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
      const result = await reviewMemoryFact(id, status);
      if (result.fact?.id !== id || result.fact.review_status !== status) throw new Error("The memory decision was not confirmed. Please retry.");
      const fact = memoryModalFacts.find(row => row.id === id) ?? memoryQuery.data?.facts?.find(row => row.id === id);
      if (fact) applyMemoryReviewToCaches(queryClient, fact, status);
      await queryClient.invalidateQueries({ queryKey: workOsKeys.memory() });
      return true;
    } catch (value) {
      setMemoryError(errorMessage(value, "That fact could not be updated."));
      return false;
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
      if (effectiveWorkspaceRef.current === "admin") {
        const handle = adminChatLifecycleRef.current;
        if (handle) {
          adminVoiceRecorderRef.current = handle.voice;
          adminVoiceStartedRef.current = true;
          handle.voice.start("hotkey");
        }
        return;
      }
      voiceRef.current.start("hotkey");
    }, { target: label })
      .then((fn) => unlisteners.push(fn)).catch(() => undefined);
    void listen<{ target?: string }>("work-os://voice/stop", (event) => {
      if (!isVoiceEventFor(event.payload, label)) return;
      if (adminVoiceStartedRef.current) {
        adminVoiceRecorderRef.current?.stop();
        adminVoiceStartedRef.current = false;
        return;
      }
      voiceRef.current.stop();
    }, { target: label })
      .then((fn) => unlisteners.push(fn)).catch(() => undefined);
    void listen<{ target?: string }>("work-os://voice/cancel", (event) => {
      if (!isVoiceEventFor(event.payload, label)) return;
      if (adminVoiceStartedRef.current) {
        adminVoiceRecorderRef.current?.cancel();
        adminVoiceStartedRef.current = false;
        return;
      }
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
      // One initial scheduled fixture, then unforced local state: a film can
      // exercise Clock in → Pause → Resume → Clock out through actual controls.
      const scheduledSeed = import.meta.env.DEV && debugScenario.dayState === "real"
        && new URLSearchParams(window.location.search).get("seed") === "scheduled";
      const fixture = scheduledSeed
        ? alignOfflineClock(applyDayScenario(null, { ...debugScenario, dayState: "scheduled" }) as DayData)
        : applyDayScenario(null, debugScenario) as DayData;
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
      setEodClockedOut(false);
      invalidateOutstandingEods();
      notifications.success("The report was built from your recorded day. Review every line.", "EOD draft ready");
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

  /** Rebuilds the same deterministic document from the current record. */
  const redraftEod = async (target: DayData | null) => {
    if (!target?.report) return;
    await createEodDraft(target);
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

  async function saveStructuredComposition(input: EodCompositionInput) {
    const reportId = String(reviewDay?.report?.id ?? "");
    if (!reportId) throw new Error("The report is not ready to save.");
    const result = await saveStructuredEod(reportId, input);
    if (result.queued) return "queued" as const;
    if (result.report) applyReportToDay(eodDate, result.report as NonNullable<DayData["report"]>);
    return "saved" as const;
  }

  async function writeStructuredSummary(input: EodCompositionInput, onChunk: (text: string) => void, signal: AbortSignal) {
    const date = reviewDay?.shiftDate ?? eodDate ?? "";
    if (!date) throw new Error("The report date is missing.");
    return streamEodSummary(date, input, onChunk, signal);
  }

  async function submitStructuredComposition(input: EodCompositionInput, idempotencyKey: string) {
    const reportId = String(reviewDay?.report?.id ?? "");
    if (!reportId) throw new Error("The report is not ready to submit.");
    const result = await submitStructuredEod(reportId, input, idempotencyKey);
    const queued = result.queued === true;
    setEodQueued(queued);
    setEodSubmitted(true);
    invalidateOutstandingEods();
    if (eodDate) void queryClient.invalidateQueries({ queryKey: workOsKeys.reportDay(eodDate) });
    return queued ? "queued" as const : "saved" as const;
  }

  function reloadStructuredReport() {
    if (eodDate) void reportDayQuery.refetch();
    else void refresh();
  }

  function bypassAct(label: string, mutator?: (day: DayData) => DayData) {
    diagnostics.info("ui.action.bypass", label, { activeView: view });
    if (mutator) setDay((current) => {
      const next = mutator(current ?? (applyDayScenario(null, debugScenario) as DayData));
      return label.startsWith("shift.") ? alignOfflineClock(next) : next;
    });
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

  async function act(label: string, action: () => Promise<unknown>, receipt?: { title?: string; message?: string; action?: { label: string; onClick: () => void } }) {
    setBusy(true); setError("");
    diagnostics.info("ui.action.requested", label, { activeView: view });
    try {
      if (syncBypassRef.current) {
      diagnostics.info("ui.action.bypass", label, { activeView: view });
      notifications.success(receipt?.message ?? actionSuccessMessages[label] ?? "The change was saved on this device.", receipt?.title, receipt?.action);
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
        // These writes change which tasks belong to the day's plan, so the
        // compact day cannot wait for its 60s poll to tell the focus strip.
        if (["workspace.task_surface", "workspace.task_defer", "task.archive", "task.delete"].includes(label)) {
          invalidateDayData();
        }
      } else {
        invalidateDayData();
        await refresh();
      }
      const queue = await secureState.queue(); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length);
      void emit("work-os://main-day-changed");
      diagnostics.info("ui.action.completed", label, { activeView: view });
      notifications.success(receipt?.message ?? (isWorktivityControlResult(result) && result.status === "confirmed" && result.already_target
        ? "Worktivity already reflects this attendance state."
        : actionSuccessMessages[label] ?? "The change was saved."), receipt?.title, receipt?.action);
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


  /** Apply first, persist second: the choice must land instantly in both
   * windows, and a failed save rolls the visible state back rather than
   * leaving the control and the rendering disagreeing. */
  async function chooseTextSize(next: TextSize) {
    const previous = textSize;
    setTextSize(next);
    applyAppearance({ ...appearanceRef.current, textSize: next });
    try {
      await secureState.saveSettings({ textSize: next });
      void emit(APPEARANCE_EVENT, { ...appearanceRef.current, theme: confirmedThemeRef.current, textSize: next });
    } catch (value) {
      setTextSize(previous);
      applyAppearance({ ...appearanceRef.current, textSize: previous });
      showError(errorMessage(value, "The text size could not be saved."), "The text size could not be saved.", "Setting not saved");
    }
  }

  async function chooseMascotSize(next: MascotSize) {
    const previous = mascotSize;
    setMascotSize(next);
    applyAppearance({ ...appearanceRef.current, mascotSize: next });
    try {
      await secureState.saveSettings({ mascotSize: next });
      void emit(APPEARANCE_EVENT, { ...appearanceRef.current, theme: confirmedThemeRef.current, mascotSize: next });
    } catch (value) {
      setMascotSize(previous);
      applyAppearance({ ...appearanceRef.current, mascotSize: previous });
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
      await clearWorkOsAccountCache(queryClient, session?.token ?? null);
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
    if (!hasVisibleSession || !visibleDay || adminShellActive || visibleOnboarding?.onboardingRequired || !gate.persistentMessage) {
      notifications.clearPersistent("work-os-session-gate");
      return;
    }
    notifications.persistent("work-os-session-gate", gate.persistentMessage, gate.persistentTitle, "info");
  }, [adminShellActive, visibleDay, gate.persistentMessage, gate.persistentTitle, hasVisibleSession, notifications, visibleOnboarding?.onboardingRequired]);
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
  // The compact day is capped at 24 tasks; the ordered day page reaches 50 and
  // carries complete subtask lists. The focus view reads the wider set so a
  // plan parent outside the compact window still has its children.
  const focusDayTasks = useMemo(
    () => uniqueTasks([...(todayTaskHistoryQuery.data?.pages.flatMap((page) => page.tasks) ?? []), ...visibleTodayTasks]),
    [todayTaskHistoryQuery.data, visibleTodayTasks],
  );
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
  const reviewSubmittedStatus = submittedEodStatus(reviewDay?.report);
  const reviewDetailsReady = eodDate ? Boolean(reportDayQuery.data) : dayDetailsLoaded;
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
  useEffect(() => {
    if (view !== "review" || eodLanding || eodDate) return;
    const currentDate = visibleDay?.shiftDate ?? null;
    if (!shouldPrepareStructuredEod(reviewDay?.report, currentDate)) return;
    const date = String(reviewDay?.report?.report_date ?? currentDate ?? "");
    if (!date) return;
    if (preparedReviewDates.current.has(date)) return;
    preparedReviewDates.current.add(date);
    void prepareStructuredEod(date).then((result) => {
      if (result.report) applyReportToDay(null, result.report as NonNullable<DayData["report"]>);
    }).catch(() => undefined);
  }, [view, reviewDay, eodLanding, eodDate, visibleDay?.shiftDate, applyReportToDay]);

  const outstandingDays = outstandingQuery.data?.days ?? [];
  const goalSuggestion = useMemo(() => suggestDailyGoal(parentTasks(visibleDay?.tasks ?? []), visibleDay?.shiftDate ?? "", planItems), [visibleDay?.tasks, visibleDay?.shiftDate, planItems]);
  // The server backlog is the complete open set (not the paginated history
  // window), so removing today's day-scoped work yields exactly what the Tasks
  // page shows as Unfinished — one membership rule for both surfaces. Until the
  // backlog arrives (or if it fails) fall back to the computed carry-over so
  // the tabs are never silently empty.
  const openBacklog = useMemo(() => (backlogQuery.data ? parentTasks(uniqueTasks(backlogQuery.data.tasks)) : null), [backlogQuery.data]);
  const unfinishedCarryOver = useMemo(() => {
    const computed = openBacklog
      ? (() => {
        const todayIds = new Set(todayParentTasks.map((task) => taskRowId(task)));
        return unfinishedBefore(openBacklog.filter((task) => !todayIds.has(taskRowId(task))), visibleDay?.shiftDate ?? "");
      })()
      : unfinishedBefore(parentTasks(taskHistory), visibleDay?.shiftDate ?? "");
    // The compact day carries a bounded sample across every carry-over group
    // with exact counts; merging it keeps Yesterday populated even when the
    // first backlog page is all older work.
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
  // The compact day returns exact carry-over counts with a bounded page. Tabs
  // still state the complete set, while the visible rows remain the loaded window.
  const carryOverTotals = useMemo(() => {
    const groups = visibleDay?.workspaceSummary?.carryOverGroups;
    if (!groups?.length) return undefined;
    const count = (group: { tasks?: unknown[]; count?: number }) => group.count ?? group.tasks?.length ?? 0;
    return {
      yesterday: groups.filter((group: any) => group.key === "yesterday").reduce((sum: number, group: any) => sum + count(group), 0),
      other: groups.filter((group: any) => group.key !== "yesterday").reduce((sum: number, group: any) => sum + count(group), 0),
    };
  }, [visibleDay?.workspaceSummary?.carryOverGroups]);
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
    schedule: visibleDay?.arrangement?.kind === "flexible" ? null : dashboardSchedule,
    currentDate: visibleDay?.shiftDate ?? "",
    timezone: dashboardTimezone,
    now: pulseNow,
  }), [dashboardSchedule, dashboardTimezone, pulseNow, visibleDay?.arrangement?.kind, visibleDay?.shift, visibleDay?.shiftDate, workSession]);
  const pulse = shiftPulse(workSession, dashboardShift, pulseNow, visibleDay?.breakPolicy?.worktivityAuthoritative === true, visibleDay?.attendance);
  const dashboardModel = useMemo(() => buildWorkdayDashboardModel({
    active,
    paused,
    observedOnly,
    currentDate: visibleDay?.shiftDate ?? "",
    shift: dashboardShift,
    session: workSession,
    schedule: visibleDay?.arrangement?.kind === "flexible" ? null : dashboardSchedule,
    arrangement: visibleDay?.arrangement ?? null,
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
    if (themePromptOpen || !themePromptSeen) return;
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
  }, [active, dayLive, debugScenario.planningState, debugScenario.enabled, debugScenario.dayState, themePromptOpen, themePromptSeen, visibleDay?.plan?.status, visibleDay?.prompt.kind, visibleDay?.prompt.required]);

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

  async function confirmPlanning(input: string, interpretation: PlanningInterpretation | null, clarificationAnswers: Record<string, string>): Promise<PlanningConfirmResult> {
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
      const outcome = classifyPlanSaveFailure(value);
      if (outcome === "conflict") {
        resyncPlanFromServer();
        notifications.info("Showing the saved plan from your workspace. Close and reopen the focus editor to change it.", "Plan refreshed");
        return "conflict";
      }
      // An expired/used AI build cannot be retried with the same build id;
      // surface it so the editor drops the stale draft and offers Build again.
      if (outcome === "rebuild") {
        notifications.info("The AI plan build expired. Build the plan again to confirm it.", "Build again");
        return "rebuild";
      }
      return outcome;
    } finally {
      setBusy(false);
    }
  }

  function openPlanningSession() { planningAutoOpenedRef.current = false; setPlanningSeed(null); setPlanningSessionOpen(true); }

  async function loadPlanHistory(date: string) {
    // Only an explicit navigation may keep the list off the live workday; the
    // day payload then leaves that historical choice alone.
    taskDatePinnedRef.current = !!date && date !== (visibleDay?.shiftDate ?? "");
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
    const closePanel = completionClosesTaskPanel(taskDetails?.task as TaskRow | undefined, taskId, completed);
    setDay((current) => ({ ...current ?? (applyDayScenario(null, debugScenario) as DayData), tasks: current?.tasks?.map((row) => String(row.provider_task_id || row.id) === taskId ? { ...row, completed, ...(row.capabilities ? { capabilities: completionTaskCapabilities(row, completed, taskCalendarDate) } : {}) } : row) ?? [] }));
    if (refreshDetails && taskDetails && !closePanel) {
      setTaskDetails((current) => current ? {
        ...current,
        task: String(current.task.provider_task_id || current.task.id) === taskId ? { ...current.task, completed, ...(current.task.capabilities ? { capabilities: completionTaskCapabilities(current.task, completed, taskCalendarDate) } : {}) } : current.task,
        subtasks: current.subtasks.map((row) => String(row.provider_task_id || row.id) === taskId ? { ...row, completed, ...(row.capabilities ? { capabilities: completionTaskCapabilities(row, completed, taskCalendarDate) } : {}) } : row),
      } : current);
    }
    if (closePanel) setTaskDetails(null);
    if (completed) {
      const receipt = taskCompletionReceipt(task, () => requestTaskEvidence(task));
      notifications.success(receipt.message, receipt.title, receipt.action);
    } else {
      notifications.success(actionSuccessMessages["task.reopen"]);
    }
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
    // The drawer can change while the row plays its exit. Decide against the
    // committed drawer now, so completing task A never clears task B and a
    // drawer opened for A during the delay still closes.
    const closePanel = completionClosesTaskPanel(taskDetailsRef.current?.task as TaskRow | undefined, taskId, completed);
    if (closePanel) {
      setTaskDetails(null);
      return;
    }
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
    const receipt = completed ? taskCompletionReceipt(task, () => requestTaskEvidence(task)) : null;
    void act(completed ? "task.complete" : "task.reopen", async () => {
      try {
        await updateTaskCompletion(taskId, completed);
      } catch (value) {
        // A failed completion must restore the checkbox, not leave it spinning.
        setCompletingTaskIds((current) => { const next = new Set(current); next.delete(taskId); return next; });
        throw value;
      }
      await applyConfirmedTaskCompletion(task, completed, refreshDetails);
    }, receipt ?? undefined);
  }

  async function requestTaskCompletion(task: TaskRow, completed: boolean, refreshDetails = false) {
    const sequence = ++taskEvidenceRequestSeq.current;
    if (!completed) { setTaskCompletion(task, false, refreshDetails); return; }
    if (syncBypassRef.current || !taskCompletionNeedsEvidenceStep(task)) { setTaskCompletion(task, true, refreshDetails); return; }
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
      await apiRequest("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: subtaskTitle.trim(), description: subtaskDescription.trim() || undefined, parent_task_id: parentId, assignee_person_ids: visibleDay?.access?.personId ? [visibleDay.access.personId] : [] }) });
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
      // The controller may need one controlled Worktivity restart, wait for
      // its renderer, then wait for the control to become actionable.
      executeTimeoutMs: 60_000,
      onPhase: setWorktivityControlPhase,
    }).finally(() => setWorktivityControlPhase(null));
  }

  function clockIn() {
    if (visibleDay?.arrangement?.kind === "flexible" && !syncBypassRef.current) {
      void act("shift.clock_in", () => performWorktivityControl("clock_in"));
      return;
    }
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
    const extendedAcknowledged = extendedClockOut || clockOutExtendedPrompt || visibleDay?.arrangement?.kind === "flexible";
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
    const fence = viewFenceRef.current.capture();
    const taskOptions = interpretationTaskOptions();
    setInterpretation({ status: "loading", operations: [], taskOptions });
    setAiUnavailable(null);
    const traceStartedAt = Date.now();
    const trace: AvatarThinkingStage[] = [{ label: "Sending your update" }];
    setComposerThinking({ stages: [...trace], active: 0, startedAt: traceStartedAt });
    const advanceTrace = (label: string) => {
      if (!fence.isCurrent()) return;
      trace.push({ label });
      setComposerThinking({ stages: [...trace], active: trace.length - 1, startedAt: traceStartedAt });
    };
    void apiRequest<{ interpretation: unknown }>("/api/work-os/me/interpret", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ input: text, planIntent: planIntent || null, today: visibleDay?.shiftDate ?? null, history: history.slice(-24).map(({ role, text: turnText }) => ({ role, text: turnText })) }),
    }).then(async (result) => {
      if (!fence.isCurrent()) return;
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
      if (!fence.isCurrent()) return;
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
      if (!fence.isCurrent()) return;
      const reviewId = crypto.randomUUID();
      setInterpretation({ status: "ready", operations, taskOptions, reply: review.reply, results: displayResults.length ? displayResults : undefined, reviewId });
      setComposerThinking(null);
      setComposerHistory((current) => [...current, { id: reviewId, role: "assistant", text: review.reply || "Here's what I understood.", meta: filing.proposals.length ? `${filing.proposals.length} proposed update${filing.proposals.length === 1 ? "" : "s"}` : displayResults.length ? "tasks shown" : undefined, createdAt: new Date().toISOString(), operations, toolResults: displayResults.length ? displayResults : undefined }]);
      // The turn above is the record now: keeping the live interpretation too
      // would render the same reply (and cards) twice, and the persisted turn
      // is what survives a reload (design §25.11).
      setInterpretation(null);
      if (!fence.isCurrent()) return;
      void sharePendingTools({ reviewId, input: text, reply: review.reply, operations, results: displayResults, taskOptions });
    }).catch((value) => {
      if (!fence.isCurrent()) return;
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
    const fence = viewFenceRef.current.capture();
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
      if (!fence.isCurrent()) return;
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
      if (!fence.isCurrent()) return;
      close(reviewedResults, parts.join(" · ") || "No actions were recorded");
      if (!fence.isCurrent()) return;
      void sharePendingTools({
        reviewId: interpretation?.reviewId ?? crypto.randomUUID(),
        input: text,
        reply: interpretation?.reply,
        operations: (interpretation?.operations ?? [...enabled, ...rejected]).map((op) => ({ ...op, enabled: false })),
        results: mergeToolResults(interpretation?.results ?? [], reviewedResults),
        taskOptions: interpretation?.taskOptions ?? [],
      });
      if (!fence.isCurrent()) return;
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
      if (!fence.isCurrent()) return;
      showError(value, "Your approved updates could not be filed.", "Filing failed");
    }).finally(() => { if (fence.isCurrent()) setBusy(false); });
  }

  function retryInterpretationOperation(result: ToolCallResult) {
    const op = { ...result.op, enabled: true };
    if ((!op.proposalId && !op.batchId) || busy) return;
    const review = interpretation;
    setBusy(true); setError("");
    const fence = viewFenceRef.current.capture();
    void fileApprovedOperations([op], proposalFilingTransport(), result.createResolution ? { createResolution: result.createResolution } : undefined).then((outcome) => {
      if (!fence.isCurrent()) return;
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
    }).catch((value) => { if (fence.isCurrent()) showError(value, "The retry could not be filed.", "Retry failed"); })
      .finally(() => { if (fence.isCurrent()) setBusy(false); });
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
    const fence = viewFenceRef.current.capture();
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
      if (!fence.isCurrent()) return;
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
    })().catch((value) => { if (fence.isCurrent()) showError(value, "The review could not be filed.", "Review failed"); })
      .finally(() => { if (fence.isCurrent()) setBusy(false); });
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
    const fence = viewFenceRef.current.capture();
    void fileApprovedOperations([op], proposalFilingTransport(), result.createResolution ? { createResolution: result.createResolution } : undefined).then((outcome) => {
      if (!fence.isCurrent()) return;
      patchHistoryTurn(turnId, outcome.results);
      if (outcome.recorded > 0) {
        if (!outcome.failed.length && outcome.queued === 0 && outcome.processing === 0) setMascotReceipt({});
        notifications.success("Recorded the retried update.", "Retry succeeded");
        void refresh();
        return;
      }
      notifications.error(outcome.failed[0]?.message ?? outcome.results[0]?.message ?? "The retry did not record.", "Retry failed");
    }).catch((value) => { if (fence.isCurrent()) showError(value, "The retry could not be filed.", "Retry failed"); })
      .finally(() => { if (fence.isCurrent()) setBusy(false); });
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

  // The webview's own right-click menu makes the companion read as a browser
  // page. Text fields keep the platform edit menu for paste and spellcheck.
  useEffect(() => {
    if (!contextMenuSuppressionEnabled) return;
    return installContextMenuSuppression();
  }, [contextMenuSuppressionEnabled]);

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
    {themePromptOpen && <ThemePrompt
      selected={themePreview}
      saving={themePromptSaving}
      error={themePromptError}
      onSelect={selectThemePreview}
      onUse={() => void useThemePrompt()}
      onDismiss={dismissThemePrompt}
    />}
    {whatsNew && <WhatsNewModal displayVersion={displayUpdateVersion(whatsNew.version)} bullets={changelogBulletsFor(CHANGELOG_RAW, whatsNew.version)} history={changelogHistory(CHANGELOG_RAW, whatsNew.version)} onClose={() => setWhatsNew(null)} />}
    {debugPageGuide && <PageGuide view={debugPageGuide} autoOpen={pageGuideAutoOpen} developerPreview onClose={() => setDebugPageGuide(null)} onDisableAutoOpen={() => undefined} />}
    {!debugPageGuide && openPageGuide && <PageGuide view={openPageGuide} autoOpen={pageGuideAutoOpen} onClose={closeGuide} onDisableAutoOpen={disableAutoOpen} onStartTour={offerWorkspaceTour ? () => { const scope = isAdminGuideView(openPageGuide) ? "admin" : "employee"; closeGuide(); setTourScope(scope); } : undefined} />}
    {/* The tour walks the pages of the branch that offered it: the employee
        sidebar or the administration sections, each of which it navigates for
        real. It never mounts outside its own branch. */}
    {tourScope === "employee" && employeeWorkspaceBranch && <GuideTour onNavigate={navigateEmployeeGuide} onClose={() => setTourScope(null)} />}
    {tourScope === "admin" && adminWorkspaceBranch && <GuideTour pages={ADMIN_TOUR_PAGES} subject="the administration workspace" onNavigate={navigateAdminGuide} onClose={() => setTourScope(null)} />}
    {memoryOpen && <MemoryModal
      facts={memoryModalFacts}
      factPaging={memoryFactPaging}
      recent={memoryQuery.data?.recent ?? []}
      busy={memoryBusy}
      error={memoryError}
      onReview={reviewMemory}
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
    navigateAdmin("settings", { settingsPage: "profile" });
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
  const settingsPropsFor = (surface: "employee" | "admin") => {
    const settingsProps = {
      hasPersonalRecord: !!visibleOnboarding,
      adminOttoSettings: surface === "admin" && followSettingsScope ? (
        <Suspense fallback={null}><AdminOttoSettings
          key={`admin-otto-follows:${followSettingsScope.userId}:${followSettingsScope.organizationId}`}
          scope={followSettingsScope}
          {...(adminOttoFollowFixture ? { transport: adminOttoFollowFixture.transport } : {})}
        /></Suspense>
      ) : undefined,
      profileSettings: visibleOnboarding
        ? <ProfileSettings data={visibleOnboarding} mode="page" busy={busy} onSave={saveProfileSettings} onNotify={notifications.notify} />
        : undefined,
      tourScope: surface,
      onReplayTour: () => setTourScope(surface),
      onOpenProfile: surface === "admin" ? openProfileFromAdmin : () => setProfileOpen(true),
      autoStart,
      onAutoStart: (value: boolean) => void toggleAutoStart(value),
      voiceHotkeyEnabled,
      voiceHotkeyError,
      onVoiceHotkey: (value: boolean) => void toggleVoiceHotkey(value),
      recapVoice,
      onRecapVoice: (next: string) => void chooseRecapVoice(next),
      autoCheckUpdates,
      onAutoCheckUpdates: (value: boolean) => void toggleAutoCheckUpdates(value),
      updateChannel,
      onUpdateChannel: (value: typeof updateChannel) => void chooseUpdateChannel(value),
      updateDetail: updateRowCopy(updateRowSummary, installedVersion),
      updateStatus: updateFlow.status,
      installedVersion: installedVersionRaw,
      onCheckForUpdates: () => void checkForUpdates(),
      onDownloadUpdate: () => void beginUpdateDownload(),
      onInstallUpdate: () => void installDownloadedUpdate(),
      onOpenWhatsNew: surface === "admin" ? openChangelogFromAdmin : (version: string) => setWhatsNew({ version }),
      pageGuideAutoOpen,
      onPageGuideAutoOpen: setPageGuideAutoOpen,
      theme,
      textSize,
      mascotSize,
      onTheme: (value: typeof theme) => void chooseTheme(value, { markSeen: true }).catch((error) => showError(error, "The theme could not be saved.", "Setting not saved")),
      onTextSize: (value: typeof textSize) => void chooseTextSize(value),
      onMascotSize: (value: typeof mascotSize) => void chooseMascotSize(value),
      queueCount,
      queueAttentionCount,
      sessionApiBase: visibleSession?.apiBase ?? "",
      agentAccessSurface: surface,
      adminAgentApiEnabled: workSessionQuery.data?.featureFlags?.admin_agent_api === true,
      onSignOut: () => void logout(),
      memory: {
        facts: memoryQuery.data?.facts ?? [],
        factTotals: memoryQuery.data?.factTotals,
        loading: memoryQuery.isPending && !memoryQuery.data,
        error: !memoryQuery.data && memoryQuery.error ? errorMessage(memoryQuery.error, "Memory could not be loaded.") : null,
      },
      onOpenMemory: () => setMemoryOpen(true),
      onRetryMemory: () => void memoryQuery.refetch(),
      onOpenDebugger: () => void openDebugger(),
      onExportDiagnostics: () => void exportAppDiagnostics(),
      onResetOnboarding: () => void resetOnboarding(),
      busy,
    };
    return settingsProps;
  };

  /* Only a branch that mounts an overlay may hold the lock or trap focus for
   * it: nothing counts on the boot screens, and within a workspace branch the
   * employee-only flags count only where they render (design §9). */
  const modalOpen = (adminWorkspaceBranch || employeeWorkspaceBranch) && overlayScrollLockActive(employeeWorkspaceBranch, { global: globalOverlaysOpen, employeeOnly: employeeOnlyOverlaysOpen });
  useModalFocusTrap({ modalOpen, taskFinderOpen, dismissTopLayer });

  /* The View menu owns the floating companion's visibility. `null` means the
     first visibility read has not landed, and showing is the safe action:
     invoking it again cannot lose a window and the label already says "Show".
     The host's visibility event is the only writer after a command, so a
     delayed invoke result cannot overwrite a newer tray/avatar transition. */
  const toggleOtto = useCallback(async () => {
    if (!isTauri()) return;
    const nextVisible = avatarWindowVisible !== true;
    try {
      // Literal command names keep the Tauri ACL auditable.
      if (nextVisible) await invoke("show_avatar");
      else await invoke("hide_avatar");
    } catch {
      /* The host announces every transition and the visibility poll remains
         the fallback; a failed command does not get to write the label. */
    }
  }, [avatarWindowVisible]);

  const quitApp = () => {
    if (!isTauri()) {
      notifications.info("Quit is available in the desktop app.", "Desktop only");
      return;
    }
    void invoke("quit_app").catch((value) => showError(value, "Work OS could not quit.", "Quit failed"));
  };

  const frameWindow = (content: ReactNode, groups: AppMenuGroup[], page: string, status: string | null = null) => customWindowChrome
    ? <div className="window-chrome-frame">
      <AppMenuBar
        pageLabel={page}
        statusLabel={status}
        statusTone={adminWorkspaceBranch ? "admin" : "shift"}
        menuGroups={groups}
        onQuit={quitApp}
        variant={macChrome ? "mac" : "windows"}
        nightly={updateChannel === "nightly"}
      />
      <NativeAppMenu groups={groups} />
      <div className="window-chrome-content">{content}</div>
    </div>
    : content;

  if (landing === "vault_failed") {
    // The seam decides the surface; the gate's own state carries the failure.
    const vaultFailure = vaultGate.status === "failed" ? vaultGate.failure : null;
    return frameWindow(<LoadingScreen
      failed
      retry={retryVaultGate}
      note={vaultFailure?.message}
      onReset={vaultFailure?.requiresReset ? startFreshOnThisDevice : undefined}
      onDebug={() => void openDebugger()}
    />, [], "Recovery");
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
  const chatViewSwitch = viewState ? <CompanionViewSwitch
    mode={viewState.workspace}
    employeeAvailable={viewState.employeeAvailable}
    adminAvailable={viewState.adminAvailable}
    employeeReason={viewState.employeeAvailable ? null : viewState.adminStatus === "loading" ? "Loading your workspace…" : viewState.adminStatus === "failed" ? "Your workspace is unavailable until Administration connects." : "No personal workday is mapped."}
    adminReason={viewState.adminAvailable ? null : viewState.adminStatus === "loading" ? "Loading Administration…" : "Administration is unavailable."}
    switchable={viewState.role === "admin"}
    onSwitch={(next) => { void setWorkspaceMode(next); }}
  /> : undefined;
  const renderAdmin = () => {
    // The administration branch only renders with a session; the seam's string
    // cannot narrow that for TypeScript.
    if (!workSessionQuery.data) return null;
    /* The administration masthead's bell is the same surface the employee
     * masthead mounts: its Employee tab reads the signed-in account's own
     * notifications, its Admin tab the live workspace record. The loading and
     * error pins exist only in the dev-only shell harness, which has no backend
     * to answer the bell's reads (see adminShell.ts). */
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
        // the outstanding days and the workspace record whenever the panel opens.
        if (next && !ADMIN_SHELL_BOOT) {
          void outstandingQuery.refetch();
          void adminNotificationQuery.refetch();
        }
      },
      onClose: () => setNotificationsOpen(false),
      onSelect: openEodDayInEmployeeView,
      onOpenMemory: () => { setNotificationsOpen(false); setMemoryOpen(true); },
      onOpenRecap: openRecapInEmployeeView,
      onOpenOverdue: openOverdueInEmployeeView,
      onRetry: () => void outstandingQuery.refetch(),
      admin: adminNotificationFeed,
      defaultTab: "admin",
    };
    const openAdminOtto = () => openAdminOttoSurface({ newChat: true });
    // Ask Otto is the reopen control, not a second New chat: it hydrates the
    // retained server conversation instead of discarding it.
    const resumeAdminOtto = () => openAdminOttoSurface();
    return <>
      <Suspense fallback={<main className="loading" role="status"><p>Loading administration…</p></main>}><AdminWorkspace
        session={workSessionQuery.data}
        notifications={personalNotificationReadsEnabled ? adminNotifications : null}
        section={adminSection}
        focus={adminFocus}
        onNavigate={navigateAdmin}
        guideView={pageGuideView}
        onOpenGuide={openGuide}
        onNewChat={openAdminOtto}
        onOpenOtto={resumeAdminOtto}
        onOpenRecaps={() => openAdminOttoSurface({ tab: "recaps" })}
        ottoNotice={adminContextState?.status === "failed"
          ? "Admin Otto could not load its administration context. Retry from Ask Otto; the workspace record remains available."
          : adminContextState?.status === "loading"
            ? "Loading the administration context…"
            : null}
        personalSettingsProps={settingsPropsFor("admin")}
        profile={visibleOnboarding
          ? { name: visibleOnboarding.profile.displayName, avatarUrl: visibleOnboarding.profile.avatarUrl, onOpen: openProfileFromAdmin }
          : adminOttoContextQuery.data?.displayName
            ? { name: adminOttoContextQuery.data.displayName, avatarUrl: adminOttoContextQuery.data.avatarUrl, onOpen: openProfileFromAdmin }
            : null}
        onOpenWhatsNew={openChangelogFromAdmin}
        onSwitchToEmployee={adminOttoBootstrap.switchToEmployeeAvailable ? () => setWorkspaceMode("employee") : undefined}
        onSignOut={() => { void logout(); }}
      /></Suspense>
      {adminOttoEntryOpen && (adminOttoContextQuery.data || ADMIN_SHELL_BOOT) ? (
        <Suspense fallback={null}><AdminOttoChat
          key={`${JSON.stringify(adminOttoContextQuery.data?.scope ?? ADMIN_SHELL_SESSION.userId)}:${adminOttoRequestedRecap?.intervalId ?? "none"}:${adminOttoEpoch}:${conversationState?.generation ?? 1}`}
          scope={adminOttoContextQuery.data?.scope ?? {
            userId: ADMIN_SHELL_SESSION.userId,
            organizationId: ADMIN_SHELL_SESSION.organizationId,
            mode: "admin",
          }}
          conversationId={adminOttoConversationId}
          headerLeading={chatViewSwitch}
          onNewChat={() => {
            setAdminOttoConversationId(null);
            setAdminOttoDraft("");
            adminOttoRetryRequestId.current = null;
            setAdminOttoResetToken((value) => value + 1);
          }}
          initialTab={adminOttoInitialTab}
          tabRequest={adminOttoTabRequest}
          initialRecap={adminOttoRequestedRecap}
          arrival={adminOttoArrival}
          arrivalRevision={adminOttoArrivalRevision}
          followRevision={adminOttoFollowRevision}
          playback={adminAudio.playback}
          recapUpdates={adminAudio.recapUpdates}
          initialDraft={adminOttoDraft}
          initialRequestId={adminOttoRetryRequestId.current}
          resetToken={adminOttoResetToken}
          refreshRevision={conversationState?.revision ?? 0}
          onRecoveryChange={rememberAdminOttoRecovery}
          onLifecycle={(handle) => { adminChatLifecycleRef.current = handle; }}
          isCurrent={() => {
            const current = adminOttoModeRef.current?.snapshot();
            const expected = adminOttoSnapshotRef.current;
            return !!current && !!expected
              && current.epoch === expected.epoch
              && sameOttoScope(current.scope, expected.scope);
          }}
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
          } : { send: coordinatedSend, discard: coordinatedDiscard }}
          previewOnly={false}
          onArrivalSeen={() => {
            notifications.clearPersistent("admin-otto-recap-arrival");
            setAdminOttoArrival(null);
          }}
          onConversation={handleAdminOttoConversation}
          onClose={() => { adminChatLifecycleRef.current?.suspend(); adminAudio.stop(); setAdminOttoEntryOpen(false); }}
        /></Suspense>
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
    <a className="skip-link" href="#work-os-main">Skip to content</a>
    {view === "settings" ? <SettingsSidebar
      active={settingsNav.active}
      visiblePages={settingsNav.visiblePages}
      query={settingsNav.query}
      onQuery={settingsNav.setQuery}
      onSelect={settingsNav.selectPage}
      onBack={() => setView(lastNonSettingsView.current)}
      hasPersonalRecord={!!visibleOnboarding}
      displayName={visibleOnboarding?.profile.displayName}
      avatarUrl={visibleOnboarding?.profile.avatarUrl}
    /> : <SidebarNav
      activeView={view}
      onNavigate={navigateToView}
      onNewChat={startNewChat}
      onSignOut={() => { void logout(); }}
      onSwitchWorkspace={workSessionQuery.data?.role === "admin" ? () => setWorkspaceMode("admin") : undefined}
      switchLabel="Open administration"
    />}
    <div className={`stage${dockVisible ? " has-dock" : ""}`}>
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
        admin={adminNotificationFeed}
        defaultTab="employee"
      />}<button className="icon" title="Refresh this page" disabled={refreshing} onClick={() => void refreshActiveView()}>{refreshing ? <FadeArc size={17} /> : <RefreshCw size={17} />}</button><button className="avatar" aria-label={`Profile for ${visibleOnboarding.profile.displayName}`} title="Open profile settings" onClick={() => { navigateToView("settings"); settingsNav.selectPage("profile"); }}><ProfileAvatar name={visibleOnboarding.profile.displayName} avatarUrl={visibleOnboarding.profile.avatarUrl} /></button></div></header>
      <div id="work-os-main" className="skip-target" tabIndex={-1} />
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
        week={dashboardInsightsQuery.data ?? null}
        weekLoading={dashboardInsightsQuery.isLoading}
        weekError={dashboardInsightsQuery.isError}
        nextCheckIn={visibleDay.prompt.nextPromptAt ? formatTime(visibleDay.prompt.nextPromptAt, visibleDay.shift?.timezone) : null}
        nextCheckInRequired={visibleDay.prompt.required}
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
        backlogPaging={{ loaded: backlogQuery.data?.tasks.length ?? 0, total: backlogQuery.data?.counts?.open ?? 0, hasMore: backlogQuery.hasNextPage, loading: backlogQuery.isFetchingNextPage, error: backlogQuery.isFetchNextPageError, onLoadMore: () => { void backlogQuery.fetchNextPage(); } }}
        carryOverTotals={carryOverTotals}
        currentDate={visibleDay.shiftDate}
        busy={busy || !!worktivityPending || !!worktivityControlPhase}
        attendanceControlsSupported={attendanceControlsSupported}
        canPause={canControlWorktivity}
        canClockOut={canControlWorktivity}
        observedOnly={observedOnly}
        goalSaveState={planSaveState}
        week={dashboardInsightsQuery.data ?? null}
        weekLoading={dashboardInsightsQuery.isLoading}
        weekError={dashboardInsightsQuery.isError}
        nextCheckIn={visibleDay.prompt.nextPromptAt ? formatTime(visibleDay.prompt.nextPromptAt, visibleDay.shift?.timezone) : null}
        nextCheckInRequired={visibleDay.prompt.required}
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
          {dashboardTopTasks.length ? <div className="dashboard-task-grid" ref={dashboardGridRef}>{dashboardTopTasks.map((task) => { const taskId = String(task.provider_task_id || task.id); return <DashboardTaskCard key={taskId} task={task} currentDate={visibleDay?.shiftDate ?? ""} flight={taskFlight.get(taskId) ?? null} onComplete={() => void requestTaskCompletion(task, true)} onOpen={() => void openTaskDetails(task)} onRetryPendingTask={retryPendingTask} onDismissPendingTask={dismissPendingTask} />; })}</div> : <div className="dashboard-task-empty"><strong>{yesterdayDueTasks.length ? "Nothing scheduled yet" : "Your agenda is open"}</strong><span>{yesterdayDueTasks.length ? "Review unfinished work or add today’s first priority." : "Add your first priority — the composer below plans without clocking you in."}</span></div>}
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
        focusTasks={focusDayTasks}
        taskHistory={taskHistory}
        workspaceHistory={workspaceTaskHistory}
        completedHistory={completedTaskHistory}
        unfinishedHistory={unfinishedTaskHistory}
        pageCounts={syncBypass ? null : activeTaskHistoryQuery.data?.pages[0]?.counts ?? null}
        pageTotal={syncBypass ? null : activeTaskHistoryQuery.data?.pages[0]?.totalCount ?? null}
        taskSearch={taskSearch}
        onFinderOpenChange={setTaskFinderOpen}
        finderScope={`${workSessionQuery.data?.organizationId ?? session?.organizationId ?? ""}:${workSessionQuery.data?.userId ?? ""}:${workSessionQuery.data?.personId ?? ""}`}
        finderSource={syncBypass ? async (filters, cursor) => {
          const rows = filterFinderTasks(parentTasks(uniqueTasks([...taskHistory, ...visibleTodayTasks])), filters, visibleDay?.shiftDate ?? "");
          const offset = Number(cursor ?? 0);
          return { tasks: rows.slice(offset, offset + 50), totalCount: rows.length, nextCursor: offset + 50 < rows.length ? String(offset + 50) : null };
        } : undefined}
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
      {view === "review" && <EodReviewView
        eodDate={eodDate}
        eodSubmitted={eodSubmitted}
        eodQueued={eodQueued}
        eodLanding={eodLanding}
        reviewSubmittedStatus={reviewSubmittedStatus}
        reviewDay={reviewDay}
        visibleDay={visibleDay}
        detailsReady={reviewDetailsReady}
        reportDayLoading={reportDayQuery.isLoading}
        reportDayError={Boolean(reportDayQuery.error)}
        eodGate={eodGate}
        eodPreparing={eodPreparing}
        eodDraft={eodDraft}
        eodRedrafting={eodRedrafting}
        eodClockedOut={eodClockedOut}
        screenshotGallery={screenshotGalleryQuery.data ?? null}
        eodScreenshotNotice={eodScreenshotNotice}
        reviewShiftOpen={reviewShiftOpen}
        outstandingDays={outstandingDays}
        busy={busy}
        onClearEodDate={() => setEodDate(null)}
        onRetryReportDay={() => void reportDayQuery.refetch()}
        onShowAllEods={() => { setEodDate(null); setEodLanding(true); }}
        onOpenView={setView}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onSelectOutstandingDay={(date) => { setEodLanding(false); setEodDate(date); }}
        onRetryEodGate={() => { setEodGate(null); void redraftEod(reviewDay); }}
        onDraftAnyway={draftEodAnyway}
        onLoomPreview={previewLoomLink}
        onLoomDraft={draftEodWithLoom}
        onRedraft={() => void redraftEod(reviewDay)}
        onDeleteDraft={() => setEodDeleteConfirmation(true)}
        onRefine={(markdown, feedback, annotations) => refineEod(reviewDay, markdown, feedback, annotations)}
        onSubmit={(markdown, idempotencyKey) => submitEod(reviewDay, markdown, idempotencyKey)}
        onStructuredSave={saveStructuredComposition}
        onStructuredSummary={writeStructuredSummary}
        onStructuredSubmit={submitStructuredComposition}
        onReloadStructured={reloadStructuredReport}
        onResetSubmitted={() => { setEodSubmitted(false); setEodDate(null); setEodLanding(true); }}
        onHideLanding={() => setEodLanding(false)}
        onCreateDraft={() => { setEodLanding(false); void createEodDraft(reviewDay); }}
      />}
      {view === "insights" && <PersonalInsights key={`${insightRange}:${visibleDay?.shiftDate ?? ""}`} data={activeInsights} loading={activeInsightsLoading} range={insightRange} onRange={setInsightRange} onOpenToday={() => setView("day")} onReference={(reference) => void openInsightReference(reference)} onCorrect={(quality, date) => { if (!quality.sessionId) return; setMissedClockOut({ sessionId: quality.sessionId, date, clockedInAt: quality.clockedInAt ?? null }); setMissedClockOutAt(""); setMissedClockOutReason(""); }} />}
      {view === "evidence" && <EvidenceView visibleDay={visibleDay} />}
       {view === "settings" && (
        <main className="page settings-page settings-workspace-page">
          <SettingsContent
            {...settingsPropsFor("employee")}
            active={settingsNav.active}
            visiblePages={settingsNav.visiblePages}
            query={settingsNav.query}
            onSelect={settingsNav.selectPage}
            onQuery={settingsNav.setQuery}
          />
        </main>
      )}
      {dockVisible && <ProgressComposer
        headerLeading={viewState?.role === "admin" ? chatViewSwitch : undefined}
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
    </div>
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
    {clockInConfirmation && (
      <AttendanceConfirmation
        title={clockInConfirmation.kind === "late" ? "Confirm late start" : "Confirm exception start"}
        description={clockInConfirmation.kind === "late"
          ? clockInLateProlonged
            ? "This clock-in is 30 or more minutes after the scheduled start. Add the reason now, or from the reminder on your dashboard."
            : "This clock-in is after the scheduled start. Your acknowledgement is kept in the audit record."
          : "No scheduled shift can be started right now. Add a reason, and Work OS will start an exception session for today."}
        confirmLabel="Confirm clock-in"
        busy={busy}
        reason={clockInConfirmation.kind === "exception" || clockInLateProlonged ? {
          label: clockInConfirmation.kind === "late" ? "Reason for the late start" : "Reason for the exception",
          value: clockInConfirmation.reason,
          required: clockInConfirmation.kind === "exception",
          placeholder: clockInConfirmation.kind === "late" ? "What delayed the start?" : "What happened, and what are you starting on?",
          onChange: (reason) => setClockInConfirmation((current) => current ? { ...current, reason } : current),
        } : undefined}
        onCancel={() => setClockInConfirmation(null)}
        onConfirm={confirmClockIn}
      />
    )}
    {missedClockOut && <div className="task-modal-backdrop"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="missed-clockout-title"><header><div><span>Session correction · {formatWorkOsDate(missedClockOut.date)}</span><h2 id="missed-clockout-title">Enter the exact clock-out time</h2></div><button aria-label="Close correction" onClick={() => setMissedClockOut(null)}><X size={18} /></button></header><div className="task-modal-body"><p>Work OS will not infer this timestamp. Enter the time you actually stopped working.</p>{missedClockOut.clockedInAt && <small>Clocked in {formatWorkOsDateTime(missedClockOut.clockedInAt)}</small>}<label><span>Clock-out timestamp</span><input type="datetime-local" value={missedClockOutAt} onChange={(event) => setMissedClockOutAt(event.target.value)} /></label><label><span>Correction note <em>optional</em></span><textarea value={missedClockOutReason} onChange={(event) => setMissedClockOutReason(event.target.value)} /></label></div><footer><button onClick={() => setMissedClockOut(null)}>Cancel</button><button className="primary" disabled={busy || !missedClockOutAt} onClick={correctMissedClockOut}>Save correction</button></footer></section></div>}
    {clockOutConfirmation && (
      <AttendanceConfirmation
        title={extendedClockOut || clockOutExtendedPrompt ? "Confirm extended shift" : "Confirm clock-out"}
        description={extendedClockOut || clockOutExtendedPrompt
          ? "This clock-out is more than 15 minutes after the scheduled end. Confirm that you intentionally worked the extended shift. The acknowledgement is kept in the audit record."
          : "Clock out and close today’s workspace?"}
        confirmLabel={extendedClockOut || clockOutExtendedPrompt ? "Confirm extended shift" : "Clock out"}
        busy={busy}
        tone={extendedClockOut || clockOutExtendedPrompt ? "warning" : "neutral"}
        onCancel={() => { setClockOutConfirmation(false); setClockOutExtendedPrompt(false); }}
        onConfirm={confirmClockOut}
      />
    )}
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
  const pageLabel = adminWorkspaceBranch
    ? ADMIN_SECTION_LABELS[adminSection]
    : landing === "workspace"
      ? views.find((item) => item.id === view)?.label ?? "Work OS"
      : landing === "onboarding" ? "Set up Work OS" : landing === "connect" ? "Connect" : "Work OS";
  const statusLabel = adminWorkspaceBranch
    ? "Admin mode"
    : landing === "workspace" && visibleSession ? (active ? "On shift" : "Off shift") : null;
  const menuGroups: AppMenuGroup[] = [];
  if (landing === "workspace" || landing === "admin") {
    const workspaceItems: AppMenuItem[] = [{
      id: "workspace:organization",
      label: workSessionQuery.data?.organizationName?.trim() || "Work OS workspace",
      checked: true,
      disabled: true,
    }];
    if (adminWorkspaceBranch) {
      if (adminOttoBootstrap.switchToEmployeeAvailable) workspaceItems.push({ id: "workspace:employee", label: "Switch to my workspace", onSelect: () => setWorkspaceMode("employee") });
    } else if (workSessionQuery.data?.role === "admin") {
      workspaceItems.push({ id: "workspace:admin", label: "Switch to Administration", onSelect: () => setWorkspaceMode("admin") });
    }
    menuGroups.push({ label: "Workspace", items: workspaceItems });
    const settingsShortcut = chromeUsesMacShortcuts ? "⌘," : "Ctrl ,";
    const goItems: AppMenuItem[] = adminWorkspaceBranch
      ? ADMIN_MENU_SECTIONS.map((section) => ({
        id: `go:${section.id}`,
        label: section.label,
        checked: adminSection === section.id,
        disabled: adminSection === section.id,
        ...(section.id === "settings" ? { shortcut: settingsShortcut, accelerator: "CmdOrCtrl+," } : {}),
        onSelect: () => navigateAdmin(section.id),
      }))
      : views.filter((item) => item.id !== "evidence").map((item) => ({
        id: `go:${item.id}`,
        label: item.label,
        checked: view === item.id,
        disabled: view === item.id,
        ...(item.id === "settings" ? { shortcut: settingsShortcut, accelerator: "CmdOrCtrl+," } : {}),
        onSelect: () => setView(item.id),
      }));
    menuGroups.push({ label: "Go", items: goItems });
    const viewItems: AppMenuItem[] = [{
      id: "view:sidebar",
      label: "Toggle sidebar",
      shortcut: chromeUsesMacShortcuts ? "⌘B" : "Ctrl B",
      accelerator: "CmdOrCtrl+B",
      onSelect: () => window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT)),
    }];
    // The browser preview has no floating companion window, so it must not
    // offer a command that could only fail there.
    if (isTauri()) viewItems.push(ottoVisibilityMenuItem(avatarWindowVisible, () => void toggleOtto()));
    menuGroups.push({ label: "View", items: viewItems });
    const helpItems: AppMenuItem[] = [];
    if (pageGuideView) helpItems.push({ id: "help:guide", label: "How Work OS works", onSelect: () => openGuide(pageGuideView) });
    helpItems.push({ id: "help:new", label: "What’s new", onSelect: openChangelogFromAdmin });
    if (isTauri()) helpItems.push({ id: "help:diagnostics", label: "Diagnostics", onSelect: () => void openDebugger() });
    menuGroups.push({ label: "Help", items: helpItems });
  }
  return frameWindow(<BootOverlay surface={landing}>{bootContent}</BootOverlay>, menuGroups, pageLabel, statusLabel);
}

/** Attendance acknowledgements share one decision card: the change being
 *  acknowledged, the reason (when the policy requires or accepts one), and one
 *  signal action. Task delete/archive confirmations keep their own destructive
 *  treatment. */
function AttendanceConfirmation({ title, description, confirmLabel, busy, tone = "warning", reason, onCancel, onConfirm }: {
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  tone?: "warning" | "neutral";
  reason?: {
    label: string;
    value: string;
    required: boolean;
    placeholder: string;
    onChange: (value: string) => void;
  };
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const reasonId = useId();
  const reasonHintId = useId();
  const reasonMissing = reason?.required === true && !reason.value.trim();
  return <div className="task-modal-backdrop confirmation-backdrop">
    <section className="delete-confirmation attendance-confirmation" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy || undefined}>
      <header className="attendance-confirmation-header">
        <span className={`attendance-confirmation-icon${tone === "neutral" ? " is-neutral" : ""}`} aria-hidden="true">{tone === "neutral" ? <Clock3 size={19} /> : <AlertTriangle size={19} />}</span>
        <div>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
      </header>
      {reason && <div className="attendance-reason">
        <div className="attendance-reason-label">
          <label htmlFor={reasonId}>{reason.label}</label>
          <small>{reason.required ? "Required" : "Optional"}</small>
        </div>
        <textarea
          id={reasonId}
          autoFocus
          maxLength={1000}
          value={reason.value}
          onChange={(event) => reason.onChange(event.target.value)}
          placeholder={reason.placeholder}
          aria-required={reason.required}
          aria-describedby={reasonHintId}
        />
        <small className="attendance-reason-hint" id={reasonHintId}>
          <span>Kept in today’s attendance record.</span>
          <span aria-hidden="true">{reason.value.length}/1000</span>
        </small>
      </div>}
      <div className="attendance-actions">
        <button type="button" className="attendance-action attendance-cancel" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="attendance-action primary" disabled={busy || reasonMissing} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </section>
  </div>;
}

