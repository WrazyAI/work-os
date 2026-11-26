import type { PayrollRosterPage } from "@/modules/work-os/payroll/contracts";
import Link from "next/link";
import { payrollReviewHref, payrollWorkspaceHref } from "./paths";

const money = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const auditLabels = { queued: "Queued", running: "Running", done: "Analysis ready", failed: "Analysis failed", canceled: "Canceled" } as const;

export function PayrollOverviewView({ page, payDate, tab = "records", filtered = false }: {
  page: PayrollRosterPage; payDate: string; tab?: "records" | "audits"; filtered?: boolean;
}) {
  return (
    <section className="payroll-shell">
      <header className="payroll-header">
        <div>
          <h2>{tab === "records" ? "Payroll records" : "Payroll audits"}</h2>
          <p>{tab === "records" ? "Review recommended and approved hours for this pay period." : "Open an audit to review its findings, daily evidence and progress briefs."}</p>
        </div>
        <div className="payroll-actions"><Link className="primary" href={payrollWorkspaceHref("audits", payDate, true)}>New audit</Link></div>
      </header>
      <div className="payroll-meta">
        <span>Period {page.period.from} — {page.period.through}</span>
        <span>Pay date {payDate}</span>
        <span>Approved records {page.counts.approved ?? 0}</span>
      </div>
      <div className="payroll-panel">
        <table className="payroll-table">
          <thead><tr><th>Employee</th><th>Review status</th>
            {tab === "audits" ? <th>Analysis</th> : <><th>Recommended</th><th>Approved</th></>}<th /></tr></thead>
          <tbody>
            {page.items.map((person) => (
              <tr key={person.personId}>
                <td><strong>{person.displayName}</strong>{person.active ? null : <small> Inactive</small>}</td>
                <td>{person.status.replaceAll("_", " ")}</td>
                {tab === "audits" ? <td>{person.auditStatus ? auditLabels[person.auditStatus] : "No run status"}</td>
                  : <><td className="num">{person.reviewId && person.status !== "draft" && person.status !== "failed" ? money(person.totals.recommended) : "—"}</td>
                    <td className="num">{person.status === "approved" ? money(person.totals.approved) : "—"}</td></>}
                <td className="actions">
                  {person.reviewId ? <Link href={payrollReviewHref(person.personId, payDate, person.reviewId)}>{tab === "records" ? "Open review" : "Open audit"}<span className="sr-only"> for {person.displayName}</span></Link> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {page.items.length === 0 ? <p className="payroll-empty">{page.nextCursor ? "No matching records on the loaded page." : filtered ? "No records match this search." : "No payroll records for this pay date. Start a new audit to create one."}</p> : null}
      </div>
      <p className="payroll-footnote">Approved hours are a payroll decision inside Work OS. Employee recaps remain evidence, not confirmation of completion.</p>
    </section>
  );
}
