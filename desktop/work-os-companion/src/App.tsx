import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { emit, listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import type { Update } from "@tauri-apps/plugin-updater";
import { UPDATE_AVAILABLE_KEY, queryAvailableUpdate, shouldAutoCheckUpdate, updateAvailableCopy } from "./updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Activity, AlertTriangle, Archive, ArrowLeft, BriefcaseBusiness, Bug, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CirclePause, CirclePlay, Clock3, FileCheck2, Fingerprint, Gauge, Inbox, LayoutDashboard, ListChecks, LogIn, LogOut, MessageSquareText, MoreHorizontal, MoveRight, Pause, Pencil, PlugZap, Plus, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { ApiRequestError, apiRequest, discardReadyInterpretation, flushQueue, readyInterpretations, sendOrQueue, setDebugSession, setSyncBypass, updateTaskCompletion } from "./api";
import { beginAuthentication, errorMessage, listenForAuthentication } from "./auth";
import { diagnostics, exportDiagnostics, openDebuggerWindow, openLogsDir } from "./diagnostics";
import { FEATURES } from "./features";
import { formatWorkOsDate, formatWorkOsDateTime, formatWorkOsTime as formatTime, shiftWorkOsDate } from "./dateFormat";
import { useNotifications } from "./NotificationFlyouts";
import Onboarding from "./Onboarding";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO, insightsFixture } from "./scenarios";
import { sessionGate } from "./sessionGate";
import { shiftPulse } from "./shiftPulse";
import { AssigneeTags, EllipsisMenu, moveMenuFocus, SyncChip, TaskComposerModal, TaskCarryOverFlyout, TaskDetailsModal, TaskEditModal, EodComposer, TaskRemovalConfirmation } from "./taskSurfaces";
import { ChatSectionBoundary } from "./ErrorBoundary";
import { AvatarThinking, type AvatarThinkingStage } from "./AvatarThinking";
import { ChatTabs, WorkOsPromptBar, collapseConsecutiveAssistantDuplicates, workOsChatCommands } from "./WorkOsChat";
import { fileApprovedOperations, interpretationFallbackReason, isDisplayToolOp, isMutatingToolOp, mergeToolResults, normalizeInterpretation, simulateAiEod, stripBottleneckSection, toolCallKey, type PendingToolReview, type ProposedOperation, type ToolCallResult } from "./interpretation";
import { NavigateButton } from "./NavigateButton";
import { ChatMarkdown } from "./ChatMarkdown";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { TaskSelectionCard, type TaskSelectionCardTask } from "./TaskSelectionCard";
import { filterWorkspaceTasks, orderTasksByRecency, organizeTaskSections, parentTasks, safeTaskText, subtaskProgress, suggestDailyGoal, taskDateAttribution, taskKind, tasksForDate, unfinishedBefore, uniqueTasks, type TaskRow, type TaskSection } from "./taskWorkspace";
import type { DailyPlan, DailyPlanItem, DayData, DebugScenario, DesktopSession, InsightDay, InsightsData, OfflineAction, OnboardingData, OutstandingEodDay } from "./types";
import { secureState, type WorkOsConversationTurn } from "./vault";
import { TASK_OPTIONS_STALE_MS, workOsKeys } from "./queryClient";
import { fetchDay, fetchOnboarding, fetchTaskDetails, useDayQuery, useHistoricalDayQuery, useInsightsQuery, useOnboardingQuery, useOutstandingEodsQuery, useReportDayQuery, useTaskDetailsQuery, useTaskHistoryQuery, type TaskDetails, type TaskHistoryPage } from "./workOsQueries";
import wordmark from "./assets/work-os-mark.png";
import { Otto } from "./Otto";
import { EodOutstandingBell } from "./EodOutstanding";
import { DashboardSkeleton, FadeArc, InsightsSkeleton, TaskListSkeleton, Wave } from "./LoadingUi";
import { PlanningSession, type PlanningInterpretation } from "./PlanningSession";
import type { PlanAnnotation, PlanDraftEdit } from "./planningAnnotations";
import "./plan-insights.css";

type AssetSource = string | { src: string };
const assetUrl = (asset: AssetSource) => typeof asset === "string" ? asset : asset.src;

type View = "day" | "tasks" | "review" | "insights" | "evidence" | "settings";
type TaskView = "today" | "unfinished" | "completed" | "all";
type EodScreenshotContext = { processed: number; excluded: number; failed: number; observations: Array<{ capturedAt: string; summary: string; visibleApp: string | null; confidence: number }> };
type TaskAssigneeOption = { id: string; displayName: string; email: string | null };
type TaskDeletionRequest = { task: Record<string, any>; closeParent: boolean; mode: "archive" | "delete" };
type TaskEditRequest = { task: Record<string, any>; kind: "task" | "subtask" };
type ClockInConfirmation = { kind: "late" | "exception"; reason: string };
type MissedClockOutCorrection = { sessionId: string; date: string; clockedInAt: string | null };
type ProgressUpdateKind = "material_progress" | "completion_claim" | "blocked" | "priority_change" | "new_task";
type ProgressReceipt = { text: string; message: string; kind: ProgressUpdateKind; queued?: boolean };
type ProgressPanel = "update" | "goal";
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
const taskState = (task: Record<string, any>, currentDate: string) => task.completed
  ? "complete" as const
  : typeof task.due_date === "string" && task.due_date.slice(0, 10) < currentDate
    ? "overdue" as const
    : "open" as const;
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
  "task.update": "The task was updated in Nifty.",
  "task.subtask_create": "The subtask was created in Nifty.",
  "task.subtask_move": "The subtask was moved.",
  "task.archive": "The task was archived. You can restore it from Nifty.",
  "task.delete": "The task was permanently deleted.",
  "workspace.task_surface": "The task was added to today.",
  "workspace.task_defer": "The task was deferred.",
};


export default function App() {
  const notifications = useNotifications();
  const [session, setSession] = useState<DesktopSession | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [dayDetailsLoaded, setDayDetailsLoaded] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [view, setView] = useState<View>("day");
  const [input, setInput] = useState("");
  const [progressComposerOpen, setProgressComposerOpen] = useState(false);
  const [progressPanel, setProgressPanel] = useState<ProgressPanel>("update");
  const [pendingProgressUpdate, setPendingProgressUpdate] = useState("");
  const [progressReceipt, setProgressReceipt] = useState<ProgressReceipt | null>(null);
  // Full composer conversation. Persists for the app session until the user
  // explicitly clears it (trash) or starts a new chat (plus) — closing the
  // flyout intentionally keeps it.
  const [composerHistory, setComposerHistory] = useState<WorkOsConversationTurn[]>([]);
  const [loadedComposerConversation, setLoadedComposerConversation] = useState<string | null>(null);
  const composerConversationSignature = useRef("");
  const launchUpdateCheckRef = useRef(false);
  const [interpretation, setInterpretation] = useState<{ status: "loading" | "ready"; operations: ProposedOperation[]; taskOptions: Array<{ id: string; title: string }>; reply?: string; results?: ToolCallResult[] } | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState<string | null>(null);
  const [composerThinking, setComposerThinking] = useState<{ stages: AvatarThinkingStage[]; active: number; startedAt: number } | null>(null);
  const [queuedInterpretationId, setQueuedInterpretationId] = useState<string | null>(null);
  const [eodDraft, setEodDraft] = useState<{ markdown: string; source: "ai" | "deterministic" | "simulated"; screenshots?: EodScreenshotContext | null; screenshotSyncUnavailable?: boolean } | null>(null);
  const [eodRedrafting, setEodRedrafting] = useState(false);
  const [eodSubmitted, setEodSubmitted] = useState(false);
  const [eodGate, setEodGate] = useState<{ gate: string; detail: string } | null>(null);
  const [eodClockedOut, setEodClockedOut] = useState(false);
  const [eodListOpen, setEodListOpen] = useState(false);
  const [eodDate, setEodDate] = useState<string | null>(null);
  const interpretationTaskOptions = () => {
    const rows = uniqueTasks([...(visibleDay?.tasks ?? []), ...taskHistory]).filter((task) => task.completed !== true);
    // The interpreter returns Work OS local IDs. Keep that canonical identifier
    // through review and approval so completion proposals are never dropped.
    return rows.map((task) => ({ id: String(task.id), title: String(task.title ?? "Untitled task") }));
  };
  const [planIntent, setPlanIntent] = useState("");
  const [goalProvenance, setGoalProvenance] = useState<"employee" | "accepted_suggestion" | null>(null);
  const [suggestionTaskIds, setSuggestionTaskIds] = useState<string[]>([]);
  const [planItems, setPlanItems] = useState<DailyPlanItem[]>([]);
  const [planDirty, setPlanDirty] = useState(false);
  const [planSaveState, setPlanSaveState] = useState<"saved" | "saving" | "offline" | "conflict">("saved");
  const [planningSessionOpen, setPlanningSessionOpen] = useState(false);
  const [planHistoryDate, setPlanHistoryDate] = useState("");
  const [historicalPlan, setHistoricalPlan] = useState<DailyPlan | null>(null);
  const [historicalTasks, setHistoricalTasks] = useState<Array<Record<string, any>>>([]);
  const [taskView, setTaskView] = useState<TaskView>("today");
  const [carryOverOpen, setCarryOverOpen] = useState(false);
  const [insightRange, setInsightRange] = useState<"day" | "7d" | "30d">("7d");
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [report, setReport] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queueCount, setQueueCount] = useState(0);
  const [queueAttentionCount, setQueueAttentionCount] = useState(0);
  const [apiBase, setApiBase] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [vaultReady, setVaultReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [installedVersion, setInstalledVersion] = useState("Reading installed version…");
  const [connecting, setConnecting] = useState(false);
  const [taskHistory, setTaskHistory] = useState<Array<Record<string, any>>>([]);
  const [taskHistoryCursor, setTaskHistoryCursor] = useState<number | null>(null);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [pendingTasks, setPendingTasks] = useState<Array<{ id: string; title: string; description: string; assignees: string[]; status: "syncing" | "failed"; error?: string }>>([]);
  const [taskComposerTitle, setTaskComposerTitle] = useState("");
  const [taskComposerDescription, setTaskComposerDescription] = useState("");
  const [taskComposerAssignees, setTaskComposerAssignees] = useState<string[]>([]);
  const [taskAssigneeOptions, setTaskAssigneeOptions] = useState<TaskAssigneeOption[]>([]);
  const [taskOptionsLoading, setTaskOptionsLoading] = useState(false);
  const [taskDetails, setTaskDetails] = useState<TaskDetails | null>(null);
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
  const [clockInConfirmation, setClockInConfirmation] = useState<ClockInConfirmation | null>(null);
  const [clockOutConfirmation, setClockOutConfirmation] = useState(false);
  const [missedClockOut, setMissedClockOut] = useState<MissedClockOutCorrection | null>(null);
  const [missedClockOutAt, setMissedClockOutAt] = useState("");
  const [missedClockOutReason, setMissedClockOutReason] = useState("");
  const [debugScenario, setDebugScenario] = useState<DebugScenario>(() => {
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
  const planEditVersion = useRef(0);
  const shiftStartScenarioOpened = useRef(false);
  const modalOpen = taskComposerOpen || !!taskDetails || !!deleteRequest || !!editRequest || !!clockInConfirmation || !!missedClockOut || carryOverOpen || planningSessionOpen;

  const showError = useCallback((value: unknown, fallback = "Something went wrong.", title?: string) => {
    const message = errorMessage(value, fallback);
    setError(message);
    notifications.error(message, title);
    return message;
  }, [notifications]);

  const dismissTopLayer = useCallback(() => {
    if (busy) return;
    if (moveMenuId) { setMoveMenuId(null); return; }
    if (subtaskMenuId) { setSubtaskMenuId(null); return; }
    if (deleteRequest) { setDeleteRequest(null); return; }
    if (editRequest) { setEditRequest(null); return; }
    if (clockInConfirmation) { setClockInConfirmation(null); return; }
    if (missedClockOut) { setMissedClockOut(null); return; }
    if (taskDetails) { setTaskDetails(null); return; }
    if (taskComposerOpen) { setTaskComposerOpen(false); return; }
    if (planningSessionOpen) { setPlanningSessionOpen(false); return; }
    if (carryOverOpen) setCarryOverOpen(false);
  }, [busy, carryOverOpen, clockInConfirmation, deleteRequest, editRequest, missedClockOut, moveMenuId, planningSessionOpen, subtaskMenuId, taskComposerOpen, taskDetails]);

  useEffect(() => {
    if (!modalOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.classList.add("modal-open");
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
      document.body.classList.remove("modal-open");
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [dismissTopLayer, modalOpen]);

  useEffect(() => {
    if (!subtaskMenuId) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const selector = moveMenuId ? '.subtask-actions .move-target-menu [role="menuitem"]' : '.subtask-actions .subtask-menu > [role="menuitem"]';
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".subtask-actions")) { setSubtaskMenuId(null); setMoveMenuId(null); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => { window.cancelAnimationFrame(frame); document.removeEventListener("pointerdown", onPointerDown); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [moveMenuId, subtaskMenuId]);

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
    setReport(nextDay.report?.markdown ?? "");
    setDay((current) => mergeDayPayload(current, nextDay));
    const plan = nextDay.plan;
    const planKey = plan ? `${plan.id}:${plan.revision ?? 0}:${plan.status ?? ""}` : "none";
    // Never clobber in-progress local plan edits, and only re-apply the plan
    // fields when the server revision actually changed.
    if (!planDirtyRef.current && appliedPlanKeyRef.current !== planKey) {
      appliedPlanKeyRef.current = planKey;
      setPlanIntent(plan?.freeform_intent ?? "");
      setGoalProvenance(plan?.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : plan?.freeform_intent ? "employee" : null);
      setSuggestionTaskIds(plan?.suggestion_task_ids ?? []);
      setPlanItems([...(plan?.items ?? [])].sort((a, b) => a.rank - b.rank));
      setPlanDirty(false); setPlanSaveState("saved");
    }
    setPlanHistoryDate((current) => current || nextDay.shiftDate);
  }, []);

  useEffect(() => { planDirtyRef.current = planDirty; }, [planDirty]);

  const queryClient = useQueryClient();
  const invalidateDayData = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") });
    void queryClient.invalidateQueries({ queryKey: workOsKeys.day("details") });
    void queryClient.invalidateQueries({ queryKey: ["work-os", "insights"] });
  }, [queryClient]);
  const invalidateOutstandingEods = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: workOsKeys.outstandingEods() });
  }, [queryClient]);

  const taskRowId = (task: Record<string, any>) => String(task.provider_task_id || task.id);
  const patchTaskRow = (task: Record<string, any>, rowId: string, patch: Record<string, any>) =>
    taskRowId(task) === rowId ? { ...task, ...patch } : task;

  /** Surgical cache updates: a task write patches exactly the cached rows it
   * touched instead of invalidating every list and refetching the page. */
  const patchTaskCaches = useCallback((rowId: string, patch: Record<string, any>) => {
    queryClient.setQueryData<InfiniteData<TaskHistoryPage>>(workOsKeys.taskHistory(), (current) => current ? {
      ...current,
      pages: current.pages.map((page) => ({ ...page, tasks: page.tasks.map((task) => patchTaskRow(task, rowId, patch)) })),
    } : current);
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.map((task) => patchTaskRow(task, rowId, patch)),
      } : current);
    }
  }, [queryClient]);

  const removeTaskFromCaches = useCallback((rowId: string) => {
    queryClient.setQueryData<InfiniteData<TaskHistoryPage>>(workOsKeys.taskHistory(), (current) => current ? {
      ...current,
      pages: current.pages.map((page) => ({ ...page, tasks: page.tasks.filter((task) => taskRowId(task) !== rowId) })),
    } : current);
    for (const variant of ["compact", "details"] as const) {
      queryClient.setQueryData<DayData>(workOsKeys.day(variant), (current) => current ? {
        ...current,
        tasks: current.tasks.filter((task) => taskRowId(task) !== rowId),
      } : current);
    }
  }, [queryClient]);

  const insertTaskIntoCaches = useCallback((task: Record<string, any>) => {
    queryClient.setQueryData<InfiniteData<TaskHistoryPage>>(workOsKeys.taskHistory(), (current) => {
      if (!current || !current.pages.length) return current;
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
  }, [queryClient]);
  const signedIn = !!session;
  const detailsViews = view === "tasks" || view === "review" || view === "evidence";

  // Reads are cached with TTLs and de-duplicated by react-query. The compact
  // snapshot refreshes every minute in the background; heavy details load only
  // when a workspace that needs them opens.
  const compactDayQuery = useDayQuery({ enabled: signedIn && !syncBypass, variant: "compact", pollMs: 60_000 });
  const detailsDayQuery = useDayQuery({ enabled: signedIn && !syncBypass && detailsViews, variant: "details" });
  const onboardingQuery = useOnboardingQuery({ enabled: signedIn && !syncBypass });
  const historyQuery = useTaskHistoryQuery({ enabled: signedIn && !syncBypass });
  const insightsQuery = useInsightsQuery({ enabled: signedIn && !syncBypass && !debugScenario.enabled && view === "insights", range: insightRange, through: day?.shiftDate ?? "" });
  const historicalQuery = useHistoricalDayQuery({ date: planHistoryDate, currentDate: day?.shiftDate ?? "" });
  const outstandingQuery = useOutstandingEodsQuery({ enabled: signedIn && !syncBypass });
  const reportDayQuery = useReportDayQuery({ date: eodDate, currentDate: day?.shiftDate ?? "" });

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
    const rows = historyQuery.data.pages.flatMap((page) => page.tasks);
    setTaskHistory(rows);
    setTaskHistoryCursor(historyQuery.hasNextPage ? rows.length : null);
  }, [historyQuery.data, historyQuery.hasNextPage]);
  useEffect(() => { setTaskHistoryLoading(historyQuery.isFetching && historyQuery.data !== undefined); }, [historyQuery.isFetching, historyQuery.data]);
  useEffect(() => {
    if (historyQuery.error) showError(historyQuery.error, "Task history could not be loaded.", "Tasks unavailable");
  }, [historyQuery.error, showError]);
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
    setEodDraft(null); setEodSubmitted(false); setEodGate(null); setEodRedrafting(false); setEodClockedOut(false);
  }, [eodDate]);
  useEffect(() => {
    if (historicalQuery.error) showError(historicalQuery.error, "Daily workspace history could not be loaded.", "History unavailable");
  }, [historicalQuery.error, showError]);

  const refreshInternal = useCallback(async (options: { refreshProviders?: boolean; refreshAttendance?: boolean; dayOnly?: boolean; details?: boolean } = {}) => {
    if (syncBypassRef.current) return null;
    const variant = options.details ? "details" : "compact";
    const [onboardingResult, dayResult] = await Promise.allSettled([
      options.dayOnly
        ? Promise.resolve(null)
        : queryClient.fetchQuery({ queryKey: workOsKeys.onboarding(), queryFn: fetchOnboarding, staleTime: 0 }),
      queryClient.fetchQuery({
        queryKey: workOsKeys.day(variant),
        queryFn: () => fetchDay({ variant, refreshProviders: options.refreshProviders, refreshAttendance: options.refreshAttendance }),
        staleTime: 0,
      }),
    ]);
    if (onboardingResult.status === "rejected") throw onboardingResult.reason;
    if (dayResult.status === "rejected") {
      const rawMessage = errorMessage(dayResult.reason, "Your profile loaded, but the workday could not be refreshed.");
      const message = /timed out|abort/i.test(rawMessage)
        ? "The provider sync is taking longer than usual. Give it a moment and retry — nothing was lost."
        : rawMessage;
      diagnostics.warn("bootstrap.day.degraded", message);
      showError(message, message, "Workday refresh failed");
      return null;
    }
    const nextDay = dayResult.value;
    applyDayPayload(nextDay);
    if (options.details) setDayDetailsLoaded(true);
    return nextDay;
  }, [applyDayPayload, queryClient, showError]);

  const refresh = useCallback(async (options: { refreshProviders?: boolean; refreshAttendance?: boolean; dayOnly?: boolean; details?: boolean } = {}) => {
    setRefreshing(true);
    try { return await refreshInternal(options); } finally { setRefreshing(false); }
  }, [refreshInternal]);

  const reloadOpenTaskDetails = useCallback(async () => {
    const openTask = taskDetails?.task as Record<string, unknown> | undefined;
    const taskId = openTask ? String(openTask.provider_task_id || openTask.id || "") : "";
    if (!taskId) return;
    const details = await loadTaskDetails(taskId);
    setTaskDetails({ ...details, task: details.task ?? openTask, subtasks: Array.isArray(details.subtasks) ? details.subtasks : [], moveTargets: Array.isArray(details.moveTargets) ? details.moveTargets : [] });
  }, [taskDetails]);

  /** The masthead refresh revalidates the page the employee is looking at —
   * never a blanket app refresh. The Day view also asks the provider to sync. */
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
          const work: Promise<unknown>[] = [refresh({ dayOnly: true, details: true }), historyQuery.refetch()];
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
          await Promise.allSettled([queryClient.fetchQuery({ queryKey: workOsKeys.onboarding(), queryFn: fetchOnboarding, staleTime: 0 })]);
          return;
      }
    } finally {
      setRefreshing(false);
    }
  }, [debugScenario.enabled, eodDate, historicalQuery, historyQuery, insightRange, insightsQuery, outstandingQuery, planHistoryDate, queryClient, refresh, reloadOpenTaskDetails, reportDayQuery, setInsights, taskDetails, view, visibleDay]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void Promise.all([secureState.session(), secureState.queue(), secureState.settings(), secureState.daySnapshot(), isTauri() ? isEnabled() : Promise.resolve(false)]).then(([saved, queue, settings, snapshot, enabled]) => {
      const current = saved?.apiBase ? saved : null; setSession(current); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length); setApiBase(settings.apiBase); setAutoStart(enabled); setAutoCheckUpdates(settings.autoCheckUpdates);
      if (snapshot && snapshot.access?.organizationId === current?.organizationId) {
        // Seed the cache with the last workday snapshot for an instant first
        // paint; the live query revalidates it in the background.
        queryClient.setQueryData(workOsKeys.day("compact"), snapshot);
        setPlanHistoryDate(snapshot.shiftDate);
      }
      if (current) void refresh({ refreshAttendance: true }).catch((value) => showError(value, "Could not load your workday.", "Workday unavailable"));
      if (!launchUpdateCheckRef.current && shouldAutoCheckUpdate({ supported: isTauri(), debugEnabled: debugRef.current.enabled, hasSession: !!current, autoCheckUpdates: settings.autoCheckUpdates })) {
        launchUpdateCheckRef.current = true;
        void checkForUpdates({ silent: true });
      }
    }).catch((value) => showError(value, "Could not open the local vault.", "Local workspace unavailable")).finally(() => setVaultReady(true));
    void listenForAuthentication((saved) => { setSession(saved); notifications.success("This device is connected to your workspace.", "Workspace connected"); void emit("work-os://main-session-changed"); void refresh({ refreshAttendance: true }); }, (value) => showError(value, "Desktop authorization failed.", "Authorization failed")).then((fn) => { cleanup = fn; }).catch((value) => showError(value, "Could not listen for desktop sign-in.", "Sign-in listener failed"));
    return () => cleanup?.();
  }, [notifications, refresh, showError]);

  useEffect(() => {
    if (!isTauri()) {
      setInstalledVersion("Unavailable in browser preview");
      return;
    }
    void getVersion().then(setInstalledVersion).catch(() => setInstalledVersion("Unavailable"));
  }, []);

  useEffect(() => {
    if (!session) return;
    const recover = async () => { if (syncBypassRef.current || !navigator.onLine) return; const result = await flushQueue(); setQueueCount(result.remaining); setQueueAttentionCount(result.needsAttention); };
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
    void listen("work-os://avatar-day-changed", () => { void refresh({ dayOnly: true }).catch(() => undefined); }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [refresh]);

  // EOD clicks can originate in the floating avatar or a Windows toast. Both
  // routes land on the same review workspace, then refresh its current record.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://avatar-open-eod", () => {
      setView("review");
      void refresh({ dayOnly: true }).catch(() => undefined);
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [refresh]);

  // Assistant navigation shortcuts from the floating avatar land on the
  // requested destination. The page name is validated before it can move.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<{ view?: unknown }>("work-os://avatar-navigate", (event) => {
      const view = event.payload?.view;
      if (view === "day" || view === "tasks" || view === "review" || view === "insights" || view === "evidence" || view === "settings") {
        setView(view);
        void refresh({ dayOnly: true }).catch(() => undefined);
      }
    }).then((fn) => { unlisten = fn; }).catch(() => undefined);
    return () => unlisten?.();
  }, [refresh]);

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

  const redraftEod = async (target: DayData | null) => {
    if (!target?.report) return;
    if (syncBypassRef.current) {
      setEodDraft({ markdown: simulateAiEod({ tasks: target.tasks, plan: target.plan, shiftDate: target.shiftDate }), source: "simulated" });
      notifications.success("Simulated an assistant draft on-device — nothing reached the server.", "AI draft (playground)");
      return;
    }
    setEodRedrafting(true);
    try {
      const result = await apiRequest<{ markdown: string; model: string; clockedOut?: boolean; screenshots?: EodScreenshotContext; screenshotSyncUnavailable?: boolean }>("/api/work-os/me/eod/ai-draft", {
        method: "POST", signal: AbortSignal.timeout(60_000), body: JSON.stringify({ date: target.shiftDate }),
      });
      setEodGate(null);
      setEodClockedOut(result.clockedOut === true);
      setEodDraft({ markdown: result.markdown, source: "ai", screenshots: result.screenshots ?? null, screenshotSyncUnavailable: result.screenshotSyncUnavailable === true });
      notifications.success(result.clockedOut ? "You were clocked out automatically and the assistant drafted your EOD. Review every line." : "The assistant drafted your EOD from the recorded work. Review every line.", "AI draft ready");
    } catch (value) {
      if (value instanceof ApiRequestError && (value as { status?: number | null }).status === 409) {
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
      const result = await apiRequest<{ markdown: string }>('/api/work-os/me/eod/ai-draft', {
        method: "POST", body: JSON.stringify({ date: target.shiftDate, draft: stripBottleneckSection(markdown), feedback, annotations }),
      });
      setEodDraft((current) => current ? { ...current, markdown: result.markdown, source: "ai" } : { markdown: result.markdown, source: "ai" });
      notifications.success("The draft was refined from your feedback. Your bottleneck answer was not changed.", "Draft refined");
      return true;
    } catch (value) {
      showError(value, "Your feedback was not applied. Your draft and bottleneck answer are unchanged.", "Draft refinement failed");
      return false;
    } finally { setEodRedrafting(false); }
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
      const result = await apiRequest<{ report: NonNullable<DayData["report"]> }>("/api/work-os/reports/eod", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ date: target.shiftDate }),
      });
      applyReportToDay(eodDate, result.report);
      setEodDraft({ markdown: String(result.report.markdown ?? ""), source: "deterministic" });
      setEodGate(null);
      invalidateOutstandingEods();
      notifications.success("Your EOD draft is ready for review. Nothing has been submitted.", "EOD draft ready");
    } catch (value) {
      showError(value, "Your EOD draft could not be created.", "EOD draft failed");
    } finally { setEodRedrafting(false); }
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
      await sendOrQueue(`/api/work-os/reports/${encodeURIComponent(reportId)}/submit`, "PATCH", { markdown, submission_idempotency_key: idempotencyKey });
      finish();
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
        setPlanSaveState(/changed on another device/i.test(message) ? "conflict" : "offline");
        showError(message, message, "Goal not saved");
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [day?.plan?.id, day?.plan?.revision, day?.plan?.status, day?.shiftDate, goalProvenance, notifications, planDirty, planIntent, showError, suggestionTaskIds]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlistenScenario: (() => void) | undefined;
    let unlistenRequest: (() => void) | undefined;
    void listen<DebugScenario>("work-os://debug-scenario", (event) => {
      debugRef.current = event.payload;
      setDebugScenario(event.payload);
    }).then((fn) => { unlistenScenario = fn; }).catch(() => undefined);
    void listen("work-os://debug-request", () => {
      void emit("work-os://debug-current", debugRef.current);
    }).then((fn) => { unlistenRequest = fn; }).catch(() => undefined);
    return () => { unlistenScenario?.(); unlistenRequest?.(); };
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
      await action();
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
      notifications.success(actionSuccessMessages[label] ?? "The change was saved.");
    }
    catch (value) {
      const message = value instanceof Error ? value.message : "Action failed";
      if (label === "shift.clock_in" && /workday is already closed/i.test(message)) {
        try {
          const nextDay = await refresh({ dayOnly: true, refreshProviders: true });
          if (nextDay && sessionGate(nextDay).worktivitySynced) {
            diagnostics.info("ui.action.recovered", "Fresh Worktivity activity replaced a stale closed-workday view.", { action: label, activeView: view });
            notifications.info("Worktivity activity is active. Retrying your clock-in.", "Activity synchronized");
            await sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop" });
            const queuedAfter = await secureState.queue();
            setQueueCount(queuedAfter.length);
            setQueueAttentionCount(queuedAfter.filter((item) => item.status === "needs_attention").length);
            await refresh();
            notifications.success(actionSuccessMessages["shift.clock_in"]);
            return;
          }
        } catch {
          // Preserve the original conflict when the provider refresh also fails.
        }
      }
      diagnostics.error("ui.action.failed", message, { action: label, activeView: view });
      showError(message, message);
    }
    finally { setBusy(false); }
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

  async function installAvailableUpdate(update: Update, headers: Record<string, string>) {
    setUpdateStatus(`Installing ${update.version}…`);
    await update.downloadAndInstall(undefined, { headers });
    await relaunch();
  }

  async function checkForUpdates({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setUpdateStatus("Checking securely…");
    try {
      const saved = await secureState.session();
      if (!saved) {
        if (!silent) {
          setUpdateStatus("");
          notifications.info("Sign in first, then check for updates.", "Not signed in");
        }
        return;
      }
      const result = await queryAvailableUpdate(saved);
      if (result.status === "managed") {
        if (!silent) {
          setUpdateStatus("");
          notifications.info("Updates are managed by your WrazyOS server.", "Managed update channel");
        }
        return;
      }
      if (result.status === "current") {
        if (!silent) {
          setUpdateStatus("");
          notifications.success("You already have the latest internal build.", "Work OS is up to date");
        }
        return;
      }
      if (silent) {
        const copy = updateAvailableCopy(result.update.version);
        setUpdateStatus(`Version ${result.update.version} is ready.`);
        notifications.persistent(UPDATE_AVAILABLE_KEY, copy.message, copy.title, "info", {
          label: copy.actionLabel,
          onClick: () => {
            notifications.clearPersistent(UPDATE_AVAILABLE_KEY);
            void installAvailableUpdate(result.update, result.headers).catch((value: unknown) => {
              const message = errorMessage(value, "The update could not be installed.");
              diagnostics.warn("updater.install_failed", message);
              setUpdateStatus("");
              showError(message, message, "Update failed");
            });
          },
        });
        return;
      }
      setUpdateStatus(`Installing ${result.update.version}…`);
      notifications.info(`Downloading and installing ${result.update.version}.`, "Update available");
      await installAvailableUpdate(result.update, result.headers);
    } catch (value) {
      const message = errorMessage(value, "The update catalog could not be checked.");
      diagnostics.warn("updater.check_failed", message);
      setUpdateStatus("");
      if (!silent) showError(message, message, "Update failed");
    }
  }

  async function toggleAutoCheckUpdates(enabled: boolean) {
    const previous = autoCheckUpdates;
    setAutoCheckUpdates(enabled);
    try {
      await secureState.saveSettings({ apiBase, autoCheckUpdates: enabled });
      notifications.success(enabled ? "Work OS will check for updates on launch." : "Work OS will no longer check for updates on launch.", "Update setting saved");
    } catch (value) {
      setAutoCheckUpdates(previous);
      showError(errorMessage(value, "The update setting could not be saved."), "The update setting could not be saved.", "Setting not saved");
    }
  }

  async function logout() {
    setBusy(true); setError("");
    try {
      if (session && !debugRef.current.enabled) await apiRequest("/api/work-os/desktop/session", { method: "DELETE" });
    } catch {
      // Local sign-out must still succeed if the server is unavailable.
    } finally {
      await secureState.clearAccount();
      queryClient.clear();
      setSession(null); setDay(null); setOnboarding(null); setQueueCount(0); setQueueAttentionCount(0); setView("day");
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

  const visibleOnboarding = useMemo(() => applyOnboardingScenario(onboarding, debugScenario), [onboarding, debugScenario]);

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
    || (viewingHistorical
      ? historicalQuery.isPending && !historicalQuery.data
      : taskView !== "today" && historyQuery.isPending && !historyQuery.data);

  useEffect(() => {
    // Scenario/offline insights are computed on-device; live insights come
    // from the cached query above.
    if ((syncBypassRef.current || debugRef.current.enabled) && view === "insights" && visibleDay) {
      setInsights(insightsFixture(visibleDay, insightRange));
      setInsightsLoading(false);
    }
  }, [view, insightRange, visibleDay]);

  const visibleSession = debugScenario.enabled
    ? debugScenario.authState === "unauthenticated" ? null : session ?? { token: "debug-local", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), organizationId: "debug", apiBase: "Local scenario" }
    : session;
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
      setInterpretation({ status: "ready", operations: review.operations, taskOptions: interpretationTaskOptions() });
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
        setComposerHistory((history) => [...history, { id: crypto.randomUUID(), role: "assistant", text: shared.reply || "Tool calls shared from the companion.", meta: "shared review", createdAt: new Date().toISOString() }]);
        if (typeof document !== "undefined" && document.hasFocus()) setProgressComposerOpen(true);
        else notifications.info("Tool calls shared from the companion.", "Review shared tools");
        return { status: "ready", operations: shared.operations, taskOptions: shared.taskOptions, reply: shared.reply, results: shared.results.length ? shared.results : undefined };
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
      setPlanIntent(visibleDay.plan.freeform_intent ?? "");
      setGoalProvenance(visibleDay.plan.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : visibleDay.plan.freeform_intent ? "employee" : null);
      setSuggestionTaskIds(visibleDay.plan.suggestion_task_ids ?? []);
      setPlanItems([...visibleDay.plan.items].sort((a, b) => a.rank - b.rank));
    }
  }, [debugScenario.enabled, visibleDay?.plan]);
  const workSession = visibleDay?.session;
  const gate = sessionGate(visibleDay);
  const active = gate.active;
  const sessionActive = !!workSession && ["clocked_in", "active", "paused", "eod_due"].includes(workSession.state);
  const observedOnly = gate.worktivitySynced && !sessionActive;
  const paused = sessionActive ? workSession?.state === "paused" : observedOnly && visibleDay?.attendance?.state === "paused";
  const hasVisibleSession = Boolean(visibleSession);
  useEffect(() => {
    if (!hasVisibleSession || visibleOnboarding?.onboardingRequired || !gate.persistentMessage) return;
    notifications.persistent("work-os-session-gate", gate.persistentMessage, gate.persistentTitle, "info");
  }, [gate.persistentMessage, gate.persistentTitle, hasVisibleSession, notifications, visibleOnboarding?.onboardingRequired]);
  const todayParentTasks = parentTasks(visibleDay?.tasks ?? []);
  const openTasks = todayParentTasks.filter((task) => !task.completed);
  const allTodayTasksCompleted = todayParentTasks.length > 0 && openTasks.length === 0;
  const reviewDay = eodDate ? reportDayQuery.data ?? null : visibleDay;
  const reviewParentTasks = parentTasks(reviewDay?.tasks ?? []);
  const allReviewTasksCompleted = eodDate
    ? reviewParentTasks.length > 0 && reviewParentTasks.every((task) => task.completed === true)
    : allTodayTasksCompleted;
  const goalSuggestion = useMemo(() => suggestDailyGoal(parentTasks(visibleDay?.tasks ?? []), visibleDay?.shiftDate ?? "", planItems), [visibleDay?.tasks, visibleDay?.shiftDate, planItems]);
  const unfinishedCarryOver = useMemo(() => visibleDay?.workspaceSummary?.carryOverGroups
    ? visibleDay.workspaceSummary.carryOverGroups.flatMap((group) => group.tasks.map((task) => ({ task, attribution: { date: task.due_date ?? null, reason: "carried" as const } })))
    : unfinishedBefore(parentTasks(taskHistory), visibleDay?.shiftDate ?? ""), [taskHistory, visibleDay?.shiftDate, visibleDay?.workspaceSummary]);
  const yesterdayDate = moveDate(visibleDay?.shiftDate ?? "", -1);
  const yesterdayDueTasks = unfinishedCarryOver.filter(({ task }) => !task.completed && task.due_date?.slice(0, 10) === yesterdayDate);
  const recencyOrder = (task: TaskRow) => {
    const value = task.updated_at ?? task.provider_updated_at ?? task.provider_created_at ?? task.created_at ?? "";
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? -parsed : 0;
  };
  const todayCompletedCount = todayParentTasks.filter((task) => task.completed === true).length;
  // Optimistic adds render instantly as rows with a sync state and retry.
  const pendingTaskRows = useMemo<TaskRow[]>(() => pendingTasks.map((pending) => ({
    id: pending.id,
    title: pending.title,
    description: pending.description,
    completed: false,
    due_date: visibleDay?.shiftDate ?? undefined,
    pending_status: pending.status,
    pending_error: pending.error,
  })), [pendingTasks, visibleDay?.shiftDate]);
  const sortedDashboardTasks = [...openTasks]
    .sort((left, right) => {
      const leftDue = typeof left.due_date === "string" ? left.due_date.slice(0, 10) : null;
      const rightDue = typeof right.due_date === "string" ? right.due_date.slice(0, 10) : null;
      if (leftDue && rightDue && leftDue !== rightDue) return leftDue.localeCompare(rightDue);
      if (leftDue && !rightDue) return -1;
      if (!leftDue && rightDue) return 1;
      return recencyOrder(left) - recencyOrder(right);
    })
    .slice(0, 3);
  const dashboardTopTasks = [...pendingTaskRows, ...sortedDashboardTasks].slice(0, 3);
  const pulse = shiftPulse(workSession, visibleDay?.shift ?? null, pulseNow, visibleDay?.breakPolicy?.worktivityAuthoritative === true, visibleDay?.attendance);
  const extendedClockOut = !!visibleDay?.shift?.endsAt && pulseNow.getTime() > Date.parse(visibleDay.shift.endsAt) + 15 * 60_000;

  useEffect(() => {
    if (active && (debugScenario.planningState === "required" || visibleDay?.prompt.kind === "plan" && visibleDay.prompt.required && visibleDay.plan?.status !== "confirmed")) {
      setPlanningSessionOpen(true);
    }
    // Debugger-only: choosing the Shift start scenario opens the Plan modal directly
    // so the plan/build/refine flow can be exercised from fixtures. Production behavior
    // is unchanged (debugScenario.enabled is only true from the debugger window).
    if (debugScenario.enabled && debugScenario.dayState === "shift_start" && !shiftStartScenarioOpened.current) {
      shiftStartScenarioOpened.current = true;
      setPlanningSessionOpen(true);
    }
    if (!debugScenario.enabled || debugScenario.dayState !== "shift_start") shiftStartScenarioOpened.current = false;
  }, [active, debugScenario.planningState, debugScenario.enabled, debugScenario.dayState, visibleDay?.plan?.status, visibleDay?.prompt.kind, visibleDay?.prompt.required]);

  function editPlan(mutator: () => void) {
    planEditVersion.current += 1;
    mutator();
    setPlanDirty(true);
  }

  async function interpretPlanning(input: string): Promise<PlanningInterpretation> {
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
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ input, date: visibleDay.shiftDate, conversation: composerHistory.slice(-8).map((turn) => ({ role: turn.role, text: turn.text })) }),
    });
    return { ...result.interpretation, buildId: result.build_id };
  }

  async function refinePlanning(input: string, draft: PlanningInterpretation, annotations: PlanAnnotation[], edits: PlanDraftEdit[]): Promise<PlanningInterpretation> {
    if (!visibleDay) throw new Error("Your workday is still loading.");
    if (debugScenario.enabled && debugScenario.planningState === "ai_unavailable") throw new Error("Planning assistance is unavailable in this scenario.");
    if (syncBypassRef.current) {
      // Offline fixture stub: apply the employee edits locally so the refine loop
      // (annotate → refine → review → confirm) is fully exercisable without a backend.
      return {
        ...draft,
        buildId: "debug-ai-build",
        rawIntent: input,
        commitments: draft.commitments.map((commitment) => {
          const edit = edits.find((entry) => entry.clientId === commitment.clientId);
          return edit ? { ...commitment, title: edit.title ?? commitment.title, objective: edit.objective ?? commitment.objective, successCriteria: edit.successCriteria ?? commitment.successCriteria } : commitment;
        }),
      };
    }
    const result = await apiRequest<{ interpretation: PlanningInterpretation; build_id: string }>("/api/work-os/me/plan/refine", {
      method: "POST",
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        input,
        date: visibleDay.shiftDate,
        draft: { summary: draft.summary, commitments: draft.commitments.map((commitment) => ({ clientId: commitment.clientId, title: commitment.title, objective: commitment.objective, successCriteria: commitment.successCriteria })) },
        annotations: annotations.map((annotation) => ({ target: annotation.target, quote: annotation.quote, comment: annotation.comment })),
        edits,
      }),
    });
    return { ...result.interpretation, buildId: result.build_id };
  }

  async function confirmPlanning(input: string, interpretation: PlanningInterpretation | null, clarificationAnswers: Record<string, string>): Promise<"confirmed" | "saved" | "queued" | "conflict" | "failed"> {
    if (syncBypassRef.current) {
      // Offline fixtures stay on-device. Debugger fixtures without a server plan
      // (e.g. Shift start) simply resolve — the modal owns its confirmed state.
      if (visibleDay?.plan) {
        const nextPlan = { ...visibleDay.plan, status: active ? "confirmed" as const : "draft" as const, freeform_intent: input, focus_summary: interpretation?.summary ?? null };
        setDay((current) => current ? { ...current, plan: nextPlan } : current);
        setPlanIntent(input);
        setPlanItems(nextPlan.items);
      }
      return active ? "confirmed" : "saved";
    }
    if (!visibleDay?.plan) return "conflict";
    if (debugScenario.enabled && debugScenario.planningState === "conflict") return "conflict";
    if (debugScenario.enabled && debugScenario.planningState === "offline") return "queued";
    setBusy(true);
    try {
      const commitmentByTask = new Map((interpretation?.commitments ?? []).filter((item) => item.linkedTaskId).map((item) => [item.linkedTaskId!, item]));
      const clarificationState = (commitment: PlanningInterpretation["commitments"][number]) => {
        const questions = interpretation?.clarifications.filter((question) => question.commitmentId === commitment.clientId) ?? [];
        return questions.length ? questions.every((question) => clarificationAnswers[question.id]?.trim()) ? "resolved" : "needs_clarification" : "none";
      };
      const items: Array<Record<string, unknown>> = planItems.map((item) => {
        const commitment = item.task_id ? commitmentByTask.get(item.task_id) : undefined;
        return {
          id: item.id, task_id: item.task_id, title_snapshot: item.title_snapshot, disposition: item.disposition,
          item_kind: item.item_kind, completion_state: item.completion_state,
          ...(commitment ? { objective: commitment.objective, success_criteria: commitment.successCriteria, estimate_minutes: commitment.estimatedMinutes, source_refs: commitment.sourceRefs, clarification_state: clarificationState(commitment) } : {}),
        };
      });
      for (const commitment of interpretation?.commitments ?? []) {
        if (commitment.linkedTaskId) continue;
        items.push({ title_snapshot: commitment.title, disposition: "selected", item_kind: "outcome", completion_state: "open", objective: commitment.objective, success_criteria: commitment.successCriteria, estimate_minutes: commitment.estimatedMinutes, source_refs: commitment.sourceRefs, clarification_state: clarificationState(commitment) });
      }
      const saved = await sendOrQueue("/api/work-os/me/plan", "PUT", {
        shift_date: visibleDay.shiftDate,
        revision: visibleDay.plan.revision,
        confirm: active,
        ...(active && interpretation?.buildId ? { build_id: interpretation.buildId } : {}),
        freeform_intent: input,
        goal_provenance: "employee",
        focus_summary: interpretation?.summary,
        interpretation_metadata: interpretation ? { model: "work-os-plan", promptVersion: "work-os-plan-v1", interpretedAt: new Date().toISOString(), clarificationCount: interpretation.clarifications.length, sourceContext: ["tasks", "carry_over", "previous_plan", "blockers", "recent_updates"], clarifications: interpretation.clarifications } : undefined,
        ...(interpretation ? { clarification_answers: clarificationAnswers } : {}),
        items,
      }) as DailyPlan & { queued?: boolean };
      if (saved.queued) {
        setPlanSaveState("offline");
        return "queued";
      }
      if (!active) {
        setDay((current) => current ? { ...current, plan: saved } : current);
        setPlanIntent(input);
        setPlanItems(saved.items);
        return "saved";
      }
      setDay((current) => current ? { ...current, plan: saved } : current);
      setPlanIntent(input);
      setPlanItems(saved.items);
      setPlanSaveState("saved");
      void emit("work-os://main-day-changed");
      return "confirmed";
    } catch (value) {
      const message = errorMessage(value, "Your plan could not be saved.");
      setPlanSaveState(/changed on another device/i.test(message) ? "conflict" : "offline");
      return /changed on another device/i.test(message) ? "conflict" : "failed";
    } finally {
      setBusy(false);
    }
  }

  function openPlanningSession() { setPlanningSessionOpen(true); }

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

  async function loadMoreTasks() {
    if (syncBypassRef.current || !historyQuery.hasNextPage || historyQuery.isFetchingNextPage) return;
    try {
      await historyQuery.fetchNextPage();
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
      setTaskDetailsLoading(false);
      return;
    }
    setTaskDetailsLoading(!cached);
    try {
      const details = await loadTaskDetails(taskId);
      setTaskDetails({ ...details, task: details.task ?? task, subtasks: Array.isArray(details.subtasks) ? details.subtasks : [], moveTargets: Array.isArray(details.moveTargets) ? details.moveTargets : [] });
      if (details.subtaskSync?.error) notifications.error("Couldn’t refresh subtasks from Nifty. Showing the last mirrored records.", "Subtasks may be stale");
    }
    catch (value) { setTaskDetails(null); showError(value, "Could not open this task.", "Task unavailable"); }
    finally { setTaskDetailsLoading(false); }
  }

  /** Sends one optimistic task; resolves on success and rejects on failure. */
  async function sendPendingTask(pending: { id: string; title: string; description: string; assignees: string[] }) {
    const result = await apiRequest<{ task: Record<string, any>; providerStatus: string; mirrorStatus: string }>("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: pending.title, description: pending.description || undefined, assignee_person_ids: pending.assignees }) });
    if (result.task) insertTaskIntoCaches(result.task);
    setPendingTasks((current) => current.filter((item) => item.id !== pending.id));
    if (result.providerStatus !== "nifty_confirmed") notifications.info(`Task submitted · ${result.mirrorStatus}`, "Provider confirmation pending");
  }

  function failPendingTask(id: string, value: unknown) {
    const message = errorMessage(value, "The task could not be added.");
    diagnostics.warn("task.create.failed", "Optimistic task add failed", { id, message });
    setPendingTasks((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error: message } : item));
  }

  function submitTaskFromDesktop() {
    const title = taskComposerTitle.trim();
    if (!title) return;
    const description = taskComposerDescription.trim();
    const assignees = taskComposerAssignees;
    setTaskComposerTitle(""); setTaskComposerDescription(""); setTaskComposerAssignees([]);
    setTaskComposerOpen(false);
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
    void sendPendingTask(pending).catch((value) => failPendingTask(pending.id, value));
  }

  function retryPendingTask(task: TaskRow) {
    const pending = pendingTasks.find((item) => item.id === String(task.id));
    if (!pending || pending.status === "syncing") return;
    const next = { ...pending, status: "syncing" as const, error: undefined };
    setPendingTasks((current) => current.map((item) => item.id === pending.id ? next : item));
    void sendPendingTask(next).catch((value) => failPendingTask(pending.id, value));
  }

  function dismissPendingTask(task: TaskRow) {
    setPendingTasks((current) => current.filter((item) => item.id !== String(task.id)));
  }

  function surfaceTask(task: TaskRow, disposition: "selected" | "deferred" = "selected") {
    if (syncBypassRef.current) { bypassAct(disposition === "selected" ? "workspace.task_surface" : "workspace.task_defer"); return; }
    void act(disposition === "selected" ? "workspace.task_surface" : "workspace.task_defer", () => sendOrQueue("/api/work-os/me/plan", "PATCH", {
      [disposition === "selected" ? "surface_task_id" : "defer_task_id"]: task.id,
    }));
  }

  function setTaskCompletion(task: TaskRow, completed: boolean, refreshDetails = false) {
    const taskId = String(task.provider_task_id || task.id);
    if (syncBypassRef.current) {
      setDay((current) => ({ ...current ?? (applyDayScenario(null, debugScenario) as DayData), tasks: current?.tasks?.map((row) => String(row.provider_task_id || row.id) === taskId ? { ...row, completed } : row) ?? [] }));
      if (refreshDetails && taskDetails) {
        setTaskDetails((current) => current ? {
          ...current,
          task: String(current.task.provider_task_id || current.task.id) === taskId ? { ...current.task, completed } : current.task,
          subtasks: current.subtasks.map((row) => String(row.provider_task_id || row.id) === taskId ? { ...row, completed } : row),
        } : current);
      }
      notifications.success(actionSuccessMessages[completed ? "task.complete" : "task.reopen"]);
      return;
    }
    void act(completed ? "task.complete" : "task.reopen", async () => {
      await updateTaskCompletion(taskId, completed);
      patchTaskCaches(taskId, { completed, status: completed ? "completed" : "open" });
      if (refreshDetails && taskDetails) {
        const parentId = String(taskDetails.task.provider_task_id || taskDetails.task.id);
        setTaskDetails(await loadTaskDetails(parentId));
      }
    });
  }

  function editTask(task: TaskRow) {
    setEditRequest({ task, kind: taskKind(task) });
    setEditTitle(String(task.title ?? ""));
    setEditDescription(String(task.description ?? ""));
    setSubtaskMenuId(null);
  }

  function submitTaskEdit() {
    if (!editRequest || !editTitle.trim()) return;
    if (syncBypassRef.current) {
      const taskId = String(editRequest.task.provider_task_id || editRequest.task.id);
      const patch = (row: Record<string, any>) => String(row.provider_task_id || row.id) === taskId ? { ...row, title: editTitle.trim(), description: editDescription } : row;
      setDay((current) => current ? { ...current, tasks: current.tasks.map((row) => patch(row as Record<string, any>)) } : current);
      setTaskDetails((current) => current ? { ...current, task: patch(current.task), subtasks: current.subtasks.map(patch) } : current);
      setEditRequest(null);
      notifications.success(actionSuccessMessages["task.update"]);
      return;
    }
    const taskId = String(editRequest.task.provider_task_id || editRequest.task.id);
    void act("task.update", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ name: editTitle.trim(), description: editDescription }) });
      patchTaskCaches(taskId, { title: editTitle.trim(), description: editDescription });
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

  async function connectWorkspace() {
    setConnecting(true); setError("");
    try {
      await beginAuthentication(apiBase);
      notifications.info("Sign in to WrazyOS if asked, then authorize this device.", "Browser opened");
    } catch (value) {
      showError(value, "Could not open workspace sign-in.", "Sign-in could not open");
    } finally {
      setConnecting(false);
    }
  }

  function clockIn() {
    const shift = visibleDay?.shift;
    const now = pulseNow.getTime();
    const starts = shift ? Date.parse(shift.startsAt) : NaN;
    const ends = shift ? Date.parse(shift.endsAt) : NaN;
    const startable = Number.isFinite(starts) && now >= starts - 30 * 60_000 && now < ends;
    if (!startable) {
      setClockInConfirmation({ kind: "exception", reason: "" });
      return;
    }
    if (now > starts + 15 * 60_000) {
      setClockInConfirmation({ kind: "late", reason: "Starting after the scheduled shift time" });
      return;
    }
    if (syncBypassRef.current) { bypassAct("shift.clock_in", (base) => ({ ...base, session: { id: base.session?.id ?? "debug-local", state: "active", scheduled_starts_at: base.shift?.startsAt ?? null, scheduled_ends_at: base.shift?.endsAt ?? null, clocked_in_at: new Date().toISOString(), clocked_out_at: null, paused_seconds: 0 } as DayData["session"] })); return; }
    void act("shift.clock_in", () => sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop" }));
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
    void act("shift.clock_in", () => sendOrQueue("/api/work-os/me/workday", "POST", confirmation.kind === "late"
      ? { source: "desktop", late_acknowledged: true }
      : { source: "desktop", exception_acknowledged: true, exception_reason: confirmation.reason.trim() }));
  }

  function confirmClockOut() {
    setClockOutConfirmation(false);
    if (syncBypassRef.current) {
      bypassAct("shift.clock_out", (base) => ({ ...base, session: base.session ? { ...base.session, state: "clocked_out", clocked_out_at: new Date().toISOString() } : null }));
      return;
    }
    void act("shift.clock_out", async () => {
      await sendOrQueue("/api/work-os/me/workday", "PATCH", {
        action: "clock_out",
        ...(extendedClockOut ? { extended_acknowledged: true } : {}),
      });
    });
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
      const proposals = mutating.length ? await apiRequest<{ proposals: Array<{ id: string; client_operation_index: number }> }>("/api/work-os/me/proposals", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ input_text: text, operations: mutating.map(({ op }) => ({ op: op.op, statement: op.statement, task_id: op.taskId, task_title: op.taskTitle, task_group_id: op.taskGroupId, limit: op.limit })) }),
      }) : { proposals: [] };
      const proposalIdByOriginal = new Map(proposals.proposals.map((proposal) => [mutating[proposal.client_operation_index]?.index, proposal.id]));
      const operations = review.operations.map((op, index) => ({ ...op, enabled: isMutatingToolOp(op), proposalId: proposalIdByOriginal.get(index) }));
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
      setInterpretation({ status: "ready", operations, taskOptions, reply: review.reply, results: displayResults.length ? displayResults : undefined });
      setComposerThinking(null);
      setComposerHistory((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: review.reply || "Here's what I understood.", meta: mutating.length ? `${mutating.length} proposed update${mutating.length === 1 ? "" : "s"}` : displayResults.length ? "tasks shown" : undefined, createdAt: new Date().toISOString() }]);
      void sharePendingTools({ input: text, reply: review.reply, operations, results: displayResults, taskOptions });
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

  function toggleOperation(index: number) {
    setInterpretation((current) => current ? { ...current, operations: current.operations.map((op, i) => i === index ? { ...op, enabled: !op.enabled } : op) } : current);
  }

  function editOperation(index: number, statement: string) {
    const operation = interpretation?.operations[index];
    if (!operation || !pendingProgressUpdate.trim() || syncBypassRef.current) return;
    const revised = { ...operation, statement, proposalId: undefined };
    setInterpretation((current) => current ? { ...current, operations: current.operations.map((op, i) => i === index ? revised : op) } : current);
    void apiRequest<{ proposals: Array<{ id: string }> }>("/api/work-os/me/proposals", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ input_text: pendingProgressUpdate, operations: [{ op: revised.op, statement: revised.statement, task_id: revised.taskId, task_title: revised.taskTitle, task_group_id: revised.taskGroupId, limit: revised.limit }] }),
    }).then(({ proposals }) => {
      const proposalId = proposals[0]?.id;
      if (!proposalId) throw new Error("The revised proposal was not saved.");
      setInterpretation((current) => current ? {
        ...current,
        operations: current.operations.map((op, i) => i === index && op.statement === revised.statement && op.taskId === revised.taskId ? { ...op, proposalId } : op),
      } : current);
    }).catch((value) => showError(value, "The revised proposal could not be saved. It cannot be approved.", "Proposal update failed"));
  }

  function remapOperation(index: number, taskId: string) {
    const operation = interpretation?.operations[index];
    if (!operation || !pendingProgressUpdate.trim() || syncBypassRef.current) return;
    const revised = { ...operation, taskId: taskId || undefined, proposalId: undefined };
    setInterpretation((current) => current ? { ...current, operations: current.operations.map((op, i) => i === index ? revised : op) } : current);
    void apiRequest<{ proposals: Array<{ id: string }> }>("/api/work-os/me/proposals", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ input_text: pendingProgressUpdate, operations: [{ op: revised.op, statement: revised.statement, task_id: revised.taskId, task_title: revised.taskTitle, task_group_id: revised.taskGroupId, limit: revised.limit }] }),
    }).then(({ proposals }) => {
      const proposalId = proposals[0]?.id;
      if (!proposalId) throw new Error("The remapped proposal was not saved.");
      setInterpretation((current) => current ? {
        ...current,
        operations: current.operations.map((op, i) => i === index && op.statement === revised.statement && op.taskId === revised.taskId ? { ...op, proposalId } : op),
      } : current);
    }).catch((value) => showError(value, "The remapped proposal could not be saved. It cannot be approved.", "Proposal update failed"));
  }

  function denyInterpretationOperation(index: number) {
    const operation = interpretation?.operations[index];
    if (!operation?.proposalId) return;
    void apiRequest(`/api/work-os/proposals/${encodeURIComponent(operation.proposalId)}`, {
      method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "reject" }),
    }).then(() => {
      const denied: ToolCallResult = { op: operation, status: "denied", message: "Denied. This tool call will not run." };
      const operations = (interpretation?.operations ?? []).map((op, currentIndex) => currentIndex === index ? { ...op, enabled: false } : op);
      const results = [...(interpretation?.results ?? []), denied];
      setInterpretation((current) => current ? { ...current, operations, results } : current);
      void sharePendingTools({ input: pendingProgressUpdate.trim(), reply: interpretation?.reply, operations, results, taskOptions: interpretation?.taskOptions ?? [] });
    }).catch((value) => showError(value, "Could not deny this tool call.", "Approval update failed"));
  }

  function approveInterpretation(operations: ProposedOperation[]) {
    const text = pendingProgressUpdate.trim();
    const enabled = operations.filter((op) => op.enabled);
    if (!text || !enabled.length) return;
    const dominant: ProgressUpdateKind = enabled.some((op) => op.op === "record_blocker") ? "blocked"
      : enabled.some((op) => op.op === "complete_task") ? "completion_claim"
      : enabled.some((op) => op.op === "create_task") ? "new_task" : "material_progress";
    const close = (results?: ToolCallResult[]) => {
      const message = enabled.length === 1
        ? `Recorded your update: “${enabled[0]!.statement.slice(0, 140)}”`
        : `Recorded ${enabled.length} updates on your behalf.`;
      if (results) setProgressReceipt(null);
      else setProgressReceipt({ kind: dominant, text, queued: false, message });
      setComposerHistory((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: message, meta: "recorded", createdAt: new Date().toISOString() }]);
      setInterpretation((current) => current ? { ...current, operations: current.operations.map((op) => ({ ...op, enabled: false })), results: mergeToolResults(current.results ?? [], results ?? []) } : current);
      setPendingProgressUpdate(results ? "tool calls reviewed" : "");
    };
    if (syncBypassRef.current || (debugRef.current.enabled && !debugScenario.liveWrites)) {
      close();
      notifications.success(`${enabled.length} update${enabled.length === 1 ? "" : "s"} saved on this device.`, "Offline playground");
      return;
    }
    setBusy(true); setError("");
    diagnostics.info("composer.approve", `filing ${enabled.length} operation(s)`, { activeView: view });
    (async () => {
      const outcome = await fileApprovedOperations(enabled, {
        reviewProposal: (proposalId) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "accept" }), signal: AbortSignal.timeout(60_000) }),
      });
      const parts: string[] = [];
      if (outcome.recorded) parts.push(`Recorded ${outcome.recorded} update${outcome.recorded === 1 ? "" : "s"}`);
      if (outcome.queued) parts.push(`${outcome.queued} queued for sync`);
      if (outcome.failed.length) parts.push(`${outcome.failed.length} failed`);
      close(outcome.results);
      void sharePendingTools({
        input: text,
        reply: interpretation?.reply,
        operations: (interpretation?.operations ?? enabled).map((op) => ({ ...op, enabled: false })),
        results: mergeToolResults(interpretation?.results ?? [], outcome.results),
        taskOptions: interpretation?.taskOptions ?? [],
      });
      if (outcome.failed.length) {
        notifications.error(`${parts.join(" · ")}. First failure: ${outcome.failed[0]!.message}`, "Some updates did not file");
      } else {
        notifications.success(parts.join(" · "), "Updates filed");
      }
      // Filed changes (new tasks, completions) only become visible once the
      // workday payload is refetched — don't make the employee refresh by hand.
      void refresh();
    })().catch((value) => {
      showError(value, "Your approved updates could not be filed.", "Filing failed");
    }).finally(() => setBusy(false));
  }

  function proposeSelectedTaskCompletions(taskIds: string[]) {
    if (!taskIds.length || syncBypassRef.current) return;
    const titles = new Map(interpretationTaskOptions().map((task) => [task.id, task.title]));
    const tasks = taskIds.map((id) => ({ id, title: titles.get(id) ?? "selected task" }));
    const inputText = `Employee selected ${tasks.length} task${tasks.length === 1 ? "" : "s"} for completion.`;
    setBusy(true); setError("");
    void apiRequest<{ proposals: Array<{ id: string; client_operation_index: number }> }>("/api/work-os/me/proposals", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        input_text: inputText,
        operations: tasks.map((task) => ({ op: "complete_task", statement: `Employee confirmed completion of ${task.title}.`, task_id: task.id, task_title: task.title })),
      }),
    }).then(({ proposals }) => {
      const byIndex = new Map(proposals.map((proposal) => [proposal.client_operation_index, proposal.id]));
      const operations: ProposedOperation[] = tasks.map((task, index) => ({
        op: "complete_task", statement: `Employee confirmed completion of ${task.title}.`, taskId: task.id, taskTitle: task.title, proposalId: byIndex.get(index), enabled: true,
      }));
      if (operations.some((operation) => !operation.proposalId)) throw new Error("The completion proposals were not saved.");
      setPendingProgressUpdate(inputText);
      setInterpretation((current) => current ? { ...current, operations: [...current.operations, ...operations] } : {
        status: "ready", operations, taskOptions: interpretationTaskOptions(), reply: "Review the selected task completions before anything changes.",
      });
      void sharePendingTools({ input: inputText, reply: "Review the selected task completions before anything changes.", operations, results: [], taskOptions: interpretationTaskOptions() });
    }).catch((value) => showError(value, "The completion proposals could not be saved. Nothing was marked done.", "Proposal update failed"))
      .finally(() => setBusy(false));
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
        kind, text, queued: false,
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
          message: queued
            ? `“${text}” is queued as a task and workday update. It will be confirmed after reconnection.`
            : taskResult.providerStatus === "nifty_confirmed"
              ? `Added “${text}” to today’s Nifty tasks and recorded the update.`
              : `Recorded “${text}”; Nifty confirmation is still pending.`,
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
          message: result.queued === true ? `“${text}” is queued as ${label} and will sync after reconnection.` : `Recorded “${text}” as ${label} for today.`,
        });
      }
      setPendingProgressUpdate("");
    });
  }

  if (!vaultReady) return <LoadingScreen failed={false} retry={() => undefined} onDebug={() => void openDebugger()} onOffline={() => undefined} />;
  if (!visibleSession) return <ConnectScreen apiBase={apiBase} setApiBase={setApiBase} connecting={connecting} onConnect={() => void connectWorkspace()} onSave={async () => { try { await secureState.saveSettings({ apiBase }); notifications.success("The server address was saved.", "Settings saved"); } catch (value) { showError(value, "The server address could not be saved.", "Settings not saved"); } }} />;
  if (!visibleOnboarding) return <LoadingScreen
      failed={!!error}
      retry={() => void refresh()}
      onDebug={() => void openDebugger()}
      onOffline={() => setScenario({ ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: true, authState: "real", onboardingState: "complete", dayState: "clocked_in" })}
    />;
  if (visibleOnboarding.onboardingRequired) return <Onboarding data={visibleOnboarding} simulated={debugScenario.enabled} busy={busy} onNotify={notifications.notify} onOpenDebug={() => void openDebugger()} onLogout={() => void logout()} onComplete={() => { notifications.success("Your workspace setup is complete.", "Welcome to Work OS"); void refresh(); }} onSaveDraft={async (body) => { if (debugScenario.enabled) return visibleOnboarding; const next = await sendOrQueue("/api/work-os/me/onboarding", "PUT", body); if ((next as { queued?: boolean }).queued) { setQueueCount((await secureState.queue()).length); return { queued: true }; } const onboarding = next as OnboardingData; queryClient.setQueryData(workOsKeys.onboarding(), onboarding); setOnboarding(onboarding); return onboarding; }} onSubmit={async (body) => { if (debugScenario.enabled) { setScenario({ ...debugScenario, onboardingState: "complete", missingDetails: [] }); return visibleDay?.attendance; } const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "POST", headers: { "Idempotency-Key": String(body.clientMutationKey ?? "") }, body: JSON.stringify(body) }); queryClient.setQueryData(workOsKeys.onboarding(), next); setOnboarding(next); const result = await apiRequest<{ attendance?: DayData["attendance"] }>("/api/work-os/me/workday"); return result.attendance; }} />;

  return <div className="workspace">
    <aside className="rail">
      <div className="wordmark"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div>
      <nav aria-label="Work OS"><div className="nav-group nav-core">{views.slice(0, 3).map(({ id, label, icon: Icon }) => <button key={id} data-label={label} aria-label={label} title={label} aria-current={view === id ? "page" : undefined} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === "review" && !!visibleDay?.proposals.length && <em>{visibleDay.proposals.length}</em>}</button>)}</div><div className="nav-group nav-context">{views.slice(3, 5).filter(({ id }) => id !== "evidence" || FEATURES.evidence).map(({ id, label, icon: Icon }) => <button key={id} data-label={label} aria-label={label} title={label} aria-current={view === id ? "page" : undefined} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</div><div className="nav-group nav-settings">{views.slice(5).map(({ id, label, icon: Icon }) => <button key={id} data-label={label} aria-label={label} title={label} aria-current={view === id ? "page" : undefined} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</div></nav>
      <div className="rail-foot"><span className={`presence ${sessionActive && !paused ? "live" : gate.worktivitySynced ? "observed" : ""}`} /> <div><strong>{observedOnly ? paused ? "Observed break" : "Activity synced" : active ? paused ? "Paused" : "On shift" : "Off shift"}</strong><small>{queueCount ? `${queueCount} queued` : gate.worktivitySynced ? "Worktivity connected" : navigator.onLine ? "Synced" : "Offline"}</small></div></div>
    </aside>
    <section className="stage">
      <header className="masthead"><div><p>{formatWorkOsDate(visibleDay?.shiftDate)}</p><h1>{views.find((item) => item.id === view)?.label}</h1></div><div className="mast-actions">{visibleDay?.niftySync && <span className={`provider nifty-state ${visibleDay.niftySync.error ? "degraded" : visibleDay.niftySync.syncing ? "syncing" : "fresh"}`} title={visibleDay.niftySync.error || (visibleDay.niftySync.syncing ? "Nifty is refreshing task state" : "Nifty task state is current")}>{visibleDay.niftySync.error ? "Nifty sync delayed" : visibleDay.niftySync.syncing ? "Nifty syncing" : "Nifty current"}</span>}{signedIn && !syncBypass && <EodOutstandingBell
        days={outstandingQuery.data?.days ?? []}
        loading={outstandingQuery.isFetching && !outstandingQuery.data}
        error={outstandingQuery.error ? errorMessage(outstandingQuery.error, "Outstanding EODs could not be loaded.") : null}
        open={eodListOpen}
        onToggle={() => { const next = !eodListOpen; setEodListOpen(next); if (next) void outstandingQuery.refetch(); }}
        onClose={() => setEodListOpen(false)}
        onSelect={(day: OutstandingEodDay) => { setEodListOpen(false); setEodDate(day.date); setView("review"); }}
        onRetry={() => void outstandingQuery.refetch()}
      />}<button className="icon" title="Refresh this page" disabled={refreshing} onClick={() => void refreshActiveView()}>{refreshing ? <FadeArc size={17} /> : <RefreshCw size={17} />}</button><button className="avatar" aria-label={`Profile for ${visibleOnboarding.profile.displayName}`}>{initials(visibleOnboarding.profile.displayName)}</button></div></header>
      {debugScenario.enabled && <div className="notice debug"><Bug size={15} /> {syncBypass ? "Offline playground — the backend is never contacted and changes stay on this device." : debugScenario.liveWrites ? "Scenario mode — filing real updates against the connected server." : "Scenario mode is active. Writes are disabled."}<button onClick={() => setScenario(DEFAULT_DEBUG_SCENARIO)}>Reset</button></div>}
      {view === "day" && (!visibleDay ? <DashboardSkeleton /> : !active ? <main className="day-grid off-shift-day">
        <section className="hero-card">
          <div className="hero-copy"><span className="kicker">{gate.worktivitySynced ? "Worktivity connected" : "Ready when you are"}</span><h2>{gate.worktivitySynced ? "Ready to start." : "Ready when Worktivity is."}</h2><p>{visibleDay?.shift ? `Scheduled ${formatTime(visibleDay.shift.startsAt, visibleDay.shift.timezone)}–${formatTime(visibleDay.shift.endsAt, visibleDay.shift.timezone)}.` : "Worktivity will start a synchronized workday when activity begins."}</p>
            <div className="hero-actions"><button className="primary" disabled={busy || !gate.canClockIn} onClick={clockIn}><CirclePlay size={17} /> Clock in</button></div>
            {visibleDay?.attendance && <small className="attendance-context">Observed context: {visibleDay.attendance.message}</small>}
            <div className="hero-focus-line"><small>Today’s focus</small><button onClick={openGoalComposer} aria-label="Update today’s focus"><span>{planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}</span></button>{planSaveState === "saving" ? <FadeArc size={13} /> : planSaveState === "offline" || planSaveState === "conflict" ? <button type="button" className="goal-retry" title={planSaveState === "conflict" ? "Goal not saved — refresh the day, then retry." : "Goal not saved — click to retry."} aria-label="Retry saving the goal" onClick={() => setPlanDirty(true)}><RefreshCw size={13} /></button> : null}<em>{planIntent ? goalProvenance === "accepted_suggestion" ? "Derived from your tasks · tap to update" : "Written by you · tap to update" : goalSuggestion ? "Suggested from your tasks" : "Task record · tap to set a focus"}</em></div>
          </div><div className="hero-companion-art"><Otto pose="sleep" className="otto-hero" /></div>
        </section>
        <ShiftPulseCard pulse={pulse} now={pulseNow} shift={visibleDay?.shift ?? null} active={active} attendance={visibleDay?.attendance ?? null} />
        <KpiStrip scheduledCount={todayParentTasks.length} yesterdayDueCount={yesterdayDueTasks.length} completedCount={todayCompletedCount} reviewCount={visibleDay?.proposals?.length ?? 0} onScheduled={() => { setTaskView("today"); setView("tasks"); }} onYesterday={() => { setCarryOverOpen(true); setView("tasks"); }} onCompleted={() => { setTaskView("completed"); setView("tasks"); }} onReviews={() => setView("review")} />
                <section className="panel dashboard-tasks-card">
          <div className="card-title"><span><BriefcaseBusiness size={17} /> Today’s tasks</span><button onClick={() => { setTaskView("today"); setView("tasks"); }}>View all <ChevronRight size={14} /></button></div>
          {dashboardTopTasks.length ? <div className="dashboard-task-grid">{dashboardTopTasks.map((task) => <DashboardTaskCard key={String(task.provider_task_id || task.id)} task={task} currentDate={visibleDay?.shiftDate ?? ""} onOpen={() => void openTaskDetails(task)} onRetryPendingTask={retryPendingTask} onDismissPendingTask={dismissPendingTask} />)}</div> : <div className="dashboard-task-empty"><strong>{yesterdayDueTasks.length ? "Nothing scheduled yet" : "Your agenda is open"}</strong><span>{yesterdayDueTasks.length ? "Review unfinished work or add today’s first priority." : "Add your first priority — the composer below plans without clocking you in."}</span></div>}
        </section>
      </main> : <ActiveDayWorkspace
        focus={planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}
        focusSource={planIntent ? goalProvenance === "accepted_suggestion" ? "Derived from today’s tasks" : "Your focus note" : goalSuggestion ? "Suggested from today’s tasks" : "Task record"}
        tasks={[...pendingTaskRows, ...(visibleDay?.tasks ?? [])]}
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
        reviews={(visibleDay?.proposals ?? []).length ?? 0}
        paused={paused}
        busy={busy}
        observedOnly={observedOnly}
        canPause={sessionActive && !visibleDay?.breakPolicy?.worktivityAuthoritative}
        canClockOut={sessionActive}
        onEditFocus={openPlanningSession}
        onAddTask={() => void openTaskComposer()}
        onManageTasks={() => setView("tasks")} onOpenOverdue={() => { setTaskView("unfinished"); setView("tasks"); }} currentDate={visibleDay?.shiftDate ?? ""}
        onOpenTask={(task) => void openTaskDetails(task)}
        onToggleTask={setTaskCompletion}
        onEditTask={editTask}
        onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")}
        onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")}
        onPause={() => {
          if (syncBypassRef.current) { bypassAct("shift.pause_toggle", (base) => ({ ...base, session: base.session ? { ...base.session, state: paused ? "active" : "paused", paused_seconds: paused ? base.session.paused_seconds : (base.session.paused_seconds ?? 0) + 900 } : null })); return; }
          void act("shift.pause_toggle", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: paused ? "resume" : "pause" }));
        }}
        onClockOut={() => setClockOutConfirmation(true)}
        kpiStrip={<KpiStrip scheduledCount={todayParentTasks.length} yesterdayDueCount={yesterdayDueTasks.length} completedCount={todayCompletedCount} reviewCount={visibleDay?.proposals?.length ?? 0} onScheduled={() => { setTaskView("today"); setView("tasks"); }} onYesterday={() => { setCarryOverOpen(true); setView("tasks"); }} onCompleted={() => { setTaskView("completed"); setView("tasks"); }} onReviews={() => setView("review")} />}
      />)}
      {view === "tasks" && <TasksWorkspace currentDate={visibleDay?.shiftDate ?? ""} historyDate={planHistoryDate} currentPlan={visibleDay?.plan ?? null} historicalPlan={historicalPlan} historicalTasks={historicalTasks} goal={planIntent} goalProvenance={goalProvenance} suggestion={goalSuggestion} saveState={planSaveState} taskView={taskView} todayTasks={[...pendingTaskRows, ...(visibleDay?.tasks ?? [])]} taskHistory={taskHistory} carryOver={unfinishedCarryOver} carryOverOpen={carryOverOpen} loadingMore={taskHistoryLoading} hasMore={taskHistoryCursor !== null} busy={busy} loading={tasksInitialLoading} onTaskView={setTaskView} onDate={loadPlanHistory} onEditFocus={openPlanningSession} onAddTask={() => void openTaskComposer()} onOpenTask={(task, readOnly) => void openTaskDetails(task, readOnly)} onEditTask={editTask} onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")} onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")} onSurfaceTask={surfaceTask} onTaskCompletion={setTaskCompletion} onCarryOverOpen={setCarryOverOpen} onLoadMore={() => void loadMoreTasks()} onRetryPendingTask={retryPendingTask} onDismissPendingTask={dismissPendingTask} onRetryGoalSave={() => setPlanDirty(true)} />}
      {view === "review" && <main className="page">
        {eodDate && !eodSubmitted && <div className="eod-day-context"><button type="button" onClick={() => setEodDate(null)}><ArrowLeft size={14} /> Back to today</button><span>EOD for {formatWorkOsDate(eodDate)}.</span></div>}
        {eodDate && reportDayQuery.isLoading ? <section className="panel eod-drafting"><Wave className="loading-wave-large" /><strong>Loading that day…</strong><p>Fetching the recorded work for {formatWorkOsDate(eodDate)}.</p></section>
          : eodDate && reportDayQuery.error ? <section className="panel"><Empty title="That day could not be loaded" body="The day's recorded work is unavailable right now. Check your connection and try again." /><div className="today-actions"><button onClick={() => void reportDayQuery.refetch()}>Try again</button></div></section>
            : eodGate && !eodSubmitted ? <section className="panel"><Empty
                title={eodGate.gate === "no_tasks" ? "No tasks submitted for this day" : "No work activity recorded"}
                body={eodGate.detail}
              /><div className="today-actions"><button onClick={() => setView("tasks")}>Open Tasks <ChevronRight size={14} /></button><button onClick={() => { setEodGate(null); void redraftEod(reviewDay); }}>{eodRedrafting ? "Checking…" : "Try again"}</button></div></section>
              : reviewDay?.report && !eodSubmitted && eodRedrafting && !eodDraft ? <section className="panel eod-drafting"><Wave className="loading-wave-large" /><strong>Drafting your EOD…</strong><p>Checking {eodDate ? "that day’s" : "today’s"} recorded work and writing a draft for you to review.</p></section>
                : reviewDay?.report && !eodSubmitted && (!eodRedrafting || eodDraft) ? <EodComposer
                    reportId={String(reviewDay.report.id ?? "unknown")}
                    initialMarkdown={eodDraft?.markdown ?? String(reviewDay.report.markdown ?? "")}
                    source={eodDraft?.source ?? "deterministic"}
                    dayLabel={eodDate ? formatWorkOsDate(eodDate) : "today"}
                    suggestedBottleneck={reviewDay.plan?.items?.find((item) => typeof item.blocker === "string" && item.blocker.trim())?.blocker ?? null}
                    allTasksCompleted={allReviewTasksCompleted}
                    redrafting={eodRedrafting}
                    clockedOut={eodClockedOut}
                    screenshotContext={eodDraft?.screenshots ?? null}
                    screenshotSyncUnavailable={eodDraft?.screenshotSyncUnavailable === true}
                    busy={busy}
                    onRedraft={() => void redraftEod(reviewDay)}
                    onRefine={(markdown, feedback, annotations) => refineEod(reviewDay, markdown, feedback, annotations)}
                    onSubmit={(markdown, idempotencyKey) => submitEod(reviewDay, markdown, idempotencyKey)}
                  />
                  : eodSubmitted ? <section className="panel eod-submitted" role="status"><Otto pose="celebrate" className="otto-celebrate" /><strong>EOD submitted</strong><p>{eodDate ? `Your report for ${formatWorkOsDate(eodDate)} is with your manager.` : "Your report is with your manager. You are done for today."}</p></section>
                    : !reviewDay?.report ? <section className="panel"><Empty title="Prepare your EOD for review" body={eodDate ? `Create a draft from ${formatWorkOsDate(eodDate)}'s recorded work, then review and submit it when it is accurate. Creating a draft does not submit anything.` : "Create a draft from today's recorded work, then review and submit it when it is accurate. Creating a draft does not submit anything."} /><div className="today-actions">{!eodDate && <button onClick={() => setView("day")}>Return to today <ChevronRight size={14} /></button>}<button className="primary" disabled={busy || eodRedrafting} onClick={() => void createEodDraft(reviewDay)}>{eodRedrafting ? "Preparing…" : eodDate ? "Create draft for this day" : "Create EOD draft"}</button></div></section>
                      : null}
      </main>}
      {view === "insights" && <PersonalInsights key={`${insightRange}:${visibleDay?.shiftDate ?? ""}`} data={activeInsights} loading={activeInsightsLoading} range={insightRange} onRange={setInsightRange} onReference={(reference) => void openInsightReference(reference)} onCorrect={(quality, date) => { if (!quality.sessionId) return; setMissedClockOut({ sessionId: quality.sessionId, date, clockedInAt: quality.clockedInAt ?? null }); setMissedClockOutAt(""); setMissedClockOutReason(""); }} />}
      {view === "evidence" && <main className="page"><PageIntro eyebrow="Provenance" title="Evidence with its labels intact." body="Claims, activity observations, and output artifacts are never collapsed into one misleading score." /><section className="evidence-list">{visibleDay?.evidence?.length ? visibleDay.evidence.map((item) => <article key={item.id}><span className={`evidence-kind ${item.source === "worktivity" ? "activity" : "output"}`}>{item.source === "worktivity" ? "Activity context" : "Output evidence"}</span><div><h3>{item.title}</h3><p>{item.summary || "No summary available."}</p></div><time>{item.occurred_at ? formatTime(item.occurred_at, visibleDay.shift?.timezone) : "Today"}</time></article>) : <Empty title="No evidence yet" body="Verified provider events and purpose-limited activity context will appear here." />}</section></main>}
      {view === "settings" && (
        <main className="page">
          <PageIntro eyebrow="Workspace control" title="Your companion, your boundaries." body="Manage launch behavior, local sync, privacy context, updates, and diagnostics." />
          <section className="settings-panel">
            <Setting title="Start with Windows" detail="Open quietly in the tray after sign-in"><input type="checkbox" checked={autoStart} onChange={(event) => void toggleAutoStart(event.target.checked)} /></Setting>
            <Setting title="Scheduled check-ins" detail="Due check-ins appear in the floating avatar. Snooze them there when needed."><span className="status-dot">Avatar</span></Setting>
            <Setting title="Offline queue" detail={queueAttentionCount ? `${queueAttentionCount} update${queueAttentionCount === 1 ? "" : "s"} need attention` : queueCount ? `${queueCount} updates waiting to sync` : "Everything is synced"}><span className="status-dot">{queueAttentionCount ? "Needs Attention" : "Ready"}</span></Setting>
            <Setting title="Scenario debugger" detail="Opens a separate diagnostics window. Ctrl+Shift+D"><button onClick={() => void openDebugger()}><Bug size={15} /> Open</button></Setting>
            <Setting title="Export diagnostics" detail="Redacted ZIP of recent events. Never includes tokens or queue bodies."><button onClick={() => void exportAppDiagnostics()}>Export</button></Setting>
            <Setting title="Desktop updates" detail={updateStatus ? `${updateStatus} · Installed version ${installedVersion}` : `Installed version ${installedVersion}`}><button onClick={() => void checkForUpdates()}>Check</button></Setting>
            <Setting title="Automatic update checks" detail="Check on launch and show a flyout when a new build is ready"><input type="checkbox" checked={autoCheckUpdates} onChange={(event) => void toggleAutoCheckUpdates(event.target.checked)} /></Setting>
            <Setting title="Evidence" detail="Provider-verified proof of output is coming back. The surface is built and temporarily hidden."><span className="status-dot">Hidden</span></Setting>
            <Setting title="Restart onboarding" detail="Clear your personal setup answers and return to employee onboarding. Manager-owned setup and consent history stay intact."><button disabled={busy} onClick={() => void resetOnboarding()}><RotateCcw size={15} /> Reset</button></Setting>
            <Setting title="Account session" detail={`Signed in through ${visibleSession.apiBase}`}><button className="danger" disabled={busy} onClick={() => void logout()}><LogOut size={15} /> Sign out</button></Setting>
          </section>
        </main>
      )}
      {(view === "day" || view === "tasks" && planHistoryDate === visibleDay?.shiftDate) && <ProgressComposer
        mode={sessionActive && view === "day" ? "progress" : "agenda"}
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
        onInput={setInput}
        onOpen={() => { setProgressPanel("update"); setProgressComposerOpen(true); }}
        onOpenGoal={openGoalComposer}
        onClose={() => { setProgressComposerOpen(false); setPendingProgressUpdate(""); setProgressReceipt(null); setInterpretation(null); setComposerThinking(null); }}
        onSubmit={startProgressUpdate}
        interpretation={interpretation}
        thinking={composerThinking}
        toolContext={{ shiftDate: visibleDay?.shiftDate ?? null, personId: visibleDay?.access?.personId ?? null, promptKind: visibleDay?.prompt?.kind || "optional" }}
        aiUnavailable={aiUnavailable}
        onToggleOperation={toggleOperation}
        onEditOperation={editOperation}
        onRemapOperation={remapOperation}
        onDenyOperation={denyInterpretationOperation}
        onApproveOperations={approveInterpretation}
        onMarkSelectedDone={proposeSelectedTaskCompletions}
        onNavigateView={(page) => setView(page)}
        onClassify={classifyProgressUpdate}
        onGoal={(value) => editPlan(() => { setPlanIntent(value); setGoalProvenance(value.trim() ? "employee" : null); setSuggestionTaskIds([]); })}
        onAcceptSuggestion={() => { if (!goalSuggestion) return; editPlan(() => { setPlanIntent(goalSuggestion.text); setGoalProvenance("accepted_suggestion"); setSuggestionTaskIds(goalSuggestion.taskIds); }); }}
      />}
    </section>
    {taskComposerOpen && <TaskComposerModal busy={busy} title={taskComposerTitle} description={taskComposerDescription} assignees={taskComposerAssignees} options={taskAssigneeOptions} optionsLoading={taskOptionsLoading} onTitle={setTaskComposerTitle} onDescription={setTaskComposerDescription} onToggleAssignee={(id) => setTaskComposerAssignees((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onClose={() => setTaskComposerOpen(false)} onSubmit={submitTaskFromDesktop} />}
        {taskDetails && <TaskDetailsModal details={taskDetails} loading={taskDetailsLoading} readOnly={taskDetailsReadOnly} currentDate={visibleDay?.shiftDate ?? ""} busy={busy} subtaskTitle={subtaskTitle} subtaskDescription={subtaskDescription} subtaskMenuId={subtaskMenuId} moveMenuId={moveMenuId} onSubtaskTitle={setSubtaskTitle} onSubtaskDescription={setSubtaskDescription} onSubtaskMenu={setSubtaskMenuId} onMoveMenu={setMoveMenuId} onSubtaskCreate={submitInlineSubtask} onEditTask={editTask} onMoveSubtask={moveSubtask} onToggleSubtask={(subtask) => setTaskCompletion(subtask, !subtask.completed, true)} onArchiveSubtask={(subtask) => requestTaskRemoval(subtask, false, "archive")} onDeleteSubtask={(subtask) => requestTaskRemoval(subtask, false, "delete")} onClose={() => setTaskDetails(null)} />}
    {deleteRequest && <TaskRemovalConfirmation mode={deleteRequest.mode} scope={deleteRequest.closeParent ? "task" : "subtask"} title={String(deleteRequest.task.title ?? "Untitled task")} subtaskCount={deleteRequest.closeParent && taskDetails?.subtasks?.length ? taskDetails.subtasks.length : 0} busy={busy} onCancel={() => setDeleteRequest(null)} onConfirm={confirmTaskRemoval} />}
    {editRequest && <TaskEditModal kind={editRequest.kind} title={editTitle} description={editDescription} busy={busy} onTitle={setEditTitle} onDescription={setEditDescription} onClose={() => setEditRequest(null)} onSubmit={submitTaskEdit} />}
    <PlanningSession open={planningSessionOpen} plan={visibleDay?.plan ?? null} active={active} busy={busy} onClose={() => setPlanningSessionOpen(false)} onInterpret={interpretPlanning} onRefine={refinePlanning} onConfirm={confirmPlanning} />
    {clockInConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{clockInConfirmation.kind === "late" ? "Confirm late start" : "Confirm exception start"}</h2><p>{clockInConfirmation.kind === "late" ? "This clock-in is after the scheduled start. Your acknowledgement will be retained in the audit record." : "There is no startable scheduled shift right now. Explain the exception before Work OS starts a separate exception session."}</p>{clockInConfirmation.kind === "exception" && <textarea autoFocus maxLength={1000} value={clockInConfirmation.reason} onChange={(event) => setClockInConfirmation({ ...clockInConfirmation, reason: event.target.value })} placeholder="Reason for starting outside the scheduled window" />}<div><button disabled={busy} onClick={() => setClockInConfirmation(null)}>Cancel</button><button className="primary" disabled={busy || (clockInConfirmation.kind === "exception" && !clockInConfirmation.reason.trim())} onClick={confirmClockIn}>Confirm clock-in</button></div></section></div>}
    {missedClockOut && <div className="task-modal-backdrop"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="missed-clockout-title"><header><div><span>Session correction · {formatWorkOsDate(missedClockOut.date)}</span><h2 id="missed-clockout-title">Enter the exact clock-out time</h2></div><button aria-label="Close correction" onClick={() => setMissedClockOut(null)}><X size={18} /></button></header><div className="task-modal-body"><p>Work OS will not infer this timestamp. Enter the time you actually stopped working.</p>{missedClockOut.clockedInAt && <small>Clocked in {formatWorkOsDateTime(missedClockOut.clockedInAt)}</small>}<label><span>Clock-out timestamp</span><input type="datetime-local" value={missedClockOutAt} onChange={(event) => setMissedClockOutAt(event.target.value)} /></label><label><span>Correction note <em>optional</em></span><textarea value={missedClockOutReason} onChange={(event) => setMissedClockOutReason(event.target.value)} /></label></div><footer><button onClick={() => setMissedClockOut(null)}>Cancel</button><button className="primary" disabled={busy || !missedClockOutAt} onClick={correctMissedClockOut}>Save correction</button></footer></section></div>}
    {clockOutConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{extendedClockOut ? "Confirm extended shift" : "Confirm clock-out"}</h2><p>{extendedClockOut ? "This clock-out is more than 15 minutes after the scheduled end. Confirm that you intentionally worked the extended shift; the acknowledgement will be retained in the audit record." : "Clock out and close today’s workspace?"}</p><div><button disabled={busy} onClick={() => setClockOutConfirmation(false)}>Cancel</button><button className="primary" disabled={busy} onClick={confirmClockOut}>{extendedClockOut ? "Confirm extended shift" : "Clock out"}</button></div></section></div>}
  </div>;
}

function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><Sparkles size={20} /><strong>{title}</strong><p>{body}</p></div>; }
function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) { return <header className="page-intro"><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p></header>; }
function Metric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <article className="metric"><Icon size={18} /><small>{label}</small><strong>{value}</strong></article>; }
function moveDate(date: string, amount: number) {
  return shiftWorkOsDate(date, amount);
}


export function ConnectScreen({ apiBase, setApiBase, connecting, onConnect, onSave }: { apiBase: string; setApiBase: (value: string) => void; connecting: boolean; onConnect: () => void; onSave: () => Promise<void> }) { return <main className="connect"><section><div className="wordmark large"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div><div className="connect-stack"><span className="kicker">Desktop companion</span><h1>Welcome to a clearer workday.</h1><p>Bring your tasks, priorities, and progress into one calm place, then move through the day with confidence and focus.</p><button className="primary connect-button" disabled={connecting} onClick={onConnect}>{connecting ? <FadeArc size={17} /> : <LogIn size={17} />} {connecting ? "Opening browser…" : "Connect workspace"}</button><details className="connect-settings"><summary>Server settings</summary><div className="connect-settings-row"><input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://work.example.com" aria-label="Workspace server URL" /><button onClick={() => void onSave()}>Save</button></div></details></div></section><aside className="connect-art"><Otto pose="idle" className="otto-connect" /></aside></main>; }
export function LoadingScreen({ failed, retry, onDebug, onOffline }: { failed: boolean; retry: () => void; onDebug: () => void; onOffline: () => void }) {
  return <main className="loading"><div className="loading-shell">
    <div className="wordmark-badge"><img src={assetUrl(wordmark)} alt="" /></div>
    <h1>{failed ? "Work OS needs another try" : "Preparing your workday"}</h1>
    <p>{failed ? "The details are in the notification above." : "Syncing your schedule, tasks, and provider context…"}</p>
    {failed
      ? <><button className="primary" onClick={retry}>Retry</button><div className="loading-alternatives"><button onClick={onOffline}>Continue offline</button><button className="quiet" onClick={onDebug}><Bug size={14} /> Scenario debugger</button></div><small>Offline mode uses local fixtures only — nothing reaches the server.</small></>
      : <><Wave className="loading-wave-large" /><small className="loading-stage">Connecting to your workspace</small></>}
  </div></main>;
}

function CompletionRing({ completed, total, label, compact = false }: { completed: number; total: number; label: string; compact?: boolean }) {
  const progress = total > 0 ? Math.min(1, completed / total) : 0;
  const percentage = Math.round(progress * 100);
  return <span className={`completion-ring ${compact ? "compact" : ""}`} style={{ "--progress": `${progress * 360}deg` } as CSSProperties} role="img" aria-label={`${completed} of ${total} ${label}, ${percentage}%`}><span><strong>{completed}</strong><small>of {total}</small></span><em>{label}</em></span>;
}

function remainingShiftLabel(endsAt: string | undefined, now: Date) {
  const remaining = endsAt ? Math.max(0, Date.parse(endsAt) - now.getTime()) : 0;
  if (!endsAt || !Number.isFinite(remaining)) return "—";
  const minutes = Math.ceil(remaining / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

function ShiftDetailsFloatingCard({ view, progressPercent, shiftStart, remaining, shiftEnd, elapsed, openTasks, reviews, attendance, timezone, observedActive, providerBreak, onBack, onClose }: {
  view: "shift" | "worktivity"; progressPercent: number; shiftStart: string; remaining: string; shiftEnd: string; elapsed: string;
  openTasks: number; reviews: number; attendance: DayData["attendance"] | null; timezone?: string; observedActive: string; providerBreak: string; onBack: () => void; onClose: () => void;
}) {
  return <section className="shift-detail-popover" role="dialog" aria-label={view === "shift" ? "Workday status" : "Worktivity details"}>
    <header><button className="detail-back" aria-label="Back to detail options" onClick={onBack}><ChevronLeft size={16} /></button><div><span>{view === "shift" ? <Clock3 size={15} /> : <Activity size={15} />}{view === "shift" ? "Workday status" : "Worktivity details"}</span><small>{view === "shift" ? "Schedule and Work OS session context" : "Observed provider context only"}</small></div><button aria-label="Close details" onClick={onClose}><X size={16} /></button></header>
    {view === "shift" ? <><div className="shift-pulse-visual"><div className="shift-progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as CSSProperties}><span><small>Scheduled shift</small><strong>{Math.round(progressPercent)}%</strong><em>elapsed</em></span></div><div className="shift-track-summary"><div><span><small>Shift start</small><strong>{shiftStart}</strong></span><span><small>Time remaining</small><strong>{remaining}</strong></span><span><small>Shift end</small><strong>{shiftEnd}</strong></span></div><div className="shift-detail-track"><i style={{ width: `${progressPercent}%` }} /><b style={{ left: `${progressPercent}%` }} /></div></div></div><div className="shift-detail-grid"><span><small>Elapsed</small><strong>{elapsed}</strong></span><span><small>Open tasks</small><strong>{openTasks}</strong></span><span><small>Awaiting review</small><strong>{reviews}</strong></span></div></> : <><div className="worktivity-state"><span className={`presence ${attendance?.state === "active" ? "live" : ""}`} /><div><small>Worktivity observation</small><strong>{attendance?.status ? sentence(attendance.status) : "Unavailable"}</strong></div></div><div className="shift-detail-grid worktivity-grid"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{attendance?.clockedOutAt ? formatTime(attendance.clockedOutAt, timezone) : "Still active"}</strong></span><span><small>Last activity</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>Observed active time</small><strong>{observedActive}</strong></span><span><small>Provider refresh</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>OnBreak deducted</small><strong>{providerBreak}</strong></span></div></>}
  </section>;
}

function TaskLifecycleMenu({ task, busy, initialOpen = false, onEdit, onArchive, onDelete }: {
  task: TaskRow; busy: boolean; initialOpen?: boolean; onEdit: (task: TaskRow) => void; onArchive: (task: TaskRow) => void; onDelete: (task: TaskRow) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  const choose = (action: (item: TaskRow) => void) => { setOpen(false); action(task); };
  return <div className={`dashboard-task-menu ${open ? "open" : ""}`} onClick={(event) => event.stopPropagation()}><EllipsisMenu open={open} label={`Actions for ${safeTaskText(task.title, "task")}`} disabled={busy} onToggle={() => setOpen((current) => !current)} onClose={() => setOpen(false)}>
    <button role="menuitem" onClick={() => choose(onEdit)}><Pencil size={14} /> Edit task</button>
    <button role="menuitem" onClick={() => choose(onArchive)}><Archive size={14} /> Archive <small>reversible</small></button>
    <button className="danger" role="menuitem" onClick={() => choose(onDelete)}><Trash2 size={14} /> Delete permanently</button>
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

export function ActiveDayWorkspace({ focus, focusSource, tasks, previousTasks, otherTasks, elapsed, progressPercent, shiftStart, shiftEnd, remaining, timezone, attendance, providerBreakSeconds, reviews, initialDetailView = null, initialDetailsMenuOpen = false, initialTaskMenuId = null, paused, busy, observedOnly = false, canPause, canClockOut = true, onEditFocus, onAddTask, onManageTasks, onOpenOverdue, currentDate = "", onOpenTask, onToggleTask, onEditTask, onArchiveTask, onDeleteTask, onPause, onClockOut, kpiStrip = null, goalSaveState = "saved", onRetryGoalSave, onRetryPendingTask, onDismissPendingTask }: {
  focus: string; focusSource: string; tasks: TaskRow[]; previousTasks: TaskRow[]; otherTasks: TaskRow[]; elapsed: string; progressPercent: number;
  shiftStart: string; shiftEnd: string; remaining: string; timezone?: string; attendance: DayData["attendance"] | null; providerBreakSeconds: number; reviews: number;
  initialDetailView?: "shift" | "worktivity" | null; initialDetailsMenuOpen?: boolean; initialTaskMenuId?: string | null; paused: boolean; busy: boolean; observedOnly?: boolean; canPause: boolean; canClockOut?: boolean;
  onEditFocus: () => void; onAddTask: () => void; onManageTasks: () => void; onOpenOverdue?: () => void; currentDate?: string; onOpenTask: (task: TaskRow) => void; onToggleTask: (task: TaskRow, completed: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask: (task: TaskRow) => void; onPause: () => void; onClockOut: () => void; kpiStrip?: ReactNode; goalSaveState?: "saved" | "saving" | "offline" | "conflict"; onRetryGoalSave?: () => void; onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void;
}) {
  const [tab, setTab] = useState<"today" | "previous" | "other">("today");
  const [detailsMenuOpen, setDetailsMenuOpen] = useState(initialDetailsMenuOpen || initialDetailView !== null);
  const [detailView, setDetailView] = useState<"shift" | "worktivity" | null>(initialDetailView);
  const displayed = tab === "today" ? tasks : tab === "previous" ? previousTasks : otherTasks;
  const countedTasks = tasks.filter((task) => !task.pending_status);
  const completed = countedTasks.filter((task) => task.completed === true).length;
  const today = currentDate || new Date().toISOString().slice(0, 10);
  const overdueCount = otherTasks.filter((task) => typeof task.due_date === "string" && task.due_date.slice(0, 10) < today).length + previousTasks.filter((task) => task.completed !== true && typeof task.due_date === "string" && task.due_date.slice(0, 10) < today).length;
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
        <div className="active-day-actions">{canPause && <button className="shift-action-button" disabled={busy} onClick={onPause}>{paused ? <CirclePlay size={15} aria-hidden="true" /> : <CirclePause size={15} aria-hidden="true" />}<span>{paused ? "Resume" : "Pause"}</span></button>}{canClockOut && <button className="shift-action-button" disabled={busy} onClick={onClockOut}>Clock out</button>}<div className="shift-details-menu"><button className="ellipsis-button" aria-label="Open workday details" aria-expanded={detailsMenuOpen} onClick={() => { setDetailsMenuOpen((current) => !current); setDetailView(null); }}><MoreHorizontal size={17} /></button>{detailsMenuOpen && <><button className="shift-popover-scrim" aria-label="Close workday details" onClick={() => { setDetailsMenuOpen(false); setDetailView(null); }} />{detailView ? <ShiftDetailsFloatingCard view={detailView} progressPercent={progressPercent} shiftStart={shiftStart} remaining={remaining} shiftEnd={shiftEnd} elapsed={elapsed} openTasks={tasks.filter((task) => !task.completed).length} reviews={reviews} attendance={attendance} timezone={timezone} observedActive={observedActive} providerBreak={providerBreak} onBack={() => setDetailView(null)} onClose={() => { setDetailsMenuOpen(false); setDetailView(null); }} /> : <div className="shift-details-options" role="menu"><button role="menuitem" onClick={() => setDetailView("shift")}><Clock3 size={14} /> Workday status</button><button role="menuitem" onClick={() => setDetailView("worktivity")}><Activity size={14} /> Worktivity details</button></div>}</>}</div></div>
      </header>
      <div className="active-focus-block"><div className="active-focus-copy"><span>Today’s focus</span><div className="active-focus-heading"><h2>{focus}</h2><button className="focus-edit-button" onClick={onEditFocus}><Pencil size={14} /> Update focus</button></div><small><Sparkles size={13} /> {focusSource}{goalSaveState === "saving" ? <FadeArc size={11} /> : goalSaveState === "offline" || goalSaveState === "conflict" ? <button type="button" className="goal-retry" title="Goal not saved — click to retry." aria-label="Retry saving the goal" onClick={() => onRetryGoalSave?.()}><RefreshCw size={11} /></button> : null}</small></div><div className="hero-task-metrics">{overdueCount > 0 && <button className="overdue-metric" onClick={() => onOpenOverdue?.()} aria-label={`${overdueCount} overdue tasks. Show unfinished work in Tasks.`}><span><strong>{overdueCount}</strong></span><em>overdue<br />{overdueCount === 1 ? "task" : "tasks"}</em></button>}</div>
        <div className="hero-task-metrics"><button className="hero-metric-button" onClick={() => setTab("today")} aria-label={`${completed} of ${tasks.length} tasks done today. Show Today tasks.`}><CompletionRing completed={completed} total={countedTasks.length} label="tasks done" /></button><button className={`carryover-metric ${pendingPrevious > 0 ? "pending" : "clear"}`} onClick={() => setTab("previous")} aria-label={`${pendingPrevious} pending task${pendingPrevious === 1 ? "" : "s"} from yesterday. Show Previous day tasks.`}><span><strong>{pendingPrevious}</strong></span><em>pending tasks<br />from yesterday</em></button></div></div>
      <div className="active-task-toolbar"><div className="active-task-tabs" role="tablist"><button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Today <em>{countedTasks.length}</em></button><button role="tab" aria-selected={tab === "previous"} className={tab === "previous" ? "active" : ""} onClick={() => setTab("previous")}>Previous day {previousTasks.length > 0 && <em className="alert-count">{previousTasks.length}</em>}</button><button role="tab" aria-selected={tab === "other"} className={tab === "other" ? "active" : ""} onClick={() => setTab("other")}>Other days {otherTasks.length > 0 && <em className="older-count">{otherTasks.length}</em>}</button></div><button className="primary add-day-task" onClick={onAddTask}><Plus size={15} /> Add task</button></div>
      {tab === "other" && otherTasks.length > 0 && <div className="older-task-notice" role="status"><span>{otherTasks.length}</span><strong>Older unfinished task{otherTasks.length === 1 ? "" : "s"}</strong><small>From before yesterday</small></div>}
      <div className="active-task-list">{displayed.length ? displayed.map((task) => { const taskId = String(task.provider_task_id || task.id); const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null; return <article className={`${task.completed ? "completed" : ""}${pendingStatus ? " pending" : ""}`} key={taskId}><button className="task-check" aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`} disabled={busy || pendingStatus !== null} onClick={() => { if (!pendingStatus) onToggleTask(task, !task.completed); }}>{task.completed && <Check size={15} />}</button><button className="active-task-copy" onClick={() => { if (!pendingStatus) onOpenTask(task); }}><strong>{task.title}</strong><small>{pendingStatus ? pendingStatus === "syncing" ? "Adding to your workspace…" : "Failed to add — retry or discard" : task.completed ? (typeof task.completed_at === "string" && task.completed_at ? `Completed ${formatWorkOsDate(task.completed_at.slice(0, 10))}` : "Completed") : task.priority ? `${sentence(String(task.priority))} priority` : task.due_date ? `Due ${formatWorkOsDate(task.due_date)}` : "Open today"}</small></button>{pendingStatus ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} /> : <span className={`task-status ${task.completed ? "done" : "open"}`}>{task.completed ? "Done" : "Open"}</span>}{!pendingStatus && <TaskLifecycleMenu task={task} busy={busy} initialOpen={initialTaskMenuId === taskId} onEdit={onEditTask} onArchive={onArchiveTask} onDelete={onDeleteTask} />}</article>; }) : <Empty title={tab === "today" ? "A clear day" : tab === "previous" ? "Nothing left behind" : "No older work pending"} body={tab === "today" ? "Add the first task you want to move forward today." : tab === "previous" ? "Yesterday’s open work has been cleared." : "Everything from before yesterday is complete."} />}</div>
      <footer className="active-day-footer"><span>Changes save to your workday record.</span><button className="workspace-link-button" onClick={onManageTasks}><span>Open full Tasks workspace</span><ChevronRight size={14} aria-hidden="true" /></button></footer>
    </section>
    {kpiStrip}
  </main>;
}

export function KpiStrip({ scheduledCount, yesterdayDueCount, completedCount, reviewCount, onScheduled, onYesterday, onCompleted, onReviews }: {
  scheduledCount: number; yesterdayDueCount: number; completedCount: number; reviewCount: number;
  onScheduled: () => void; onYesterday: () => void; onCompleted: () => void; onReviews: () => void;
}) {
  return <section className="kpi-strip" aria-label="Today at a glance">
    <button className="kpi-card" onClick={onScheduled}><small><ListChecks size={13} aria-hidden="true" /> Scheduled today</small><strong>{scheduledCount}</strong><em>{scheduledCount ? "Open the day view" : "Plan your day"}</em></button>
    <button className="kpi-card" disabled={!yesterdayDueCount} onClick={onYesterday}><small><AlertTriangle size={13} aria-hidden="true" /> Due from yesterday</small><strong className={yesterdayDueCount ? "kpi-danger" : undefined}>{yesterdayDueCount}</strong><em className={yesterdayDueCount ? "kpi-attention" : undefined}>{yesterdayDueCount ? "Review unfinished work" : "Nothing carried forward"}</em></button>
    <button className="kpi-card" disabled={!completedCount} onClick={onCompleted}><small><CheckCircle2 size={13} aria-hidden="true" /> Completed today</small><strong>{completedCount}</strong><em>{completedCount ? "Review the record" : "Finish a task first"}</em></button>
    <button className="kpi-card" disabled={!reviewCount} onClick={onReviews}><small><FileCheck2 size={13} aria-hidden="true" /> Reviews pending</small><strong>{reviewCount}</strong><em>{reviewCount ? "Needs your decision" : "Nothing awaiting review"}</em></button>
  </section>;
}

export function DashboardTaskCard({ task, currentDate, onOpen, onRetryPendingTask, onDismissPendingTask }: { task: TaskRow; currentDate: string; onOpen: () => void; onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void }) {
  const state = taskState(task, currentDate);
  const dueDate = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
  const title = safeTaskText(task.title, "Untitled Nifty task");
  const description = safeTaskText(task.description, "");
  const progress = subtaskProgress(task);
  const percent = progress.total ? Math.round((progress.completed / progress.total) * 100) : null;
  const filled = percent === null ? 0 : Math.round((percent / 100) * 12);
  const projectName = safeTaskText(task.project?.name, "Nifty");
  const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null;
  return <article className={`dashboard-task-card${pendingStatus ? " pending" : ""}`} role="button" tabIndex={0} onClick={() => { if (!pendingStatus) onOpen(); }} onKeyDown={(event) => { if (pendingStatus) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpen(); } }} aria-label={`Open ${title}`}>
    <span className={`task-due-chip ${state === "overdue" ? "danger" : ""}`}><CalendarDays size={12} aria-hidden="true" /> {pendingStatus ? "Adding to today" : dueDate ? `Due ${formatWorkOsDate(dueDate)}` : task.priority ? `${sentence(String(task.priority))} priority` : "No due date"}</span>
    <h3>{title}</h3>
    {description && <p>{description}</p>}
    <div className="dashboard-task-foot">
      {pendingStatus
        ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} />
        : percent === null
          ? <span className="task-due">{projectName !== "Nifty" ? projectName : "Nifty task"}</span>
          : <span className="progress-ticks" role="img" aria-label={`${percent}% of subtasks complete`}>{Array.from({ length: 12 }, (_, index) => <i key={index} className={index < filled ? "on" : undefined} />)}<em>{percent}%</em></span>}
    </div>
  </article>;
}

export function ProgressComposer({ mode = "progress", input, open, panel, pending, receipt, history = [], onClearChat, busy, required, goal, goalProvenance, goalSuggestion, saveState, interpretation = null, thinking = null, toolContext = { shiftDate: null, personId: null, promptKind: "optional" }, aiUnavailable = null, onInput, onOpen, onOpenGoal, onClose, onSubmit, onClassify, onGoal, onAcceptSuggestion, onToggleOperation, onEditOperation, onRemapOperation, onDenyOperation, onApproveOperations, onMarkSelectedDone, onNavigateView }: {
  mode?: ComposerMode;
  input: string; open: boolean; panel: ProgressPanel; pending: string; receipt: ProgressReceipt | null; history?: WorkOsConversationTurn[]; onClearChat?: () => void; busy: boolean; required: boolean; goal: string;
  goalProvenance: "employee" | "accepted_suggestion" | null; goalSuggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  onInput: (value: string) => void; onOpen: () => void; onOpenGoal: () => void; onClose: () => void; onSubmit: () => void; onClassify: (kind: ProgressUpdateKind) => void; onGoal: (value: string) => void; onAcceptSuggestion: () => void;
  interpretation?: { status: "loading" | "ready"; operations: Array<import("./interpretation").ProposedOperation>; taskOptions: Array<{ id: string; title: string }>; reply?: string; results?: ToolCallResult[] } | null;
  thinking?: { stages: AvatarThinkingStage[]; active: number; startedAt: number } | null;
  toolContext?: import("./interpretation").ApprovedOpContext;
  aiUnavailable?: string | null;
  onToggleOperation?: (index: number) => void; onNavigateView?: (page: import("./interpretation").NavigatePage) => void; onEditOperation?: (index: number, statement: string) => void; onRemapOperation?: (index: number, taskId: string) => void; onDenyOperation?: (index: number) => void; onApproveOperations?: (operations: Array<import("./interpretation").ProposedOperation>) => void; onMarkSelectedDone?: (taskIds: string[]) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length, interpretation, pending, receipt, open]);
  const options: Array<{ kind: ProgressUpdateKind; label: string }> = [
    { kind: "material_progress", label: "Progress" }, { kind: "completion_claim", label: "Completed work" },
    { kind: "blocked", label: "Blocker" }, { kind: "priority_change", label: "Priority change" }, { kind: "new_task", label: "New task" },
  ];
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  const agendaMode = mode === "agenda";
  const visibleHistory = collapseConsecutiveAssistantDuplicates(history);
  const lastAssistantText = [...visibleHistory].reverse().find((turn) => turn.role === "assistant")?.text.trim() ?? null;
  const echoReply = interpretation?.status === "ready" && !interpretation.operations.length && interpretation.reply && interpretation.reply.trim() !== lastAssistantText ? interpretation.reply : null;
  const receiptTitle = receipt?.kind === "new_task"
    ? receipt.queued ? "Task queued" : "Task added"
    : receipt?.queued ? "Update queued" : "Update recorded";
  return <div className={`progress-dock ${agendaMode ? "agenda-dock" : "progress-mode"} ${open ? "open" : ""}`}>
    {open && <section className={`progress-flyout ${panel === "goal" ? "goal-flyout" : agendaMode ? "agenda-flyout" : ""}`} role="dialog" aria-label={panel === "goal" ? "Daily focus editor" : "Daily update composer"}>
      <header className="workos-chat-head"><ChatTabs tabs={[{ id: "update", label: agendaMode ? "Agenda" : "Update" }, { id: "goal", label: "Focus" }]} active={panel} onSelect={(id) => { if (id === "goal") onOpenGoal(); else onOpen(); }} ariaLabel="Composer view" /><span className="progress-header-actions">{panel !== "goal" && <button aria-label="Start a new chat" title="Start a new chat" onClick={onClearChat}><Plus size={15} /></button>}<button aria-label="Close composer" onClick={onClose}><X size={16} /></button></span></header>
      {panel === "goal" ? <p className="workos-chat-sub">{`${goalProvenance === "accepted_suggestion" ? "Accepted suggestion" : goal ? "Written by you" : "Optional context"} · ${saveLabel}`}</p> : required ? <p className="workos-chat-sub">An update is due</p> : null}
      {panel === "goal" ? <div className="goal-composer-panel"><div className="goal-editor-field"><label htmlFor="daily-focus-input">What is the goal for today?</label><textarea id="daily-focus-input" aria-describedby="daily-focus-help" autoFocus maxLength={4000} value={goal} onChange={(event) => onGoal(event.target.value)} placeholder="Add context that is not obvious from your tasks" /><small id="daily-focus-help">Tasks remain the source of work intent. This note adds context and does not affect attendance.</small></div>{!goal && goalSuggestion && <div className="goal-suggestion composer-goal-suggestion"><Sparkles size={16} /><div><strong>Suggested from today’s tasks</strong><p>{goalSuggestion.text}</p></div><button onClick={onAcceptSuggestion}>Use suggestion</button></div>}</div> : <div className="progress-conversation workos-thread" ref={conversationRef}>{visibleHistory.length > 0 && <div className="progress-history">{visibleHistory.map((turn, index) => turn.role === "user"
        ? <div className="progress-message user" key={index}><ChatMarkdown text={turn.text} /></div>
        : <div className="progress-message assistant" key={index}><Sparkles size={16} /><div><ChatMarkdown text={turn.text} />{turn.meta === "recorded" ? <small>Recorded</small> : turn.meta ? <small>{turn.meta} — review them below</small> : null}</div></div>)}</div>}{receipt ? <div className="progress-message assistant"><CheckCircle2 size={16} /><div><strong>{receiptTitle}</strong><p>{receipt.message}</p></div></div> : pending ? <>{interpretation?.status === "loading" ? <div className="progress-message assistant">{thinking ? <AvatarThinking stages={thinking.stages} active={thinking.active} startedAt={thinking.startedAt} activeLabel="Thinking" /> : <><Sparkles size={16} /><div><strong>Reading your update…</strong><p>Matching it to today's tasks.</p></div></>}</div>
   : echoReply ? <div className="progress-message assistant"><Sparkles size={16} /><div><ChatMarkdown text={echoReply} /></div></div>
       : interpretation?.status === "ready" && interpretation.operations.length ? <div className="progress-message assistant"><Sparkles size={16} /><div><strong>{interpretation.operations.some((op) => isMutatingToolOp(op)) ? (interpretation.results ? "Tool call results" : "Review assistant tool calls") : "Assistant shortcuts"}</strong>{interpretation.reply ? <ChatMarkdown text={interpretation.reply} /> : null}<p>{interpretation.operations.some((op) => isMutatingToolOp(op)) ? (interpretation.results ? "Each result is retained below." : "Review the exact command for each proposal. Nothing runs until you approve it.") : "Loaded inline below \u2014 viewing never needs approval."}</p><ChatSectionBoundary label="assistant tool calls"><div className="interpretation-list">{interpretation.operations.map((op, index) => { const result = interpretation.results?.find((item) => item.op === op || (op.proposalId !== undefined && item.op.proposalId === op.proposalId)); const selection = (result?.data as { provider_result?: { view?: "pending" | "overdue"; tasks?: Array<Record<string, unknown>> } } | undefined)?.provider_result; const selectionTasks: TaskSelectionCardTask[] = Array.isArray(selection?.tasks) ? selection.tasks.map((task) => ({ id: String(task.id ?? ""), title: typeof task.title === "string" ? task.title : "Untitled Nifty task", description: typeof task.description === "string" ? task.description : null, dueDate: typeof task.due_date === "string" ? task.due_date : null, priority: typeof task.priority === "string" ? task.priority : null, state: selection?.view === "overdue" ? "overdue" : "pending" })).filter((task) => !!task.id) : []; const isDisplay = isDisplayToolOp(op); if (op.op === "navigate_to_page" && op.page) return <div key={index}><NavigateButton page={op.page} statement={op.statement} onNavigate={(page) => onNavigateView?.(page)} /></div>; return <div key={index}>{isDisplay ? null : <ToolApprovalCard op={op} context={toolContext} result={result} index={index} total={interpretation.operations.length} onToggle={() => onToggleOperation?.(index)} onDeny={() => onDenyOperation?.(index)}>{result ? <p className="interpretation-statement-filed">{op.statement}</p> : <input className="interpretation-statement" value={op.statement} maxLength={1000} onChange={(event) => onEditOperation?.(index, event.target.value)} aria-label="Proposed update text" />}{!result && (op.op === "complete_task" || op.op === "reopen_task" || op.op === "record_progress") && interpretation.taskOptions.length > 0 && <select value={op.taskId ?? ""} onChange={(event) => onRemapOperation?.(index, event.target.value)} aria-label="Attach to task"><option value="">No task</option>{interpretation.taskOptions.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>}</ToolApprovalCard>}{isDisplay && result?.status === "failed" ? <p className="tool-display-error">{result.message}</p> : null}{selection && <TaskSelectionCard title={selection.view === "overdue" ? "Overdue tasks" : "Pending tasks"} tasks={selectionTasks} onMarkSelectedDone={onMarkSelectedDone ?? (() => undefined)} emptyTitle={selection.view === "overdue" ? "No overdue tasks" : "No pending tasks"} emptyMessage={selection.view === "overdue" ? "Nothing is past its due date." : "Tasks waiting to be completed will appear here."} />}</div>; })}</div></ChatSectionBoundary><button className="primary approve-interpretation" disabled={busy || !interpretation.operations.some((op) => op.enabled && !interpretation.results?.some((result) => result.op.proposalId === op.proposalId))} onClick={() => onApproveOperations?.(interpretation.operations.filter((op) => !interpretation.results?.some((result) => result.op.proposalId === op.proposalId)))}>Approve &amp; record {interpretation.operations.filter((op) => op.enabled && !interpretation.results?.some((result) => result.op.proposalId === op.proposalId)).length} tool call{interpretation.operations.filter((op) => op.enabled && !interpretation.results?.some((result) => result.op.proposalId === op.proposalId)).length === 1 ? "" : "s"}</button></div></div>

  : interpretation?.status === "ready" ? null
  : <div className="progress-message assistant"><Sparkles size={16} /><div><strong>{aiUnavailable ?? "What kind of update is this?"}</strong><p>Choose one so Work OS records it correctly.{aiUnavailable ? "" : " Nothing is inferred yet."}</p><div className="progress-kind-options">{options.map((option) => <button disabled={busy} key={option.kind} onClick={() => onClassify(option.kind)}>{option.label}</button>)}</div></div></div>}</> : history.length ? null : <div className={`progress-welcome ${agendaMode ? "agenda-welcome" : ""}`}><Sparkles size={17} /><div><strong>What would you like to record?</strong><p>Share progress, completed work, a blocker, a priority change, or a new task. You’ll choose the type after sending.</p></div></div>}</div>}
    </section>}
    <div className="progress-input-shell"><WorkOsPromptBar value={input} onChange={onInput} onSend={onSubmit} onFocus={onOpen} placeholder={agendaMode ? "Add a task — planning doesn't clock you in…" : open ? "Share an update, a blocker, or add a task…" : "Share an update or add a task…"} ariaLabel="Share an update or add a task" canSend={!!input.trim()} busy={busy} commands={workOsChatCommands({ focus: () => onOpenGoal(), eod: () => onNavigateView?.("review") })} footerLeft={<button className={`focus-dock-button ${panel === "goal" && open ? "active" : ""}`} aria-label="Update today’s focus" aria-pressed={panel === "goal" && open} onClick={onOpenGoal}><Pencil size={15} /><span>Focus</span></button>} sendLabel="Review update type" /></div>
  </div>;
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
  const providerClockOut = attendance?.clockedOutAt
    ? formatTime(attendance.clockedOutAt, timezone)
    : attendance?.state === "active" || attendance?.state === "paused" ? "Still active" : attendance?.clockedInAt ? "Not observed" : "—";
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
    <div className="card-title pulse-title"><span><Activity size={17} /> Shift pulse</span><div className="pulse-card-controls"><small><i className={active ? "live" : attendance?.state === "active" ? "observed" : ""} />{state}</small><div className="pulse-disclosure" ref={disclosureRef}><button className="ellipsis-button pulse-more" aria-label="Shift pulse options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => { setMenuOpen((value) => !value); setDetailsOpen(false); }}><MoreHorizontal size={17} /></button>{menuOpen && <div className="pulse-menu" role="menu" onKeyDown={(event) => moveMenuFocus(event.nativeEvent)}><button role="menuitem" autoFocus onClick={() => { setMenuOpen(false); setDetailsOpen(true); }}><Activity size={15} /><span><strong>Worktivity status</strong><small>View observed attendance</small></span><ChevronRight size={14} /></button></div>}{detailsOpen && <section className={`pulse-provider-popover ${observationClass}`} role="dialog" aria-label="Worktivity status"><header><div><Activity size={16} /><span><small>Worktivity observation</small><strong>{providerState}</strong></span></div><button aria-label="Close Worktivity status" onClick={() => setDetailsOpen(false)}><X size={15} /></button></header><div className="pulse-provider-facts"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{providerClockOut}</strong></span><span><small>Last activity</small><strong>{attendance?.activityObservedAt ? formatTime(attendance.activityObservedAt, timezone) : "—"}</strong></span><span><small>Observed active time</small><strong>{pulse.observedElapsedLabel}</strong></span><span><small>Provider refresh</small><strong>{attendance?.observedAt ? formatTime(attendance.observedAt, timezone) : "—"}</strong></span><span><small>OnBreak deducted</small><strong>{pulse.observedBreakLabel}</strong></span></div><footer>Observed provider data remains separate from your Work OS session.</footer></section>}</div></div></div>
    <div className="pulse-countdown" role="img" aria-label={scheduleAria}>
      <div className="pulse-countdown-copy"><small>{middleLabel}</small><strong>{middleValue}</strong><span>{phaseCaption}</span></div>
      <div className="pulse-window"><CalendarDays size={17} /><div><small>{scheduleLabel}</small><strong>{formatTime(shift?.startsAt, timezone)} <i>to</i> {formatTime(shift?.endsAt, timezone)}</strong></div></div>
    </div>
    <div className="pulse-compact-track" aria-hidden="true"><div><i style={{ width: `${pulse.progressPercent}%` }} /><b style={{ left: `clamp(5px, ${pulse.progressPercent}%, calc(100% - 5px))` }} /></div><span><small>{formatTime(shift?.startsAt, timezone)}</small><small>{scheduleStatus}</small><small>{formatTime(shift?.endsAt, timezone)}</small></span></div>
    <p className="pulse-separation-note"><Clock3 size={13} /> Clock in when you begin. Activity observation stays separate.</p>
  </section>;
}

function proposalTitle(proposal: Record<string, any>) {
  return String(proposal.proposed_change?.name || proposal.proposed_change?.title || proposal.proposed_change?.summary || proposal.input_text || "Proposed workspace change");
}

function proposalFields(proposal: Record<string, any>) {
  const change = proposal.proposed_change && typeof proposal.proposed_change === "object" ? proposal.proposed_change : {};
  return Object.entries(change)
    .filter(([key, value]) => !["name", "title", "summary"].includes(key) && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 3)
    .map(([key, value]) => ({ label: sentence(key), value: String(value) }));
}

function ReviewWorkspace({ proposals, busy, onReject, onApprove }: { proposals: Array<Record<string, any>>; busy: boolean; onReject: (id: string) => void; onApprove: (id: string) => void }) {
  const pending = proposals.filter((proposal) => proposal.status === "pending").length;
  return <main className="page review-page">
    <div className="review-heading"><PageIntro eyebrow="Human in the loop" title="Review before anything changes." body="See exactly what you said, what Work OS interpreted, and what would be written back. Nothing reaches Nifty without your decision." /><div className="review-count"><strong>{pending}</strong><span>awaiting<br />your review</span></div></div>
    <section className="review-control" aria-label="Review control flow">
      <div className="review-control-copy"><ShieldCheck size={20} /><div><strong>You are the write barrier.</strong><small>Proposals remain drafts until you approve them.</small></div></div>
      <div className="review-flow">
        <span className="complete"><i>1</i><small>Your update</small></span><MoveRight size={15} /><span className="complete"><i>2</i><small>Structured draft</small></span><MoveRight size={15} /><span className={pending ? "current" : "complete"}><i>3</i><small>Your decision</small></span><MoveRight size={15} /><span><i>4</i><small>Nifty write-back</small></span>
      </div>
    </section>
    {proposals.length ? <section className="proposal-list">{proposals.map((proposal, index) => {
      const fields = proposalFields(proposal);
      const actionable = proposal.status === "pending";
      return <article className="proposal-card" key={proposal.id}>
        <header><div className="proposal-index">{String(index + 1).padStart(2, "0")}</div><div><span>{sentence(String(proposal.operation || "workspace_change"))}</span><h3>{proposalTitle(proposal)}</h3></div><em>{sentence(String(proposal.status || "pending"))}</em></header>
        <div className="proposal-compare">
          <section><span>What you said</span><blockquote>{proposal.input_text || "The original statement was preserved with this proposal."}</blockquote></section>
          <MoveRight size={18} />
          <section><span>Proposed change</span><strong>{proposalTitle(proposal)}</strong>{fields.length > 0 && <dl>{fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}</section>
        </div>
        <footer><small><ShieldCheck size={13} /> {actionable ? "No provider change has been made." : "This proposal already has a recorded decision."}</small><div><button disabled={busy || !actionable} onClick={() => onReject(String(proposal.id))}>Reject</button><button className="primary" disabled={busy || !actionable} onClick={() => onApprove(String(proposal.id))}><Check size={15} /> Approve change</button></div></footer>
      </article>;
    })}</section> : <section className="review-empty"><div><Check size={24} /></div><span>Review queue</span><h3>Everything is clear.</h3><p>No proposed changes are waiting. New interpretations will appear here before any write-back.</p></section>}
  </main>;
}

export function TasksWorkspace({ currentDate, historyDate, currentPlan, historicalPlan, historicalTasks, goal, goalProvenance, suggestion, saveState, taskView, todayTasks, taskHistory, carryOver, carryOverOpen, loadingMore, hasMore, busy, initialTaskMenuId = null, initialSearch = "", initialFiltersOpen = false, loading = false, onTaskView, onDate, onEditFocus, onAddTask, onOpenTask, onEditTask, onArchiveTask, onDeleteTask = () => undefined, onSurfaceTask, onTaskCompletion, onCarryOverOpen, onLoadMore, onRetryPendingTask, onDismissPendingTask, onRetryGoalSave }: {
  currentDate: string; historyDate: string; currentPlan: DailyPlan | null; historicalPlan: DailyPlan | null; historicalTasks: TaskRow[]; goal: string;
  goalProvenance: "employee" | "accepted_suggestion" | null; suggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  taskView: TaskView; todayTasks: TaskRow[]; taskHistory: TaskRow[]; carryOver: ReturnType<typeof unfinishedBefore>; carryOverOpen: boolean;
  loadingMore: boolean; hasMore: boolean; busy: boolean; onTaskView: (view: TaskView) => void; onDate: (date: string) => Promise<void>;
  onEditFocus: () => void; onAddTask: () => void; onOpenTask: (task: TaskRow, readOnly: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask?: (task: TaskRow) => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void; onTaskCompletion: (task: TaskRow, completed: boolean) => void; onCarryOverOpen: (open: boolean) => void; onLoadMore: () => void;
  onRetryPendingTask?: (task: TaskRow) => void; onDismissPendingTask?: (task: TaskRow) => void; onRetryGoalSave?: () => void;
  initialTaskMenuId?: string | null; initialSearch?: string; initialFiltersOpen?: boolean; loading?: boolean;
}) {
  const [taskMenuId, setTaskMenuId] = useState<string | null>(initialTaskMenuId);
  const [taskSearch, setTaskSearch] = useState(initialSearch);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(initialFiltersOpen);
  const selectedDate = historyDate || currentDate;
  const historical = selectedDate !== currentDate;
  const shownPlan = historical ? historicalPlan : currentPlan;
  const historyById = new Map<string, TaskRow>();
  for (const task of [...taskHistory, ...historicalTasks]) {
    historyById.set(String(task.id), task);
    if (task.provider_task_id) historyById.set(String(task.provider_task_id), task);
  }
  const surfaced = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => historyById.get(String(item.task_id)) ?? {
    id: item.task_id, title: item.title_snapshot, completed: item.completion_state === "completed", workspace_source: item.source,
  });
  const surfacedIds = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => String(item.task_id));
  const rowId = (task: TaskRow) => String(task.provider_task_id || task.id);
  // My day is strictly day-scoped: surfaced by today's plan, due today, or
  // created today. Everything else open lives in Unfinished.
  const myDayTasks = parentTasks(tasksForDate(uniqueTasks([...todayTasks, ...surfaced]), currentDate, surfacedIds));
  const myDayIds = new Set(myDayTasks.map(rowId));
  const unfinishedTasks = taskHistory.filter((task) => task.completed !== true && !myDayIds.has(rowId(task)));
  const completedTasks = taskHistory.filter((task) => task.completed === true);
  const datedTasks = parentTasks(tasksForDate([...historicalTasks, ...surfaced], selectedDate, surfacedIds));
  const displayedCandidates = historical
    ? datedTasks
    : taskView === "today" ? myDayTasks
      : taskView === "unfinished" ? unfinishedTasks
        : taskView === "completed" ? completedTasks
          : taskHistory;
  const unfiltered = parentTasks(uniqueTasks(displayedCandidates));
  const displayed = filterWorkspaceTasks(unfiltered, currentDate, { query: taskSearch, from: filterFrom, to: filterTo });
  const hasFilters = taskSearch.trim().length > 0 || filterFrom.length > 0 || filterTo.length > 0;
  const viewLabel = taskView === "today" ? "My day" : taskView === "unfinished" ? "Unfinished" : taskView === "completed" ? "Completed" : "All tasks";
  const chipCounts: Array<{ id: TaskView; label: string; count: number }> = [
    { id: "today", label: "My day", count: myDayTasks.filter((task) => task.completed !== true).length },
    { id: "unfinished", label: "Unfinished", count: unfinishedTasks.length },
    { id: "completed", label: "Completed", count: completedTasks.length },
    { id: "all", label: "All tasks", count: taskHistory.length },
  ];
  const todaySections = (): TaskSection[] => {
    const open = orderTasksByRecency(displayed.filter((task) => task.completed !== true));
    const done = orderTasksByRecency(displayed.filter((task) => task.completed === true));
    return [
      open.length ? { id: "open", label: "Scheduled today", note: "Latest activity first", tasks: open } : null,
      done.length ? { id: "completed", label: "Completed today", note: "Latest completion first", tasks: done } : null,
    ].filter((section): section is TaskSection => section !== null);
  };
  const displayedSections: TaskSection[] = historical
    ? displayed.length ? [{ id: "open", label: "Tasks from this day", note: "Latest activity first", tasks: orderTasksByRecency(displayed) }] : []
    : taskView === "today" ? todaySections()
      : organizeTaskSections(displayed, currentDate);
  const selectedIds = new Set((currentPlan?.items ?? []).filter((item) => item.disposition === "selected" && item.task_id).map((item) => String(item.task_id)));
  const groups = new Map<string, typeof carryOver>();
  for (const item of carryOver) {
    const key = item.attribution.date ?? "Older";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const carryGroups = [...groups.entries()].map(([date, items]) => ({ date, label: date === moveDate(currentDate, -1) ? `Yesterday · ${formatWorkOsDate(date)}` : formatWorkOsDate(date), items }));
  const agendaText = historical
    ? shownPlan?.freeform_intent || "No focus note was recorded for this day."
    : goal || suggestion?.text || "Your open tasks define today’s work.";
  const provenance = historical
    ? !shownPlan?.freeform_intent ? "Task record" : shownPlan.goal_provenance === "accepted_suggestion" ? "Accepted from that day’s tasks" : "Written on this day"
    : goal ? goalProvenance === "accepted_suggestion" ? "Accepted from today’s tasks" : "Written by you" : suggestion ? "Suggested from today’s tasks" : "Task record";
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  const dateFilterActive = !!filterFrom || !!filterTo;
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
      ? { title: "No tasks surfaced", body: "No Nifty tasks were recorded for this day." }
      : taskView === "today"
        ? { title: "Nothing is scheduled for today yet", body: "Pull unfinished work forward or add a task to shape the day." }
        : taskView === "unfinished"
          ? { title: "No unfinished work", body: "Open tasks from previous days will appear here." }
          : taskView === "completed"
            ? { title: "No completed tasks", body: "Completed tasks will appear here." }
            : { title: "No tasks yet", body: "Add your first task to get started." };
  return <main className="page tasks-workspace">
    <div className="tasks-heading-row">
      <h1>{historical ? "Workday history" : "Tasks"}</h1>
      <div className="date-navigator"><button aria-label="Previous day" onClick={() => void onDate(moveDate(selectedDate, -1))}><ChevronLeft size={16} /></button><label className="formatted-date-picker"><span>{formatWorkOsDate(selectedDate)}</span><input aria-label="Workspace date" type="date" max={currentDate} value={selectedDate} onChange={(event) => void onDate(event.target.value)} /></label><button aria-label="Next day" disabled={selectedDate >= currentDate} onClick={() => void onDate(moveDate(selectedDate, 1))}><ChevronRight size={16} /></button></div>
    </div>
    <section className={`panel task-agenda-strip ${historical ? "historical" : ""}`} aria-label="Agenda">
      <div className="agenda-strip-focus">
        {!historical ? <button type="button" className="agenda-strip-edit" onClick={onEditFocus} title="Edit focus"><Pencil size={13} aria-hidden="true" /><span className="agenda-strip-text">{agendaText}</span></button> : <span className="agenda-strip-text">{agendaText}</span>}
        <small className="agenda-strip-meta">{provenance}{!historical ? ` · ${saveLabel}` : ""}{!historical && saveState === "saving" ? <FadeArc size={11} /> : null}{!historical && (saveState === "offline" || saveState === "conflict") ? <button type="button" className="goal-retry" title={saveState === "conflict" ? "Goal not saved — refresh the day, then retry." : "Goal not saved — click to retry."} aria-label="Retry saving the goal" onClick={() => onRetryGoalSave?.()}><RefreshCw size={11} /></button> : null}</small>
      </div>
      {!historical && <>
        <div className="agenda-strip-chips" role="tablist" aria-label="Task views">{chipCounts.map(({ id, label, count }) => <button key={id} role="tab" aria-selected={taskView === id} className={`agenda-strip-chip ${taskView === id ? "active" : ""}`} onClick={() => onTaskView(id)}>{label}<em>{count}</em></button>)}</div>
        {carryOver.length > 0 && <button className="agenda-strip-carry" onClick={() => onCarryOverOpen(true)}><AlertTriangle size={13} aria-hidden="true" /> Review unfinished work <ChevronRight size={13} aria-hidden="true" /></button>}
      </>}
    </section>
    <section className="task-search-toolbar" aria-label="Task search and date filters">
      <label className="task-search"><Search size={16} aria-hidden="true" /><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" />{taskSearch && <button aria-label="Clear task search" onClick={() => setTaskSearch("")}><X size={14} /></button>}</label>
      <div className="task-filters-wrap">
        <button type="button" className={`task-filters-toggle ${dateFilterActive ? "active" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><CalendarDays size={15} aria-hidden="true" /> Date range{dateFilterActive ? " · on" : ""}</button>
        {filtersOpen && <div className="task-filters-popover" role="group" aria-label="Task date range">
          <label><span>From</span><input aria-label="Filter from date" type="date" max={filterTo || currentDate} value={filterFrom} onChange={(event) => setFilterFrom(event.target.value)} /></label>
          <i aria-hidden="true">—</i>
          <label><span>To</span><input aria-label="Filter to date" type="date" min={filterFrom || undefined} max={currentDate} value={filterTo} onChange={(event) => setFilterTo(event.target.value)} /></label>
          {dateFilterActive && <button onClick={() => { setFilterFrom(""); setFilterTo(""); }}>Clear dates</button>}
        </div>}
      </div>
    </section>
    <section className="panel task-list-panel"><div className="card-title"><span><ListChecks size={17} /> {historical ? formatWorkOsDate(selectedDate) : viewLabel}{hasFilters && <small className="task-filter-result" role="status">{displayed.length} result{displayed.length === 1 ? "" : "s"}</small>}</span>{!historical && <button className="primary" onClick={onAddTask}><Plus size={15} /> Add task</button>}</div><div className="evidence-list task-records">{loading && !displayed.length ? <TaskListSkeleton rows={6} /> : displayedSections.length ? displayedSections.map((section) => <section className={`task-record-section ${section.id}`} key={section.id}><header><div><strong>{section.label}</strong><span>{section.tasks.length}</span></div><small>{section.note}</small></header>{section.tasks.map((task) => {
      const attribution = taskDateAttribution(task, currentDate);
      const taskId = rowId(task);
      const menuOpen = taskMenuId === taskId;
      const progress = subtaskProgress(task);
      const isSelected = selectedIds.has(String(task.id)) || selectedIds.has(String(task.provider_task_id));
      const state = taskState(task, currentDate);
      const title = safeTaskText(task.title, "Untitled Nifty task");
      const description = safeTaskText(task.description, "");
      const projectName = safeTaskText(task.project?.name, "Nifty");
      const milestoneName = safeTaskText(task.milestone?.name, "");
      const dueDate = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}/.test(task.due_date) ? task.due_date.slice(0, 10) : null;
      const metaParts = [projectName !== "Nifty" ? projectName : null, milestoneName || null, task.priority ? `${sentence(String(task.priority))} priority` : null].filter(Boolean) as string[];
      // Per-row provenance is warning-only; a healthy "synced" chip on every
      // row is noise. The detail modal keeps the full provenance chip.
      const showSyncChip = !task.completed && (Boolean(task.sync_error) || !task.synced_at);
      const stateLabel = state === "complete" ? "Done" : sentence(state);
      const pendingStatus = typeof task.pending_status === "string" ? task.pending_status as "syncing" | "failed" : null;
      const syncPending = !task.completed && (Boolean(task.sync_error) || !task.synced_at);
      return <article className={`task-record workspace-task ${task.completed ? "is-completed" : ""}`} role="button" tabIndex={0} key={taskId} aria-selected={isSelected} onClick={() => { if (!pendingStatus) onOpenTask(task, historical); }} onKeyDown={(event) => { if (pendingStatus) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task, historical); } }}><button className="task-check" aria-label={task.completed ? `Reopen ${title}` : `Complete ${title}`} disabled={busy || historical || pendingStatus !== null} onClick={(event) => { event.stopPropagation(); if (!pendingStatus) onTaskCompletion(task, !task.completed); }}>{task.completed && <Check size={14} />}</button><div className="task-row-body"><div className="task-row-line primary-line"><h3>{title}</h3>{isSelected && <span className="surfaced-tag">On today</span>}</div>{(metaParts.length > 0 || description || syncPending) && <div className="task-row-line secondary-line"><AssigneeTags task={task} />{metaParts.length > 0 && <small>{metaParts.join(" · ")}</small>}{syncPending && <small className="sync-warn">sync pending</small>}</div>}{description && <p className="task-row-desc">{description}</p>}</div>{!pendingStatus && progress.total > 0 && <span className="task-row-ring"><CompletionRing compact completed={progress.completed} total={progress.total} label="subtasks" /></span>}{!pendingStatus && dueDate && <span className={`task-due ${state === "overdue" ? "danger" : ""}`}>{formatWorkOsDate(dueDate)}</span>}{pendingStatus ? <PendingTaskControls status={pendingStatus} error={task.pending_error} onRetry={() => onRetryPendingTask?.(task)} onDismiss={() => onDismissPendingTask?.(task)} /> : <span className={`task-state ${state}`}>{stateLabel}</span>}{!historical && !pendingStatus && <div className={`workspace-task-menu ${menuOpen ? "open" : ""}`} onClick={(event) => event.stopPropagation()}><EllipsisMenu open={menuOpen} label={`Actions for ${title}`} disabled={busy} onToggle={() => setTaskMenuId(menuOpen ? null : taskId)} onClose={() => setTaskMenuId(null)}>{!task.completed && !isSelected && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task); }}><Plus size={14} /> Add to today</button>}{!task.completed && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task, "deferred"); }}><CirclePause size={14} /> Defer</button>}<button role="menuitem" onClick={() => { setTaskMenuId(null); onTaskCompletion(task, !task.completed); }}>{task.completed ? <RotateCcw size={14} /> : <Check size={14} />} {task.completed ? "Reopen task" : "Mark task done"}</button><button role="menuitem" onClick={() => { setTaskMenuId(null); onEditTask(task); }}><Pencil size={14} /> Edit task</button><button role="menuitem" onClick={() => { setTaskMenuId(null); onArchiveTask(task); }}><Archive size={14} /> Archive <small>reversible</small></button><button className="danger" role="menuitem" onClick={() => { setTaskMenuId(null); onDeleteTask(task); }}><Trash2 size={14} /> Delete permanently</button>{attribution.date && attribution.date < currentDate && <button role="menuitem" onClick={() => { setTaskMenuId(null); void onDate(attribution.date!); }}><ChevronLeft size={14} /> Open original day</button>}</EllipsisMenu></div>}</article>;
    })}</section>) : <div className="task-empty"><Empty title={emptyCopy.title} body={emptyCopy.body} />{taskView === "today" && !hasFilters && carryOver.length > 0 && <button className="task-empty-action" onClick={() => onCarryOverOpen(true)}><AlertTriangle size={14} aria-hidden="true" /> Review unfinished work</button>}</div>}</div>{loadingMore && <TaskListSkeleton rows={2} />}{!historical && hasMore && <button className="task-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? <><FadeArc size={13} /> Loading older tasks…</> : "Load older tasks"}</button>}</section>
    {carryOverOpen && <TaskCarryOverFlyout groups={carryGroups} busy={busy} onClose={() => onCarryOverOpen(false)} onSurfaceTask={onSurfaceTask} onTaskCompletion={onTaskCompletion} onOpenDay={(date) => { onCarryOverOpen(false); void onDate(date); }} />}
  </main>;
}
const durationLabel = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;

function PersonalInsights({ data, loading, range, onRange, onReference, onCorrect }: { data: InsightsData | null; loading: boolean; range: "day" | "7d" | "30d"; onRange: (value: "day" | "7d" | "30d") => void; onReference: (reference: InsightDay["references"][number]) => void; onCorrect: (quality: NonNullable<InsightDay["sessionQuality"]>, date: string) => void }) {
  const notifications = useNotifications();
  const [synthesis, setSynthesis] = useState<{ status: "loading" | "ready" | "failed"; text?: string } | null>(null);
  const liveInsights = new URLSearchParams(window.location.search).has("liveinsights");
  const synthesize = () => {
    if (!data || synthesis?.status === "loading") return;
    setSynthesis({ status: "loading" });
    apiRequest<{ synthesis: string }>("/api/work-os/me/insights/synthesize", {
      method: "POST", body: JSON.stringify({ range, through: data.through }),
    }).then((result) => setSynthesis({ status: "ready", text: String(result.synthesis) }))
      .catch(() => {
        setSynthesis({ status: "failed" });
        notifications.info("The assistant is unavailable — the deterministic brief below stands as-is.", "Synthesis unavailable");
      });
  };
  const latest = data?.days.at(-1);
  const activityTotals = (() => {
    const byApp = new Map<string, number>();
    let trackedMinutes = 0;
    for (const day of data?.days ?? []) {
      trackedMinutes += day.trackedMinutes ?? 0;
      for (const app of day.topApps ?? []) byApp.set(app.name, (byApp.get(app.name) ?? 0) + app.minutes);
    }
    return { trackedMinutes, topApps: [...byApp.entries()].map(([name, minutes]) => ({ name, minutes })).sort((left, right) => right.minutes - left.minutes).slice(0, 5) };
  })();
  const staleAt = data?.freshness.staleAt ?? null;
  const correctionMessage = latest?.sessionQuality?.status === "needs_correction"
    ? latest.sessionQuality.message || "This session needs correction before duration can be reported."
    : null;
  useEffect(() => {
    if (!data?.freshness.stale) return;
    notifications.persistent("insights-stale-data", `Retained insight data is stale${staleAt ? ` as of ${formatWorkOsDateTime(staleAt)}` : ""}. Refresh is pending.`, "Insights refresh pending", "info");
  }, [data?.freshness.stale, notifications, staleAt]);
  useEffect(() => {
    if (!correctionMessage) return;
    notifications.persistent("insights-session-correction", correctionMessage, "Session needs correction", "error");
  }, [correctionMessage, notifications]);
  return <main className="page insights-page"><div className="insights-heading"><PageIntro eyebrow="Personal insights" title="Progress, with the evidence labels intact." body="Daily goals, employee updates, task outcomes, output evidence, and Worktivity context are analyzed separately—never collapsed into a surveillance score." /><div className="range-switch" aria-label="Insight range">{(["day", "7d", "30d"] as const).map((value) => <button className={range === value ? "active" : ""} key={value} onClick={() => onRange(value)}>{value === "day" ? "Today" : value}</button>)}</div></div>
    {data && !loading && <section className="panel insight-synthesis" aria-label="AI synthesis">
        <header><div><span><Sparkles size={14} /> AI synthesis</span><h3>{synthesis?.status === "ready" ? "The assistant's read of your week." : "Your record, narrated."}</h3></div>
        <button disabled={synthesis?.status === "loading"} onClick={synthesize}>{synthesis?.status === "loading" ? "Synthesizing…" : synthesis?.status === "ready" ? "Re-synthesize" : "Synthesize with AI"}</button></header>
        {synthesis?.status === "ready" ? <p className="synthesis-text">{synthesis.text}</p> : synthesis?.status === "failed" ? <p className="synthesis-fallback">The assistant is unavailable — the deterministic brief and exact values below stand as-is.</p> : <p className="synthesis-hint">A calm narrative grounded strictly in the exact values on this page. Never invented.</p>}
      </section>}
      {loading && !data ? <section className="panel"><InsightsSkeleton /></section> : data ? <>
      <div className="metric-grid"><Metric icon={Clock3} label="Observed work time" value={durationLabel(data.totals.observedSeconds)} /><article className="metric"><ListChecks size={18} /><small>Daily tasks</small><CompletionRing compact completed={data.totals.plannedCompleted} total={data.totals.planned} label="complete" /></article><Metric icon={FileCheck2} label="Nifty outcomes" value={String(data.totals.tasksCompleted)} /><Metric icon={Fingerprint} label="Output evidence" value={String(data.totals.outputEvidence)} /></div>
      <section className="panel insight-brief"><header><div><span>{data.brief.generated ? "Agent brief" : "Deterministic brief"}</span><h3>{data.brief.summary}</h3></div><small>{formatWorkOsDate(data.from)} → {formatWorkOsDate(data.through)}</small></header><div><section><strong>Wins</strong>{data.brief.wins.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Needs attention</strong>{data.brief.attention.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Next focus</strong>{data.brief.nextFocus.map((item) => <p key={item}>{item}</p>)}</section></div></section>
      <section className="panel trend-panel"><div className="card-title"><span><Gauge size={17} /> Workday trend</span><small>Observed time and task completion · separate scales</small></div><div className="trend-plot"><div className="trend-axis" aria-hidden="true"><span>8h</span><span>4h</span><span>0h</span></div><div className="trend-chart" role="img" aria-label="Observed work time and daily task completion by day"><div className="trend-grid" aria-hidden="true"><i /><i /><i /></div>{data.days.map((day) => { const observedHeight = Math.min(100, day.observedSeconds / (8 * 3600) * 100); const completionHeight = day.planned ? day.plannedCompleted / day.planned * 100 : 0; return <div className="trend-day" key={day.date}><div className="trend-bars"><i title={`${durationLabel(day.observedSeconds)} observed`} style={{ height: `${observedHeight}%` }}><span>{durationLabel(day.observedSeconds)}</span></i><b title={`${day.plannedCompleted} of ${day.planned} daily tasks`} style={{ height: `${completionHeight}%` }}><span>{day.planned ? `${Math.round(completionHeight)}%` : "—"}</span></b></div><span>{formatWorkOsDate(day.date)}</span></div>; })}</div></div><div className="trend-legend"><span><i /> Observed session time <small>8-hour scale</small></span><span><b /> Daily task completion <small>0–100%</small></span></div>
         <div className="insight-table-wrap"><table><caption>Exact personal insight values</caption><thead><tr><th>Date</th><th>Observed</th><th>Paused</th><th>Daily tasks</th><th>Tasks done</th><th>Updates</th><th>Tracked</th><th>Output evidence</th><th>Session quality</th></tr></thead><tbody>{data.days.map((day) => <tr key={day.date}><td>{formatWorkOsDate(day.date)}</td><td>{durationLabel(day.observedSeconds)}</td><td>{durationLabel(day.pausedSeconds)}</td><td>{day.plannedCompleted}/{day.planned}</td><td>{day.tasksCompleted}</td><td>{day.updates}</td><td>{day.trackedMinutes ? `${day.trackedMinutes}m` : "—"}</td><td>{day.outputEvidence}</td><td>{day.sessionQuality?.status === "needs_correction" ? <button onClick={() => onCorrect(day.sessionQuality!, day.date)}>Needs correction</button> : sentence(day.sessionQuality?.status ?? "none")}</td></tr>)}</tbody></table></div>
      </section>
      {activityTotals.trackedMinutes > 0 && <section className="panel insight-activity"><div className="card-title"><span><Activity size={17} /> Activity context</span><small>{activityTotals.trackedMinutes} tracked minutes · Worktivity app/site summary</small></div><ul className="activity-app-list">{activityTotals.topApps.map((app) => <li key={app.name}><span>{app.name}</span><b>{app.minutes}m</b></li>)}</ul><p className="activity-provenance">Observed app and site usage, shown as neutral context. It is not a productivity score and never proves task completion.</p></section>}
      <section className="panel insight-drilldown"><div className="card-title"><span><Inbox size={17} /> Latest-day record</span><small>{formatWorkOsDate(latest?.date)}</small></div>{latest?.references?.length ? <div>{(latest.references ?? []).map((reference) => <button key={`${reference.type}:${reference.id}`} onClick={() => onReference(reference)}><span>{reference.type === "plan" ? "Daily workspace" : sentence(reference.type)}</span><strong>{reference.label}</strong><ChevronRight size={15} /></button>)}</div> : <Empty title="No linked records" body="This day has no daily goal, task completion, substantive update, or evidence record yet." />}<footer>Nifty synced {data.freshness.niftySyncedAt ? formatWorkOsDateTime(data.freshness.niftySyncedAt) : "unavailable"} · Worktivity observed {data.freshness.worktivityObservedAt ? formatWorkOsDateTime(data.freshness.worktivityObservedAt) : "unavailable"}</footer></section>
      <p className="insight-disclaimer">These are descriptive personal signals, not a performance score. Idle activity is never labeled productivity, and activity context never proves task completion.</p>
    </> : <section className="panel"><Empty title="Insights unavailable" body="Refresh to retry the personal insights record." /></section>}
  </main>;
}
export function Setting({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <div className="setting"><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>; }
