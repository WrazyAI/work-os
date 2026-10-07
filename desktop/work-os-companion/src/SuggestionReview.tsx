import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, MessageSquareText, X } from "lucide-react";
import { decideSuggestion, usePendingSuggestionsQuery } from "./workOsQueries";
import { workOsKeys } from "./queryClient";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";
import { useModalScrollLock } from "./modalScrollLock";
import { renderViewportSurface } from "./viewportSurface";
import { formatWorkOsDate } from "./dateFormat";
import type { PendingSuggestion } from "./types";

/** Label case for an operation or field key: `add_subtask` -> `Add subtask`. */
const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());

/** How the review surface names each proposal state. */
const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Waiting", className: "waiting" },
  failed: { label: "Didn't apply", className: "failed" },
  stale: { label: "Outdated", className: "stale" },
};

export function suggestionStatusMeta(status: string) {
  return STATUS_META[status] ?? { label: sentence(status || "waiting"), className: "waiting" };
}

/** Waiting items can be approved or rejected; failed ones retried or dismissed;
 * outdated ones only dismissed, because the task moved on. */
export function suggestionActions(status: string): { reject: string; accept: string | null } {
  if (status === "failed") return { reject: "Dismiss", accept: "Try again" };
  if (status === "stale") return { reject: "Dismiss", accept: null };
  return { reject: "Reject", accept: "Approve" };
}

export function suggestionTitle(proposal: PendingSuggestion) {
  const change = proposal.proposed_change ?? {};
  return String(change.name || change.title || change.summary || proposal.input_text || "Suggested change");
}

function suggestionFields(proposal: PendingSuggestion) {
  const change = proposal.proposed_change && typeof proposal.proposed_change === "object" ? proposal.proposed_change : {};
  return Object.entries(change)
    .filter(([key, value]) => !["name", "title", "summary"].includes(key) && ["string", "number", "boolean"].includes(typeof value))
    .slice(0, 2)
    .map(([key, value]) => ({ label: sentence(key), value: String(value) }));
}

export function suggestionCounts(suggestions: PendingSuggestion[]) {
  return {
    waiting: suggestions.filter((proposal) => proposal.status === "pending").length,
    attention: suggestions.filter((proposal) => proposal.status === "failed" || proposal.status === "stale").length,
  };
}

/** The settings band below What Otto remembers: one quiet split band that opens
 * the review modal. It never lists suggestions on the page itself. */
export function SuggestionReviewBand({ suggestions, loading, error, onOpen, onRetry }: {
  suggestions: PendingSuggestion[];
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const { waiting, attention } = suggestionCounts(suggestions);
  return <section className="suggestion-summary" aria-labelledby="suggestion-summary-title">
    <div className="suggestion-summary-identity">
      <span className="suggestion-summary-figure" aria-hidden="true"><MascotMark pose={MASCOT.idlePose} /></span>
      <div className="suggestion-summary-copy">
        <h3 id="suggestion-summary-title">Suggestions waiting for review</h3>
        <p>Task changes {MASCOT.name} proposed that were never decided or did not apply. Approve or dismiss them here.</p>
      </div>
    </div>
    <div className="suggestion-summary-side">
      {error ? <p className="suggestion-summary-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></p>
        : loading ? <span className="suggestion-summary-loading" role="status">Loading suggestions…</span>
          : <div className="suggestion-summary-stats" aria-label={`${waiting} waiting, ${attention} need attention`}>
            <span className={waiting > 0 ? "attention" : ""}><b>{waiting}</b><small>waiting</small></span>
            <span className={attention > 0 ? "attention" : ""}><b>{attention}</b><small>need attention</small></span>
          </div>}
      <button type="button" className="suggestion-summary-view" onClick={onOpen}>Review</button>
    </div>
  </section>;
}

/** One proposal card: the operation, what it would change, and the one
 * decision that resolves it. */
export function SuggestionCard({ proposal, busy, onDecide }: {
  proposal: PendingSuggestion;
  busy: boolean;
  onDecide: (id: string, decision: "accept" | "reject") => void;
}) {
  const meta = suggestionStatusMeta(proposal.status);
  const actions = suggestionActions(proposal.status);
  const fields = suggestionFields(proposal);
  const proposed = /^\d{4}-\d{2}-\d{2}/.test(proposal.created_at) ? formatWorkOsDate(proposal.created_at.slice(0, 10)) : null;
  return <article className="suggestion-card" data-status={proposal.status}>
    <header className="suggestion-card-head">
      <div className="suggestion-card-identity">
        <span className="suggestion-card-icon" aria-hidden="true"><MessageSquareText size={15} /></span>
        <div>
          <span className="suggestion-card-kind">{sentence(String(proposal.operation || "workspace_change"))}</span>
          <h4>{suggestionTitle(proposal)}</h4>
        </div>
      </div>
      <em className={`suggestion-status ${meta.className}`}>{meta.label}</em>
    </header>
    {proposal.input_text ? <blockquote className="suggestion-quote">“{proposal.input_text}”</blockquote> : null}
    {fields.length > 0 && <dl className="suggestion-fields">{fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>}
    {proposal.status === "failed" && proposal.failure_reason ? <p className="suggestion-reason" role="status">{proposal.failure_reason}</p> : null}
    {proposal.status === "stale" ? <p className="suggestion-reason">The task changed after this was drafted, so it no longer applies.</p> : null}
    <footer className="suggestion-card-foot">
      <small>{proposed ? `Proposed ${proposed}` : "Proposed earlier"}</small>
      <div className="suggestion-card-actions">
        <button type="button" disabled={busy} onClick={() => onDecide(proposal.id, "reject")}>{actions.reject}</button>
        {actions.accept ? <button type="button" className="primary" disabled={busy} onClick={() => onDecide(proposal.id, "accept")}><Check size={14} aria-hidden="true" /> {actions.accept}</button> : null}
      </div>
    </footer>
  </article>;
}

/** The management modal: what waits for a decision, and what never applied. */
export function SuggestionReviewModal({ suggestions, busyId, error, onDecide, onClose }: {
  suggestions: PendingSuggestion[];
  busyId: string | null;
  error: string | null;
  onDecide: (id: string, decision: "accept" | "reject") => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useModalScrollLock(true);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      dialog.querySelector<HTMLElement>(".suggestion-modal-close")?.focus();
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((item) => item.offsetParent !== null);
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
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  const waiting = suggestions.filter((proposal) => proposal.status === "pending");
  const attention = suggestions.filter((proposal) => proposal.status !== "pending");
  return renderViewportSurface(
    <div className="suggestion-modal" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="suggestion-modal-panel" role="dialog" aria-modal="true" aria-labelledby="suggestion-modal-title" tabIndex={-1}>
        <header className="suggestion-modal-head">
          <div>
            <h2 id="suggestion-modal-title">Suggestion review</h2>
            <p>Task changes {MASCOT.name} proposed that still need a decision. Nothing reaches Nifty until you approve it.</p>
          </div>
          <button type="button" className="suggestion-modal-close" aria-label="Close suggestion review" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="suggestion-modal-body">
          {error && <p className="suggestion-modal-error" role="alert">{error}</p>}
          {suggestions.length === 0 && !error
            ? <div className="suggestion-modal-empty"><Check size={22} aria-hidden="true" /><strong>Nothing is waiting</strong><span>New suggestions appear here before anything is written back.</span></div>
            : <>
              {waiting.length > 0 && <section className="suggestion-group" aria-labelledby="suggestion-waiting-title">
                <header className="suggestion-group-head"><h3 id="suggestion-waiting-title">Waiting for your decision</h3><span>{waiting.length}</span></header>
                <div className="suggestion-group-list">{waiting.map((proposal) => <SuggestionCard key={proposal.id} proposal={proposal} busy={busyId === proposal.id} onDecide={onDecide} />)}</div>
              </section>}
              {attention.length > 0 && <section className="suggestion-group" aria-labelledby="suggestion-attention-title">
                <header className="suggestion-group-head"><h3 id="suggestion-attention-title">Couldn&apos;t be applied</h3><span>{attention.length}</span></header>
                <div className="suggestion-group-list">{attention.map((proposal) => <SuggestionCard key={proposal.id} proposal={proposal} busy={busyId === proposal.id} onDecide={onDecide} />)}</div>
              </section>}
            </>}
        </div>
      </section>
    </div>,
  );
}

/** Self-contained settings section: band, data, decisions, and modal. Approving
 * or dismissing refreshes the task surfaces the change could touch. */
export function SuggestionReview() {
  const queryClient = useQueryClient();
  const query = usePendingSuggestionsQuery({ enabled: true });
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (id: string, decision: "accept" | "reject") => {
    setBusyId(id);
    setError(null);
    try {
      await decideSuggestion(id, decision);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workOsKeys.suggestions() }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.day("compact") }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.day("details") }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskHistory() }),
        queryClient.invalidateQueries({ queryKey: workOsKeys.taskBacklog() }),
      ]);
    } catch (value) {
      setError(value instanceof Error ? value.message : "That suggestion could not be updated.");
    } finally {
      setBusyId(null);
    }
  };

  return <>
    <SuggestionReviewBand
      suggestions={query.data ?? []}
      loading={query.isPending && !query.data}
      error={query.error ? (query.error instanceof Error ? query.error.message : "Suggestions could not be loaded.") : null}
      onOpen={() => setOpen(true)}
      onRetry={() => void query.refetch()}
    />
    {open && <SuggestionReviewModal
      suggestions={query.data ?? []}
      busyId={busyId}
      error={error}
      onDecide={(id, decision) => void decide(id, decision)}
      onClose={() => setOpen(false)}
    />}
  </>;
}
