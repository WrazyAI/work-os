import { useEffect, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { apiRequest } from "./api";
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

/** Work memory, split into its three classes: what needs a decision, what Otto
 * has verified, and the dated activity it drew on. Each class is its own
 * full-width section with its own treatment — the panel must never fall back
 * into the settings card grid, or the sections interleave. */
export function MemoryPanel({ facts, recent, busy, error, onReview, onForget }: {
  facts: MemoryFact[];
  recent: MemoryRecent[];
  busy: boolean;
  error: string | null;
  onReview: (id: string, status: "confirmed" | "rejected") => void;
  onForget: (id: string) => void;
}) {
  const candidates = facts.filter((fact) => fact.review_status === "candidate");
  const confirmed = facts.filter((fact) => fact.review_status === "confirmed");
  const visibleRecent = recent.slice(0, 8);
  return (
    <section className="memory-panel" aria-labelledby="memory-panel-title">
      <header className="memory-head">
        <div>
          <h3 id="memory-panel-title">What Otto remembers</h3>
          <p>Otto proposes facts as you work. Nothing is remembered until you keep it, and you can forget anything at any time.</p>
        </div>
        {candidates.length > 0 && <span className="memory-pending">{candidates.length} waiting for review</span>}
      </header>
      {error && <p className="memory-error" role="alert">{error}</p>}

      <section className="memory-section review" aria-labelledby="memory-review-title">
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
        ) : <p className="memory-empty">Nothing is waiting for your review. Otto asks before remembering anything new.</p>}
      </section>

      <section className="memory-section facts" aria-labelledby="memory-facts-title">
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
        ) : <p className="memory-empty">No kept facts yet. Confirm a proposal above to teach Otto what helps.</p>}
      </section>

      <section className="memory-section activity" aria-labelledby="memory-activity-title">
        <header className="memory-section-head">
          <h4 id="memory-activity-title">Recent activity</h4>
          <span className="memory-count" aria-label={`${recent.length} recent memories`}>{recent.length}</span>
        </header>
        {visibleRecent.length ? (
          <>
            <ul className="memory-rows feed">
              {visibleRecent.map((entry) => (
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
            <p className="memory-provenance">Context Otto drew on while working — dated history only, never proof that work was completed.</p>
          </>
        ) : <p className="memory-empty">No memories recorded yet. Activity appears here as Otto works with you.</p>}
      </section>
    </section>
  );
}

export function MemorySettings() {
  const [data, setData] = useState<MemoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!data && !error) {
    return (
      <section className="memory-panel" aria-labelledby="memory-panel-title" aria-busy="true">
        <header className="memory-head"><div><h3 id="memory-panel-title">What Otto remembers</h3><p>Loading memory…</p></div></header>
      </section>
    );
  }

  return (
    <MemoryPanel
      facts={data?.facts ?? []}
      recent={data?.recent ?? []}
      busy={busy}
      error={error}
      onReview={(id, status) => void review(id, status)}
      onForget={(id) => void forget(id)}
    />
  );
}
