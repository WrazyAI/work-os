import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { secureState, type WorkOsConversationTurn } from "./vault";
import { apiRequest, ApiRequestError } from "./api";
import { normalizeInterpretation, fileApprovedOperations, type ProposedOperation, type ToolCallResult } from "./interpretation";
import { ToolApprovalCard } from "./ToolApprovalCard";
import { formatWorkOsDate } from "./dateFormat";
import { CompanionPet } from "./CompanionPet";
import {
  avatarPrompt, clearRecordedUpdatePrompt, collectNudges, isOnShift, shiftElapsedFraction, snoozeUntil,
  type CompanionDayFacts, type CompanionNudge,
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
  taskOptions: Array<{ id: string; title: string }>;
  planStatus: string | null;
  planItemIds: string[];
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  operations?: ProposedOperation[];
  toolResults?: ToolCallResult[];
  taskOptions?: Array<{ id: string; title: string }>;
  receipt?: string | null;
  createdAt?: string;
}

const AVATAR_COLLAPSED = { width: 164, height: 188 };
const AVATAR_EXPANDED = { width: 380, height: 560 };
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
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
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

  useEffect(() => { dayRef.current = facts; }, [facts]);

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
  const loadDay = useCallback(async () => {
    if (dayLoadInFlight.current) return;
    dayLoadInFlight.current = true;
    try {
      const day = await apiRequest<Record<string, any>>("/api/work-os/me/day?compact=true", { signal: AbortSignal.timeout(35_000) });
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
          .map((task: Record<string, unknown>) => ({ id: String(task.id), title: typeof task.title === "string" ? task.title : "Untitled task" }))
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
    void loadDay();
    const poll = setInterval(() => { void loadDay(); }, DAY_POLL_MS);
    return () => clearInterval(poll);
  }, [loadDay]);

  // The main and companion windows own separate React trees. Refresh promptly
  // after a main-window write or sign-in instead of waiting for the minute poll.
  useEffect(() => {
    let unlistenDay: (() => void) | undefined;
    let unlistenSession: (() => void) | undefined;
    void listen("work-os://main-day-changed", () => { void loadDay(); }).then((fn) => { unlistenDay = fn; }).catch(() => undefined);
    void listen("work-os://main-session-changed", () => {
      void secureState.session().then((session) => {
        setDesktopSession(session);
        setConnected(!!session && new Date(session.expiresAt).getTime() > Date.now());
        void loadDay();
      }).catch(() => undefined);
    }).then((fn) => { unlistenSession = fn; }).catch(() => undefined);
    return () => { unlistenDay?.(); unlistenSession?.(); };
  }, [loadDay]);

  const avatarConversationScope = desktopSession?.organizationId && facts.personId
    ? `avatar:${desktopSession.organizationId}:${facts.personId}`
    : null;
  useEffect(() => {
    let cancelled = false;
    setLoadedChatConversation(null);
    setChat([]);
    if (!avatarConversationScope) return () => { cancelled = true; };
    void secureState.conversation(avatarConversationScope).then((turns) => {
      if (!cancelled) {
        setChat(turns.map((turn) => ({ ...turn, role: turn.role as ChatEntry["role"] })));
        setLoadedChatConversation(avatarConversationScope);
      }
    }).catch(() => {
      if (!cancelled) setLoadedChatConversation(avatarConversationScope);
    });
    return () => { cancelled = true; };
  }, [avatarConversationScope]);
  useEffect(() => {
    if (!avatarConversationScope || loadedChatConversation !== avatarConversationScope) return;
    const turns: WorkOsConversationTurn[] = chat
      .filter((entry): entry is ChatEntry & { role: "user" | "assistant" } => entry.role === "user" || entry.role === "assistant")
      .map((entry) => ({ id: entry.id, role: entry.role, text: entry.text, ...(entry.receipt ? { meta: entry.receipt } : {}), createdAt: entry.createdAt ?? new Date().toISOString() }));
    void secureState.saveConversation(avatarConversationScope, turns);
  }, [avatarConversationScope, chat, loadedChatConversation]);

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
    if (!text || thinking || filing) return;
    setInput("");
    setChat((current) => [...current, { id: `u-${Date.now()}`, role: "user", text }]);
    setThinking(true);
    try {
      const result = await apiRequest<{ interpretation: unknown }>("/api/work-os/me/interpret", {
        method: "POST",
        body: JSON.stringify({ input: text, planIntent: facts.planIntent || null, today: facts.shiftDate || null, history: chat.filter((entry) => entry.role === "user" || entry.role === "assistant").slice(-24).map(({ role, text: turnText }) => ({ role, text: turnText })) }),
      });
      const review = normalizeInterpretation(result.interpretation, text, facts.taskOptions);
      if (!review) throw new Error("The assistant couldn't map that to work yet.");
      if (!review.operations.length) {
        setChat((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", text: review.reply ?? "Noted." }]);
        return;
      }
      const proposals = await apiRequest<{ proposals: Array<{ id: string; client_operation_index: number }> }>("/api/work-os/me/proposals", {
        method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ input_text: text, operations: review.operations.map((op) => ({ op: op.op, statement: op.statement, task_id: op.taskId, task_title: op.taskTitle })) }),
      });
      const byIndex = new Map(proposals.proposals.map((proposal) => [proposal.client_operation_index, proposal.id]));
      setChat((current) => [
        ...current,
        { id: `a-${Date.now()}`, role: "assistant", text: review.reply ?? "Here's what I understood.", operations: review.operations.map((op, index) => ({ ...op, proposalId: byIndex.get(index) })), taskOptions: [] },
      ]);
    } catch (value) {
      setChat((current) => [...current, {
        id: `e-${Date.now()}`, role: "system",
        text: value instanceof Error ? value.message : "The assistant is unavailable — file this one from the main window.",
      }]);
    } finally {
      setThinking(false);
    }
  }, [input, thinking, filing, facts.planIntent, facts.shiftDate]);

  const approveOperations = useCallback(async (entryId: string, operations: ProposedOperation[]) => {
    const enabled = operations.filter((op) => op.enabled);
    if (!enabled.length || filing) return;
    setFiling(true);
    try {
      const outcome = await fileApprovedOperations(enabled, {
        reviewProposal: (proposalId) => apiRequest(`/api/work-os/proposals/${encodeURIComponent(proposalId)}`, { method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "accept" }) }),
      });
      const summary = [
        outcome.recorded ? `Recorded ${outcome.recorded}` : null,
        outcome.queued ? `${outcome.queued} queued` : null,
        outcome.failed.length ? `${outcome.failed.length} failed` : null,
      ].filter(Boolean).join(" · ") || "Nothing to record";
      setChat((current) => current.map((entry) => entry.id === entryId
        ? { ...entry, operations: entry.operations?.map((op) => ({ ...op, enabled: false })), toolResults: outcome.results, receipt: null }
        : entry));
      if (outcome.recorded > 0) setFacts((current) => clearRecordedUpdatePrompt(current));
      writeJson(SNOOZE_KEY, { count: 0, until: null });
      setSnoozeCount(0);
      setMissed(false);
      await loadDay();
      void emit("work-os://avatar-day-changed");
      setTimeout(() => { void toggleExpanded(false); }, 2_200);
    } catch (value) {
      setChat((current) => [...current, {
        id: `e-${Date.now()}`, role: "system",
        text: value instanceof Error ? value.message : "Filing failed — try again from the main window.",
      }]);
    } finally {
      setFiling(false);
    }
  }, [facts.shiftDate, facts.personId, filing, loadDay, toggleExpanded]);

  const denyOperation = useCallback((entryId: string, operation: ProposedOperation) => {
    if (!operation.proposalId) return;
    void apiRequest(`/api/work-os/proposals/${encodeURIComponent(operation.proposalId)}`, {
      method: "PATCH", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ decision: "reject" }),
    }).then(() => setChat((current) => current.map((entry) => entry.id === entryId ? {
      ...entry,
      operations: entry.operations?.map((op) => op.proposalId === operation.proposalId ? { ...op, enabled: false } : op),
      toolResults: [...(entry.toolResults ?? []), { op: operation, status: "denied", message: "Denied. This tool call will not run." }],
    } : entry))).catch((value) => setChat((current) => [...current, { id: `deny-error-${Date.now()}`, role: "system", text: value instanceof Error ? value.message : "Could not deny this tool call." }]));
  }, []);

  const agendaDue = ["clocked_in", "active", "paused"].includes(facts.sessionState ?? "") && facts.planStatus !== "confirmed" && facts.loaded;
  const submitAgenda = useCallback(async () => {
    const goal = input.trim();
    if (!goal || filing) return;
    setFiling(true);
    try {
      await apiRequest("/api/work-os/me/plan", {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ confirm: true, freeform_intent: goal, item_ids: facts.planItemIds, deferred_ids: [] }),
      });
      setInput("");
      setChat((current) => [...current, { id: `agenda-${Date.now()}`, role: "assistant", text: "Today's agenda is set. I’ll check in again after you’ve had time to make progress.", receipt: "Agenda confirmed" }]);
      await loadDay();
      void emit("work-os://avatar-day-changed");
    } catch (value) {
      setChat((current) => [...current, { id: `agenda-error-${Date.now()}`, role: "system", text: value instanceof Error ? value.message : "Your agenda could not be confirmed." }]);
    } finally { setFiling(false); }
  }, [facts.planItemIds, filing, input, loadDay]);

  // ── Derived render state ──
  const contextualPrompt = useMemo(() => avatarPrompt(facts, now), [facts, now]);
  const attentionDue = ["agenda", "check_in", "eod"].includes(contextualPrompt.kind);
  const showBadge = contextualPrompt.kind === "eod" || (contextualPrompt.kind === "check_in" && !missed);
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
    if (avatarConversationScope) void secureState.clearConversation(avatarConversationScope);
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
          className={`avatar-orb ${ringClass} ${attentionDue ? "pulse" : ""}`}
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
          {attentionDue && <section className={`avatar-context ${contextualPrompt.kind}`} aria-label={contextualPrompt.heading}><strong>{contextualPrompt.heading}</strong><small>{contextualPrompt.body}</small>{contextualPrompt.action === "open_eod" && <button onClick={() => void openEodReview()}>Open EOD review</button>}</section>}
          <div className="avatar-chat" ref={chatScroll}>
            {!chat.length && (
              <div className="chat-entry assistant"><p>{attentionDue
                ? contextualPrompt.body
                : "Share an update, or tell me to create, complete, or block tasks."}</p></div>
            )}
            {chat.map((entry) => (
              <div key={entry.id} className={`chat-entry ${entry.role}`}>
                {entry.role === "user" ? <p>{entry.text}</p>
                  : entry.role === "system" ? <p className="chat-system">{entry.text}</p>
                    : entry.receipt ? <p className="chat-receipt">✓ {entry.receipt}</p>
                      : <>
                        <p>{entry.text}</p>
                        {entry.operations && (
                          <div className="chat-operations">
                            {entry.operations.map((op, index) => (
                              <ToolApprovalCard key={index} op={op} context={{ shiftDate: facts.shiftDate || null, personId: facts.personId, promptKind: "optional" }} result={entry.toolResults?.find((item) => item.op.proposalId === op.proposalId)} onToggle={() => {
                                if (entry.toolResults?.some((item) => item.op.proposalId === op.proposalId)) return;
                                  const next = entry.operations!.map((candidate, i) => i === index ? { ...candidate, enabled: !candidate.enabled } : candidate);
                                  setChat((current) => current.map((e) => e.id === entry.id ? { ...e, operations: next } : e));
                                }} onDeny={() => denyOperation(entry.id, op)} />
                            ))}
                            <button className="op-approve" disabled={filing || !!entry.toolResults || !entry.operations.some((op) => op.enabled)}
                              onClick={() => void approveOperations(entry.id, entry.operations!)}>
                              {filing ? "Filing…" : `Approve & record ${entry.operations.filter((op) => op.enabled).length} tool call${entry.operations.filter((op) => op.enabled).length === 1 ? "" : "s"}`}
                            </button>
                          </div>
                        )}
                      </>
                }
              </div>
            ))}
            {thinking && <div className="chat-entry assistant"><p className="chat-thinking">Thinking…</p></div>}
          </div>
          {contextualPrompt.action !== "open_eod" && <footer className="avatar-composer">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void (agendaDue ? submitAgenda() : sendUpdate()); } }}
              placeholder={agendaDue ? "Describe your goal for today…" : contextualPrompt.kind === "check_in" && !missed ? "Record what changed since your last update…" : "Share an update or instruct the assistant…"}
              autoFocus
              maxLength={4000}
            />
            <button className="avatar-send" disabled={!input.trim() || thinking || filing} onClick={() => void (agendaDue ? submitAgenda() : sendUpdate())} aria-label={agendaDue ? "Confirm today’s agenda" : "Send update"}>{agendaDue ? "✓" : "↑"}</button>
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
