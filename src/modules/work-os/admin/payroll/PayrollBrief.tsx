import type { PayrollCitation, PayrollWeekBrief } from "@/modules/work-os/payroll/contracts";

export function PayrollSources({ citations }: { citations: PayrollCitation[] }) {
  if (!citations.length) return null;
  return (
    <details className="payroll-sources">
      <summary>Sources ({citations.length})</summary>
      <ul>{citations.map(({ type, id, revision }) => (
        <li key={`${type}:${id}:${revision}`}>{type === "interval" ? "Recap" : type} {id} · revision {revision}</li>
      ))}</ul>
    </details>
  );
}

export function PayrollBrief({ brief }: { brief: PayrollWeekBrief }) {
  return (
    <section className="payroll-panel payroll-brief">
      <h3>Week {brief.week} · {brief.title || "Progress brief"}</h3>
      <p>{brief.summary || (brief.status === "failed" ? "A grounded brief could not be generated." : "No recap text is available for these dates.")}</p>
      <PayrollSources citations={brief.summaryCitations} />
      {brief.themes.length ? <>
        <h4>Work observed</h4>
        <ul>{brief.themes.map((theme, index) => (
          <li key={index}><strong>{theme.heading}</strong> — {theme.detail}<PayrollSources citations={theme.citations} /></li>
        ))}</ul>
      </> : null}
      {brief.openItems.length ? <>
        <h4>Open items</h4>
        <ul>{brief.openItems.map((item, index) => (
          <li key={index}>{item.text}<PayrollSources citations={item.citations} /></li>
        ))}</ul>
      </> : null}
      {brief.gaps.length ? <>
        <h4>Limits and evidence gaps</h4>
        <ul>{brief.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
      </> : null}
    </section>
  );
}
