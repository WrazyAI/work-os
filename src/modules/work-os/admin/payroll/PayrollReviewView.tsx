import { payrollReviewModel } from "./model";
import type { PayrollReview } from "@/modules/work-os/payroll/contracts";
import { PayrollBrief } from "./PayrollBrief";
import { PayrollProgress } from "./PayrollProgress";

export function PayrollReviewView({ review, displayName, busy, onApprove, onReopen, onAdvance }: {
  review: PayrollReview;
  displayName?: string;
  busy?: boolean;
  onApprove?: () => void;
  onReopen?: () => void;
  onAdvance?: () => void;
}) {
  const model = payrollReviewModel(review);
  const running = review.run?.progress.status === "queued" || review.run?.progress.status === "running";
  return (
    <article className="payroll-shell payroll-review">
      <header className="payroll-header">
        <div>
          <p className="payroll-kicker">Payroll audit</p>
          <h2>{displayName ? `${displayName} · ` : ""}{review.period.from} — {review.period.through}</h2>
          <p>Paid {review.period.payDate} · {review.period.timezone} · {review.status.replaceAll("_", " ")}</p>
          <p className="payroll-provider-check">Provider verified {review.providerVerifiedAt ? review.providerVerifiedAt.replace("T", " ").slice(0, 16) + " UTC" : "not yet"}</p>
        </div>
        <div className="payroll-actions">
          {model.canApprove && onApprove ? <button type="button" className="primary" disabled={busy} onClick={onApprove}>Approve payable hours</button> : null}
          {review.status === "approved" && onReopen ? <button type="button" disabled={busy} onClick={onReopen}>Reopen with reason</button> : null}
          {!running && review.status !== "approved" && onAdvance ? <button type="button" disabled={busy} onClick={onAdvance}>{model.stale || review.token.analysisRevision > 0 ? "Re-analyze" : "Run audit"}</button> : null}
        </div>
      </header>
      <PayrollProgress review={review} />
      <div className="payroll-banner" data-tone={model.stale ? "warn" : review.status === "approved" ? "ok" : "neutral"}>
        <strong>{model.stale ? "Evidence changed — re-analyze before approval" : review.status === "approved" ? "Approved payroll record" : "Review in progress"}</strong>
        <span>{model.retentionLabel}</span>
      </div>
      {review.token.analysisRevision > 0 && <>
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
        {review.period.weeks.map(({ week }) => {
          const brief = review.briefs.find((entry) => entry.week === week);
          return brief ? <PayrollBrief key={week} brief={brief} /> : <section key={week} className="payroll-panel"><h3>Week {week}</h3><p>No recap text is available for these dates.</p></section>;
        })}
      </div>
      </>}
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
