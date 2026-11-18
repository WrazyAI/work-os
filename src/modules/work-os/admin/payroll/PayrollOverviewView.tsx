import type { PayrollRosterPage } from "@/modules/work-os/payroll/contracts";

const money = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

export function PayrollOverviewView({ page, payDate, onAnalyze }: {
  page: PayrollRosterPage; payDate: string; onAnalyze?: (personId: string) => void;
}) {
  return (
    <section className="payroll-shell">
      <header className="payroll-header">
        <div>
          <h1>Payroll review</h1>
          <p>Hours-only evidence review. Work OS owns the approved record; nothing is written to Worktivity.</p>
        </div>
        <span className="payroll-date">Pay date {payDate}</span>
      </header>
      <div className="payroll-meta">
        <span>Period {page.period.from} — {page.period.through}</span>
        <span>Employee-reviewed {page.counts.confirmed ?? 0}</span>
        <span>Auto-approved {page.counts.approved ?? 0}</span>
      </div>
      <div className="payroll-panel">
        <table className="payroll-table">
          <thead><tr><th>Employee</th><th>Status</th><th>Recommended</th><th>Approved</th><th /></tr></thead>
          <tbody>
            {page.items.map((person) => (
              <tr key={person.personId}>
                <td><strong>{person.displayName}</strong>{person.active ? null : <small> Inactive</small>}</td>
                <td>{person.status.replaceAll("_", " ")}</td>
                <td className="num">{money(person.totals.recommended)}</td>
                <td className="num">{money(person.totals.approved)}</td>
                <td className="actions">
                  {person.reviewId ? <a href={`/work-os/admin/payroll/${encodeURIComponent(person.personId)}?payDate=${encodeURIComponent(payDate)}`}>Open review</a>
                    : onAnalyze ? <button type="button" onClick={() => onAnalyze(person.personId)}>Analyze</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {page.items.length === 0 ? <p className="payroll-empty">No mapped employees for this pay date.</p> : null}
      </div>
      <p className="payroll-footnote">Approved hours are a payroll decision inside Work OS. Employee recaps remain evidence, not confirmation of completion.</p>
    </section>
  );
}
