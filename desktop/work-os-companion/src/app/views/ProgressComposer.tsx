import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Pencil, RefreshCw, Sparkles, SquarePen, X } from "lucide-react";
import type { OttoScope } from "@wrazy/work-os-shared/admin-otto/contracts";
import { ActivityIntervalStream } from "../../ActivityIntervalList";
import { onOttoSpeechStop, requestOttoAudio, type OttoAudioLease } from "../../adminOtto/audioOwner";
import { sameOttoScope } from "../../adminOtto/mode";
import { apiRequestAudio } from "../../api";
import { AvatarThinking, type AvatarThinkingStage } from "../../AvatarThinking";
import { HistoryTurn, type HistoryTurnData } from "../../chat/HistoryTurn";
import { VOICE_HOTKEY_LABEL } from "../../chat/voiceInput";
import type { ProposedOperation, ToolCallResult } from "../../interpretation";
import { MASCOT } from "../../mascot";
import { DEFAULT_RECAP_VOICE } from "../../recapSpeech";
import { browserRecapAudio, createRecapSpeechPlayer, type RecapSpeechSnapshot } from "../../recapSpeechPlayer";
import { readStoredFlag, writeStoredFlag } from "../../storedFlags";
import { suggestDailyGoal } from "../../taskWorkspace";
import type { RecapNextStepItem } from "../../types";
import type { WorkOsConversationTurn } from "../../vault";
import { ChatTabs, ChatTimeDivider, ChatTurn, ChatWelcome, collapseConsecutiveAssistantDuplicates, ConversationLauncher, ConversationSurface, shouldShowChatDivider, threadScrollTarget, WorkOsPromptBar, workOsChatCommands } from "../../WorkOsChat";
import { GOAL_COLLAPSE_KEY } from "../constants";
import type { ComposerMode, ProgressPanel, ProgressReceipt, ProgressUpdateKind } from "../types";
import { AssistantOperations, WorkingNowTrace } from "./AssistantOperations";

export function ProgressComposer({ headerLeading, mode = "progress", displayName = null, input, open, panel, pending, receipt, history = [], onClearChat, busy, required, goal, goalProvenance, goalSuggestion, saveState, recapVoice = DEFAULT_RECAP_VOICE, onRecapStale, activityDate = null, activityTimezone = null, activityPollMs, interpretation = null, thinking = null, toolContext = { shiftDate: null, personId: null, promptKind: "optional" }, aiUnavailable = null, voice, audioScope = null, audioEpoch = 1, onInput, onOpen, onOpenGoal, onClose, onSubmit, onClassify, onApplyGoal, onRetryGoalSave, onReviewOperations, onMarkSelectedDone, onLoadSubtasks, onNavigateView, onRetryOperation, onReviewHistoryOperations, onRetryHistoryOperation, onDecideNextStep }: {
  headerLeading?: ReactNode;
  mode?: ComposerMode; displayName?: string | null;
  input: string; open: boolean; panel: ProgressPanel; pending: string; receipt: ProgressReceipt | null; history?: WorkOsConversationTurn[]; onClearChat?: () => void; busy: boolean; required: boolean; goal: string;
  goalProvenance: "employee" | "suggested" | "accepted_suggestion" | "ai_draft" | null; goalSuggestion: ReturnType<typeof suggestDailyGoal>; saveState: "saved" | "saving" | "offline" | "conflict";
  activityDate?: string | null; activityTimezone?: string | null; activityPollMs?: number;
  /** How recaps are read aloud on this device (provider voice id). */
  recapVoice?: string;
  /** The recap behind a clip changed while it was synthesized. */
  onRecapStale?: () => void;
  /** The employee's cross-window audio scope. Absent in isolated previews. */
  audioScope?: OttoScope | null;
  audioEpoch?: number;
  onInput: (value: string) => void; onOpen: () => void; onOpenGoal: () => void; onClose: () => void; onSubmit: () => void; onClassify: (kind: ProgressUpdateKind) => void; onApplyGoal: (value: string, fromSuggestion: boolean) => void; onRetryGoalSave?: () => void;
  interpretation?: { status: "loading" | "ready"; reviewId?: string; operations: Array<import("../../interpretation").ProposedOperation>; taskOptions: Array<{ id: string; title: string }>; reply?: string; results?: ToolCallResult[] } | null;
  thinking?: { stages: AvatarThinkingStage[]; active: number; startedAt: number } | null;
  toolContext?: import("../../interpretation").ApprovedOpContext;
  aiUnavailable?: string | null;
  voice?: import("../../chat/voiceInput").VoiceInput;
  onNavigateView?: (page: import("../../interpretation").NavigatePage) => void; onReviewOperations?: (approved: ProposedOperation[], rejected: ProposedOperation[]) => void; onMarkSelectedDone?: (tasks: Array<{ id: string; title: string }>) => void; onLoadSubtasks?: (taskId: string) => Promise<readonly { id: string; title: string; completed?: boolean }[]>; onRetryOperation?: (result: ToolCallResult) => void;
  onReviewHistoryOperations?: (turnId: string, approved: ProposedOperation[], rejected: ProposedOperation[]) => void; onRetryHistoryOperation?: (turnId: string, result: ToolCallResult) => void; onDecideNextStep?: (turnId: string, item: RecapNextStepItem, decision: "accept" | "skip", edits?: { name?: string }) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  // Focus panel: a saved goal renders as a card; the editor appears only when
  // no goal exists yet or the employee chose to edit. Nothing saves until Apply.
  const goalPanelOpen = open && panel === "goal";
  const [goalEditing, setGoalEditing] = useState(false);
  const [goalCollapsed, setGoalCollapsed] = useState(() => readStoredFlag(GOAL_COLLAPSE_KEY));
  const toggleGoalCollapsed = () => setGoalCollapsed((current) => {
    const next = !current;
    writeStoredFlag(GOAL_COLLAPSE_KEY, next);
    return next;
  });
  const [goalDraft, setGoalDraft] = useState(goal);
  const [goalFromSuggestion, setGoalFromSuggestion] = useState(false);
  const [pendingGoal, setPendingGoal] = useState<string | null>(null);

  /* Recaps are read with the same one-player machine the floating companion
     uses, so the Tasks tab's cards offer the same Listen control and the same
     rules: one audio owner, a prime inside the press (a webview forgets the
     gesture while the clip is synthesized), and a visible reason when a read
     cannot start instead of a silent press. */
  const [recapSpeech, setRecapSpeech] = useState<RecapSpeechSnapshot>({
    status: "idle", lines: [], progress: 0, activeIndex: 0, revision: null, reviewKey: null, intervalId: null, slow: false, retryIntervalId: null,
  });
  const [recapSpeechError, setRecapSpeechError] = useState<string | null>(null);
  const employeeAudioLease = useRef<OttoAudioLease | null>(null);
  const audioContextRef = useRef({ scope: audioScope, epoch: audioEpoch });
  // Before paint, so an async media callback cannot read a stale scope.
  useLayoutEffect(() => {
    audioContextRef.current = { scope: audioScope, epoch: audioEpoch };
  }, [audioScope, audioEpoch]);
  /* The exact read this player is speaking. A late snapshot from an account
   * or mode the window has already left cannot update the visible words. */
  const employeeReadRef = useRef<{ scope: OttoScope | null; epoch: number } | null>(null);
  // The factory records async callbacks; it never reads the refs during render.
  // eslint-disable-next-line react-hooks/refs
  const [recapPlayer] = useState(() => createRecapSpeechPlayer({
    fetchClip: (input) => apiRequestAudio("/api/work-os/voice/recap", input),
    createAudio: browserRecapAudio,
    isPlaybackAllowed: () => {
      const requested = employeeReadRef.current;
      if (!requested) return false;
      const current = audioContextRef.current;
      if (requested.scope && (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch)) return false;
      return requested.scope ? !!employeeAudioLease.current?.isActive() : true;
    },
    onSnapshot: (snapshot) => {
      const requested = employeeReadRef.current;
      if (!requested) return;
      const current = audioContextRef.current;
      if (requested.scope && (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch)) {
        employeeReadRef.current = null;
        return;
      }
      if (snapshot.status === "idle") employeeReadRef.current = null;
      setRecapSpeech(snapshot);
    },
    onFailure: (message) => {
      const requested = employeeReadRef.current;
      const current = audioContextRef.current;
      if (requested?.scope && (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch)) return;
      setRecapSpeechError(message);
    },
    // The card moved on while the clip was made: the host refreshes the stream
    // so the words on screen are the words that play next time.
    onStaleCard: () => { onRecapStale?.(); },
  }));
  const toggleRecapRead = useCallback((id: string, revision: number | null): void => {
    const active = recapPlayer.snapshot();
    if (active.intervalId === id && active.status !== "idle") {
      employeeAudioLease.current?.release();
      employeeAudioLease.current = null;
      employeeReadRef.current = null;
      recapPlayer.stop();
      return;
    }
    if (active.status !== "idle") {
      // Stop the old read before releasing or requesting ownership, so the
      // next owner never starts beside audio that is still playing here.
      employeeAudioLease.current?.release();
      employeeAudioLease.current = null;
      employeeReadRef.current = null;
      recapPlayer.stop();
    }
    setRecapSpeechError(null);
    const requested = { scope: audioScope, epoch: audioEpoch };
    if (!requested.scope) {
      employeeReadRef.current = requested;
      void recapPlayer.toggle({ intervalId: id, revision, voice: recapVoice, enabled: !!voice });
      return;
    }
    void requestOttoAudio(requested.scope, requested.epoch, "speech").then(async (lease) => {
      if (!lease.isActive()) { lease.release(); return; }
      const current = audioContextRef.current;
      if (!sameOttoScope(current.scope, requested.scope) || current.epoch !== requested.epoch) {
        lease.release();
        return;
      }
      employeeAudioLease.current?.release();
      employeeAudioLease.current = lease;
      employeeReadRef.current = requested;
      await recapPlayer.toggle({ intervalId: id, revision, voice: recapVoice, enabled: !!voice });
    }).catch((failure: unknown) => {
      setRecapSpeechError(failure instanceof Error && failure.message ? failure.message : "Audio is busy in another companion window.");
    });
  }, [audioEpoch, audioScope, recapPlayer, recapVoice, voice]);
  /* A new actor/org/mode/epoch drops the old words, error and ownership. */
  useEffect(() => {
    employeeAudioLease.current?.release();
    employeeAudioLease.current = null;
    employeeReadRef.current = null;
    recapPlayer.stop();
    setRecapSpeech({
      status: "idle", lines: [], progress: 0, activeIndex: 0, revision: null, reviewKey: null, intervalId: null, slow: false, retryIntervalId: null,
    });
    setRecapSpeechError(null);
  }, [audioEpoch, audioScope?.mode, audioScope?.organizationId, audioScope?.userId, recapPlayer]);
  useEffect(() => onOttoSpeechStop(() => {
    employeeAudioLease.current?.release();
    employeeAudioLease.current = null;
    employeeReadRef.current = null;
    recapPlayer.stop();
  }), [recapPlayer]);
  useEffect(() => {
    if (recapSpeech.status !== "idle" && recapSpeech.status !== "finished") return;
    employeeAudioLease.current?.release();
    employeeAudioLease.current = null;
  }, [recapSpeech.status]);
  /* One audio owner: a recording never starts on top of a read, and a hidden
     window never speaks to an empty room. */
  useEffect(() => {
    if (voice && voice.state !== "idle") {
      employeeAudioLease.current?.release();
      employeeAudioLease.current = null;
      employeeReadRef.current = null;
      recapPlayer.stop();
    }
  }, [voice, recapPlayer]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "hidden") recapPlayer.stop(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      recapPlayer.dispose();
    };
  }, [recapPlayer]);
  useEffect(() => {
    if (!goalPanelOpen || goalEditing) return;
    setGoalDraft(goal);
    setGoalFromSuggestion(false);
  }, [goalPanelOpen, goalEditing, goal]);
  // The card shows the applied text until the saved plan catches up, and falls
  // back to the authoritative goal whenever that changes (save, resync, conflict).
  useEffect(() => { setPendingGoal(null); }, [goal]);
  const cardGoal = pendingGoal ?? goal;
  const goalApplyDisabled = saveState === "saving" || goalDraft.trim() === cardGoal.trim();
  const applyGoalDraft = () => {
    const next = goalDraft.trim();
    onApplyGoal(next, goalFromSuggestion);
    setPendingGoal(next);
    setGoalEditing(false);
  };
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const [sweepSignal, setSweepSignal] = useState(0);
  const bumpSweep = () => setSweepSignal((value) => value + 1);
  const wasOpenRef = useRef(open);
  const threadMetricsRef = useRef<{ scrollHeight: number } | null>(null);
  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    const el = conversationRef.current;
    if (!el) return;
    const newest = el.lastElementChild as HTMLElement | null;
    const isTurn = !!newest && !newest.classList.contains("progress-history");
    /* Compare the reader's position against the height before this arrival, so a
       reply that grows the thread does not look like a scroll-up. */
    const previousHeight = threadMetricsRef.current?.scrollHeight ?? el.scrollHeight;
    const wasAtBottom = previousHeight - el.scrollTop - el.clientHeight < 48;
    const target = threadScrollTarget({
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      newestHeight: isTurn ? newest!.offsetHeight : 0,
      newestTop: isTurn ? newest!.getBoundingClientRect().top - el.getBoundingClientRect().top : 0,
      wasAtBottom,
      forceBottom: justOpened,
    });
    if (target !== null) el.scrollTop = target;
    threadMetricsRef.current = { scrollHeight: el.scrollHeight };
  }, [history.length, interpretation, pending, receipt, open]);
  const previousOpenRef = useRef(open);
  useEffect(() => {
    if (!open && previousOpenRef.current) {
      const frame = window.requestAnimationFrame(() => launcherRef.current?.focus());
      previousOpenRef.current = open;
      return () => window.cancelAnimationFrame(frame);
    }
    previousOpenRef.current = open;
    return undefined;
  }, [open]);
  const options: Array<{ kind: ProgressUpdateKind; label: string }> = [
    { kind: "material_progress", label: "Progress" }, { kind: "completion_claim", label: "Completed work" },
    { kind: "blocked", label: "Blocker" }, { kind: "priority_change", label: "Priority change" }, { kind: "new_task", label: "New task" },
  ];
  const saveLabel = saveState === "saving" ? "Saving…" : saveState === "offline" ? "Queued offline" : saveState === "conflict" ? "Resolving conflict" : "Saved";
  const agendaMode = mode === "agenda";
  const visibleHistory = collapseConsecutiveAssistantDuplicates(history);
  const showLiveAssistantMark = visibleHistory.at(-1)?.role !== "assistant";
  const lastAssistantText = [...visibleHistory].reverse().find((turn) => turn.role === "assistant")?.text.trim() ?? null;
  const echoReply = interpretation?.status === "ready" && !interpretation.operations.length && interpretation.reply && interpretation.reply.trim() !== lastAssistantText ? interpretation.reply : null;
  // A live turn's clock is the moment it first appeared; once it lands in
  // history, the persisted turn's own createdAt takes over.
  const echoReplyAt = useMemo(() => new Date().toISOString(), [echoReply]);
  // One live reply keeps one arrival time: key on the review identity and
  // status, not the object, so result merges never reset the clock.
  const interpretationAt = useMemo(() => new Date().toISOString(), [interpretation?.reviewId, interpretation?.status]);
  const receiptTitle = receipt?.kind === "new_task"
    ? receipt.queued ? "Task queued" : "Task added"
    : receipt?.queued ? "Update queued" : "Update recorded";
  return <ConversationSurface
    surface="in-app"
    open={open}
    ariaLabel={panel === "goal" ? "Daily focus editor" : "Daily update conversation"}
    className={`progress-dock ${agendaMode ? "agenda-dock" : "progress-mode"} ${open ? "open" : ""}`}
  >
    {open ? <div className="chat-surface is-open" id="conversation-panel">
    <section className={`progress-flyout ${panel === "goal" ? "goal-flyout" : agendaMode ? "agenda-flyout" : ""}`} role="dialog" aria-label={panel === "goal" ? "Daily focus editor" : "Daily update composer"}>
      <header className="workos-chat-head">{headerLeading ?? <span className="conversation-pane-title">{MASCOT.name}</span>}<ChatTabs tabs={[{ id: "update", label: agendaMode ? "Chat" : "Update" }, { id: "goal", label: "Recaps" }]} active={panel} onSelect={(id) => { if (id === "goal") onOpenGoal(); else onOpen(); }} ariaLabel="Composer view" /><span className="progress-header-actions">{panel !== "goal" && <button aria-label="Start a new chat" title="Start a new chat" onClick={onClearChat}><SquarePen size={15} /></button>}<button aria-label="Close composer" onClick={onClose}><X size={16} /></button></span></header>
      {panel === "goal" ? <p className="workos-chat-sub">{`${goalProvenance === "suggested" ? `Suggested by ${MASCOT.name}` : goalProvenance === "ai_draft" ? `Drafted with ${MASCOT.name}` : goalProvenance === "accepted_suggestion" ? "Accepted suggestion" : goal ? "Written by you" : "Optional context"} · ${saveLabel}`}{onRetryGoalSave && (saveState === "offline" || saveState === "conflict") ? <button type="button" className="goal-retry" aria-label="Retry saving the goal" title={saveState === "conflict" ? "Goal not saved — refresh the day, then retry." : "Goal not saved — click to retry."} onClick={onRetryGoalSave}><RefreshCw size={12} /></button> : null}</p> : required ? <p className="workos-chat-sub">An update is due</p> : null}
        {panel === "goal" ? <div className="conversation-scroll-region"><div className="goal-composer-panel">
          <section className={`focus-goal${goalCollapsed ? " is-collapsed" : ""}`} aria-labelledby="focus-goal-heading">
            <header className="focus-goal-head">
              <span className="focus-goal-eyebrow" id="focus-goal-heading">Today’s focus</span>
              <button type="button" className="focus-goal-disclosure" aria-expanded={!goalCollapsed} aria-controls="focus-goal-body" aria-label={goalCollapsed ? "Show today’s focus" : "Hide today’s focus"} title={goalCollapsed ? "Show today’s focus" : "Hide today’s focus"} onClick={toggleGoalCollapsed}>
                <ChevronDown size={16} aria-hidden="true" className={`chat-task-chevron${goalCollapsed ? "" : " is-open"}`} />
              </button>
            </header>
            <div id="focus-goal-body" className="focus-goal-body" hidden={goalCollapsed}>{cardGoal && !goalEditing ? <div className="goal-card">
         <button type="button" className="goal-card-edit" aria-label="Edit today’s focus" title="Edit today’s focus" onClick={() => { setGoalDraft(cardGoal); setGoalFromSuggestion(false); setGoalEditing(true); }}><Pencil size={14} aria-hidden="true" /></button>
         <p className="goal-card-text">{cardGoal}</p>
       </div> : <>
         <div className="goal-editor-field"><label htmlFor="daily-focus-input">What is the goal for today?</label><small id="daily-focus-help">Tasks remain the source of work intent. This note adds context and does not affect attendance.</small><textarea id="daily-focus-input" aria-describedby="daily-focus-help" autoFocus maxLength={4000} value={goalDraft} onChange={(event) => { setGoalDraft(event.target.value); setGoalFromSuggestion(false); }} placeholder="Add context that is not obvious from your tasks" /></div>
         {!cardGoal && goalSuggestion && <div className="goal-suggestion composer-goal-suggestion"><Sparkles size={16} /><div><strong>Suggested from today’s tasks</strong><p>{goalSuggestion.text}</p></div><button type="button" onClick={() => { setGoalDraft(goalSuggestion.text); setGoalFromSuggestion(true); }}>Use suggestion</button></div>}
         <div className="goal-editor-actions"><button type="button" className="primary" disabled={goalApplyDisabled} onClick={applyGoalDraft}>{cardGoal ? "Apply" : "Apply goal"}</button>{cardGoal ? <button type="button" className="secondary" onClick={() => { setGoalEditing(false); setGoalDraft(cardGoal); setGoalFromSuggestion(false); }}>Cancel</button> : null}</div>
               </>}</div>
          </section>
          {recapSpeechError ? <p className="chat-activity-error" role="alert">{recapSpeechError}</p> : null}
          {activityDate ? <ActivityIntervalStream date={activityDate} timezone={activityTimezone} pollMs={activityPollMs} onListen={voice ? toggleRecapRead : undefined} listeningId={recapSpeech.status !== "idle" ? recapSpeech.intervalId : null} onViewRecaps={onOpenGoal} /> : null}</div></div> : <div className="conversation-scroll-region"><div className="progress-conversation workos-thread" ref={conversationRef}>{visibleHistory.length > 0 && <div className="progress-history">{visibleHistory.map((turn, index) => <Fragment key={turn.id ?? index}>
  {shouldShowChatDivider(visibleHistory, index) ? <ChatTimeDivider at={turn.createdAt} /> : null}
  <HistoryTurn
  turn={{
    ...turn,
    meta: turn.meta === "recorded" ? "Recorded" : turn.meta ? `${turn.meta} · Review below` : null,
    operations: turn.operations as HistoryTurnData["operations"],
    toolResults: turn.toolResults as HistoryTurnData["toolResults"],
  }}
  busy={busy}
  toolContext={toolContext}
  showMark={index === 0 || visibleHistory[index - 1]?.role !== "assistant"}
  collapseCards={index < visibleHistory.length - 1}
  onReviewOperations={(approved, rejected) => onReviewHistoryOperations?.(turn.id, approved, rejected)}
  onMarkSelectedDone={onMarkSelectedDone}
  onLoadSubtasks={onLoadSubtasks}
  onNavigateView={onNavigateView}
  onDecideNextStep={(item, decision, edits) => onDecideNextStep?.(turn.id, item, decision, edits)}
  onRetryOperation={(result) => onRetryHistoryOperation?.(turn.id, result)}
  />
</Fragment>)}</div>}{receipt ? <ChatTurn role="assistant" showMark={showLiveAssistantMark} receipt meta={receiptTitle} text={receipt.message} copySource={{ role: "assistant", receipt: receipt.message }} timestamp={receipt.createdAt} /> : pending ? <>{interpretation?.status === "loading" ? <ChatTurn role="assistant" variant="tool">{thinking ? <AvatarThinking stages={thinking.stages} active={thinking.active} startedAt={thinking.startedAt} activeLabel="Thinking" /> : <WorkingNowTrace label="Sending your update" />}</ChatTurn>
   : echoReply ? <ChatTurn role="assistant" showMark={showLiveAssistantMark} text={echoReply} stream onSettled={bumpSweep} timestamp={echoReplyAt} />
       : interpretation?.status === "ready" && interpretation.operations.length ? <ChatTurn role="assistant" showMark={showLiveAssistantMark} copySource={{ role: "assistant", text: interpretation.reply, operations: interpretation.operations, toolResults: interpretation.results }} timestamp={interpretationAt}><AssistantOperations interpretation={interpretation} busy={busy} toolContext={toolContext} onReviewOperations={onReviewOperations} onMarkSelectedDone={onMarkSelectedDone} onLoadSubtasks={onLoadSubtasks} onNavigateView={onNavigateView} onRetryOperation={onRetryOperation} /></ChatTurn>

  : interpretation?.status === "ready" ? null
   : <ChatTurn role="assistant" showMark={showLiveAssistantMark}><strong>{aiUnavailable ?? "What kind of update is this?"}</strong><p>Choose one so Work OS records it correctly.{aiUnavailable ? "" : " Nothing is inferred yet."}</p><div className="chat-kind-options">{options.map((option) => <button disabled={busy} key={option.kind} onClick={() => onClassify(option.kind)}>{option.label}</button>)}</div></ChatTurn>}</> : history.length ? null : <ChatWelcome displayName={displayName} mode={agendaMode ? "agenda" : "update"} seed={`in-app:${toolContext.shiftDate ?? "today"}`} />}</div></div>}
    </section>
    <div className="progress-input-shell">
      <WorkOsPromptBar autoFocus={open && panel === "update"} voice={voice} hotkeyLabel={VOICE_HOTKEY_LABEL} sweepSignal={sweepSignal} value={input} onChange={onInput} onSend={onSubmit} onFocus={onOpen} onPlus={onOpen} placeholder={agendaMode ? "Add a task — planning doesn't clock you in…" : "Share an update or add a task…"} ariaLabel="Share an update or add a task" canSend={!!input.trim()} busy={busy} commands={workOsChatCommands({ focus: () => onOpenGoal(), eod: () => onNavigateView?.("review") })} sendLabel="Review update type" />
    </div>
    </div>
    : <ConversationLauncher ref={launcherRef} mode={agendaMode ? "agenda" : "progress"} required={required} onOpen={onOpen} />}
  </ConversationSurface>;
}
