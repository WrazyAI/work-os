import type { PayrollApproval } from "@/modules/work-os/payroll/contracts";

/** Frozen approval receipt for print. It never reads live people, recaps or
 * recomputed hours: every value comes from the immutable snapshot. */
export function PayrollPrint({ approval, historical = false }: { approval: PayrollApproval; historical?: boolean }) {
  const period = approval.period;
  return (
    <main className="payroll-print">
      <style>{`
        .payroll-print{max-width:900px;margin:0 auto;padding:32px;color:#182018;background:#fff;font:13px/1.5 system-ui,sans-serif}
        .payroll-print h1{font-size:22px;margin:0 0 4px}.payroll-print h2{font-size:15px;margin:24px 0 8px;border-bottom:1px solid #d8ddd4;padding-bottom:4px}
        .payroll-print table{width:100%;border-collapse:collapse;margin:8px 0}.payroll-print th,.payroll-print td{border-bottom:1px solid #e7eae3;padding:5px 6px;text-align:left;vertical-align:top}
        .payroll-print th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#62685f}
        .payroll-print .num{text-align:right;font-variant-numeric:tabular-nums}.payroll-print .muted{color:#62685f}
        .payroll-print .receipt{background:#f6f8f3;padding:10px 12px;border:1px solid #dfe5d8;margin-top:20px}
        @media print{body *{visibility:hidden}.payroll-print,.payroll-print *{visibility:visible}.payroll-print{position:absolute;left:0;top:0;padding:0;max-width:none}@page{margin:16mm}}
      `}</style>
      <header>
        <h1>Payroll record — {approval.identity.displayName}</h1>
        <p className="muted">
          {period.from} through {period.through} · paid {period.payDate} · {period.timezone}
          {historical ? " · historical approval (superseded)" : ""}
        </p>
      </header>
      <section>
        <h2>Reconciliation</h2>
        <table>
          <tbody>
            {([
              ["Recorded", approval.totals.recorded], ["Eligible tracked", approval.totals.eligibleTracked],
              ["Outside window", approval.totals.outside], ["Break", approval.totals.break],
              ["Inactivity", approval.totals.inactivity], ["Held", approval.totals.held],
              ["Manual excluded", approval.totals.manualExcluded], ["Recommended", approval.totals.recommended],
              ["Approved", approval.totals.approved],
            ] as const).map(([label, value]) => (
              <tr key={label}><td>{label}</td><td className="num">{value} min</td><td className="num">{(value / 60).toFixed(4)} h</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Daily record</h2>
        <table>
          <thead><tr><th>Date</th><th>Status</th><th>Recorded</th><th>Recommended</th><th>Approved</th></tr></thead>
          <tbody>
            {approval.days.map((day) => (
              <tr key={day.date}><td>{day.date}</td><td>{day.status}</td><td className="num">{day.minutes.recorded}</td><td className="num">{day.minutes.recommended}</td><td className="num">{day.minutes.approved}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2>Week briefs</h2>
        {approval.briefs.length ? approval.briefs.map((brief) => (
          <article key={brief.week}>
            <h3>Week {brief.week}: {brief.title}</h3>
            <p>{brief.summary}</p>
            {brief.status !== "ready" ? <p className="muted">Brief status: {brief.status}</p> : null}
          </article>
        )) : <p className="muted">No briefs recorded.</p>}
      </section>
      <section>
        <h2>Findings</h2>
        {approval.findings.length ? approval.findings.map((finding) => (
          <p key={finding.key}><strong>{finding.kind}</strong> · {finding.status} · {finding.reason}</p>
        )) : <p className="muted">No findings.</p>}
      </section>
      <footer className="receipt">
        <p><strong>Immutable approval receipt</strong></p>
        <p>Approval {approval.id} · revision {approval.revision} · approved {approval.approvedAt}</p>
        <p>Snapshot {approval.snapshotHash} · schema {approval.schemaVersion}</p>
        <p className="muted">This printout is the operator-archived payroll record. It is not an employee confirmation.</p>
      </footer>
    </main>
  );
}
