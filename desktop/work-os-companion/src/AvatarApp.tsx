import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { secureState } from "./vault";
import { apiRequest, ApiRequestError } from "./api";
import { DAY_STALE_MS, workOsKeys, workOsQueryClient } from "./queryClient";
import { fetchDay } from "./workOsQueries";
import { isDisplayToolOp, isMutatingToolOp, mergeToolResults, normalizeInterpretation, fileApprovedOperations, toolCallKey, type NavigatePage, type PendingToolReview, type ProposedOperation, type ToolCallResult } from "./interpretation";
import { NavigateButton } from "./NavigateButton";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { TaskSelectionCard, type TaskSelectionCardTask } from "./TaskSelectionCard";
import { ChatSectionBoundary } from "./ErrorBoundary";
import { ChatTabs, WorkOsPromptBar, collapseConsecutiveAssistantDuplicates, workOsChatCommands } from "./WorkOsChat";
import { ChatMarkdown } from "./ChatMarkdown";
import { AvatarThinking, type AvatarThinkingStage } from "./AvatarThinking";
import { AgendaReviewCard } from "./AgendaReviewCard";
import { deriveTaskContext, taskContextTitle } from "./avatarTaskContext";
import { agendaReceipt, applicableAnswers, unansweredQuestions, withAnswerRound, type AgendaAnswers } from "./avatarAgenda";
import type { PlanningInterpretation } from "./PlanningSession";
import { formatWorkOsDate } from "./dateFormat";
import { CompanionPet } from "./CompanionPet";
import {
  avatarPrompt, clearRecordedUpdatePrompt, collectNudges, isOnShift, mergeAvatarChatEntries, serializeAvatarChatEntry, shiftElapsedFraction, snoozeUntil,
  type AvatarStoredTurn, type CompanionDayFacts, type CompanionNudge,
} from "./avatarLogic";
import "./avatar.css";

type SessionInfo = { apiBase: string; token: string; organizationId: string; expiresAt: string };
type DaySyncState = "loading" | "ready" | "stale" | "error";

interface DayFacts extends CompanionDayFacts {
  loaded: boolean;
  personId: string | null;
  planIntent: string | null;
  timezone: string | null;
  displayName: string | null;
  niftySyncing: boolean;
  niftySyncError: string | null;
  taskOptions: Array<{ id: string; title: string; dueDate: string | null; completed: boolean }>;
  planStatus: string | null;
  planItemIds: string[];
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
const AVATAR_EXPANDED = { width: 400, height: 560 };
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
  const win = useMemo(() => getCurrentWindow(), []);
  const [expanded, setExpanded] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [facts, setFacts] = useState<DayFacts>({
    loaded: false, shiftDate: "", promptRequired: false, nextPromptAt: null, promptKind: null,
    shiftStartsAt: null, shiftEndsAt: null, sessionState: null, clockedInAt: null,
    clockedOutAt: null, pausedSeconds: 0, lastSubstantiveUpdateAt: null, employeeUpdates: 0, completedTasks: 0, openTasks: 0, eodSubmitted: false, personId: null, planIntent: null,
    timezone: null, displayName: null, niftySyncing: false, niftySyncError: null, taskOptions: [], planStatus: null, planItemIds: [],
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
  const [snoozeCount, setSnoozeCount] = useState<number>(() => {
    const s = readJson<{ count?: number; until?: number | null }>(SNOOZE_KEY, {});
    return typeof s.count === "number" ? s.count : 0;
  });
  const [missed, setMissed] = useState(false);
  const notifiedKeys = useRef<Set<string>>(new Set(readJson<string[]>(NOTIFIED_KEY, [])));
  const deliveryKeys = useRef<Set<string>>(new Set());
  const notificationPermission = useRef(false);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const dayRef = useRef<DayFacts>(facts);
  const dayLoadInFlight = useRef(false);
  const chatRef = useRef<ChatEntry[]>([]);
  const avatarToolsSig = useRef("");

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
        const monitor = await currentMonitor();
        if (monitor && typeof saved.x === "number" && typeof saved.y === "number") {
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
        planIntent: day?.plan?.freeform_intent ?? null,
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
          }))
          .slice(0, 200) : [],
        planStatus: typeof day?.plan?.status === "string" ? day.plan.status : null,
        planItemIds: Array.isArray(day?.plan?.items) ? day.plan.items
          .filter((item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string")
          .map((item: Record<string, unknown>) => String(item.id)) : [],
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
  // Tool calls raised in the main window appear here too. Adopt a fresh
  // review only when this chat has none active; otherwise merge filed
  // results into the matching local cards by stable key.
  const adoptSharedTools = useCallback(async () => {
    if (!avatarConversationScope) return;
    const shared = await secureState.pendingTools(avatarConversationScope).catch(() => null);
    if (!shared || shared.origin === "avatar") return;
    const signature = JSON.stringify(shared);
    if (avatarToolsSig.current === signature) return;
    avatarToolsSig.current = signature;
    setChat((current) => {
      const hasActive = current.some((entry) => entry.operations?.some((op) => isMutatingToolOp(op)
        && !(entry.toolResults ?? []).some((result) => toolCallKey(result.op) === toolCallKey(op))));
      if (!hasActive && shared.operations.length) {
        void toggleExpanded(true);
        return [...current, {
          id: `shared-${shared.updatedAt}`, role: "assistant" as const,
          text: shared.reply ?? "Tool calls shared from the main window.",
          operations: shared.operations, taskOptions: shared.taskOptions ?? [],
          toolResults: shared.results.length ? shared.results : undefined,
        }];
      }
      return current.map((entry) => {
        if (!entry.operations?.length) return entry;
        const fresh = shared.results.filter((result) => {
          const key = toolCallKey(result.op);
          return entry.operations!.some((op) => toolCallKey(op) === key)
            && !(entry.toolResults ?? []).some((existing) => toolCallKey(existing.op) === key);
        });
        return fresh.length ? { ...entry, toolResults: [...(entry.toolResults ?? []), ...fresh] } : entry;
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
          win.setFocus().catch(() => { /* best effort */ });
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
    try {
      const size = open ? AVATAR_EXPANDED : AVATAR_COLLAPSED;
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
      await win.setSize(new LogicalSize(size.width, size.height));
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
      const assistantEntry: ChatEntry = { id: `a-${Date.now()}`, role: "assistant", text: review.reply ?? "Here's what I understood.", operations, taskOptions: [], trace, toolResults: displayResults.length ? displayResults : undefined };
      setChat((current) => [...current, assistantEntry]);
      void shareAvatarTools({ input: text, reply: review.reply, operations, results: displayResults, taskOptions: [] });
    } catch (value) {
      setChat((current) => [...current, {
        id: `e-${Date.now()}`, role: "system",
        text: value instanceof Error ? value.message : "The assistant is unavailable — file this one from the main window.",
      }]);
    } finally {
      setThinkingTrace(null);
    }
  }, [input, thinkingTrace, filing, facts.planIntent, facts.shiftDate, chat]);

  const approveOperations = useCallback(async (entryId: string, operations: ProposedOperation[]) => {
    const enabled = operations.filter((op) => op.enabled);
    if (!enabled.length || filing) return;
    setFiling(true);
    try {
      const outcome = await fileApprovedOperations(enabled, {
        reviewProposal: (proposalId) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "accept" }), signal: AbortSignal.timeout(60_000) }),
      });
      const summary = [
        outcome.recorded ? `Recorded ${outcome.recorded}` : null,
        outcome.queued ? `${outcome.queued} queued` : null,
        outcome.failed.length ? `${outcome.failed.length} failed` : null,
      ].filter(Boolean).join(" · ") || "Nothing to record";
      setChat((current) => current.map((entry) => entry.id === entryId
        ? { ...entry, operations: entry.operations?.map((op) => ({ ...op, enabled: false })), toolResults: mergeToolResults(entry.toolResults ?? [], outcome.results), receipt: null }
        : entry));
      const filed = chatRef.current.find((entry) => entry.id === entryId);
      const entries = chatRef.current;
      const at = entries.findIndex((entry) => entry.id === entryId);
      const precedingUser = [...entries.slice(0, at < 0 ? entries.length : at)].reverse().find((entry) => entry.role === "user");
      void shareAvatarTools({
        input: precedingUser?.text ?? "",
        reply: filed?.text,
        operations: (filed?.operations ?? enabled).map((op) => ({ ...op, enabled: false })),
        results: mergeToolResults(filed?.toolResults ?? [], outcome.results),
        taskOptions: [],
      });
      if (outcome.recorded > 0) setFacts((current) => clearRecordedUpdatePrompt(current));
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
  }, [facts.shiftDate, facts.personId, filing, loadDay, toggleExpanded]);

  const proposeAvatarSelectedCompletions = useCallback((taskIds: string[]) => {
    if (!taskIds.length || filing) return;
    const titles = new Map(facts.taskOptions.map((task) => [task.id, task.title]));
    const operations = taskIds.map((taskId) => ({
      op: "complete_task" as const,
      statement: `Employee confirmed completion of ${titles.get(taskId) ?? "selected task"}.`,
      task_id: taskId,
      task_title: titles.get(taskId) ?? "selected task",
    }));
    setFiling(true);
    void apiRequest<{ proposals: Array<{ id: string; client_operation_index: number }> }>("/api/work-os/me/proposals", {
      method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ input_text: `Employee selected ${taskIds.length} task${taskIds.length === 1 ? "" : "s"} for completion.`, operations }),
    }).then(({ proposals }) => {
      const byIndex = new Map(proposals.map((proposal) => [proposal.client_operation_index, proposal.id]));
      const reviewed = operations.map((operation, index) => ({ op: operation.op, statement: operation.statement, taskId: operation.task_id, taskTitle: operation.task_title, proposalId: byIndex.get(index), enabled: true }));
      if (reviewed.some((operation) => !operation.proposalId)) throw new Error("The completion proposals were not saved.");
      setChat((current) => [...current, { id: `a-complete-${Date.now()}`, role: "assistant", text: "Review the selected task completions before anything changes.", operations: reviewed }]);
      void shareAvatarTools({ input: `Employee selected ${taskIds.length} task${taskIds.length === 1 ? "" : "s"} for completion.`, reply: "Review the selected task completions before anything changes.", operations: reviewed, results: [], taskOptions: [] });
    }).catch((value) => setChat((current) => [...current, { id: `completion-error-${Date.now()}`, role: "system", text: value instanceof Error ? value.message : "Could not create completion proposals." }]))
      .finally(() => setFiling(false));
  }, [facts.taskOptions, filing]);

  const denyOperation = useCallback((entryId: string, operation: ProposedOperation) => {
    if (!operation.proposalId) return;
    void apiRequest(`/api/work-os/proposals/${encodeURIComponent(operation.proposalId)}`, {
      method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "reject" }),
    }).then(() => {
      const denied: ToolCallResult = { op: operation, status: "denied", message: "Denied. This tool call will not run." };
      setChat((current) => current.map((entry) => entry.id === entryId ? {
        ...entry,
        operations: entry.operations?.map((op) => op.proposalId === operation.proposalId ? { ...op, enabled: false } : op),
        toolResults: [...(entry.toolResults ?? []), denied],
      } : entry));
      const deniedEntry = chatRef.current.find((entry) => entry.id === entryId);
      void shareAvatarTools({
        input: "",
        reply: deniedEntry?.text,
        operations: (deniedEntry?.operations ?? [operation]).map((op) => op.proposalId === operation.proposalId ? { ...op, enabled: false } : op),
        results: [...(deniedEntry?.toolResults ?? []), denied],
        taskOptions: [],
      });
    }).catch((value) => setChat((current) => [...current, { id: `deny-error-${Date.now()}`, role: "system", text: value instanceof Error ? value.message : "Could not deny this tool call." }]));
  }, []);

  const agendaDue = ["clocked_in", "active", "paused"].includes(facts.sessionState ?? "") && facts.planStatus !== "confirmed" && facts.loaded;
  /** Persists only an agenda that the planning service successfully built. */
  const confirmAgenda = useCallback(async (
    goal: string,
    interpretation: PlanningInterpretation | null,
    answers: AgendaAnswers,
    review: { rounds: number; answered: number; asked: number; reviewed: boolean },
  ) => {
    setFiling(true);
    try {
      if (interpretation) {
        if (!interpretation.buildId) throw new Error("Build the plan again before confirming it.");
        await apiRequest("/api/work-os/me/plan", {
          method: "PUT",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({
            shift_date: facts.shiftDate,
            confirm: true,
            build_id: interpretation.buildId,
            freeform_intent: goal,
            goal_provenance: "employee",
            focus_summary: interpretation.summary,
            interpretation_metadata: {
              model: "work-os-plan", promptVersion: "work-os-plan-v1", interpretedAt: new Date().toISOString(),
              clarificationCount: interpretation.clarifications.length,
              sourceContext: ["tasks", "carry_over", "previous_plan", "blockers", "recent_updates"],
              clarifications: interpretation.clarifications,
            },
            clarification_answers: answers,
          }),
        });
      } else throw new Error("Planning assistance must build a plan before it can be confirmed.");
      setInput("");
      setAgendaReview(null);
      setChat((current) => [...current, {
        id: `agenda-${Date.now()}`, role: "assistant",
          text: agendaReceipt(review),
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
          : message,
      }]);
    } finally { setFiling(false); }
  }, [facts.planItemIds, facts.shiftDate, loadDay]);
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
  const ringClass = !onShift ? "off" : facts.sessionState === "paused" ? "paused" : attentionDue ? "due" : "live";
  const petPose = attentionDue ? "alert" : !onShift ? "sleep" : facts.sessionState === "paused" ? "rest" : "focus";
  const lastEntry = chat[chat.length - 1];
  const statusText = !facts.loaded
    ? daySyncState === "error" ? "Today is syncing" : "Loading today…"
    : facts.niftySyncError ? "Nifty sync delayed"
      : facts.niftySyncing ? "Nifty syncing…"
        : daySyncState === "stale" ? "Showing last update"
          : formatWorkOsDate(facts.shiftDate);

  useEffect(() => {
    if (agendaDue && !expanded) void toggleExpanded(true);
  }, [agendaDue, expanded, toggleExpanded]);

  function clearAvatarConversation() {
    setChat([]);
    chatConversationSignature.current = "";
    if (avatarConversationScope) {
      void secureState.clearConversation(avatarConversationScope).then(() => emit("work-os://conversation-changed", { scope: avatarConversationScope })).catch(() => undefined);
      void secureState.clearPendingTools(avatarConversationScope).then(() => emit("work-os://pending-tools-changed", { scope: avatarConversationScope })).catch(() => undefined);
    }
  }

  useEffect(() => {
    chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, thinking]);

  if (connected === false) {
    return (
      <div className={`avatar-shell ${expanded ? "expanded" : ""}`}>
        {!expanded && (
          <div className="avatar-compact">
          <span className="avatar-drag-surface" data-tauri-drag-region title="Drag to move the companion" aria-hidden="true">⋮⋮</span>
          <button className="avatar-orb off" onClick={() => void toggleExpanded(true)} title="Connect Work OS from the main window">
            <svg viewBox="0 0 48 48" className="avatar-ring"><circle cx="24" cy="24" r="22" className="ring-track" /></svg>
            <CompanionPet pose="sleep" className="avatar-pet" />
          </button>
          </div>
        )}
        {expanded && (
          <div className="avatar-panel">
            <header className="avatar-head"><div className="avatar-drag-zone" data-tauri-drag-region><div className="avatar-title"><span className="avatar-head-mark" aria-hidden="true">WO</span><div><strong>Work OS companion</strong><small>Not connected</small></div></div><span aria-hidden="true">Move</span></div><button className="avatar-close" onClick={() => void toggleExpanded(false)} aria-label="Collapse companion">×</button></header>
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
        <span className="avatar-drag-surface" data-tauri-drag-region title="Drag to move the companion" aria-hidden="true">⋮⋮</span>
        <button
          className={`avatar-orb ${ringClass} ${attentionDue ? "pulse" : ""}${hop ? " hop-once" : ""}`}
          onClick={() => void toggleExpanded(true)}
          title={onShift ? `${label} into your scheduled day · ${remaining}` : "Work OS companion"}
        >
          <svg viewBox="0 0 48 48" className="avatar-ring">
            <circle cx="24" cy="24" r="22" className="ring-track" />
            <circle cx="24" cy="24" r="22" className="ring-fill" strokeDasharray={138.2} strokeDashoffset={138.2 * (1 - fraction)} />
          </svg>
          <CompanionPet pose={petPose} className="avatar-pet" />
          {showBadge && <span className="avatar-badge" />}
        </button>
        {onShift && <span className="avatar-day-time" aria-hidden="true">{remaining}</span>}
        </div>
      )}
      {expanded && (
        <div className="avatar-panel">
          <header className="avatar-head">
            <div className="avatar-drag-zone" data-tauri-drag-region><div className="avatar-title"><span className="avatar-head-mark" aria-hidden="true">WO</span><div><strong>{onShift ? `On shift · ${label}` : facts.sessionState === "paused" ? "Paused" : "Off shift"}</strong><small aria-live="polite">{statusText}</small></div></div><span aria-hidden="true">Move</span></div>
            {daySyncState !== "ready" && <button className="avatar-retry" onClick={() => { setDaySyncState("loading"); void loadDay(); }}>Retry</button>}
            {chat.length > 0 && <button className="avatar-clear" onClick={clearAvatarConversation} aria-label="Clear conversation" title="Clear conversation">New</button>}
            <button className="avatar-close" onClick={() => void toggleExpanded(false)} aria-label="Collapse companion">×</button>
          </header>
          <div className="avatar-tabs">
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
          {attentionDue && <section className={`avatar-context ${contextualPrompt.kind}`} aria-label={contextualPrompt.heading}><strong>{contextualPrompt.heading}</strong><small>{contextualPrompt.body}</small>{contextualPrompt.action === "open_eod" && <button onClick={() => void openEodReview()}>Open EOD review</button>}</section>}
          {avatarTab === "tasks" ? (
          <div className="avatar-chat workos-thread" ref={chatScroll}>
              <TaskSelectionCard
                title="Open tasks"
                status={facts.loaded ? "ready" : "loading"}
                tasks={facts.taskOptions
                  .filter((task) => !task.completed)
                  .map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, state: "pending" }))}
                onMarkSelectedDone={proposeAvatarSelectedCompletions}
                degraded={daySyncState === "stale"}
                emptyTitle="No open tasks"
                emptyMessage="Tasks waiting to be completed will appear here."
              />
            </div>
          ) : (<>
          {(contextualPrompt.kind === "check_in" || contextualPrompt.kind === "agenda") && taskContext && (taskContext.pendingCount + taskContext.overdueCount) > 0 && (
            <div className="avatar-task-context">
              <TaskSelectionCard
                dense
                maxHeight={220}
                title={taskContextTitle(taskContext)}
                tasks={taskContext.visible.map((task) => ({ id: task.id, title: task.title, dueDate: task.dueDate, state: task.overdue ? "overdue" : "pending" }))}
                onMarkSelectedDone={proposeAvatarSelectedCompletions}
                degraded={daySyncState === "stale"}
                emptyTitle="No open tasks"
                emptyMessage="Tasks waiting to be completed will appear here."
              />
            </div>
          )}
          <div className="avatar-chat" ref={chatScroll}>
            {!chat.length && (
              <div className="chat-entry assistant"><p>{attentionDue
                ? contextualPrompt.body
                : "Share an update, or tell me to create, complete, or block tasks."}</p></div>
            )}
            {collapseConsecutiveAssistantDuplicates(chat).map((entry) => (
              <div key={entry.id} className={`chat-entry ${entry.role}`}>
                <ChatSectionBoundary label="avatar chat message">
                {entry.role === "user" ? <ChatMarkdown text={entry.text} />
                  : entry.role === "system" ? <div className="chat-system"><ChatMarkdown text={entry.text} /></div>
                    : entry.receipt ? <p className="chat-receipt">✓ {entry.receipt}</p>
                      : <>
                        <ChatMarkdown text={entry.text} />
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
                          return <TaskSelectionCard key={`${result.op.op}-${resultIndex}`} title={selection.view === "overdue" ? "Overdue tasks" : "Pending tasks"} tasks={tasks} onMarkSelectedDone={proposeAvatarSelectedCompletions} maxHeight={250} emptyTitle={selection.view === "overdue" ? "No overdue tasks" : "No pending tasks"} emptyMessage={selection.view === "overdue" ? "Nothing is past its due date." : "Tasks waiting to be completed will appear here."} />;
                        })}
                        {entry.operations && (
                          <div className="chat-operations">
                            {entry.operations.map((op, index) => {
                              const result = entry.toolResults?.find((item) => item.op === op || (op.proposalId !== undefined && item.op.proposalId === op.proposalId));
                              if (op.op === "navigate_to_page" && op.page) return <NavigateButton key={index} page={op.page} statement={op.statement} onNavigate={(page) => void navigateToPage(page)} />;
                              if (isDisplayToolOp(op)) return result?.status === "failed" ? <p key={index} className="tool-display-error">{result.message}</p> : null;
                              return (
                              <ToolApprovalCard key={index} op={op} context={{ shiftDate: facts.shiftDate || null, personId: facts.personId, promptKind: "optional" }} result={result} index={index} total={entry.operations!.length} onToggle={() => {
                                if (entry.toolResults?.some((item) => item.op === op)) return;
                                  const next = entry.operations!.map((candidate, i) => i === index ? { ...candidate, enabled: !candidate.enabled } : candidate);
                                  setChat((current) => current.map((e) => e.id === entry.id ? { ...e, operations: next } : e));
                                }} onDeny={() => denyOperation(entry.id, op)} />
                              );
                            })}
                            <button className="op-approve" disabled={filing || !entry.operations.some((op) => op.enabled && !entry.toolResults?.some((item) => item.op === op))}
                              onClick={() => void approveOperations(entry.id, entry.operations!)}>
                              {filing ? "Filing…" : `Approve & record ${entry.operations.filter((op) => op.enabled && !entry.toolResults?.some((item) => item.op === op)).length} tool call${entry.operations.filter((op) => op.enabled && !entry.toolResults?.some((item) => item.op === op)).length === 1 ? "" : "s"}`}
                            </button>
                          </div>
                        )}
                      </>
                }
                </ChatSectionBoundary>
              </div>
            ))}
            {thinkingTrace && <div className="chat-entry assistant"><AvatarThinking stages={thinkingTrace.stages} active={thinkingTrace.active} startedAt={thinkingTrace.startedAt} activeLabel={agendaDue ? "Reviewing your agenda" : "Thinking"} /></div>}
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
          </div>
          </>)}
          {contextualPrompt.action !== "open_eod" && <footer className="avatar-composer">
            <WorkOsPromptBar
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
