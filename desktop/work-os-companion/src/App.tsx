import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Activity, AlertTriangle, Archive, ArrowUp, BriefcaseBusiness, Bug, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CirclePause, CirclePlay, Clock3, FileCheck2, Fingerprint, Gauge, Inbox, LayoutDashboard, ListChecks, LogIn, LogOut, MessageSquareText, MoreHorizontal, MoveRight, Pause, Pencil, PlugZap, Plus, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Sparkles, Trash2, X } from "lucide-react";
import { ApiRequestError, apiRequest, flushQueue, sendOrQueue, setDebugSession, setSyncBypass, updateTaskCompletion } from "./api";
import { evaluateCompanion, EMPTY_COMPANION_RECORD, markFired, markIgnored, markResponded, pruneRecord, setQuietMode as setMachineQuiet, snooze as snoozeMachine, type CompanionRecord, type CompanionState } from "./companionMachine";
import { beginAuthentication, errorMessage, listenForAuthentication } from "./auth";
import { diagnostics, exportDiagnostics, openDebuggerWindow, openLogsDir } from "./diagnostics";
import { FEATURES } from "./features";
import { formatWorkOsDate, formatWorkOsDateTime, formatWorkOsTime as formatTime, shiftWorkOsDate } from "./dateFormat";
import { useNotifications } from "./NotificationFlyouts";
import Onboarding from "./Onboarding";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO, insightsFixture } from "./scenarios";
import { schedulePrompt, sendOSNotification } from "./scheduler";
import { sessionGate } from "./sessionGate";
import { shiftPulse } from "./shiftPulse";
import { AssigneeTags, EllipsisMenu, moveMenuFocus, SyncChip, TaskComposerModal, TaskCarryOverFlyout, TaskDetailsModal, TaskEditModal, EodComposer, TaskRemovalConfirmation } from "./taskSurfaces";
import { fileApprovedOperations, interpretationFallbackReason, normalizeInterpretation, operationLabel, simulateAiEod, type ProposedOperation } from "./interpretation";
import { filterWorkspaceTasks, orderTasksByRecency, organizeTaskSections, parentTasks, safeTaskText, subtaskProgress, suggestDailyGoal, taskDateAttribution, taskKind, tasksForDate, unfinishedBefore, uniqueTasks, type TaskRow } from "./taskWorkspace";
import type { DailyPlan, DailyPlanItem, DayData, DebugScenario, DesktopSession, InsightDay, InsightsData, OnboardingData } from "./types";
import { secureState, type WorkOsConversationTurn } from "./vault";
import companionArt from "./assets/work-os-task-stack-v2.png";
import wordmark from "./assets/work-os-mark.png";
import "./plan-insights.css";

type AssetSource = string | { src: string };
const assetUrl = (asset: AssetSource) => typeof asset === "string" ? asset : asset.src;

type View = "day" | "tasks" | "review" | "insights" | "evidence" | "settings";
type TaskView = "today" | "unfinished" | "overdue" | "completed" | "all";
type TaskAssigneeOption = { id: string; displayName: string; email: string | null };
type TaskDetails = {
  task: Record<string, any>;
  subtasks: Array<Record<string, any>>;
  moveTargets: Array<Record<string, any>>;
  subtaskSync?: { tasks: number | null; syncedAt: string | null; error: string | null };
};
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
  const [interpretation, setInterpretation] = useState<{ status: "loading" | "ready"; operations: ProposedOperation[]; taskOptions: Array<{ id: string; title: string }>; reply?: string } | null>(null);
  const [aiUnavailable, setAiUnavailable] = useState(false);
  const [eodDraft, setEodDraft] = useState<{ markdown: string; source: "ai" | "deterministic" | "simulated" } | null>(null);
  const [eodRedrafting, setEodRedrafting] = useState(false);
  const [eodSubmitted, setEodSubmitted] = useState(false);
  const [eodGate, setEodGate] = useState<{ gate: string; detail: string } | null>(null);
  const [eodClockedOut, setEodClockedOut] = useState(false);
  const eodAutoDraftedFor = useRef<string | null>(null);
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
  const [connecting, setConnecting] = useState(false);
  const [taskHistory, setTaskHistory] = useState<Array<Record<string, any>>>([]);
  const [taskHistoryCursor, setTaskHistoryCursor] = useState<string | null>(null);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
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
      return { ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: false, liveWrites: true, authState: "real", onboardingState: "complete", dayState: "clocked_in" };
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
  const [companionRecord, setCompanionRecord] = useState<CompanionRecord>(() => {
    try {
      const stored = window.localStorage.getItem("work-os.companion.v1");
      return stored ? pruneRecord({ ...EMPTY_COMPANION_RECORD, ...JSON.parse(stored) }, new Date()) : EMPTY_COMPANION_RECORD;
    } catch { return EMPTY_COMPANION_RECORD; }
  });
  const companionRecordRef = useRef(companionRecord);
  companionRecordRef.current = companionRecord;
  function recordResponse() {
    const now = new Date();
    lastResponseAtRef.current = now.toISOString();
    setCompanionRecord((current) => markResponded(current, now));
  }
  const lastResponseAtRef = useRef<string | null>(null);
  useEffect(() => {
    try { window.localStorage.setItem("work-os.companion.v1", JSON.stringify(companionRecord)); } catch {}
  }, [companionRecord]);
  const planEditVersion = useRef(0);
  const modalOpen = taskComposerOpen || !!taskDetails || !!deleteRequest || !!editRequest || !!clockInConfirmation || !!missedClockOut || carryOverOpen;

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
    if (carryOverOpen) setCarryOverOpen(false);
  }, [busy, carryOverOpen, clockInConfirmation, deleteRequest, editRequest, missedClockOut, moveMenuId, subtaskMenuId, taskComposerOpen, taskDetails]);

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

  const refresh = useCallback(async (options: { refreshProviders?: boolean; dayOnly?: boolean } = {}) => {
    if (syncBypassRef.current) return null;
    const [onboardingResult, dayResult] = await Promise.allSettled([
      options.dayOnly ? Promise.resolve<OnboardingData | null>(null) : apiRequest<OnboardingData>("/api/work-os/me/onboarding"),
      apiRequest<DayData>(`/api/work-os/me/day${options.refreshProviders ? "?refreshProviders=true" : ""}`, {
        // Provider refreshes run two external syncs server-side; the 20s
        // default aborted them mid-flight ("signal timed out") before the
        // Worktivity observation could land.
        signal: AbortSignal.timeout(options.refreshProviders ? 90_000 : 20_000),
      }),
    ]);
    if (onboardingResult.status === "rejected") throw onboardingResult.reason;
    if (onboardingResult.value) setOnboarding(onboardingResult.value);
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
    setError(""); setDay(nextDay); setReport(nextDay.report?.markdown ?? "");
    setTaskHistory(nextDay.tasks ?? []); setTaskHistoryCursor(nextDay.workspaceSummary?.cursor.next ?? null);
    setPlanIntent(nextDay.plan?.freeform_intent ?? "");
    setGoalProvenance(nextDay.plan?.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : nextDay.plan?.freeform_intent ? "employee" : null);
    setSuggestionTaskIds(nextDay.plan?.suggestion_task_ids ?? []);
    setPlanItems([...(nextDay.plan?.items ?? [])].sort((a, b) => a.rank - b.rank));
    setPlanDirty(false); setPlanSaveState("saved"); setPlanHistoryDate((current) => current || nextDay.shiftDate);
    await schedulePrompt(nextDay, () => { void runCompanionTick(true); });
    return nextDay;
  }, [showError]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void Promise.all([secureState.session(), secureState.queue(), secureState.settings(), isTauri() ? isEnabled() : Promise.resolve(false)]).then(([saved, queue, settings, enabled]) => {
      const current = saved?.apiBase ? saved : null; setSession(current); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length); setApiBase(settings.apiBase); setAutoStart(enabled);
      if (current) void refresh().catch((value) => showError(value, "Could not load your workday.", "Workday unavailable"));
    }).catch((value) => showError(value, "Could not open the local vault.", "Local workspace unavailable"));
    void listenForAuthentication((saved) => { setSession(saved); notifications.success("This device is connected to your workspace.", "Workspace connected"); void emit("work-os://main-session-changed"); void refresh(); }, (value) => showError(value, "Desktop authorization failed.", "Authorization failed")).then((fn) => { cleanup = fn; }).catch((value) => showError(value, "Could not listen for desktop sign-in.", "Sign-in listener failed"));
    return () => cleanup?.();
  }, [notifications, refresh, showError]);

  useEffect(() => {
    if (!session) return;
    const recover = async () => { if (syncBypassRef.current || !navigator.onLine) return; const result = await flushQueue(); setQueueCount(result.remaining); setQueueAttentionCount(result.needsAttention); await refresh({ dayOnly: true }); };
    window.addEventListener("online", recover); const timer = window.setInterval(() => void recover().catch(() => undefined), 60_000);
    return () => { window.removeEventListener("online", recover); clearInterval(timer); };
  }, [refresh, session]);

  // The avatar is a separate window. Its confirmed writes should be visible in
  // the main workspace immediately, not only after the next periodic refresh.
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("work-os://avatar-day-changed", () => { void refresh({ dayOnly: true }).catch(() => undefined); }).then((fn) => { unlisten = fn; }).catch(() => undefined);
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

const redraftEod = async () => {
    if (!visibleDay?.report) return;
    if (syncBypassRef.current) {
      setEodDraft({ markdown: simulateAiEod({ tasks: visibleDay.tasks, plan: visibleDay.plan, shiftDate: visibleDay.shiftDate }), source: "simulated" });
      notifications.success("Simulated an assistant draft on-device — nothing reached the server.", "AI draft (playground)");
      return;
    }
    setEodRedrafting(true);
    try {
      const result = await apiRequest<{ markdown: string; model: string; clockedOut?: boolean }>("/api/work-os/me/eod/ai-draft", {
        method: "POST", body: JSON.stringify({ date: visibleDay.shiftDate }),
      });
      setEodGate(null);
      setEodClockedOut(result.clockedOut === true);
      setEodDraft({ markdown: result.markdown, source: "ai" });
      notifications.success(result.clockedOut ? "You were clocked out automatically and the assistant drafted your EOD. Review every line." : "The assistant drafted your EOD from today's record. Review every line.", "AI draft ready");
    } catch (value) {
      if (value instanceof ApiRequestError && (value as { status?: number | null }).status === 409) {
        const message = value instanceof Error ? value.message : "EOD drafting is gated";
        setEodGate({ gate: /no tasks/i.test(message) ? "no_tasks" : "no_activity", detail: message });
        setEodDraft(null);
        return;
      }
      setEodDraft({ markdown: visibleDay.report.markdown ?? "", source: "deterministic" });
      notifications.info("The assistant is unavailable — showing the standard draft.", "Standard draft");
    } finally { setEodRedrafting(false); }
  };



  function submitEod(markdown: string, idempotencyKey: string) {
    const reportId = String(visibleDay?.report?.id ?? "");
    if (!reportId) return;
    const finish = () => {
      setEodSubmitted(true);
      lastResponseAtRef.current = new Date().toISOString();
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
    if (view !== "insights" || debugRef.current.enabled) {
    if (syncBypassRef.current && visibleDay) {
      setInsights(insightsFixture(visibleDay, insightRange));
      setInsightsLoading(false);
    }
    return;
  }
  if (!session) return;
    let cancelled = false;
    setInsightsLoading(true);
    void apiRequest<InsightsData>(`/api/work-os/me/insights?range=${insightRange}${day?.shiftDate ? `&through=${encodeURIComponent(day.shiftDate)}` : ""}`)
      .then((result) => {
        if (cancelled) return;
        setInsights(result);
        if (result.freshness.stale) notifications.info(`Showing retained insight data${result.freshness.staleAt ? ` from ${formatWorkOsDateTime(result.freshness.staleAt)}` : ""}.`, "Insights refresh delayed");
      })
      .catch((value) => { if (!cancelled) showError(value, "Insights could not be refreshed.", "Insights unavailable"); })
      .finally(() => { if (!cancelled) setInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [view, insightRange, session, day?.shiftDate, notifications, showError]);

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
      await action(); const queue = await secureState.queue(); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length);
      // A failed refresh after a committed write must not present the action
      // as failed — the write is done; surface success and refresh lazily.
      await refresh().catch((refreshError) => {
        diagnostics.warn("ui.action.refresh_after_action", refreshError instanceof Error ? refreshError.message : "post-action refresh failed", { action: label, activeView: view });
        return null;
      });
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
  const runCompanionTick = async (refreshFirst = false) => {
    if (busy || modalOpen) return;
    if (!visibleSession) return;
    const dayNow = refreshFirst ? await refresh({ dayOnly: true }).catch(() => null) : visibleDay;
    const target = dayNow ?? visibleDay;
    if (!target) return;
    const currentGate = sessionGate(target);
    const decision = evaluateCompanion({
      now: new Date(), online: navigator.onLine, gate: currentGate, day: target,
      record: companionRecordRef.current, force: (debugScenario.companionForce as CompanionState | null) ?? null,
      lastResponseAt: lastResponseAtRef.current,
    });
    if (!decision.prompt) return;
    const prompt = decision.prompt;
    const previous = companionRecordRef.current;
    const unanswered = Object.entries(previous.fired)
      .filter(([cause, firedAt]) => cause !== prompt.id && !(lastResponseAtRef.current && Date.parse(lastResponseAtRef.current) > Date.parse(firedAt)))
      .map(([cause]) => cause);
    let next = previous;
    for (const cause of unanswered) next = markIgnored(next, cause, new Date());
    next = markFired(next, prompt.id, new Date());
    setCompanionRecord(next);
    void sendOSNotification(prompt.title, prompt.body, prompt.id);
    const actionLabel = prompt.action === "open_eod" ? "Open EOD review" : prompt.action === "open_plan" ? "Confirm plan" : prompt.action === "open_tasks" ? "Open tasks" : "Record update";
    notifications.persistent(
      `companion:${prompt.id}`,
      prompt.body,
      prompt.title,
      prompt.severity === "attention" ? "warning" : "info",
      { label: actionLabel, onClick: () => {
        if (prompt.action === "open_eod") setView("review");
        else if (prompt.action === "open_plan") { setView("tasks"); openGoalComposer(); }
        else if (prompt.action === "open_tasks") setView("tasks");
        else setProgressComposerOpen(true);
      } },
    );
  };

  const companionTickRef = useRef(runCompanionTick);
  companionTickRef.current = runCompanionTick;

  // Re-evaluate the companion on every clock tick (30s) — the machine itself
  // deduplicates, backs off, and caps frequency, so re-running is safe.
  useEffect(() => {
    void companionTickRef.current(false);
  }, [pulseNow]);

  // First evaluation shortly after boot so a due prompt (or forced debugger
  // state) surfaces without waiting for the first 30-second tick.
  useEffect(() => {
    const timer = window.setTimeout(() => void companionTickRef.current(false), 2_500);
    return () => window.clearTimeout(timer);
  }, []);

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

  async function checkForUpdates() {
    setUpdateStatus("Checking securely…");
    try {
      const saved = await secureState.session();
      const updateOrigin = import.meta.env.VITE_WORK_OS_UPDATE_ORIGIN || "https://app.wrazyos.com";
      if (!saved || new URL(saved.apiBase).origin !== new URL(updateOrigin).origin) {
        setUpdateStatus("");
        notifications.info("Updates are managed by your WrazyOS server.", "Managed update channel");
        return;
      }
      const headers = { Authorization: `Bearer ${saved.token}`, "X-Work-OS-Organization-Id": saved.organizationId };
      const update = await check({ headers });
      if (!update) {
        setUpdateStatus("");
        notifications.success("You already have the latest internal build.", "Work OS is up to date");
        return;
      }
      setUpdateStatus(`Installing ${update.version}…`);
      notifications.info(`Downloading and installing ${update.version}.`, "Update available");
      await update.downloadAndInstall(undefined, { headers });
      await relaunch();
    } catch (value) {
      const message = errorMessage(value, "The update catalog could not be checked.");
      diagnostics.warn("updater.check_failed", message);
      setUpdateStatus("");
      showError(message, message, "Update failed");
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
      setOnboarding(next); setView("day");
      notifications.success("Your personal setup answers were cleared.", "Onboarding restarted");
    } catch (value) {
      showError(value, "Onboarding could not be reset.", "Reset failed");
    } finally { setBusy(false); }
  }

  const visibleOnboarding = useMemo(() => applyOnboardingScenario(onboarding, debugScenario), [onboarding, debugScenario]);
  const visibleDay = useMemo(() => applyDayScenario(day, debugScenario), [day, debugScenario]);

  // Entering the EOD review checks the gates and drafts automatically: the
  // day must have recorded work activity and at least one submitted or
  // checked-off task, and drafting clock-outs the shift.
  useEffect(() => {
    if (view !== "review" || !visibleDay?.report || eodSubmitted || eodDraft || eodGate || eodRedrafting) return;
    const stamp = `${visibleDay.shiftDate}:${visibleDay.report.id}`;
    if (eodAutoDraftedFor.current === stamp) return;
    eodAutoDraftedFor.current = stamp;
    void redraftEod();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, visibleDay?.report?.id, eodSubmitted]);
  const visibleSession = debugScenario.enabled
    ? debugScenario.authState === "unauthenticated" ? null : session ?? { token: "debug-local", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), organizationId: "debug", apiBase: "Local scenario" }
    : session;
  const composerConversationScope = visibleSession?.organizationId && visibleDay?.access?.personId
    ? `main:${visibleSession.organizationId}:${visibleDay.access.personId}`
    : null;
  useEffect(() => {
    let cancelled = false;
    setLoadedComposerConversation(null);
    setComposerHistory([]);
    if (!composerConversationScope) return () => { cancelled = true; };
    void secureState.conversation(composerConversationScope).then((turns) => {
      if (!cancelled) {
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
    void secureState.saveConversation(composerConversationScope, composerHistory);
  }, [composerConversationScope, composerHistory, loadedComposerConversation]);
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
  const goalSuggestion = useMemo(() => suggestDailyGoal(parentTasks(visibleDay?.tasks ?? []), visibleDay?.shiftDate ?? "", planItems), [visibleDay?.tasks, visibleDay?.shiftDate, planItems]);
  const unfinishedCarryOver = useMemo(() => visibleDay?.workspaceSummary?.carryOverGroups
    ? visibleDay.workspaceSummary.carryOverGroups.flatMap((group) => group.tasks.map((task) => ({ task, attribution: { date: task.due_date ?? null, reason: "carried" as const } })))
    : unfinishedBefore(parentTasks(taskHistory), visibleDay?.shiftDate ?? ""), [taskHistory, visibleDay?.shiftDate, visibleDay?.workspaceSummary]);
  const yesterdayDate = moveDate(visibleDay?.shiftDate ?? "", -1);
  const yesterdayDueTasks = unfinishedCarryOver.filter(({ task }) => !task.completed && task.due_date?.slice(0, 10) === yesterdayDate);
  const pulse = shiftPulse(workSession, visibleDay?.shift ?? null, pulseNow, visibleDay?.breakPolicy?.worktivityAuthoritative === true, visibleDay?.attendance);
  const extendedClockOut = !!visibleDay?.shift?.endsAt && pulseNow.getTime() > Date.parse(visibleDay.shift.endsAt) + 15 * 60_000;

  function editPlan(mutator: () => void) {
    planEditVersion.current += 1;
    mutator();
    setPlanDirty(true);
  }

  async function loadPlanHistory(date: string) {
    setPlanHistoryDate(date);
    if (syncBypassRef.current) return;
    if (!date || date === visibleDay?.shiftDate) { setHistoricalPlan(null); setHistoricalTasks([]); return; }
    try {
      const [planResult, taskResult] = await Promise.all([
        apiRequest<{ plan: DailyPlan | null }>(`/api/work-os/me/plan?date=${encodeURIComponent(date)}`),
        apiRequest<{ tasks: Array<Record<string, any>> }>(`/api/work-os/me/tasks?view=day&date=${encodeURIComponent(date)}&limit=100`),
      ]);
      setHistoricalPlan(planResult.plan);
      setHistoricalTasks(taskResult.tasks);
    } catch (value) {
      showError(value, "Daily workspace history could not be loaded.", "History unavailable");
    }
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
    if (syncBypassRef.current || taskHistoryCursor === null || !visibleDay || taskHistoryLoading) return;
    setTaskHistoryLoading(true);
    try {
      const result = await apiRequest<{ tasks: Array<Record<string, any>>; cursor: { next: string | null } }>(`/api/work-os/me/tasks?view=day&date=${encodeURIComponent(visibleDay.shiftDate)}&cursor=${encodeURIComponent(taskHistoryCursor)}&limit=100`);
      setTaskHistory((current) => [...current, ...result.tasks.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTaskHistoryCursor(result.cursor.next);
    } catch (value) {
      showError(value, "More tasks could not be loaded.", "Task history unavailable");
    } finally { setTaskHistoryLoading(false); }
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
      const result = await apiRequest<{ people: TaskAssigneeOption[] }>("/api/work-os/me/tasks?view=options");
      setTaskAssigneeOptions(result.people);
    } catch (value) {
      showError(value, "Could not load organization assignees.", "Assignees unavailable");
    } finally { setTaskOptionsLoading(false); }
  }

  async function loadTaskDetails(taskId: string) {
    return apiRequest<TaskDetails>(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`);
  }

  async function openTaskDetails(task: Record<string, any>, readOnly = false) {
    if (syncBypassRef.current) {
      setTaskDetailsReadOnly(readOnly); setTaskDetailsLoading(false);
      setTaskDetails({ task, subtasks: [], moveTargets: [] }); setSubtaskTitle(""); setSubtaskDescription(""); setSubtaskMenuId(null); setMoveMenuId(null);
      return;
    }
    const taskId = String(task.provider_task_id || task.id);
    setTaskDetailsReadOnly(readOnly); setTaskDetailsLoading(true); setTaskDetails({ task, subtasks: [], moveTargets: [] }); setSubtaskTitle(""); setSubtaskDescription(""); setSubtaskMenuId(null); setMoveMenuId(null);
    try {
      const details = await loadTaskDetails(taskId);
      setTaskDetails({ ...details, task: details.task ?? task, subtasks: Array.isArray(details.subtasks) ? details.subtasks : [], moveTargets: Array.isArray(details.moveTargets) ? details.moveTargets : [] });
      if (details.subtaskSync?.error) notifications.error("Couldn’t refresh subtasks from Nifty. Showing the last mirrored records.", "Subtasks may be stale");
    }
    catch (value) { setTaskDetails(null); showError(value, "Could not open this task.", "Task unavailable"); }
    finally { setTaskDetailsLoading(false); }
  }

  function submitTaskFromDesktop() {
    if (!taskComposerTitle.trim()) return;
    if (syncBypassRef.current) {
      const id = `debug-task-${Date.now()}`;
      setDay((current) => {
        const base = current ?? (applyDayScenario(null, debugScenario) as DayData);
        return { ...base, tasks: [...base.tasks, { id, title: taskComposerTitle.trim(), completed: false, due_date: base.shiftDate }] };
      });
      setTaskComposerTitle(""); setTaskComposerDescription(""); setTaskComposerAssignees([]);
      setTaskComposerOpen(false);
      notifications.success(actionSuccessMessages["task.create"]);
      return;
    }
    void act("task.create", async () => {
      const result = await apiRequest<{ task: Record<string, any>; providerStatus: string; mirrorStatus: string }>("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: taskComposerTitle.trim(), description: taskComposerDescription.trim() || undefined, assignee_person_ids: taskComposerAssignees }) });
      setTaskComposerTitle(""); setTaskComposerDescription(""); setTaskComposerAssignees([]);
      if (result.providerStatus !== "nifty_confirmed") notifications.info(`Task submitted · ${result.mirrorStatus}`, "Provider confirmation pending");
      setTaskComposerOpen(false);
    });
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
    if (syncBypassRef.current) { bypassAct("shift.clock_out", (base) => ({ ...base, session: base.session ? { ...base.session, state: "clocked_out", clocked_out_at: new Date().toISOString() } : null })); return; }
    void act("shift.clock_out", () => sendOrQueue("/api/work-os/me/workday", "PATCH", {
      action: "clock_out",
      ...(extendedClockOut ? { extended_acknowledged: true } : {}),
    }));
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
    if (syncBypassRef.current) { setInterpretation(null); setAiUnavailable(true); return; }
    const taskOptions = interpretationTaskOptions();
    setInterpretation({ status: "loading", operations: [], taskOptions });
    setAiUnavailable(false);
    void apiRequest<{ interpretation: unknown }>("/api/work-os/me/interpret", {
      method: "POST",
      body: JSON.stringify({ input: text, planIntent: planIntent || null, today: visibleDay?.shiftDate ?? null, history: history.slice(-24).map(({ role, text: turnText }) => ({ role, text: turnText })) }),
    }).then((result) => {
      const review = normalizeInterpretation(result.interpretation, text, taskOptions);
      if (!review || (!review.operations.length && !review.reply)) throw new Error("The assistant couldn't map that to work yet.");
      setInterpretation({ status: "ready", operations: review.operations, taskOptions, reply: review.reply });
      setComposerHistory((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: review.reply || "Here's what I understood.", meta: review.operations.length ? `${review.operations.length} proposed update${review.operations.length === 1 ? "" : "s"}` : undefined, createdAt: new Date().toISOString() }]);
    }).catch((value) => {
      setInterpretation(null);
      setAiUnavailable(true);
      diagnostics.info("composer.ai_fallback", value instanceof Error ? value.message : "interpretation failed", { activeView: view });
    });
  }

  function clearComposerChat() {
    setComposerHistory([]);
    if (composerConversationScope) void secureState.clearConversation(composerConversationScope);
    setProgressReceipt(null);
    setInterpretation(null);
    setPendingProgressUpdate("");
    setInput("");
  }

  function toggleOperation(index: number) {
    setInterpretation((current) => current ? { ...current, operations: current.operations.map((op, i) => i === index ? { ...op, enabled: !op.enabled } : op) } : current);
  }

  function editOperation(index: number, statement: string) {
    setInterpretation((current) => current ? { ...current, operations: current.operations.map((op, i) => i === index ? { ...op, statement } : op) } : current);
  }

  function remapOperation(index: number, taskId: string) {
    setInterpretation((current) => current ? { ...current, operations: current.operations.map((op, i) => i === index ? { ...op, taskId: taskId || undefined } : op) } : current);
  }

  function approveInterpretation(operations: ProposedOperation[]) {
    const text = pendingProgressUpdate.trim();
    const enabled = operations.filter((op) => op.enabled);
    if (!text || !enabled.length) return;
    const dominant: ProgressUpdateKind = enabled.some((op) => op.op === "record_blocker") ? "blocked"
      : enabled.some((op) => op.op === "complete_task") ? "completion_claim"
      : enabled.some((op) => op.op === "create_task") ? "new_task" : "material_progress";
    const close = () => {
      const message = enabled.length === 1
        ? `Recorded your update: “${enabled[0]!.statement.slice(0, 140)}”`
        : `Recorded ${enabled.length} updates on your behalf.`;
      setProgressReceipt({ kind: dominant, text, queued: false, message });
      setComposerHistory((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: message, meta: "recorded", createdAt: new Date().toISOString() }]);
      setInterpretation(null);
      setPendingProgressUpdate("");
      recordResponse();
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
        shiftDate: visibleDay?.shiftDate ?? null,
        personId: visibleDay?.access?.personId ?? null,
        promptKind: visibleDay?.prompt.kind || "optional",
      }, {
        completeTask: (taskId, completed) => updateTaskCompletion(taskId, completed),
        createTask: (taskInput) => sendOrQueue("/api/work-os/me/tasks", "POST", {
          name: taskInput.name, description: taskInput.description, due_date: taskInput.dueDate, assignee_person_ids: taskInput.personId ? [taskInput.personId] : [],
        }),
        fileCheckIn: (checkIn) => sendOrQueue("/api/work-os/check-ins", "POST", {
          source: "desktop", kind: checkIn.kind, update_kind: checkIn.updateKind, input_text: checkIn.text,
        }),
      });
      recordResponse();
      const parts: string[] = [];
      if (outcome.recorded) parts.push(`Recorded ${outcome.recorded} update${outcome.recorded === 1 ? "" : "s"}`);
      if (outcome.queued) parts.push(`${outcome.queued} queued for sync`);
      if (outcome.failed.length) parts.push(`${outcome.failed.length} failed`);
      close();
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

  function classifyProgressUpdate(kind: ProgressUpdateKind) {
    recordResponse();
    const text = pendingProgressUpdate.trim();
    if (!text) return;
    setComposerHistory((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: `Recorded “${text.slice(0, 140)}” as ${kind === "completion_claim" ? "completed work" : kind === "blocked" ? "a blocker" : kind === "new_task" ? "a new task" : "progress"}.`, meta: "recorded", createdAt: new Date().toISOString() }]);
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
          kind: visibleDay?.prompt.kind || "optional",
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
          kind: visibleDay?.prompt.kind || "optional",
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

  if (!visibleSession) return <ConnectScreen apiBase={apiBase} setApiBase={setApiBase} connecting={connecting} onDebug={() => void openDebugger()} onConnect={() => void connectWorkspace()} onSave={async () => { try { await secureState.saveSettings({ apiBase }); notifications.success("The server address was saved.", "Settings saved"); } catch (value) { showError(value, "The server address could not be saved.", "Settings not saved"); } }} />;
  if (!visibleOnboarding) return <LoadingScreen
      failed={!!error}
      retry={() => void refresh()}
      onDebug={() => void openDebugger()}
      onOffline={() => setScenario({ ...DEFAULT_DEBUG_SCENARIO, enabled: true, syncBypass: true, authState: "real", onboardingState: "complete", dayState: "clocked_in" })}
    />;
  if (visibleOnboarding.onboardingRequired) return <Onboarding data={visibleOnboarding} simulated={debugScenario.enabled} busy={busy} onNotify={notifications.notify} onOpenDebug={() => void openDebugger()} onLogout={() => void logout()} onComplete={() => { notifications.success("Your workspace setup is complete.", "Welcome to Work OS"); void refresh(); }} onSaveDraft={async (body) => { if (debugScenario.enabled) return visibleOnboarding; const next = await sendOrQueue("/api/work-os/me/onboarding", "PUT", body); if ((next as { queued?: boolean }).queued) { setQueueCount((await secureState.queue()).length); return { queued: true }; } const onboarding = next as OnboardingData; setOnboarding(onboarding); return onboarding; }} onSubmit={async (body) => { if (debugScenario.enabled) { setScenario({ ...debugScenario, onboardingState: "complete", missingDetails: [] }); return visibleDay?.attendance; } const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "POST", headers: { "Idempotency-Key": String(body.clientMutationKey ?? "") }, body: JSON.stringify(body) }); setOnboarding(next); const result = await apiRequest<{ attendance?: DayData["attendance"] }>("/api/work-os/me/workday"); return result.attendance; }} />;

  return <div className="workspace">
    <aside className="rail">
      <div className="wordmark"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div>
      <nav aria-label="Work OS"><div className="nav-group nav-core">{views.slice(0, 3).map(({ id, label, icon: Icon }) => <button key={id} data-label={label} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</div><div className="nav-group nav-context">{views.slice(3, 5).filter(({ id }) => id !== "evidence" || FEATURES.evidence).map(({ id, label, icon: Icon }) => <button key={id} data-label={label} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</div><div className="nav-group nav-settings">{views.slice(5).map(({ id, label, icon: Icon }) => <button key={id} data-label={label} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</div></nav>
      <div className="rail-foot"><span className={`presence ${sessionActive && !paused ? "live" : gate.worktivitySynced ? "observed" : ""}`} /> <div><strong>{observedOnly ? paused ? "Observed break" : "Activity synced" : active ? paused ? "Paused" : "On shift" : "Off shift"}</strong><small>{queueCount ? `${queueCount} queued` : gate.worktivitySynced ? "Worktivity connected" : navigator.onLine ? "Synced" : "Offline"}</small></div></div>
    </aside>
    <section className="stage">
      <header className="masthead"><div><p>{formatWorkOsDate(visibleDay?.shiftDate)}</p><h1>{views.find((item) => item.id === view)?.label}</h1></div><div className="mast-actions">{visibleDay?.niftySync && <span className={`provider nifty-state ${visibleDay.niftySync.error ? "degraded" : visibleDay.niftySync.syncing ? "syncing" : "fresh"}`} title={visibleDay.niftySync.error || (visibleDay.niftySync.syncing ? "Nifty is refreshing task state" : "Nifty task state is current")}>{visibleDay.niftySync.error ? "Nifty sync delayed" : visibleDay.niftySync.syncing ? "Nifty syncing" : "Nifty current"}</span>}<button className="icon" title="Refresh the workday" onClick={() => void refresh({ refreshProviders: true })}><RefreshCw size={17} /></button><button className="avatar" aria-label={`Profile for ${visibleOnboarding.profile.displayName}`}>{initials(visibleOnboarding.profile.displayName)}</button></div></header>
      {debugScenario.enabled && <div className="notice debug"><Bug size={15} /> {syncBypass ? "Offline playground — the backend is never contacted and changes stay on this device." : debugScenario.liveWrites ? "Scenario mode — filing real updates against the connected server." : "Scenario mode is active. Writes are disabled."}<button onClick={() => setScenario(DEFAULT_DEBUG_SCENARIO)}>Reset</button></div>}
      {view === "day" && (!active ? <main className="day-grid off-shift-day">
        <section className="hero-card">
          <div className="hero-copy"><span className="kicker">{active ? `${sentence(workSession!.state)} · ${formatTime(workSession?.clocked_in_at, visibleDay?.shift?.timezone)}` : gate.worktivitySynced ? "Worktivity connected" : "Ready when you are"}</span><h2>{active ? paused ? "Workday paused." : "Today, in motion." : gate.worktivitySynced ? "Activity is syncing." : "Ready to start."}</h2><p>{active ? visibleDay?.prompt.reason : gate.worktivitySynced ? "Worktivity activity is syncing. Your Work OS session remains separate and ready when you need it." : visibleDay?.shift ? `Scheduled ${formatTime(visibleDay.shift.startsAt, visibleDay.shift.timezone)}–${formatTime(visibleDay.shift.endsAt, visibleDay.shift.timezone)}.` : "No scheduled shift is active. Starting work creates an exception session without an inferred end time."}</p>
            <div className="hero-actions">{!active ? <button className="primary" disabled={busy || !gate.canClockIn} onClick={clockIn}><CirclePlay size={17} /> Clock in</button> : <>{!visibleDay?.breakPolicy?.worktivityAuthoritative && <button className="primary" disabled={busy} onClick={() => void act("shift.pause_toggle", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: paused ? "resume" : "pause" }))}>{paused ? <CirclePlay size={17} /> : <CirclePause size={17} />}{paused ? "Resume" : "Pause"}</button>}<button disabled={busy} onClick={() => setClockOutConfirmation(true)}>Clock out</button></>}</div>
            {visibleDay?.attendance && <small className="attendance-context">Observed context: {visibleDay.attendance.message}</small>}
          </div><img className="companion" src={assetUrl(companionArt)} alt="Focused desk with a task checklist" />
        </section>
        <ShiftPulseCard pulse={pulse} now={pulseNow} shift={visibleDay?.shift ?? null} active={active} attendance={visibleDay?.attendance ?? null} />
        <section className="focus-card today-card"><div className="card-title"><span><BriefcaseBusiness size={17} /> Focus and tasks</span><button onClick={() => setView("tasks")}>Open Tasks <ChevronRight size={14} /></button></div><div className="today-goal"><small>Focus note</small><strong>{planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}</strong><span>{planIntent ? goalProvenance === "accepted_suggestion" ? "Derived from your tasks" : "Written by you" : goalSuggestion ? "Suggested from your tasks" : "Nifty is the task record"}</span></div><PreShiftAgendaSummary todayCount={todayParentTasks.length} yesterdayDueCount={yesterdayDueTasks.length} onToday={() => setView("tasks")} onYesterday={() => { setCarryOverOpen(true); setView("tasks"); }} />{openTasks.length ? <>{openTasks.slice(0, 3).map((task, index) => { const state = taskState(task, visibleDay?.shiftDate ?? ""); return <div className="focus-row dashboard-focus-row" key={task.id}><b>{String(index + 1).padStart(2, "0")}</b><button className="focus-task-copy" onClick={() => void openTaskDetails(task)}><strong>{task.title}</strong><small>Nifty task · {task.due_date ? `due ${formatWorkOsDate(task.due_date)}` : "open"}</small></button><span className={`task-state ${state}`}>{sentence(state)}</span><TaskLifecycleMenu task={task} busy={busy} onEdit={editTask} onArchive={(item) => requestTaskRemoval(item, true, "archive")} onDelete={(item) => requestTaskRemoval(item, true, "delete")} /></div>; })}</> : <div className="pre-shift-empty-tasks"><span><Plus size={18} /></span><div><strong>Your agenda is open</strong><small>{yesterdayDueTasks.length ? "Add today’s priorities or review yesterday’s due work before you clock in." : "Add your first priority before you clock in."}</small></div></div>}<div className="today-actions"><button onClick={() => setView("tasks")}>Open Tasks</button><button onClick={() => void openTaskComposer()}>Detailed Task</button><button onClick={openGoalComposer}>Update Focus</button>{unfinishedCarryOver.length > 0 && <button onClick={() => { setCarryOverOpen(true); setView("tasks"); }}>Review Overdue</button>}</div></section>
      </main> : <ActiveDayWorkspace
        focus={planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}
        focusSource={planIntent ? goalProvenance === "accepted_suggestion" ? "Derived from today’s tasks" : "Your focus note" : goalSuggestion ? "Suggested from today’s tasks" : "Task record"}
        tasks={visibleDay?.tasks ?? []}
        previousTasks={unfinishedCarryOver.filter((item) => item.attribution.date === moveDate(visibleDay?.shiftDate ?? "", -1)).map((item) => item.task)}
        otherTasks={unfinishedCarryOver.filter((item) => !!item.attribution.date && item.attribution.date < moveDate(visibleDay?.shiftDate ?? "", -1)).map((item) => item.task)}
        elapsed={observedOnly ? pulse.observedElapsedLabel : pulse.elapsedLabel}
        progressPercent={pulse.progressPercent}
        nextPrompt={formatTime(visibleDay?.prompt.nextPromptAt, visibleDay?.shift?.timezone)}
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
        onEditFocus={openGoalComposer}
        onAddTask={() => void openTaskComposer()}
        onManageTasks={() => setView("tasks")} onOpenOverdue={() => { setTaskView("overdue"); setView("tasks"); }} currentDate={visibleDay?.shiftDate ?? ""}
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
      />)}
      {view === "tasks" && <TasksWorkspace currentDate={visibleDay?.shiftDate ?? ""} historyDate={planHistoryDate} currentPlan={visibleDay?.plan ?? null} historicalPlan={historicalPlan} historicalTasks={historicalTasks} goal={planIntent} goalProvenance={goalProvenance} suggestion={goalSuggestion} saveState={planSaveState} taskView={taskView} todayTasks={visibleDay?.tasks ?? []} taskHistory={taskHistory} carryOver={unfinishedCarryOver} carryOverOpen={carryOverOpen} loadingMore={taskHistoryLoading} hasMore={taskHistoryCursor !== null} busy={busy} onTaskView={setTaskView} onDate={loadPlanHistory} onEditFocus={openGoalComposer} onAddTask={() => void openTaskComposer()} onOpenTask={(task, readOnly) => void openTaskDetails(task, readOnly)} onEditTask={editTask} onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")} onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")} onSurfaceTask={surfaceTask} onTaskCompletion={setTaskCompletion} onCarryOverOpen={setCarryOverOpen} onLoadMore={() => void loadMoreTasks()} />}
      {view === "review" && eodGate && !eodSubmitted && <main className="page"><section className="panel"><Empty
          title={eodGate.gate === "no_tasks" ? "No tasks submitted for this day" : "No work activity recorded"}
          body={eodGate.detail}
        /><div className="today-actions"><button onClick={() => setView("tasks")}>Open Tasks <ChevronRight size={14} /></button><button onClick={() => { setEodGate(null); eodAutoDraftedFor.current = null; void redraftEod(); }}>{eodRedrafting ? "Checking…" : "Try again"}</button></div></section></main>}
      {view === "review" && !eodGate && visibleDay?.report && !eodSubmitted && eodRedrafting && !eodDraft && <main className="page"><section className="panel"><Empty title="Drafting your EOD…" body="Checking your shift, closing it out if it's still open, and writing the report from today's record." /></section></main>}
      {view === "review" && !eodGate && visibleDay?.report && !eodSubmitted && (!eodRedrafting || eodDraft) && <EodComposer
          reportId={String(visibleDay.report.id ?? "unknown")}
          initialMarkdown={eodDraft?.markdown ?? String(visibleDay.report.markdown ?? "")}
          source={eodDraft?.source ?? "deterministic"}
          suggestedBottleneck={visibleDay.plan?.items?.find((item) => typeof item.blocker === "string" && item.blocker.trim())?.blocker ?? null}
          redrafting={eodRedrafting}
          clockedOut={eodClockedOut}
          busy={busy}
          onRedraft={() => void redraftEod()}
          onSubmit={submitEod}
        />}
      {view === "review" && eodSubmitted && <main className="page"><section className="panel"><Empty title="EOD submitted" body="Your report is with your manager. You are done for today." /></section></main>}
      {view === "insights" && <PersonalInsights data={insights} loading={insightsLoading} range={insightRange} onRange={setInsightRange} onReference={(reference) => void openInsightReference(reference)} onCorrect={(quality, date) => { if (!quality.sessionId) return; setMissedClockOut({ sessionId: quality.sessionId, date, clockedInAt: quality.clockedInAt ?? null }); setMissedClockOutAt(""); setMissedClockOutReason(""); }} />}
      {view === "evidence" && <main className="page"><PageIntro eyebrow="Provenance" title="Evidence with its labels intact." body="Claims, activity observations, and output artifacts are never collapsed into one misleading score." /><section className="evidence-list">{visibleDay?.evidence?.length ? visibleDay.evidence.map((item) => <article key={item.id}><span className={`evidence-kind ${item.source === "worktivity" ? "activity" : "output"}`}>{item.source === "worktivity" ? "Activity context" : "Output evidence"}</span><div><h3>{item.title}</h3><p>{item.summary || "No summary available."}</p></div><time>{item.occurred_at ? formatTime(item.occurred_at, visibleDay.shift?.timezone) : "Today"}</time></article>) : <Empty title="No evidence yet" body="Verified provider events and purpose-limited activity context will appear here." />}</section></main>}
      {view === "settings" && <main className="page"><PageIntro eyebrow="Workspace control" title="Your companion, your boundaries." body="Manage launch behavior, local sync, privacy context, updates, and diagnostics." /><section className="settings-panel"><Setting title="Start with Windows" detail="Open quietly in the tray after sign-in"><input type="checkbox" checked={autoStart} onChange={(event) => void toggleAutoStart(event.target.checked)} /></Setting><Setting title="Quiet mode" detail={companionRecord.quiet.active ? "Companion reminders are paused" : "Reminders follow the normal schedule"}><button disabled={busy} onClick={() => setCompanionRecord((current) => setMachineQuiet(current, !current.quiet.active))}>{companionRecord.quiet.active ? "Resume reminders" : "Pause reminders"}</button></Setting><Setting title="Snooze reminders" detail={companionRecord.snooze.until ? `Until ${new Date(companionRecord.snooze.until).toLocaleTimeString()}` : "Silence the companion for one hour"}><button disabled={busy} onClick={() => { setCompanionRecord((current) => snoozeMachine(current, null, new Date(Date.now() + 60 * 60_000))); notifications.info("Companion reminders are snoozed for one hour.", "Snoozed"); }}><CirclePause size={15} /> Snooze 1h</button></Setting><Setting title="Offline queue" detail={queueAttentionCount ? `${queueAttentionCount} update${queueAttentionCount === 1 ? "" : "s"} need attention` : queueCount ? `${queueCount} updates waiting to sync` : "Everything is synced"}><span className="status-dot">{queueAttentionCount ? "Needs Attention" : "Ready"}</span></Setting><Setting title="Scenario debugger" detail="Opens a separate diagnostics window. Ctrl+Shift+D"><button onClick={() => void openDebugger()}><Bug size={15} /> Open</button></Setting><Setting title="Export diagnostics" detail="Redacted ZIP of recent events. Never includes tokens or queue bodies."><button onClick={() => void exportAppDiagnostics()}>Export</button></Setting><Setting title="Desktop updates" detail={updateStatus || "Internal update channel"}><button onClick={() => void checkForUpdates()}>Check</button></Setting><Setting title="Evidence" detail="Provider-verified proof of output is coming back. The surface is built and temporarily hidden."><span className="status-dot">Hidden</span></Setting><Setting title="Restart onboarding" detail="Clear your personal setup answers and return to employee onboarding. Manager-owned setup and consent history stay intact."><button disabled={busy} onClick={() => void resetOnboarding()}><RotateCcw size={15} /> Reset</button></Setting><Setting title="Account session" detail={`Signed in through ${visibleSession.apiBase}`}><button className="danger" disabled={busy} onClick={() => void logout()}><LogOut size={15} /> Sign out</button></Setting></section></main>}
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
        required={sessionActive && view === "day" && !!visibleDay?.prompt.required}
        goal={planIntent}
        goalProvenance={goalProvenance}
        goalSuggestion={goalSuggestion}
        saveState={planSaveState}
        onInput={setInput}
        onOpen={() => { setProgressPanel("update"); setProgressComposerOpen(true); }}
        onOpenGoal={openGoalComposer}
        onClose={() => { setProgressComposerOpen(false); setPendingProgressUpdate(""); setProgressReceipt(null); setInterpretation(null); }}
        onSubmit={startProgressUpdate}
        interpretation={interpretation}
        aiUnavailable={aiUnavailable}
        onToggleOperation={toggleOperation}
        onEditOperation={editOperation}
        onRemapOperation={remapOperation}
        onApproveOperations={approveInterpretation}
        onClassify={classifyProgressUpdate}
        onGoal={(value) => editPlan(() => { setPlanIntent(value); setGoalProvenance(value.trim() ? "employee" : null); setSuggestionTaskIds([]); })}
        onAcceptSuggestion={() => { if (!goalSuggestion) return; editPlan(() => { setPlanIntent(goalSuggestion.text); setGoalProvenance("accepted_suggestion"); setSuggestionTaskIds(goalSuggestion.taskIds); }); }}
      />}
    </section>
    {taskComposerOpen && <TaskComposerModal busy={busy} title={taskComposerTitle} description={taskComposerDescription} assignees={taskComposerAssignees} options={taskAssigneeOptions} optionsLoading={taskOptionsLoading} onTitle={setTaskComposerTitle} onDescription={setTaskComposerDescription} onToggleAssignee={(id) => setTaskComposerAssignees((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])} onClose={() => setTaskComposerOpen(false)} onSubmit={submitTaskFromDesktop} />}
        {taskDetails && <TaskDetailsModal details={taskDetails} loading={taskDetailsLoading} readOnly={taskDetailsReadOnly} currentDate={visibleDay?.shiftDate ?? ""} busy={busy} subtaskTitle={subtaskTitle} subtaskDescription={subtaskDescription} subtaskMenuId={subtaskMenuId} moveMenuId={moveMenuId} onSubtaskTitle={setSubtaskTitle} onSubtaskDescription={setSubtaskDescription} onSubtaskMenu={setSubtaskMenuId} onMoveMenu={setMoveMenuId} onSubtaskCreate={submitInlineSubtask} onEditTask={editTask} onMoveSubtask={moveSubtask} onToggleSubtask={(subtask) => setTaskCompletion(subtask, !subtask.completed, true)} onArchiveSubtask={(subtask) => requestTaskRemoval(subtask, false, "archive")} onDeleteSubtask={(subtask) => requestTaskRemoval(subtask, false, "delete")} onClose={() => setTaskDetails(null)} />}
    {deleteRequest && <TaskRemovalConfirmation mode={deleteRequest.mode} scope={deleteRequest.closeParent ? "task" : "subtask"} title={String(deleteRequest.task.title ?? "Untitled task")} subtaskCount={deleteRequest.closeParent && taskDetails?.subtasks?.length ? taskDetails.subtasks.length : 0} busy={busy} onCancel={() => setDeleteRequest(null)} onConfirm={confirmTaskRemoval} />}
    {editRequest && <TaskEditModal kind={editRequest.kind} title={editTitle} description={editDescription} busy={busy} onTitle={setEditTitle} onDescription={setEditDescription} onClose={() => setEditRequest(null)} onSubmit={submitTaskEdit} />}
    {clockInConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{clockInConfirmation.kind === "late" ? "Confirm late start" : "Confirm exception start"}</h2><p>{clockInConfirmation.kind === "late" ? "This clock-in is after the scheduled start. Your acknowledgement will be retained in the audit record." : "There is no startable scheduled shift right now. Explain the exception before Work OS starts a separate exception session."}</p>{clockInConfirmation.kind === "exception" && <textarea autoFocus maxLength={1000} value={clockInConfirmation.reason} onChange={(event) => setClockInConfirmation({ ...clockInConfirmation, reason: event.target.value })} placeholder="Reason for starting outside the scheduled window" />}<div><button disabled={busy} onClick={() => setClockInConfirmation(null)}>Cancel</button><button className="primary" disabled={busy || (clockInConfirmation.kind === "exception" && !clockInConfirmation.reason.trim())} onClick={confirmClockIn}>Confirm clock-in</button></div></section></div>}
    {missedClockOut && <div className="task-modal-backdrop"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="missed-clockout-title"><header><div><span>Session correction · {formatWorkOsDate(missedClockOut.date)}</span><h2 id="missed-clockout-title">Enter the exact clock-out time</h2></div><button aria-label="Close correction" onClick={() => setMissedClockOut(null)}><X size={18} /></button></header><div className="task-modal-body"><p>Work OS will not infer this timestamp. Enter the time you actually stopped working.</p>{missedClockOut.clockedInAt && <small>Clocked in {formatWorkOsDateTime(missedClockOut.clockedInAt)}</small>}<label><span>Clock-out timestamp</span><input type="datetime-local" value={missedClockOutAt} onChange={(event) => setMissedClockOutAt(event.target.value)} /></label><label><span>Correction note <em>optional</em></span><textarea value={missedClockOutReason} onChange={(event) => setMissedClockOutReason(event.target.value)} /></label></div><footer><button onClick={() => setMissedClockOut(null)}>Cancel</button><button className="primary" disabled={busy || !missedClockOutAt} onClick={correctMissedClockOut}>Save correction</button></footer></section></div>}
    {clockOutConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{extendedClockOut ? "Confirm extended shift" : "Confirm clock-out"}</h2><p>{extendedClockOut ? "This clock-out is more than 15 minutes after the scheduled end. Confirm that you intentionally worked the extended shift; the acknowledgement will be retained in the audit record." : "Clock out and close today’s workspace?"}</p><div><button disabled={busy} onClick={() => setClockOutConfirmation(false)}>Cancel</button><button className="primary" disabled={busy} onClick={confirmClockOut}>{extendedClockOut ? "Confirm extended shift" : "Clock out"}</button></div></section></div>}
  </div>;
}

function ConnectScreen({ apiBase, setApiBase, connecting, onDebug, onConnect, onSave }: { apiBase: string; setApiBase: (value: string) => void; connecting: boolean; onDebug: () => void; onConnect: () => void; onSave: () => Promise<void> }) { return <main className="connect"><section><div className="wordmark large"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div><span className="kicker">Desktop companion</span><h1>Welcome to a clearer workday.</h1><p>Bring your tasks, priorities, and progress into one calm place, then move through the day with confidence and focus.</p><button className="primary connect-button" disabled={connecting} onClick={onConnect}><LogIn size={17} /> {connecting ? "Opening browser…" : "Connect workspace"}</button><details><summary>Server settings</summary><input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://work.example.com" /><button onClick={() => void onSave()}>Save</button></details><button className="quiet" onClick={onDebug}><Bug size={14} /> Scenario debugger</button></section><aside><img src={assetUrl(companionArt)} alt="A welcoming focused workspace" /></aside></main>; }
function LoadingScreen({ failed, retry, onDebug, onOffline }: { failed: boolean; retry: () => void; onDebug: () => void; onOffline: () => void }) { return <main className="loading"><img src={assetUrl(wordmark)} alt="" /><h1>{failed ? "Work OS needs another try" : "Preparing your workday"}</h1><p>{failed ? "The details are in the notification above." : "Syncing your schedule, tasks, and provider context…"}</p>{failed && <><button className="primary" onClick={retry}>Retry</button><div className="loading-alternatives"><button onClick={onOffline}>Continue offline</button><button className="quiet" onClick={onDebug}><Bug size={14} /> Scenario debugger</button></div><small>Offline mode uses local fixtures only — nothing reaches the server.</small></>}</main>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><Sparkles size={20} /><strong>{title}</strong><p>{body}</p></div>; }
function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) { return <header className="page-intro"><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p></header>; }
function Metric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <article className="metric"><Icon size={18} /><small>{label}</small><strong>{value}</strong></article>; }
function moveDate(date: string, amount: number) {
  return shiftWorkOsDate(date, amount);
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

function ShiftDetailsFloatingCard({ view, progressPercent, shiftStart, remaining, shiftEnd, elapsed, nextPrompt, openTasks, reviews, attendance, timezone, observedActive, providerBreak, onBack, onClose }: {
  view: "shift" | "worktivity"; progressPercent: number; shiftStart: string; remaining: string; shiftEnd: string; elapsed: string; nextPrompt: string;
  openTasks: number; reviews: number; attendance: DayData["attendance"] | null; timezone?: string; observedActive: string; providerBreak: string; onBack: () => void; onClose: () => void;
}) {
  return <section className="shift-detail-popover" role="dialog" aria-label={view === "shift" ? "Workday status" : "Worktivity details"}>
    <header><button className="detail-back" aria-label="Back to detail options" onClick={onBack}><ChevronLeft size={16} /></button><div><span>{view === "shift" ? <Clock3 size={15} /> : <Activity size={15} />}{view === "shift" ? "Workday status" : "Worktivity details"}</span><small>{view === "shift" ? "Schedule and Work OS session context" : "Observed provider context only"}</small></div><button aria-label="Close details" onClick={onClose}><X size={16} /></button></header>
    {view === "shift" ? <><div className="shift-pulse-visual"><div className="shift-progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as CSSProperties}><span><small>Scheduled shift</small><strong>{Math.round(progressPercent)}%</strong><em>elapsed</em></span></div><div className="shift-track-summary"><div><span><small>Shift start</small><strong>{shiftStart}</strong></span><span><small>Time remaining</small><strong>{remaining}</strong></span><span><small>Shift end</small><strong>{shiftEnd}</strong></span></div><div className="shift-detail-track"><i style={{ width: `${progressPercent}%` }} /><b style={{ left: `${progressPercent}%` }} /></div></div></div><div className="shift-detail-grid"><span><small>Elapsed</small><strong>{elapsed}</strong></span><span><small>Next update</small><strong>{nextPrompt}</strong></span><span><small>Open tasks</small><strong>{openTasks}</strong></span><span><small>Awaiting review</small><strong>{reviews}</strong></span></div></> : <><div className="worktivity-state"><span className={`presence ${attendance?.state === "active" ? "live" : ""}`} /><div><small>Worktivity observation</small><strong>{attendance?.status ? sentence(attendance.status) : "Unavailable"}</strong></div></div><div className="shift-detail-grid worktivity-grid"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{attendance?.clockedOutAt ? formatTime(attendance.clockedOutAt, timezone) : "Still active"}</strong></span><span><small>Last activity</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>Observed active time</small><strong>{observedActive}</strong></span><span><small>Provider refresh</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>OnBreak deducted</small><strong>{providerBreak}</strong></span></div></>}
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

export function ActiveDayWorkspace({ focus, focusSource, tasks, previousTasks, otherTasks, elapsed, progressPercent, nextPrompt, shiftStart, shiftEnd, remaining, timezone, attendance, providerBreakSeconds, reviews, initialDetailView = null, initialDetailsMenuOpen = false, initialTaskMenuId = null, paused, busy, observedOnly = false, canPause, canClockOut = true, onEditFocus, onAddTask, onManageTasks, onOpenOverdue, currentDate = "", onOpenTask, onToggleTask, onEditTask, onArchiveTask, onDeleteTask, onPause, onClockOut }: {
  focus: string; focusSource: string; tasks: TaskRow[]; previousTasks: TaskRow[]; otherTasks: TaskRow[]; elapsed: string; progressPercent: number; nextPrompt: string;
  shiftStart: string; shiftEnd: string; remaining: string; timezone?: string; attendance: DayData["attendance"] | null; providerBreakSeconds: number; reviews: number;
  initialDetailView?: "shift" | "worktivity" | null; initialDetailsMenuOpen?: boolean; initialTaskMenuId?: string | null; paused: boolean; busy: boolean; observedOnly?: boolean; canPause: boolean; canClockOut?: boolean;
  onEditFocus: () => void; onAddTask: () => void; onManageTasks: () => void; onOpenOverdue?: () => void; currentDate?: string; onOpenTask: (task: TaskRow) => void; onToggleTask: (task: TaskRow, completed: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask: (task: TaskRow) => void; onPause: () => void; onClockOut: () => void;
}) {
  const [tab, setTab] = useState<"today" | "previous" | "other">("today");
  const [detailsMenuOpen, setDetailsMenuOpen] = useState(initialDetailsMenuOpen || initialDetailView !== null);
  const [detailView, setDetailView] = useState<"shift" | "worktivity" | null>(initialDetailView);
  const displayed = tab === "today" ? tasks : tab === "previous" ? previousTasks : otherTasks;
  const completed = tasks.filter((task) => task.completed === true).length;
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
        <div className="active-shift-status"><span className={`presence ${paused ? "" : "live"}`} /><div><small>{observedOnly ? paused ? "Worktivity break" : "Activity observed" : paused ? "Shift paused" : "On shift"}</small><strong>{elapsed}</strong></div><div className="active-shift-meter"><i style={{ width: `${progressPercent}%` }} /></div><span><small>Next update</small><strong>{observedOnly ? "Syncing" : nextPrompt}</strong></span></div>
        <div className="active-day-actions">{canPause && <button className="shift-action-button" disabled={busy} onClick={onPause}>{paused ? <CirclePlay size={15} aria-hidden="true" /> : <CirclePause size={15} aria-hidden="true" />}<span>{paused ? "Resume" : "Pause"}</span></button>}{canClockOut && <button className="shift-action-button" disabled={busy} onClick={onClockOut}>Clock out</button>}<div className="shift-details-menu"><button className="ellipsis-button" aria-label="Open workday details" aria-expanded={detailsMenuOpen} onClick={() => { setDetailsMenuOpen((current) => !current); setDetailView(null); }}><MoreHorizontal size={17} /></button>{detailsMenuOpen && <><button className="shift-popover-scrim" aria-label="Close workday details" onClick={() => { setDetailsMenuOpen(false); setDetailView(null); }} />{detailView ? <ShiftDetailsFloatingCard view={detailView} progressPercent={progressPercent} shiftStart={shiftStart} remaining={remaining} shiftEnd={shiftEnd} elapsed={elapsed} nextPrompt={nextPrompt} openTasks={tasks.filter((task) => !task.completed).length} reviews={reviews} attendance={attendance} timezone={timezone} observedActive={observedActive} providerBreak={providerBreak} onBack={() => setDetailView(null)} onClose={() => { setDetailsMenuOpen(false); setDetailView(null); }} /> : <div className="shift-details-options" role="menu"><button role="menuitem" onClick={() => setDetailView("shift")}><Clock3 size={14} /> Workday status</button><button role="menuitem" onClick={() => setDetailView("worktivity")}><Activity size={14} /> Worktivity details</button></div>}</>}</div></div>
      </header>
      <div className="active-focus-block"><div className="active-focus-copy"><span>Today’s focus</span><div className="active-focus-heading"><h2>{focus}</h2><button className="focus-edit-button" onClick={onEditFocus}><Pencil size={14} /> Update focus</button></div><small><Sparkles size={13} /> {focusSource}</small></div><div className="hero-task-metrics">{overdueCount > 0 && <button className="overdue-metric" onClick={() => onOpenOverdue?.()} aria-label={`${overdueCount} overdue tasks. Show the overdue filter in Tasks.`}><span><strong>{overdueCount}</strong></span><em>overdue<br />{overdueCount === 1 ? "task" : "tasks"}</em></button>}</div>
        <div className="hero-task-metrics"><button className="hero-metric-button" onClick={() => setTab("today")} aria-label={`${completed} of ${tasks.length} tasks done today. Show Today tasks.`}><CompletionRing completed={completed} total={tasks.length} label="tasks done" /></button><button className={`carryover-metric ${pendingPrevious > 0 ? "pending" : "clear"}`} onClick={() => setTab("previous")} aria-label={`${pendingPrevious} pending task${pendingPrevious === 1 ? "" : "s"} from yesterday. Show Previous day tasks.`}><span><strong>{pendingPrevious}</strong></span><em>pending tasks<br />from yesterday</em></button></div></div>
      <div className="active-task-toolbar"><div className="active-task-tabs" role="tablist"><button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Today <em>{tasks.length}</em></button><button role="tab" aria-selected={tab === "previous"} className={tab === "previous" ? "active" : ""} onClick={() => setTab("previous")}>Previous day {previousTasks.length > 0 && <em className="alert-count">{previousTasks.length}</em>}</button><button role="tab" aria-selected={tab === "other"} className={tab === "other" ? "active" : ""} onClick={() => setTab("other")}>Other days {otherTasks.length > 0 && <em className="older-count">{otherTasks.length}</em>}</button></div><button className="primary add-day-task" onClick={onAddTask}><Plus size={15} /> Add task</button></div>
      {tab === "other" && otherTasks.length > 0 && <div className="older-task-notice" role="status"><span>{otherTasks.length}</span><strong>Older unfinished task{otherTasks.length === 1 ? "" : "s"}</strong><small>From before yesterday</small></div>}
      <div className="active-task-list">{displayed.length ? displayed.map((task) => { const taskId = String(task.provider_task_id || task.id); return <article className={task.completed ? "completed" : ""} key={taskId}><button className="task-check" aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`} disabled={busy} onClick={() => onToggleTask(task, !task.completed)}>{task.completed && <Check size={15} />}</button><button className="active-task-copy" onClick={() => onOpenTask(task)}><strong>{task.title}</strong><small>{task.completed ? (typeof task.completed_at === "string" && task.completed_at ? `Completed ${formatWorkOsDate(task.completed_at.slice(0, 10))}` : "Completed") : task.priority ? `${sentence(String(task.priority))} priority` : task.due_date ? `Due ${formatWorkOsDate(task.due_date)}` : "Open today"}</small></button><span className={`task-status ${task.completed ? "done" : "open"}`}>{task.completed ? "Done" : "Open"}</span><TaskLifecycleMenu task={task} busy={busy} initialOpen={initialTaskMenuId === taskId} onEdit={onEditTask} onArchive={onArchiveTask} onDelete={onDeleteTask} /></article>; }) : <Empty title={tab === "today" ? "A clear day" : tab === "previous" ? "Nothing left behind" : "No older work pending"} body={tab === "today" ? "Add the first task you want to move forward today." : tab === "previous" ? "Yesterday’s open work has been cleared." : "Everything from before yesterday is complete."} />}</div>
      <footer className="active-day-footer"><span>Changes save to your workday record.</span><button className="workspace-link-button" onClick={onManageTasks}><span>Open full Tasks workspace</span><ChevronRight size={14} aria-hidden="true" /></button></footer>
    </section>
  </main>;
}

export function PreShiftAgendaSummary({ todayCount, yesterdayDueCount, onToday, onYesterday }: { todayCount: number; yesterdayDueCount: number; onToday: () => void; onYesterday: () => void }) {
  return <div className="pre-shift-agenda-summary" aria-label="Agenda summary"><button onClick={onToday}><span>{todayCount}</span><div><strong>{todayCount === 1 ? "Task" : "Tasks"} scheduled for today</strong><small>Open today’s agenda</small></div><ChevronRight size={15} /></button><button className={yesterdayDueCount ? "has-due" : ""} disabled={!yesterdayDueCount} onClick={onYesterday}><span>{yesterdayDueCount}</span><div><strong>{yesterdayDueCount === 1 ? "Task" : "Tasks"} due from yesterday</strong><small>{yesterdayDueCount ? "Needs your attention" : "Nothing carried forward"}</small></div>{yesterdayDueCount > 0 && <ChevronRight size={15} />}</button></div>;
}

export function ProgressComposer({ mode = "progress", input, open, panel, pending, receipt, history = [], onClearChat, busy, required, goal, goalProvenance, goalSuggestion, saveState, interpretation = null, aiUnavailable = false, onInput, onOpen, onOpenGoal, onClose, onSubmit, onClassify, onGoal, onAcceptSuggestion, onToggleOperation, onEditOperation, onRemapOperation, onApproveOperations }: {
  mode?: ComposerMode;
  input: string; open: boolean; panel: ProgressPanel; pending: string; receipt: ProgressReceipt | null; history?: WorkOsConversationTurn[]; onClearChat?: () => void; busy: boolean; required: boolean; goal: string;
  goalProvenance: "employee" | "accepted_suggestion" | null; goalSuggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  onInput: (value: string) => void; onOpen: () => void; onOpenGoal: () => void; onClose: () => void; onSubmit: () => void; onClassify: (kind: ProgressUpdateKind) => void; onGoal: (value: string) => void; onAcceptSuggestion: () => void;
  interpretation?: { status: "loading" | "ready"; operations: Array<import("./interpretation").ProposedOperation>; taskOptions: Array<{ id: string; title: string }>; reply?: string } | null;
  aiUnavailable?: boolean;
  onToggleOperation?: (index: number) => void; onEditOperation?: (index: number, statement: string) => void; onRemapOperation?: (index: number, taskId: string) => void; onApproveOperations?: (operations: Array<import("./interpretation").ProposedOperation>) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history.length, interpretation, pending, receipt, open]);
  useEffect(() => {
    const el = composerInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [input]);
  const options: Array<{ kind: ProgressUpdateKind; label: string }> = [
    { kind: "material_progress", label: "Progress" }, { kind: "completion_claim", label: "Completed work" },
    { kind: "blocked", label: "Blocker" }, { kind: "priority_change", label: "Priority change" }, { kind: "new_task", label: "New task" },
  ];
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  const agendaMode = mode === "agenda";
  const receiptTitle = receipt?.kind === "new_task"
    ? receipt.queued ? "Task queued" : "Task added"
    : receipt?.queued ? "Update queued" : "Update recorded";
  return <div className={`progress-dock ${agendaMode ? "agenda-dock" : "progress-mode"} ${open ? "open" : ""}`}>
    {open && <section className={`progress-flyout ${panel === "goal" ? "goal-flyout" : agendaMode ? "agenda-flyout" : ""}`} role="dialog" aria-label={panel === "goal" ? "Daily focus editor" : "Daily update composer"}>
      <header><div><span>{panel === "goal" ? <><Pencil size={14} /> Daily focus</> : <><MessageSquareText size={14} /> Daily update</>}</span><small>{panel === "goal" ? `${goalProvenance === "accepted_suggestion" ? "Accepted suggestion" : goal ? "Written by you" : "Optional context"} · ${saveLabel}` : required ? "An update is due" : agendaMode ? "Record work or add a task · this does not clock you in" : "Today’s private work log"}</small></div><span className="progress-header-actions">{panel !== "goal" && <><button aria-label="Clear conversation" title="Clear conversation" onClick={onClearChat}><Trash2 size={15} /></button><button aria-label="Start a new chat" title="Start a new chat" onClick={onClearChat}><Plus size={15} /></button></>}<button aria-label="Close composer" onClick={onClose}><X size={16} /></button></span></header>
      {panel === "goal" ? <div className="goal-composer-panel"><div className="goal-editor-field"><label htmlFor="daily-focus-input">What is the goal for today?</label><textarea id="daily-focus-input" aria-describedby="daily-focus-help" autoFocus maxLength={4000} value={goal} onChange={(event) => onGoal(event.target.value)} placeholder="Add context that is not obvious from your tasks" /><small id="daily-focus-help">Tasks remain the source of work intent. This note adds context and does not affect attendance.</small></div>{!goal && goalSuggestion && <div className="goal-suggestion composer-goal-suggestion"><Sparkles size={16} /><div><strong>Suggested from today’s tasks</strong><p>{goalSuggestion.text}</p></div><button onClick={onAcceptSuggestion}>Use suggestion</button></div>}</div> : <div className="progress-conversation" ref={conversationRef}>{history.length > 0 && <div className="progress-history">{history.map((turn, index) => turn.role === "user"
        ? <div className="progress-message user" key={index}><p>{turn.text}</p></div>
        : <div className="progress-message assistant" key={index}><Sparkles size={16} /><div><strong>Assistant</strong><p>{turn.text}</p>{turn.meta === "recorded" ? <small>Recorded</small> : turn.meta ? <small>{turn.meta} — review them below</small> : null}</div></div>)}</div>}{receipt ? <div className="progress-message assistant"><CheckCircle2 size={16} /><div><strong>{receiptTitle}</strong><p>{receipt.message}</p></div></div> : pending ? <>{interpretation?.status === "loading" ? <div className="progress-message assistant"><Sparkles size={16} /><div><strong>Reading your update…</strong><p>Matching it to today's tasks.</p></div></div>
  : interpretation?.status === "ready" && !interpretation.operations.length && interpretation.reply ? <div className="progress-message assistant"><Sparkles size={16} /><div><strong>Assistant</strong><p>{interpretation.reply}</p><small>Share an update below and I’ll turn it into records.</small></div></div>
  : interpretation?.status === "ready" ? <div className="progress-message assistant"><Sparkles size={16} /><div><strong>Here’s what I understood.</strong>{interpretation.reply ? <p>{interpretation.reply}</p> : null}<p>Untick anything you don’t want, edit the wording, and approve — nothing is filed until you do.</p><div className="interpretation-list">{interpretation.operations.map((op, index) => <label className={op.enabled ? "interpretation-row" : "interpretation-row off"} key={index}><input type="checkbox" checked={op.enabled} onChange={() => onToggleOperation?.(index)} /><span>{operationLabel(op.op)}{op.taskId ? ` ${interpretation.taskOptions.find((task) => task.id === op.taskId)?.title ?? op.taskTitle ?? ""}` : op.op === "create_task" ? ` ${op.taskTitle ?? ""}` : ""}</span><input className="interpretation-statement" value={op.statement} maxLength={1000} onChange={(event) => onEditOperation?.(index, event.target.value)} aria-label="Proposed update text" />{(op.op === "complete_task" || op.op === "reopen_task" || op.op === "record_progress") && <select value={op.taskId ?? ""} onChange={(event) => onRemapOperation?.(index, event.target.value)} aria-label="Attach to task"><option value="">No task</option>{interpretation.taskOptions.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>}</label>)}</div><button className="primary approve-interpretation" disabled={busy || !interpretation.operations.some((op) => op.enabled)} onClick={() => onApproveOperations?.(interpretation.operations)}>Approve &amp; record {interpretation.operations.filter((op) => op.enabled).length} update{interpretation.operations.filter((op) => op.enabled).length === 1 ? "" : "s"}</button></div></div>
  : <div className="progress-message assistant"><Sparkles size={16} /><div><strong>{aiUnavailable ? "Assistant is unavailable — choose the update type." : "What kind of update is this?"}</strong><p>Choose one so Work OS records it correctly.{aiUnavailable ? "" : " Nothing is inferred yet."}</p><div className="progress-kind-options">{options.map((option) => <button disabled={busy} key={option.kind} onClick={() => onClassify(option.kind)}>{option.label}</button>)}</div></div></div>}</> : <div className={`progress-welcome ${agendaMode ? "agenda-welcome" : ""}`}><Sparkles size={17} /><div><strong>{history.length ? "Continue the conversation below." : "What would you like to record?"}</strong><p>Share progress, completed work, a blocker, a priority change, or a new task. You’ll choose the type after sending.</p></div></div>}</div>}
    </section>}
    <div className="progress-input-shell"><button className={`focus-dock-button ${panel === "goal" && open ? "active" : ""}`} aria-label="Update today’s focus" aria-pressed={panel === "goal" && open} onClick={onOpenGoal}><Pencil size={15} /><span>Focus</span></button><textarea ref={composerInputRef} rows={1} value={input} onFocus={onOpen} onChange={(event) => onInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit(); } }} placeholder={open ? "Share an update, a blocker, or add a task…" : "Share an update or add a task…"} aria-label="Share an update or add a task" /><span className={required ? "composer-hint due" : "composer-hint"}>{required ? "Update due" : <><kbd>Enter</kbd> to send</>}</span><button className={input.trim() ? "progress-send ready" : "progress-send"} aria-label="Review update type" aria-keyshortcuts="Enter" disabled={!input.trim() || busy} onClick={onSubmit}><ArrowUp size={17} /></button></div>
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

export function TasksWorkspace({ currentDate, historyDate, currentPlan, historicalPlan, historicalTasks, goal, goalProvenance, suggestion, saveState, taskView, todayTasks, taskHistory, carryOver, carryOverOpen, loadingMore, hasMore, busy, initialTaskMenuId = null, initialSearch = "", onTaskView, onDate, onEditFocus, onAddTask, onOpenTask, onEditTask, onArchiveTask, onDeleteTask = () => undefined, onSurfaceTask, onTaskCompletion, onCarryOverOpen, onLoadMore }: {
  currentDate: string; historyDate: string; currentPlan: DailyPlan | null; historicalPlan: DailyPlan | null; historicalTasks: TaskRow[]; goal: string;
  goalProvenance: "employee" | "accepted_suggestion" | null; suggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  taskView: TaskView; todayTasks: TaskRow[]; taskHistory: TaskRow[]; carryOver: ReturnType<typeof unfinishedBefore>; carryOverOpen: boolean;
  loadingMore: boolean; hasMore: boolean; busy: boolean; onTaskView: (view: TaskView) => void; onDate: (date: string) => Promise<void>;
  onEditFocus: () => void; onAddTask: () => void; onOpenTask: (task: TaskRow, readOnly: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask?: (task: TaskRow) => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void; onTaskCompletion: (task: TaskRow, completed: boolean) => void; onCarryOverOpen: (open: boolean) => void; onLoadMore: () => void;
  initialTaskMenuId?: string | null; initialSearch?: string;
}) {
  const [taskMenuId, setTaskMenuId] = useState<string | null>(initialTaskMenuId);
  const [taskSearch, setTaskSearch] = useState(initialSearch);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
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
  const current = parentTasks(uniqueTasks([...todayTasks, ...surfaced]));
  const surfacedIds = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => String(item.task_id));
  const datedTasks = parentTasks(tasksForDate([...historicalTasks, ...surfaced], selectedDate, surfacedIds));
  const displayedCandidates = historical
    ? datedTasks
    : taskView === "today" ? current
      : taskView === "unfinished" ? taskHistory.filter((task) => task.completed !== true)
        : taskView === "overdue" ? taskHistory.filter((task) => task.completed !== true && typeof task.due_date === "string" && task.due_date.slice(0, 10) < currentDate)
        : taskView === "completed" ? taskHistory.filter((task) => task.completed === true)
          : taskHistory;
  const unfiltered = parentTasks(uniqueTasks(displayedCandidates));
  const displayed = filterWorkspaceTasks(unfiltered, currentDate, { query: taskSearch, from: filterFrom, to: filterTo });
  const hasFilters = taskSearch.trim().length > 0 || filterFrom.length > 0 || filterTo.length > 0;
  const displayedSections = historical
    ? displayed.length ? [{ id: "historical", label: "Tasks from this day", note: "Latest activity first", tasks: orderTasksByRecency(displayed) }] : []
    : organizeTaskSections(displayed, currentDate);
  const selectedIds = new Set((currentPlan?.items ?? []).filter((item) => item.disposition === "selected" && item.task_id).map((item) => String(item.task_id)));
  const groups = new Map<string, typeof carryOver>();
  for (const item of carryOver) {
    const key = item.attribution.date ?? "Older";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const previousDays = new Set(carryOver.map((item) => item.attribution.date).filter(Boolean)).size;
  const carryGroups = [...groups.entries()].map(([date, items]) => ({ date, label: date === moveDate(currentDate, -1) ? `Yesterday · ${formatWorkOsDate(date)}` : formatWorkOsDate(date), items }));
  const agendaText = historical
    ? shownPlan?.freeform_intent || "No focus note was recorded for this day."
    : goal || suggestion?.text || "Your open tasks define today’s work.";
  const provenance = historical
    ? !shownPlan?.freeform_intent ? "Task record" : shownPlan.goal_provenance === "accepted_suggestion" ? "Accepted from that day’s tasks" : "Written on this day"
    : goal ? goalProvenance === "accepted_suggestion" ? "Accepted from today’s tasks" : "Written by you" : suggestion ? "Suggested from today’s tasks" : "Task record";
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  return <main className="page tasks-workspace">
    <div className="tasks-heading"><PageIntro eyebrow="Tasks workspace" title={historical ? "Workday history" : "Today’s tasks"} body="Plan today’s work and keep the history behind it." /><div className="date-navigator"><button aria-label="Previous day" onClick={() => void onDate(moveDate(selectedDate, -1))}><ChevronLeft size={16} /></button><label className="formatted-date-picker"><span>{formatWorkOsDate(selectedDate)}</span><input aria-label="Workspace date" type="date" max={currentDate} value={selectedDate} onChange={(event) => void onDate(event.target.value)} /></label><button aria-label="Next day" disabled={selectedDate >= currentDate} onClick={() => void onDate(moveDate(selectedDate, 1))}><ChevronRight size={16} /></button></div></div>
    <section className={`panel task-agenda-hero ${historical ? "historical" : ""}`}>
      <div className="agenda-hero-today"><header><span>{historical ? `Agenda · ${formatWorkOsDate(selectedDate)}` : "Today’s agenda"}</span>{!historical && <button className="agenda-edit-button" onClick={onEditFocus}><Pencil size={14} /> Edit focus</button>}</header><h2>{agendaText}</h2><footer><span><ListChecks size={14} /> {historical ? `${datedTasks.length} task${datedTasks.length === 1 ? "" : "s"} surfaced` : `${current.length} task${current.length === 1 ? "" : "s"} scheduled`}</span><small>{provenance}{!historical ? ` · ${saveLabel}` : ""}</small></footer></div>
      {!historical && <button className={`unfinished-work-hero ${carryOver.length ? "attention" : "clear"}`} disabled={!carryOver.length} onClick={() => onCarryOverOpen(true)}><span className="unfinished-work-icon">{carryOver.length ? <AlertTriangle size={19} /> : <Check size={19} />}</span><span className="unfinished-work-copy"><small>From previous days</small><strong>{carryOver.length ? `${carryOver.length} unfinished task${carryOver.length === 1 ? "" : "s"}` : "Nothing left behind"}</strong><em>{carryOver.length ? `${previousDays} previous workday${previousDays === 1 ? "" : "s"} need attention` : "All earlier work is clear"}</em></span><span className="unfinished-work-action">Review unfinished work <ChevronRight size={15} /></span></button>}
    </section>
    {!historical && <div className="task-view-tabs" role="tablist">{(["today", "unfinished", "overdue", "completed", "all"] as TaskView[]).map((item) => <button role="tab" aria-selected={taskView === item} className={taskView === item ? "active" : ""} key={item} onClick={() => onTaskView(item)}>{item === "today" ? "My day" : item === "unfinished" ? "Open" : item === "all" ? "All tasks" : sentence(item)}</button>)}</div>}
    <section className="task-search-toolbar" aria-label="Task search and date filters"><label className="task-search"><Search size={16} aria-hidden="true" /><input value={taskSearch} onChange={(event) => setTaskSearch(event.target.value)} placeholder="Search tasks" aria-label="Search tasks" />{taskSearch && <button aria-label="Clear task search" onClick={() => setTaskSearch("")}><X size={14} /></button>}</label><div className="task-date-range" role="group" aria-label="Task date range"><CalendarDays size={15} aria-hidden="true" /><label><span>From</span><input aria-label="Filter from date" type="date" max={filterTo || currentDate} value={filterFrom} onChange={(event) => setFilterFrom(event.target.value)} /></label><i aria-hidden="true">—</i><label><span>To</span><input aria-label="Filter to date" type="date" min={filterFrom || undefined} max={currentDate} value={filterTo} onChange={(event) => setFilterTo(event.target.value)} /></label>{(filterFrom || filterTo) && <button onClick={() => { setFilterFrom(""); setFilterTo(""); }}>Clear dates</button>}</div></section>
    <section className="panel task-list-panel"><div className="card-title"><span><ListChecks size={17} /> {historical ? formatWorkOsDate(selectedDate) : sentence(taskView)}{hasFilters && <small className="task-filter-result" role="status">{displayed.length} result{displayed.length === 1 ? "" : "s"}</small>}</span>{!historical && <button className="primary" onClick={onAddTask}><Plus size={15} /> Add task</button>}</div><div className="evidence-list task-records">{displayedSections.length ? displayedSections.map((section) => <section className={`task-record-section ${section.id}`} key={section.id}><header><div><strong>{section.label}</strong><span>{section.tasks.length}</span></div><small>{section.note}</small></header>{section.tasks.map((task) => {
      const attribution = taskDateAttribution(task, currentDate);
      const taskId = String(task.provider_task_id || task.id);
      const menuOpen = taskMenuId === taskId;
      const progress = subtaskProgress(task);
      const isSelected = selectedIds.has(String(task.id)) || selectedIds.has(String(task.provider_task_id));
      const state = taskState(task, currentDate);
      const title = safeTaskText(task.title, "Untitled Nifty task");
      const description = safeTaskText(task.description, "No description added.");
      const projectName = safeTaskText(task.project?.name, "Nifty");
      const milestoneName = safeTaskText(task.milestone?.name, "");
      return <article className={`task-record workspace-task ${task.completed ? "is-completed" : ""} ${isSelected ? "is-surfaced" : ""}`} role="button" tabIndex={0} key={taskId} aria-selected={isSelected} onClick={() => onOpenTask(task, historical)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task, historical); } }}><span className={`task-state ${state}`}>{sentence(state)}</span><div><h3>{title}</h3><p>{description}</p><AssigneeTags task={task} /><small>{projectName}{milestoneName ? ` · ${milestoneName}` : ""}{task.priority ? ` · ${sentence(String(task.priority))} priority` : ""}{task.due_date ? ` · due ${formatWorkOsDate(task.due_date)}` : ""}{task.provider_created_at ? ` · created ${formatWorkOsDate(task.provider_created_at)}` : ""}{task.parent_provider_task_id ? " · subtask" : ""}</small><SyncChip task={task} /></div>{progress.total > 0 && <CompletionRing compact completed={progress.completed} total={progress.total} label="subtasks" />}{!historical && <div className={`workspace-task-menu ${menuOpen ? "open" : ""}`} onClick={(event) => event.stopPropagation()}><EllipsisMenu open={menuOpen} label={`Actions for ${title}`} disabled={busy} onToggle={() => setTaskMenuId(menuOpen ? null : taskId)} onClose={() => setTaskMenuId(null)}>{!task.completed && !isSelected && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task); }}><Plus size={14} /> Add to today</button>}{!task.completed && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task, "deferred"); }}><CirclePause size={14} /> Defer</button>}<button role="menuitem" onClick={() => { setTaskMenuId(null); onTaskCompletion(task, !task.completed); }}>{task.completed ? <RotateCcw size={14} /> : <Check size={14} />} {task.completed ? "Reopen task" : "Mark task done"}</button><button role="menuitem" onClick={() => { setTaskMenuId(null); onEditTask(task); }}><Pencil size={14} /> Edit task</button><button role="menuitem" onClick={() => { setTaskMenuId(null); onArchiveTask(task); }}><Archive size={14} /> Archive <small>reversible</small></button><button className="danger" role="menuitem" onClick={() => { setTaskMenuId(null); onDeleteTask(task); }}><Trash2 size={14} /> Delete permanently</button>{attribution.date && attribution.date < currentDate && <button role="menuitem" onClick={() => { setTaskMenuId(null); void onDate(attribution.date!); }}><ChevronLeft size={14} /> Open original day</button>}</EllipsisMenu></div>}<ChevronRight size={17} /></article>;
    })}</section>) : <Empty title={hasFilters ? "No tasks match these filters" : historical ? "No tasks surfaced" : "No tasks in this view"} body={hasFilters ? "Try a different search or clear the date filters." : historical ? "No Nifty tasks were recorded for this day." : taskView === "completed" ? "Completed tasks will appear here." : "Add a task or choose another view."} />}</div>{!historical && hasMore && <button className="task-load-more" disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Loading more tasks…" : "Load older tasks"}</button>}</section>
    {carryOverOpen && <TaskCarryOverFlyout groups={carryGroups} busy={busy} onClose={() => onCarryOverOpen(false)} onSurfaceTask={onSurfaceTask} onTaskCompletion={onTaskCompletion} onOpenDay={(date) => { onCarryOverOpen(false); void onDate(date); }} />}
  </main>;
}

const durationLabel = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;

function PersonalInsights({ data, loading, range, onRange, onReference, onCorrect }: { data: InsightsData | null; loading: boolean; range: "day" | "7d" | "30d"; onRange: (value: "day" | "7d" | "30d") => void; onReference: (reference: InsightDay["references"][number]) => void; onCorrect: (quality: NonNullable<InsightDay["sessionQuality"]>, date: string) => void }) {
  const notifications = useNotifications();
  const [synthesis, setSynthesis] = useState<{ status: "loading" | "ready" | "failed"; text?: string } | null>(null);
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
      {loading && !data ? <section className="panel"><Empty title="Building your work record" body="Loading daily goals, sessions, task outcomes, updates, and evidence." /></section> : data ? <>
      <div className="metric-grid"><Metric icon={Clock3} label="Observed work time" value={durationLabel(data.totals.observedSeconds)} /><article className="metric"><ListChecks size={18} /><small>Daily tasks</small><CompletionRing compact completed={data.totals.plannedCompleted} total={data.totals.planned} label="complete" /></article><Metric icon={FileCheck2} label="Nifty outcomes" value={String(data.totals.tasksCompleted)} /><Metric icon={Fingerprint} label="Output evidence" value={String(data.totals.outputEvidence)} /></div>
      <section className="panel insight-brief"><header><div><span>{data.brief.generated ? "Agent brief" : "Deterministic brief"}</span><h3>{data.brief.summary}</h3></div><small>{formatWorkOsDate(data.from)} → {formatWorkOsDate(data.through)}</small></header><div><section><strong>Wins</strong>{data.brief.wins.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Needs attention</strong>{data.brief.attention.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Next focus</strong>{data.brief.nextFocus.map((item) => <p key={item}>{item}</p>)}</section></div></section>
      <section className="panel trend-panel"><div className="card-title"><span><Gauge size={17} /> Workday trend</span><small>Observed time and task completion · separate scales</small></div><div className="trend-plot"><div className="trend-axis" aria-hidden="true"><span>8h</span><span>4h</span><span>0h</span></div><div className="trend-chart" role="img" aria-label="Observed work time and daily task completion by day"><div className="trend-grid" aria-hidden="true"><i /><i /><i /></div>{data.days.map((day) => { const observedHeight = Math.min(100, day.observedSeconds / (8 * 3600) * 100); const completionHeight = day.planned ? day.plannedCompleted / day.planned * 100 : 0; return <div className="trend-day" key={day.date}><div className="trend-bars"><i title={`${durationLabel(day.observedSeconds)} observed`} style={{ height: `${observedHeight}%` }}><span>{durationLabel(day.observedSeconds)}</span></i><b title={`${day.plannedCompleted} of ${day.planned} daily tasks`} style={{ height: `${completionHeight}%` }}><span>{day.planned ? `${Math.round(completionHeight)}%` : "—"}</span></b></div><span>{formatWorkOsDate(day.date)}</span></div>; })}</div></div><div className="trend-legend"><span><i /> Observed session time <small>8-hour scale</small></span><span><b /> Daily task completion <small>0–100%</small></span></div>
         <div className="insight-table-wrap"><table><caption>Exact personal insight values</caption><thead><tr><th>Date</th><th>Observed</th><th>Paused</th><th>Daily tasks</th><th>Tasks done</th><th>Updates</th><th>Output evidence</th><th>Session quality</th></tr></thead><tbody>{data.days.map((day) => <tr key={day.date}><td>{formatWorkOsDate(day.date)}</td><td>{durationLabel(day.observedSeconds)}</td><td>{durationLabel(day.pausedSeconds)}</td><td>{day.plannedCompleted}/{day.planned}</td><td>{day.tasksCompleted}</td><td>{day.updates}</td><td>{day.outputEvidence}</td><td>{day.sessionQuality?.status === "needs_correction" ? <button onClick={() => onCorrect(day.sessionQuality!, day.date)}>Needs correction</button> : sentence(day.sessionQuality?.status ?? "none")}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel insight-drilldown"><div className="card-title"><span><Inbox size={17} /> Latest-day record</span><small>{formatWorkOsDate(latest?.date)}</small></div>{latest?.references?.length ? <div>{(latest.references ?? []).map((reference) => <button key={`${reference.type}:${reference.id}`} onClick={() => onReference(reference)}><span>{reference.type === "plan" ? "Daily workspace" : sentence(reference.type)}</span><strong>{reference.label}</strong><ChevronRight size={15} /></button>)}</div> : <Empty title="No linked records" body="This day has no daily goal, task completion, substantive update, or evidence record yet." />}<footer>Nifty synced {data.freshness.niftySyncedAt ? formatWorkOsDateTime(data.freshness.niftySyncedAt) : "unavailable"} · Worktivity observed {data.freshness.worktivityObservedAt ? formatWorkOsDateTime(data.freshness.worktivityObservedAt) : "unavailable"}</footer></section>
      <p className="insight-disclaimer">These are descriptive personal signals, not a performance score. Idle activity is never labeled productivity, and activity context never proves task completion.</p>
    </> : <section className="panel"><Empty title="Insights unavailable" body="Refresh to retry the personal insights record." /></section>}
  </main>;
}
function Setting({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <div className="setting"><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>; }
