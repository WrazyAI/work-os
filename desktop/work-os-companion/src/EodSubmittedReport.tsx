import { ArrowLeft, ChevronRight } from "lucide-react";
import { formatWorkOsFullDate } from "./dateFormat";
import { CheckedMoment } from "./CheckedMoment";
import EodReportDocument from "./EodReportDocument";
import { EodStructuredReadingView } from "./EodStructuredReadingView";
import { eodStructuredFromReport } from "./eodStructured";
import { parseEodMarkdown } from "@wrazy/work-os-shared/eod-document";

/** Compact day reads carry only submitted_at; a rejected report remains editable. */
export function submittedEodStatus(report: Record<string, unknown> | null | undefined): "submitted" | "approved" | null {
  if (report?.status === "approved") return "approved";
  if (report?.status === "submitted") return "submitted";
  if (report?.status !== "draft" && report?.status !== "rejected" && report?.submitted_at) return "submitted";
  return null;
}

export function EodSubmittedReport({ status, markdown, report, date, onAllEods, onToday }: { status: "submitted" | "approved"; markdown?: unknown; report?: Record<string, unknown> | null; date: string; onAllEods: () => void; onToday: () => void }) {
  const content = typeof markdown === "string" ? markdown.trim() : "";
  const structuredReport = eodStructuredFromReport(report);
  const document = parseEodMarkdown(content);
  const hasParsedDocument = Boolean(document.summary?.lines.some((line) => line.text)
    || document.sections.some((section) => section.lines.some((line) => line.kind === "bullet")));
  return <section className="panel eod-submitted-report" aria-label="Submitted EOD">
    <nav className="eod-submitted-nav" aria-label="EOD navigation">
      <button type="button" className="quiet-action" onClick={onAllEods}><ArrowLeft size={14} aria-hidden="true" /> All EODs</button>
      <button type="button" className="quiet-action" onClick={onToday}>Return to today <ChevronRight size={14} aria-hidden="true" /></button>
    </nav>
    <header className="eod-submitted-outcome">
      <CheckedMoment />
      <div><h2>EOD {status}</h2><p>{status === "approved" ? "Your report is approved by your manager." : "Your report is with your manager."}</p><p className="eod-submitted-date">{formatWorkOsFullDate(date)} · Read-only report</p></div>
    </header>
    <div className="eod-submitted-document">
      {structuredReport ? <EodStructuredReadingView report={structuredReport} variant="employee" fullRecord={content ? (
        <details className="eod-submitted-source">
          <summary>Full recorded day</summary>
          <div><EodReportDocument markdown={content} /></div>
        </details>
      ) : null} /> : content ? hasParsedDocument ? <>
        <EodReportDocument markdown={content} />
        <details className="eod-submitted-source"><summary>Report text</summary><div className="eod-submitted-text">{content}</div></details>
      </> : <article className="eod-submitted-text" aria-label="End-of-day report">{content}</article> : <p className="eod-submitted-unavailable">The submitted report’s text is not available in this view.</p>}
    </div>
  </section>;
}
