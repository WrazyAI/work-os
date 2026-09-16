import { useState } from "react";
import { InsightSynthesisCard, type InsightSynthesisState } from "./InsightSynthesis";

const PROSE = [
  "**What went well**", "",
  "**85 task outcomes** completed in this range, the strongest stretch against the equal earlier period, while observed work time held at **28h 35m**. A written goal was set on 5 of 7 days.", "",
  "**Needs attention**", "",
  "**12 outcomes** landed after their due dates and **6 blockers** were raised through the update record, with 356 carried or overdue items still visible.", "",
  "**Next focus**", "",
  "Review the blockers raised this period and **rebalance due dates** on the late outcomes.",
].join("\n");

const STATES: Array<{ key: string; label: string; state: InsightSynthesisState }> = [
  { key: "prose", label: "Validated prose", state: { status: "ready", text: PROSE, mode: "ai" } },
  { key: "evidence", label: "Evidence fallback", state: { status: "ready", text: PROSE, mode: "evidence" } },
  { key: "loading", label: "Synthesizing", state: { status: "loading" } },
  { key: "failed", label: "Unavailable", state: { status: "failed" } },
];

/** Dev-only review surface for the synthesis card: validated prose, the
 * evidence fallback, loading, and unavailable states, switchable in place. */
export default function InsightsSynthesisPreview() {
  const [active, setActive] = useState("prose");
  const state = STATES.find((entry) => entry.key === active)?.state ?? STATES[0]!.state;
  return <div className="workspace preview-workspace"><section className="stage"><header className="masthead"><div><p>September 16</p><h1>Insights synthesis</h1></div></header>
    <main className="page insights-page">
      <InsightSynthesisCard state={state} onSynthesize={() => setActive("loading")} />
      <div className="insight-brief panel" style={{ padding: 16 }}>
        <p className="insight-empty-note">Review each synthesis state:</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          {STATES.map((entry) => <button
            key={entry.key}
            type="button"
            aria-pressed={active === entry.key}
            onClick={() => setActive(entry.key)}
            style={{
              minHeight: 34, border: "1px solid var(--line)", borderRadius: 9, padding: "6px 12px",
              background: active === entry.key ? "var(--ink)" : "transparent",
              color: active === entry.key ? "#f3f1e8" : "var(--ink)",
              fontWeight: active === entry.key ? 600 : 500,
            }}
          >{entry.label}</button>)}
        </div>
      </div>
    </main>
  </section></div>;
}
