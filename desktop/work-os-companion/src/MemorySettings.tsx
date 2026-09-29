import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, Trash2, X } from "lucide-react";
import { apiRequest } from "./api";
import { MASCOT } from "./mascot";
import { MascotMark } from "./chat/MascotMark";
import { useModalScrollLock } from "./modalScrollLock";
import { renderViewportSurface } from "./viewportSurface";
import { formatWorkOsDate } from "./dateFormat";

export interface MemoryFact {
  id: string;
  content: string;
  review_status: "candidate" | "confirmed" | "rejected";
  fact_key: string | null;
  local_date: string | null;
  occurred_at: string;
}

export interface MemoryRecent {
  id: string;
  kind: string;
  content: string;
  summary: string | null;
  local_date: string | null;
  occurred_at: string;
}

export interface MemoryView {
  facts: MemoryFact[];
  recent: MemoryRecent[];
}

/** The activity feed shows this many rows before the Show all control. */
const ACTIVITY_PAGE_SIZE = 8;

const KIND_LABELS: Record<string, string> = {
  check_in: "Check-in",
  plan: "Plan",
  task_event: "Task",
  evidence: "Evidence",
  eod: "EOD",
  conversation: "Conversation",
  digest: "Digest",
};

/** Human date for a memory row. The API can hand back a full timestamp (a SQL
 * date serialized as an instant), so normalize to the calendar day first. */
export function memoryDateLabel(entry: { local_date: string | null; occurred_at: string }): string {
  const raw = entry.local_date || entry.occurred_at;
  const dateOnly = typeof raw === "string" ? raw.slice(0, 10) : "";
  return formatWorkOsDate(dateOnly, "—");
}

const newestFirst = (left: MemoryFact, right: MemoryFact) => String(right.occurred_at).localeCompare(String(left.occurred_at));

/**
 * The settings surface stays a quiet split band: the mascot and the model
 * statement on the left, the counts and the one management action on the
 * right. Facts themselves never render here — the modal owns them, so the
 * Settings page keeps its table rhythm instead of growing a fourth section.
 */
export function MemorySummary({ facts, loading, error, onOpen, onRetry }: {
  facts: MemoryFact[];
  loading: boolean;
  error: string | null;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const remembered = facts.filter((fact) => fact.review_status === "confirmed").length;
  const candidates = facts.filter((fact) => fact.review_status === "candidate").length;
  return <section className="memory-summary" aria-labelledby="memory-summary-title">
    <div className="memory-summary-identity">
      <span className="memory-summary-figure" aria-hidden="true"><MascotMark pose={MASCOT.idlePose} /></span>
      <div className="memory-summary-copy">
        <h3 id="memory-summary-title">What {MASCOT.name} remembers</h3>
        <p>{MASCOT.name} proposes facts as you work. Nothing is remembered until you keep it, and you can forget anything at any time.</p>
      </div>
    </div>
    <div className="memory-summary-side">
      {error ? <p className="memory-summary-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Retry</button></p>
        : loading ? <span className="memory-summary-loading" role="status">Loading memory…</span>
          : <div className="memory-summary-stats" aria-label={`${remembered} remembered, ${candidates} waiting for review`}>
            <span><b>{remembered}</b><small>remembered</small></span>
            <span className={candidates > 0 ? "attention" : ""}><b>{candidates}</b><small>need review</small></span>
          </div>}
      <button type="button" className="memory-summary-view" onClick={onOpen}>View</button>
    </div>
  </section>;
}

export function MemoryReviewSection({ facts, busy, onReview }: {
  facts: MemoryFact[];
  busy: boolean;
  onReview: (id: string, status: "confirmed" | "rejected") => void;
}) {
  const candidates = [...facts].filter((fact) => fact.review_status === "candidate").sort(newestFirst);
  return <section className="memory-section review" aria-labelledby="memory-review-title">
    <header className="memory-section-head">
      <h4 id="memory-review-title">Waiting for your review</h4>
      <span className="memory-count" aria-label={`${candidates.length} waiting for review`}>{candidates.length}</span>
    </header>
    {candidates.length ? (
      <div className="memory-cards">
        {candidates.map((fact) => (
          <article className="memory-card" key={fact.id}>
            <div className="memory-copy">
              <strong>{fact.content}</strong>
              <small>Proposed {memoryDateLabel(fact)}</small>
            </div>
            <div className="memory-actions">
              <button type="button" className="memory-keep" disabled={busy} onClick={() => onReview(fact.id, "confirmed")}><Check size={14} aria-hidden="true" /> Keep</button>
              <button type="button" className="memory-reject" disabled={busy} onClick={() => onReview(fact.id, "rejected")}><X size={14} aria-hidden="true" /> Not true</button>
            </div>
          </article>
        ))}
      </div>
    ) : <p className="memory-empty">Nothing is waiting for your review. {MASCOT.name} asks before remembering anything new.</p>}
  </section>;
}

export function MemoryFactsSection({ facts, busy, onForget }: {
  facts: MemoryFact[];
  busy: boolean;
  onForget: (id: string) => void;
}) {
  const confirmed = [...facts].filter((fact) => fact.review_status === "confirmed").sort(newestFirst);
  return <section className="memory-section facts" aria-labelledby="memory-facts-title">
    <header className="memory-section-head">
      <h4 id="memory-facts-title">Remembered facts</h4>
      <span className="memory-count" aria-label={`${confirmed.length} kept facts`}>{confirmed.length}</span>
    </header>
    {confirmed.length ? (
      <ul className="memory-rows">
        {confirmed.map((fact) => (
          <li className="memory-row" key={fact.id}>
            <Check size={14} className="memory-check" aria-hidden="true" />
            <div className="memory-copy">
              <strong>{fact.content}</strong>
              <small>Kept {memoryDateLabel(fact)}</small>
            </div>
            <button type="button" className="memory-forget" disabled={busy} aria-label={`Forget: ${fact.content}`} title="Forget" onClick={() => onForget(fact.id)}><Trash2 size={14} aria-hidden="true" /><span>Forget</span></button>
          </li>
        ))}
      </ul>
    ) : <p className="memory-empty">No kept facts yet. Confirm a proposal above to teach {MASCOT.name} what helps.</p>}
  </section>;
}

export function MemoryActivitySection({ recent, busy, onForget }: {
  recent: MemoryRecent[];
  busy: boolean;
  onForget: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? recent : recent.slice(0, ACTIVITY_PAGE_SIZE);
  return <section className="memory-section activity" aria-labelledby="memory-activity-title">
    <header className="memory-section-head">
      <h4 id="memory-activity-title">Recent activity</h4>
      <span className="memory-count" aria-label={`${recent.length} recent memories`}>{recent.length}</span>
    </header>
    {visible.length ? (
      <>
        <ul className="memory-rows feed">
          {visible.map((entry) => (
            <li className="memory-row" key={entry.id}>
              <span className="memory-kind">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
              <div className="memory-copy">
                <p>{entry.summary || entry.content}</p>
                <small>{memoryDateLabel(entry)}</small>
              </div>
              <button type="button" className="memory-forget" disabled={busy} aria-label={`Forget memory from ${memoryDateLabel(entry)}`} title="Forget" onClick={() => onForget(entry.id)}><Trash2 size={14} aria-hidden="true" /><span>Forget</span></button>
            </li>
          ))}
        </ul>
        {recent.length > ACTIVITY_PAGE_SIZE && (
          <button type="button" className="memory-show-all" aria-expanded={showAll} onClick={() => setShowAll((value) => !value)}>
            {showAll ? "Show less" : `Show all ${recent.length}`}
          </button>
        )}
        <p className="memory-provenance">Context {MASCOT.name} drew on while working — dated history only, never proof that work was completed.</p>
      </>
    ) : <p className="memory-empty">No memories recorded yet. Activity appears here as {MASCOT.name} works with you.</p>}
  </section>;
}

/**
 * The facts modal. Two peer tabs — what needs a decision, and what has been
 * kept (with the dated activity beneath it) — so the settings summary can stay
 * compact while every fact keeps its Keep / Not true / Forget behavior.
 */
export function MemoryModal({ facts, recent, busy, error, onReview, onForget, onClose }: {
  facts: MemoryFact[];
  recent: MemoryRecent[];
  busy: boolean;
  error: string | null;
  onReview: (id: string, status: "confirmed" | "rejected") => void;
  onForget: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"review" | "remembered">("review");
  const dialogRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The parent recreates onClose every render; the focus lifecycle must still
  // run once per mount, or busy-state re-renders would steal focus back to the
  // tab and lose the element that opened the modal.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useModalScrollLock(true);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      dialog.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
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
  const candidates = facts.filter((fact) => fact.review_status === "candidate").length;
  const confirmed = facts.filter((fact) => fact.review_status === "confirmed").length;
  const selectTab = (next: "review" | "remembered") => setTab(next);
  const onTabKey = (event: ReactKeyboardEvent, index: number) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? 1 : event.key === "ArrowRight" ? (index + 1) % 2 : (index - 1 + 2) % 2;
    setTab(nextIndex === 0 ? "review" : "remembered");
    tabRefs.current[nextIndex]?.focus();
  };
  return renderViewportSurface(
    <div className="memory-modal" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="memory-modal-panel" role="dialog" aria-modal="true" aria-labelledby="memory-modal-title" tabIndex={-1}>
        <header className="memory-modal-head">
          <div>
            <h2 id="memory-modal-title">What {MASCOT.name} remembers</h2>
            <p>{MASCOT.name} proposes facts as you work. Nothing is remembered until you keep it, and you can forget anything at any time.</p>
          </div>
          <button type="button" className="memory-modal-close" aria-label="Close memory" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="memory-tabs" role="tablist" aria-label="Memory views">
          <button
            type="button"
            role="tab"
            id="memory-tab-review"
            aria-selected={tab === "review"}
            aria-controls="memory-panel-review"
            tabIndex={tab === "review" ? 0 : -1}
            className={`memory-tab${tab === "review" ? " active" : ""}`}
            ref={(node) => { tabRefs.current[0] = node; }}
            onClick={() => selectTab("review")}
            onKeyDown={(event) => onTabKey(event, 0)}
          >Needs review<span className={`memory-tab-count${candidates > 0 ? " attention" : ""}`}>{candidates}</span></button>
          <button
            type="button"
            role="tab"
            id="memory-tab-remembered"
            aria-selected={tab === "remembered"}
            aria-controls="memory-panel-remembered"
            tabIndex={tab === "remembered" ? 0 : -1}
            className={`memory-tab${tab === "remembered" ? " active" : ""}`}
            ref={(node) => { tabRefs.current[1] = node; }}
            onClick={() => selectTab("remembered")}
            onKeyDown={(event) => onTabKey(event, 1)}
          >Remembered<span className="memory-tab-count">{confirmed}</span></button>
        </div>
        <div className="memory-modal-body" id={`memory-panel-${tab}`} role="tabpanel" aria-labelledby={`memory-tab-${tab}`}>
          {error && <p className="memory-error" role="alert">{error}</p>}
          {tab === "review"
            ? <MemoryReviewSection facts={facts} busy={busy} onReview={onReview} />
            : <><MemoryFactsSection facts={facts} busy={busy} onForget={onForget} /><MemoryActivitySection recent={recent} busy={busy} onForget={onForget} /></>}
        </div>
      </section>
    </div>,
  );
}

export function MemorySettings() {
  const [data, setData] = useState<MemoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try {
      setData(await apiRequest<MemoryView>("/api/work-os/me/memory"));
      setError(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Memory could not be loaded.");
    }
  };

  useEffect(() => { void load(); }, []);

  const review = async (id: string, status: "confirmed" | "rejected") => {
    setBusy(true);
    try {
      await apiRequest(`/api/work-os/me/memory/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setData((current) => current ? { ...current, facts: current.facts.map((fact) => fact.id === id ? { ...fact, review_status: status } : fact) } : current);
      setError(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : "That fact could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const forget = async (id: string) => {
    setBusy(true);
    try {
      await apiRequest(`/api/work-os/me/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
      setData((current) => current ? {
        facts: current.facts.filter((fact) => fact.id !== id),
        recent: current.recent.filter((entry) => entry.id !== id),
      } : current);
      setError(null);
    } catch (value) {
      setError(value instanceof Error ? value.message : "That memory could not be forgotten.");
    } finally {
      setBusy(false);
    }
  };

  return <>
    <MemorySummary
      facts={data?.facts ?? []}
      loading={!data && !error}
      error={data ? null : error}
      onOpen={() => setOpen(true)}
      onRetry={() => void load()}
    />
    {open && <MemoryModal
      facts={data?.facts ?? []}
      recent={data?.recent ?? []}
      busy={busy}
      error={error}
      onReview={(id, status) => void review(id, status)}
      onForget={(id) => void forget(id)}
      onClose={() => setOpen(false)}
    />}
  </>;
}
