import { useState } from "react";
import { MemoryPanel, type MemoryFact, type MemoryRecent } from "./MemorySettings";

// One candidate carries a serialized instant in local_date on purpose: the API
// can hand back a SQL date as an instant, and the panel must still print a
// calendar day.
const FACTS: MemoryFact[] = [
  { id: "f1", content: "Uses Neon as the task authority for Work OS.", review_status: "candidate", fact_key: "task_authority", local_date: "2026-09-17T00:00:00.000Z", occurred_at: "2026-09-17T09:00:00.000Z" },
  { id: "f2", content: "Seeks to add substantive detail and consistency beyond an initial design direction.", review_status: "candidate", fact_key: "detail", local_date: "2026-09-17T00:00:00.000Z", occurred_at: "2026-09-17T08:30:00.000Z" },
  { id: "f3", content: "Prioritizes Windows stability before expanding the macOS port.", review_status: "candidate", fact_key: "windows_first", local_date: "2026-09-16", occurred_at: "2026-09-16T10:00:00.000Z" },
  { id: "f4", content: "Verifies that UX changes make key workflows clearer or easier to use.", review_status: "confirmed", fact_key: "ux_bar", local_date: "2026-09-16", occurred_at: "2026-09-16T11:00:00.000Z" },
  { id: "f5", content: "Wants WorkOS to provide more meaningful insights.", review_status: "confirmed", fact_key: "insights", local_date: "2026-09-15", occurred_at: "2026-09-15T10:00:00.000Z" },
  { id: "f6", content: "Prefers reviewing proposed task completions before any task status changes are made.", review_status: "confirmed", fact_key: "review_first", local_date: "2026-09-14", occurred_at: "2026-09-14T10:00:00.000Z" },
  { id: "f7", content: "Is working to make WorkOS start-of-day and end-of-day workflows easier to use.", review_status: "confirmed", fact_key: "sod_eod", local_date: "2026-09-16", occurred_at: "2026-09-16T09:00:00.000Z" },
];

const RECENT: MemoryRecent[] = [
  { id: "r1", kind: "check_in", content: "Finished the migration.", summary: "Finished the migration and verified the runner.", local_date: "2026-09-17", occurred_at: "2026-09-17T10:00:00.000Z" },
  { id: "r2", kind: "plan", content: "Ship a dependable Phase 1 workday loop.", summary: "Ship a dependable Phase 1 workday loop.", local_date: "2026-09-17", occurred_at: "2026-09-17T08:00:00.000Z" },
  { id: "r3", kind: "task_event", content: "Completed Compact the floating Otto companion.", summary: "Completed Compact the floating Otto companion.", local_date: "2026-09-16", occurred_at: "2026-09-16T17:00:00.000Z" },
  { id: "r4", kind: "evidence", content: "Desktop build verified.", summary: "Desktop build verified — packaging checks passed.", local_date: "2026-09-16", occurred_at: "2026-09-16T15:00:00.000Z" },
  { id: "r5", kind: "eod", content: "Submitted the EOD for September 16.", summary: "Submitted the EOD for September 16.", local_date: "2026-09-16", occurred_at: "2026-09-16T19:00:00.000Z" },
  { id: "r6", kind: "conversation", content: "Discussed the insights redesign.", summary: "Discussed chart density and the split layout in chat.", local_date: "2026-09-15", occurred_at: "2026-09-15T13:00:00.000Z" },
];

/** Dev-only review surface for the memory panel: the three classes with local
 * review/forget so layout and interactions can be exercised without a backend. */
export default function MemoryPreview() {
  const [facts, setFacts] = useState(FACTS);
  const [recent, setRecent] = useState(RECENT);
  const [variant, setVariant] = useState<"populated" | "empty">("populated");
  const empty = variant === "empty";
  return <div className="workspace preview-workspace"><section className="stage"><header className="masthead"><div><p>September 17</p><h1>Settings</h1></div></header>
    <main className="page">
      <div className="insight-brief panel" style={{ padding: 16, marginBottom: 16 }}>
        <p className="insight-empty-note">Memory panel states:</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {(["populated", "empty"] as const).map((entry) => <button
            key={entry}
            type="button"
            aria-pressed={variant === entry}
            onClick={() => setVariant(entry)}
            style={{
              minHeight: 34, border: "1px solid var(--line)", borderRadius: 9, padding: "6px 12px",
              background: variant === entry ? "var(--ink)" : "transparent",
              color: variant === entry ? "#f3f1e8" : "var(--ink)",
              fontWeight: variant === entry ? 600 : 500,
            }}
          >{entry === "populated" ? "Populated" : "Empty"}</button>)}
        </div>
      </div>
      <MemoryPanel
        facts={empty ? [] : facts}
        recent={empty ? [] : recent}
        busy={false}
        error={null}
        onReview={(id, status) => setFacts((current) => current.map((fact) => fact.id === id ? { ...fact, review_status: status } : fact))}
        onForget={(id) => {
          setFacts((current) => current.filter((fact) => fact.id !== id));
          setRecent((current) => current.filter((entry) => entry.id !== id));
        }}
      />
    </main>
  </section></div>;
}
