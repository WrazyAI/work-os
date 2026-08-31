import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow, currentMonitor, LogicalSize, LogicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { secureState } from "./vault";
import { apiRequest, ApiRequestError } from "./api";
import { normalizeInterpretation, fileApprovedOperations, operationLabel, type ProposedOperation } from "./interpretation";
import { formatWorkOsDate } from "./dateFormat";
import {
  collectNudges, isOnShift, shiftElapsedFraction, snoozeUntil,
  type CompanionDayFacts, type CompanionNudge,
} from "./avatarLogic";
import "./avatar.css";

type SessionInfo = { apiBase: string; token: string; organizationId: string; expiresAt: string };

interface DayFacts extends CompanionDayFacts {
  loaded: boolean;
  personId: string | null;
  planIntent: string | null;
  timezone: string | null;
  displayName: string | null;
}

interface ChatEntry {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  operations?: ProposedOperation[];
  taskOptions?: Array<{ id: string; title: string }>;
  receipt?: string | null;
}

const AVATAR_COLLAPSED = { width: 76, height: 76 };
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
      // command; hourly nudges open the companion, clock-in/EOD open the app.
      void invoke("notify_focus", {
        title: nudge.title,
        body: nudge.body,
        target: nudge.kind === "hourly" ? "avatar" : "main",
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
    loaded: false, shiftDate: "", promptRequired: false, nextPromptAt: null,
    shiftStartsAt: null, shiftEndsAt: null, sessionState: null, clockedInAt: null,
    clockedOutAt: null, pausedSeconds: 0, personId: null, planIntent: null,
    timezone: null, displayName: null,
  });
  const [now, setNow] = useState(() => Date.now());
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [filing, setFiling] = useState(false);
  const [snoozeCount, setSnoozeCount] = useState<number>(() => {
    const s = readJson<{ count?: number; until?: number | null }>(SNOOZE_KEY, {});
    return typeof s.count === "number" ? s.count : 0;
  });
  const [missed, setMissed] = useState(false);
  const notifiedKeys = useRef<Set<string>>(new Set(readJson<string[]>(NOTIFIED_KEY, [])));
  const notificationPermission = useRef(false);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const dayRef = useRef<DayFacts>(facts);

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
    try {
      const day = await apiRequest<Record<string, any>>("/api/work-os/me/day", { method: "POST", body: JSON.stringify({}) }).catch(async () => {
        // The day route may be GET-only in some deployments; try GET before giving up.
        return apiRequest<Record<string, any>>("/api/work-os/me/day");
      });
      const session = (day?.session ?? {}) as Record<string, any>;
      const prompt = (day?.prompt ?? {}) as Record<string, any>;
      setFacts({
        loaded: true,
        shiftDate: String(day?.shiftDate ?? ""),
        promptRequired: prompt.required === true,
        nextPromptAt: typeof prompt.nextPromptAt === "string" ? prompt.nextPromptAt : null,
        shiftStartsAt: day?.shift?.startsAt ?? session.scheduled_starts_at ?? null,
        shiftEndsAt: day?.shift?.endsAt ?? session.scheduled_ends_at ?? null,
        sessionState: session.state ?? null,
        clockedInAt: session.clocked_in_at ?? null,
        clockedOutAt: session.clocked_out_at ?? null,
        pausedSeconds: Number(session.paused_seconds ?? 0) || 0,
        personId: day?.access?.personId ?? null,
        planIntent: day?.plan?.freeform_intent ?? null,
        timezone: day?.shift?.timezone ?? null,
        displayName: day?.access?.displayName ?? null,
      });
      setConnected(true);
    } catch (value) {
      if (value instanceof ApiRequestError && value.status === 401) setConnected(false);
      // transient failures keep the last known facts
    }
  }, []);

  useEffect(() => {
    void loadDay();
    const poll = setInterval(() => { void loadDay(); }, DAY_POLL_MS);
    return () => clearInterval(poll);
  }, [loadDay]);

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
      notifiedKeys.current.add(nudge.key);
      writeJson(NOTIFIED_KEY, [...notifiedKeys.current].slice(-80));
      fireNotification(nudge, notificationPermission.current);
      if (nudge.kind === "hourly") {
        setMissed(false);
        setExpanded((current) => {
          if (!current) void toggleExpanded(true);
          return true;
        });
        win.setFocus().catch(() => { /* best effort */ });
      }
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
        body: JSON.stringify({ input: text, planIntent: facts.planIntent || null, today: facts.shiftDate || null }),
      });
      const review = normalizeInterpretation(result.interpretation, text, []);
      if (!review) throw new Error("The assistant couldn't map that to work yet.");
      if (!review.operations.length) {
        setChat((current) => [...current, { id: `a-${Date.now()}`, role: "assistant", text: review.reply ?? "Noted." }]);
        return;
      }
      setChat((current) => [
        ...current,
        { id: `a-${Date.now()}`, role: "assistant", text: review.reply ?? "Here's what I understood.", operations: review.operations, taskOptions: [] },
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
        shiftDate: facts.shiftDate || null,
        personId: facts.personId,
        promptKind: "optional",
      }, {
        completeTask: (taskId, completed) => apiRequest(`/api/work-os/me/tasks/${encodeURIComponent(taskId)}`, { method: "PATCH", body: JSON.stringify({ completed }) }),
        createTask: (taskInput) => apiRequest("/api/work-os/me/tasks", { method: "POST", body: JSON.stringify({ name: taskInput.name, description: taskInput.description, due_date: taskInput.dueDate }) }),
        fileCheckIn: (checkIn) => apiRequest("/api/work-os/check-ins", { method: "POST", body: JSON.stringify({ source: "desktop", kind: checkIn.kind, update_kind: checkIn.updateKind, input_text: checkIn.text }) }),
      });
      const summary = [
        outcome.recorded ? `Recorded ${outcome.recorded}` : null,
        outcome.queued ? `${outcome.queued} queued` : null,
        outcome.failed.length ? `${outcome.failed.length} failed` : null,
      ].filter(Boolean).join(" · ") || "Nothing to record";
      setChat((current) => current.map((entry) => entry.id === entryId
        ? { ...entry, operations: undefined, receipt: summary }
        : entry));
      writeJson(SNOOZE_KEY, { count: 0, until: null });
      setSnoozeCount(0);
      setMissed(false);
      void loadDay();
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

  // ── Derived render state ──
  const onShift = isOnShift(facts, now);
  const { fraction, label } = shiftElapsedFraction(facts, now);
  const ringClass = !onShift ? "off" : facts.sessionState === "paused" ? "paused" : facts.promptRequired ? "due" : "live";
  const lastEntry = chat[chat.length - 1];

  useEffect(() => {
    chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, thinking]);

  if (connected === false) {
    return (
      <div className={`avatar-shell ${expanded ? "expanded" : ""}`}>
        {!expanded && (
          <button className="avatar-orb off" onClick={() => void toggleExpanded(true)} title="Connect Work OS from the main window">
            <svg viewBox="0 0 48 48" className="avatar-ring"><circle cx="24" cy="24" r="22" className="ring-track" /></svg>
            <span className="avatar-face">zZ</span>
          </button>
        )}
        {expanded && (
          <div className="avatar-panel">
            <header className="avatar-head"><div><strong>Work OS companion</strong><small>Not connected</small></div><button className="avatar-close" onClick={() => void toggleExpanded(false)} aria-label="Collapse companion">×</button></header>
            <div className="avatar-chat"><div className="chat-entry system"><p>Open the Work OS main window and connect this device — this companion will come alive on its own once you're in.</p></div></div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`avatar-shell ${expanded ? "expanded" : ""}`}>
      {!expanded && (
        <button
          className={`avatar-orb ${ringClass} ${facts.promptRequired ? "pulse" : ""}`}
          data-tauri-drag-region
          onClick={() => void toggleExpanded(true)}
          title={onShift ? `On shift · ${label}` : "Work OS companion"}
        >
          <svg viewBox="0 0 48 48" className="avatar-ring">
            <circle cx="24" cy="24" r="22" className="ring-track" />
            <circle cx="24" cy="24" r="22" className="ring-fill" strokeDasharray={138.2} strokeDashoffset={138.2 * (1 - fraction)} />
          </svg>
          <span className="avatar-face">{onShift ? label || "0m" : "◦"}</span>
          {facts.promptRequired && !missed && <span className="avatar-badge" />}
        </button>
      )}
      {expanded && (
        <div className="avatar-panel">
          <header className="avatar-head" data-tauri-drag-region>
            <div>
              <strong>{onShift ? `On shift · ${label}` : facts.sessionState === "paused" ? "Paused" : "Off shift"}</strong>
              <small>{facts.loaded ? formatWorkOsDate(facts.shiftDate) : "Syncing…"}</small>
            </div>
            <button className="avatar-close" onClick={() => void toggleExpanded(false)} aria-label="Collapse companion">×</button>
          </header>
          <div className="avatar-chat" ref={chatScroll}>
            {!chat.length && (
              <div className="chat-entry assistant"><p>{facts.promptRequired
                ? "Hourly check-in — what have you been working on?"
                : "Hey! Share an update, or tell me to create, complete, or block tasks."}</p></div>
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
                              <label key={index} className={op.enabled ? "op-row" : "op-row off"}>
                                <input type="checkbox" checked={op.enabled} onChange={() => {
                                  const next = entry.operations!.map((candidate, i) => i === index ? { ...candidate, enabled: !candidate.enabled } : candidate);
                                  setChat((current) => current.map((e) => e.id === entry.id ? { ...e, operations: next } : e));
                                }} />
                                <span>{operationLabel(op.op)} {op.taskTitle ?? ""}</span>
                              </label>
                            ))}
                            <button className="op-approve" disabled={filing || !entry.operations.some((op) => op.enabled)}
                              onClick={() => void approveOperations(entry.id, entry.operations!)}>
                              {filing ? "Filing…" : `Approve & record ${entry.operations.filter((op) => op.enabled).length}`}
                            </button>
                          </div>
                        )}
                      </>
                }
              </div>
            ))}
            {thinking && <div className="chat-entry assistant"><p className="chat-thinking">Thinking…</p></div>}
          </div>
          <footer className="avatar-composer">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendUpdate(); } }}
              placeholder={facts.promptRequired && !missed ? "Hourly update — what's happening?" : "Share an update or instruct the assistant…"}
              autoFocus
              maxLength={4000}
            />
            <button className="avatar-send" disabled={!input.trim() || thinking || filing} onClick={() => void sendUpdate()} aria-label="Send update">↑</button>
          </footer>
          {facts.promptRequired && !missed && !lastEntry?.receipt && (
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
