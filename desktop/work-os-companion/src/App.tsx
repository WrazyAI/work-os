import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Activity, AlertTriangle, Archive, ArrowUp, BriefcaseBusiness, Bug, CalendarDays, Check, CheckCircle2, ChevronLeft, ChevronRight, CirclePause, CirclePlay, Clock3, FileCheck2, Fingerprint, Gauge, Inbox, LayoutDashboard, ListChecks, LogIn, LogOut, MessageSquareText, MoreHorizontal, MoveRight, Pause, Pencil, PlugZap, Plus, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { apiRequest, flushQueue, sendOrQueue, updateTaskCompletion } from "./api";
import { beginAuthentication, errorMessage, listenForAuthentication } from "./auth";
import { diagnostics, exportDiagnostics, openDebuggerWindow, openLogsDir } from "./diagnostics";
import { formatWorkOsDate, formatWorkOsDateTime } from "./dateFormat";
import { useNotifications } from "./NotificationFlyouts";
import Onboarding from "./Onboarding";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO } from "./scenarios";
import { schedulePrompt } from "./scheduler";
import { sessionGate } from "./sessionGate";
import { shiftPulse } from "./shiftPulse";
import { parentTasks, subtaskProgress, suggestDailyGoal, taskDateAttribution, taskKind, tasksForDate, unfinishedBefore, uniqueTasks, type TaskRow } from "./taskWorkspace";
import type { DailyPlan, DailyPlanItem, DayData, DebugScenario, DesktopSession, InsightDay, InsightsData, OnboardingData } from "./types";
import { secureState } from "./vault";
import companionArt from "./assets/work-os-task-stack-v2.png";
import wordmark from "./assets/work-os-mark.png";
import "./plan-insights.css";

type AssetSource = string | { src: string };
const assetUrl = (asset: AssetSource) => typeof asset === "string" ? asset : asset.src;

type View = "day" | "tasks" | "review" | "insights" | "evidence" | "settings";
type TaskView = "today" | "unfinished" | "completed" | "all";
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
const views: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "day", label: "Today", icon: LayoutDashboard }, { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "review", label: "Review", icon: MessageSquareText }, { id: "insights", label: "Insights", icon: Gauge },
  { id: "evidence", label: "Evidence", icon: ShieldCheck }, { id: "settings", label: "Settings", icon: Settings },
];

const formatTime = (value?: string | null, zone?: string) => value ? new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
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

function moveMenuFocus(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return false;
  const active = document.activeElement as HTMLElement | null;
  const menu = active?.closest<HTMLElement>('[role="menu"]');
  if (!menu) return false;
  const items = Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'));
  if (!items.length) return false;
  event.preventDefault();
  const current = Math.max(0, items.indexOf(active!));
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (current + 1) % items.length : (current - 1 + items.length) % items.length;
  items[next]?.focus();
  return true;
}

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
  const [debugScenario, setDebugScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);
  const [pulseNow, setPulseNow] = useState(() => new Date());
  const debugRef = useRef(debugScenario);
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
    const [onboardingResult, dayResult] = await Promise.allSettled([
      options.dayOnly ? Promise.resolve<OnboardingData | null>(null) : apiRequest<OnboardingData>("/api/work-os/me/onboarding"),
      apiRequest<DayData>(`/api/work-os/me/day${options.refreshProviders ? "?refreshProviders=true" : ""}`),
    ]);
    if (onboardingResult.status === "rejected") throw onboardingResult.reason;
    if (onboardingResult.value) setOnboarding(onboardingResult.value);
    if (dayResult.status === "rejected") {
      const message = errorMessage(dayResult.reason, "Your profile loaded, but the workday could not be refreshed.");
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
    await schedulePrompt(nextDay, () => apiRequest<DayData>("/api/work-os/me/day"));
    return nextDay;
  }, [showError]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void Promise.all([secureState.session(), secureState.queue(), secureState.settings(), isTauri() ? isEnabled() : Promise.resolve(false)]).then(([saved, queue, settings, enabled]) => {
      const current = saved?.apiBase ? saved : null; setSession(current); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length); setApiBase(settings.apiBase); setAutoStart(enabled);
      if (current) void refresh().catch((value) => showError(value, "Could not load your workday.", "Workday unavailable"));
    }).catch((value) => showError(value, "Could not open the local vault.", "Local workspace unavailable"));
    void listenForAuthentication((saved) => { setSession(saved); notifications.success("This device is connected to your workspace.", "Workspace connected"); void refresh(); }, (value) => showError(value, "Desktop authorization failed.", "Authorization failed")).then((fn) => { cleanup = fn; }).catch((value) => showError(value, "Could not listen for desktop sign-in.", "Sign-in listener failed"));
    return () => cleanup?.();
  }, [notifications, refresh, showError]);

  useEffect(() => {
    if (!session) return;
    const recover = async () => { if (!navigator.onLine) return; const result = await flushQueue(); setQueueCount(result.remaining); setQueueAttentionCount(result.needsAttention); await refresh({ dayOnly: true }); };
    window.addEventListener("online", recover); const timer = window.setInterval(() => void recover().catch(() => undefined), 60_000);
    return () => { window.removeEventListener("online", recover); clearInterval(timer); };
  }, [refresh, session]);

  useEffect(() => {
    const timer = window.setInterval(() => setPulseNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
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
    if (view !== "insights" || !session || debugRef.current.enabled) return;
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
      if (debugRef.current.enabled) throw new Error("Scenario mode is active. Reset the debugger scenario before submitting real changes.");
      await action(); const queue = await secureState.queue(); setQueueCount(queue.length); setQueueAttentionCount(queue.filter((item) => item.status === "needs_attention").length); await refresh();
      diagnostics.info("ui.action.completed", label, { activeView: view });
      notifications.success(actionSuccessMessages[label] ?? "The change was saved.");
    }
    catch (value) {
      const message = value instanceof Error ? value.message : "Action failed";
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
  const visibleSession = debugScenario.enabled
    ? debugScenario.authState === "unauthenticated" ? null : session ?? { token: "debug-local", expiresAt: new Date(Date.now() + 3_600_000).toISOString(), organizationId: "debug", apiBase: "Local scenario" }
    : session;
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
  const paused = workSession?.state === "paused";
  const hasVisibleSession = Boolean(visibleSession);
  useEffect(() => {
    if (!hasVisibleSession || visibleOnboarding?.onboardingRequired || !gate.persistentMessage) return;
    notifications.persistent("work-os-session-gate", gate.persistentMessage, gate.persistentTitle, "info");
  }, [gate.persistentMessage, gate.persistentTitle, hasVisibleSession, notifications, visibleOnboarding?.onboardingRequired]);
  const todayParentTasks = parentTasks(visibleDay?.tasks ?? []);
  const openTasks = todayParentTasks.filter((task) => !task.completed);
  const completedTodayTasks = visibleDay?.workspaceSummary?.completed ?? visibleDay?.tasks.filter((task) => task.completed).length ?? 0;
  const totalTodayTasks = visibleDay?.workspaceSummary?.total ?? visibleDay?.tasks.length ?? 0;
  const goalSuggestion = useMemo(() => suggestDailyGoal(parentTasks(visibleDay?.tasks ?? []), visibleDay?.shiftDate ?? "", planItems), [visibleDay?.tasks, visibleDay?.shiftDate, planItems]);
  const unfinishedCarryOver = useMemo(() => visibleDay?.workspaceSummary?.carryOverGroups
    ? visibleDay.workspaceSummary.carryOverGroups.flatMap((group) => group.tasks.map((task) => ({ task, attribution: { date: task.due_date ?? null, reason: "carried" as const } })))
    : unfinishedBefore(parentTasks(taskHistory), visibleDay?.shiftDate ?? ""), [taskHistory, visibleDay?.shiftDate, visibleDay?.workspaceSummary]);
  const pulse = shiftPulse(workSession, visibleDay?.shift ?? null, pulseNow, visibleDay?.breakPolicy?.worktivityAuthoritative === true, visibleDay?.attendance);
  const extendedClockOut = !!visibleDay?.shift?.endsAt && pulseNow.getTime() > Date.parse(visibleDay.shift.endsAt) + 15 * 60_000;

  function editPlan(mutator: () => void) {
    planEditVersion.current += 1;
    mutator();
    setPlanDirty(true);
  }

  async function loadPlanHistory(date: string) {
    setPlanHistoryDate(date);
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
    setView(reference.type === "evidence" ? "evidence" : "day");
  }

  async function loadMoreTasks() {
    if (taskHistoryCursor === null || !visibleDay || taskHistoryLoading) return;
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
    const taskId = String(task.provider_task_id || task.id);
    setTaskDetailsReadOnly(readOnly); setTaskDetailsLoading(true); setTaskDetails({ task, subtasks: [], moveTargets: [] }); setSubtaskTitle(""); setSubtaskDescription(""); setSubtaskMenuId(null); setMoveMenuId(null);
    try {
      const details = await loadTaskDetails(taskId);
      setTaskDetails(details);
      if (details.subtaskSync?.error) notifications.error("Couldn’t refresh subtasks from Nifty. Showing the last mirrored records.", "Subtasks may be stale");
    }
    catch (value) { setTaskDetails(null); showError(value, "Could not open this task.", "Task unavailable"); }
    finally { setTaskDetailsLoading(false); }
  }

  function submitTaskFromDesktop() {
    if (!taskComposerTitle.trim()) return;
    void act("task.create", async () => {
      const result = await apiRequest<{ task: Record<string, any>; providerStatus: string; mirrorStatus: string }>("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: taskComposerTitle.trim(), description: taskComposerDescription.trim() || undefined, assignee_person_ids: taskComposerAssignees }) });
      setTaskComposerTitle(""); setTaskComposerDescription(""); setTaskComposerAssignees([]);
      if (result.providerStatus !== "nifty_confirmed") notifications.info(`Task submitted · ${result.mirrorStatus}`, "Provider confirmation pending");
      setTaskComposerOpen(false);
    });
  }

  function surfaceTask(task: TaskRow, disposition: "selected" | "deferred" = "selected") {
    void act(disposition === "selected" ? "workspace.task_surface" : "workspace.task_defer", () => sendOrQueue("/api/work-os/me/plan", "PATCH", {
      [disposition === "selected" ? "surface_task_id" : "defer_task_id"]: task.id,
    }));
  }

  function setTaskCompletion(task: TaskRow, completed: boolean, refreshDetails = false) {
    const taskId = String(task.provider_task_id || task.id);
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
    void act("shift.clock_in", () => sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop" }));
  }

  function confirmClockIn() {
    if (!clockInConfirmation) return;
    if (clockInConfirmation.kind === "exception" && !clockInConfirmation.reason.trim()) return;
    const confirmation = clockInConfirmation;
    setClockInConfirmation(null);
    void act("shift.clock_in", () => sendOrQueue("/api/work-os/me/workday", "POST", confirmation.kind === "late"
      ? { source: "desktop", late_acknowledged: true }
      : { source: "desktop", exception_acknowledged: true, exception_reason: confirmation.reason.trim() }));
  }

  function confirmClockOut() {
    setClockOutConfirmation(false);
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
    setPendingProgressUpdate(text);
    setProgressReceipt(null);
    setProgressPanel("update");
    setProgressComposerOpen(true);
    setInput("");
  }

  function classifyProgressUpdate(kind: ProgressUpdateKind) {
    const text = pendingProgressUpdate.trim();
    if (!text) return;
    requireActive("check_in.classify", async () => {
      if (kind === "new_task") {
        const title = text.replace(/\s+/g, " ").slice(0, 240);
        const taskResult = await sendOrQueue("/api/work-os/me/tasks", "POST", {
          name: title,
          description: "Added from today’s progress conversation.",
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

  function requireActive(label: string, action: () => Promise<unknown>) {
    if (!active) {
      diagnostics.warn("ui.action.blocked", gate.message, { action: label, activeView: view });
      showError(gate.message, gate.message, "Action unavailable");
      return;
    }
    void act(label, action);
  }

  if (!visibleSession) return <ConnectScreen apiBase={apiBase} setApiBase={setApiBase} connecting={connecting} onDebug={() => void openDebugger()} onConnect={() => void connectWorkspace()} onSave={async () => { try { await secureState.saveSettings({ apiBase }); notifications.success("The server address was saved.", "Settings saved"); } catch (value) { showError(value, "The server address could not be saved.", "Settings not saved"); } }} />;
  if (!visibleOnboarding) return <LoadingScreen failed={!!error} retry={() => void refresh()} />;
  if (visibleOnboarding.onboardingRequired) return <Onboarding data={visibleOnboarding} simulated={debugScenario.enabled} busy={busy} onNotify={notifications.notify} onOpenDebug={() => void openDebugger()} onLogout={() => void logout()} onComplete={() => { notifications.success("Your workspace setup is complete.", "Welcome to Work OS"); void refresh(); }} onSaveDraft={async (body) => { if (debugScenario.enabled) return visibleOnboarding; const next = await sendOrQueue("/api/work-os/me/onboarding", "PUT", body); if ((next as { queued?: boolean }).queued) { setQueueCount((await secureState.queue()).length); return { queued: true }; } const onboarding = next as OnboardingData; setOnboarding(onboarding); return onboarding; }} onSubmit={async (body) => { if (debugScenario.enabled) { setScenario({ ...debugScenario, onboardingState: "complete", missingDetails: [] }); return visibleDay?.attendance; } const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "POST", headers: { "Idempotency-Key": String(body.clientMutationKey ?? "") }, body: JSON.stringify(body) }); setOnboarding(next); const result = await apiRequest<{ attendance?: DayData["attendance"] }>("/api/work-os/me/workday"); return result.attendance; }} />;

  return <div className="workspace">
    <aside className="rail">
      <div className="wordmark"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div>
      <nav aria-label="Work OS"><div className="nav-group nav-core">{views.slice(0, 3).map(({ id, label, icon: Icon }) => <button key={id} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === "review" && !!visibleDay?.proposals.length && <em>{visibleDay.proposals.length}</em>}</button>)}</div><div className="nav-group nav-context">{views.slice(3, 5).map(({ id, label, icon: Icon }) => <button key={id} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</div><div className="nav-group nav-settings">{views.slice(5).map(({ id, label, icon: Icon }) => <button key={id} className={`nav-${id} ${view === id ? "active" : ""}`} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span></button>)}</div></nav>
      <div className="rail-foot"><span className={`presence ${active && !paused ? "live" : gate.worktivitySynced ? "observed" : ""}`} /> <div><strong>{active ? paused ? "Paused" : "On shift" : gate.worktivitySynced ? "Activity synced" : "Off shift"}</strong><small>{queueCount ? `${queueCount} queued` : gate.worktivitySynced ? "Worktivity connected" : navigator.onLine ? "Synced" : "Offline"}</small></div></div>
    </aside>
    <section className="stage">
      <header className="masthead"><div><p>{formatWorkOsDate(visibleDay?.shiftDate)}</p><h1>{views.find((item) => item.id === view)?.label}</h1></div><div className="mast-actions"><span className="provider" title={visibleDay?.niftySync?.error || `Nifty is authoritative · last synced ${visibleDay?.niftySync?.syncedAt ? formatWorkOsDateTime(visibleDay.niftySync.syncedAt, visibleDay.shift?.timezone) : "never"}`}><PlugZap size={14} /> Nifty {visibleDay?.niftySync?.fresh ? `source · ${openTasks.length} open` : visibleDay?.niftySync?.syncing ? "refreshing" : "delayed"}</span><button className="icon" title="Refresh Nifty, Worktivity, and the workday" onClick={() => void refresh({ refreshProviders: true })}><RefreshCw size={17} /></button><button className="avatar" aria-label={`Profile for ${visibleOnboarding.profile.displayName}`}>{initials(visibleOnboarding.profile.displayName)}</button></div></header>
      {debugScenario.enabled && <div className="notice debug"><Bug size={15} /> Scenario mode is active. Writes are disabled.<button onClick={() => setScenario(DEFAULT_DEBUG_SCENARIO)}>Reset</button></div>}
      {view === "day" && (!active ? <main className="day-grid off-shift-day">
        <section className="hero-card">
          <div className="hero-copy"><span className="kicker">{active ? `${sentence(workSession!.state)} · ${formatTime(workSession?.clocked_in_at, visibleDay?.shift?.timezone)}` : gate.worktivitySynced ? "Worktivity connected" : "Ready when you are"}</span><h2>{active ? paused ? "Workday paused." : "Today, in motion." : gate.worktivitySynced ? "Activity is syncing." : "Ready to start."}</h2><p>{active ? visibleDay?.prompt.reason : gate.worktivitySynced ? "Worktivity activity is syncing. Your Work OS session remains separate and ready when you need it." : visibleDay?.shift ? `Scheduled ${formatTime(visibleDay.shift.startsAt, visibleDay.shift.timezone)}–${formatTime(visibleDay.shift.endsAt, visibleDay.shift.timezone)}.` : "No scheduled shift is active. Starting work creates an exception session without an inferred end time."}</p>
            <div className="hero-actions">{!active ? <button className="primary" disabled={busy || !gate.canClockIn} onClick={clockIn}><CirclePlay size={17} /> Clock in</button> : <>{!visibleDay?.breakPolicy?.worktivityAuthoritative && <button className="primary" disabled={busy} onClick={() => void act("shift.pause_toggle", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: paused ? "resume" : "pause" }))}>{paused ? <CirclePlay size={17} /> : <CirclePause size={17} />}{paused ? "Resume" : "Pause"}</button>}<button disabled={busy} onClick={() => setClockOutConfirmation(true)}>Clock out</button></>}</div>
            {visibleDay?.attendance && <small className="attendance-context">Observed context: {visibleDay.attendance.message}</small>}
          </div><img className="companion" src={assetUrl(companionArt)} alt="Focused desk with a task checklist" />
        </section>
        <ShiftPulseCard pulse={pulse} now={pulseNow} shift={visibleDay?.shift ?? null} prompt={visibleDay?.prompt ?? null} active={active} attendance={visibleDay?.attendance ?? null} openTasks={openTasks.length} reviews={visibleDay?.proposals.length ?? 0} />
        <section className="focus-card today-card"><div className="card-title"><span><BriefcaseBusiness size={17} /> Focus and tasks</span><button onClick={() => setView("tasks")}>Open Tasks <ChevronRight size={14} /></button></div><div className="today-goal"><small>Focus note</small><strong>{planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}</strong><span>{planIntent ? goalProvenance === "accepted_suggestion" ? "Derived from your tasks" : "Written by you" : goalSuggestion ? "Suggested from your tasks" : "Nifty is the task record"}</span></div><div className="today-progress"><CompletionRing completed={completedTodayTasks} total={totalTodayTasks} label="tasks complete" />{(visibleDay?.workspaceSummary?.overdueCount ?? unfinishedCarryOver.length) > 0 && <button onClick={() => { setCarryOverOpen(true); setView("tasks"); }}>{visibleDay?.workspaceSummary?.overdueCount ?? unfinishedCarryOver.length} overdue task{(visibleDay?.workspaceSummary?.overdueCount ?? unfinishedCarryOver.length) === 1 ? "" : "s"}</button>}</div>{openTasks.slice(0, 3).map((task, index) => { const state = taskState(task, visibleDay?.shiftDate ?? ""); return <div className="focus-row" key={task.id}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{task.title}</strong><small>Nifty task · {task.due_date ? `due ${formatWorkOsDate(task.due_date)}` : "open"}</small></div><span className={`task-state ${state}`}>{sentence(state)}</span></div>; })}<div className="today-actions"><button onClick={() => setView("tasks")}>Open Tasks</button><button onClick={() => void openTaskComposer()}>Add Task</button><button onClick={() => setView("tasks")}>Update Focus</button>{unfinishedCarryOver.length > 0 && <button onClick={() => { setCarryOverOpen(true); setView("tasks"); }}>Review Overdue</button>}</div></section>
      </main> : <ActiveDayWorkspace
        focus={planIntent || goalSuggestion?.text || "Your open tasks define today’s work."}
        focusSource={planIntent ? goalProvenance === "accepted_suggestion" ? "Derived from today’s tasks" : "Your focus note" : goalSuggestion ? "Suggested from today’s tasks" : "Nifty task record"}
        tasks={visibleDay?.tasks ?? []}
        previousTasks={unfinishedCarryOver.filter((item) => item.attribution.date === moveDate(visibleDay?.shiftDate ?? "", -1)).map((item) => item.task)}
        otherTasks={unfinishedCarryOver.filter((item) => !!item.attribution.date && item.attribution.date < moveDate(visibleDay?.shiftDate ?? "", -1)).map((item) => item.task)}
        elapsed={pulse.elapsedLabel}
        progressPercent={pulse.progressPercent}
        nextPrompt={formatTime(visibleDay?.prompt.nextPromptAt, visibleDay?.shift?.timezone)}
        shiftStart={formatTime(visibleDay?.shift?.startsAt, visibleDay?.shift?.timezone)}
        shiftEnd={formatTime(visibleDay?.shift?.endsAt, visibleDay?.shift?.timezone)}
        remaining={timeRemaining(visibleDay?.shift?.endsAt)}
        timezone={visibleDay?.shift?.timezone}
        attendance={visibleDay?.attendance}
        providerBreakSeconds={workSession?.provider_break_seconds ?? 0}
        reviews={visibleDay?.proposals.length ?? 0}
        paused={paused}
        busy={busy}
        canPause={!visibleDay?.breakPolicy?.worktivityAuthoritative}
        onEditFocus={openGoalComposer}
        onAddTask={() => void openTaskComposer()}
        onManageTasks={() => setView("tasks")}
        onOpenTask={(task) => void openTaskDetails(task)}
        onToggleTask={setTaskCompletion}
        onPause={() => void act("shift.pause_toggle", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: paused ? "resume" : "pause" }))}
        onClockOut={() => setClockOutConfirmation(true)}
      />)}
      {view === "tasks" && <TasksWorkspace currentDate={visibleDay?.shiftDate ?? ""} historyDate={planHistoryDate} currentPlan={visibleDay?.plan ?? null} historicalPlan={historicalPlan} historicalTasks={historicalTasks} goal={planIntent} goalProvenance={goalProvenance} suggestion={goalSuggestion} saveState={planSaveState} taskView={taskView} todayTasks={visibleDay?.tasks ?? []} taskHistory={taskHistory} carryOver={unfinishedCarryOver} carryOverOpen={carryOverOpen} loadingMore={taskHistoryLoading} hasMore={taskHistoryCursor !== null} busy={busy} onTaskView={setTaskView} onDate={loadPlanHistory} onGoal={(value) => editPlan(() => { setPlanIntent(value); setGoalProvenance(value.trim() ? "employee" : null); setSuggestionTaskIds([]); })} onAcceptSuggestion={() => { if (!goalSuggestion) return; editPlan(() => { setPlanIntent(goalSuggestion.text); setGoalProvenance("accepted_suggestion"); setSuggestionTaskIds(goalSuggestion.taskIds); }); }} onAddTask={() => void openTaskComposer()} onOpenTask={(task, readOnly) => void openTaskDetails(task, readOnly)} onEditTask={editTask} onArchiveTask={(task) => requestTaskRemoval(task, true, "archive")} onDeleteTask={(task) => requestTaskRemoval(task, true, "delete")} onSurfaceTask={surfaceTask} onTaskCompletion={setTaskCompletion} onCarryOverOpen={setCarryOverOpen} onLoadMore={() => void loadMoreTasks()} />}
      {view === "review" && <ReviewWorkspace proposals={visibleDay?.proposals ?? []} busy={busy} onReject={(id) => void act("proposal.reject", () => sendOrQueue(`/api/work-os/proposals/${id}`, "PATCH", { decision: "reject" }))} onApprove={(id) => void act("proposal.accept", () => sendOrQueue(`/api/work-os/proposals/${id}`, "PATCH", { decision: "accept" }))} />}
      {view === "insights" && <PersonalInsights data={insights} loading={insightsLoading} range={insightRange} onRange={setInsightRange} onReference={(reference) => void openInsightReference(reference)} onCorrect={(quality, date) => { if (!quality.sessionId) return; setMissedClockOut({ sessionId: quality.sessionId, date, clockedInAt: quality.clockedInAt ?? null }); setMissedClockOutAt(""); setMissedClockOutReason(""); }} />}
      {view === "evidence" && <main className="page"><PageIntro eyebrow="Provenance" title="Evidence with its labels intact." body="Claims, activity observations, and output artifacts are never collapsed into one misleading score." /><section className="evidence-list">{visibleDay?.evidence.length ? visibleDay.evidence.map((item) => <article key={item.id}><span className={`evidence-kind ${item.source === "worktivity" ? "activity" : "output"}`}>{item.source === "worktivity" ? "Activity context" : "Output evidence"}</span><div><h3>{item.title}</h3><p>{item.summary || "No summary available."}</p></div><time>{item.occurred_at ? formatTime(item.occurred_at, visibleDay.shift?.timezone) : "Today"}</time></article>) : <Empty title="No evidence yet" body="Verified provider events and purpose-limited activity context will appear here." />}</section></main>}
      {view === "settings" && <main className="page"><PageIntro eyebrow="Workspace control" title="Your companion, your boundaries." body="Manage launch behavior, local sync, privacy context, updates, and diagnostics." /><section className="settings-panel"><Setting title="Start with Windows" detail="Open quietly in the tray after sign-in"><input type="checkbox" checked={autoStart} onChange={(event) => void toggleAutoStart(event.target.checked)} /></Setting><Setting title="Offline queue" detail={queueAttentionCount ? `${queueAttentionCount} update${queueAttentionCount === 1 ? "" : "s"} need attention` : queueCount ? `${queueCount} updates waiting to sync` : "Everything is synced"}><span className="status-dot">{queueAttentionCount ? "Needs Attention" : "Ready"}</span></Setting><Setting title="Scenario debugger" detail="Opens a separate diagnostics window. Ctrl+Shift+D"><button onClick={() => void openDebugger()}><Bug size={15} /> Open</button></Setting><Setting title="Export diagnostics" detail="Redacted ZIP of recent events. Never includes tokens or queue bodies."><button onClick={() => void exportAppDiagnostics()}>Export</button></Setting><Setting title="Desktop updates" detail={updateStatus || "Internal update channel"}><button onClick={() => void checkForUpdates()}>Check</button></Setting><Setting title="Restart onboarding" detail="Clear your personal setup answers and return to employee onboarding. Manager-owned setup and consent history stay intact."><button disabled={busy} onClick={() => void resetOnboarding()}><RotateCcw size={15} /> Reset</button></Setting><Setting title="Account session" detail={`Signed in through ${visibleSession.apiBase}`}><button className="danger" disabled={busy} onClick={() => void logout()}><LogOut size={15} /> Sign out</button></Setting></section></main>}
      {view === "day" && active && <ProgressComposer
        input={input}
        open={progressComposerOpen}
        panel={progressPanel}
        pending={pendingProgressUpdate}
        receipt={progressReceipt}
        busy={busy}
        required={!!visibleDay?.prompt.required}
        goal={planIntent}
        goalProvenance={goalProvenance}
        goalSuggestion={goalSuggestion}
        saveState={planSaveState}
        onInput={setInput}
        onOpen={() => { setProgressPanel("update"); setProgressComposerOpen(true); }}
        onOpenGoal={openGoalComposer}
        onClose={() => { setProgressComposerOpen(false); setPendingProgressUpdate(""); setProgressReceipt(null); }}
        onSubmit={startProgressUpdate}
        onClassify={classifyProgressUpdate}
        onGoal={(value) => editPlan(() => { setPlanIntent(value); setGoalProvenance(value.trim() ? "employee" : null); setSuggestionTaskIds([]); })}
        onAcceptSuggestion={() => { if (!goalSuggestion) return; editPlan(() => { setPlanIntent(goalSuggestion.text); setGoalProvenance("accepted_suggestion"); setSuggestionTaskIds(goalSuggestion.taskIds); }); }}
      />}
    </section>
    {taskComposerOpen && <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setTaskComposerOpen(false); }}><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title"><header><div><span>New task</span><h2 id="task-modal-title">What needs to get done?</h2></div><button aria-label="Close task composer" disabled={busy} onClick={() => setTaskComposerOpen(false)}><X size={18} /></button></header><div className="task-modal-body"><label><span>Task title</span><input autoFocus maxLength={240} value={taskComposerTitle} onChange={(event) => setTaskComposerTitle(event.target.value)} placeholder="Give the task a clear outcome" /></label><label><span>Description <em>optional</em></span><textarea maxLength={20000} value={taskComposerDescription} onChange={(event) => setTaskComposerDescription(event.target.value)} placeholder="Add context, expectations, links, or a definition of done…" /></label><fieldset><legend><UserRound size={14} /> Assignees <em>optional</em></legend>{taskOptionsLoading ? <p>Loading your organization…</p> : taskAssigneeOptions.length ? <div className="assignee-grid">{taskAssigneeOptions.map((person) => { const selected = taskComposerAssignees.includes(person.id); return <label className={selected ? "selected" : ""} key={person.id}><input type="checkbox" checked={selected} onChange={() => setTaskComposerAssignees((current) => selected ? current.filter((id) => id !== person.id) : [...current, person.id])} /><span><strong>{person.displayName}</strong><small>{person.email || "Nifty member"}</small></span><Check size={14} /></label>; })}</div> : <p>No assignable Nifty-mapped members were found. You can still create this task unassigned.</p>}</fieldset></div><footer><button disabled={busy} onClick={() => setTaskComposerOpen(false)}>Cancel</button><button className="primary" disabled={busy || !taskComposerTitle.trim()} onClick={submitTaskFromDesktop}>{busy ? "Creating…" : "Create task"}</button></footer></section></div>}
    {taskDetails && <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setTaskDetails(null); }}>
      <section className="task-modal task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <header><div><span>{taskDetails.task.completed ? "Completed task" : "Active task"}</span><h2 id="task-detail-title">{taskDetails.task.title}</h2></div><button aria-label="Close task details" disabled={busy} onClick={() => setTaskDetails(null)}><X size={18} /></button></header>
        <div className="task-modal-body">{taskDetailsLoading ? <p className="task-loading">Loading task details…</p> : <>
          <section className="task-description"><span>Description</span><p>{taskDetails.task.description || "No description has been added."}</p><AssigneeTags task={taskDetails.task} /><div><small>{taskDetails.task.project?.name || "Nifty"}</small>{taskDetails.task.due_date && <small>Due {formatWorkOsDate(taskDetails.task.due_date)}</small>}<span className={`task-state ${taskState(taskDetails.task, visibleDay?.shiftDate ?? "")}`}>{sentence(taskState(taskDetails.task, visibleDay?.shiftDate ?? ""))}</span></div></section>
          <section className="subtask-section"><header><div><span>Subtasks</span><strong>{taskDetails.subtasks.length}</strong></div>{taskDetails.subtasks.length > 0 && <CompletionRing compact completed={taskDetails.subtasks.filter((subtask) => subtask.completed === true).length} total={taskDetails.subtasks.length} label="complete" />}</header>
            <div className="subtask-list">{taskDetails.subtasks.length ? taskDetails.subtasks.map((subtask) => {
              const subtaskId = String(subtask.provider_task_id || subtask.id);
              const menuOpen = subtaskMenuId === subtaskId;
              const state = taskState(subtask, visibleDay?.shiftDate ?? "");
              return <article key={subtask.id}><div><strong>{subtask.title}</strong><p>{subtask.description || "No description"}</p><AssigneeTags task={subtask} /></div><span className={`task-state ${state}`}>{sentence(state)}</span>{!taskDetailsReadOnly && <div className="subtask-actions"><button className="ellipsis-button" aria-label={`Actions for ${subtask.title}`} aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onClick={() => { setSubtaskMenuId(menuOpen ? null : subtaskId); setMoveMenuId(null); }}><MoreHorizontal size={17} /></button>{menuOpen && <div className="subtask-menu" role="menu"><button role="menuitem" onClick={() => { setSubtaskMenuId(null); setTaskCompletion(subtask, !subtask.completed, true); }}>{subtask.completed ? <RotateCcw size={14} /> : <Check size={14} />} {subtask.completed ? "Reopen subtask" : "Mark subtask done"}</button><button role="menuitem" onClick={() => editTask(subtask)}><Pencil size={14} /> Edit</button><button role="menuitem" onClick={() => setMoveMenuId(moveMenuId === subtaskId ? null : subtaskId)}><MoveRight size={14} /> Move to <ChevronRight size={13} /></button>{moveMenuId === subtaskId && <div className="move-target-menu" role="menu" aria-label="Move subtask to"><span>Move to task</span>{taskDetails.moveTargets.length ? taskDetails.moveTargets.map((target) => <button role="menuitem" key={target.id} onClick={() => moveSubtask(subtask, target)}>{target.title}</button>) : <p>No other open tasks available.</p>}</div>}<button role="menuitem" onClick={() => requestTaskRemoval(subtask, false, "archive")}><Archive size={14} /> Archive <small>reversible</small></button><button className="danger" role="menuitem" onClick={() => requestTaskRemoval(subtask, false, "delete")}><Trash2 size={14} /> Delete permanently</button></div>}</div>}</article>;
            }) : <p className="empty-subtasks">No subtasks yet.</p>}</div>
            {!taskDetailsReadOnly && <div className="inline-subtask"><span>Add a subtask</span><input value={subtaskTitle} maxLength={240} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="What is the next concrete step?" /><textarea value={subtaskDescription} maxLength={20000} onChange={(event) => setSubtaskDescription(event.target.value)} placeholder="Description (optional)" /><button className="primary" disabled={busy || !subtaskTitle.trim()} onClick={submitInlineSubtask}><Plus size={14} /> Add subtask</button></div>}
          </section>
        </>}</div>
        <footer className="task-detail-footer"><button onClick={() => setTaskDetails(null)}>Done</button></footer>
      </section>
    </div>}
    {deleteRequest && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description"><span>{deleteRequest.mode === "delete" ? <Trash2 size={18} /> : <Archive size={18} />}</span><h2 id="delete-confirmation-title">{deleteRequest.mode === "delete" ? "Permanently delete" : "Archive"} this {deleteRequest.closeParent ? "task" : "subtask"}?</h2><p id="delete-confirmation-description">{deleteRequest.mode === "delete" ? <>“{deleteRequest.task.title}” will be permanently removed from Nifty and cannot be restored.</> : <>“{deleteRequest.task.title}” will be hidden from active work but retained in Nifty. It can be restored from Nifty’s archived tasks.</>}{deleteRequest.closeParent && taskDetails?.subtasks.length ? ` Its ${taskDetails.subtasks.length} remaining subtask${taskDetails.subtasks.length === 1 ? "" : "s"} will also be ${deleteRequest.mode === "delete" ? "permanently deleted" : "archived"}.` : ""}</p><div><button disabled={busy} onClick={() => setDeleteRequest(null)}>Cancel</button><button className="confirm-delete" disabled={busy} onClick={confirmTaskRemoval}>{busy ? deleteRequest.mode === "delete" ? "Deleting…" : "Archiving…" : deleteRequest.mode === "delete" ? "Delete permanently" : "Archive"}</button></div></section></div>}
    {editRequest && <div className="task-modal-backdrop"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="edit-task-title"><header><div><span>Edit {editRequest.kind}</span><h2 id="edit-task-title">Update the Nifty record</h2></div><button aria-label="Close editor" disabled={busy} onClick={() => setEditRequest(null)}><X size={18} /></button></header><div className="task-modal-body"><label><span>Title</span><input autoFocus maxLength={240} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label><span>Description</span><textarea maxLength={20000} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label></div><footer><button disabled={busy} onClick={() => setEditRequest(null)}>Cancel</button><button className="primary" disabled={busy || !editTitle.trim()} onClick={submitTaskEdit}>Save changes</button></footer></section></div>}
    {clockInConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{clockInConfirmation.kind === "late" ? "Confirm late start" : "Confirm exception start"}</h2><p>{clockInConfirmation.kind === "late" ? "This clock-in is after the scheduled start. Your acknowledgement will be retained in the audit record." : "There is no startable scheduled shift right now. Explain the exception before Work OS starts a separate exception session."}</p>{clockInConfirmation.kind === "exception" && <textarea autoFocus maxLength={1000} value={clockInConfirmation.reason} onChange={(event) => setClockInConfirmation({ ...clockInConfirmation, reason: event.target.value })} placeholder="Reason for starting outside the scheduled window" />}<div><button disabled={busy} onClick={() => setClockInConfirmation(null)}>Cancel</button><button className="primary" disabled={busy || (clockInConfirmation.kind === "exception" && !clockInConfirmation.reason.trim())} onClick={confirmClockIn}>Confirm clock-in</button></div></section></div>}
    {missedClockOut && <div className="task-modal-backdrop"><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="missed-clockout-title"><header><div><span>Session correction · {formatWorkOsDate(missedClockOut.date)}</span><h2 id="missed-clockout-title">Enter the exact clock-out time</h2></div><button aria-label="Close correction" onClick={() => setMissedClockOut(null)}><X size={18} /></button></header><div className="task-modal-body"><p>Work OS will not infer this timestamp. Enter the time you actually stopped working.</p>{missedClockOut.clockedInAt && <small>Clocked in {formatWorkOsDateTime(missedClockOut.clockedInAt)}</small>}<label><span>Clock-out timestamp</span><input type="datetime-local" value={missedClockOutAt} onChange={(event) => setMissedClockOutAt(event.target.value)} /></label><label><span>Correction note <em>optional</em></span><textarea value={missedClockOutReason} onChange={(event) => setMissedClockOutReason(event.target.value)} /></label></div><footer><button onClick={() => setMissedClockOut(null)}>Cancel</button><button className="primary" disabled={busy || !missedClockOutAt} onClick={correctMissedClockOut}>Save correction</button></footer></section></div>}
    {clockOutConfirmation && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true"><span><AlertTriangle size={18} /></span><h2>{extendedClockOut ? "Confirm extended shift" : "Confirm clock-out"}</h2><p>{extendedClockOut ? "This clock-out is more than 15 minutes after the scheduled end. Confirm that you intentionally worked the extended shift; the acknowledgement will be retained in the audit record." : "Clock out and close today’s workspace?"}</p><div><button disabled={busy} onClick={() => setClockOutConfirmation(false)}>Cancel</button><button className="primary" disabled={busy} onClick={confirmClockOut}>{extendedClockOut ? "Confirm extended shift" : "Clock out"}</button></div></section></div>}
  </div>;
}

function ConnectScreen({ apiBase, setApiBase, connecting, onDebug, onConnect, onSave }: { apiBase: string; setApiBase: (value: string) => void; connecting: boolean; onDebug: () => void; onConnect: () => void; onSave: () => Promise<void> }) { return <main className="connect"><section><div className="wordmark large"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div><span className="kicker">Desktop companion</span><h1>Welcome to a clearer workday.</h1><p>Bring your tasks, priorities, and progress into one calm place, then move through the day with confidence and focus.</p><button className="primary connect-button" disabled={connecting} onClick={onConnect}><LogIn size={17} /> {connecting ? "Opening browser…" : "Connect workspace"}</button><details><summary>Server settings</summary><input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://work.example.com" /><button onClick={() => void onSave()}>Save</button></details><button className="quiet" onClick={onDebug}><Bug size={14} /> Scenario debugger</button></section><aside><img src={assetUrl(companionArt)} alt="A welcoming focused workspace" /></aside></main>; }
function LoadingScreen({ failed, retry }: { failed: boolean; retry: () => void }) { return <main className="loading"><img src={assetUrl(wordmark)} alt="" /><h1>{failed ? "Work OS needs another try" : "Preparing your workday"}</h1><p>{failed ? "The details are in the notification above." : "Syncing your schedule, tasks, and provider context…"}</p>{failed && <button className="primary" onClick={retry}>Retry</button>}</main>; }
function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><Sparkles size={20} /><strong>{title}</strong><p>{body}</p></div>; }
function PageIntro({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) { return <header className="page-intro"><span>{eyebrow}</span><h2>{title}</h2><p>{body}</p></header>; }
function Metric({ icon: Icon, label, value }: { icon: typeof Clock3; label: string; value: string }) { return <article className="metric"><Icon size={18} /><small>{label}</small><strong>{value}</strong></article>; }
function moveDate(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
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
  return <section className="shift-detail-popover" role="dialog" aria-label={view === "shift" ? "Shift details" : "Worktivity details"}>
    <header><button className="detail-back" aria-label="Back to detail options" onClick={onBack}><ChevronLeft size={16} /></button><div><span>{view === "shift" ? <Clock3 size={15} /> : <Activity size={15} />}{view === "shift" ? "Shift details" : "Worktivity details"}</span><small>{view === "shift" ? "Schedule and today’s work context" : "Observed provider context only"}</small></div><button aria-label="Close details" onClick={onClose}><X size={16} /></button></header>
    {view === "shift" ? <><div className="shift-pulse-visual"><div className="shift-progress-ring" style={{ "--progress": `${progressPercent * 3.6}deg` } as CSSProperties}><span><small>Scheduled shift</small><strong>{Math.round(progressPercent)}%</strong><em>elapsed</em></span></div><div className="shift-track-summary"><div><span><small>Shift start</small><strong>{shiftStart}</strong></span><span><small>Time remaining</small><strong>{remaining}</strong></span><span><small>Shift end</small><strong>{shiftEnd}</strong></span></div><div className="shift-detail-track"><i style={{ width: `${progressPercent}%` }} /><b style={{ left: `${progressPercent}%` }} /></div></div></div><div className="shift-detail-grid"><span><small>Elapsed</small><strong>{elapsed}</strong></span><span><small>Next update</small><strong>{nextPrompt}</strong></span><span><small>Open tasks</small><strong>{openTasks}</strong></span><span><small>Awaiting review</small><strong>{reviews}</strong></span></div></> : <><div className="worktivity-state"><span className={`presence ${attendance?.state === "active" ? "live" : ""}`} /><div><small>Worktivity observation</small><strong>{attendance?.status ? sentence(attendance.status) : "Unavailable"}</strong></div></div><div className="shift-detail-grid worktivity-grid"><span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span><span><small>Clocked out</small><strong>{attendance?.clockedOutAt ? formatTime(attendance.clockedOutAt, timezone) : "Still active"}</strong></span><span><small>Last activity</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>Observed active time</small><strong>{observedActive}</strong></span><span><small>Provider refresh</small><strong>{formatTime(attendance?.observedAt, timezone)}</strong></span><span><small>OnBreak deducted</small><strong>{providerBreak}</strong></span></div></>}
  </section>;
}

export function ActiveDayWorkspace({ focus, focusSource, tasks, previousTasks, otherTasks, elapsed, progressPercent, nextPrompt, shiftStart, shiftEnd, remaining, timezone, attendance, providerBreakSeconds, reviews, initialDetailView = null, initialDetailsMenuOpen = false, paused, busy, canPause, onEditFocus, onAddTask, onManageTasks, onOpenTask, onToggleTask, onPause, onClockOut }: {
  focus: string; focusSource: string; tasks: TaskRow[]; previousTasks: TaskRow[]; otherTasks: TaskRow[]; elapsed: string; progressPercent: number; nextPrompt: string;
  shiftStart: string; shiftEnd: string; remaining: string; timezone?: string; attendance: DayData["attendance"] | null; providerBreakSeconds: number; reviews: number;
  initialDetailView?: "shift" | "worktivity" | null; initialDetailsMenuOpen?: boolean; paused: boolean; busy: boolean; canPause: boolean;
  onEditFocus: () => void; onAddTask: () => void; onManageTasks: () => void; onOpenTask: (task: TaskRow) => void; onToggleTask: (task: TaskRow, completed: boolean) => void; onPause: () => void; onClockOut: () => void;
}) {
  const [tab, setTab] = useState<"today" | "previous" | "other">("today");
  const [detailsMenuOpen, setDetailsMenuOpen] = useState(initialDetailsMenuOpen || initialDetailView !== null);
  const [detailView, setDetailView] = useState<"shift" | "worktivity" | null>(initialDetailView);
  const displayed = tab === "today" ? tasks : tab === "previous" ? previousTasks : otherTasks;
  const completed = tasks.filter((task) => task.completed === true).length;
  const pendingPrevious = previousTasks.filter((task) => task.completed !== true).length;
  const observedStart = attendance?.clockedInAt ? Date.parse(attendance.clockedInAt) : Number.NaN;
  const observedEnd = attendance?.clockedOutAt ? Date.parse(attendance.clockedOutAt) : attendance?.observedAt ? Date.parse(attendance.observedAt) : Number.NaN;
  const observedSeconds = Number.isFinite(observedStart) && Number.isFinite(observedEnd) ? Math.max(0, Math.floor((observedEnd - observedStart) / 1000) - providerBreakSeconds) : 0;
  const observedActive = `${String(Math.floor(observedSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(observedSeconds % 3600 / 60)).padStart(2, "0")}`;
  const providerBreak = `${String(Math.floor(providerBreakSeconds / 3600)).padStart(2, "0")}:${String(Math.floor(providerBreakSeconds % 3600 / 60)).padStart(2, "0")}`;
  return <main className="active-day-page">
    <section className="active-day-card">
      <header className="active-day-header">
        <div className="active-shift-status"><span className={`presence ${paused ? "" : "live"}`} /><div><small>{paused ? "Shift paused" : "On shift"}</small><strong>{elapsed}</strong></div><div className="active-shift-meter"><i style={{ width: `${progressPercent}%` }} /></div><span><small>Next update</small><strong>{nextPrompt}</strong></span></div>
        <div className="active-day-actions">{canPause && <button className="shift-action-button" disabled={busy} onClick={onPause}>{paused ? <CirclePlay size={15} aria-hidden="true" /> : <CirclePause size={15} aria-hidden="true" />}<span>{paused ? "Resume" : "Pause"}</span></button>}<button className="shift-action-button" disabled={busy} onClick={onClockOut}>Clock out</button><div className="shift-details-menu"><button className="ellipsis-button" aria-label="Open shift details" aria-expanded={detailsMenuOpen} onClick={() => { setDetailsMenuOpen((current) => !current); setDetailView(null); }}><MoreHorizontal size={17} /></button>{detailsMenuOpen && <><button className="shift-popover-scrim" aria-label="Close shift details" onClick={() => { setDetailsMenuOpen(false); setDetailView(null); }} />{detailView ? <ShiftDetailsFloatingCard view={detailView} progressPercent={progressPercent} shiftStart={shiftStart} remaining={remaining} shiftEnd={shiftEnd} elapsed={elapsed} nextPrompt={nextPrompt} openTasks={tasks.filter((task) => !task.completed).length} reviews={reviews} attendance={attendance} timezone={timezone} observedActive={observedActive} providerBreak={providerBreak} onBack={() => setDetailView(null)} onClose={() => { setDetailsMenuOpen(false); setDetailView(null); }} /> : <div className="shift-details-options" role="menu"><button role="menuitem" onClick={() => setDetailView("shift")}><Clock3 size={14} /> Shift details</button><button role="menuitem" onClick={() => setDetailView("worktivity")}><Activity size={14} /> Worktivity details</button></div>}</>}</div></div>
      </header>
      <div className="active-focus-block"><div className="active-focus-copy"><span>Today’s focus</span><div className="active-focus-heading"><h2>{focus}</h2><button className="focus-edit-button" onClick={onEditFocus}><Pencil size={14} /> Update focus</button></div><small><Sparkles size={13} /> {focusSource}</small></div><div className="hero-task-metrics"><button className="hero-metric-button" onClick={() => setTab("today")} aria-label={`${completed} of ${tasks.length} tasks done today. Show Today tasks.`}><CompletionRing completed={completed} total={tasks.length} label="tasks done" /></button><button className={`carryover-metric ${pendingPrevious > 0 ? "pending" : "clear"}`} onClick={() => setTab("previous")} aria-label={`${pendingPrevious} pending task${pendingPrevious === 1 ? "" : "s"} from yesterday. Show Previous day tasks.`}><span><strong>{pendingPrevious}</strong></span><em>pending tasks<br />from yesterday</em></button></div></div>
      <div className="active-task-toolbar"><div className="active-task-tabs" role="tablist"><button role="tab" aria-selected={tab === "today"} className={tab === "today" ? "active" : ""} onClick={() => setTab("today")}>Today <em>{tasks.length}</em></button><button role="tab" aria-selected={tab === "previous"} className={tab === "previous" ? "active" : ""} onClick={() => setTab("previous")}>Previous day {previousTasks.length > 0 && <em className="alert-count">{previousTasks.length}</em>}</button><button role="tab" aria-selected={tab === "other"} className={tab === "other" ? "active" : ""} onClick={() => setTab("other")}>Other days {otherTasks.length > 0 && <em className="older-count">{otherTasks.length}</em>}</button></div><button className="primary add-day-task" onClick={onAddTask}><Plus size={15} /> Add task</button></div>
      {tab === "other" && otherTasks.length > 0 && <div className="older-task-notice" role="status"><span>{otherTasks.length}</span><strong>Older unfinished task{otherTasks.length === 1 ? "" : "s"}</strong><small>From before yesterday</small></div>}
      <div className="active-task-list">{displayed.length ? displayed.map((task) => { const taskId = String(task.provider_task_id || task.id); return <article className={task.completed ? "completed" : ""} key={taskId}><button className="task-check" aria-label={task.completed ? `Reopen ${task.title}` : `Complete ${task.title}`} disabled={busy} onClick={() => onToggleTask(task, !task.completed)}>{task.completed && <Check size={15} />}</button><button className="active-task-copy" onClick={() => onOpenTask(task)}><strong>{task.title}</strong><small>{task.completed ? "Completed" : task.priority ? `${sentence(String(task.priority))} priority` : task.due_date ? `Due ${formatWorkOsDate(task.due_date)}` : "Open today"}</small></button><span className={`task-status ${task.completed ? "done" : "open"}`}>{task.completed ? "Done" : "Open"}</span><ChevronRight size={16} /></article>; }) : <Empty title={tab === "today" ? "A clear day" : tab === "previous" ? "Nothing left behind" : "No older work pending"} body={tab === "today" ? "Add the first task you want to move forward today." : tab === "previous" ? "Yesterday’s open work has been cleared." : "Everything from before yesterday is complete."} />}</div>
      <footer className="active-day-footer"><span>Task changes sync with Nifty.</span><button className="workspace-link-button" onClick={onManageTasks}><span>Open full Tasks workspace</span><ChevronRight size={14} aria-hidden="true" /></button></footer>
    </section>
  </main>;
}

export function ProgressComposer({ input, open, panel, pending, receipt, busy, required, goal, goalProvenance, goalSuggestion, saveState, onInput, onOpen, onOpenGoal, onClose, onSubmit, onClassify, onGoal, onAcceptSuggestion }: {
  input: string; open: boolean; panel: ProgressPanel; pending: string; receipt: ProgressReceipt | null; busy: boolean; required: boolean; goal: string;
  goalProvenance: "employee" | "accepted_suggestion" | null; goalSuggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  onInput: (value: string) => void; onOpen: () => void; onOpenGoal: () => void; onClose: () => void; onSubmit: () => void; onClassify: (kind: ProgressUpdateKind) => void; onGoal: (value: string) => void; onAcceptSuggestion: () => void;
}) {
  const options: Array<{ kind: ProgressUpdateKind; label: string }> = [
    { kind: "material_progress", label: "Progress" }, { kind: "completion_claim", label: "Completed work" },
    { kind: "blocked", label: "Blocker" }, { kind: "priority_change", label: "Priority change" }, { kind: "new_task", label: "New task" },
  ];
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  return <div className={`progress-dock ${open ? "open" : ""}`}>
    {open && <section className={`progress-flyout ${panel === "goal" ? "goal-flyout" : ""}`} aria-label={panel === "goal" ? "Daily focus editor" : "Progress conversation"}>
      <header><div><span>{panel === "goal" ? <><Pencil size={14} /> Daily focus</> : <><MessageSquareText size={14} /> Workday update</>}</span><small>{panel === "goal" ? `${goalProvenance === "accepted_suggestion" ? "Accepted suggestion" : goal ? "Written by you" : "Optional context"} · ${saveLabel}` : required ? "An update is due" : "Today’s private work log"}</small></div><button aria-label="Close composer" onClick={onClose}><X size={16} /></button></header>
      {panel === "goal" ? <div className="goal-composer-panel"><label htmlFor="daily-focus-input">What is the goal for today?</label><textarea id="daily-focus-input" autoFocus maxLength={4000} value={goal} onChange={(event) => onGoal(event.target.value)} placeholder="Add context that is not obvious from your tasks" />{!goal && goalSuggestion && <div className="goal-suggestion"><Sparkles size={16} /><div><strong>Suggested from today’s tasks</strong><p>{goalSuggestion.text}</p></div><button onClick={onAcceptSuggestion}>Use suggestion</button></div>}<small>Tasks remain the source of work intent. This note adds context and does not affect attendance.</small></div> : <div className="progress-conversation">{receipt ? <div className="progress-message assistant"><CheckCircle2 size={16} /><div><strong>{receipt.queued ? "Update queued" : "Update recorded"}</strong><p>{receipt.message}</p></div></div> : pending ? <><div className="progress-message user"><p>{pending}</p></div><div className="progress-message assistant"><Sparkles size={16} /><div><strong>What kind of update is this?</strong><p>Choose one so Work OS records it correctly. Nothing is inferred yet.</p><div className="progress-kind-options">{options.map((option) => <button disabled={busy} key={option.kind} onClick={() => onClassify(option.kind)}>{option.label}</button>)}</div></div></div></> : <div className="progress-welcome"><Sparkles size={17} /><div><strong>Share what changed.</strong><p>You can describe progress naturally. Work OS will ask how to file it after you send.</p></div></div>}</div>}
    </section>}
    <div className="progress-input-shell"><button className="focus-dock-button" aria-label="Update today’s focus" onClick={onOpenGoal}><Pencil size={15} /><span>Focus</span></button><MessageSquareText size={18} /><textarea rows={1} value={input} onFocus={onOpen} onChange={(event) => onInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); onSubmit(); } }} placeholder="Share a progress update…" aria-label="Share a progress update" /><span>{required ? "Update due" : "Enter to send"}</span><button className="progress-send" aria-label="Send progress update" disabled={!input.trim() || busy} onClick={onSubmit}><ArrowUp size={17} /></button></div>
  </div>;
}

function ShiftPulseCard({ pulse, now, shift, prompt, active, attendance, openTasks, reviews }: {
  pulse: ReturnType<typeof shiftPulse>; now: Date; shift: DayData["shift"]; prompt: DayData["prompt"] | null;
  active: boolean; attendance: DayData["attendance"] | null; openTasks: number; reviews: number;
}) {
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
  const workOsState = active ? `Active · ${pulse.elapsedLabel}` : "Not clocked in";
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
  return <section className="pulse-card">
    <div className="card-title pulse-title"><span><Activity size={17} /> Shift pulse</span><small><i className={active ? "live" : attendance?.state === "active" ? "observed" : ""} />{state}</small></div>
    <div className="pulse-visual">
      <div className="pulse-orbit" style={{ "--pulse-progress": `${pulse.progressPercent * 3.6}deg` } as CSSProperties} role="img" aria-label={scheduleAria}>
        <div><small>{scheduleLabel}</small><strong>{progress}%</strong><span>{scheduleStatus}</span></div>
      </div>
      <div className="pulse-timeline">
        <div className="pulse-schedule"><span><small>Shift start</small><strong>{formatTime(shift?.startsAt, timezone)}</strong></span><span><small>{middleLabel}</small><strong>{middleValue}</strong></span><span><small>Shift end</small><strong>{formatTime(shift?.endsAt, timezone)}</strong></span></div>
        <div className="pulse-track"><i style={{ width: `${pulse.progressPercent}%` }} /><b style={{ left: `clamp(7px, ${pulse.progressPercent}%, calc(100% - 7px))` }} /></div>
        <p>Scheduled progress, your explicit Work OS session, Worktivity observations, and task outcomes remain separate.</p>
      </div>
    </div>
    <div className={`pulse-provider ${observationClass}`}>
      <Activity size={15} />
      <div><small>Worktivity observation</small><strong>{providerState}</strong></div>
      <div className="pulse-provider-facts">
        <span><small>Clocked in</small><strong>{formatTime(attendance?.clockedInAt, timezone)}</strong></span>
        <span><small>Clocked out</small><strong>{providerClockOut}</strong></span>
        <span><small>Last activity</small><strong>{attendance?.activityObservedAt ? formatTime(attendance.activityObservedAt, timezone) : "—"}</strong></span>
        <span><small>Observed active time</small><strong>{pulse.observedElapsedLabel}</strong></span>
        <span><small>Provider refresh</small><strong>{attendance?.observedAt ? formatTime(attendance.observedAt, timezone) : "—"}</strong></span>
        <span><small>OnBreak deducted</small><strong>{pulse.observedBreakLabel}</strong></span>
      </div>
    </div>
    <div className="pulse-stats">
      <span><Clock3 size={14} /><small>Work OS session</small><strong>{workOsState}</strong></span>
      <span><MessageSquareText size={14} /><small>Next check-in</small><strong>{formatTime(prompt?.nextPromptAt, timezone)}</strong></span>
      <span><ListChecks size={14} /><small>Open tasks</small><strong>{openTasks}</strong></span>
      <span><ShieldCheck size={14} /><small>Awaiting review</small><strong>{reviews}</strong></span>
    </div>
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

function AssigneeTags({ task }: { task: Record<string, any> }) {
  const assignees = Array.isArray(task.assignees) ? task.assignees.filter((item) => item && typeof item.displayName === "string") : [];
  if (!assignees.length) return null;
  return <div className="task-assignee-tags" aria-label={`Assigned to ${assignees.map((person) => person.displayName).join(", ")}`}>
    {assignees.slice(0, 3).map((person) => <span key={person.personId || person.displayName} title={person.email || person.displayName}><i>{initials(person.displayName)}</i>{person.displayName}</span>)}
    {assignees.length > 3 && <span title={assignees.slice(3).map((person) => person.displayName).join(", ")}>+{assignees.length - 3}</span>}
  </div>;
}

export function TasksWorkspace({ currentDate, historyDate, currentPlan, historicalPlan, historicalTasks, goal, goalProvenance, suggestion, saveState, taskView, todayTasks, taskHistory, carryOver, carryOverOpen, loadingMore, hasMore, busy, onTaskView, onDate, onGoal, onAcceptSuggestion, onAddTask, onOpenTask, onEditTask, onArchiveTask, onDeleteTask = () => undefined, onSurfaceTask, onTaskCompletion, onCarryOverOpen, onLoadMore }: {
  currentDate: string; historyDate: string; currentPlan: DailyPlan | null; historicalPlan: DailyPlan | null; historicalTasks: TaskRow[]; goal: string;
  goalProvenance: "employee" | "accepted_suggestion" | null; suggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  taskView: TaskView; todayTasks: TaskRow[]; taskHistory: TaskRow[]; carryOver: ReturnType<typeof unfinishedBefore>; carryOverOpen: boolean;
  loadingMore: boolean; hasMore: boolean; busy: boolean; onTaskView: (view: TaskView) => void; onDate: (date: string) => Promise<void>;
  onGoal: (value: string) => void; onAcceptSuggestion: () => void; onAddTask: () => void; onOpenTask: (task: TaskRow, readOnly: boolean) => void;
  onEditTask: (task: TaskRow) => void; onArchiveTask: (task: TaskRow) => void; onDeleteTask?: (task: TaskRow) => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void; onTaskCompletion: (task: TaskRow, completed: boolean) => void; onCarryOverOpen: (open: boolean) => void; onLoadMore: () => void;
}) {
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
  useEffect(() => {
    if (!taskMenuId) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => document.querySelector<HTMLElement>('.workspace-task-menu .subtask-menu [role="menuitem"]')?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (moveMenuFocus(event)) return;
      if (event.key === "Escape") { event.preventDefault(); setTaskMenuId(null); }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".workspace-task-menu")) setTaskMenuId(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [taskMenuId]);
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
        : taskView === "completed" ? taskHistory.filter((task) => task.completed === true)
          : taskHistory;
  const displayed = parentTasks(uniqueTasks(displayedCandidates));
  const selectedIds = new Set((currentPlan?.items ?? []).filter((item) => item.disposition === "selected" && item.task_id).map((item) => String(item.task_id)));
  const groups = new Map<string, typeof carryOver>();
  for (const item of carryOver) {
    const key = item.attribution.date ?? "Older";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const previousDays = new Set(carryOver.map((item) => item.attribution.date).filter(Boolean)).size;
  const provenance = !shownPlan?.freeform_intent ? "No focus note yet" : shownPlan.goal_provenance === "accepted_suggestion" ? "Accepted from your tasks" : "Written by you";
  return <main className="page tasks-workspace">
    <div className="tasks-heading"><PageIntro eyebrow="Nifty workspace" title={historical ? "Workday history" : "Today’s tasks"} body="Plan and complete Nifty work without losing the history behind it." /><div className="date-navigator"><button aria-label="Previous day" onClick={() => void onDate(moveDate(selectedDate, -1))}><ChevronLeft size={16} /></button><label className="formatted-date-picker"><span>{formatWorkOsDate(selectedDate)}</span><input aria-label="Workspace date" type="date" max={currentDate} value={selectedDate} onChange={(event) => void onDate(event.target.value)} /></label><button aria-label="Next day" disabled={selectedDate >= currentDate} onClick={() => void onDate(moveDate(selectedDate, 1))}><ChevronRight size={16} /></button></div></div>
    <section className="panel daily-goal-card"><div className="goal-card-head"><div><span>Focus note for {historical ? formatWorkOsDate(selectedDate) : "today"}</span><small>{provenance}</small></div>{!historical && <span className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "offline" ? "Offline" : saveState === "conflict" ? "Conflict" : "Saved"}</span>}</div>{historical ? <p>{shownPlan?.freeform_intent || "No focus note was recorded."}</p> : <><textarea maxLength={4000} value={goal} onChange={(event) => onGoal(event.target.value)} placeholder="Optional: add context that is not obvious from your tasks" />{!goal && suggestion && <div className="goal-suggestion"><Sparkles size={16} /><div><strong>Suggested focus from your tasks</strong><p>{suggestion.text}</p></div><button onClick={onAcceptSuggestion}>Use suggestion</button></div>}<small className="goal-independence">Tasks establish intent. This optional note adds context and does not affect attendance.</small></>}</section>
    {!historical && carryOver.length > 0 && <button className="carry-alert" onClick={() => onCarryOverOpen(true)}><AlertTriangle size={17} /><span><strong>{carryOver.length} unfinished task{carryOver.length === 1 ? "" : "s"} carried over from {previousDays} previous workday{previousDays === 1 ? "" : "s"}.</strong><small>{carryOver.slice(0, 3).map((item) => item.task.title).join(" · ")}</small></span><em>Review unfinished work</em><ChevronRight size={16} /></button>}
    {!historical && <div className="task-view-tabs" role="tablist">{(["today", "unfinished", "completed", "all"] as TaskView[]).map((item) => <button role="tab" aria-selected={taskView === item} className={taskView === item ? "active" : ""} key={item} onClick={() => onTaskView(item)}>{sentence(item === "all" ? "all tasks" : item)}</button>)}</div>}
    <section className="panel"><div className="card-title"><span><ListChecks size={17} /> {historical ? formatWorkOsDate(selectedDate) : sentence(taskView)}</span>{!historical && <button className="primary" onClick={onAddTask}><Plus size={15} /> Add task</button>}</div><div className="evidence-list task-records">{displayed.length ? displayed.map((task) => {
      const attribution = taskDateAttribution(task, currentDate);
      const taskId = String(task.provider_task_id || task.id);
      const menuOpen = taskMenuId === taskId;
      const progress = subtaskProgress(task);
      const isSelected = selectedIds.has(String(task.id)) || selectedIds.has(String(task.provider_task_id));
      const state = taskState(task, currentDate);
      return <article className="task-record workspace-task" role="button" tabIndex={0} key={task.id} onClick={() => onOpenTask(task, historical)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task, historical); } }}><span className={`task-state ${state}`}>{sentence(state)}</span><div><h3>{task.title}</h3><p>{task.description || "No description"}</p><AssigneeTags task={task} /><small>{task.project?.name || "Nifty"}{task.milestone?.name ? ` · ${task.milestone.name}` : ""}{task.priority ? ` · ${sentence(String(task.priority))} priority` : ""}{task.due_date ? ` · due ${formatWorkOsDate(task.due_date)}` : ""}{task.provider_created_at ? ` · created ${formatWorkOsDate(task.provider_created_at)}` : ""}{task.parent_provider_task_id ? " · subtask" : ""}{task.synced_at ? " · Nifty synced" : " · Nifty sync pending"}</small></div>{progress.total > 0 && <CompletionRing compact completed={progress.completed} total={progress.total} label="subtasks" />}{!historical && <div className="workspace-task-menu" onClick={(event) => event.stopPropagation()}><button className="ellipsis-button" aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onClick={() => setTaskMenuId(menuOpen ? null : taskId)}><MoreHorizontal size={17} /></button>{menuOpen && <div className="subtask-menu" role="menu">{!task.completed && !isSelected && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task); }}><Plus size={14} /> Add to today</button>}{!task.completed && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task, "deferred"); }}><CirclePause size={14} /> Defer</button>}<button role="menuitem" onClick={() => { setTaskMenuId(null); onTaskCompletion(task, !task.completed); }}>{task.completed ? <RotateCcw size={14} /> : <Check size={14} />} {task.completed ? "Reopen task" : "Mark task done"}</button><button role="menuitem" onClick={() => { setTaskMenuId(null); onEditTask(task); }}><Pencil size={14} /> Edit</button><button role="menuitem" onClick={() => { setTaskMenuId(null); onArchiveTask(task); }}><Archive size={14} /> Archive <small>reversible</small></button><button className="danger" role="menuitem" onClick={() => { setTaskMenuId(null); onDeleteTask(task); }}><Trash2 size={14} /> Delete permanently</button>{attribution.date && attribution.date < currentDate && <button role="menuitem" onClick={() => { setTaskMenuId(null); void onDate(attribution.date!); }}><ChevronLeft size={14} /> Open original day</button>}</div>}</div>}<ChevronRight size={17} /></article>;
    }) : <Empty title={historical ? "No tasks surfaced" : "No tasks in this view"} body={historical ? "This day has no recorded Nifty task workspace." : "Refresh to load the provider-backed task record."} />}</div>{!historical && hasMore && <button disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Loading…" : "Load more"}</button>}</section>
    {carryOverOpen && <div className="carry-flyout-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onCarryOverOpen(false); }}><aside className="carry-flyout" aria-label="Unfinished work" role="dialog" aria-modal="true"><header><div><span>Unfinished work</span><h2>Review before carrying forward.</h2></div><button aria-label="Close unfinished work" onClick={() => onCarryOverOpen(false)}><X size={18} /></button></header><div>{[...groups.entries()].map(([date, items]) => <section key={date}><h3>{date === moveDate(currentDate, -1) ? `Yesterday · ${formatWorkOsDate(date)}` : formatWorkOsDate(date)}</h3>{items.map(({ task, attribution }) => <article key={task.id}><div><strong>{task.title}</strong><small>{attribution.reason === "due" ? "Due on that day" : attribution.reason === "created" ? "Created on that day" : "Previously surfaced"}</small></div><div><button disabled={busy} onClick={() => onSurfaceTask(task)}>Add to today</button><button disabled={busy} onClick={() => onSurfaceTask(task, "deferred")}>Defer</button><button disabled={busy} onClick={() => onTaskCompletion(task, true)}>Complete</button><button onClick={() => void onDate(attribution.date!)}>Open day</button></div></article>)}</section>)}</div></aside></div>}
  </main>;
}

const durationLabel = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;

function PersonalInsights({ data, loading, range, onRange, onReference, onCorrect }: { data: InsightsData | null; loading: boolean; range: "day" | "7d" | "30d"; onRange: (value: "day" | "7d" | "30d") => void; onReference: (reference: InsightDay["references"][number]) => void; onCorrect: (quality: NonNullable<InsightDay["sessionQuality"]>, date: string) => void }) {
  const notifications = useNotifications();
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
    {loading && !data ? <section className="panel"><Empty title="Building your work record" body="Loading daily goals, sessions, task outcomes, updates, and evidence." /></section> : data ? <>
      <div className="metric-grid"><Metric icon={Clock3} label="Observed work time" value={durationLabel(data.totals.observedSeconds)} /><article className="metric"><ListChecks size={18} /><small>Daily tasks</small><CompletionRing compact completed={data.totals.plannedCompleted} total={data.totals.planned} label="complete" /></article><Metric icon={FileCheck2} label="Nifty outcomes" value={String(data.totals.tasksCompleted)} /><Metric icon={Fingerprint} label="Output evidence" value={String(data.totals.outputEvidence)} /></div>
      <section className="panel insight-brief"><header><div><span>{data.brief.generated ? "Agent brief" : "Deterministic brief"}</span><h3>{data.brief.summary}</h3></div><small>{formatWorkOsDate(data.from)} → {formatWorkOsDate(data.through)}</small></header><div><section><strong>Wins</strong>{data.brief.wins.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Needs attention</strong>{data.brief.attention.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Next focus</strong>{data.brief.nextFocus.map((item) => <p key={item}>{item}</p>)}</section></div></section>
      <section className="panel trend-panel"><div className="card-title"><span><Gauge size={17} /> Workday trend</span><small>Observed time and task completion · separate scales</small></div><div className="trend-plot"><div className="trend-axis" aria-hidden="true"><span>8h</span><span>4h</span><span>0h</span></div><div className="trend-chart" role="img" aria-label="Observed work time and daily task completion by day"><div className="trend-grid" aria-hidden="true"><i /><i /><i /></div>{data.days.map((day) => { const observedHeight = Math.min(100, day.observedSeconds / (8 * 3600) * 100); const completionHeight = day.planned ? day.plannedCompleted / day.planned * 100 : 0; return <div className="trend-day" key={day.date}><div className="trend-bars"><i title={`${durationLabel(day.observedSeconds)} observed`} style={{ height: `${observedHeight}%` }}><span>{durationLabel(day.observedSeconds)}</span></i><b title={`${day.plannedCompleted} of ${day.planned} daily tasks`} style={{ height: `${completionHeight}%` }}><span>{day.planned ? `${Math.round(completionHeight)}%` : "—"}</span></b></div><span>{formatWorkOsDate(day.date)}</span></div>; })}</div></div><div className="trend-legend"><span><i /> Observed session time <small>8-hour scale</small></span><span><b /> Daily task completion <small>0–100%</small></span></div>
         <div className="insight-table-wrap"><table><caption>Exact personal insight values</caption><thead><tr><th>Date</th><th>Observed</th><th>Paused</th><th>Daily tasks</th><th>Tasks done</th><th>Updates</th><th>Output evidence</th><th>Session quality</th></tr></thead><tbody>{data.days.map((day) => <tr key={day.date}><td>{formatWorkOsDate(day.date)}</td><td>{durationLabel(day.observedSeconds)}</td><td>{durationLabel(day.pausedSeconds)}</td><td>{day.plannedCompleted}/{day.planned}</td><td>{day.tasksCompleted}</td><td>{day.updates}</td><td>{day.outputEvidence}</td><td>{day.sessionQuality?.status === "needs_correction" ? <button onClick={() => onCorrect(day.sessionQuality!, day.date)}>Needs correction</button> : sentence(day.sessionQuality?.status ?? "none")}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel insight-drilldown"><div className="card-title"><span><Inbox size={17} /> Latest-day record</span><small>{formatWorkOsDate(latest?.date)}</small></div>{latest?.references.length ? <div>{latest.references.map((reference) => <button key={`${reference.type}:${reference.id}`} onClick={() => onReference(reference)}><span>{reference.type === "plan" ? "Daily workspace" : sentence(reference.type)}</span><strong>{reference.label}</strong><ChevronRight size={15} /></button>)}</div> : <Empty title="No linked records" body="This day has no daily goal, task completion, substantive update, or evidence record yet." />}<footer>Nifty synced {data.freshness.niftySyncedAt ? formatWorkOsDateTime(data.freshness.niftySyncedAt) : "unavailable"} · Worktivity observed {data.freshness.worktivityObservedAt ? formatWorkOsDateTime(data.freshness.worktivityObservedAt) : "unavailable"}</footer></section>
      <p className="insight-disclaimer">These are descriptive personal signals, not a performance score. Idle activity is never labeled productivity, and activity context never proves task completion.</p>
    </> : <section className="panel"><Empty title="Insights unavailable" body="Refresh to retry the personal insights record." /></section>}
  </main>;
}
function Setting({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <div className="setting"><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>; }
