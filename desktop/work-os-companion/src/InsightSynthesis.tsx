import { Sparkles } from "lucide-react";
import { ChatMarkdown } from "./ChatMarkdown";

/** The Insights synthesis card. Kept presentational and exported so the
 * assistant contract (validated prose vs the exact fact record) can be rendered
 * and reviewed in isolation by the dev preview harness and render tests. */
export type InsightSynthesisState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "ready"; text: string; mode?: "ai" | "evidence" };

export function InsightSynthesisCard({ state, onSynthesize }: { state: InsightSynthesisState | null; onSynthesize: () => void }) {
  const busy = state?.status === "loading";
  return (
    <section className="panel insight-synthesis" aria-label="AI synthesis">
      <header>
        <div>
          <span><Sparkles size={14} /> AI synthesis</span>
          <h3>{state?.status === "ready" ? "A grounded read of this range." : "Add a grounded read."}</h3>
        </div>
        <button disabled={busy} onClick={onSynthesize}>{busy ? "Synthesizing…" : state?.status === "ready" ? "Re-synthesize" : "Synthesize with AI"}</button>
      </header>
      {state?.status === "ready"
        ? <div className="synthesis-text"><ChatMarkdown text={state.text} /></div>
        : state?.status === "failed"
          ? <p className="synthesis-fallback">The assistant is unavailable — the verified range facts and exact daily values remain available below.</p>
          : <p className="synthesis-hint">Adds short grounded paragraphs from the verified range facts. Every figure is checked against the record, and no productivity score is generated.</p>}
      {state?.status === "ready" && state.mode === "evidence"
        ? <p className="synthesis-fallback">The assistant&apos;s draft could not be verified — showing the exact fact record instead.</p>
        : null}
    </section>
  );
}
