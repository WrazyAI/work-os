import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { emit, listen } from "./tauriEvents";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Minus, SquarePen, X } from "lucide-react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { secureState } from "./vault";
import { apiRequest, ApiRequestError } from "./api";
import { DAY_STALE_MS, workOsKeys, workOsQueryClient } from "./queryClient";
import { fetchDay, fetchTaskDetails } from "./workOsQueries";
import { isDisplayToolOp, isMutatingToolOp, mergeToolResults, normalizeInterpretation, fileApprovedOperations, partialFilingMessage, toolCallKey, type NavigatePage, type PendingToolReview, type ProposedOperation, type ToolCallResult } from "./interpretation";
import { NavigateButton } from "./NavigateButton";
import { ApprovalFlow } from "./ApprovalFlow";
import { TaskSelectionCard, type TaskSelectionCardTask } from "./TaskSelectionCard";
import { ChatSectionBoundary } from "./ErrorBoundary";
import { ChatTabs, ChatTurn, WorkOsPromptBar, collapseConsecutiveAssistantDuplicates, threadScrollTarget, workOsChatCommands } from "./WorkOsChat";
import { AvatarThinking, type AvatarThinkingStage } from "./AvatarThinking";
import { AgendaReviewCard } from "./AgendaReviewCard";
import { deriveTaskContext } from "./avatarTaskContext";
import { agendaReceipt, applicableAnswers, unansweredQuestions, withAnswerRound, type AgendaAnswers } from "./avatarAgenda";
import { buildPlanItemsFromInterpretation } from "./planItems";
import { lateReasonRequired } from "./lateStart";
import type { PlanningInterpretation } from "./PlanningSession";
import { formatWorkOsDate } from "./dateFormat";
import { Otto } from "./Otto";
import {
  agendaAutoExpandKey, avatarPrompt, clearRecordedUpdatePrompt, collectNudges, isOnShift, mergeAvatarChatEntries, nextAgendaAutoExpand, serializeAvatarChatEntry, shiftElapsedFraction, snoozeUntil,
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
  };
}

interface DayFacts extends CompanionDayFacts {
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
}

interface AgendaReview {
  input: string;
  interpretation: PlanningInterpretation;
  answers: AgendaAnswers;
  round: number;
}

const AVATAR_COLLAPSED = { width: 164, height: 188 };
const AVATAR_EXPANDED = { width: 400, height: 620 };
const DAY_POLL_MS = 60_000;
const POSITION_KEY = "work-os.avatar.position.v1";
const NOTIFIED_KEY = "work-os.avatar.notified.v1";
const SNOOZE_KEY = "work-os.avatar.snooze.v1";

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
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [facts, setFacts] = useState<DayFacts>({
    loaded: false, shiftDate: "", promptRequired: false, nextPromptAt: null, promptKind: null,
    shiftStartsAt: null, shiftEndsAt: null, sessionState: null, clockedInAt: null,
    clockedOutAt: null, pausedSeconds: 0, lastSubstantiveUpdateAt: null, employeeUpdates: 0, completedTasks: 0, openTasks: 0, eodSubmitted: false, personId: null, planIntent: null,
    timezone: null, displayName: null, niftySyncing: false, niftySyncError: null, taskOptions: [], planStatus: null, planItems: [], lateReasonRequired: false,
  });
  const [daySyncState, setDaySyncState] = useState<DaySyncState>("loading");
  const [desktopSession, setDesktopSession] = useState<SessionInfo | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [loadedChatConversation, setLoadedChatConversation] = useState<string | null>(null);
  const chatConversationSignature = useRef("");
  const [input, setInput] = useState("");
  const [avatarTab, setAvatarTab] = useState<"chat" | "tasks">("chat");
  const [thinkingTrace, setThinkingTrace] = useState<{ stages: AvatarThinkingStage[]; active: number; startedAt: number } | null>(null);
  const thinking = thinkingTrace !== null;
  const [agendaReview, setAgendaReview] = useState<AgendaReview | null>(null);
  const [filing, setFiling] = useState(false);
  const [proposedTaskIds, setProposedTaskIds] = useState<Set<string>>(() => new Set());
  const [snoozeCount, setSnoozeCount] = useState<number>(() => {
    const s = readJson<{ count?: number; until?: number | null }>(SNOOZE_KEY, {});
    return typeof s.count === "number" ? s.count : 0;
  });
  const [missed, setMissed] = useState(false);
  const notifiedKeys = useRef<Set<string>>(new Set(readJson<string[]>(NOTIFIED_KEY, [])));
  const deliveryKeys = useRef<Set<string>>(new Set());
  const notificationPermission = useRef(false);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const threadMetricsRef = useRef<{ scrollHeight: number } | null>(null);
  const [sweepSignal, setSweepSignal] = useState(0);
  const bumpSweep = () => setSweepSignal((value) => value + 1);
  const dayRef = useRef<DayFacts>(facts);
  const dayLoadInFlight = useRef(false);
  const chatRef = useRef<ChatEntry[]>([]);
  const avatarToolsSig = useRef("");
  // The agenda auto-expand key last acted on, so a deliberate collapse is never
  // fought by a re-render. Reset when the agenda stops being due.
  const autoExpandedAgenda = useRef<string | null>(null);

  useEffect(() => { dayRef.current = facts; }, [facts]);
  useEffect(() => { chatRef.current = chat; }, [chat]);

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
      const session = (await secureState.session().catch(() => null)) as SessionInfo | null;
      setDesktopSession(session);
      setConnected(!!session && new Date(session.expiresAt).getTime() > Date.now());
      notificationPermission.current = await requestNotificationPermissionOnce();
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
    if (dayLoadInFlight.current) return;
    dayLoadInFlight.current = true;
    try {
      if (force) await workOsQueryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") });
      // Shared query cache: a fresh cached day is served without a network
      // round-trip; stale data refreshes in the background.
      const day = await workOsQueryClient.fetchQuery({
        queryKey: workOsKeys.day("compact"),
        queryFn: () => fetchDay({ variant: "compact" }),
        staleTime: DAY_STALE_MS,
      }) as unknown as Record<string, any>;
      const session = (day?.session ?? {}) as Record<string, any>;
      const prompt = (day?.prompt ?? {}) as Record<string, any>;
      setFacts({
        loaded: true,
        shiftDate: String(day?.shiftDate ?? ""),
        promptRequired: prompt.kind === "follow_up" || prompt.kind === "hourly_fallback",
        nextPromptAt: typeof prompt.nextPromptAt === "string" ? prompt.nextPromptAt : null,
        promptKind: ["plan", "follow_up", "hourly_fallback", "eod"].includes(prompt.kind) ? prompt.kind : null,
        shiftStartsAt: day?.shift?.startsAt ?? session.scheduled_starts_at ?? null,
        shiftEndsAt: day?.shift?.endsAt ?? session.scheduled_ends_at ?? null,
        sessionState: session.state ?? null,
        clockedInAt: session.clocked_in_at ?? null,
        clockedOutAt: session.clocked_out_at ?? null,
        pausedSeconds: Number(session.paused_seconds ?? 0) || 0,
        lastSubstantiveUpdateAt: typeof session.last_substantive_update_at === "string" ? session.last_substantive_update_at : null,
        employeeUpdates: Number(day?.signals?.employeeUpdates ?? 0) || 0,
        completedTasks: Number(day?.signals?.completedTasks ?? 0) || 0,
        openTasks: Number(day?.signals?.openTasks ?? 0) || 0,
        eodSubmitted: typeof day?.report?.submitted_at === "string",
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
      if (value instanceof ApiRequestError && value.status === 401) setConnected(false);
      // Retain usable facts but make the stale/failure boundary explicit.
      setDaySyncState(dayRef.current.loaded ? "stale" : "error");
    } finally { dayLoadInFlight.current = false; }
  }, []);

  useEffect(() => {
    void loadDay(true);
    const poll = setInterval(() => { void loadDay(); }, DAY_POLL_MS);
    return () => clearInterval(poll);
  }, [loadDay]);

  // The main and companion windows own separate React trees. Refresh promptly
  // after a main-window write or sign-in instead of waiting for the minute poll.
  useEffect(() => {
    let unlistenDay: (() => void) | undefined;
    let unlistenSession: (() => void) | undefined;
    void listen("work-os://main-day-changed", () => { void loadDay(true); }).then((fn) => { unlistenDay = fn; }).catch(() => undefined);
    void listen("work-os://main-session-changed", () => {
      void secureState.session().then((session) => {
        setDesktopSession(session);
        setConnected(!!session && new Date(session.expiresAt).getTime() > Date.now());
        void loadDay(true);
      }).catch(() => undefined);
    }).then((fn) => { unlistenSession = fn; }).catch(() => undefined);
    return () => { unlistenDay?.(); unlistenSession?.(); };
  }, [loadDay]);

  const avatarConversationScope = desktopSession?.organizationId && facts.personId && facts.shiftDate
    ? `workday:${desktopSession.organizationId}:${facts.personId}:${facts.shiftDate}`
    : null;
  useEffect(() => {
    let cancelled = false;
    chatConversationSignature.current = "";
    setLoadedChatConversation(null);
    setChat([]);
    if (!avatarConversationScope) return () => { cancelled = true; };
    void secureState.conversation(avatarConversationScope).then((turns) => {
      if (!cancelled) {
        chatConversationSignature.current = JSON.stringify(turns);
        setChat(mergeAvatarChatEntries([], turns as AvatarStoredTurn[]));
        setLoadedChatConversation(avatarConversationScope);
      }
    }).catch(() => {
      if (!cancelled) setLoadedChatConversation(avatarConversationScope);
    });
    return () => { cancelled = true; };
  }, [avatarConversationScope]);
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

  // ── Notification scheduler: hourly + clock-in + EOD, deduped per key ──
  useEffect(() => {
    if (!facts.loaded || connected === false) return;
    const nudges = collectNudges(facts, Date.now(), notifiedKeys.current);
    for (const nudge of nudges) {
      if (nudge.kind === "hourly") {
        if (deliveryKeys.current.has(nudge.key)) continue;
        deliveryKeys.current.add(nudge.key);
        void apiRequest<{ delivered: boolean }>("/api/work-os/me/prompt-delivery", {
          method: "POST",
          headers: { "Idempotency-Key": nudge.key },
          body: JSON.stringify({}),
        }).then(({ delivered }) => {
          if (!delivered || notifiedKeys.current.has(nudge.key)) return;
          notifiedKeys.current.add(nudge.key);
          writeJson(NOTIFIED_KEY, [...notifiedKeys.current].slice(-80));
          fireNotification(nudge, notificationPermission.current);
          setMissed(false);
          setExpanded((current) => {
            if (!current) void toggleExpanded(true);
            return true;
          });
          if (win) win.setFocus().catch(() => { /* best effort */ });
          void loadDay();
        }).catch(() => undefined).finally(() => deliveryKeys.current.delete(nudge.key));
        continue;
      }
      notifiedKeys.current.add(nudge.key);
      writeJson(NOTIFIED_KEY, [...notifiedKeys.current].slice(-80));
      fireNotification(nudge, notificationPermission.current);
    }
  }, [facts.loaded, facts.promptRequired, facts.nextPromptAt, facts.shiftDate, connected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Snooze expiry: re-prompt when the snooze window passes ──
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
      fireNotification({ kind: "hourly", key: `snooze-${until}`, title: "Update still due", body: "A few words is all it takes." }, notificationPermission.current);
    }
  }, [now, facts.promptRequired, missed]);

  // ── Expanded/collapsed window sizing ──
  const toggleExpanded = useCallback(async (open: boolean): Promise<void> => {
    setExpanded(open);
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
  }, [win]);

  const openEodReview = useCallback(async (): Promise<void> => {
    void emit("work-os://avatar-open-eod");
    await invoke("focus_main").catch(() => undefined);
    await toggleExpanded(false);
  }, [toggleExpanded]);

  const navigateToPage = useCallback(async (page: NavigatePage): Promise<void> => {
    void emit("work-os://avatar-navigate", { view: page });
    await invoke("focus_main").catch(() => undefined);
  }, []);

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
            if (x < 28) x = 0;
            else if (x > monitor.size.width - AVATAR_COLLAPSED.width - 28) x = monitor.size.width - AVATAR_COLLAPSED.width;
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
        body: JSON.stringify({ input: text, planIntent: facts.planIntent || null, today: facts.shiftDate || null, history: history.slice(-24).map(({ role, text: turnText }) => ({ role, text: turnText })) }),
      });
      setThinkingTrace({ stages, active: 1, startedAt });
      const review = normalizeInterpretation(result.interpretation, text, facts.taskOptions);
      if (!review) throw new Error("The assistant couldn't map that to work yet.");
      if (!review.operations.length) {
        const trace = settle(stages.map((stage) => stage.label), "Nothing to record");
        setChat((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", text: review.reply ?? "Noted.", trace }]);
        return;
      }
      setThinkingTrace({ stages, active: 2, startedAt });
      const mutating = review.operations.map((op, index) => ({ op, index })).filter(({ op }) => isMutatingToolOp(op));
      const proposals = mutating.length ? await apiRequest<{ proposals: Array<{ id: string; client_operation_index: number }> }>("/api/work-os/me/proposals", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ input_text: text, operations: mutating.map(({ op }) => ({ op: op.op, statement: op.statement, task_id: op.taskId, task_title: op.taskTitle, task_group_id: op.taskGroupId, limit: op.limit })) }),
      }) : { proposals: [] };
      // A filed check-in clears the recorded-update prompt immediately so the
      // banner and the task-context card disappear without waiting for the poll.
      if (review.operations.some((operation) => operation.op === "record_progress" || operation.op === "record_blocker")) {
        setFacts((current) => clearRecordedUpdatePrompt(current));
      }
      const proposalIdByOriginal = new Map(proposals.proposals.map((proposal) => [mutating[proposal.client_operation_index]?.index, proposal.id]));
      const operations = review.operations.map((op, index) => ({ ...op, enabled: isMutatingToolOp(op), proposalId: proposalIdByOriginal.get(index) }));
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
      const assistantEntry: ChatEntry = { id: reviewId, role: "assistant", text: review.reply ?? "Here's what I understood.", operations, taskOptions: [], trace, toolResults: displayResults.length ? displayResults : undefined };
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

  const approveOperations = useCallback(async (entryId: string, approved: ProposedOperation[], rejected: ProposedOperation[]) => {
    if ((!approved.length && !rejected.length) || filing) return;
    setFiling(true);
    try {
      const [outcome, rejectionResults] = await Promise.all([
        approved.length ? fileApprovedOperations(approved.map((op) => ({ ...op, enabled: true })), proposalFilingTransport()) : Promise.resolve({ recorded: 0, queued: 0, processing: 0, failed: [], results: [] as ToolCallResult[] }),
        Promise.all(rejected.map(async (op): Promise<ToolCallResult> => {
          try {
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
      setChat((current) => current.map((entry) => entry.id === entryId
        ? { ...entry, operations: entry.operations?.map((op) => ({ ...op, enabled: false })), toolResults: mergeToolResults(entry.toolResults ?? [], results), receipt: null }
        : entry));
      const filed = chatRef.current.find((entry) => entry.id === entryId);
      const entries = chatRef.current;
      const at = entries.findIndex((entry) => entry.id === entryId);
      const precedingUser = [...entries.slice(0, at < 0 ? entries.length : at)].reverse().find((entry) => entry.role === "user");
      void shareAvatarTools({
        reviewId: entryId,
        input: precedingUser?.text ?? "",
        reply: filed?.text,
        operations: (filed?.operations ?? [...approved, ...rejected]).map((op) => ({ ...op, enabled: false })),
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
    if (!op.proposalId || filing) return;
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
        setChat((current) => [...current, { id: reviewId, role: "assistant", text: "Review the selected task completions before anything changes.", operations: reviewed }]);
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
  }, [filing]);

  const agendaDue = ["clocked_in", "active", "paused"].includes(facts.sessionState ?? "") && facts.planStatus !== "confirmed" && facts.loaded;
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
      const conversation = chat
        .filter((entry) => entry.role === "user" || entry.role === "assistant")
        .slice(-8)
        .map((entry) => ({ role: entry.role as "user" | "assistant", text: entry.text }));
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
        chat.filter((entry) => entry.role === "user" || entry.role === "assistant")
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
  const promptTurnId = attentionDue ? `prompt:${facts.shiftDate}:${contextualPrompt.kind}:${facts.nextPromptAt ?? facts.sessionState ?? "now"}` : null;
  useEffect(() => {
    if (!promptTurnId) return;
    setChat((current) => current.some((entry) => entry.id === promptTurnId)
      ? current
      : [...current, { id: promptTurnId, role: "assistant", text: `${contextualPrompt.heading}: ${contextualPrompt.body}`, createdAt: new Date().toISOString() }]);
  }, [contextualPrompt.body, promptTurnId]);
  const showBadge = contextualPrompt.kind === "eod" || (contextualPrompt.kind === "check_in" && !missed);
  const taskContext = useMemo(
    () => (facts.loaded ? deriveTaskContext(facts.taskOptions, facts.shiftDate) : null),
    [facts.loaded, facts.shiftDate, facts.taskOptions],
  );
  // Single acknowledgement hop when a new prompt arrives — state-driven, never ambient.
  const [hop, setHop] = useState(false);
  useEffect(() => {
    if (!promptTurnId) return;
    setHop(true);
    const timer = setTimeout(() => setHop(false), 650);
    return () => clearTimeout(timer);
  }, [promptTurnId]);
  const onShift = isOnShift(facts, now);
  const { fraction, label, remaining } = shiftElapsedFraction(facts, now);
  const ringClass = !onShift ? "off" : facts.lateReasonRequired ? "late" : facts.sessionState === "paused" ? "paused" : attentionDue ? "due" : "live";
  // The header dot reports shift state, so a due check-in never turns it red:
  // the banner, the orb pulse, and the composer carry that instead.
  const dotClass = !onShift ? "off" : facts.lateReasonRequired ? "late" : facts.sessionState === "paused" ? "paused" : "live";
  const shiftLabel = onShift ? `On shift · ${label}` : facts.sessionState === "paused" ? "Paused" : "Off shift";
  const petPose = attentionDue ? "alert" : !onShift ? "sleep" : facts.sessionState === "paused" ? "rest" : "focus";
  const petTone = facts.lateReasonRequired ? "late" : "signal";
  const lastEntry = chat[chat.length - 1];
  const statusText = facts.lateReasonRequired
    ? "Late start — add a reason"
    : !facts.loaded
      ? (daySyncState === "error" ? "Today is syncing" : "Loading today…")
      : facts.niftySyncError
        ? "Nifty sync delayed"
        : facts.niftySyncing
          ? "Nifty syncing…"
          : daySyncState === "stale"
            ? "Showing last update"
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
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
    const newest = el.lastElementChild as HTMLElement | null;
    const previousHeight = threadMetricsRef.current?.scrollHeight ?? el.scrollHeight;
    const wasAtBottom = previousHeight - el.scrollTop - el.clientHeight < 48;
    const target = threadScrollTarget({
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      newestHeight: newest ? newest.offsetHeight : 0,
      newestTop: newest ? newest.getBoundingClientRect().top - el.getBoundingClientRect().top : 0,
      wasAtBottom,
    });
    if (target !== null) el.scrollTo({ top: target, behavior });
    threadMetricsRef.current = { scrollHeight: el.scrollHeight };
  }, [chat.length, thinking]);

  if (connected === false) {
    return (
      <div className={`avatar-shell ${expanded ? "expanded" : ""}`}>
        {!expanded && (
          <div className="avatar-compact">
          <span className="avatar-drag-surface" data-tauri-drag-region title="Drag to move the companion" aria-hidden="true">⋮⋮</span><button className="avatar-hide" onClick={() => void invoke("hide_avatar").catch(() => undefined)} aria-label="Hide companion" title="Hide companion"><X size={13} aria-hidden="true" /></button>
          <button className="avatar-orb off" onClick={() => void toggleExpanded(true)} title="Connect Work OS from the main window">
            <svg viewBox="0 0 48 48" className="avatar-ring"><circle cx="24" cy="24" r="22" className="ring-track" /></svg>
            <Otto pose="sleep" className="avatar-pet" />
            <span className="avatar-orb-state">Connect</span>
          </button>
          </div>
        )}
        {expanded && (
          <div className="avatar-panel">
            <header className="avatar-head"><div className="avatar-head-row"><div className="avatar-drag-zone" data-tauri-drag-region><div className="avatar-title"><span className="avatar-head-mark avatar-otto-mark" aria-hidden="true"><Otto pose="sleep" /></span><div className="avatar-head-copy"><strong><span className="avatar-head-name">Otto</span></strong><small>Connect Work OS to begin</small></div></div></div><div className="avatar-head-actions"><button className="avatar-icon" onClick={() => void toggleExpanded(false)} aria-label="Minimize to orb" title="Minimize to orb"><Minus size={15} aria-hidden="true" /></button><button className="avatar-icon avatar-close-hide" onClick={() => void invoke("hide_avatar").catch(() => undefined)} aria-label="Hide companion" title="Hide companion"><X size={15} aria-hidden="true" /></button></div></div></header>
            <div className="avatar-chat"><div className="chat-entry system"><p>Open the Work OS main window and connect this device — this companion will come alive on its own once you're in.</p></div></div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`avatar-shell ${expanded ? "expanded" : ""}`}>
      {!expanded && (
        <div className="avatar-compact">
        {attentionDue && <button className="avatar-prompt-bubble" onClick={() => void toggleExpanded(true)}><strong>{contextualPrompt.heading}</strong><span>{contextualPrompt.compact}</span></button>}
        <span className="avatar-drag-surface" data-tauri-drag-region title="Drag to move the companion" aria-hidden="true">⋮⋮</span><button className="avatar-hide" onClick={() => void invoke("hide_avatar").catch(() => undefined)} aria-label="Hide companion" title="Hide companion"><X size={13} aria-hidden="true" /></button>
        <button
          className={`avatar-orb ${ringClass} ${attentionDue ? "pulse" : ""}${hop ? " hop-once" : ""}`}
          onClick={() => void toggleExpanded(true)}
          title={onShift ? `${label} into your scheduled day · ${remaining}` : "Work OS companion"}
        >
          <svg viewBox="0 0 48 48" className="avatar-ring">
            <circle cx="24" cy="24" r="22" className="ring-track" />
            <circle cx="24" cy="24" r="22" className="ring-fill" strokeDasharray={138.2} strokeDashoffset={138.2 * (1 - fraction)} />
          </svg>
          <Otto pose={petPose} tone={petTone} className="avatar-pet" />
          <span className="avatar-orb-state">{attentionDue ? "Check in" : !onShift ? "Resting" : facts.sessionState === "paused" ? "Paused" : "Focused"}</span>
          {showBadge && <span className="avatar-badge" />}
        </button>
        {onShift && <span className="avatar-day-time" aria-hidden="true">{remaining}</span>}
        </div>
      )}
      {expanded && (
        <div className="avatar-panel">
          <header className="avatar-head">
            <div className="avatar-head-row">
              <div className="avatar-drag-zone" data-tauri-drag-region>
                <div className="avatar-title">
                  <span className="avatar-head-mark avatar-otto-mark" aria-hidden="true"><Otto pose={petPose} tone={petTone} /></span>
                  <div className="avatar-head-copy">
                    <strong title={statusText}>
                      <span className="avatar-head-name">Otto</span>
                      <em className={`avatar-live-dot is-${dotClass}`} aria-hidden="true" />
                      <span className="avatar-head-shift">{shiftLabel}</span>
                    </strong>
                    <span className="sr-only" aria-live="polite">{statusText}</span>
                  </div>
                </div>
              </div>
              <div className="avatar-head-actions">
                {daySyncState !== "ready" && <button className="avatar-retry" onClick={() => { setDaySyncState("loading"); void loadDay(); }} title="Refresh today's record" aria-label="Refresh today's record">Retry</button>}
                {chat.length > 0 && <button className="avatar-icon" onClick={clearAvatarConversation} aria-label="New conversation" title="New conversation"><SquarePen size={15} aria-hidden="true" /></button>}
                <button className="avatar-icon" onClick={() => void toggleExpanded(false)} aria-label="Minimize to orb" title="Minimize to orb"><Minus size={15} aria-hidden="true" /></button>
                <button className="avatar-icon avatar-close-hide" onClick={() => void invoke("hide_avatar").catch(() => undefined)} aria-label="Hide companion" title="Hide companion"><X size={15} aria-hidden="true" /></button>
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
          </header>
          <div className="avatar-chat" ref={chatScroll}>
            {attentionDue && <section className={`avatar-context ${contextualPrompt.kind}`} aria-label={contextualPrompt.heading}><strong>{contextualPrompt.heading}</strong><small>{contextualPrompt.body}</small>{contextualPrompt.action === "open_eod" && <button onClick={() => void openEodReview()}>Open EOD review</button>}</section>}
          {avatarTab === "tasks" ? (
            <TaskSelectionCard
              title="Open tasks"
              status={facts.loaded ? "ready" : "loading"}
              tasks={facts.taskOptions
                .filter((task) => !task.completed)
                .map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, state: "pending", subtaskTotal: task.subtaskTotal, subtaskCompleted: task.subtaskCompleted, subtasks: task.subtasks }))}
              onMarkSelectedDone={proposeAvatarSelectedCompletions}
              onLoadSubtasks={loadTaskSubtasks}
              proposedTaskIds={[...proposedTaskIds]}
              onReview={() => setAvatarTab("chat")}
              degraded={daySyncState === "stale"}
              emptyTitle="No open tasks"
              emptyMessage="Tasks waiting to be completed will appear here."
            />
          ) : (<>
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
              <ChatTurn role="assistant" text={contextualPrompt.kind === "agenda" ? contextualPrompt.body : "Share an update, or tell me to create, complete, or block tasks."} />
            )}
            {
              collapseConsecutiveAssistantDuplicates(chat).map((entry, entryIndex, allEntries) => {
              const streams = entryIndex === allEntries.length - 1 && entry.role === "assistant" && !entry.operations && !entry.toolResults && !entry.receipt && !entry.id.startsWith("prompt:");
              return (
              <ChatSectionBoundary key={entry.id} label="avatar chat message">
                {entry.role === "user" ? <ChatTurn role="user" text={entry.text} />
                  : entry.role === "system" ? <ChatTurn role="system" text={entry.text} />
                    : entry.receipt ? <ChatTurn role="assistant" receipt text={entry.receipt} />
                      : <ChatTurn role="assistant" text={entry.text} stream={streams} onSettled={bumpSweep}>
                        {entry.trace && (
                          <AvatarThinking
                            stages={entry.trace.labels.map((label) => ({ label }))}
                            active={-1}
                            startedAt={0}
                            settledMs={entry.trace.elapsedMs}
                            result={entry.trace.result}
                          />
                        )}
                        {entry.toolResults?.map((result, resultIndex) => {
                          const selection = (result.data as { provider_result?: { view?: "pending" | "overdue"; tasks?: Array<Record<string, unknown>> } } | undefined)?.provider_result;
                          if (!selection) return null;
                          const tasks: TaskSelectionCardTask[] = Array.isArray(selection.tasks) ? selection.tasks.map((task) => ({
                            id: String(task.id ?? ""), title: typeof task.title === "string" ? task.title : "Untitled Nifty task",
                            description: typeof task.description === "string" ? task.description : null,
                            dueDate: typeof task.due_date === "string" ? task.due_date : null,
                            priority: typeof task.priority === "string" ? task.priority : null,
                            state: selection.view === "overdue" ? "overdue" : "pending",
                          })).filter((task) => !!task.id) : [];
                          return <TaskSelectionCard key={`${result.op.op}-${resultIndex}`} title={selection.view === "overdue" ? "Overdue tasks" : "Pending tasks"} tasks={tasks} onMarkSelectedDone={proposeAvatarSelectedCompletions} proposedTaskIds={[...proposedTaskIds]} onReview={() => setAvatarTab("chat")} maxHeight={250} emptyTitle={selection.view === "overdue" ? "No overdue tasks" : "No pending tasks"} emptyMessage={selection.view === "overdue" ? "Nothing is past its due date." : "Tasks waiting to be completed will appear here."} />;
                        })}
                        {entry.operations?.length ? (
                          <div className="chat-operations">
                            {entry.operations.map((op, index) => {
                              const result = entry.toolResults?.find((item) => item.op === op || (op.proposalId !== undefined && item.op.proposalId === op.proposalId));
                              if (op.op === "navigate_to_page" && op.page) return <NavigateButton key={index} page={op.page} statement={op.statement} onNavigate={(page) => void navigateToPage(page)} />;
                              if (isDisplayToolOp(op)) return result?.status === "failed" ? <p key={index} className="tool-display-error">{result.message}</p> : null;
                              return null;
                            })}
                            {entry.operations.some(isMutatingToolOp) ? <ApprovalFlow
                              operations={entry.operations}
                              results={entry.toolResults}
                              context={{ shiftDate: facts.shiftDate || null, personId: facts.personId, promptKind: "optional" }}
                              busy={filing}
                              onSubmit={(approved, rejected) => void approveOperations(entry.id, approved, rejected)}
                              onRetry={(result) => retryOperation(entry.id, result)}
                            /> : null}
                          </div>
                        ) : null}
                      </ChatTurn>
                }
              </ChatSectionBoundary>
              );
            })}
            {thinkingTrace && <ChatTurn role="assistant"><AvatarThinking stages={thinkingTrace.stages} active={thinkingTrace.active} startedAt={thinkingTrace.startedAt} activeLabel={agendaDue ? "Reviewing your agenda" : "Thinking"} /></ChatTurn>}
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
          {contextualPrompt.action !== "open_eod" && <footer className="avatar-composer-v2 px-2.5 pb-2.5 pt-2">
            <WorkOsPromptBar
              sweepSignal={sweepSignal}
              value={input}
              onChange={setInput}
              onSend={() => void (agendaDue ? submitAgenda() : sendUpdate())}
              placeholder={agendaReview ? "Answer the follow-up questions above…" : agendaDue ? "Describe your goal for today…" : contextualPrompt.kind === "check_in" && !missed ? "Record what changed since your last update…" : "Share an update or instruct the assistant…"}
              ariaLabel={agendaDue ? "Describe your goal for today" : "Share an update or instruct the assistant"}
              canSend={!!input.trim() && !thinking && !filing && !agendaReview}
              busy={thinking || filing}
              autoFocus
              maxLength={4000}
              commands={workOsChatCommands({ eod: () => void openEodReview() }).map((command) =>
                command.key === "focus" ? { ...command, insert: "Focus: " } : command,
              )}
              sendLabel={agendaDue ? "Confirm today’s agenda" : "Send update"}
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
        </div>
      )}
    </div>
  );
}
