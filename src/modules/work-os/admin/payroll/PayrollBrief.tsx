import type { PayrollCitation, PayrollPeriod, PayrollWeekBrief } from "@/modules/work-os/payroll/contracts";
import { payrollBriefText, payrollBriefTitle } from "@wrazy/work-os-shared/payroll/briefs";

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

function briefDate(value: string, withYear: boolean): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC",
  }).format(date);
}

function briefRange(from: string, through: string): string {
  const sameYear = from.slice(0, 4) === through.slice(0, 4);
  return `${briefDate(from, !sameYear)} – ${briefDate(through, true)}`;
}

function sourceCount(brief: PayrollWeekBrief): number {
  const keys = new Set<string>();
  const add = (citations: PayrollCitation[]) => citations.forEach((citation) => keys.add(`${citation.type}:${citation.id}:${citation.revision}`));
  add(brief.summaryCitations);
  brief.themes.forEach((theme) => add(theme.citations));
  brief.openItems.forEach((item) => add(item.citations));
  return keys.size;
}

function briefState(brief: PayrollWeekBrief): { label: string; tone: "ok" | "warn" | "neutral" } {
  if (brief.status === "ready") {
    const count = sourceCount(brief);
    return count
      ? { label: `Grounded in ${count} source${count === 1 ? "" : "s"}`, tone: "ok" }
      : { label: "No cited sources", tone: "warn" };
  }
  if (brief.status === "failed") return { label: "Brief unavailable", tone: "warn" };
  if (brief.status === "stale") return { label: "Needs refresh", tone: "warn" };
  if (brief.status === "generating") return { label: "Generating", tone: "neutral" };
  return { label: "No recap text", tone: "neutral" };
}

const EMPTY_SUMMARY: Record<PayrollWeekBrief["status"], string> = {
  ready: "No summary was recorded for this week.",
  failed: "A grounded brief could not be generated for this week.",
  stale: "This brief predates the current evidence and needs to be generated again.",
  generating: "This brief is being generated.",
  missing: "No recap text is available for these dates.",
};

export function PayrollBrief({ brief, period }: { brief: PayrollWeekBrief; period: PayrollPeriod }) {
  const dates = period.weeks.find((week) => week.week === brief.week);
  const state = briefState(brief);
  const title = payrollBriefTitle(brief.title, brief.week);
  const summary = payrollBriefText(brief.summary);
  return (
    <section className="payroll-panel payroll-brief" aria-labelledby={`payroll-brief-week-${brief.week}`}>
      <header className="payroll-brief-head">
        <p className="payroll-brief-week">Week {brief.week}</p>
        <h3 id={`payroll-brief-week-${brief.week}`}>{title}</h3>
        <p className="payroll-brief-period">
          {dates ? briefRange(dates.from, dates.through) : "Dates unavailable"}
          <span className="payroll-brief-state" data-tone={state.tone}>{state.label}</span>
        </p>
      </header>
      <p className="payroll-brief-summary">{summary || EMPTY_SUMMARY[brief.status]}</p>
      <PayrollSources citations={brief.summaryCitations} />
      {brief.themes.length ? <section className="payroll-brief-section">
        <h4>Work observed</h4>
        <ul className="payroll-brief-observations">{brief.themes.map((theme, index) => (
          <li className="payroll-brief-observation" key={index}>
            <strong>{payrollBriefText(theme.heading)}</strong>
            <p>{payrollBriefText(theme.detail)}</p>
            <PayrollSources citations={theme.citations} />
          </li>
        ))}</ul>
      </section> : null}
      {brief.openItems.length ? <section className="payroll-brief-section payroll-brief-open">
        <h4>Open items</h4>
        <ul>{brief.openItems.map((item, index) => (
          <li key={index}>{payrollBriefText(item.text)}<PayrollSources citations={item.citations} /></li>
        ))}</ul>
      </section> : null}
      {brief.gaps.length ? <section className="payroll-brief-section payroll-brief-limits">
        <h4>Limits and evidence gaps</h4>
        <ul>{brief.gaps.map((gap, index) => <li className="payroll-brief-limit" key={index}>{payrollBriefText(gap)}</li>)}</ul>
      </section> : null}
    </section>
  );
}
