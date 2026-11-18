import { payrollReviewModel } from "./model";
import type { PayrollReview } from "@/modules/work-os/payroll/contracts";

export function PayrollReviewView({ review, onApprove, onReopen, onDecide, onAdvance }: {
  review: PayrollReview;
  onApprove?: () => void;
  onReopen?: () => void;
  onDecide?: (findingKey: string, action: "payable" | "excluded" | "acknowledged") => void;
  onAdvance?: () => void;
}) {
  const model = payrollReviewModel(review);
  void onDecide;
  return (
    <article className="payroll-shell payroll-review">
      <header className="payroll-header">
        <div>
          <p className="payroll-kicker">Payroll review</p>
          <h1>{review.period.from} — {review.period.through}</h1>
          <p>Paid {review.period.payDate} · {review.period.timezone} · {review.status.replaceAll("_", " ")}</p>
        </div>
        <div className="payroll-actions">
          {model.canApprove && onApprove ? <button type="button" className="primary" onClick={onApprove}>Approve payable hours</button> : null}
          {review.status === "approved" && onReopen ? <button type="button" onClick={onReopen}>Reopen with reason</button> : null}
          {model.stale && onAdvance ? <button type="button" onClick={onAdvance}>Re-analyze</button> : null}
        </div>
      </header>
      <div className="payroll-banner" data-tone={model.stale ? "warn" : review.status === "approved" ? "ok" : "neutral"}>
        <strong>{model.stale ? "Evidence changed — re-analyze before approval" : review.status === "approved" ? "Approved payroll record" : "Review in progress"}</strong>
        <span>{model.retentionLabel}</span>
      </div>
      {review.recapStats ? (
        <p className="payroll-provenance">
          {model.recapStats.employeeReviewed} employee-reviewed · {model.recapStats.autoApproved} auto-approved for payroll · {model.recapStats.pending} not yet reviewed
          {review.recapStats.autoApproved ? <span> — Auto-approved for payroll is a system decision, not an employee confirmation.</span> : null}
        </p>
      ) : null}
      <h2>Reconciliation</h2>
      <table className="payroll-table payroll-reconciliation">
        <tbody>
          {model.reconciliation.map((row) => (
            <tr key={row.kind}><td>{row.label}</td><td className="num">{row.minutes} min</td><td className="num">{(row.minutes / 60).toFixed(4)} h</td><td>{row.findingStatus ?? ""}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>Week briefs</h2>
      <div className="payroll-briefs">
        {review.briefs.map((brief) => (
          <section key={brief.week} className="payroll-panel">
            <h3>Week {brief.week} · {brief.title}</h3>
            <p>{brief.summary || "No recap text is available for these dates."}</p>
            <small>{brief.status} · {brief.sourceHash.slice(0, 12)}</small>
          </section>
        ))}
      </div>
      <h2>Findings</h2>
      <div className="payroll-findings">
        {review.blockers.map((blocker) => <p key={blocker} className="payroll-blocker">{blocker}</p>)}
        {review.approval ? <p>Approved {review.approval.approvedAt} · {review.approval.totals.approved} minutes · receipt {review.approval.snapshotHash.slice(0, 12)}{model.historicalApproval ? " · historical approval" : ""}</p> : null}
        {model.blockers.filter((blocker) => !review.blockers.includes(blocker)).map((blocker) => <p key={blocker} className="payroll-blocker">{blocker}</p>)}
      </div>
    </article>
  );
}

export function PayrollFindingsView({ review }: { review: PayrollReview }) {
  return (
    <section className="payroll-panel">
      <h3>Decision queue</h3>
      {review.blockers.length ? review.blockers.map((blocker) => <p key={blocker} className="payroll-blocker">{blocker}</p>) : <p className="payroll-empty">No held findings are waiting.</p>}
    </section>
  );
}
