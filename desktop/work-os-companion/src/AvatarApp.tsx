import { hasPendingMascotApproval } from "./mascotApproval";
import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { emit, listen } from "./tauriEvents";
import { RecapPrompter } from "./RecapPrompter";
import { createRecapSpeechPlayer, type RecapSpeechPlayer, type RecapSpeechSnapshot } from "./recapSpeechPlayer";
import { DEFAULT_RECAP_VOICE, grownWindow, normalizeRecapVoice, RECAP_BUBBLE_RESTING } from "./recapSpeech";
import { prefersReducedMotion } from "./listShift";
import { apiRequestAudio } from "./api";
import { isVoiceEventFor, useVoiceInput, VOICE_HOTKEY_LABEL } from "./chat/voiceInput";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { History, SquarePen, X } from "lucide-react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { secureState } from "./vault";
import { useAttendanceWatch } from "./useAttendanceWatch";
import { APPEARANCE_EVENT, applyAppearance, normalizeAppearance } from "./appearance";
import { apiRequest, ApiRequestError } from "./api";
import { DAY_STALE_MS, ONBOARDING_STALE_MS, workOsKeys, workOsQueryClient } from "./queryClient";
import { decideActivityIntervalReview, decideRecapNextStep, dismissRecapNextSteps, ensureActivityIntervalReview, fetchDay, fetchOnboarding, fetchRecapNextSteps, fetchTaskDetails, readRecapNextStep } from "./workOsQueries";
import { resolveDashboardShift } from "./dashboardModel";
import { type FiledProposalRow, type NavigatePage, type PendingToolReview, type ProposedOperation, type ToolCallResult, attachFiledProposals, disableDecidedOperations, fileApprovedOperations, filedProposalGroups, isBatchToolOp, isPlanImportOp, isDisplayToolOp, isMutatingToolOp, mergeToolResults, normalizeInterpretation, partialFilingMessage, sameToolCall, skipBatchOperation, toolCallKey } from "./interpretation";
import { NavigateButton } from "./NavigateButton";
import { ApprovalFlow } from "./ApprovalFlow";
import { BatchApprovalCards } from "./TaskBatchCard";
import { TaskSelectionCard, type TaskSelectionCardTask } from "./TaskSelectionCard";
import { ActivityIntervalList } from "./ActivityIntervalList";
import { ActivityIntervalCard } from "./ActivityIntervalCard";
import { ChatSectionBoundary } from "./ErrorBoundary";
import { ChatTabs, ChatTimeDivider, ChatTurn, ChatWelcome, ConversationSurface, WorkOsPromptBar, collapseConsecutiveAssistantDuplicates, isThreadNearBottom, shouldShowChatDivider, threadScrollTarget, workOsChatCommands } from "./WorkOsChat";
import { MascotMark } from "./chat/MascotMark";
import { MASCOT } from "./mascot";
import { taskSelectionFromResult } from "./chat/selection";
import { AvatarThinking, type AvatarThinkingStage } from "./AvatarThinking";
import { avatarAgendaBubbleFixtureFacts, avatarAgendaBubbleFixtureRequested, avatarAttentionFixtureRequested, avatarEodBubbleFixtureFacts, avatarEodBubbleFixtureRequested, avatarEodOutstandingAfterFixtureFacts, avatarEodOutstandingAfterFixtureRequested, avatarEodOutstandingExpiredFixtureFacts, avatarEodOutstandingExpiredFixtureRequested, avatarEodOutstandingRecapFixtureFacts, avatarEodOutstandingRecapFixtureRequested, avatarFixtureChat, avatarFixtureFacts, avatarFixtureRequested, avatarMascotSizeFixture, avatarMultiSelectScrollFixtureChat, avatarMultiSelectScrollFixtureFacts, avatarMultiSelectScrollFixtureRequested, avatarNextStepsEmptyFixtureRequested, avatarNextStepsFixtureMoment, avatarNextStepsFixtureRequested, avatarNextStepsPairFixtureChat, avatarNextStepsPairFixtureRequested, avatarNextStepsRecoveryFixtureChat, avatarNextStepsRecoveryFixtureRequested, avatarObservedFixtureFacts, avatarObservedFixtureRequested, avatarRecapFixtureCard, avatarRecapFixtureChat, avatarRecapFixtureFacts, avatarRecapFixtureRequested, avatarRecapProcessingFixtureRequested, avatarShiftProgressFixtureFacts, avatarShiftProgressFixtureRequested, avatarSnoozeFixtureFacts, avatarSnoozeFixtureRequested } from "./avatarFixture";
import { isSettingsHotkey } from "./settingsHotkey";
import { AgendaReviewCard } from "./AgendaReviewCard";
import { deriveTaskContext } from "./avatarTaskContext";
import { agendaReceipt, applicableAnswers, unansweredQuestions, withAnswerRound, type AgendaAnswers } from "./avatarAgenda";
import { buildPlanItemsFromInterpretation } from "./planItems";
import { lateReasonRequired } from "./lateStart";
import type { PlanningInterpretation } from "./PlanningSession";
import { formatWorkOsDate } from "./dateFormat";
import type { WorkSession, ActivityIntervalCard as ActivityIntervalCardData, RecapNextStepItem } from "./types";
import { RecapNextStepsCard, type RecapNextStepState, type RecapNextStepsMoment } from "./RecapNextStepsCard";
import { AvatarPromptBubble } from "./AvatarPromptBubble";
import { MascotPet } from "./MascotPet";
import { type MascotAgentActivity, type MascotWorkdayState } from "./mascotState";
import { useMascotRuntime, useMascotScenarioMirror } from "./useMascotRuntime";
import {
  agendaAutoExpandKey, avatarBubble, avatarPrompt, clearRecordedUpdatePrompt, clockInAlertDue, collectNudges, composerSendTarget, composerVisible, eodAlertDue, hasOpenShiftSession, isHeaderDragStart, mergeAvatarChatEntries, nextAgendaAutoExpand, nextStepState, nextStepsSettleMs, prunePromptReminderTurns, replaceUndecidedRecapTurns, scheduledShiftEnd, serializeAvatarChatEntry, shiftElapsedFraction, snoozeUntil, stripPromptReminderTurns,
  type AvatarStoredTurn, type CompanionDayFacts, type CompanionNudge,
} from "./avatarLogic";
import "./avatar.css";

type SessionInfo = { apiBase: string; token: string; organizationId: string; expiresAt: string };
type DaySyncState = "loading" | "ready" | "stale" | "error";

/** One filing transport for approvals and retries: the accept request plus the
 * owner-scoped readback used to reconcile an interrupted response. */
function proposalFilingTransport() {
  return {
    reviewProposal: (proposalId: string, options?: { providerCreateResolution?: "no_task_created" }) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "accept", ...(options?.providerCreateResolution ? { provider_create_resolution: options.providerCreateResolution } : {}) }), signal: AbortSignal.timeout(60_000) }),
    readProposal: (proposalId: string) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`),
    reviewBatch: (batchId: string, body: { decision: "accept" | "reject"; decisions: Array<{ proposal_id: string; decision?: "accept" | "reject"; edits?: Record<string, unknown>; clear_fields?: string[] }> }) => apiRequest(`/api/work-os/proposal-batches/${encodeURIComponent(batchId)}`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) }),
  };
}

interface DayFacts extends CompanionDayFacts {
  loaded: boolean;
  /** The organization allows voice input and this deployment can transcribe. */
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

interface AvatarTrace {
  labels: string[];
  elapsedMs: number;
  result?: string;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  operations?: ProposedOperation[];
  toolResults?: ToolCallResult[];
  taskOptions?: Array<{ id: string; title: string }>;
  receipt?: string | null;
  trace?: AvatarTrace | null;
  createdAt?: string;
  /** The live recap card for this prompt turn (local-only; the Tasks tab
   * carries the durable stream). */
  activityInterval?: ActivityIntervalCardData;
  /** The post-approval next-steps moment (local-only; a reload keeps only its
   * lead text). */
  nextSteps?: RecapNextStepsMoment;
  /** UI-only reminder scaffolding: never persisted or sent as conversation. */
  kind?: "prompt";
}

interface AgendaReview {
  input: string;
  interpretation: PlanningInterpretation;
  answers: AgendaAnswers;
  round: number;
}

const AVATAR_COLLAPSED = { width: 200, height: 276 };
const AVATAR_EXPANDED = { width: 400, height: 620 };
const DAY_POLL_MS = 60_000;
const POSITION_KEY = "work-os.avatar.position.v1";
const NOTIFIED_KEY = "work-os.avatar.notified.v1";
const SNOOZE_KEY = "work-os.avatar.snooze.v1";
/** Device-local memory for the Tasks tab's Open tasks card (§7.3). */
const AVATAR_TASKS_COLLAPSE_KEY = "work-os.avatar.tasks-collapsed.v1";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* best effort */ }
}

async function requestNotificationPermissionOnce(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function fireNotification(nudge: CompanionNudge, permission: boolean): void {
  if (!permission) return;
  try {
    if (navigator.userAgent.includes("Windows")) {
      // Windows toasts support click-to-focus through the local notify_focus
      // command; check-ins open the companion and EOD opens the review workspace.
      void invoke("notify_focus", {
        title: nudge.title,
        body: nudge.body,
        target: nudge.kind === "hourly" ? "avatar" : nudge.kind === "eod" ? "eod" : "main",
      }).catch(() => { sendNotification({ title: nudge.title, body: nudge.body }); });
      return;
    }
    sendNotification({ title: nudge.title, body: nudge.body });
  } catch { /* best effort */ }
}

export default function AvatarApp(): React.ReactElement {
  // Browser dev fixture (?window=avatar&token=…): there is no native window to
  // position, so window-management calls stay no-ops instead of crashing.
  const win = useMemo(() => {
    try { return isTauri() ? getCurrentWindow() : null; }
    catch { return null; }
  }, []);
  // DEV-only visual fixture (see avatarFixture.ts): renders the recorded
  // completion without a session token so TestSprite or a plain browser can
  // check the avatar's recorded-result rendering. Inert in production.
  const avatarAttentionFixture = avatarAttentionFixtureRequested(window.location.search);
  const avatarMultiSelectScrollFixture = avatarMultiSelectScrollFixtureRequested(window.location.search);
  const avatarShiftProgressFixture = avatarShiftProgressFixtureRequested(window.location.search);
  const avatarObservedFixture = avatarObservedFixtureRequested(window.location.search);
  const avatarSnoozeFixture = avatarSnoozeFixtureRequested(window.location.search);
  const avatarEodBubbleFixture = avatarEodBubbleFixtureRequested(window.location.search);
  const avatarEodOutstandingRecapFixture = avatarEodOutstandingRecapFixtureRequested(window.location.search);
  const avatarEodOutstandingAfterFixture = avatarEodOutstandingAfterFixtureRequested(window.location.search);
  const avatarEodOutstandingExpiredFixture = avatarEodOutstandingExpiredFixtureRequested(window.location.search);
  const avatarAgendaBubbleFixture = avatarAgendaBubbleFixtureRequested(window.location.search);
  const avatarRecapFixture = avatarRecapFixtureRequested(window.location.search);
  const avatarNextStepsFixture = avatarNextStepsFixtureRequested(window.location.search);
  const avatarNextStepsRecoveryFixture = avatarNextStepsRecoveryFixtureRequested(window.location.search);
  const avatarNextStepsEmptyFixture = avatarNextStepsEmptyFixtureRequested(window.location.search);
  const avatarNextStepsPairFixture = avatarNextStepsPairFixtureRequested(window.location.search);
  const avatarNextStepsRecoveryLike = avatarNextStepsRecoveryFixture || avatarNextStepsEmptyFixture || avatarNextStepsPairFixture;
  const avatarRecapProcessingFixture = avatarRecapProcessingFixtureRequested(window.location.search);
  const avatarMascotFixture = avatarMascotSizeFixture(window.location.search);
  const avatarFixture = avatarFixtureRequested(window.location.search);
  const [expanded, setExpanded] = useState(avatarFixture && !avatarShiftProgressFixture && !avatarObservedFixture && !avatarAttentionFixture && !avatarSnoozeFixture && !avatarRecapFixture && !avatarRecapProcessingFixture && !avatarNextStepsFixture && !avatarNextStepsRecoveryLike && !avatarEodBubbleFixture && !avatarAgendaBubbleFixture && !avatarEodOutstandingRecapFixture && !avatarEodOutstandingAfterFixture && !avatarEodOutstandingExpiredFixture);
  const [connected, setConnected] = useState<boolean | null>(avatarFixture ? true : null);
  // Reading a recap aloud: the words come from the route, the clock from the
  // audio's own progress, and one player owns this window's only audio element.
  const [recapSpeech, setRecapSpeech] = useState<RecapSpeechSnapshot>({ status: "idle", lines: [], progress: 0, activeIndex: 0, revision: null, intervalId: null });
  const [recapVoice, setRecapVoice] = useState<string>(DEFAULT_RECAP_VOICE);
  const recapVoiceRef = useRef<string>(recapVoice);
  recapVoiceRef.current = recapVoice;
  const loadDayRef = useRef<((force?: boolean) => Promise<void>) | null>(null);
  const reducedMotion = prefersReducedMotion();
  const [facts, setFacts] = useState<DayFacts>(() => avatarShiftProgressFixture
    ? avatarShiftProgressFixtureFacts()
    : avatarObservedFixture ? avatarObservedFixtureFacts()
    : avatarMultiSelectScrollFixture ? avatarMultiSelectScrollFixtureFacts()
    : avatarSnoozeFixture ? avatarSnoozeFixtureFacts()
    : avatarEodBubbleFixture ? avatarEodBubbleFixtureFacts()
    : avatarEodOutstandingRecapFixture ? avatarEodOutstandingRecapFixtureFacts()
    : avatarEodOutstandingAfterFixture ? avatarEodOutstandingAfterFixtureFacts()
    : avatarEodOutstandingExpiredFixture ? avatarEodOutstandingExpiredFixtureFacts()
    : avatarAgendaBubbleFixture ? avatarAgendaBubbleFixtureFacts()
    : (avatarRecapFixture || avatarRecapProcessingFixture || avatarNextStepsFixture || avatarNextStepsRecoveryLike) ? avatarRecapFixtureFacts()
    : avatarFixture ? avatarFixtureFacts() : {
    loaded: false, voiceAvailable: false, shiftDate: "", promptRequired: false, nextPromptAt: null, promptKind: null,
    shiftStartsAt: null, shiftEndsAt: null, sessionState: null, attendanceState: null, clockedInAt: null,
    clockedOutAt: null, pausedSeconds: 0, lastSubstantiveUpdateAt: null, employeeUpdates: 0, completedTasks: 0, openTasks: 0, eodSubmitted: false, personId: null, planIntent: null,
    timezone: null, displayName: null, niftySyncing: false, niftySyncError: null, taskOptions: [], planStatus: null, planRevision: null, planItems: [], lateReasonRequired: false,
  });
  const [daySyncState, setDaySyncState] = useState<DaySyncState>(avatarFixture ? "ready" : "loading");
  const [desktopSession, setDesktopSession] = useState<SessionInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chat, setChat] = useState<ChatEntry[]>(() => avatarNextStepsPairFixture
    ? avatarNextStepsPairFixtureChat()
    : avatarNextStepsEmptyFixture
      ? avatarNextStepsRecoveryFixtureChat("fixture-empty")
      : avatarNextStepsRecoveryFixture
        ? avatarNextStepsRecoveryFixtureChat()
        : avatarMultiSelectScrollFixture ? avatarMultiSelectScrollFixtureChat()
        : (avatarRecapFixture || avatarRecapProcessingFixture || avatarNextStepsFixture || avatarEodOutstandingRecapFixture) ? avatarRecapFixtureChat() : avatarFixture ? avatarFixtureChat() : []);
  const [loadedChatConversation, setLoadedChatConversation] = useState<string | null>(null);
  const chatConversationSignature = useRef("");
  const readyReceiptRef = useRef<string | null>(null);
  const [input, setInput] = useState("");
  const [avatarTab, setAvatarTab] = useState<"chat" | "tasks">("chat");
  const [activityPrompt, setActivityPrompt] = useState<ActivityIntervalCardData | null>((avatarRecapFixture || avatarNextStepsFixture || avatarEodOutstandingRecapFixture) ? avatarRecapFixtureCard() : null);
  const [activityPreparing, setActivityPreparing] = useState(avatarRecapProcessingFixture);
  const [recapEditMode, setRecapEditMode] = useState(false);
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const [scrollToLatest, setScrollToLatest] = useState(0);
  /* Voice input (design §8.8): the transcript lands in the draft for review;
     nothing is ever sent by the recorder itself. */
  // One player owns this window's audio: the tray hide, the recorder, and every
  // Listen control route through it, so two reads can never overlap and a
  // recording never starts on top of one.
  const [recapPlayer] = useState<RecapSpeechPlayer>(() => createRecapSpeechPlayer({
    fetchClip: (input) => apiRequestAudio("/api/work-os/voice/recap", input),
    toObjectUrl: (bytes, mimeType) => URL.createObjectURL(new Blob([bytes], { type: mimeType })),
    releaseObjectUrl: (url) => URL.revokeObjectURL(url),
    createAudio: (src) => new Audio(src),
    onSnapshot: (snapshot) => setRecapSpeech(snapshot),
    onFailure: (message) => setChat((current) => [...current, { id: `recap-speech-error-${Date.now()}`, role: "system", text: message }]),
    onStaleCard: () => { void loadDayRef.current?.(true); },
  }));
  const toggleRecapRead = useCallback((intervalId: string, revision: number | null): void => {
    void recapPlayer.toggle({ intervalId, revision, voice: recapVoiceRef.current, enabled: facts.voiceAvailable });
  }, [recapPlayer, facts.voiceAvailable]);
  const stopRecapRead = useCallback((): void => recapPlayer.stop(), [recapPlayer]);

  const voice = useVoiceInput({
    enabled: facts.voiceAvailable,
    surface: "floating",    onTranscript: (text) => {
      setInput((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text));
      setAvatarTab("chat");
      setRecapEditMode(false);
      void toggleExpanded(true);
    },
    onRecordingStart: () => {
      setAvatarTab("chat");
      void toggleExpanded(true);
    },
  });
  /* The hold-to-talk listener is registered once; this ref keeps it on the
     newest recorder without re-subscribing on every render. */
  const voiceRef = useRef(voice);
  useEffect(() => { voiceRef.current = voice; }, [voice]);
  // DEV fixture: render either mascot size without the vault.
  useEffect(() => {
    if (avatarMascotFixture) document.documentElement.dataset.mascotSize = avatarMascotFixture;
  }, [avatarMascotFixture]);
  const [decidingIntervalId, setDecidingIntervalId] = useState<string | null>(null);
  const [nextStepsBusyId, setNextStepsBusyId] = useState<string | null>(null);
  const [thinkingTrace, setThinkingTrace] = useState<{ stages: AvatarThinkingStage[]; active: number; startedAt: number } | null>(null);
  const thinking = thinkingTrace !== null;
  const [agendaReview, setAgendaReview] = useState<AgendaReview | null>(null);
  const [filing, setFiling] = useState(false);
  const debugScenario = useMascotScenarioMirror();
  const [mascotReceipt, setMascotReceipt] = useState<object | null>(null);
  const [proposedTaskIds, setProposedTaskIds] = useState<Set<string>>(() => new Set());
  const [snoozeCount, setSnoozeCount] = useState<number>(() => {
    if (avatarSnoozeFixture) return 0;
    const s = readJson<{ count?: number; until?: number | null }>(SNOOZE_KEY, {});
    return typeof s.count === "number" ? s.count : 0;
  });
  const [snoozeReplayId, setSnoozeReplayId] = useState(0);
  const [missed, setMissed] = useState(false);
  const notifiedKeys = useRef<Set<string>>(new Set(readJson<string[]>(NOTIFIED_KEY, [])));
  const deliveryKeys = useRef<Set<string>>(new Set());
  const notificationPermission = useRef(false);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const threadMetricsRef = useRef<{ scrollHeight: number } | null>(null);
  const previousAvatarTabRef = useRef<"chat" | "tasks">("chat");
  const [sweepSignal, setSweepSignal] = useState(0);
  const bumpSweep = () => setSweepSignal((value) => value + 1);
  const dayRef = useRef<DayFacts>(facts);
  const dayLoadInFlight = useRef(false);
  const daySessionRevision = useRef(0);
  const dayReloadRequested = useRef(false);
  const chatRef = useRef<ChatEntry[]>([]);
  const avatarToolsSig = useRef("");
  // The agenda auto-expand key last acted on, so a deliberate collapse is never
  // fought by a re-render. Reset when the agenda stops being due.
  const autoExpandedAgenda = useRef<string | null>(null);
  // The settle timer that returns the panel to the orb after the next-steps
  // moment is fully decided; cleared by any deliberate interaction.
  const recapAutoCollapse = useRef<number | null>(null);
  // Interval ids whose next-step suggestions are still undecided, so ending
  // the moment can dismiss them instead of leaving them in any queue.
  const nextStepsPending = useRef<string[]>([]);
  const nextStepsSettled = useRef<Set<string>>(new Set());
  /** A restored conversation re-attaches lost moments at most once per load. */
  const nextStepsRecovered = useRef(false);
  /** A recap confirmation defers its celebration until the panel closes, so
   * the success animation is actually seen instead of playing behind the card. */
  const pendingRecapCelebration = useRef(false);
  const expandedRef = useRef(expanded);
  const activityPromptRef = useRef(activityPrompt);

  useEffect(() => { dayRef.current = facts; }, [facts]);
  useEffect(() => { chatRef.current = chat; }, [chat]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { activityPromptRef.current = activityPrompt; }, [activityPrompt]);

  // ── Toast activation (Windows): expand the composer when clicked ──
  useEffect(() => {
    const unlisten = listen("avatar://expand", () => {
      setMissed(false);
      void toggleExpanded(true);
    });
    return () => { unlisten.then((fn) => fn()).catch(() => { /* noop */ }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Boot: session + saved position + notifications ──
  useEffect(() => {
    (async () => {
      if (avatarFixture) { setConnected(true); notificationPermission.current = false; return; }
      const session = (await secureState.session().catch(() => null)) as SessionInfo | null;
      setDesktopSession(session);
      setConnected(!!session && new Date(session.expiresAt).getTime() > Date.now());
      notificationPermission.current = await requestNotificationPermissionOnce();
      void secureState.settings().then((settings) => setRecapVoice(normalizeRecapVoice(settings.recapVoice))).catch(() => undefined);
      try {
        const saved = readJson<{ x?: number; y?: number }>(POSITION_KEY, {});
        const monitor = win ? await currentMonitor() : null;
        if (win && monitor && typeof saved.x === "number" && typeof saved.y === "number") {
          const x = Math.max(0, Math.min(monitor.size.width - AVATAR_COLLAPSED.width, saved.x));
          const y = Math.max(0, Math.min(monitor.size.height - AVATAR_COLLAPSED.height, saved.y));
          await win.setPosition(new LogicalPosition(x, y));
        }
      } catch { /* default position from config is fine */ }
    })();
  }, [win]);

  // ── Day poll: the single source of shift/prompt facts ──
  const loadDay = useCallback(async (force = false) => {
    if (dayLoadInFlight.current) {
      if (force) dayReloadRequested.current = true;
      return;
    }
    dayLoadInFlight.current = true;
    const sessionRevision = daySessionRevision.current;
    try {
      if (force) await workOsQueryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") });
      // Shared query cache: a fresh cached day is served without a network
      // round-trip; stale data refreshes in the background.
      let day = await workOsQueryClient.fetchQuery({
        queryKey: workOsKeys.day("compact"),
        queryFn: () => fetchDay({ variant: "compact" }),
        staleTime: DAY_STALE_MS,
      }) as unknown as Record<string, any>;
      let session = (day?.session ?? {}) as Record<string, any>;
      // The collapsed companion must show the real scheduled remainder. Some
      // compact payloads can omit or stale the schedule boundary, so recover
      // it from the cached details view only when the active shift needs it.
      const compactStart = Date.parse(String(day?.shift?.startsAt ?? session.scheduled_starts_at ?? ""));
      const compactEnd = Date.parse(String(day?.shift?.endsAt ?? session.scheduled_ends_at ?? ""));
      if (session.clocked_in_at && (!Number.isFinite(compactEnd) || (Number.isFinite(compactStart) && compactEnd <= compactStart))) {
        try {
          const detailed = await workOsQueryClient.fetchQuery({
            queryKey: workOsKeys.day("details"),
            queryFn: () => fetchDay({ variant: "details" }),
            staleTime: force ? 0 : DAY_STALE_MS,
          }) as unknown as Record<string, any>;
          const detailedSession = (detailed?.session ?? {}) as Record<string, any>;
          const detailedStartValue = detailed?.shift?.startsAt ?? detailedSession.scheduled_starts_at ?? null;
          const detailedEndValue = detailed?.shift?.endsAt ?? detailedSession.scheduled_ends_at ?? null;
          const detailedStart = Date.parse(String(detailedStartValue ?? ""));
          const detailedEnd = Date.parse(String(detailedEndValue ?? ""));
          const recoveredStartValue = Number.isFinite(detailedStart)
            ? detailedStartValue
            : day?.shift?.startsAt ?? session.scheduled_starts_at ?? null;
          const recoveredStart = Date.parse(String(recoveredStartValue ?? ""));
          if (Number.isFinite(recoveredStart) && Number.isFinite(detailedEnd) && detailedEnd > recoveredStart) {
            const recoveredSession = {
              ...detailedSession,
              scheduled_starts_at: recoveredStartValue,
              scheduled_ends_at: detailedEndValue,
            };
            day = {
              ...detailed,
              shift: detailed?.shift
                ? { ...detailed.shift, startsAt: recoveredStartValue, endsAt: detailedEndValue }
                : day?.shift
                  ? { ...day.shift, startsAt: recoveredStartValue, endsAt: detailedEndValue }
                  : null,
              session: recoveredSession,
            };
            session = recoveredSession;
          }
        } catch {
          // Keep the compact day usable. The timer renders "Time unavailable"
          // rather than inventing 0m when the richer schedule cannot refresh.
        }
      }
      const hasValidShiftWindow = (shift: { startsAt?: unknown; endsAt?: unknown } | null | undefined) => {
        const start = Date.parse(String(shift?.startsAt ?? ""));
        const end = Date.parse(String(shift?.endsAt ?? ""));
        return Number.isFinite(start) && Number.isFinite(end) && end > start;
      };
      if (!hasValidShiftWindow(day?.shift)) {
        const sessionShift = resolveDashboardShift({
          shift: null,
          session: session as unknown as WorkSession,
          schedule: null,
          currentDate: String(day?.shiftDate ?? ""),
          timezone: day?.shift?.timezone,
          now: new Date(),
        });
        if (hasValidShiftWindow(sessionShift)) day = { ...day, shift: sessionShift };
      }
      if (!hasValidShiftWindow(day?.shift)) {
        try {
          const onboarding = await workOsQueryClient.fetchQuery({
            queryKey: workOsKeys.onboarding(),
            queryFn: fetchOnboarding,
            staleTime: force ? 0 : ONBOARDING_STALE_MS,
          });
          const schedule = onboarding.organizationSetup.officialSchedule
            ?? (onboarding.employeeRequirements.scheduleProvided ? onboarding.profile.schedule : null);
          const shift = resolveDashboardShift({
            shift: null,
            session: session as unknown as WorkSession,
            schedule,
            currentDate: String(day?.shiftDate ?? ""),
            timezone: day?.shift?.timezone ?? onboarding.profile.timezone,
            now: new Date(),
          });
          if (hasValidShiftWindow(shift)) day = { ...day, shift };
        } catch (value) {
          if (value instanceof ApiRequestError && value.status === 401) throw value;
          // Keep the elapsed session clock even when schedule data is unavailable.
        }
      }
      if (!hasValidShiftWindow(day?.shift)) day = { ...day, shift: null };
      if (sessionRevision !== daySessionRevision.current) return;
      const prompt = (day?.prompt ?? {}) as Record<string, any>;
      setFacts({
        loaded: true,
        shiftDate: String(day?.shiftDate ?? ""),
        promptRequired: prompt.kind === "follow_up" || prompt.kind === "hourly_fallback",
        nextPromptAt: typeof prompt.nextPromptAt === "string" ? prompt.nextPromptAt : null,
        promptKind: ["plan", "follow_up", "hourly_fallback", "eod"].includes(prompt.kind) ? prompt.kind : null,
        shiftStartsAt: day?.shift?.startsAt ?? session.scheduled_starts_at ?? null,
        shiftEndsAt: scheduledShiftEnd({ sessionEnd: session.scheduled_ends_at, dayShiftEnd: day?.dayShift?.endsAt, upcomingEnd: day?.shift?.endsAt }),
        sessionState: session.state ?? null,
        attendanceState: day?.attendance?.state ?? null,
        clockedInAt: session.clocked_in_at ?? null,
        clockedOutAt: session.clocked_out_at ?? null,
        pausedSeconds: Number(session.paused_seconds ?? 0) || 0,
        pausedAt: typeof session.paused_at === "string" ? session.paused_at : null,
        lastSubstantiveUpdateAt: typeof session.last_substantive_update_at === "string" ? session.last_substantive_update_at : null,
        employeeUpdates: Number(day?.signals?.employeeUpdates ?? 0) || 0,
        completedTasks: Number(day?.signals?.completedTasks ?? 0) || 0,
        openTasks: Number(day?.signals?.openTasks ?? 0) || 0,
        eodSubmitted: typeof day?.report?.submitted_at === "string",
        voiceAvailable: day?.access?.featureFlags?.voice_input === true && day?.access?.capabilities?.voice_input === true,
        personId: day?.access?.personId ?? null,
        planIntent: day?.plan?.focus_summary ?? day?.plan?.freeform_intent ?? null,
        timezone: day?.shift?.timezone ?? null,
        displayName: day?.access?.displayName ?? null,
        niftySyncing: day?.niftySync?.syncing === true,
        niftySyncError: typeof day?.niftySync?.error === "string" ? day.niftySync.error : null,
        taskOptions: Array.isArray(day?.tasks) ? day.tasks
          .filter((task: unknown): task is Record<string, unknown> => !!task && typeof task === "object" && typeof (task as Record<string, unknown>).id === "string")
          .map((task: Record<string, unknown>) => ({
            id: String(task.id),
            title: typeof task.title === "string" ? task.title : "Untitled task",
            dueDate: typeof task.due_date === "string" ? task.due_date : null,
            completed: task.completed === true,
            subtaskTotal: Number((task.subtaskProgress as { total?: number } | undefined)?.total ?? 0) || 0,
            subtaskCompleted: Number((task.subtaskProgress as { completed?: number } | undefined)?.completed ?? 0) || 0,
            subtasks: Array.isArray(task.subtasks) ? (task.subtasks as Array<Record<string, unknown>>).map((child) => ({
              id: String(child.id),
              title: typeof child.title === "string" ? child.title : "Untitled subtask",
              completed: child.completed === true,
            })) : undefined,
          }))
          .slice(0, 200) : [],
        planStatus: typeof day?.plan?.status === "string" ? day.plan.status : null,
        planRevision: typeof day?.plan?.revision === "number" ? day.plan.revision : null,
        planItems: Array.isArray(day?.plan?.items) ? day.plan.items
          .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")
          .map((item: Record<string, unknown>) => ({
            id: String(item.id),
            task_id: typeof item.task_id === "string" ? item.task_id : null,
            title_snapshot: typeof item.title_snapshot === "string" ? item.title_snapshot : "",
            disposition: item.disposition === "deferred" ? "deferred" : "selected",
            item_kind: item.item_kind === "outcome" ? "outcome" : "nifty_task",
            completion_state: item.completion_state === "completed" ? "completed" : "open",
          })) : [],
        lateReasonRequired: lateReasonRequired(day?.session),
      });
      setConnected(true);
      setDaySyncState("ready");
    } catch (value) {
      if (sessionRevision !== daySessionRevision.current) return;
      if (value instanceof ApiRequestError && value.status === 401) setConnected(false);
      // Retain usable facts but make the stale/failure boundary explicit.
      setDaySyncState(dayRef.current.loaded ? "stale" : "error");
    } finally {
      dayLoadInFlight.current = false;
      if (dayReloadRequested.current) {
        dayReloadRequested.current = false;
        void loadDay(true);
      }
    }
  }, []);

  // Keep the player's stale-card refresh pointed at the live loader.
  loadDayRef.current = loadDay;

  // Grow the bubble while Otto reads, and put it back exactly as it was. Only
  // the collapsed companion is managed here — expanding it is the panel's own
  // effect, and the read keeps going through the expand.
  useEffect(() => {
    if (!win || expanded) return;
    const reading = recapSpeech.status !== "idle";
    let cancelled = false;
    void (async () => {
      try {
        const [monitor, scaleFactor, outer] = await Promise.all([currentMonitor(), win.scaleFactor(), win.outerPosition()]);
        if (cancelled) return;
        const logical = outer.toLogical(scaleFactor);
        const bounds = monitor
          ? { width: monitor.size.width, height: monitor.size.height }
          : { width: logical.x + RECAP_BUBBLE_RESTING.width, height: logical.y + RECAP_BUBBLE_RESTING.height };
        const target = reading
          ? grownWindow(RECAP_BUBBLE_RESTING, { lineHeight: 19, prompterLines: 3, chrome: 96 }, bounds, { x: logical.x, y: logical.y })
          : { size: RECAP_BUBBLE_RESTING, position: { x: logical.x, y: logical.y } };
        await win.setSize(new LogicalSize(target.size.width, target.size.height)).catch(() => undefined);
        await win.setPosition(new LogicalPosition(target.position.x, target.position.y)).catch(() => undefined);
      } catch { /* the companion keeps its size when the monitor cannot be read */ }
    })();
    return () => { cancelled = true; };
  }, [win, expanded, recapSpeech.status]);

  // A hidden companion does not read to an empty room.
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") stopRecapRead(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [stopRecapRead]);

  // One audio owner: recording and reading never overlap.
  useEffect(() => {
    if (voice.state !== "idle") stopRecapRead();
  }, [voice.state, stopRecapRead]);

  useEffect(() => {
    if (avatarFixture) return;
    void loadDay(true);
    const poll = setInterval(() => { void loadDay(); }, DAY_POLL_MS);
    return () => clearInterval(poll);
  }, [avatarFixture, loadDay]);

  // Worktivity can clock the employee in or out from activity alone. Watch on
  // the shared adaptive cadence, reload only when something actually moved,
  // and tell the main window so every surface converges together.
  const onAttendanceChange = useCallback(() => {
    void loadDay(true);
    void emit("work-os://avatar-day-changed");
  }, [loadDay]);
  useAttendanceWatch({
    enabled: connected === true,
    input: { sessionState: facts.sessionState, shiftStartsAt: facts.shiftStartsAt, shiftEndsAt: facts.shiftEndsAt },
    onChange: onAttendanceChange,
  });

  // The main and companion windows own separate React trees. Refresh promptly
  // after a main-window write or sign-in instead of waiting for the minute poll.
  useEffect(() => {
    let unlistenDay: (() => void) | undefined;
    let unlistenSession: (() => void) | undefined;
    void listen("work-os://main-day-changed", () => { void loadDay(true); }).then((fn) => { unlistenDay = fn; }).catch(() => undefined);
    void listen("work-os://main-session-changed", () => {
      daySessionRevision.current += 1;
      void secureState.session().then((session) => {
        setDesktopSession(session);
        setConnected(!!session && new Date(session.expiresAt).getTime() > Date.now());
      }).catch(() => {
        setDesktopSession(null);
        setConnected(false);
      }).finally(() => { void loadDay(true); });
    }).then((fn) => { unlistenSession = fn; }).catch(() => undefined);
    return () => { unlistenDay?.(); unlistenSession?.(); };
  }, [loadDay]);

  // Appearance is per-device and shared with the main window: apply what the
  // vault holds on boot, then follow the main window's broadcast live. This
  // window never writes, so both windows always agree on one stored value.
  // A DEV fixture owns the rendered size instead.
  useEffect(() => {
    if (avatarMascotFixture) return;
    let unlisten: (() => void) | undefined;
    void secureState.settings().then((settings) => applyAppearance(normalizeAppearance(settings))).catch(() => undefined);
    void listen<{ textSize?: unknown; mascotSize?: unknown }>(APPEARANCE_EVENT, (event) => applyAppearance(normalizeAppearance(event.payload))).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [avatarMascotFixture]);

  /* Hold-to-talk reaches whichever companion window is in use, and the event
     says which one: the listener names this window so Tauri's filter applies,
     and the address is checked before acting, so a broadcast cannot start a
     capture here that was meant for the in-app dock. */
  useEffect(() => {
    // Browser dev has no Tauri internals; the voice bridge is inert there.
    const label = isTauri() ? getCurrentWindow().label : "web";
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

  const avatarConversationScope = desktopSession?.organizationId && facts.personId && facts.shiftDate
    ? `workday:${desktopSession.organizationId}:${facts.personId}:${facts.shiftDate}`
    : null;
  useEffect(() => {
    if (avatarFixture) return;
    let cancelled = false;
    chatConversationSignature.current = "";
    nextStepsRecovered.current = false;
    setLoadedChatConversation(null);
    setChat([]);
    if (!avatarConversationScope) return () => { cancelled = true; };
    void secureState.conversation(avatarConversationScope).then((turns) => {
      if (!cancelled) {
        chatConversationSignature.current = JSON.stringify(turns);
        const restored = mergeAvatarChatEntries([], turns as AvatarStoredTurn[]);
        readyReceiptRef.current = [...restored].reverse().find((entry) => !!entry.receipt)?.id ?? null;
        setChat(restored);
        setLoadedChatConversation(avatarConversationScope);
      }
    }).catch(() => {
      if (!cancelled) setLoadedChatConversation(avatarConversationScope);
    });
    return () => { cancelled = true; };
  }, [avatarConversationScope, avatarFixture]);
  useEffect(() => {
    if (!avatarConversationScope || loadedChatConversation !== avatarConversationScope) return;
    const turns = chat
      .map(serializeAvatarChatEntry)
      .filter((turn): turn is AvatarStoredTurn => turn !== null);
    const signature = JSON.stringify(turns);
    if (chatConversationSignature.current === signature) return;
    chatConversationSignature.current = signature;
    void secureState.saveConversation(avatarConversationScope, turns).then(() => emit("work-os://conversation-changed", { scope: avatarConversationScope })).catch(() => undefined);
  }, [avatarConversationScope, chat, loadedChatConversation]);
  const shareAvatarTools = useCallback(async (review: Omit<PendingToolReview, "origin" | "updatedAt">) => {
    if (!avatarConversationScope) return;
    const record: PendingToolReview = { ...review, updatedAt: new Date().toISOString(), origin: "avatar" };
    const signature = JSON.stringify(record);
    if (avatarToolsSig.current === signature) return;
    avatarToolsSig.current = signature;
    await secureState.savePendingTools(avatarConversationScope, record).catch(() => undefined);
    emit("work-os://pending-tools-changed", { scope: avatarConversationScope }).catch(() => undefined);
  }, [avatarConversationScope]);
  // One review identity, both windows: the pending-tools record is the source
  // of truth for an open review, so this window re-adopts a review it raised
  // itself (reloads, restarts) and never loses one to a cross-window save.
  // Filed results always merge into the matching cards by stable key.
  const adoptSharedTools = useCallback(async () => {
    if (!avatarConversationScope) return;
    const shared = await secureState.pendingTools(avatarConversationScope).catch(() => null);
    if (!shared) return;
    const signature = JSON.stringify(shared);
    if (avatarToolsSig.current === signature) return;
    avatarToolsSig.current = signature;
    setChat((current) => {
      const hasThisReview = current.some((entry) => entry.id === shared.reviewId);
      if (!hasThisReview && (shared.operations.length || shared.results.length)) {
        void toggleExpanded(true);
        return [...current, {
          id: shared.reviewId, role: "assistant" as const,
          text: shared.reply ?? "Tool calls shared from the main window.",
          operations: shared.operations, taskOptions: shared.taskOptions ?? [],
          toolResults: shared.results.length ? shared.results : undefined,
          createdAt: new Date().toISOString(),
        }];
      }
      return current.map((entry) => {
        if (entry.id === shared.reviewId) {
          const relevant = shared.results.filter((result) => shared.operations.some((op) => toolCallKey(op) === toolCallKey(result.op)));
          const patch: Partial<ChatEntry> = {};
          if (!entry.operations?.length && shared.operations.length) patch.operations = shared.operations;
          if (relevant.length) patch.toolResults = mergeToolResults(entry.toolResults ?? [], relevant);
          return Object.keys(patch).length ? { ...entry, ...patch } : entry;
        }
        if (!entry.operations?.length) return entry;
        const relevant = shared.results.filter((result) => entry.operations!.some((op) => toolCallKey(op) === toolCallKey(result.op)));
        // mergeToolResults replaces a matching key, so a retry that changes a
        // result's status or message updates the existing card.
        return relevant.length ? { ...entry, toolResults: mergeToolResults(entry.toolResults ?? [], relevant) } : entry;
      });
    });
  }, [avatarConversationScope]); // eslint-disable-line react-hooks/exhaustive-deps -- toggleExpanded is stable for the window lifetime
  useEffect(() => {
    if (!avatarConversationScope) return;
    void adoptSharedTools();
  }, [avatarConversationScope, adoptSharedTools]);
  useEffect(() => {
    if (!avatarConversationScope) return;
    let unlisten: (() => void) | undefined;
    void listen<{ scope?: string }>("work-os://pending-tools-changed", (event) => {
      if (event.payload?.scope !== avatarConversationScope) return;
      void adoptSharedTools();
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [avatarConversationScope, adoptSharedTools]);
  useEffect(() => {
    if (!avatarConversationScope) return;
    let unlisten: (() => void) | undefined;
    void listen<{ scope?: string }>("work-os://conversation-changed", (event) => {
      if (event.payload?.scope !== avatarConversationScope) return;
      void secureState.conversation(avatarConversationScope).then((turns) => {
        chatConversationSignature.current = JSON.stringify(turns);
        setChat((current) => mergeAvatarChatEntries(current, turns as AvatarStoredTurn[]));
      }).catch(() => undefined);
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [avatarConversationScope]);

  // ── Tick ──
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  // Time-derived alert boundaries. The effect below only re-runs when a
  // dependency changes, and the five-second clock tick alone does not do that,
  // so the EOD and clock-in windows must enter its deps as booleans: the nudge
  // then fires when the window opens, not when a server field happens to move.
  const eodAlertNow = eodAlertDue(facts, now);
  const clockInAlertNow = clockInAlertDue(facts, now);

  // ── Notification scheduler: hourly + clock-in + EOD, deduped per key ──
  useEffect(() => {
    if (!facts.loaded || connected === false) return;
    const nudges = collectNudges(facts, Date.now(), notifiedKeys.current);
    for (const nudge of nudges) {
      if (nudge.kind === "hourly") {
        if (deliveryKeys.current.has(nudge.key)) continue;
        deliveryKeys.current.add(nudge.key);
        // Interval-first check-in: build the evidence-backed recap for the due
        // prompt before claiming delivery, so the notification can say the
        // recap is ready. Any failure falls back to the generic prompt.
        void (async () => {
          let recap: ActivityIntervalCardData | null = null;
          try {
            setActivityPreparing(true);
            const ensured = await ensureActivityIntervalReview(facts.nextPromptAt);
            if (ensured.status === "ready" && ensured.interval) recap = ensured.interval;
          } catch { /* recap is optional; the generic prompt still fires */ }
          finally { setActivityPreparing(false); }
          try {
            const { delivered } = await apiRequest<{ delivered: boolean }>("/api/work-os/me/prompt-delivery", {
              method: "POST",
              headers: { "Idempotency-Key": nudge.key },
              body: JSON.stringify({}),
            });
            if (!delivered || notifiedKeys.current.has(nudge.key)) return;
            notifiedKeys.current.add(nudge.key);
            writeJson(NOTIFIED_KEY, [...notifiedKeys.current].slice(-80));
            if (recap) {
              setActivityPrompt(recap);
              fireNotification({
                kind: "hourly",
                key: `recap:${recap.id}`,
                title: "Your activity recap is ready",
                body: `${recap.label}: ${(recap.headline ?? "Review what your screenshots show.").slice(0, 140)}`,
              }, notificationPermission.current);
            } else {
              fireNotification(nudge, notificationPermission.current);
            }
            setMissed(false);
            // A ready recap surfaces as the collapsed bubble; the chat window
            // never opens itself.
            void loadDay();
            if (facts.shiftDate) void workOsQueryClient.invalidateQueries({ queryKey: workOsKeys.activityIntervals(facts.shiftDate) });
          } finally {
            deliveryKeys.current.delete(nudge.key);
          }
        })();
        continue;
      }
      notifiedKeys.current.add(nudge.key);
      writeJson(NOTIFIED_KEY, [...notifiedKeys.current].slice(-80));
      fireNotification(nudge, notificationPermission.current);
    }
  }, [facts.loaded, facts.promptRequired, facts.nextPromptAt, facts.shiftDate, facts.promptKind, facts.sessionState, facts.shiftEndsAt, facts.eodSubmitted, connected, eodAlertNow, clockInAlertNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Snooze expiry: re-prompt when the snooze window passes ──
  useEffect(() => {
    if (avatarSnoozeFixture) writeJson(SNOOZE_KEY, { count: 0, until: Date.now() + 18_000 });
  }, [avatarSnoozeFixture]);

  useEffect(() => {
    if (missed || !facts.promptRequired) return;
    const snooze = readJson<{ count?: number; until?: number | null }>(SNOOZE_KEY, {});
    if (!snooze.until || Date.now() < snooze.until) return;
    const nextCount = (snooze.count ?? 0) + 1;
    const until = snoozeUntil(Date.now(), nextCount);
    if (until === null) {
      setMissed(true);
      writeJson(SNOOZE_KEY, { count: 0, until: null });
      setChat((current) => [...current, {
        id: `missed-${Date.now()}`, role: "system",
        text: "This update was marked as missed. Your next hourly prompt will arrive as usual.",
      }]);
    } else {
      writeJson(SNOOZE_KEY, { count: nextCount, until });
      setSnoozeCount(nextCount);
      setSnoozeReplayId((value) => value + 1);
      fireNotification({ kind: "hourly", key: `snooze-${until}`, title: "Update still due", body: "A few words is all it takes." }, notificationPermission.current);
    }
  }, [now, facts.promptRequired, missed]);

  // Cancel a scheduled return-to-orb: a deliberate interaction keeps the chat
  // open and forgets the alert-open state.
  const clearRecapAutoCollapse = useCallback((): void => {
    if (recapAutoCollapse.current !== null) {
      window.clearTimeout(recapAutoCollapse.current);
      recapAutoCollapse.current = null;
    }
  }, []);

  const updateNextStepsEntry = useCallback((entryId: string, update: (moment: RecapNextStepsMoment) => RecapNextStepsMoment): void => {
    setChat((current) => current.map((entry) => entry.id === entryId && entry.nextSteps
      ? { ...entry, nextSteps: update(entry.nextSteps) }
      : entry));
  }, []);

  /** Settles an in-flight next-step decision against the server: used when the
   * accept response was lost, when the apply is still running, and when a
   * reload restores a card that was left on Saving. Always ends with a real
   * state so the card can never stay in flight forever. */
  const reconcileNextStepDecision = useCallback(async (entryId: string, item: RecapNextStepItem, note?: string | null): Promise<RecapNextStepState> => {
    let state: RecapNextStepState | null = null;
    let failure: string | null = note ?? null;
    for (let attempt = 0; attempt < 5 && !state; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
      try {
        const read = await readRecapNextStep(item.proposalId);
        const status = read?.proposal?.status;
        state = status === "applied" ? "applied"
          : status === "rejected" ? "skipped"
            : status === "failed" || status === "needs_review" || status === "stale" ? "failed"
              : null;
        if (state) failure = read?.proposal?.failure_reason ?? failure;
      } catch { /* keep reconciling */ }
    }
    const settled: RecapNextStepState = state ?? "failed";
    updateNextStepsEntry(entryId, (moment) => ({
      ...moment,
      states: { ...moment.states, [item.proposalId]: settled },
      failures: settled === "failed"
        ? { ...moment.failures, [item.proposalId]: failure ?? "The change is still processing. Retry when the connection is steady." }
        : moment.failures,
    }));
    if (settled === "applied" || settled === "skipped") void loadDay();
    return settled;
  }, [loadDay, updateNextStepsEntry]);

  /** Ends the next-steps moment: still-undecided suggestions are dismissed on
   * the server and shown as skipped, so nothing lingers in any queue. A
   * decision already in flight keeps its state and reports truthfully. */
  const endNextStepsMoment = useCallback((): void => {
    const ids = nextStepsPending.current;
    if (!ids.length) return;
    nextStepsPending.current = [];
    setChat((current) => current.map((entry) => {
      if (!entry.nextSteps || !ids.includes(entry.nextSteps.intervalId)) return entry;
      const states: Record<string, RecapNextStepState> = { ...entry.nextSteps.states };
      for (const item of entry.nextSteps.items) {
        if ((states[item.proposalId] ?? "pending") === "pending") states[item.proposalId] = "skipped";
      }
      return { ...entry, nextSteps: { ...entry.nextSteps, states, status: entry.nextSteps.status === "ready" ? "done" : entry.nextSteps.status } };
    }));
    for (const id of ids) void dismissRecapNextSteps(id).catch(() => undefined);
  }, []);

  // ── Expanded/collapsed window sizing ──
  const toggleExpanded = useCallback(async (open: boolean): Promise<void> => {
    if (!open) {
      clearRecapAutoCollapse();
      endNextStepsMoment();
    }
    setExpanded(open);
    // The recap celebration is staggered: it plays only once the panel has
    // closed, so the employee sees the success beat on the orb instead of it
    // finishing behind the next-steps card. Runs before the window sizing so a
    // plain browser (no Tauri window) still celebrates.
    if (!open && pendingRecapCelebration.current) {
      pendingRecapCelebration.current = false;
      window.setTimeout(() => {
        setReadyPulse(true);
        window.setTimeout(() => setReadyPulse(false), 2_900);
      }, 180);
    }
    const size = open ? AVATAR_EXPANDED : AVATAR_COLLAPSED;
    // Resize first, on its own: a monitor/position failure must never leave the
    // window stuck at the wrong size (which kept the companion from collapsing).
    if (!win) return;
    try {
      await win.setSize(new LogicalSize(size.width, size.height));
    } catch { /* sizing is cosmetic */ }
    try {
      const monitor = await currentMonitor();
      const scaleFactor = await win.scaleFactor();
      const outer = await win.outerPosition();
      let x = outer.toLogical(scaleFactor).x;
      let y = outer.toLogical(scaleFactor).y;
      if (monitor) {
        x = Math.max(0, Math.min(monitor.size.width - size.width, x));
        y = Math.max(0, Math.min(monitor.size.height - size.height, y));
      }
      await win.setPosition(new LogicalPosition(x, y));
    } catch { /* sizing is cosmetic */ }
  }, [clearRecapAutoCollapse, endNextStepsMoment, win]);

  /** After the moment is decided, the panel returns to the orb after a settle
   * beat unless the employee interacts again. */
  const scheduleNextStepsSettle = useCallback((): void => {
    if (avatarNextStepsFixture) return;
    if (recapAutoCollapse.current !== null) window.clearTimeout(recapAutoCollapse.current);
    recapAutoCollapse.current = window.setTimeout(() => {
      recapAutoCollapse.current = null;
      void toggleExpanded(false);
    }, nextStepsSettleMs());
  }, [toggleExpanded]);

  /** The post-approval moment: the chat lingers while the recap's suggestions
   * are generated, then shows them inline as actionable cards. */
  const startNextStepsMoment = useCallback(async (intervalId: string, label: string | null, existingEntryId?: string): Promise<void> => {
    const entryId = existingEntryId ?? `next-steps-${intervalId}`;
    // Whichever path attached this moment, its success beat waits for the
    // panel to close so the animation is actually seen.
    pendingRecapCelebration.current = true;
    // A new moment takes over: a settle timer left by an earlier, already
    // finished moment must never collapse the panel and dismiss the fresh
    // suggestions before the employee can act on them.
    clearRecapAutoCollapse();
    if (existingEntryId) {
      // A recovered entry has the lead text but no moment yet: attach it
      // instead of updating a card that was never there.
      setChat((current) => current.map((entry) => entry.id === entryId
        ? {
            ...entry,
            nextSteps: entry.nextSteps
              ? { ...entry.nextSteps, status: "drafting", error: null, items: [], states: {}, failures: {} }
              : { intervalId, label, status: "drafting", items: [], states: {}, failures: {}, error: null },
          }
        : entry));
    } else {
      setChat((current) => current.some((entry) => entry.id === entryId) ? current : [...current, {
        id: entryId,
        role: "assistant",
        text: "Recap confirmed — while it's fresh, here's what could come next:",
        nextSteps: { intervalId, label, status: "drafting", items: [], states: {}, failures: {}, error: null },
        createdAt: new Date().toISOString(),
      }]);
    }
    void toggleExpanded(true);
    if (avatarNextStepsFixture || avatarNextStepsRecoveryLike) {
      // DEV-only: the recovery fixtures resolve their poll locally.
      await new Promise((resolve) => window.setTimeout(resolve, 350));
      if (avatarNextStepsEmptyFixture) {
        updateNextStepsEntry(entryId, (moment) => ({ ...moment, status: "empty" }));
        setScrollToLatest((signal) => signal + 1);
        scheduleNextStepsSettle();
        return;
      }
      const fixture = avatarNextStepsFixtureMoment();
      updateNextStepsEntry(entryId, (moment) => ({ ...moment, status: "ready", label: moment.label ?? fixture.label, items: fixture.items, states: {}, failures: {} }));
      setScrollToLatest((signal) => signal + 1);
      return;
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, attempt === 0 ? 900 : 1_500));
      let view: Awaited<ReturnType<typeof fetchRecapNextSteps>> | null = null;
      try {
        view = await fetchRecapNextSteps(intervalId);
      } catch {
        continue;
      }
      if (!view) continue;
      if (view.status === "ready" && view.items.length) {
        const states: Record<string, RecapNextStepState> = {};
        for (const item of view.items) {
          states[item.proposalId] = item.status === "applied" ? "applied" : item.status === "rejected" ? "skipped" : "pending";
        }
        updateNextStepsEntry(entryId, (moment) => ({ ...moment, status: "ready", label: view.label ?? moment.label, items: view.items, states }));
        setScrollToLatest((signal) => signal + 1);
        return;
      }
      if (view.status === "failed") {
        updateNextStepsEntry(entryId, (moment) => ({ ...moment, status: "failed", error: "Next steps could not be drafted from this recap." }));
        setScrollToLatest((signal) => signal + 1);
        return;
      }
      if (view.status === "skipped" || view.status === "none" || (view.status === "ready" && !view.items.length)) {
        updateNextStepsEntry(entryId, (moment) => ({ ...moment, status: "empty" }));
        setScrollToLatest((signal) => signal + 1);
        // Nothing left to decide: the moment settles whether it was fresh or
        // recovered, so it can never sit open with an empty card.
        scheduleNextStepsSettle();
        return;
      }
    }
    updateNextStepsEntry(entryId, (moment) => ({ ...moment, status: "empty" }));
    setScrollToLatest((signal) => signal + 1);
    scheduleNextStepsSettle();
  }, [avatarNextStepsEmptyFixture, avatarNextStepsFixture, avatarNextStepsRecoveryLike, clearRecapAutoCollapse, scheduleNextStepsSettle, toggleExpanded, updateNextStepsEntry]);

  // A moment whose card was lost to an older sync (or an older build) still has
  // its entry id — `next-steps-<intervalId>` — so its suggestions can be
  // re-attached from the server instead of leaving pending items stranded.
  useEffect(() => {
    if (avatarFixture && !avatarNextStepsRecoveryLike) return;
    if (!avatarNextStepsRecoveryLike && loadedChatConversation !== avatarConversationScope) return;
    if (nextStepsRecovered.current) return;
    nextStepsRecovered.current = true;
    const missing = chatRef.current.filter((entry) => entry.id.startsWith("next-steps-") && !entry.nextSteps);
    for (const entry of missing) {
      const intervalId = entry.id.slice("next-steps-".length);
      if (!intervalId) continue;
      void startNextStepsMoment(intervalId, null, entry.id);
    }
    // A decision left in flight by a previous session is settled against the
    // server, so a restored card can never stay on Saving.
    const inFlight = chatRef.current.flatMap((entry) => entry.nextSteps
      ? entry.nextSteps.items
        .filter((item) => (entry.nextSteps!.states[item.proposalId] ?? "pending") === "processing")
        .map((item) => ({ entryId: entry.id, item }))
      : []);
    for (const { entryId, item } of inFlight) void reconcileNextStepDecision(entryId, item);
  }, [avatarConversationScope, avatarFixture, avatarNextStepsRecoveryLike, loadedChatConversation, reconcileNextStepDecision, startNextStepsMoment]);

  /** One inline decision on a next-step suggestion, filed through the same
   * owner-scoped proposal endpoint as any other review card. A decision whose
   * apply is still running — or whose accept response was lost — is reconciled
   * against the server so the card can never sit on Saving forever. */
  const decideNextStep = useCallback(async (entryId: string, item: RecapNextStepItem, decision: "accept" | "skip", edits?: { name?: string }): Promise<void> => {
    setNextStepsBusyId(entryId);
    updateNextStepsEntry(entryId, (moment) => ({ ...moment, states: { ...moment.states, [item.proposalId]: "processing" } }));
    let state: RecapNextStepState = "failed";
    let failure: string | null = null;
    try {
      if (avatarNextStepsFixture || avatarNextStepsRecoveryLike) {
        // DEV-only fixture: the decision is simulated so the card's states can
        // be exercised without a live session.
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        const fixtureState: RecapNextStepState = decision === "skip" ? "skipped" : "applied";
        updateNextStepsEntry(entryId, (moment) => ({ ...moment, states: { ...moment.states, [item.proposalId]: fixtureState } }));
        return;
      }
      try {
        const row = await decideRecapNextStep(item.proposalId, decision === "accept" ? "accept" : "reject", edits);
        state = nextStepState(decision, row?.outcome);
        failure = row?.failure_reason ?? null;
      } catch (value) {
        // The apply may still have landed; reconcile instead of failing.
        state = "processing";
        failure = value instanceof Error ? value.message : null;
      }
      if (state === "processing") {
        await reconcileNextStepDecision(entryId, item, failure);
        return;
      }
      updateNextStepsEntry(entryId, (moment) => ({
        ...moment,
        states: { ...moment.states, [item.proposalId]: state },
        failures: state === "failed"
          ? { ...moment.failures, [item.proposalId]: failure ?? "The change could not be applied." }
          : moment.failures,
      }));
      if (state === "applied" || state === "skipped") void loadDay();
    } catch (value) {
      updateNextStepsEntry(entryId, (moment) => ({
        ...moment,
        states: { ...moment.states, [item.proposalId]: "failed" },
        failures: { ...moment.failures, [item.proposalId]: value instanceof Error ? value.message : "The change could not be applied." },
      }));
    } finally {
      setNextStepsBusyId(null);
    }
  }, [avatarNextStepsFixture, avatarNextStepsRecoveryLike, loadDay, reconcileNextStepDecision, updateNextStepsEntry]);

  // Which moments still have undecided items (for dismissal on close) and
  // which fully settled moments already scheduled their settle beat.
  useEffect(() => {
    const pending = chat.flatMap((entry) => entry.nextSteps
      && (entry.nextSteps.status === "ready" || entry.nextSteps.status === "done")
      && entry.nextSteps.items.some((item) => ["pending", "processing"].includes(entry.nextSteps!.states[item.proposalId] ?? "pending"))
      ? [entry.nextSteps.intervalId] : []);
    nextStepsPending.current = [...new Set(pending)];
  }, [chat]);

  useEffect(() => {
    const settledReady = chat.filter((entry) => entry.nextSteps
      && entry.nextSteps.status === "ready"
      && entry.nextSteps.items.length > 0
      && entry.nextSteps.items.every((item) => !["pending", "processing"].includes(entry.nextSteps!.states[item.proposalId] ?? "pending")));
    for (const entry of settledReady) {
      updateNextStepsEntry(entry.id, (moment) => ({ ...moment, status: "done" }));
    }
    const doneUnsettled = chat.filter((entry) => entry.nextSteps
      && entry.nextSteps.status === "done"
      && entry.nextSteps.items.length > 0
      && !nextStepsSettled.current.has(entry.nextSteps.intervalId));
    if (!doneUnsettled.length) return;
    for (const entry of doneUnsettled) {
      nextStepsSettled.current.add(entry.nextSteps!.intervalId);
    }
    scheduleNextStepsSettle();
  }, [chat, scheduleNextStepsSettle, updateNextStepsEntry]);

  const openEodReview = useCallback(async (): Promise<void> => {
    void emit("work-os://avatar-open-eod");
    await invoke("focus_main").catch(() => undefined);
    await toggleExpanded(false);
  }, [toggleExpanded]);

  // "Set today's goal" on the agenda bubble: hand the employee to the main
  // window's SOD planning modal instead of making them type in the chat first.
  const openGoalPlan = useCallback(async (): Promise<void> => {
    void emit("work-os://avatar-open-plan");
    await invoke("focus_main").catch(() => undefined);
    await toggleExpanded(false);
  }, [toggleExpanded]);

  // "View in app" on the Recent activity header opens the dock's Focus tab,
  // where the same recaps live beneath the daily goal.
  const openFocusInApp = useCallback(async (): Promise<void> => {
    void emit("work-os://avatar-open-focus");
    await invoke("focus_main").catch(() => undefined);
    await toggleExpanded(false);
  }, [toggleExpanded]);

  const navigateToPage = useCallback(async (page: NavigatePage): Promise<void> => {
    void emit("work-os://avatar-navigate", { view: page });
    await invoke("focus_main").catch(() => undefined);
  }, []);

  // Ctrl + , (Cmd + , on macOS) reaches Settings from the floating window too.
  useEffect(() => {
    const onSettingsHotkey = (event: KeyboardEvent) => {
      if (!isSettingsHotkey(event)) return;
      event.preventDefault();
      void navigateToPage("settings");
    };
    window.addEventListener("keydown", onSettingsHotkey);
    return () => window.removeEventListener("keydown", onSettingsHotkey);
  }, [navigateToPage]);

  // Confirm/amend an Activity Interval Review. The AI inference never becomes
  // an employee check-in and never advances the check-in cadence; only the
  // employee's own decision on this recap is recorded.
  const decideActivityPrompt = useCallback(async (id: string, action: "confirm" | "amend", feedback?: string): Promise<void> => {
    setDecidingIntervalId(id);
    try {
      if (avatarNextStepsFixture) {
        // DEV-only fixture: the decision and its moment are simulated so the
        // flow can be exercised without a live session.
        await new Promise((resolve) => window.setTimeout(resolve, 250));
        setActivityPrompt(null);
        setRecapEditMode(false);
        setChat((current) => [...current.map((entry) => entry.activityInterval?.id === id
          ? { ...entry, activityInterval: undefined, receipt: action === "confirm" ? "Recap confirmed" : "Recap updated with your note" }
          : entry), {
          id: "next-steps-fixture", role: "assistant",
          text: "Recap confirmed — while it's fresh, here's what could come next:",
          nextSteps: avatarNextStepsFixtureMoment(),
          createdAt: new Date().toISOString(),
        }]);
        void toggleExpanded(true);
        return;
      }
      await decideActivityIntervalReview(id, action, feedback);
      const recapLabel = chatRef.current.find((entry) => entry.activityInterval?.id === id)?.activityInterval?.label ?? activityPrompt?.label ?? null;
      setActivityPrompt(null);
      setRecapEditMode(false);
      setFacts((current) => clearRecordedUpdatePrompt(current));
      setChat((current) => current.map((entry) => entry.activityInterval?.id === id
        ? { ...entry, activityInterval: undefined, text: entry.text, receipt: action === "confirm" ? "Recap confirmed" : "Recap updated with your note" }
        : entry));
      if (facts.shiftDate) void workOsQueryClient.invalidateQueries({ queryKey: workOsKeys.activityIntervals(facts.shiftDate) });
      void loadDay();
      // The panel lingers instead of returning to the orb: the approved recap
      // becomes a next-steps moment with actionable suggestions inline. Its
      // celebration waits until the panel closes so the animation is seen.
      pendingRecapCelebration.current = true;
      clearRecapAutoCollapse();
      void startNextStepsMoment(id, recapLabel);
    } catch (value) {
      setChat((current) => [...current, {
        id: `activity-decision-error-${Date.now()}`, role: "system",
        text: value instanceof Error ? value.message : "The recap decision could not be saved.",
      }]);
    } finally {
      setDecidingIntervalId(null);
    }
  }, [activityPrompt, clearRecapAutoCollapse, facts.shiftDate, loadDay, startNextStepsMoment]);

  // Edit on the recap bubble hands editing to the composer: the employee writes
  // the correction there, and sending it records the recap note.
  const startRecapEdit = useCallback((): void => {
    setRecapEditMode(true);
    setComposerFocusSignal((signal) => signal + 1);
  }, []);

  // View more on the recap bubble: open the chat on the latest item. The recap
  // turn stays in the thread until it is decided; the panel then lingers into
  // the next-steps moment instead of returning straight to the orb.
  const openRecapInChat = useCallback((): void => {
    setAvatarTab("chat");
    setScrollToLatest((signal) => signal + 1);
    void toggleExpanded(true);
  }, [toggleExpanded]);

  // ── Persist position after drags settle ──
  useEffect(() => {
    if (!win) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unlisten = win.onMoved(() => {
      if (expanded) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        try {
          const scaleFactor = await win.scaleFactor();
          const outer = await win.outerPosition();
          const logical = outer.toLogical(scaleFactor);
          // Snap to the nearest screen edge when within 28px.
          const monitor = await currentMonitor();
          let x = logical.x;
          if (monitor) {
            const width = (await win.outerSize()).toLogical(scaleFactor).width;
            if (x < 28) x = 0;
            else if (x > monitor.size.width - width - 28) x = monitor.size.width - width;
          }
          if (x !== logical.x) await win.setPosition(new LogicalPosition(x, logical.y));
          writeJson(POSITION_KEY, { x, y: logical.y });
        } catch { /* best effort */ }
      }, 600);
    });
    return () => { unlisten.then((fn) => fn()).catch(() => { /* noop */ }); if (timer) clearTimeout(timer); };
  }, [win, expanded]);

  // ── Composer: interpret + approve, same flow as the main window ──
  const sendUpdate = useCallback(async () => {
    const text = input.trim();
    if (!text || thinkingTrace || filing) return;
    setInput("");
    const startedAt = Date.now();
    const stages: AvatarThinkingStage[] = [
      { label: "Reading today's context" },
      { label: "Matching your tasks" },
      { label: "Drafting proposals" },
    ];
    setThinkingTrace({ stages, active: 0, startedAt });
    const settle = (labels: string[], result?: string): AvatarTrace => ({
      labels,
      elapsedMs: Date.now() - startedAt,
      result,
    });
    const userTurn: ChatEntry = { id: `u-${Date.now()}`, role: "user", text, createdAt: new Date().toISOString() };
    const history = [...chat.filter((entry) => entry.role === "user" || entry.role === "assistant"), userTurn];
    setChat((current) => [...current, userTurn]);
    try {
      const result = await apiRequest<{ interpretation: unknown }>("/api/work-os/me/interpret", {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ input: text, planIntent: facts.planIntent || null, today: facts.shiftDate || null, history: stripPromptReminderTurns(history).slice(-24).map(({ role, text: turnText }) => ({ role, text: turnText })) }),
      });
      setThinkingTrace({ stages, active: 1, startedAt });
      const review = normalizeInterpretation(result.interpretation, text, facts.taskOptions);
      if (!review) throw new Error("The assistant couldn't map that to work yet.");
      if (!review.operations.length) {
        const trace = settle(stages.map((stage) => stage.label), "Nothing to record");
        setChat((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", text: review.reply ?? "Noted.", trace, createdAt: new Date().toISOString() }]);
        return;
      }
      setThinkingTrace({ stages, active: 2, startedAt });
      const mutating = review.operations.map((op, index) => ({ op, index })).filter(({ op }) => isMutatingToolOp(op));
      const proposals = mutating.length ? await apiRequest<{ proposals: FiledProposalRow[] }>("/api/work-os/me/proposals", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ input_text: text, operations: mutating.map(({ op }) => ({ op: op.op, statement: op.statement, task_id: op.taskId, task_title: op.taskTitle, task_group_id: op.taskGroupId, limit: op.limit, tasks: op.tasks ?? null })) }),
      }) : { proposals: [] as FiledProposalRow[] };
      // A filed check-in clears the recorded-update prompt immediately so the
      // banner and the task-context card disappear without waiting for the poll.
      if (review.operations.some((operation) => operation.op === "record_progress" || operation.op === "record_blocker")) {
        setFacts((current) => clearRecordedUpdatePrompt(current));
      }
      const filedByOriginal = filedProposalGroups(proposals.proposals, (clientOperationIndex) => mutating[clientOperationIndex]?.index);
      const operations = review.operations.map((op, index) => ({ ...attachFiledProposals(op, filedByOriginal.get(index) ?? []), enabled: isMutatingToolOp(op) }));
      // Read-only display tools fetch immediately — viewing tasks mutates
      // nothing, so there is nothing to approve.
      const displayResults: ToolCallResult[] = [];
      for (const op of operations.filter(isDisplayToolOp)) {
        const view = op.op === "display_overdue_tasks" ? "overdue" : "pending";
        try {
          const data = await apiRequest<{ tasks: Array<Record<string, unknown>> }>(`/api/work-os/me/tasks?view=${view}&limit=${op.limit ?? 20}`);
          displayResults.push({ op, status: "recorded", message: view === "overdue" ? "Overdue tasks loaded." : "Pending tasks loaded.", data: { provider_result: { view, tasks: data.tasks ?? [] } } });
        } catch (value) {
          displayResults.push({ op, status: "failed", message: value instanceof Error ? value.message : "The task list could not be loaded." });
        }
      }
      const trace = settle(stages.map((stage) => stage.label), mutating.length ? `${mutating.length} proposal${mutating.length === 1 ? "" : "s"} to review` : "Shown inline");
      const reviewId = crypto.randomUUID();
      const assistantEntry: ChatEntry = { id: reviewId, role: "assistant", text: review.reply ?? "Here's what I understood.", operations, taskOptions: [], trace, toolResults: displayResults.length ? displayResults : undefined, createdAt: new Date().toISOString() };
      setChat((current) => [...current, assistantEntry]);
      void shareAvatarTools({ reviewId, input: text, reply: review.reply, operations, results: displayResults, taskOptions: [] });
    } catch (value) {
      setChat((current) => [...current, {
        id: `e-${Date.now()}`, role: "system",
        text: value instanceof Error ? value.message : "The assistant is unavailable — file this one from the main window.",
      }]);
    } finally {
      setThinkingTrace(null);
    }
  }, [input, thinkingTrace, filing, facts.planIntent, facts.shiftDate, chat]);

  // While the recap bubble is in edit mode the composer records the recap note
  // instead of filing a general update.
  const sendAvatarUpdate = useCallback(async (): Promise<void> => {
    if (recapEditMode && activityPrompt) {
      const note = input.trim();
      if (!note || decidingIntervalId) return;
      setInput("");
      await decideActivityPrompt(activityPrompt.id, "amend", note);
      return;
    }
    await sendUpdate();
  }, [activityPrompt, decideActivityPrompt, decidingIntervalId, input, recapEditMode, sendUpdate]);

  const approveOperations = useCallback(async (entryId: string, approved: ProposedOperation[], rejected: ProposedOperation[]) => {
    if ((!approved.length && !rejected.length) || filing) return;
    setFiling(true);
    try {
      const [outcome, rejectionResults] = await Promise.all([
        approved.length ? fileApprovedOperations(approved.map((op) => ({ ...op, enabled: true })), proposalFilingTransport()) : Promise.resolve({ recorded: 0, queued: 0, processing: 0, failed: [], results: [] as ToolCallResult[] }),
        Promise.all(rejected.map(async (op): Promise<ToolCallResult> => {
          try {
            if (isBatchToolOp(op) || isPlanImportOp(op)) return await skipBatchOperation(op, proposalFilingTransport());
            if (!op.proposalId) throw new Error("This proposal is no longer available. Interpret it again before dismissing it.");
            const row = await apiRequest<{ outcome?: string; failure_reason?: string | null }>(`/api/work-os/proposals/${encodeURIComponent(op.proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "reject" }) });
            // A 200 is not proof of rejection: the action may already have
            // applied (or be mid-apply) in another window.
            if (row?.outcome === "rejected" || !row?.outcome) return { op: { ...op, enabled: false }, status: "denied", message: "Skipped. This action was not recorded." };
            if (row.outcome === "applying") return { op, status: "processing", message: "The server is still applying this action — it cannot be skipped right now." };
            return { op, status: "failed", message: row.failure_reason?.trim() || (row.outcome === "applied" ? "This action was already applied and cannot be skipped." : "This action could not be skipped.") };
          } catch (value) {
            return { op, status: "failed", message: value instanceof Error ? value.message : "This action could not be skipped." };
          }
        })),
      ]);
      const results = [...outcome.results, ...rejectionResults];
      if (outcome.recorded > 0 && !results.some((result) => result.status !== "recorded" && result.status !== "denied")) setMascotReceipt({});
      const decided = [...approved, ...rejected];
      setChat((current) => current.map((entry) => entry.id === entryId
        ? { ...entry, operations: entry.operations ? disableDecidedOperations(entry.operations, decided) : undefined, toolResults: mergeToolResults(entry.toolResults ?? [], results), receipt: null }
        : entry));
      const filed = chatRef.current.find((entry) => entry.id === entryId);
      const entries = chatRef.current;
      const at = entries.findIndex((entry) => entry.id === entryId);
      const precedingUser = [...entries.slice(0, at < 0 ? entries.length : at)].reverse().find((entry) => entry.role === "user");
      void shareAvatarTools({
        reviewId: entryId,
        input: precedingUser?.text ?? "",
        reply: filed?.text,
        operations: disableDecidedOperations(filed?.operations ?? decided, decided),
        results: mergeToolResults(filed?.toolResults ?? [], results),
        taskOptions: [],
      });
      if (outcome.recorded > 0) setFacts((current) => clearRecordedUpdatePrompt(current));
      const resolvedTaskIds = results
        .filter((result) => result.status === "recorded" || result.status === "denied")
        .map((result) => result.op.taskId)
        .filter((id): id is string => !!id);
      if (resolvedTaskIds.length) {
        setProposedTaskIds((current) => {
          const next = new Set(current);
          for (const id of resolvedTaskIds) next.delete(id);
          return next;
        });
      }
      writeJson(SNOOZE_KEY, { count: 0, until: null });
      setSnoozeCount(0);
      setMissed(false);
      await loadDay(true);
      void emit("work-os://avatar-day-changed");
    } catch (value) {
      setChat((current) => [...current, {
        id: `e-${Date.now()}`, role: "system",
        text: value instanceof Error ? value.message : "Filing failed — try again from the main window.",
      }]);
    } finally {
      setFiling(false);
    }
  }, [filing, loadDay, shareAvatarTools]);

  const retryOperation = useCallback((entryId: string, result: ToolCallResult) => {
    const op = { ...result.op, enabled: true };
    if ((!op.proposalId && !op.batchId) || filing) return;
    setFiling(true);
    void fileApprovedOperations([op], proposalFilingTransport(), result.createResolution ? { createResolution: result.createResolution } : undefined).then((outcome) => {
      const entry = chatRef.current.find((candidate) => candidate.id === entryId);
      const mergedResults = mergeToolResults(entry?.toolResults ?? [], outcome.results);
      setChat((current) => current.map((candidate) => candidate.id === entryId
        ? { ...candidate, toolResults: mergedResults }
        : candidate));
      // Mirror the normal approval path: publish the complete merged review so
      // the other window replaces the stale failure instead of keeping it.
      if (entry) {
        const entries = chatRef.current;
        const at = entries.findIndex((candidate) => candidate.id === entryId);
        const precedingUser = [...entries.slice(0, at < 0 ? entries.length : at)].reverse().find((candidate) => candidate.role === "user");
        void shareAvatarTools({
          reviewId: entryId,
          input: precedingUser?.text ?? "",
          reply: entry.text,
          operations: (entry.operations ?? []).map((candidate) => ({ ...candidate, enabled: false })),
          results: mergedResults,
          taskOptions: [],
        });
      }
      if (outcome.recorded > 0) {
        setFacts((current) => clearRecordedUpdatePrompt(current));
        void loadDay(true);
        void emit("work-os://avatar-day-changed");
      }
    }).catch((value) => setChat((current) => [...current, {
      id: `retry-error-${Date.now()}`, role: "system",
      text: value instanceof Error ? value.message : "The retry could not be filed.",
    }])).finally(() => setFiling(false));
  }, [filing, loadDay, shareAvatarTools]);

  const loadTaskSubtasks = useCallback(async (taskId: string) => {
    const details = await fetchTaskDetails(taskId);
    return (details.subtasks ?? []).map((child) => ({
      id: String(child.id),
      title: typeof child.title === "string" ? child.title : "Untitled subtask",
      completed: child.completed === true,
    }));
  }, []);

  const proposeAvatarSelectedCompletions = useCallback(async (tasks: Array<{ id: string; title: string }>) => {
    if (!tasks.length || filing) return;
    if (tasks.some((task) => !task.title.trim())) throw new Error("A selected task could not be resolved. Nothing was proposed.");
    const operations = tasks.map((task) => ({
      op: "complete_task" as const,
      statement: `Employee confirmed completion of ${task.title}.`,
      task_id: task.id,
      task_title: task.title,
    }));
    if (avatarMultiSelectScrollFixture) {
      const reviewed = operations.map((operation, index) => ({
        op: operation.op,
        statement: operation.statement,
        taskId: operation.task_id,
        taskTitle: operation.task_title,
        proposalId: `fixture-scroll-proposal-${index + 1}`,
        enabled: true,
      }));
      const reviewId = `fixture-scroll-review-${Date.now()}`;
      const streamId = `fixture-scroll-stream-${Date.now()}`;
      setProposedTaskIds((current) => new Set([...current, ...tasks.map((task) => task.id)]));
      setChat((current) => [...current, {
        id: reviewId,
        role: "assistant",
        text: "Review the selected task completions before anything changes.",
        operations: reviewed,
        createdAt: new Date().toISOString(),
      }, {
        id: streamId,
        role: "assistant",
        text: "Your selected tasks are ready for review. New chat details should remain visible while this reply streams, and the task list stays independently scrollable for anything still open.",
        createdAt: new Date().toISOString(),
      }]);
      return;
    }
    setFiling(true);
    try {
      const { proposals, failures } = await apiRequest<{
        proposals: Array<{ id: string; client_operation_index: number }>;
        failures?: Array<{ client_operation_index: number; error: string }>;
      }>("/api/work-os/me/proposals", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ input_text: `Employee selected ${tasks.length} task${tasks.length === 1 ? "" : "s"} for completion.`, operations }),
      });
      const byIndex = new Map(proposals.map((proposal) => [proposal.client_operation_index, proposal.id]));
      // Only operations that actually filed a proposal become review cards;
      // an operation without a proposal would render as an enabled card whose
      // approval has nothing to file (App.tsx filters the same way).
      const reviewed = operations.flatMap((operation, index) => byIndex.has(index)
        ? [{ op: operation.op, statement: operation.statement, taskId: operation.task_id, taskTitle: operation.task_title, proposalId: byIndex.get(index), enabled: true }]
        : []);
      const filedTaskIds = tasks.filter((_task, index) => byIndex.has(index)).map((task) => task.id);
      const failed = (failures ?? []).map((failure) => ({ title: tasks[failure.client_operation_index]?.title, error: failure.error }));
      if (failed.length) {
        if (!reviewed.length) throw new Error(partialFilingMessage(0, failed));
        setProposedTaskIds((current) => new Set([...current, ...filedTaskIds]));
        const reviewId = crypto.randomUUID();
        setChat((current) => [...current, { id: reviewId, role: "assistant", text: "Review the selected task completions before anything changes.", operations: reviewed, createdAt: new Date().toISOString() }]);
        void shareAvatarTools({ reviewId, input: `Employee selected ${tasks.length} task${tasks.length === 1 ? "" : "s"} for completion.`, reply: "Review the selected task completions before anything changes.", operations: reviewed, results: [], taskOptions: [] });
        throw new Error(partialFilingMessage(reviewed.length, failed));
      }
      if (!reviewed.length) return;
      setProposedTaskIds((current) => new Set([...current, ...filedTaskIds]));
      const reviewId = crypto.randomUUID();
      setChat((current) => [...current, { id: reviewId, role: "assistant", text: "Review the selected task completions before anything changes.", operations: reviewed }]);
      void shareAvatarTools({ reviewId, input: `Employee selected ${tasks.length} task${tasks.length === 1 ? "" : "s"} for completion.`, reply: "Review the selected task completions before anything changes.", operations: reviewed, results: [], taskOptions: [] });
    } finally {
      setFiling(false);
    }
  }, [avatarMultiSelectScrollFixture, filing]);

  const agendaDue = ["clocked_in", "active", "paused"].includes(facts.sessionState ?? "") && facts.planStatus !== "confirmed" && facts.loaded;
  const composerTarget = composerSendTarget({ agendaDue, recapEditing: recapEditMode && activityPrompt !== null });
  /** Persists only an agenda that the planning service successfully built. */
  const confirmAgenda = useCallback(async (
    goal: string,
    interpretation: PlanningInterpretation | null,
    answers: AgendaAnswers,
    review: { rounds: number; answered: number; asked: number; reviewed: boolean },
  ) => {
    setFiling(true);
    let receiptText = "";
    try {
      if (interpretation) {
        if (!interpretation.buildId) throw new Error("Build the plan again before confirming it.");
        const items = buildPlanItemsFromInterpretation(facts.planItems, interpretation, answers);
        const confirmation = await apiRequest<{ taskCreation?: { tasks?: number; subtasks?: number; failed?: number; reused?: number } }>("/api/work-os/me/plan", {
          method: "PUT",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            shift_date: facts.shiftDate,
            ...(typeof facts.planRevision === "number" ? { revision: facts.planRevision } : {}),
            confirm: true,
            build_id: interpretation.buildId,
            freeform_intent: goal,
            goal_provenance: "ai_draft",
            focus_summary: interpretation.summary,
            interpretation_metadata: {
              model: "work-os-plan", promptVersion: "work-os-plan-v1", interpretedAt: new Date().toISOString(),
              clarificationCount: interpretation.clarifications.length,
              sourceContext: ["tasks", "carry_over", "previous_plan", "blockers", "recent_updates"],
              clarifications: interpretation.clarifications,
            },
            clarification_answers: answers,
            items,
          }),
        });
        const materialized = confirmation?.taskCreation;
        const createdTasks = materialized?.tasks ?? 0;
        const createdSubtasks = materialized?.subtasks ?? 0;
        const reusedTasks = materialized?.reused ?? 0;
        // Report the counts that actually happened: a reuse-only confirm must
        // never claim "Created 0 Work OS tasks".
        const bits: string[] = [];
        if (createdTasks) bits.push(`created ${createdTasks} Work OS task${createdTasks === 1 ? "" : "s"}`);
        if (reusedTasks) bits.push(`continued ${reusedTasks} existing task${reusedTasks === 1 ? "" : "s"}`);
        if (createdSubtasks) bits.push(`added ${createdSubtasks} subtask${createdSubtasks === 1 ? "" : "s"}`);
        const materializeCopy = materialized && bits.length
          ? ` Plan applied: ${bits.join(", ")}.`
          : materialized?.failed
            ? ` ${materialized.failed} plan task${materialized.failed === 1 ? "" : "s"} could not be created — they will retry on your next confirm.`
            : "";
        receiptText = `${agendaReceipt(review)}${materializeCopy}`;
      } else throw new Error("Planning assistance must build a plan before it can be confirmed.");
      setInput("");
      setAgendaReview(null);
      setChat((current) => [...current, {
        id: `agenda-${Date.now()}`, role: "assistant",
          text: receiptText,
        receipt: "Agenda confirmed",
        createdAt: new Date().toISOString(),
      }]);
      await loadDay(true);
      void emit("work-os://avatar-day-changed");
    } catch (value) {
      const message = value instanceof Error ? value.message : "Your agenda could not be confirmed.";
      setChat((current) => [...current, {
        id: `agenda-error-${Date.now()}`, role: "system",
        text: /changed on another device|already confirmed/i.test(message)
          ? "This plan changed on another device. Open the main window to review it before confirming again."
          : /AI build/i.test(message)
            ? "The AI plan build expired. Send your agenda again to rebuild it."
            : message,
      }]);
    } finally { setFiling(false); }
  }, [facts.planItems, facts.shiftDate, loadDay]);
  /** Agenda entry: the assistant reviews the goal first and asks up to two
   * follow-up questions before anything is persisted. */
  const submitAgenda = useCallback(async () => {
    const goal = input.trim();
    if (!goal || filing || thinkingTrace || agendaReview || !facts.shiftDate) return;
    const startedAt = Date.now();
    const stages: AvatarThinkingStage[] = [
      { label: "Reading your agenda" },
      { label: "Reviewing today's tasks" },
      { label: "Confirming your plan" },
    ];
    setThinkingTrace({ stages, active: 0, startedAt });
    try {
      const conversation = stripPromptReminderTurns(
        chat.filter((entry) => entry.role === "user" || entry.role === "assistant"),
      ).slice(-8).map((entry) => ({ role: entry.role as "user" | "assistant", text: entry.text }));
      const result = await apiRequest<{ interpretation: PlanningInterpretation; build_id: string }>("/api/work-os/me/plan/interpret", {
        method: "POST",
        body: JSON.stringify({ input: goal, date: facts.shiftDate, conversation }),
      });
      const interpretation = { ...result.interpretation, buildId: result.build_id };
      setThinkingTrace({ stages, active: 1, startedAt });
      if (interpretation.clarifications.length > 0) {
        setAgendaReview({ input: goal, interpretation, answers: {}, round: 1 });
        setChat((current) => [...current, {
          id: `agenda-review-${Date.now()}`, role: "assistant",
          text: `${interpretation.summary} Before I set this, ${interpretation.clarifications.length === 1 ? "one quick question" : "two quick questions"}.`,
          createdAt: new Date().toISOString(),
        }]);
        return;
      }
      setThinkingTrace({ stages, active: 2, startedAt });
      await confirmAgenda(goal, interpretation, {}, { rounds: 1, answered: 0, asked: 0, reviewed: true });
    } catch (value) {
      setChat((current) => [...current, {
        id: `agenda-error-${Date.now()}`, role: "system",
        text: value instanceof ApiRequestError && (value.status === 501 || value.status === 503 || value.status === null)
          ? "Planning assistance is unavailable. Try building your plan again before confirming it."
          : value instanceof Error ? value.message : "Your agenda could not be reviewed.",
      }]);
    } finally { setThinkingTrace(null); }
  }, [agendaReview, chat, confirmAgenda, facts.shiftDate, filing, input, thinkingTrace]);
  const answerAgendaReview = useCallback(async () => {
    if (!agendaReview || filing || thinkingTrace) return;
    const { input: goal, interpretation, answers, round } = agendaReview;
    const startedAt = Date.now();
    const stages: AvatarThinkingStage[] = [
      { label: "Reading your answers" },
      { label: "Reviewing today's tasks" },
      { label: "Confirming your plan" },
    ];
    setThinkingTrace({ stages, active: 0, startedAt });
    try {
      const conversation = withAnswerRound(
        stripPromptReminderTurns(chat.filter((entry) => entry.role === "user" || entry.role === "assistant"))
          .slice(-8).map((entry) => ({ role: entry.role as "user" | "assistant", text: entry.text })),
        interpretation.clarifications,
        answers,
      );
      const result = await apiRequest<{ interpretation: PlanningInterpretation; build_id: string }>("/api/work-os/me/plan/interpret", {
        method: "POST",
        body: JSON.stringify({ input: goal, date: facts.shiftDate, conversation }),
      });
      const next = { ...result.interpretation, buildId: result.build_id };
      setThinkingTrace({ stages, active: 1, startedAt });
      const stillOpen = unansweredQuestions(next.clarifications, answers);
      if (stillOpen.length > 0 && round < 2) {
        setAgendaReview({ input: goal, interpretation: next, answers, round: round + 1 });
        setChat((current) => [...current, {
          id: `agenda-review-${Date.now()}`, role: "assistant",
          text: `${next.summary} ${stillOpen.length === 1 ? "One more question" : "Two more questions"} before I set this.`,
          createdAt: new Date().toISOString(),
        }]);
        return;
      }
      setThinkingTrace({ stages, active: 2, startedAt });
      const applicable = applicableAnswers(next.clarifications, answers);
      const answeredCount = Object.keys(applicable).length;
      await confirmAgenda(goal, next, applicable, { rounds: round + 1, answered: answeredCount, asked: interpretation.clarifications.length, reviewed: true });
    } catch (value) {
      setChat((current) => [...current, {
        id: `agenda-error-${Date.now()}`, role: "system",
        text: value instanceof Error ? value.message : "Your answers could not be reviewed.",
      }]);
    } finally { setThinkingTrace(null); }
  }, [agendaReview, chat, confirmAgenda, facts.shiftDate, filing, thinkingTrace]);
  const skipAgendaReview = useCallback(() => {
    if (!agendaReview || filing || thinkingTrace) return;
    const { input: goal, interpretation, answers } = agendaReview;
    const answered = interpretation.clarifications.filter((question) => answers[question.id]?.trim()).length;
    void confirmAgenda(goal, interpretation, answers, { rounds: 1, answered, asked: interpretation.clarifications.length, reviewed: true });
  }, [agendaReview, confirmAgenda, filing, thinkingTrace]);
  const cancelAgendaReview = useCallback(() => {
    if (!agendaReview) return;
    setAgendaReview(null);
    setChat((current) => [...current, {
      id: `agenda-cancelled-${Date.now()}`, role: "system",
      text: "Review cancelled — your agenda text is still in the composer.",
    }]);
  }, [agendaReview]);

  // ── Derived render state ──
  const contextualPrompt = useMemo(() => avatarPrompt(facts, now), [facts, now]);
  const attentionDue = ["agenda", "check_in", "eod"].includes(contextualPrompt.kind);
  // The EOD alert owns the compact bubble while the day's wrap-up window is
  // open, so the mandatory report never hides behind an undecided recap.
  const eodDue = contextualPrompt.kind === "eod";
  const promptTurnId = attentionDue ? `prompt:${facts.shiftDate}:${contextualPrompt.kind}:${facts.nextPromptAt ?? facts.sessionState ?? "now"}` : null;
  // The recap the compact bubble and the chat card treat as current: the live
  // one from the nudge, or the latest undecided recap already in the chat.
  const pendingRecap = useMemo(() => {
    if (activityPrompt && activityPrompt.reviewStatus === "inferred") return activityPrompt;
    const entry = [...chat].reverse().find((item) => item.activityInterval && item.activityInterval.reviewStatus === "inferred");
    return entry?.activityInterval ?? null;
  }, [activityPrompt, chat]);
  const bubble = avatarBubble({ preparing: activityPreparing, eodDue, recapReady: pendingRecap !== null, promptDue: attentionDue });
  useEffect(() => {
    const recap = activityPrompt;
    // A recap gets its own stable turn so it survives the prompt being claimed
    // and stays reviewable in the chat until the employee decides it.
    const turnId = recap ? `recap:${recap.id}` : promptTurnId;
    if (!turnId) return;
    setChat((current) => {
      const text = recap ? (recap.headline ?? "Here is what I observed.") : `${contextualPrompt.heading}: ${contextualPrompt.body}`;
      const existing = current.find((entry) => entry.id === turnId);
      if (existing) {
        if (!recap || existing.activityInterval?.id === recap.id) return current;
        return current.map((entry) => entry.id === turnId ? { ...entry, activityInterval: recap, text } : entry);
      }
      // Only the latest undecided recap stays in the chat; older ones live in
      // the Tasks stream instead of stacking up as chat cards.
      return [...replaceUndecidedRecapTurns(current, turnId), {
        id: turnId, role: "assistant" as const, text, createdAt: new Date().toISOString(), kind: "prompt" as const,
        ...(recap ? { activityInterval: recap } : {}),
      }];
    });
  }, [contextualPrompt.body, promptTurnId, activityPrompt]);
  // The reminder is scaffolding for the prompt it announces. Drop it as soon as
  // a different prompt (or none) is current, including legacy unmarked copies.
  // Recap turns are the employee's review surface and stay until decided.
  useEffect(() => {
    setChat((current) => {
      const next = prunePromptReminderTurns(current, promptTurnId);
      return next.length === current.length ? current : next;
    });
  }, [promptTurnId]);
  // The recap stays in the chat until the employee decides it; a new recap
  // replaces it, and editing mode only follows the recap itself.
  useEffect(() => {
    if (!activityPrompt) setRecapEditMode(false);
  }, [activityPrompt]);
  const taskContext = useMemo(
    () => (facts.loaded ? deriveTaskContext(facts.taskOptions, facts.shiftDate) : null),
    [facts.loaded, facts.shiftDate, facts.taskOptions],
  );

  // The floating Tasks view leads with every open task, classified by the same
  // overdue predicate the check-in context uses, so the card's status chips and
  // its collapsed one-line summary stay truthful.
  const openTaskCardItems = useMemo(() => {
    const open = facts.taskOptions.filter((task) => !task.completed);
    return deriveTaskContext(open, facts.shiftDate, open.length).visible.map((task) => ({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate,
      state: task.overdue ? "overdue" : "pending",
      subtaskTotal: task.subtaskTotal,
      subtaskCompleted: task.subtaskCompleted,
      subtasks: task.subtasks,
    }));
  }, [facts.taskOptions, facts.shiftDate]);
  const showShiftTime = hasOpenShiftSession(facts);
  const { fraction, label, progressAvailable } = shiftElapsedFraction(facts, now);
  const elapsedText = label ? `${label} elapsed` : "Elapsed time unavailable";
  const progressText = progressAvailable ? `${Math.round(fraction * 100)}% of shift complete` : "Shift progress unavailable";
  const shiftLabel = showShiftTime
    ? facts.sessionState === "paused" ? (label ? `Paused · ${label}` : "Paused") : `On shift · ${label}`
    : "Off shift";
  const lastEntry = chat[chat.length - 1];
  const [readyPulse, setReadyPulse] = useState(false);
  useEffect(() => {
    if (!lastEntry?.receipt) {
      setReadyPulse(false);
      return;
    }
    if (readyReceiptRef.current === lastEntry.id) return;
    readyReceiptRef.current = lastEntry.id;
    // A recap confirmation defers its celebration until the panel closes.
    if (pendingRecapCelebration.current) return;
    setReadyPulse(true);
    // The confirmed-outcome celebration runs 2x the original beat, then the
    // pose settles back to work or the queued attention state.
    const timer = window.setTimeout(() => setReadyPulse(false), 2_900);
    return () => window.clearTimeout(timer);
  }, [lastEntry?.id, lastEntry?.receipt]);
  // A recorded receipt is the one transient celebration: show it while the
  // day refresh settles, then return to active work or queued attention.
  const mascotVisual = useMascotRuntime({
    window: "avatar",
    scope: debugScenario.enabled ? "debug:scenario" : desktopSession && facts.personId && facts.shiftDate
      ? `${desktopSession.organizationId}/${facts.personId}/${facts.shiftDate}` : "",
    scenario: debugScenario,
    facts: { ...facts, connected: connected === true && facts.loaded,
      promptKind: contextualPrompt.kind, promptRequired: attentionDue, eodOutstanding: eodDue },
    working: thinking || filing || activityPreparing || !!lastEntry?.toolResults?.some((result) => result.status === "processing"),
    failed: daySyncState === "error" || !!lastEntry?.toolResults?.some((result) => result.status === "failed")
      || (lastEntry?.role === "system" && /^(e-|agenda-error-)/.test(lastEntry.id)),
    needsInput: avatarAttentionFixture || attentionDue || facts.lateReasonRequired || !!agendaReview
      || chat.some((entry) => hasPendingMascotApproval(entry.operations, entry.toolResults)),
    completed: readyPulse,
    receipt: mascotReceipt,
  });
  const agentActivity: MascotAgentActivity = mascotVisual.activity;
  const workdayState: MascotWorkdayState = mascotVisual.workday;
  const showBadge = mascotVisual.pose === "alert";
  const statusText = facts.lateReasonRequired
    ? "Late start — add a reason"
    : !facts.loaded
      ? (daySyncState === "error" ? "Today is syncing" : "Loading today…")
      : facts.niftySyncError || daySyncState === "stale"
        ? "Showing last update"
        : facts.niftySyncing
          ? "Today is syncing"
          : formatWorkOsDate(facts.shiftDate);

  // Agenda opens the composer once when it first becomes due; an explicit
  // collapse is respected until the shift or plan state actually changes.
  useEffect(() => {
    const decision = nextAgendaAutoExpand(
      autoExpandedAgenda.current,
      agendaDue,
      agendaAutoExpandKey(facts.shiftDate, facts.planStatus),
    );
    autoExpandedAgenda.current = decision.key;
    if (decision.expand && !expanded) void toggleExpanded(true);
  }, [agendaDue, expanded, facts.shiftDate, facts.planStatus, toggleExpanded]);

  function clearAvatarConversation() {
    endNextStepsMoment();
    setChat([]);
    chatConversationSignature.current = "";
    if (avatarConversationScope) {
      void secureState.clearConversation(avatarConversationScope).then(() => emit("work-os://conversation-changed", { scope: avatarConversationScope })).catch(() => undefined);
      void secureState.clearPendingTools(avatarConversationScope).then(() => emit("work-os://pending-tools-changed", { scope: avatarConversationScope })).catch(() => undefined);
    }
  }

  useEffect(() => {
    const el = chatScroll.current;
    if (!el) return;
    const tabChanged = previousAvatarTabRef.current !== avatarTab;
    previousAvatarTabRef.current = avatarTab;
    if (avatarTab === "tasks") {
      // The Tasks view is a reading list, not a thread: entering it starts at
      // the top, and nothing that arrives — a recap decision, a new recap, the
      // next page — moves the reader. The thread scroll contract below belongs
      // to the chat tab alone.
      if (tabChanged) el.scrollTo({ top: 0, behavior: "instant" });
      threadMetricsRef.current = { scrollHeight: el.scrollHeight };
      return;
    }
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    const newest = el.lastElementChild as HTMLElement | null;
    const previousHeight = threadMetricsRef.current?.scrollHeight ?? el.scrollHeight;
    const wasAtBottom = isThreadNearBottom({
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      scrollHeight: previousHeight,
      thresholdPx: 96,
    });
    const target = threadScrollTarget({
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      newestHeight: newest ? newest.offsetHeight : 0,
      newestTop: newest ? newest.getBoundingClientRect().top - el.getBoundingClientRect().top : 0,
      wasAtBottom,
      // Opening the chat tab shows the latest turn; ordinary arrivals keep the
      // reader's position unless they were already at the bottom.
      forceBottom: tabChanged,
    });
    if (target !== null) el.scrollTo({ top: target, behavior });
    threadMetricsRef.current = { scrollHeight: el.scrollHeight };
    const newestTurn = el.lastElementChild as HTMLElement | null;
    if (!newestTurn || typeof ResizeObserver === "undefined") return;
    let previousNewestHeight = newestTurn.getBoundingClientRect().height;
    let previousScrollHeight = el.scrollHeight;
    const observer = new ResizeObserver(() => {
      const newestHeight = newestTurn.getBoundingClientRect().height;
      const scrollHeight = el.scrollHeight;
      const wasNearBottom = isThreadNearBottom({
        clientHeight: el.clientHeight,
        scrollTop: el.scrollTop,
        scrollHeight: previousScrollHeight,
        thresholdPx: 96,
      });
      previousScrollHeight = scrollHeight;
      threadMetricsRef.current = { scrollHeight };
      if (newestHeight <= previousNewestHeight) return;
      previousNewestHeight = newestHeight;
      if (!wasNearBottom) return;
      el.scrollTo({ top: scrollHeight, behavior: "instant" });
    });
    observer.observe(newestTurn);
    return () => observer.disconnect();
  }, [avatarTab, chat.length, thinking]);

  // View more — and a fresh recap while the window is already open — lands the
  // reader on the latest item instead of the top of the thread. The Tasks view
  // is exempt: a recap decision there must never yank the list.
  useEffect(() => {
    if (!expanded || !scrollToLatest || avatarTab === "tasks") return;
    const el = chatScroll.current;
    if (!el) return;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    const frame = requestAnimationFrame(() => requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior });
      threadMetricsRef.current = { scrollHeight: el.scrollHeight };
    }));
    return () => cancelAnimationFrame(frame);
  }, [expanded, scrollToLatest, avatarTab]);
  useEffect(() => {
    if (!expanded || !activityPrompt) return;
    setScrollToLatest((signal) => signal + 1);
  }, [expanded, activityPrompt?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- the recap id is the scroll trigger

  if (connected === false) {
    return (
      <div className={`avatar-shell ${expanded ? "expanded" : ""}`}>
        {!expanded && (
          <div className="avatar-compact">
          <span className="avatar-drag-surface" data-tauri-drag-region title="Drag to move the companion" aria-hidden="true">⋮⋮</span><button className="avatar-hide" onClick={() => { stopRecapRead(); void invoke("hide_avatar").catch(() => undefined); }} aria-label="Hide companion" title="Hide companion"><X size={13} aria-hidden="true" /></button>
          <button className="avatar-orb" onClick={() => void toggleExpanded(true)} title="Connect Work OS from the main window" aria-label={`Open ${MASCOT.name} companion to connect Work OS`}>
            <MascotPet workday="disconnected" className="avatar-pet" artClassName="avatar-pet-art" />
          </button>
          </div>
        )}
        {expanded && (
          <ConversationSurface surface="floating" ariaLabel={`${MASCOT.name} companion`} className="avatar-panel">
                  <header className="avatar-head" onMouseDown={(event) => {
                    if (!isHeaderDragStart(event.button, event.target)) return;
                    if (!isTauri()) return;
                    void getCurrentWindow().startDragging().catch(() => undefined);
                  }}><div className="avatar-head-row"><div className="avatar-drag-zone" data-tauri-drag-region><div className="avatar-title"><span className="avatar-head-mark avatar-mascot-mark" aria-hidden="true"><MascotMark live pose={MASCOT.idlePose} /></span><div className="avatar-head-copy"><strong>Connect Work OS</strong><small>to begin</small></div></div></div><div className="avatar-head-actions"><button className="avatar-icon" onClick={() => void toggleExpanded(false)} aria-label="Collapse companion" title="Collapse companion"><X size={15} aria-hidden="true" /></button></div></div></header>
              <div className="conversation-scroll-region"><div className="avatar-chat"><div className="chat-entry system"><p>Open the Work OS main window and connect this device — this companion will come alive on its own once you're in.</p></div></div></div>
          </ConversationSurface>
        )}
      </div>
    );
  }

  return (
    <div className={`avatar-shell ${expanded ? "expanded" : ""}`}>
      {!expanded && (
        <div className="avatar-compact">
        {bubble === "processing" && <button className="avatar-prompt-bubble" onClick={() => { clearRecapAutoCollapse(); void toggleExpanded(true); }}><strong>Reviewing your last hour…</strong><span>Otto is analyzing your recent frames.</span></button>}
        {bubble === "recap" && pendingRecap && (
          <div className="avatar-prompt-bubble avatar-recap-bubble">
            {recapSpeech.status === "idle" ? <>
              <strong>{pendingRecap.headline ?? "Your activity recap is ready"}</strong>
              <span>{pendingRecap.detail ? `${pendingRecap.detail.slice(0, 140)}${pendingRecap.detail.length > 140 ? "…" : ""}` : "Review what your screenshots show."}</span>
              <div className="avatar-bubble-actions">
                <button type="button" className="avatar-bubble-more" onClick={openRecapInChat}>View more</button>
                {facts.voiceAvailable && <button
                  type="button"
                  className="avatar-bubble-listen"
                  title="Hear this recap instead of reading it"
                  aria-label={`Listen to ${pendingRecap.label ?? "this recap"}`}
                  onClick={() => toggleRecapRead(pendingRecap.id, pendingRecap.revision ?? null)}
                >Listen</button>}
              </div>
            </> : <>
              <div className="avatar-bubble-reading">
                <span className="avatar-reading-dots" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                <span className="avatar-reading-label">{recapSpeech.status === "playing" ? "Otto is reading" : "Getting your recap…"}</span>
                <button type="button" className="avatar-bubble-stop" onClick={stopRecapRead}>Stop</button>
              </div>
              {recapSpeech.lines.length > 0 && <RecapPrompter
                lines={recapSpeech.lines}
                progress={recapSpeech.progress}
                activeIndex={recapSpeech.activeIndex}
                reduced={reducedMotion}
              />}
            </>}
          </div>
        )}
        {bubble === "prompt" && (
          <AvatarPromptBubble
            kind={contextualPrompt.kind}
            heading={contextualPrompt.heading}
            compact={contextualPrompt.compact}
            onOpen={() => { clearRecapAutoCollapse(); void toggleExpanded(true); }}
            onAction={(action) => { void (action === "open_eod" ? openEodReview() : openGoalPlan()); }}
          />
        )}
        <span className="avatar-drag-surface" data-tauri-drag-region title="Drag to move the companion" aria-hidden="true">⋮⋮</span><button className="avatar-hide" onClick={() => { stopRecapRead(); void invoke("hide_avatar").catch(() => undefined); }} aria-label="Hide companion" title="Hide companion"><X size={13} aria-hidden="true" /></button>
        <button
          className="avatar-orb"
          onClick={() => { clearRecapAutoCollapse(); void toggleExpanded(true); }}
          title={showShiftTime ? `${elapsedText} · ${progressText}` : "Work OS companion"}
          aria-label={showShiftTime ? `${MASCOT.name}: ${mascotVisual.label}. ${elapsedText}. ${progressText}.` : showBadge ? `${MASCOT.name}: ${mascotVisual.label}. Open companion to respond.` : `Open ${MASCOT.name} companion`}
        >
          <MascotPet agent={agentActivity} workday={workdayState} className="avatar-pet" artClassName="avatar-pet-art" replayKey={snoozeReplayId} />
          {(showShiftTime || showBadge) && <span
            className={`avatar-badge${showShiftTime && !showBadge ? " avatar-badge-progress" : ""}${showShiftTime && !showBadge && !progressAvailable ? " avatar-badge-progress-unavailable" : ""}`}
            style={showShiftTime && !showBadge && progressAvailable ? { "--shift-progress": `${fraction * 100}%` } as React.CSSProperties : undefined}
            aria-hidden="true"
          />}
        </button>
        {showShiftTime && <span className="avatar-day-time" aria-hidden="true">{elapsedText}</span>}
        </div>
      )}
      {expanded && (
        <ConversationSurface surface="floating" ariaLabel={`${MASCOT.name} companion`} className="avatar-panel">
          <header className="avatar-head" onMouseDown={(event) => {
            if (!isHeaderDragStart(event.button, event.target)) return;
            if (!isTauri()) return;
            void getCurrentWindow().startDragging().catch(() => undefined);
          }}>
            <div className="avatar-head-row">
              <div className="avatar-drag-zone" data-tauri-drag-region>
                <div className="avatar-title">
                  <span className="avatar-head-mark avatar-mascot-mark" aria-hidden="true"><MascotMark live pose={mascotVisual.pose} tone={mascotVisual.tone} /></span>
                  <div className="avatar-head-copy">
                    <strong title={statusText}>
                      <span className="avatar-head-shift">{shiftLabel}</span>
                    </strong>
                    <span className="sr-only" aria-live="polite">{statusText}</span>
                  </div>
                </div>
              </div>
              <div className="avatar-nav">
                <ChatTabs
                  tabs={[
                    { id: "chat", label: "Chat" },
                    { id: "tasks", label: "Tasks", count: facts.taskOptions.filter((task) => !task.completed).length },
                  ]}
                  active={avatarTab}
                  onSelect={(id) => setAvatarTab(id as "chat" | "tasks")}
                  ariaLabel="Companion view"
                />
              </div>
              <div className="avatar-head-actions">
                {daySyncState !== "ready" && <button className="avatar-retry" onClick={() => { setDaySyncState("loading"); void loadDay(); }} title="Refresh today's record" aria-label="Refresh today's record">Retry</button>}
                {chat.length > 0 && <button className="avatar-icon" onClick={clearAvatarConversation} aria-label="New conversation" title="New conversation"><SquarePen size={15} aria-hidden="true" /></button>}
                <button className="avatar-icon" onClick={() => void toggleExpanded(false)} aria-label="Collapse companion" title="Collapse companion"><X size={15} aria-hidden="true" /></button>
              </div>
            </div>
          </header>
           <div className="conversation-scroll-region">
           <div className="avatar-chat" ref={chatScroll}>
            {attentionDue && <section className={`avatar-context ${contextualPrompt.kind}`} aria-label={activityPreparing ? "Reviewing your last hour" : contextualPrompt.heading}><strong>{activityPreparing ? "Reviewing your last hour…" : contextualPrompt.heading}</strong><small>{activityPreparing ? "Otto is analyzing your recent Worktivity frames to summarize the interval." : contextualPrompt.body}</small>{!activityPreparing && contextualPrompt.action === "open_eod" && <button onClick={() => void openEodReview()}>Open EOD review</button>}</section>}
          {avatarTab === "tasks" ? (<>
            <TaskSelectionCard
              title="Open tasks"
              status={facts.loaded ? "ready" : "loading"}
              tasks={openTaskCardItems}
              onMarkSelectedDone={proposeAvatarSelectedCompletions}
              onLoadSubtasks={loadTaskSubtasks}
              proposedTaskIds={[...proposedTaskIds]}
              onReview={() => setAvatarTab("chat")}
              degraded={daySyncState === "stale"}
              emptyTitle="No open tasks"
              emptyMessage="Tasks waiting to be completed will appear here."
              collapsePersistenceKey={AVATAR_TASKS_COLLAPSE_KEY}
            />
            <ActivityIntervalList
              date={facts.shiftDate || null}
              enabled={facts.loaded}
              timezone={facts.timezone}
              onDecide={decideActivityPrompt}
              decidingId={decidingIntervalId}
              pollMs={DAY_POLL_MS}
              onViewInApp={() => void openFocusInApp()}
              onListen={toggleRecapRead}
              listeningId={recapSpeech.status === "idle" ? null : recapSpeech.intervalId}
            />
          </>) : (<>
          {(contextualPrompt.kind === "check_in" || contextualPrompt.kind === "agenda") && taskContext && (taskContext.pendingCount + taskContext.overdueCount) > 0 && (
            <div className="avatar-task-context">
              <TaskSelectionCard
                dense
                maxHeight={240}
                title="Today's tasks"
                tasks={taskContext.visible.map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, state: task.overdue ? "overdue" : "pending", subtaskTotal: task.subtaskTotal, subtaskCompleted: task.subtaskCompleted, subtasks: task.subtasks }))}
                onMarkSelectedDone={proposeAvatarSelectedCompletions}
                onLoadSubtasks={loadTaskSubtasks}
                proposedTaskIds={[...proposedTaskIds]}
                onReview={() => setAvatarTab("chat")}
                degraded={daySyncState === "stale"}
                emptyTitle="No open tasks"
                emptyMessage="Tasks waiting to be completed will appear here."
              />
            </div>
          )}
             {!chat.length && !attentionDue && (
               <ChatWelcome displayName={facts.displayName} mode={contextualPrompt.kind === "agenda" ? "agenda" : "update"} seed={`floating:${facts.shiftDate || "today"}`} />
             )}
            {
              collapseConsecutiveAssistantDuplicates(chat).map((entry, entryIndex, allEntries) => {
              const streams = entryIndex === allEntries.length - 1 && entry.role === "assistant" && !entry.operations && !entry.toolResults && !entry.receipt && !entry.id.startsWith("prompt:");
              const showAssistantMark = entryIndex === 0 || allEntries[entryIndex - 1]?.role !== "assistant";
              // The assistant sometimes returns the same view twice; render one card.
              const seenCards = new Set<string>();
              return (
              <Fragment key={entry.id}>
                {shouldShowChatDivider(allEntries, entryIndex) ? <ChatTimeDivider at={entry.createdAt} /> : null}
                <ChatSectionBoundary label="avatar chat message">
                {entry.role === "user" ? <ChatTurn role="user" text={entry.text} />
                  : entry.role === "system" ? <ChatTurn role="system" text={entry.text} />
                    : entry.receipt ? <ChatTurn role="assistant" showMark={showAssistantMark} receipt text={entry.receipt} copySource={entry} timestamp={entry.createdAt} />
                      : <ChatTurn role="assistant" showMark={showAssistantMark} text={entry.text} stream={streams} onSettled={bumpSweep} copySource={entry} timestamp={entry.createdAt}
                          actions={entry.activityInterval ? (
                            <button type="button" className="chat-turn-action" title="View all recaps" aria-label="View all recaps in the Tasks tab" onClick={() => setAvatarTab("tasks")}>
                              <History size={12} aria-hidden="true" />
                              <span>All recaps</span>
                            </button>
                          ) : undefined}>
                        {entry.nextSteps && (
                          <RecapNextStepsCard
                            moment={entry.nextSteps}
                            busy={nextStepsBusyId === entry.id}
                            onDecide={(item, decision, edits) => void decideNextStep(entry.id, item, decision, edits)}
                            onRetry={() => void startNextStepsMoment(entry.nextSteps!.intervalId, entry.nextSteps!.label, entry.id)}
                          />
                        )}
                        {entry.trace && (
                          <AvatarThinking
                            stages={entry.trace.labels.map((label) => ({ label }))}
                            active={-1}
                            startedAt={0}
                            settledMs={entry.trace.elapsedMs}
                            result={entry.trace.result}
                          />
                        )}
                        {entry.activityInterval && (
                          <ActivityIntervalCard
                            interval={entry.activityInterval}
                            timezone={facts.timezone}
                            onEdit={activityPrompt?.id === entry.activityInterval.id ? startRecapEdit : undefined}
                            onDecide={decideActivityPrompt}
                            deciding={decidingIntervalId === entry.activityInterval.id}
                            onListen={facts.voiceAvailable ? toggleRecapRead : undefined}
                            listening={recapSpeech.status !== "idle" && recapSpeech.intervalId === entry.activityInterval.id}
                          />
                        )}
                        {entry.toolResults?.map((result, resultIndex) => {
                          const selection = taskSelectionFromResult(result);
                          if (!selection) return null;
                          const displayKey = `${result.op.op}:${selection.view}:${selection.tasks.map((task) => String(task.id ?? "")).join(",")}`;
                          if (seenCards.has(displayKey)) return null;
                          seenCards.add(displayKey);
                          const tasks: TaskSelectionCardTask[] = selection.tasks.map((task) => ({
                            id: String(task.id ?? ""), title: typeof task.title === "string" ? task.title : "Untitled Nifty task",
                            description: typeof task.description === "string" ? task.description : null,
                            dueDate: typeof task.due_date === "string" ? task.due_date : null,
                            priority: typeof task.priority === "string" ? task.priority : null,
                            state: selection.view === "overdue" ? "overdue" : "pending",
                            subtaskTotal: Number(task.subtask_total ?? 0) || 0,
                            subtaskCompleted: Number(task.subtask_completed ?? 0) || 0,
                          })).filter((task) => !!task.id);
                          return <TaskSelectionCard key={`${result.op.op}-${resultIndex}`} title={selection.view === "overdue" ? "Overdue tasks" : "Pending tasks"} tasks={tasks} onMarkSelectedDone={proposeAvatarSelectedCompletions} onLoadSubtasks={loadTaskSubtasks} collapseWhenInactive={entryIndex < allEntries.length - 1} proposedTaskIds={[...proposedTaskIds]} onReview={() => setAvatarTab("chat")} maxHeight={250} emptyTitle={selection.view === "overdue" ? "No overdue tasks" : "No pending tasks"} emptyMessage={selection.view === "overdue" ? "Nothing is past its due date." : "Tasks waiting to be completed will appear here."} />;
                        })}
                        {entry.operations?.length ? (
                          <div className="chat-operations">
                            {entry.operations.map((op, index) => {
                              const result = entry.toolResults?.find((item) => sameToolCall(item.op, op));
                              if (op.op === "navigate_to_page" && op.page) return <NavigateButton key={index} page={op.page} statement={op.statement} onNavigate={(page) => void navigateToPage(page)} />;
                              if (isDisplayToolOp(op)) return result?.status === "failed" ? <p key={index} className="tool-display-error">{result.message}</p> : null;
                              return null;
                            })}
                            {entry.operations.some((op) => isMutatingToolOp(op) && !isBatchToolOp(op) && !isPlanImportOp(op)) ? <ApprovalFlow
                              operations={entry.operations.filter((op) => !isBatchToolOp(op) && !isPlanImportOp(op))}
                              results={entry.toolResults}
                              context={{ shiftDate: facts.shiftDate || null, personId: facts.personId, promptKind: "optional" }}
                              busy={filing}
                              onSubmit={(approved, rejected) => void approveOperations(entry.id, approved, rejected)}
                              onRetry={(result) => retryOperation(entry.id, result)}
                            /> : null}
                            <BatchApprovalCards
                              operations={entry.operations.filter((op) => isMutatingToolOp(op) && (isBatchToolOp(op) || isPlanImportOp(op)))}
                              results={entry.toolResults ?? []}
                              busy={filing}
                              context={{ shiftDate: facts.shiftDate || null, personId: facts.personId, promptKind: "optional" }}
                              collapseWhenInactive={entryIndex < allEntries.length - 1}
                              onApprove={(op) => void approveOperations(entry.id, [op], [])}
                              onSkip={(op) => void approveOperations(entry.id, [], [op])}
                              onRetry={(result) => retryOperation(entry.id, result)}
                            />
                          </div>
                        ) : null}
                      </ChatTurn>
                }
              </ChatSectionBoundary>
              </Fragment>
              );
            })}
            {thinkingTrace && <ChatTurn role="assistant" showMark={chat.at(-1)?.role !== "assistant"}><AvatarThinking stages={thinkingTrace.stages} active={thinkingTrace.active} startedAt={thinkingTrace.startedAt} activeLabel={agendaDue ? "Reviewing your agenda" : "Thinking"} /></ChatTurn>}
            {agendaReview && (
              <AgendaReviewCard
                clarifications={agendaReview.interpretation.clarifications}
                answers={agendaReview.answers}
                onAnswers={(answers) => setAgendaReview((current) => (current ? { ...current, answers } : current))}
                onSend={() => void answerAgendaReview()}
                onSkip={skipAgendaReview}
                onCancel={cancelAgendaReview}
                busy={filing || thinking}
              />
            )}
          </>)}
           </div>
           </div>
           {composerVisible(facts, contextualPrompt.action) && <footer className="avatar-composer-v2 px-2.5 pb-2.5 pt-2">
            {recapEditMode && activityPrompt ? (
              <div className="avatar-recap-edit">
                <span>Editing your recap</span>
                <button type="button" onClick={() => setRecapEditMode(false)}>Cancel</button>
              </div>
            ) : null}
            <WorkOsPromptBar
              sweepSignal={sweepSignal}
              focusSignal={composerFocusSignal}
              voice={facts.voiceAvailable ? voice : undefined}
              hotkeyLabel={VOICE_HOTKEY_LABEL}
              value={input}
              onChange={setInput}
              onSend={() => void (composerTarget === "agenda" ? submitAgenda() : sendAvatarUpdate())}
              placeholder={recapEditMode && activityPrompt ? "Correct or add to your recap…" : agendaReview ? "Answer the follow-up questions above…" : agendaDue ? "Describe your goal for today…" : activityPrompt ? "Add context to the recap above…" : contextualPrompt.kind === "check_in" && !missed ? "Record what changed since your last update…" : "Share an update or instruct the assistant…"}
              ariaLabel={composerTarget === "recap" ? "Correct or add to this recap" : agendaDue ? "Describe your goal for today" : "Share an update or instruct the assistant"}
              canSend={!!input.trim() && !thinking && !filing && !agendaReview}
              busy={thinking || filing}
              autoFocus
              maxLength={4000}
              commands={workOsChatCommands({ eod: () => void openEodReview() }).map((command) =>
                command.key === "focus" ? { ...command, insert: "Focus: " } : command,
              )}
              sendLabel={composerTarget === "recap" ? "Update recap" : agendaDue ? "Confirm today’s agenda" : "Send update"}
            />
          </footer>}
          {contextualPrompt.kind === "check_in" && !missed && !lastEntry?.receipt && (
            <button className="avatar-snooze" onClick={() => {
              const until = snoozeUntil(Date.now(), snoozeCount);
              if (until === null) { setMissed(true); writeJson(SNOOZE_KEY, { count: 0, until: null }); }
              else { writeJson(SNOOZE_KEY, { count: snoozeCount + 1, until }); setSnoozeCount(snoozeCount + 1); void toggleExpanded(false); }
            }}>
              Snooze {snoozeCount === 0 ? "10 min" : snoozeCount === 1 ? "20 min" : "(marks missed)"}
            </button>
          )}
        </ConversationSurface>
      )}
    </div>
  );
}
