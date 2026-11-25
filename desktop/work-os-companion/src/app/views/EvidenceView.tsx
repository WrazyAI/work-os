import { formatWorkOsTime as formatTime } from "../../dateFormat";
import { Empty, PageIntro } from "../../SharedUi";
import type { DayData } from "../../types";

export function EvidenceView({ visibleDay }: { visibleDay: DayData | null }) {
  return <main className="page">
    <PageIntro eyebrow="Provenance" title="Evidence with its labels intact." body="Claims, activity observations, and output artifacts are never collapsed into one misleading score." />
    <section className="evidence-list">
      {visibleDay?.evidence?.length ? visibleDay.evidence.map((item) => (
        <article key={item.id}>
          <span className={`evidence-kind ${item.source === "worktivity" ? "activity" : "output"}`}>
            {item.source === "worktivity" ? "Activity context" : item.source === "loom" ? "Loom recording" : "Output evidence"}
          </span>
          <div>
            <h3>{item.source === "loom" && item.url ? <a href={String(item.url)} target="_blank" rel="noreferrer">{item.title}</a> : item.title}</h3>
            <p>{item.summary || "No summary available."}</p>
          </div>
          <time>{item.occurred_at ? formatTime(item.occurred_at, visibleDay.shift?.timezone) : "Today"}</time>
        </article>
      )) : <Empty title="No evidence yet" body="Verified provider events and purpose-limited activity context will appear here." />}
    </section>
  </main>;
}
