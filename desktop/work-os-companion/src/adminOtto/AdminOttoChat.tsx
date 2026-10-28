import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { X } from "lucide-react";
import type {
  AdminRead,
  InboxPage,
  OttoScope,
  ReviewedRecap,
  TaskCard,
  WorkRecord,
} from "../../../../src/modules/work-os/admin-otto/contracts";
import { ChatTabs, ChatTurn, ConversationSurface, WorkOsPromptBar, type ChatTab } from "../WorkOsChat";
import type { VoiceInput } from "../chat/voiceInput";
import { useVoiceInput } from "../chat/voiceInput";
import { createAdminAudioInterlock } from "./audioInterlock";
import { onOttoAudioStop, requestOttoAudio, type OttoAudioLease } from "./audioOwner";
import { sameOttoScope } from "./mode";
import { adminEscapeAction, adminRecapOpenFocus, chooseAdminRecapReturnFocus, type AdminFocusTarget } from "./adminFocus";
import { fetchAdminOttoInbox, fetchAdminOttoThread, sendAdminOttoChat } from "./api";
import { createAdminOttoEntryController, type AdminOttoEntryController, type AdminOttoEntryRecovery, type AdminOttoEntryTransport } from "./chatEntry";import { AdminRecapInbox } from "./AdminRecapInbox";
import { AdminRecapView, useReducedMotion, type AdminRecapPlayback } from "./AdminRecapView";
import { RecapPrompter } from "../RecapPrompter";
import { adminCalendarDate, adminRecapDate, adminReviewStatusLabel } from "./labels";
import { safeAdminRecordHref } from "./recordLinks";

type AdminTab = "chat" | "recaps";

export type AdminArrivalView = {
  count: number;
  unread: number;
  eventIds: string[];
  recap: ReviewedRecap | null;
};

export type AdminOttoSurfaceSnapshot = {
  tab: AdminTab;
  selectedIntervalId: string | null;
  arrival: { count: number; unread: number };
  /** Monotonic requests the surface could use to move. An arrival never bumps
   * these; only an explicit control does. */
  scrollRequest: number;
  listenRequest: number;
  focusRequest: number;
};

export type AdminOttoSurfaceController = {
  snapshot: () => AdminOttoSurfaceSnapshot;
  subscribe: (listener: () => void) => () => void;
  selectTab: (tab: AdminTab) => void;
  openRecap: (intervalId: string) => void;
  closeRecap: () => void;
  receiveArrival: (arrival: { count: number; unread: number }) => void;
};

/** A real New chat reset: identity and draft are cleared synchronously, any
 * in-flight send/hydration is aborted, and a later onConversation cannot write
 * the old thread back. Also used by the regression test. */
export function resetAdminOttoConversation(input: {
  controller: ReturnType<typeof createAdminOttoEntryController>;
  surface: AdminOttoSurfaceController;
  conversationRef: { current: string | null };
  scope: OttoScope;
}) {
  input.conversationRef.current = null;
  input.controller.reset(input.scope, null);
  input.surface.selectTab("chat");
  input.surface.closeRecap();
}

/** Report only a conversation that exists in the live controller.
 *
 * The writeback effect can run with a stale render snapshot: New chat changes
 * `conversationId` and the host callback identity in one render, before the
 * reset has been observed by `useSyncExternalStore`. Reading the live snapshot
 * here makes the reset the source of truth, so a stale old id cannot be written
 * back to App and reopened. */
export function syncAdminOttoConversation(input: {
  controller: Pick<AdminOttoEntryController, "snapshot">;
  conversationRef: { current: string | null };
  onConversation?: (conversationId: string) => void;
  /** The value captured by the render that triggered this effect. It is
   * accepted only so the stale-render regression can pass the exact value the
   * old effect would have written; the live controller always wins. */
  renderConversationId?: string | null;
}): boolean {
  const liveConversationId = input.controller.snapshot().conversationId;
  if (!liveConversationId || liveConversationId === input.conversationRef.current) return false;
  input.conversationRef.current = liveConversationId;
  input.onConversation?.(liveConversationId);
  return true;
}

/** UI state that belongs to the admin surface, separate from data loading.
 * A grouped arrival only updates its count: it never switches tabs, selects a
 * recap, starts playback, requests scroll, or moves focus. */
export function createAdminOttoSurfaceController(initialTab: AdminTab = "chat"): AdminOttoSurfaceController {
  let state: AdminOttoSurfaceSnapshot = {
    tab: initialTab,
    selectedIntervalId: null,
    arrival: { count: 0, unread: 0 },
    scrollRequest: 0,
    listenRequest: 0,
    focusRequest: 0,
  };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<AdminOttoSurfaceSnapshot>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  return {
    snapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    selectTab: (tab) => { if (tab !== state.tab) set({ tab }); },
    openRecap: (intervalId) => set({ selectedIntervalId: intervalId, tab: "recaps" }),
    closeRecap: () => set({ selectedIntervalId: null }),
    receiveArrival: (arrival) => set({
      arrival: { count: Math.max(0, arrival.count), unread: Math.max(0, arrival.unread) },
    }),
  };
}

/** Model text is shown as plain text. Only the read catalog's record fields
 * become anchors, so a model cannot smuggle a destination into the thread. */
export function AdminReplyText({ text, className }: { text: string; className?: string }) {
  return <p className={`admin-otto-reply${className ? ` ${className}` : ""}`}>{text}</p>;
}

function safeCount(value: number): string {
  return Number.isFinite(value) ? String(Math.max(0, Math.trunc(value))) : "0";
}

function assigneeNames(task: TaskCard): string {
  if (!task.assignees.length) return "Unassigned";
  return task.assignees.map((person) => person.displayName || "Unnamed teammate").join(", ");
}

function RecordLink({ url, children, onOpenRecord }: { url: string; children: ReactNode; onOpenRecord: (url: string) => void }) {
  const safe = safeAdminRecordHref(url);
  if (!safe) return <span className="admin-otto-unavailable">{children}</span>;
  return (
    <a
      href={safe}
      className="admin-otto-record-link"
      onClick={(event) => {
        event.preventDefault();
        onOpenRecord(safe);
      }}
    >
      {children}
    </a>
  );
}

function TaskResults({ result, onOpenRecord }: { result: Extract<AdminRead, { kind: "tasks" }>; onOpenRecord: (url: string) => void }) {
  const { page } = result;
  return (
    <section className="admin-otto-result-card" aria-label="Task results">
      <header className="admin-otto-result-head">
        <h4>Tasks</h4>
        <p>Showing {page.items.length} of {safeCount(page.total)}</p>
      </header>
      {page.items.length ? (
        <ol className="admin-otto-result-list">
          {page.items.map((task) => (
            <li key={task.id}>
              <div className="admin-otto-result-row">
                <div>
                  <RecordLink url={task.recordUrl} onOpenRecord={onOpenRecord}>{task.title}</RecordLink>
                  <p className="admin-otto-result-meta">
                    <span>{assigneeNames(task)}</span>
                    {task.parentTitle ? <span className="admin-otto-parent">Subtask of {task.parentTitle}</span> : task.parentId ? <span className="admin-otto-parent">Subtask of a parent task</span> : null}
                    {task.effectiveDueDate ? <span>Due {adminCalendarDate(task.effectiveDueDate)}</span> : null}
                  </p>
                </div>
                <span className={`admin-otto-task-status is-${task.status}`}>{task.status === "overdue" ? "Overdue" : "Open"}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="admin-otto-empty-line">No tasks matched that request.</p>}
    </section>
  );
}

const RECORD_SOURCE_LABEL: Record<WorkRecord["source"], string> = {
  update: "Update",
  submitted_eod: "EOD report",
  task: "Task",
  reviewed_recap: "Reviewed recap",
  workday: "Workday",
};

function RecordResults({ result, onOpenRecord }: { result: Extract<AdminRead, { kind: "records" }>; onOpenRecord: (url: string) => void }) {
  const { page } = result;
  return (
    <section className="admin-otto-result-card" aria-label="Record results">
      <header className="admin-otto-result-head">
        <h4>Records</h4>
        <p>Showing {page.items.length} of {safeCount(page.total)}</p>
      </header>
      {page.items.length ? (
        <ol className="admin-otto-result-list">
          {page.items.map((record) => (
            <li key={record.id}>
              <div className="admin-otto-result-row">
                <div>
                  <RecordLink url={record.recordUrl} onOpenRecord={onOpenRecord}>{record.text || RECORD_SOURCE_LABEL[record.source]}</RecordLink>
                  <p className="admin-otto-result-meta">
                    <span>{RECORD_SOURCE_LABEL[record.source]}</span>
                    <span>{adminCalendarDate(record.localDate)}</span>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="admin-otto-empty-line">No records matched that request.</p>}
    </section>
  );
}

function RecapResults({ result, onOpenRecap, onListen }: { result: Extract<AdminRead, { kind: "recaps" }>; onOpenRecap: (recap: ReviewedRecap) => void; onListen: (recap: ReviewedRecap) => void }) {
  const { page } = result;
  return (
    <section className="admin-otto-result-card" aria-label="Reviewed recap results">
      <header className="admin-otto-result-head">
        <h4>Reviewed recaps</h4>
        <p>Showing {page.items.length} of {safeCount(page.total)}</p>
      </header>
      {page.items.length ? (
        <ol className="admin-otto-result-list">
          {page.items.map((recap) => (
            <li key={recap.intervalId}>
              <div className="admin-otto-result-row">
                <div>
                  <strong>{recap.person.displayName}</strong>
                  <p className="admin-otto-result-meta">
                    <span>{adminReviewStatusLabel(recap.reviewStatus)}</span>
                    <span>{adminRecapDate(recap.reviewedAt, recap.timezone)}</span>
                  </p>
                  {recap.original.headline ? <p className="admin-otto-result-summary">{recap.original.headline}</p> : null}
                </div>
                <div className="admin-otto-result-actions">
                  <button type="button" className="admin-otto-secondary" data-admin-recap-id={recap.intervalId} data-admin-recap-action="view" onClick={() => onOpenRecap(recap)}>View recap</button>
                  <button type="button" className="admin-otto-listen" aria-label={`Listen to the recap for ${recap.person.displayName}`} onClick={() => onListen(recap)}>Listen</button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : <p className="admin-otto-empty-line">No reviewed recaps matched that request.</p>}
    </section>
  );
}

function ResolutionResult({ result }: { result: Extract<AdminRead, { kind: "resolution" }> }) {
  const resolution = result.resolution;
  return (
    <section className="admin-otto-result-card" aria-label="Unresolved person">
      <header className="admin-otto-result-head"><h4>Person needed</h4></header>
      <p>{resolution.kind === "ambiguous"
        ? `More than one person matches ${resolution.name}. Choose one in the request.`
        : `No employee named ${resolution.name} was found.`}</p>
      {resolution.kind === "ambiguous" ? (
        <ul className="admin-otto-result-list">
          {resolution.choices.map((person) => <li key={person.id}>{person.displayName}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

export function AdminResultCard({
  result,
  onOpenRecord,
  onOpenRecap,
  onListen,
  playback = null,
}: {
  result: AdminRead;
  onOpenRecord: (url: string) => void;
  onOpenRecap: (recap: ReviewedRecap) => void;
  onListen: (recap: ReviewedRecap) => void;
  playback?: AdminRecapPlayback | null;
}) {
  switch (result.kind) {
    case "tasks": return <TaskResults result={result} onOpenRecord={onOpenRecord} />;
    case "records": return <RecordResults result={result} onOpenRecord={onOpenRecord} />;
    case "recaps": return <RecapResults result={result} onOpenRecap={onOpenRecap} onListen={onListen} />;
    case "recap":
      return <AdminRecapView recap={result.recap} onListen={onListen} onOpenRecord={onOpenRecord} playback={playback} />;
    case "resolution": return <ResolutionResult result={result} />;
    default: return null;
  }
}

function arrivalLabel(arrival: AdminArrivalView): string {
  if (arrival.count === 1) return "1 reviewed recap is ready";
  return `${safeCount(arrival.count)} reviewed recaps are ready`;
}

export type AdminOttoChatProps = {
  scope: OttoScope;
  conversationId: string | null;
  onOpenRecord: (url: string) => void;
  onListen: (recap: ReviewedRecap) => void;
  /** Shared chat surface options. */
  initialTab?: AdminTab;
  initialRecap?: ReviewedRecap | null;
  initialInbox?: InboxPage | null;
  arrival?: AdminArrivalView | null;
  arrivalRevision?: number;
  /** A saved follow filter changes the reviewed arrivals; the shell bumps this
   * to refresh the open inbox without reloading the conversation. */
  followRevision?: number;
  playback?: AdminRecapPlayback | null;
  /** Updated reviewed recaps from a stale-key refresh, keyed by interval. */
  recapUpdates?: Record<string, ReviewedRecap>;
  voice?: VoiceInput;
  transcriptionEnabled?: boolean;
  transcribe?: (clip: Blob, mime: string, language: string) => Promise<{ text?: string }>;
  onStopListening?: () => void;
  /** The mode-controller epoch that owns cross-window audio requests. */
  audioEpoch?: number;
  initialDraft?: string;
  initialRequestId?: string | null;
  resetToken?: number;
  onConversation?: (conversationId: string) => void;
  onRecoveryChange?: (recovery: AdminOttoEntryRecovery) => void;
  onClose?: () => void;
  transport?: AdminOttoEntryTransport & { inbox?: typeof fetchAdminOttoInbox };
  /** Tests and the local preview render a supplied snapshot rather than
   * fetching from the workspace. */
  previewOnly?: boolean;
  onArrivalSeen?: () => void;
};

export function AdminOttoChat({
  scope,
  conversationId,
  onOpenRecord,
  onListen,
  initialTab = "chat",
  initialRecap = null,
  initialInbox = null,
  arrival = null,
  arrivalRevision = 0,
  followRevision = 0,
  playback = null,
  recapUpdates = {},
  voice,
  transcriptionEnabled = false,
  transcribe,
  onStopListening,
  audioEpoch = 1,
  initialDraft = "",
  initialRequestId = null,
  resetToken = 0,
  onConversation,
  onRecoveryChange,
  onClose,
  transport,
  previewOnly = false,
  onArrivalSeen,
}: AdminOttoChatProps) {
  const [surface] = useState(() => createAdminOttoSurfaceController(initialTab));
  const state = useSyncExternalStore(surface.subscribe, surface.snapshot, surface.snapshot);
  const reducedMotion = useReducedMotion();
  const [selectedRecap, setSelectedRecap] = useState<ReviewedRecap | null>(initialRecap);
  const [unread, setUnread] = useState(initialInbox?.unread ?? arrival?.unread ?? 0);
  const [inboxRevision, setInboxRevision] = useState(0);
  const lastArrival = useRef<string>("");
  const conversationRef = useRef<string | null>(conversationId);
  const restoreFocus = useRef<Element | null>(null);
  const recapBackRef = useRef<HTMLButtonElement | null>(null);
  const recapTriggerRef = useRef<HTMLElement | null>(null);
  // Mounting straight into a recap (a record link or a single-arrival fixture)
  // still moves focus to Back; a row click has no previous recap either.
  const previousRecap = useRef<ReviewedRecap | null>(null);

  useEffect(() => {
    restoreFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    return () => {
      if (restoreFocus.current instanceof HTMLElement) restoreFocus.current.focus();
    };
  }, []);

  const [controller] = useState(() => createAdminOttoEntryController({
    scope,
    send: transport?.send ?? sendAdminOttoChat,
    load: transport?.load ?? fetchAdminOttoThread,
    initialDraft,
    initialRequestId,
    initialConversationId: conversationId,
  }));
  const chat = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const appliedReset = useRef(0);
  const previousConversationProp = useRef<string | null>(conversationId);
  useEffect(() => {
    if (resetToken === 0 || appliedReset.current === resetToken) return;
    appliedReset.current = resetToken;
    resetAdminOttoConversation({ controller, surface, conversationRef, scope });
    setSelectedRecap(null);
  }, [resetToken, controller, scope, surface]);
  useEffect(() => {
    // A caller may start a new chat simply by dropping the conversation id.
    // The controller is reset synchronously, so a late answer from the old
    // thread cannot write its conversation back through onConversation.
    const previous = previousConversationProp.current;
    previousConversationProp.current = conversationId;
    if (previous === null || conversationId !== null) return;
    resetAdminOttoConversation({ controller, surface, conversationRef, scope });
    setSelectedRecap(null);
  }, [conversationId, controller, scope, surface]);

  /* Opening a recap moves focus to the Back control; closing it returns focus
   * to the exact View control that opened it, including after the inbox row
   * remounts. */
  useEffect(() => {
    const previous = previousRecap.current;
    previousRecap.current = selectedRecap;
    if (selectedRecap && !previous) {
      const frame = window.requestAnimationFrame(() => adminRecapOpenFocus(recapBackRef.current)?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
    if (!selectedRecap && previous) {
      const id = previous.intervalId;
      const frame = window.requestAnimationFrame(() => {
        const target: AdminFocusTarget | null = chooseAdminRecapReturnFocus({
          trigger: recapTriggerRef.current,
          recapId: id,
          lookup: (recapId) => document.querySelector<HTMLElement>(
            `[data-admin-recap-id="${recapId}"][data-admin-recap-action="view"]`,
          ),
          back: recapBackRef.current,
        });
        recapTriggerRef.current = null;
        target?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [selectedRecap]);
  const adminVoiceCancelRef = useRef<(() => void) | null>(null);
  const recordingLease = useRef<OttoAudioLease | null>(null);
  const audioIdentityRef = useRef({ scope, epoch: audioEpoch });
  // Before paint, so a lease continuation cannot read the previous identity.
  useLayoutEffect(() => {
    audioIdentityRef.current = { scope, epoch: audioEpoch };
  }, [scope, audioEpoch]);
  const releaseRecordingLease = () => {
    recordingLease.current?.release();
    recordingLease.current = null;
  };
  const stopMicrophoneForInterlock = useCallback(() => {
    adminVoiceCancelRef.current?.();
  }, []);
  const interlockRef = useRef<ReturnType<typeof createAdminAudioInterlock> | null>(null);
  useEffect(() => {
    interlockRef.current = createAdminAudioInterlock({
      stopSpeech: () => onStopListening?.(),
      stopMicrophone: stopMicrophoneForInterlock,
    });
    return () => { interlockRef.current = null; };
  }, [onStopListening, stopMicrophoneForInterlock]);

  /* The admin composer records only when the context says transcription is
     available. Starting a capture stops the shared speaker; a read starting
     cancels the capture through the effect below. */
  const adminVoice = useVoiceInput({
    enabled: !voice && transcriptionEnabled,
    surface: "admin-otto",
    transcribe,
    onTranscript: (text) => {
      const current = controller.snapshot().draft;
      controller.setDraft(current.trim() ? `${current.trimEnd()} ${text}` : text);
    },
    onRecordingStart: () => {
      interlockRef.current?.microphoneStarted();
    },
    beforeCapture: async () => {
      const requested = audioIdentityRef.current;
      let lease: OttoAudioLease;
      try {
        lease = await requestOttoAudio(requested.scope, requested.epoch, "recording");
      } catch (failure) {
        return failure instanceof Error && failure.message
          ? failure.message
          : "Audio is busy in another companion window.";
      }
      const current = audioIdentityRef.current;
      if (!lease.isActive()
        || current.epoch !== requested.epoch
        || !sameOttoScope(current.scope, requested.scope)) {
        lease.release();
        return "Audio is busy in another companion window.";
      }
      recordingLease.current?.release();
      recordingLease.current = lease;
      return null;
    },
  });
  const composerVoice = voice ?? (transcriptionEnabled ? adminVoice : undefined);
  useEffect(() => {
    adminVoiceCancelRef.current = adminVoice.cancel;
    return () => { adminVoiceCancelRef.current = null; };
  }, [adminVoice.cancel]);
  useEffect(() => {
    if (playback?.status === "loading" || playback?.status === "playing") stopMicrophoneForInterlock();
  }, [playback?.status, stopMicrophoneForInterlock]);
  useEffect(() => {
    if (adminVoice.state === "idle" || adminVoice.state === "transcribing") releaseRecordingLease();
  }, [adminVoice.state]);
  useEffect(() => onOttoAudioStop(() => {
    releaseRecordingLease();
    adminVoiceCancelRef.current?.();
  }), []);


  useEffect(() => {
    conversationRef.current = conversationId;
    if (conversationId && (conversationId !== controller.snapshot().conversationId || controller.snapshot().hydration !== "idle")) {
      void controller.open(conversationId);
    }
  }, [conversationId, controller]);

  useEffect(() => {
    onRecoveryChange?.(controller.recovery());
  }, [chat, controller, onRecoveryChange]);

  useEffect(() => {
    // Triggered by the store change, but never sourced from the render
    // snapshot: New chat can run this effect with an old `chat.conversationId`
    // and a fresh host callback identity before the reset is observed.
    syncAdminOttoConversation({
      controller,
      conversationRef,
      onConversation,
      renderConversationId: chat.conversationId,
    });
  }, [chat.conversationId, controller, onConversation]);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    if (!arrival) return;
    const key = `${arrival.count}:${arrival.eventIds.join(",")}:${arrival.unread}`;
    if (lastArrival.current === key) return;
    lastArrival.current = key;
    surface.receiveArrival({ count: arrival.count, unread: arrival.unread });
    setUnread(arrival.unread);
    setInboxRevision((value) => value + 1);
  }, [arrival, surface]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = adminEscapeAction({
        key: event.key,
        recapOpen: selectedRecap !== null,
        // Another modal surface owns the top layer; do not close the sheet and
        // that modal together.
        topmostModalOpen: !!document.querySelector('[role="dialog"][aria-modal="true"]'),
      });
      if (!action) return;
      event.preventDefault();
      if (action === "close-recap") {
        setSelectedRecap(null);
        surface.closeRecap();
        return;
      }
      onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, selectedRecap, surface]);

  const openRecap = (recap: ReviewedRecap) => {
    recapTriggerRef.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement : null;
    setSelectedRecap(recap);
    surface.openRecap(recap.intervalId);
  };

  const activeRecap = selectedRecap
    ? recapUpdates[selectedRecap.intervalId] ?? selectedRecap
    : null;
  const arrivalRecap = arrival?.recap ? recapUpdates[arrival.recap.intervalId] ?? arrival.recap : null;

  const tabs: ChatTab[] = [
    { id: "chat", label: "Chat" },
    { id: "recaps", label: "Recaps", count: unread },
  ];

  const send = () => {
    void controller.submit();
  };

  return (
    <ConversationSurface surface="in-app" open ariaLabel="Admin Otto" className="admin-otto-surface">
      <section className="chat-surface admin-otto-sheet" role="dialog" aria-label="Admin Otto" data-admin-otto-surface>
        <header className="workos-chat-head admin-otto-head">
          <span className="admin-otto-head-title">
            <span className="conversation-pane-title">Otto</span>
            <span className="admin-otto-head-sub">Administration, read-only</span>
          </span>
          <ChatTabs
            tabs={tabs}
            active={state.tab}
            onSelect={(id) => {
              const next = id === "recaps" ? "recaps" : "chat";
              surface.selectTab(next);
              if (next === "chat") setSelectedRecap(null);
            }}
            ariaLabel="Admin Otto views"
          />
          <span className="progress-header-actions">
            {onClose ? (
              <button type="button" className="admin-otto-close" aria-label="Close admin Otto" title="Close" onClick={onClose}>
                <X size={16} aria-hidden="true" />
              </button>
            ) : null}
          </span>
        </header>

        {state.tab === "chat" ? (
          <>
            <div className="conversation-scroll-region admin-otto-thread" role="log" aria-live="polite" aria-label="Conversation">
              {chat.hydration === "loading" ? <p className="admin-otto-status" role="status">Opening the conversation…</p> : null}
              {chat.hydration === "failed" ? (
                <div className="admin-otto-error" role="alert">
                  <p>{chat.error ?? "Otto couldn't load this conversation."}</p>
                  <button type="button" className="admin-otto-secondary" onClick={() => { if (chat.conversationId) void controller.open(chat.conversationId); }}>
                    Try again
                  </button>
                </div>
              ) : null}
              {!chat.turns.length && chat.hydration === "idle" ? (
                <div className="admin-otto-welcome">
                  <p>Ask about work, people, EOD reports, or recaps.</p>
                  <p className="admin-otto-quiet">Answers come from records you can already open. Nothing here changes employee data.</p>
                </div>
              ) : null}
              {chat.turns.map((turn, index) => (
                <ChatTurn
                  key={turn.id}
                  role={turn.role}
                  showMark={turn.role === "assistant" && (index === 0 || chat.turns[index - 1]?.role !== "assistant")}
                  copySource={turn.result ? undefined : { role: turn.role, text: turn.text }}
                >
                  {turn.role === "user" ? <AdminReplyText text={turn.text} className="is-user" /> : (
                    <>
                      {turn.text ? <AdminReplyText text={turn.text} /> : null}
                      {turn.result ? (
                        <AdminResultCard
                          result={turn.result}
                          onOpenRecord={onOpenRecord}
                          onOpenRecap={openRecap}
                          onListen={onListen}
                          playback={playback}
                        />
                      ) : null}
                    </>
                  )}
                </ChatTurn>
              ))}
              {chat.error && chat.hydration === "idle" ? <p className="admin-otto-error" role="alert">{chat.error}</p> : null}
              {chat.busy ? <p className="admin-otto-status" role="status">Otto is reading</p> : null}
            </div>
            <div className="admin-otto-composer">
              <WorkOsPromptBar
                value={chat.draft}
                onChange={(next) => controller.setDraft(next)}
                onSend={send}
                placeholder="Ask about work, people, or recaps…"
                ariaLabel="Ask Otto about the team"
                canSend={!!chat.draft.trim() && chat.hydration === "idle"}
                busy={chat.busy}
                voice={composerVoice}
                sendLabel="Ask Otto"
              />
            </div>
          </>
        ) : (
          <div className="conversation-scroll-region admin-otto-recaps">
            {playback?.error && !activeRecap ? <p className="admin-otto-error" role="alert">{playback.error}</p> : null}
            {!activeRecap && playback && (playback.status === "loading" || playback.status === "playing") ? (
              <section className="admin-otto-reading admin-otto-inbox-reading" aria-label="Reading aloud">
                <div className="admin-otto-reading-head">
                  <span>
                    {playback.status === "loading"
                      ? (playback.slow ? "Taking longer than usual" : "Getting your recap…")
                      : "Otto is reading"}
                  </span>
                  <button
                    type="button"
                    className="admin-otto-listen is-listening"
                    aria-label={playback.status === "loading" && playback.slow ? "Cancel reading the recap" : "Stop reading the recap"}
                    aria-pressed="true"
                    onClick={() => onStopListening?.()}
                  >
                    {playback.status === "loading" && playback.slow ? "Cancel" : "Stop"}
                  </button>
                </div>
                {playback.lines.length ? (
                  <RecapPrompter
                    lines={playback.lines}
                    progress={playback.progress}
                    activeIndex={playback.activeIndex}
                    reduced={reducedMotion}
                    className="admin-otto-prompter"
                  />
                ) : null}
              </section>
            ) : null}
            {!activeRecap && playback?.status === "finished" ? (
              <p className="admin-otto-inbox-refreshing" role="status">Read complete. The recap is still here.</p>
            ) : null}
            {arrival && arrival.count > 0 ? (
              <section className="admin-otto-arrival" aria-label="Recap arrival" role="status">
                <div>
                  <strong>{arrivalLabel(arrival)}</strong>
                  <p>
                    {arrival.count === 1
                      ? "Listen here, or open the recap to read it."
                      : "The newest recaps are waiting in the inbox below."}
                  </p>
                </div>
                <div className="admin-otto-arrival-actions">
                  {arrival.count === 1 && arrivalRecap ? (
                    <button type="button" className="admin-otto-listen" onClick={() => { onArrivalSeen?.(); onListen(arrivalRecap); }}>Listen</button>
                  ) : null}
                  <button
                    type="button"
                    className="admin-otto-secondary"
                    {...(arrival.count === 1 && arrivalRecap
                      ? { "data-admin-recap-id": arrivalRecap.intervalId, "data-admin-recap-action": "view" }
                      : {})}
                    onClick={() => {
                      onArrivalSeen?.();
                      if (arrival.count === 1 && arrivalRecap) openRecap(arrivalRecap);
                    }}
                  >
                    {arrival.count === 1 ? "View recap" : "View inbox"}
                  </button>
                </div>
              </section>
            ) : null}

            {activeRecap ? (
              <div className="admin-otto-selected-recap">
                <button ref={recapBackRef} type="button" className="admin-otto-back" onClick={() => { setSelectedRecap(null); surface.closeRecap(); }}>
                  ← Back to inbox
                </button>
                <AdminRecapView
                  recap={activeRecap}
                  onListen={onListen}
                  onOpenRecord={onOpenRecord}
                  playback={playback}
                />
              </div>
            ) : (
              <AdminRecapInbox
                scope={scope}
                onOpenRecap={openRecap}
                onListen={onListen}
                transport={transport?.inbox}
                initialPage={initialInbox}
                previewOnly={previewOnly}
                refreshRevision={inboxRevision + arrivalRevision + followRevision}
                playback={playback}
                recapUpdates={recapUpdates}
                onSnapshot={(snapshot) => {
                  setUnread(snapshot.page?.unread ?? 0);
                }}
              />
            )}
          </div>
        )}
      </section>
    </ConversationSurface>
  );
}
