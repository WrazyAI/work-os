import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Activity, AlertTriangle, BriefcaseBusiness, Bug, Check, ChevronLeft, ChevronRight, CirclePause, CirclePlay, Clock3, FileCheck2, Fingerprint, Gauge, Inbox, LayoutDashboard, ListChecks, LogIn, LogOut, MessageSquareText, MoreHorizontal, MoveRight, Pause, PlugZap, Plus, RefreshCw, RotateCcw, Send, Settings, ShieldCheck, Sparkles, Trash2, UserRound, X } from "lucide-react";
import { apiRequest, flushQueue, sendOrQueue } from "./api";
import { beginAuthentication, errorMessage, listenForAuthentication } from "./auth";
import { diagnostics, exportDiagnostics, openDebuggerWindow, openLogsDir } from "./diagnostics";
import Onboarding from "./Onboarding";
import { applyDayScenario, applyOnboardingScenario, DEFAULT_DEBUG_SCENARIO } from "./scenarios";
import { schedulePrompt } from "./scheduler";
import { sessionGate } from "./sessionGate";
import { shiftPulse } from "./shiftPulse";
import { subtaskProgress, suggestDailyGoal, taskDateAttribution, tasksForDate, unfinishedBefore, uniqueTasks, type TaskRow } from "./taskWorkspace";
import type { DailyPlan, DailyPlanItem, DayData, DebugScenario, DesktopSession, InsightsData, OnboardingData } from "./types";
import { secureState } from "./vault";
import companionArt from "./assets/work-os-companion.png";
import wordmark from "./assets/work-os-mark.png";
import "./plan-insights.css";

type AssetSource = string | { src: string };
const assetUrl = (asset: AssetSource) => typeof asset === "string" ? asset : asset.src;

type View = "day" | "tasks" | "review" | "insights" | "evidence" | "settings";
type TaskView = "today" | "unfinished" | "completed" | "all";
type TaskAssigneeOption = { id: string; displayName: string; email: string | null };
type TaskDetails = { task: Record<string, any>; subtasks: Array<Record<string, any>>; moveTargets: Array<Record<string, any>> };
type TaskDeletionRequest = { task: Record<string, any>; closeParent: boolean };
const views: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: "day", label: "My day", icon: LayoutDashboard }, { id: "tasks", label: "Tasks", icon: ListChecks },
  { id: "review", label: "Review", icon: MessageSquareText }, { id: "insights", label: "Insights", icon: Gauge },
  { id: "evidence", label: "Evidence", icon: ShieldCheck }, { id: "settings", label: "Settings", icon: Settings },
];

const formatTime = (value?: string | null, zone?: string) => value ? new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "—";
const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());
const initials = (value?: string | null) => (value ?? "Work OS").trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "WO";

export default function App() {
  const [session, setSession] = useState<DesktopSession | null>(null);
  const [day, setDay] = useState<DayData | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingData | null>(null);
  const [view, setView] = useState<View>("day");
  const [input, setInput] = useState("");
  const [updateKind, setUpdateKind] = useState("material_progress");
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
  const [apiBase, setApiBase] = useState("");
  const [autoStart, setAutoStart] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectHint, setConnectHint] = useState("");
  const [debugError, setDebugError] = useState<React.ReactNode>(null);
  const [taskHistory, setTaskHistory] = useState<Array<Record<string, any>>>([]);
  const [taskHistoryOffset, setTaskHistoryOffset] = useState<number | null>(null);
  const [taskHistoryLoading, setTaskHistoryLoading] = useState(false);
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [taskComposerTitle, setTaskComposerTitle] = useState("");
  const [taskComposerDescription, setTaskComposerDescription] = useState("");
  const [taskComposerAssignees, setTaskComposerAssignees] = useState<string[]>([]);
  const [taskAssigneeOptions, setTaskAssigneeOptions] = useState<TaskAssigneeOption[]>([]);
  const [taskOptionsLoading, setTaskOptionsLoading] = useState(false);
  const [taskComposerStatus, setTaskComposerStatus] = useState("");
  const [taskDetails, setTaskDetails] = useState<TaskDetails | null>(null);
  const [taskDetailsReadOnly, setTaskDetailsReadOnly] = useState(false);
  const [taskDetailsLoading, setTaskDetailsLoading] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [subtaskDescription, setSubtaskDescription] = useState("");
  const [subtaskMenuId, setSubtaskMenuId] = useState<string | null>(null);
  const [moveMenuId, setMoveMenuId] = useState<string | null>(null);
  const [deleteRequest, setDeleteRequest] = useState<TaskDeletionRequest | null>(null);
  const [debugScenario, setDebugScenario] = useState<DebugScenario>(DEFAULT_DEBUG_SCENARIO);
  const [pulseNow, setPulseNow] = useState(() => new Date());
  const debugRef = useRef(debugScenario);
  const planEditVersion = useRef(0);

  const refresh = useCallback(async () => {
    const [onboardingResult, dayResult] = await Promise.allSettled([
      apiRequest<OnboardingData>("/api/work-os/me/onboarding"),
      apiRequest<DayData>("/api/work-os/me/day"),
    ]);
    if (onboardingResult.status === "rejected") throw onboardingResult.reason;
    setOnboarding(onboardingResult.value);
    if (dayResult.status === "rejected") {
      const message = errorMessage(dayResult.reason, "Your profile loaded, but the workday could not be refreshed.");
      diagnostics.warn("bootstrap.day.degraded", message);
      setError(message);
      return null;
    }
    const nextDay = dayResult.value;
    setError(""); setDay(nextDay); setReport(nextDay.report?.markdown ?? "");
    setTaskHistory(nextDay.taskHistory ?? []); setTaskHistoryOffset(nextDay.taskHistory?.length === 100 ? 100 : null);
    setPlanIntent(nextDay.plan?.freeform_intent ?? "");
    setGoalProvenance(nextDay.plan?.goal_provenance === "accepted_suggestion" ? "accepted_suggestion" : nextDay.plan?.freeform_intent ? "employee" : null);
    setSuggestionTaskIds(nextDay.plan?.suggestion_task_ids ?? []);
    setPlanItems([...(nextDay.plan?.items ?? [])].sort((a, b) => a.rank - b.rank));
    setPlanDirty(false); setPlanSaveState("saved"); setPlanHistoryDate((current) => current || nextDay.shiftDate);
    await schedulePrompt(nextDay, () => apiRequest<DayData>("/api/work-os/me/day"));
    return nextDay;
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void Promise.all([secureState.session(), secureState.queue(), secureState.settings(), isTauri() ? isEnabled() : Promise.resolve(false)]).then(([saved, queue, settings, enabled]) => {
      const current = saved?.apiBase ? saved : null; setSession(current); setQueueCount(queue.length); setApiBase(settings.apiBase); setAutoStart(enabled);
      if (current) void refresh().catch((value) => setError(errorMessage(value, "Could not load your workday.")));
    }).catch((value) => setError(errorMessage(value, "Could not open the local vault.")));
    void listenForAuthentication((saved) => { setSession(saved); setConnectHint(""); void refresh(); }, (value) => setError(errorMessage(value, "Desktop authorization failed."))).then((fn) => { cleanup = fn; }).catch((value) => setError(errorMessage(value, "Could not listen for desktop sign-in.")));
    return () => cleanup?.();
  }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const recover = async () => { if (!navigator.onLine) return; const result = await flushQueue(); setQueueCount(result.remaining); await refresh(); };
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
          return;
        }
        setDay((current) => current ? { ...current, plan: response } : current);
        if (planEditVersion.current === version) {
          setPlanItems([...response.items].sort((a, b) => a.rank - b.rank));
          setPlanDirty(false);
          setPlanSaveState("saved");
        }
      }).catch((value) => {
        const message = errorMessage(value, "Your daily goal could not be saved.");
        setPlanSaveState(/changed on another device/i.test(message) ? "conflict" : "offline");
        setError(message);
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [day?.plan?.id, day?.plan?.revision, day?.plan?.status, day?.shiftDate, goalProvenance, planDirty, planIntent, suggestionTaskIds]);

  useEffect(() => {
    if (view !== "insights" || !session || debugRef.current.enabled) return;
    let cancelled = false;
    setInsightsLoading(true);
    void apiRequest<InsightsData>(`/api/work-os/me/insights?range=${insightRange}${day?.shiftDate ? `&through=${encodeURIComponent(day.shiftDate)}` : ""}`)
      .then((result) => { if (!cancelled) setInsights(result); })
      .catch((value) => { if (!cancelled) setError(errorMessage(value, "Insights could not be refreshed.")); })
      .finally(() => { if (!cancelled) setInsightsLoading(false); });
    return () => { cancelled = true; };
  }, [view, insightRange, session, day?.shiftDate]);

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
  });

  async function act(label: string, action: () => Promise<unknown>) {
    setBusy(true); setError("");
    diagnostics.info("ui.action.requested", label, { activeView: view });
    try {
      if (debugRef.current.enabled) throw new Error("Scenario mode is active. Reset the debugger scenario before submitting real changes.");
      await action(); setQueueCount((await secureState.queue()).length); await refresh();
      diagnostics.info("ui.action.completed", label, { activeView: view });
    }
    catch (value) {
      const message = value instanceof Error ? value.message : "Action failed";
      diagnostics.error("ui.action.failed", message, { action: label, activeView: view });
      setError(message);
    }
    finally { setBusy(false); }
  }
  function setScenario(next: DebugScenario) { debugRef.current = next; setDebugScenario(next); void emit("work-os://debug-current", next); }

  async function openDebugger() {
    try {
      await openDebuggerWindow();
      setDebugError(null);
      diagnostics.info("debug.window.open", "Opened Work OS Debugger");
    } catch (value) {
      diagnostics.error("debug.window.open_failed", value instanceof Error ? value.message : "open failed");
      setDebugError(<DebugFailedNotice onDismiss={() => setDebugError(null)} />);
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
      setSession(null); setDay(null); setOnboarding(null); setQueueCount(0); setView("day");
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
    } catch (value) {
      setError(value instanceof Error ? value.message : "Onboarding could not be reset.");
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
  const openTasks = visibleDay?.tasks.filter((task) => !task.completed) ?? [];
  const completedTodayTasks = visibleDay?.tasks.filter((task) => task.completed).length ?? 0;
  const totalTodayTasks = visibleDay?.tasks.length ?? 0;
  const selectedItems = planItems.filter((item) => item.disposition === "selected");
  const goalSuggestion = useMemo(() => suggestDailyGoal(visibleDay?.tasks ?? [], visibleDay?.shiftDate ?? "", planItems), [visibleDay?.tasks, visibleDay?.shiftDate, planItems]);
  const unfinishedCarryOver = useMemo(() => unfinishedBefore(taskHistory, visibleDay?.shiftDate ?? ""), [taskHistory, visibleDay?.shiftDate]);
  const pulse = shiftPulse(workSession, visibleDay?.shift ?? null, pulseNow);

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
        apiRequest<{ tasks: Array<Record<string, any>> }>(`/api/work-os/me/tasks?view=today&date=${encodeURIComponent(date)}&includeCompleted=true&limit=100`),
      ]);
      setHistoricalPlan(planResult.plan);
      setHistoricalTasks(taskResult.tasks);
    } catch (value) {
      setError(errorMessage(value, "Daily workspace history could not be loaded."));
    }
  }

  async function loadMoreTasks() {
    if (taskHistoryOffset === null || !visibleDay || taskHistoryLoading) return;
    setTaskHistoryLoading(true);
    try {
      const result = await apiRequest<{ tasks: Array<Record<string, any>>; nextOffset: number | null }>(`/api/work-os/me/tasks?view=history&date=${encodeURIComponent(visibleDay.shiftDate)}&offset=${taskHistoryOffset}&limit=100`);
      setTaskHistory((current) => [...current, ...result.tasks.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setTaskHistoryOffset(result.nextOffset);
    } finally { setTaskHistoryLoading(false); }
  }

  async function openTaskComposer() {
    setTaskComposerTitle(""); setTaskComposerDescription("");
    setTaskComposerAssignees(visibleDay?.access?.personId ? [visibleDay.access.personId] : []);
    setTaskComposerStatus(""); setTaskComposerOpen(true);
    if (taskAssigneeOptions.length || taskOptionsLoading) return;
    setTaskOptionsLoading(true);
    try {
      const result = await apiRequest<{ people: TaskAssigneeOption[] }>("/api/work-os/me/tasks?view=options");
      setTaskAssigneeOptions(result.people);
    } catch (value) {
      setError(errorMessage(value, "Could not load organization assignees."));
    } finally { setTaskOptionsLoading(false); }
  }

  async function loadTaskDetails(taskId: string) {
    return apiRequest<TaskDetails>(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`);
  }

  async function openTaskDetails(task: Record<string, any>, readOnly = false) {
    const taskId = String(task.provider_task_id || task.id);
    setTaskDetailsReadOnly(readOnly); setTaskDetailsLoading(true); setTaskDetails({ task, subtasks: [], moveTargets: [] }); setSubtaskTitle(""); setSubtaskDescription(""); setSubtaskMenuId(null); setMoveMenuId(null);
    try { setTaskDetails(await loadTaskDetails(taskId)); }
    catch (value) { setTaskDetails(null); setError(errorMessage(value, "Could not open this task.")); }
    finally { setTaskDetailsLoading(false); }
  }

  function submitTaskFromDesktop() {
    if (!taskComposerTitle.trim()) return;
    void act("task.create", async () => {
      const result = await apiRequest<{ task: Record<string, any>; providerStatus: string; mirrorStatus: string }>("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: taskComposerTitle.trim(), description: taskComposerDescription.trim() || undefined, assignee_person_ids: taskComposerAssignees }) });
      setTaskComposerTitle(""); setTaskComposerDescription(""); setTaskComposerAssignees([]);
      setTaskComposerStatus(`${result.providerStatus === "nifty_confirmed" ? "Nifty confirmed" : "Submitted"} · ${result.mirrorStatus}`);
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
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ completed }) });
      if (refreshDetails && taskDetails) {
        const parentId = String(taskDetails.task.provider_task_id || taskDetails.task.id);
        setTaskDetails(await loadTaskDetails(parentId));
      }
    });
  }

  function editTask(task: TaskRow) {
    const title = window.prompt("Task title", String(task.title ?? ""));
    if (!title?.trim()) return;
    const description = window.prompt("Task description", String(task.description ?? ""));
    if (description === null) return;
    const taskId = String(task.provider_task_id || task.id);
    void act("task.update", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ name: title.trim(), description }) });
      setTaskDetails(await loadTaskDetails(taskId));
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

  function requestTaskRemoval(task: Record<string, any>, closeParent = false) {
    setSubtaskMenuId(null); setMoveMenuId(null); setDeleteRequest({ task, closeParent });
  }

  function confirmTaskRemoval() {
    if (!deleteRequest) return;
    const { task, closeParent } = deleteRequest;
    const taskId = String(task.provider_task_id || task.id);
    void act("task.archive", async () => {
      await apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "DELETE" });
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
    setConnecting(true); setError(""); setConnectHint("");
    try {
      await beginAuthentication(apiBase);
      setConnectHint("Browser opened. Sign in to WrazyOS if asked, then authorize this device.");
    } catch (value) {
      setError(errorMessage(value, "Could not open workspace sign-in."));
    } finally {
      setConnecting(false);
    }
  }

  function clockIn() {
    void act("shift.clock_in", () => sendOrQueue("/api/work-os/me/workday", "POST", { source: "desktop", late_acknowledged: true, unscheduled_acknowledged: true }));
  }

  function requireActive(label: string, action: () => Promise<unknown>) {
    if (!active) {
      diagnostics.warn("ui.action.blocked", gate.message, { action: label, activeView: view });
      setError(gate.message);
      return;
    }
    void act(label, action);
  }

  if (!visibleSession) return <ConnectScreen apiBase={apiBase} setApiBase={setApiBase} error={error} hint={connectHint} connecting={connecting} debugError={debugError} onDebug={() => void openDebugger()} onConnect={() => void connectWorkspace()} onSave={async () => secureState.saveSettings({ apiBase })} />;
  if (!visibleOnboarding) return <LoadingScreen error={error} retry={() => void refresh()} />;
  if (visibleOnboarding.onboardingRequired) return <Onboarding data={visibleOnboarding} simulated={debugScenario.enabled} busy={busy} appError={error} onOpenDebug={() => void openDebugger()} onLogout={() => void logout()} onComplete={() => void refresh()} onSaveDraft={async (body) => { if (debugScenario.enabled) return visibleOnboarding; const next = await sendOrQueue("/api/work-os/me/onboarding", "PUT", body); if ((next as { queued?: boolean }).queued) { setQueueCount((await secureState.queue()).length); return { queued: true }; } const onboarding = next as OnboardingData; setOnboarding(onboarding); return onboarding; }} onSubmit={async (body) => { if (debugScenario.enabled) { setScenario({ ...debugScenario, onboardingState: "complete", missingDetails: [] }); return visibleDay?.attendance; } const next = await apiRequest<OnboardingData>("/api/work-os/me/onboarding", { method: "POST", headers: { "Idempotency-Key": String(body.clientMutationKey ?? "") }, body: JSON.stringify(body) }); setOnboarding(next); const result = await apiRequest<{ attendance?: DayData["attendance"] }>("/api/work-os/me/workday"); return result.attendance; }} />;

  return <div className="workspace">
    <aside className="rail">
      <div className="wordmark"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div>
      <nav>{views.map(({ id, label, icon: Icon }) => <button key={id} className={view === id ? "active" : ""} onClick={() => setView(id)}><Icon size={18} /><span>{label}</span>{id === "review" && !!visibleDay?.proposals.length && <em>{visibleDay.proposals.length}</em>}</button>)}</nav>
      <div className="rail-foot"><span className={`presence ${active && !paused ? "live" : ""}`} /> <div><strong>{active ? paused ? "Paused" : "On shift" : "Off shift"}</strong><small>{queueCount ? `${queueCount} queued` : navigator.onLine ? "Synced" : "Offline"}</small></div></div>
    </aside>
    <section className="stage">
      <header className="masthead"><div><p>{visibleDay?.shiftDate}</p><h1>{views.find((item) => item.id === view)?.label}</h1></div><div className="mast-actions"><span className="provider" title={visibleDay?.niftySync?.error || `Last synced ${visibleDay?.niftySync?.syncedAt ? formatTime(visibleDay.niftySync.syncedAt, visibleDay.shift?.timezone) : "never"}`}><PlugZap size={14} /> Nifty {visibleDay?.niftySync?.fresh ? `live · ${openTasks.length} open` : visibleDay?.niftySync?.syncing ? "refreshing" : "delayed"}</span><button className="icon" title="Refresh providers and workday" onClick={() => void refresh()}><RefreshCw size={17} /></button><button className="avatar" aria-label={`Profile for ${visibleOnboarding.profile.displayName}`}>{initials(visibleOnboarding.profile.displayName)}</button></div></header>
      {error && <div className="notice error" role="alert"><AlertTriangle size={16} />{error}<button onClick={() => setError("")}><X size={14} /></button></div>}
      {debugError}
      {debugScenario.enabled && <div className="notice debug"><Bug size={15} /> Scenario mode is active. Writes are disabled.<button onClick={() => setScenario(DEFAULT_DEBUG_SCENARIO)}>Reset</button></div>}
      {!active && <div className="notice session-gate" role="status"><Clock3 size={15} /><span>{gate.message}</span>{gate.canClockIn && <button className="primary" disabled={busy} onClick={clockIn}><CirclePlay size={15} /> Clock in</button>}</div>}
      {view === "day" && <main className="day-grid">
        <section className="hero-card">
          <div className="hero-copy"><span className="kicker">{active ? `${sentence(workSession!.state)} · ${formatTime(workSession?.clocked_in_at, visibleDay?.shift?.timezone)}` : "Ready when you are"}</span><h2>{active ? paused ? "Take the pause." : "Make today count." : "Your workday, in focus."}</h2><p>{active ? visibleDay?.prompt.reason : visibleDay?.shift ? `Scheduled ${formatTime(visibleDay.shift.startsAt, visibleDay.shift.timezone)}–${formatTime(visibleDay.shift.endsAt, visibleDay.shift.timezone)}. Clock in when you begin.` : "No scheduled shift is active. An explicit clock-in starts an exception session without an inferred EOD time."}</p>
            <div className="hero-actions">{!active ? <button className="primary" disabled={busy || !gate.canClockIn} onClick={clockIn}><CirclePlay size={17} /> Clock in</button> : <>{!visibleDay?.breakPolicy?.worktivityAuthoritative && <button className="primary" disabled={busy} onClick={() => void act("shift.pause_toggle", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: paused ? "resume" : "pause" }))}>{paused ? <CirclePlay size={17} /> : <CirclePause size={17} />}{paused ? "Resume" : "Pause"}</button>}<button disabled={busy} onClick={() => window.confirm("Clock out and close today’s workspace?") && void act("shift.clock_out", () => sendOrQueue("/api/work-os/me/workday", "PATCH", { action: "clock_out", extended_acknowledged: true }))}>Clock out</button></>}</div>
            {visibleDay?.attendance && <small className="attendance-context">Observed context: {visibleDay.attendance.message}</small>}
          </div><img className="companion" src={assetUrl(companionArt)} alt="Abstract Work OS companion" />
        </section>
        <section className="pulse-card"><div className="card-title"><span><Activity size={17} /> Shift pulse</span><small>{active ? "Live · elapsed" : visibleDay?.attendance?.state === "active" ? "Worktivity online" : "Waiting"}</small></div><div className="pulse-time">{pulse.elapsedLabel}</div><div className="meter"><i style={{ width: `${pulse.progressPercent}%` }} /></div><div className="stat-row"><span><small>Next check-in</small><strong>{formatTime(visibleDay?.prompt.nextPromptAt, visibleDay?.shift?.timezone)}</strong></span><span><small>Open Nifty tasks</small><strong>{openTasks.length}</strong></span><span><small>Reviews</small><strong>{visibleDay?.proposals.length ?? 0}</strong></span></div></section>
        <section className="capture-card"><div className="card-title"><span><Sparkles size={17} /> {visibleDay?.prompt.kind === "eod" ? "Close the loop" : "Update your companion"}</span><small>{visibleDay?.prompt.required ? "Due now" : "Natural language"}</small></div><textarea value={input} onChange={(event) => setInput(event.target.value)} placeholder="What changed? Mention progress, blockers, priorities, or work you completed…" /><div className="capture-actions"><select value={updateKind} onChange={(event) => setUpdateKind(event.target.value)}><option value="starting">Starting</option><option value="continuing">Continuing</option><option value="material_progress">Material progress</option><option value="completion_claim">Completion claim</option><option value="blocked">Blocked</option><option value="priority_change">Priority changed</option><option value="unplanned_work">Unplanned work</option></select><button className="primary" disabled={!input.trim() || busy} onClick={() => requireActive("check_in.create", async () => { await sendOrQueue("/api/work-os/check-ins", "POST", { source: "desktop", kind: visibleDay?.prompt.kind || "optional", update_kind: updateKind, input_text: input }); setInput(""); })}><Send size={16} /> Send update</button></div></section>
        <section className="focus-card today-card"><div className="card-title"><span><BriefcaseBusiness size={17} /> Today</span><button onClick={() => setView("tasks")}>Open Tasks <ChevronRight size={14} /></button></div><div className="today-goal"><small>Goal</small><strong>{planIntent || goalSuggestion?.text || "No goal yet."}</strong><span>{planIntent ? goalProvenance === "accepted_suggestion" ? "Accepted from your tasks" : "Written by you" : goalSuggestion ? "Suggested from your tasks" : "Add a goal in Tasks"}</span></div><div className="today-progress"><CompletionRing completed={completedTodayTasks} total={totalTodayTasks} label="tasks complete" />{unfinishedCarryOver.length > 0 && <span>{unfinishedCarryOver.length} overdue task{unfinishedCarryOver.length === 1 ? "" : "s"}</span>}</div>{selectedItems.length ? selectedItems.slice(0, 3).map((item, index) => <div className="focus-row" key={item.id}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{item.title_snapshot}</strong><small>{sentence(item.source)}{item.blocker ? ` · Blocked: ${item.blocker}` : ""}</small></div><span>{item.completion_state}</span></div>) : openTasks.slice(0, 3).map((task, index) => <div className="focus-row" key={task.id}><b>{String(index + 1).padStart(2, "0")}</b><div><strong>{task.title}</strong><small>Nifty task · {task.due_date ? `due ${task.due_date}` : "open"}</small></div><span>open</span></div>)}</section>
      </main>}
      {view === "tasks" && <TasksWorkspace currentDate={visibleDay?.shiftDate ?? ""} historyDate={planHistoryDate} currentPlan={visibleDay?.plan ?? null} historicalPlan={historicalPlan} historicalTasks={historicalTasks} goal={planIntent} goalProvenance={goalProvenance} suggestion={goalSuggestion} saveState={planSaveState} taskView={taskView} todayTasks={visibleDay?.tasks ?? []} taskHistory={taskHistory} carryOver={unfinishedCarryOver} carryOverOpen={carryOverOpen} loadingMore={taskHistoryLoading} hasMore={taskHistoryOffset !== null} busy={busy} taskStatus={taskComposerStatus} onTaskView={setTaskView} onDate={loadPlanHistory} onGoal={(value) => editPlan(() => { setPlanIntent(value); setGoalProvenance(value.trim() ? "employee" : null); setSuggestionTaskIds([]); })} onAcceptSuggestion={() => { if (!goalSuggestion) return; editPlan(() => { setPlanIntent(goalSuggestion.text); setGoalProvenance("accepted_suggestion"); setSuggestionTaskIds(goalSuggestion.taskIds); }); }} onAddTask={() => void openTaskComposer()} onOpenTask={(task, readOnly) => void openTaskDetails(task, readOnly)} onSurfaceTask={surfaceTask} onTaskCompletion={setTaskCompletion} onCarryOverOpen={setCarryOverOpen} onLoadMore={() => void loadMoreTasks()} />}
      {view === "review" && <main className="page"><PageIntro eyebrow="Human in the loop" title="Review before anything changes." body="Your words become structured proposals. Nothing writes back to Nifty without explicit approval." /><section className="proposal-grid">{visibleDay?.proposals.length ? visibleDay.proposals.map((proposal) => <article className="proposal-card" key={proposal.id}><span>{sentence(proposal.operation)}</span><h3>{proposal.proposed_change?.name || proposal.proposed_change?.title || proposal.proposed_change?.summary || proposal.input_text}</h3><p>Original statement preserved · {proposal.status}</p><div><button disabled={busy} onClick={() => void act("proposal.reject", () => sendOrQueue(`/api/work-os/proposals/${proposal.id}`, "PATCH", { decision: "reject" }))}>Reject</button><button className="primary" disabled={busy} onClick={() => void act("proposal.accept", () => sendOrQueue(`/api/work-os/proposals/${proposal.id}`, "PATCH", { decision: "accept" }))}><Check size={15} /> Approve</button></div></article>) : <Empty title="All clear" body="No AI proposals are waiting for your review." />}</section></main>}
      {view === "insights" && <PersonalInsights data={insights} loading={insightsLoading} range={insightRange} onRange={setInsightRange} onReference={(type) => setView(type === "plan" || type === "task" ? "tasks" : type === "evidence" ? "evidence" : "day")} />}
      {view === "evidence" && <main className="page"><PageIntro eyebrow="Provenance" title="Evidence with its labels intact." body="Claims, activity observations, and output artifacts are never collapsed into one misleading score." /><section className="evidence-list">{visibleDay?.evidence.length ? visibleDay.evidence.map((item) => <article key={item.id}><span className={`evidence-kind ${item.source === "worktivity" ? "activity" : "output"}`}>{item.source === "worktivity" ? "Activity context" : "Output evidence"}</span><div><h3>{item.title}</h3><p>{item.summary || "No summary available."}</p></div><time>{item.occurred_at ? formatTime(item.occurred_at, visibleDay.shift?.timezone) : "Today"}</time></article>) : <Empty title="No evidence yet" body="Verified provider events and purpose-limited activity context will appear here." />}</section></main>}
      {view === "settings" && <main className="page"><PageIntro eyebrow="Workspace control" title="Your companion, your boundaries." body="Manage launch behavior, local sync, privacy context, updates, and diagnostics." /><section className="settings-panel"><Setting title="Start with Windows" detail="Open quietly in the tray after sign-in"><input type="checkbox" checked={autoStart} onChange={async (event) => { event.target.checked ? await enable() : await disable(); setAutoStart(event.target.checked); }} /></Setting><Setting title="Offline queue" detail={queueCount ? `${queueCount} updates waiting to sync` : "Everything is synced"}><span className="status-dot">Ready</span></Setting><Setting title="Scenario debugger" detail="Opens a separate diagnostics window. Ctrl+Shift+D"><button onClick={() => void openDebugger()}><Bug size={15} /> Open</button></Setting><Setting title="Export diagnostics" detail="Redacted ZIP of recent events. Never includes tokens or queue bodies."><button onClick={async () => { const queue = await secureState.queue(); const path = await exportDiagnostics({ runtimeHealth: { online: navigator.onLine, queueCount }, queueSummary: { count: queue.length, paths: queue.map((item) => item.path), attempts: queue.map((item) => item.attempts) }, sanitizedConfig: { apiBase: visibleSession.apiBase, autoStart } }); setUpdateStatus(`Exported ${path}`); }}>Export</button></Setting><Setting title="Desktop updates" detail={updateStatus || "Stable channel"}><button onClick={async () => { setUpdateStatus("Checking…"); const saved = await secureState.session(); const updateOrigin = import.meta.env.VITE_WORK_OS_UPDATE_ORIGIN || "https://app.wrazyos.com"; if (!saved || new URL(saved.apiBase).origin !== new URL(updateOrigin).origin) return setUpdateStatus("Managed by your WrazyOS server"); const headers = { Authorization: `Bearer ${saved.token}`, "X-Work-OS-Organization-Id": saved.organizationId }; const update = await check({ headers }); if (!update) return setUpdateStatus("Up to date"); setUpdateStatus(`Installing ${update.version}`); await update.downloadAndInstall(undefined, { headers }); await relaunch(); }}>Check</button></Setting><Setting title="Restart onboarding" detail="Clear your personal setup answers and return to employee onboarding. Manager-owned setup and consent history stay intact."><button disabled={busy} onClick={() => void resetOnboarding()}><RotateCcw size={15} /> Reset</button></Setting><Setting title="Account session" detail={`Signed in through ${visibleSession.apiBase}`}><button className="danger" disabled={busy} onClick={() => void logout()}><LogOut size={15} /> Sign out</button></Setting></section></main>}
    </section>
    {taskComposerOpen && <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setTaskComposerOpen(false); }}><section className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title"><header><div><span>New task</span><h2 id="task-modal-title">What needs to get done?</h2></div><button aria-label="Close task composer" disabled={busy} onClick={() => setTaskComposerOpen(false)}><X size={18} /></button></header><div className="task-modal-body"><label><span>Task title</span><input autoFocus maxLength={240} value={taskComposerTitle} onChange={(event) => setTaskComposerTitle(event.target.value)} placeholder="Give the task a clear outcome" /></label><label><span>Description <em>optional</em></span><textarea maxLength={20000} value={taskComposerDescription} onChange={(event) => setTaskComposerDescription(event.target.value)} placeholder="Add context, expectations, links, or a definition of done…" /></label><fieldset><legend><UserRound size={14} /> Assignees <em>optional</em></legend>{taskOptionsLoading ? <p>Loading your organization…</p> : taskAssigneeOptions.length ? <div className="assignee-grid">{taskAssigneeOptions.map((person) => { const selected = taskComposerAssignees.includes(person.id); return <label className={selected ? "selected" : ""} key={person.id}><input type="checkbox" checked={selected} onChange={() => setTaskComposerAssignees((current) => selected ? current.filter((id) => id !== person.id) : [...current, person.id])} /><span><strong>{person.displayName}</strong><small>{person.email || "Nifty member"}</small></span><Check size={14} /></label>; })}</div> : <p>No assignable non-admin Nifty members were found. You can still create this task unassigned.</p>}</fieldset></div><footer><button disabled={busy} onClick={() => setTaskComposerOpen(false)}>Cancel</button><button className="primary" disabled={busy || !taskComposerTitle.trim()} onClick={submitTaskFromDesktop}>{busy ? "Creating…" : "Create task"}</button></footer></section></div>}
    {taskDetails && <div className="task-modal-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setTaskDetails(null); }}>
      <section className="task-modal task-detail-modal" role="dialog" aria-modal="true" aria-labelledby="task-detail-title">
        <header><div><span>{taskDetails.task.completed ? "Completed task" : "Active task"}</span><h2 id="task-detail-title">{taskDetails.task.title}</h2></div><button aria-label="Close task details" disabled={busy} onClick={() => setTaskDetails(null)}><X size={18} /></button></header>
        <div className="task-modal-body">{taskDetailsLoading ? <p className="task-loading">Loading task details…</p> : <>
          <section className="task-description"><span>Description</span><p>{taskDetails.task.description || "No description has been added."}</p><div><small>{taskDetails.task.project?.name || "Nifty"}</small>{taskDetails.task.due_date && <small>Due {taskDetails.task.due_date}</small>}<small>{taskDetails.task.completed ? "Complete" : "Open"}</small></div></section>
          <section className="subtask-section"><header><div><span>Subtasks</span><strong>{taskDetails.subtasks.length}</strong></div></header>
            <div className="subtask-list">{taskDetails.subtasks.length ? taskDetails.subtasks.map((subtask) => {
              const subtaskId = String(subtask.provider_task_id || subtask.id);
              const menuOpen = subtaskMenuId === subtaskId;
              return <article key={subtask.id}><div><strong>{subtask.title}</strong><p>{subtask.description || "No description"}</p></div><span>{subtask.completed ? "Complete" : "Open"}</span>{!taskDetailsReadOnly && <div className="subtask-actions"><button className="ellipsis-button" aria-label={`Actions for ${subtask.title}`} aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onClick={() => { setSubtaskMenuId(menuOpen ? null : subtaskId); setMoveMenuId(null); }}><MoreHorizontal size={17} /></button>{menuOpen && <div className="subtask-menu" role="menu"><button role="menuitem" onClick={() => { setSubtaskMenuId(null); setTaskCompletion(subtask, !subtask.completed, true); }}>{subtask.completed ? <RotateCcw size={14} /> : <Check size={14} />} {subtask.completed ? "Reopen subtask" : "Mark subtask done"}</button><button role="menuitem" onClick={() => setMoveMenuId(moveMenuId === subtaskId ? null : subtaskId)}><MoveRight size={14} /> Move to <ChevronRight size={13} /></button>{moveMenuId === subtaskId && <div className="move-target-menu" role="menu" aria-label="Move subtask to"><span>Move to task</span>{taskDetails.moveTargets.length ? taskDetails.moveTargets.map((target) => <button role="menuitem" key={target.id} onClick={() => moveSubtask(subtask, target)}>{target.title}</button>) : <p>No other open tasks available.</p>}</div>}<button className="danger" role="menuitem" onClick={() => requestTaskRemoval(subtask)}><Trash2 size={14} /> Delete</button></div>}</div>}</article>;
            }) : <p className="empty-subtasks">No subtasks yet.</p>}</div>
            {!taskDetailsReadOnly && <div className="inline-subtask"><span>Add a subtask</span><input value={subtaskTitle} maxLength={240} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="What is the next concrete step?" /><textarea value={subtaskDescription} maxLength={20000} onChange={(event) => setSubtaskDescription(event.target.value)} placeholder="Description (optional)" /><button className="primary" disabled={busy || !subtaskTitle.trim()} onClick={submitInlineSubtask}><Plus size={14} /> Add subtask</button></div>}
          </section>
        </>}</div>
        <footer className="task-detail-footer">{!taskDetailsReadOnly && <><button className="delete-task" disabled={busy} onClick={() => requestTaskRemoval(taskDetails.task, true)}>Delete task</button><button disabled={busy} onClick={() => editTask(taskDetails.task)}>Edit task</button></>}<button onClick={() => setTaskDetails(null)}>Done</button></footer>
      </section>
    </div>}
    {deleteRequest && <div className="task-modal-backdrop confirmation-backdrop"><section className="delete-confirmation" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirmation-title" aria-describedby="delete-confirmation-description"><span><Trash2 size={18} /></span><h2 id="delete-confirmation-title">Delete this {deleteRequest.closeParent ? "task" : "subtask"}?</h2><p id="delete-confirmation-description">“{deleteRequest.task.title}” will be removed from Work OS and archived in Nifty.{deleteRequest.closeParent && taskDetails?.subtasks.length ? ` Its ${taskDetails.subtasks.length} remaining subtask${taskDetails.subtasks.length === 1 ? "" : "s"} will also be archived.` : ""}</p><div><button disabled={busy} onClick={() => setDeleteRequest(null)}>Cancel</button><button className="confirm-delete" disabled={busy} onClick={confirmTaskRemoval}>{busy ? "Deleting…" : "Delete"}</button></div></section></div>}
  </div>;
}

function ConnectScreen({ apiBase, setApiBase, error, hint, connecting, debugError, onDebug, onConnect, onSave }: { apiBase: string; setApiBase: (value: string) => void; error: string; hint: string; connecting: boolean; debugError: React.ReactNode; onDebug: () => void; onConnect: () => void; onSave: () => Promise<void> }) { return <main className="connect"><section><div className="wordmark large"><img src={assetUrl(wordmark)} alt="" /><span>WORK <b>OS</b></span></div><span className="kicker">Desktop companion</span><h1>Clarity for the workday.</h1><p>Plan what matters, capture progress naturally, and close the loop—without turning work into surveillance.</p>{error && <div className="notice error"><AlertTriangle size={16} />{error}</div>}{hint && <div className="notice">{hint}</div>}{debugError}<button className="primary connect-button" disabled={connecting} onClick={onConnect}><LogIn size={17} /> {connecting ? "Opening browser…" : "Connect workspace"}</button><details><summary>Server settings</summary><input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="https://work.example.com" /><button onClick={() => void onSave()}>Save</button></details><button className="quiet" onClick={onDebug}><Bug size={14} /> Scenario debugger</button></section><aside><img src={assetUrl(companionArt)} alt="Work OS companion" /></aside></main>; }
function LoadingScreen({ error, retry }: { error: string; retry: () => void }) { return <main className="loading"><img src={assetUrl(wordmark)} alt="" /><h1>{error ? "Couldn’t load Work OS" : "Preparing your workday"}</h1><p>{error || "Syncing your schedule, tasks, and provider context…"}</p>{error && <button className="primary" onClick={retry}>Retry</button>}</main>; }
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

export function TasksWorkspace({ currentDate, historyDate, currentPlan, historicalPlan, historicalTasks, goal, goalProvenance, suggestion, saveState, taskView, todayTasks, taskHistory, carryOver, carryOverOpen, loadingMore, hasMore, busy, taskStatus, onTaskView, onDate, onGoal, onAcceptSuggestion, onAddTask, onOpenTask, onSurfaceTask, onTaskCompletion, onCarryOverOpen, onLoadMore }: {
  currentDate: string; historyDate: string; currentPlan: DailyPlan | null; historicalPlan: DailyPlan | null; historicalTasks: TaskRow[]; goal: string;
  goalProvenance: "employee" | "accepted_suggestion" | null; suggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  taskView: TaskView; todayTasks: TaskRow[]; taskHistory: TaskRow[]; carryOver: ReturnType<typeof unfinishedBefore>; carryOverOpen: boolean;
  loadingMore: boolean; hasMore: boolean; busy: boolean; taskStatus: string; onTaskView: (view: TaskView) => void; onDate: (date: string) => Promise<void>;
  onGoal: (value: string) => void; onAcceptSuggestion: () => void; onAddTask: () => void; onOpenTask: (task: TaskRow, readOnly: boolean) => void;
  onSurfaceTask: (task: TaskRow, disposition?: "selected" | "deferred") => void; onTaskCompletion: (task: TaskRow, completed: boolean) => void; onCarryOverOpen: (open: boolean) => void; onLoadMore: () => void;
}) {
  const [taskMenuId, setTaskMenuId] = useState<string | null>(null);
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
  const current = uniqueTasks([...todayTasks, ...surfaced]);
  const surfacedIds = (shownPlan?.items ?? []).filter((item) => item.task_id && item.disposition !== "removed").map((item) => String(item.task_id));
  const datedTasks = tasksForDate([...historicalTasks, ...surfaced], selectedDate, surfacedIds);
  const displayed = historical
    ? datedTasks
    : taskView === "today" ? current
      : taskView === "unfinished" ? taskHistory.filter((task) => task.completed !== true)
        : taskView === "completed" ? taskHistory.filter((task) => task.completed === true)
          : taskHistory;
  const selectedIds = new Set((currentPlan?.items ?? []).filter((item) => item.disposition === "selected" && item.task_id).map((item) => String(item.task_id)));
  const groups = new Map<string, typeof carryOver>();
  for (const item of carryOver) {
    const key = item.attribution.date ?? "Older";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const previousDays = new Set(carryOver.map((item) => item.attribution.date).filter(Boolean)).size;
  const provenance = !shownPlan?.freeform_intent ? "No goal yet" : shownPlan.goal_provenance === "accepted_suggestion" ? "Accepted from your tasks" : "Written by you";
  return <main className="page tasks-workspace">
    <div className="tasks-heading"><PageIntro eyebrow="Daily workspace" title={historical ? "Workday history" : "Today’s tasks"} body="Your goal is Work OS context. Every actionable item remains an authoritative Nifty task." /><div className="date-navigator"><button aria-label="Previous day" onClick={() => void onDate(moveDate(selectedDate, -1))}><ChevronLeft size={16} /></button><input aria-label="Workspace date" type="date" max={currentDate} value={selectedDate} onChange={(event) => void onDate(event.target.value)} /><button aria-label="Next day" disabled={selectedDate >= currentDate} onClick={() => void onDate(moveDate(selectedDate, 1))}><ChevronRight size={16} /></button></div></div>
    <section className="panel daily-goal-card"><div className="goal-card-head"><div><span>Goal for {historical ? selectedDate : "today"}</span><small>{provenance}</small></div>{!historical && <span className={`save-state ${saveState}`}>{saveState === "saving" ? "Saving…" : saveState === "offline" ? "Offline" : saveState === "conflict" ? "Conflict" : "Saved"}</span>}</div>{historical ? <p>{shownPlan?.freeform_intent || "No goal was recorded."}</p> : <><textarea maxLength={4000} value={goal} onChange={(event) => onGoal(event.target.value)} placeholder="What will you do today?" />{!goal && suggestion && <div className="goal-suggestion"><Sparkles size={16} /><div><strong>Suggested from your tasks</strong><p>{suggestion.text}</p></div><button onClick={onAcceptSuggestion}>Use suggestion</button></div>}<small className="goal-independence">You can organize your day before clock-in. Attendance remains independent.</small></>}</section>
    {!historical && carryOver.length > 0 && <button className="carry-alert" onClick={() => onCarryOverOpen(true)}><AlertTriangle size={17} /><span><strong>{carryOver.length} unfinished task{carryOver.length === 1 ? "" : "s"} carried over from {previousDays} previous workday{previousDays === 1 ? "" : "s"}.</strong><small>{carryOver.slice(0, 3).map((item) => item.task.title).join(" · ")}</small></span><em>Review unfinished work</em><ChevronRight size={16} /></button>}
    {!historical && <div className="task-view-tabs" role="tablist">{(["today", "unfinished", "completed", "all"] as TaskView[]).map((item) => <button role="tab" aria-selected={taskView === item} className={taskView === item ? "active" : ""} key={item} onClick={() => onTaskView(item)}>{sentence(item === "all" ? "all tasks" : item)}</button>)}</div>}
    <section className="panel"><div className="card-title"><span><ListChecks size={17} /> {historical ? selectedDate : sentence(taskView)}</span>{!historical && <button className="primary" onClick={onAddTask}><Plus size={15} /> Add task</button>}</div>{taskStatus && <p className="notice">{taskStatus}</p>}<div className="evidence-list task-records">{displayed.length ? displayed.map((task) => {
      const attribution = taskDateAttribution(task, currentDate);
      const assigneeCount = Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids.length : Array.isArray(task.assignee_provider_ids) ? task.assignee_provider_ids.length : 0;
      const taskId = String(task.provider_task_id || task.id);
      const menuOpen = taskMenuId === taskId;
      const progress = subtaskProgress(task);
      const isSelected = selectedIds.has(String(task.id)) || selectedIds.has(String(task.provider_task_id));
      return <article className="task-record workspace-task" role="button" tabIndex={0} key={task.id} onClick={() => onOpenTask(task, historical)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenTask(task, historical); } }}><span className={`evidence-kind ${task.completed ? "output" : "activity"}`}>{task.completed ? "Complete" : "Open"}</span><div><h3>{task.title}</h3><p>{task.description || "No description"}</p><small>{task.project?.name || "Nifty"}{task.milestone?.name ? ` · ${task.milestone.name}` : ""}{task.priority ? ` · ${sentence(String(task.priority))} priority` : ""}{assigneeCount ? ` · ${assigneeCount} assignee${assigneeCount === 1 ? "" : "s"}` : ""}{task.due_date ? ` · due ${task.due_date}` : ""}{task.provider_created_at ? ` · created ${task.provider_created_at.slice(0, 10)}` : ""}{task.parent_provider_task_id ? " · subtask" : ""}{task.synced_at ? " · Nifty synced" : " · Nifty sync pending"}</small></div>{progress.total > 0 && <CompletionRing compact completed={progress.completed} total={progress.total} label="subtasks" />}{!historical && <div className="workspace-task-menu" onClick={(event) => event.stopPropagation()}><button className="ellipsis-button" aria-label={`Actions for ${task.title}`} aria-haspopup="menu" aria-expanded={menuOpen} disabled={busy} onClick={() => setTaskMenuId(menuOpen ? null : taskId)}><MoreHorizontal size={17} /></button>{menuOpen && <div className="subtask-menu" role="menu">{!task.completed && !isSelected && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task); }}><Plus size={14} /> Add to today</button>}{!task.completed && <button role="menuitem" onClick={() => { setTaskMenuId(null); onSurfaceTask(task, "deferred"); }}><CirclePause size={14} /> Defer</button>}<button role="menuitem" onClick={() => { setTaskMenuId(null); onTaskCompletion(task, !task.completed); }}>{task.completed ? <RotateCcw size={14} /> : <Check size={14} />} {task.completed ? "Reopen task" : "Mark task done"}</button>{attribution.date && attribution.date < currentDate && <button role="menuitem" onClick={() => { setTaskMenuId(null); void onDate(attribution.date!); }}><ChevronLeft size={14} /> Open original day</button>}</div>}</div>}<ChevronRight size={17} /></article>;
    }) : <Empty title={historical ? "No tasks surfaced" : "No tasks in this view"} body={historical ? "This day has no recorded Nifty task workspace." : "Refresh to load the provider-backed task record."} />}</div>{!historical && hasMore && <button disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? "Loading…" : "Load more"}</button>}</section>
    {carryOverOpen && <div className="carry-flyout-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onCarryOverOpen(false); }}><aside className="carry-flyout" aria-label="Unfinished work" role="dialog" aria-modal="true"><header><div><span>Unfinished work</span><h2>Review before carrying forward.</h2></div><button aria-label="Close unfinished work" onClick={() => onCarryOverOpen(false)}><X size={18} /></button></header><div>{[...groups.entries()].map(([date, items]) => <section key={date}><h3>{date === moveDate(currentDate, -1) ? `Yesterday · ${date}` : date}</h3>{items.map(({ task, attribution }) => <article key={task.id}><div><strong>{task.title}</strong><small>{attribution.reason === "due" ? "Due on that day" : attribution.reason === "created" ? "Created on that day" : "Previously surfaced"}</small></div><div><button disabled={busy} onClick={() => onSurfaceTask(task)}>Add to today</button><button disabled={busy} onClick={() => onSurfaceTask(task, "deferred")}>Defer</button><button disabled={busy} onClick={() => onTaskCompletion(task, true)}>Complete</button><button onClick={() => void onDate(attribution.date!)}>Open day</button></div></article>)}</section>)}</div></aside></div>}
  </main>;
}

const durationLabel = (seconds: number) => `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;

function PersonalInsights({ data, loading, range, onRange, onReference }: { data: InsightsData | null; loading: boolean; range: "day" | "7d" | "30d"; onRange: (value: "day" | "7d" | "30d") => void; onReference: (type: "plan" | "task" | "check_in" | "evidence") => void }) {
  const latest = data?.days.at(-1);
  return <main className="page insights-page"><div className="insights-heading"><PageIntro eyebrow="Personal insights" title="Progress, with the evidence labels intact." body="Daily goals, employee updates, task outcomes, output evidence, and Worktivity context are analyzed separately—never collapsed into a surveillance score." /><div className="range-switch" aria-label="Insight range">{(["day", "7d", "30d"] as const).map((value) => <button className={range === value ? "active" : ""} key={value} onClick={() => onRange(value)}>{value === "day" ? "Today" : value}</button>)}</div></div>
    {loading && !data ? <section className="panel"><Empty title="Building your work record" body="Loading daily goals, sessions, task outcomes, updates, and evidence." /></section> : data ? <>
      <div className="metric-grid"><Metric icon={Clock3} label="Observed work time" value={durationLabel(data.totals.observedSeconds)} /><Metric icon={ListChecks} label="Daily tasks" value={`${data.totals.plannedCompleted}/${data.totals.planned}`} /><Metric icon={FileCheck2} label="Nifty outcomes" value={String(data.totals.tasksCompleted)} /><Metric icon={Fingerprint} label="Output evidence" value={String(data.totals.outputEvidence)} /></div>
      <section className="panel insight-brief"><header><div><span>{data.brief.generated ? "Agent brief" : "Deterministic brief"}</span><h3>{data.brief.summary}</h3></div><small>{data.from} → {data.through}</small></header><div><section><strong>Wins</strong>{data.brief.wins.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Needs attention</strong>{data.brief.attention.map((item) => <p key={item}>{item}</p>)}</section><section><strong>Next focus</strong>{data.brief.nextFocus.map((item) => <p key={item}>{item}</p>)}</section></div></section>
      <section className="panel trend-panel"><div className="card-title"><span><Gauge size={17} /> Workday trend</span><small>8-hour time scale · exact values below</small></div><div className="trend-chart" role="img" aria-label="Observed work time and daily task completion by day">{data.days.map((day) => <div className="trend-day" key={day.date}><div className="trend-bars"><i title={`${durationLabel(day.observedSeconds)} observed`} style={{ height: `${Math.min(100, day.observedSeconds / (8 * 3600) * 100)}%` }} /><b title={`${day.plannedCompleted} of ${day.planned} daily tasks`} style={{ height: `${day.planned ? day.plannedCompleted / day.planned * 100 : 0}%` }} /></div><span>{day.date.slice(5)}</span></div>)}</div><div className="trend-legend"><span><i /> Observed session time</span><span><b /> Daily task completion</span></div>
        <div className="insight-table-wrap"><table><caption>Exact personal insight values</caption><thead><tr><th>Date</th><th>Observed</th><th>Paused</th><th>Daily tasks</th><th>Tasks done</th><th>Updates</th><th>Output evidence</th><th>Activity context</th></tr></thead><tbody>{data.days.map((day) => <tr key={day.date}><td>{day.date}</td><td>{durationLabel(day.observedSeconds)}</td><td>{durationLabel(day.pausedSeconds)}</td><td>{day.plannedCompleted}/{day.planned}</td><td>{day.tasksCompleted}</td><td>{day.updates}</td><td>{day.outputEvidence}</td><td>{day.activityContext}</td></tr>)}</tbody></table></div>
      </section>
      <section className="panel insight-drilldown"><div className="card-title"><span><Inbox size={17} /> Latest-day record</span><small>{latest?.date}</small></div>{latest?.references.length ? <div>{latest.references.map((reference) => <button key={`${reference.type}:${reference.id}`} onClick={() => onReference(reference.type)}><span>{reference.type === "plan" ? "Daily workspace" : sentence(reference.type)}</span><strong>{reference.label}</strong><ChevronRight size={15} /></button>)}</div> : <Empty title="No linked records" body="This day has no daily goal, task completion, substantive update, or evidence record yet." />}<footer>Nifty synced {data.freshness.niftySyncedAt ? formatTime(data.freshness.niftySyncedAt) : "unavailable"} · Worktivity observed {data.freshness.worktivityObservedAt ? formatTime(data.freshness.worktivityObservedAt) : "unavailable"}</footer></section>
      <p className="insight-disclaimer">These are descriptive personal signals, not a performance score. Idle activity is never labeled productivity, and activity context never proves task completion.</p>
    </> : <section className="panel"><Empty title="Insights unavailable" body="Refresh to retry the personal insights record." /></section>}
  </main>;
}
function Setting({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) { return <div className="setting"><div><strong>{title}</strong><small>{detail}</small></div>{children}</div>; }
function DebugFailedNotice({ onDismiss }: { onDismiss: () => void }) {
  return <div className="notice error" role="alert"><AlertTriangle size={16} />Debugger window could not open.<button onClick={() => void openLogsDir()}>Open logs folder</button><button onClick={onDismiss}><X size={14} /></button></div>;
}
