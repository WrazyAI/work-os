/**
 * The approved recap's next steps, decided in the compact bubble.
 *
 * This is the same moment the chat renders — `RecapNextStepsCard` remains the
 * durable record — but the bubble is the front door: confirming a recap no
 * longer opens the panel. The list is deliberately a decision surface, not a
 * transcript: every suggestion is accepted, edited, or skipped on its own, and
 * nothing is written until its own control is pressed.
 *
 * While Otto reads, the spoken line is marked in place instead of replacing the
 * list with a second copy of the words. The server returns the words and the
 * `ref` of the line each belongs to; the row highlights, the list follows.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Pencil, RotateCw, SkipForward, Sparkles, X } from "lucide-react";
import {
  ACCEPT_LABEL,
  APPLIED_LABEL,
  KIND_LABEL,
  type RecapNextStepState,
  type RecapNextStepsMoment,
} from "./RecapNextStepsCard";
import type { RecapSpeechSnapshot } from "./recapSpeechPlayer";
import type { RecapNextStepItem } from "./types";

function stateFor(moment: RecapNextStepsMoment, item: RecapNextStepItem): RecapNextStepState {
  return moment.states[item.proposalId] ?? "pending";
}

/** What the bubble says after the decisions settle. Mirrors the chat card's
 * result line so the two surfaces never count the same outcome differently. */
export function nextStepsResultLine(moment: RecapNextStepsMoment): string {
  const applied = moment.items.filter((item) => stateFor(moment, item) === "applied").length;
  const skipped = moment.items.filter((item) => stateFor(moment, item) === "skipped").length;
  const failed = moment.items.filter((item) => stateFor(moment, item) === "failed").length;
  const parts = [
    applied ? `${applied} ${applied === 1 ? "change" : "changes"} applied` : null,
    skipped ? `${skipped} skipped` : null,
    failed ? `${failed} failed` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Nothing to change";
}

export function nextStepsAllSettled(moment: RecapNextStepsMoment): boolean {
  return moment.items.length > 0
    && moment.items.every((item) => !["pending", "processing"].includes(stateFor(moment, item)));
}

export function nextStepsHasFailure(moment: RecapNextStepsMoment): boolean {
  return moment.items.some((item) => stateFor(moment, item) === "failed");
}

/** Which frosted edges the decision list shows: only where more rows continue.
 * A list that fits, or one at its first row, must not look cut off. */
export function nextStepsScrollEdges(scrollTop: number, clientHeight: number, scrollHeight: number) {
  const overflows = scrollHeight > clientHeight + 2;
  return {
    top: overflows && scrollTop > 2,
    bottom: overflows && scrollTop + clientHeight < scrollHeight - 2,
  };
}

export function NextStepsBubble({
  moment,
  busy,
  speech,
  voiceAvailable,
  reduced,
  onDecide,
  onRetry,
  onListen,
  onStopListening,
  onDismiss,
  onHeightChange,
}: {
  moment: RecapNextStepsMoment;
  busy: boolean;
  speech: RecapSpeechSnapshot;
  voiceAvailable: boolean;
  reduced: boolean;
  onDecide: (item: RecapNextStepItem, decision: "accept" | "skip", edits?: { name?: string }) => void;
  onRetry: () => void;
  onListen: () => void;
  onStopListening: () => void;
  onDismiss: () => void;
  /** The card's natural height, so the companion window can fit it. */
  onHeightChange?: (height: number) => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [edited, setEdited] = useState<Record<string, string>>({});
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const listRef = useRef<HTMLUListElement | null>(null);
  const [scrollEdges, setScrollEdges] = useState({ top: false, bottom: false });

  const shown = moment.status === "ready" || moment.status === "done";
  const reading = speech.status === "playing" || speech.status === "loading";
  const loading = speech.status === "loading";
  const activeRef = speech.status === "idle" || speech.status === "finished"
    ? null
    : speech.lines[speech.activeIndex]?.ref ?? null;
  const activeItemId = activeRef && activeRef !== "lead" ? activeRef.split(":")[0] : null;
  const activePart = activeRef?.endsWith(":why") ? "why" : "title";
  const settled = moment.status === "done";
  const failed = nextStepsHasFailure(moment);
  const result = nextStepsResultLine(moment);
  // The route speaks the stored suggestion set. While a title is edited but
  // not yet accepted, the bubble would show words the voice does not have, so
  // the read waits for the decision instead of saying the wrong thing.
  const pendingEdits = Object.entries(edited).some(([proposalId, title]) => {
    const item = moment.items.find((candidate) => candidate.proposalId === proposalId);
    return item ? item.title !== title : false;
  });

  const titleFor = (item: RecapNextStepItem) => edited[item.proposalId] ?? item.title;

  // The frosted edges exist only where there is more to scroll: a list at its
  // top must not look as if it is cut off, and a finished list must not keep a
  // dead blur under its last row.
  const syncScrollEdges = useCallback((): void => {
    const list = listRef.current;
    if (!list) {
      setScrollEdges({ top: false, bottom: false });
      return;
    }
    const next = nextStepsScrollEdges(list.scrollTop, list.clientHeight, list.scrollHeight);
    setScrollEdges((current) => current.top === next.top && current.bottom === next.bottom ? current : next);
  }, []);

  useEffect(() => {
    if (!shown) return;
    const list = listRef.current;
    if (!list) return;
    // Measure once the browser has laid the rows out: a first paint can report
    // an overflowing list as exactly its visible height.
    syncScrollEdges();
    const frame = requestAnimationFrame(() => syncScrollEdges());
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => syncScrollEdges());
    observer?.observe(list);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [shown, moment.items.length, syncScrollEdges]);

  // Report the card's natural height. The window grows for next steps, and a
  // fixed per-row estimate is wrong as soon as a title or reason wraps further
  // than expected; measuring is what keeps the header inside the window.
  useEffect(() => {
    const node = sectionRef.current;
    const report = onHeightChange;
    if (!node || !report) return;
    const measure = (): void => {
      const list = node.querySelector<HTMLElement>(".avatar-next-steps-list");
      let height: number;
      if (list) {
        // The chrome is stable; the list contributes its content height capped
        // by its CSS max-height. The card's own scrollHeight would report a
        // squeezed list as short and shrink the window right back.
        const cap = Number.parseFloat(getComputedStyle(list).maxHeight);
        const rows = list.scrollHeight;
        height = node.offsetHeight - list.offsetHeight + (Number.isFinite(cap) ? Math.min(rows, cap) : rows);
      } else {
        height = Math.max(node.offsetHeight, node.scrollHeight);
      }
      report(Math.ceil(height));
    };
    measure();
    const frame = requestAnimationFrame(measure);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [onHeightChange, moment.status, moment.items.length]);

  // Follow the voice: the row being spoken stays visible inside the list, never
  // scrolling the whole companion window.
  useEffect(() => {
    if (!activeItemId) return;
    const row = rowRefs.current.get(activeItemId);
    if (!row) return;
    row.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [activeItemId, activePart, reduced]);

  // A decided row no longer offers an editor.
  useEffect(() => {
    if (!editingId) return;
    const item = moment.items.find((candidate) => candidate.proposalId === editingId);
    if (!item || !["pending", "processing"].includes(stateFor(moment, item))) {
      setEditingId(null);
    }
  }, [editingId, moment]);

  return (
    <section
      ref={sectionRef}
      className="avatar-next-steps"
      aria-label="Suggested next steps"
      data-phase={moment.status}
      data-reading={reading ? "true" : undefined}
      data-workos-tool-surface="recap-next-steps-bubble"
      data-workos-tool-state={moment.status}
    >
      <header className="avatar-next-steps-head">
        <span className="avatar-next-steps-mark" aria-hidden="true"><Sparkles size={13} /></span>
        <div className="avatar-next-steps-title">
          <strong>Next steps</strong>
          <small>{moment.label ? `From your ${moment.label} recap` : "From your approved recap"}</small>
        </div>
        <div className="avatar-next-steps-tools">
          {voiceAvailable && shown && moment.items.length > 0 ? (
            reading ? (
              <button type="button" className="avatar-next-steps-tool" onClick={onStopListening}>
                {loading ? "Stop" : "Stop reading"}
              </button>
            ) : (
              <button
                type="button"
                className="avatar-next-steps-tool"
                disabled={pendingEdits}
                title={pendingEdits ? "Accept or cancel your edit before listening" : "Hear these suggestions"}
                onClick={onListen}
              >Listen</button>
            )
          ) : null}
          <button
            type="button"
            className="avatar-next-steps-tool avatar-next-steps-close"
            aria-label="Not now — keep these in the chat"
            title="Not now"
            onClick={onDismiss}
          ><X size={12} aria-hidden="true" /></button>
        </div>
      </header>

      {moment.status === "drafting" ? (
        <div className="avatar-next-steps-wait" role="status">
          <span className="avatar-reading-dots" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          <div>
            <strong>Working out what could come next</strong>
            <span>Otto is reading your recap for anything worth doing.</span>
          </div>
        </div>
      ) : null}

      {moment.status === "empty" ? (
        <div className="avatar-next-steps-wait" role="status">
          <strong>Nothing new to action</strong>
          <span>This recap did not turn up anything worth adding or closing.</span>
        </div>
      ) : null}

      {moment.status === "failed" ? (
        <div className="avatar-next-steps-wait" role="status">
          <strong>Next steps could not be drafted</strong>
          <span>{moment.error ?? "This recap can still be read below."}</span>
          {onRetry ? <button type="button" className="avatar-next-steps-retry" onClick={onRetry}><RotateCw size={11} aria-hidden="true" /> Try again</button> : null}
        </div>
      ) : null}

      {shown && moment.items.length > 0 ? (
        <div
          className="avatar-next-steps-scroll"
          data-top={scrollEdges.top ? "true" : undefined}
          data-bottom={scrollEdges.bottom ? "true" : undefined}
        >
          <span className="avatar-next-steps-shade" data-edge="top" aria-hidden="true" />
          <ul
            className="avatar-next-steps-list"
            ref={listRef}
            aria-label="Suggested next steps"
            aria-busy={busy ? "true" : undefined}
            onScroll={syncScrollEdges}
          >
          {moment.items.map((item) => {
            const state = stateFor(moment, item);
            const editing = editingId === item.proposalId;
            const accept = () => onDecide(item, "accept", edited[item.proposalId] && edited[item.proposalId] !== item.title ? { name: edited[item.proposalId] } : undefined);
            const active = activeItemId === item.proposalId;
            return (
              <li
                key={item.proposalId}
                ref={(node) => {
                  if (node) rowRefs.current.set(item.proposalId, node);
                  else rowRefs.current.delete(item.proposalId);
                }}
                data-state={state}
                data-active={active ? "true" : undefined}
                aria-current={active ? "true" : undefined}
              >
                <span className="avatar-next-steps-kind">{KIND_LABEL[item.operation]}</span>
                {editing ? (
                  <div className="avatar-next-steps-edit">
                    <input
                      value={draft}
                      maxLength={240}
                      aria-label="Suggestion title"
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && draft.trim()) {
                          setEdited((current) => ({ ...current, [item.proposalId]: draft.trim() }));
                          setEditingId(null);
                        }
                        if (event.key === "Escape") setEditingId(null);
                      }}
                    />
                    <div className="avatar-next-steps-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={!draft.trim() || busy}
                        onClick={() => {
                          setEdited((current) => ({ ...current, [item.proposalId]: draft.trim() }));
                          setEditingId(null);
                        }}
                      >Save</button>
                      <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <strong className={active && activePart === "title" ? "is-speaking" : undefined}>{titleFor(item)}</strong>
                    <small className={active && activePart === "why" ? "is-speaking" : undefined}>{item.rationale}</small>
                  </>
                )}

                {state === "pending" || state === "processing" ? (
                  !editing ? (
                    <div className="avatar-next-steps-actions">
                      <button
                        type="button"
                        className="primary"
                        disabled={busy || state === "processing"}
                        onClick={accept}
                      >{state === "processing" ? "Saving…" : ACCEPT_LABEL[item.operation]}</button>
                      {item.editable ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(item.proposalId);
                            setDraft(titleFor(item));
                          }}
                        ><Pencil size={11} aria-hidden="true" /> Edit</button>
                      ) : null}
                      <button type="button" disabled={busy || state === "processing"} onClick={() => onDecide(item, "skip")}>
                        <SkipForward size={11} aria-hidden="true" /> Skip
                      </button>
                    </div>
                  ) : null
                ) : (
                  <div className="avatar-next-steps-state">
                    <span>{state === "applied" ? `${APPLIED_LABEL[item.operation]} ✓` : state === "skipped" ? "Skipped" : "Failed"}</span>
                    {state === "failed" ? (
                      <>
                        <small>{moment.failures[item.proposalId] ?? "The change could not be applied."}</small>
                        <button type="button" disabled={busy} onClick={accept}><RotateCw size={11} aria-hidden="true" /> Retry</button>
                      </>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
          </ul>
          <span className="avatar-next-steps-shade" data-edge="bottom" aria-hidden="true" />
        </div>
      ) : null}

      {settled && !failed ? (
        <div className="avatar-next-steps-done" role="status">
          <span className="avatar-next-steps-check" aria-hidden="true"><Check size={12} /></span>
          <strong>{result}</strong>
        </div>
      ) : null}
    </section>
  );
}
