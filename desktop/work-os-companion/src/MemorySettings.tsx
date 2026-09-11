import { useEffect, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import { apiRequest } from "./api";

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

function memoryDate(entry: { local_date: string | null; occurred_at: string }): string {
  return entry.local_date ?? entry.occurred_at.slice(0, 10);
}

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
  return (
    <section className="settings-panel memory-panel" aria-labelledby="memory-panel-title">
      <header className="memory-head">
        <h3 id="memory-panel-title">What Otto remembers</h3>
        <p>Otto proposes facts as you work. Nothing is remembered until you keep it, and you can forget anything at any time.</p>
      </header>
      {error && <p className="memory-error" role="alert">{error}</p>}
      {candidates.length > 0 && (
        <>
          <h4 className="memory-group">Waiting for your review</h4>
          {candidates.map((fact) => (
            <article className="memory-item" key={fact.id}>
              <div className="memory-copy">
                <strong>{fact.content}</strong>
                <small>Proposed {memoryDate(fact)}</small>
              </div>
              <div className="memory-actions">
                <button disabled={busy} onClick={() => onReview(fact.id, "confirmed")}><Check size={14} /> Keep</button>
                <button disabled={busy} onClick={() => onReview(fact.id, "rejected")}><X size={14} /> Not true</button>
              </div>
            </article>
          ))}
        </>
      )}
      <h4 className="memory-group">Remembered facts</h4>
      {confirmed.length ? confirmed.map((fact) => (
        <article className="memory-item" key={fact.id}>
          <div className="memory-copy">
            <strong>{fact.content}</strong>
            <small>Kept {memoryDate(fact)}</small>
          </div>
          <div className="memory-actions">
            <button disabled={busy} aria-label={`Forget: ${fact.content}`} onClick={() => onForget(fact.id)}><Trash2 size={14} /></button>
          </div>
        </article>
      )) : <p className="memory-empty">No kept facts yet. Confirm a proposal above to teach Otto what helps.</p>}
      <h4 className="memory-group">Recent memories</h4>
      {recent.length ? recent.slice(0, 8).map((entry) => (
        <article className="memory-item" key={entry.id}>
          <div className="memory-copy">
            <span className="memory-kind">{KIND_LABELS[entry.kind] ?? entry.kind}</span>
            <p>{entry.summary || entry.content}</p>
            <small>{memoryDate(entry)}</small>
          </div>
          <div className="memory-actions">
            <button disabled={busy} aria-label={`Forget memory from ${memoryDate(entry)}`} onClick={() => onForget(entry.id)}><Trash2 size={14} /></button>
          </div>
        </article>
      )) : <p className="memory-empty">No memories recorded yet.</p>}
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
      <section className="settings-panel memory-panel" aria-labelledby="memory-panel-title">
        <header className="memory-head"><h3 id="memory-panel-title">What Otto remembers</h3><p>Loading memory…</p></header>
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
