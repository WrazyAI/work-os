import { useState, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown, CircleDashed, ExternalLink, Lock, Video } from "lucide-react";
import { formatWorkOsFullDate } from "./dateFormat";
import type { EodEvidenceGroup, EodStructuredReport } from "./eodStructured";

function sourceLabel(group: EodEvidenceGroup): string {
  return group.label || group.source;
}

function statusLabel(status: string | null | undefined): string | null {
  if (status === "approved") return "Approved";
  if (status === "pending_review" || status === "submitted") return "Pending review";
  if (status === "rejected") return "Changes requested";
  if (status === "draft") return "Draft";
  return null;
}

function formatAt(value: string | null): string | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Section({ icon, title, lines }: { icon: ReactNode; title: string; lines: string[] }) {
  return (
    <section className="eod-reading-section">
      <header>
        <span className="eod-reading-section-icon">{icon}</span>
        <strong>{title}</strong>
        <span className="eod-reading-section-count">{lines.length}</span>
      </header>
      <div className="eod-reading-section-body">
        {lines.length ? <ul>{lines.map((line, index) => <li key={`${line}-${index}`}>{line}</li>)}</ul> : <p>No line was written.</p>}
      </div>
    </section>
  );
}

/** Read-only structured EOD for the employee's submitted view and the admin
 * review. The composer owns edits; this view never exposes one. */
export function EodStructuredReadingView({
  report,
  variant = "admin",
  personName = null,
  date = null,
  status = null,
  fullRecord = null,
}: {
  report: EodStructuredReport;
  variant?: "employee" | "admin";
  personName?: string | null;
  date?: string | null;
  status?: string | null;
  fullRecord?: ReactNode;
}) {
  const [openSource, setOpenSource] = useState<string | null>(report.evidence[0]?.source ?? null);
  const summaryOwner = report.summarySource === "assembled"
    ? variant === "employee" ? "Assembled from your entries" : "Assembled from the employee's entries"
    : report.summarySource === "otto"
      ? variant === "employee" ? "Otto · written from your entries" : "Otto · written from the employee's entries"
      : variant === "employee" ? "Summary from your report" : "Summary from the employee's report";
  const statusText = statusLabel(status);
  const openGroup = report.evidence.find((group) => group.source === openSource) ?? null;

  return (
    <div className="eod-reading" data-variant={variant}>
      {personName || date || statusText ? <div className="eod-reading-meta">
        {personName ? <strong>{personName}</strong> : null}
        {date ? <span>{formatWorkOsFullDate(date)}</span> : null}
        {statusText ? <span>{statusText}</span> : null}
      </div> : null}

      <section className="eod-reading-summary" aria-labelledby="eod-reading-summary-title">
        <header>
          <span className="eod-reading-eyebrow">Summary</span>
          <h3 id="eod-reading-summary-title" className="eod-reading-summary-title">{summaryOwner}</h3>
        </header>
        <p>{report.summary || "No summary was written."}</p>
      </section>

      <div className="eod-reading-sections">
        <Section icon={<Check size={12} aria-hidden />} title="Completed" lines={report.completed} />
        <Section icon={<CircleDashed size={12} aria-hidden />} title="In progress" lines={report.inProgress} />
        <Section icon={<ArrowRight size={12} aria-hidden />} title="Next" lines={report.next} />
      </div>

      {report.loomUrl ? <a className="eod-reading-loom" href={report.loomUrl} target="_blank" rel="noreferrer">
        <Video size={18} aria-hidden />
        <span><strong>Loom recording attached</strong><small>{report.loomUrl.replace(/^https:\/\/(?:www\.)?loom\.com\/share\//, "loom.com/share/")}</small></span>
        <ExternalLink size={12} aria-hidden />
      </a> : null}

      <section className="eod-reading-evidence" aria-labelledby="eod-reading-evidence-title">
        <header>
          <div>
            <span className="eod-reading-eyebrow">Recorded</span>
            <h3 id="eod-reading-evidence-title" className="eod-reading-evidence-title">Evidence</h3>
          </div>
          <span className="eod-reading-lock"><Lock size={10} aria-hidden /> Immutable · system-recorded</span>
        </header>
        {report.evidence.length ? <>
          <div className="eod-reading-sources" role="group" aria-label="Evidence sources">
            {report.evidence.map((group) => <button key={group.source} type="button" aria-expanded={openSource === group.source} onClick={() => setOpenSource((current) => current === group.source ? null : group.source)}>
              {sourceLabel(group)} <b>{group.items.length}</b><ChevronDown size={11} aria-hidden />
            </button>)}
          </div>
          {openGroup ? <div className="eod-reading-evidence-panel" aria-label={`${sourceLabel(openGroup)} evidence`}>
            <header><strong>{openGroup.items.length} {openGroup.items.length === 1 ? "record" : "records"}</strong><span>Read-only</span></header>
            <ul>
              {openGroup.items.map((item) => <li key={item.id}>
                <div>
                  {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title} <ExternalLink size={10} aria-hidden /></a> : <strong>{item.title}</strong>}
                  {item.summary ? <p>{item.summary}</p> : null}
                  {item.meta ? <small>{item.meta}</small> : null}
                </div>
                {item.at ? <time dateTime={item.at}>{formatAt(item.at)}</time> : null}
              </li>)}
            </ul>
          </div> : null}
        </> : <p className="eod-reading-empty">No evidence was attached to this report.</p>}
      </section>

      {fullRecord}
    </div>
  );
}
