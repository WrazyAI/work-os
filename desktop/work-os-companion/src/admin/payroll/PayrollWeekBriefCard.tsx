import type { PayrollCitation, PayrollPeriod, PayrollWeekBrief } from "@wrazy/work-os-shared/payroll/contracts";
import { payrollBriefText, payrollBriefTitle } from "@wrazy/work-os-shared/payroll/briefs";
import { formatWorkOsFullDate } from "../../dateFormat";
import "./payroll.css";

function BriefSources({ citations }: { citations: PayrollCitation[] }) {
  if (!citations.length) return null;
  return <details className="payroll-native-sources">
    <summary>Sources ({citations.length})</summary>
    <ul className="payroll-native-list">{citations.map((citation) => <li key={`${citation.type}:${citation.id}:${citation.revision}`}>
      {citation.type === "interval" ? "Recap" : citation.type} {citation.id}, revision {citation.revision}
    </li>)}</ul>
  </details>;
}

function briefSourceCount(brief: PayrollWeekBrief): number {
  const keys = new Set<string>();
  const add = (citations: PayrollCitation[]) => citations.forEach((citation) => keys.add(`${citation.type}:${citation.id}:${citation.revision}`));
  add(brief.summaryCitations);
  brief.themes.forEach((theme) => add(theme.citations));
  brief.openItems.forEach((item) => add(item.citations));
  return keys.size;
}

function briefState(brief: PayrollWeekBrief): { label: string; tone: "ok" | "warn" | "neutral" } {
  if (brief.status === "ready") {
    const count = briefSourceCount(brief);
    return count
      ? { label: `Grounded in ${count} source${count === 1 ? "" : "s"}`, tone: "ok" }
      : { label: "No cited sources", tone: "warn" };
  }
  if (brief.status === "failed") return { label: "Brief unavailable", tone: "warn" };
  if (brief.status === "stale") return { label: "Needs refresh", tone: "warn" };
  if (brief.status === "generating") return { label: "Generating", tone: "neutral" };
  return { label: "No recap text", tone: "neutral" };
}

const EMPTY_BRIEF_SUMMARY: Record<PayrollWeekBrief["status"], string> = {
  ready: "No summary was recorded for this week.",
  failed: "A grounded brief could not be generated for this week.",
  stale: "This brief predates the current evidence and needs to be generated again.",
  generating: "This brief is being generated.",
  missing: "No recap text is available for these dates.",
};

export function PayrollWeekBriefCard({ brief, period }: { brief: PayrollWeekBrief; period: PayrollPeriod }) {
  const dates = period.weeks.find((week) => week.week === brief.week);
  const state = briefState(brief);
  const title = payrollBriefTitle(brief.title, brief.week);
  const summary = payrollBriefText(brief.summary);
  return <section className="payroll-brief-card">
    <header className="payroll-brief-head">
      <p className="payroll-brief-week">Week {brief.week}</p>
      <h3>{title}</h3>
      <p className="payroll-brief-period">
        {dates ? `${formatWorkOsFullDate(dates.from)} – ${formatWorkOsFullDate(dates.through)}` : "Dates unavailable"}
        <span className="payroll-brief-state" data-tone={state.tone}>{state.label}</span>
      </p>
    </header>
    <p className="payroll-brief-summary">{summary || EMPTY_BRIEF_SUMMARY[brief.status]}</p>
    <BriefSources citations={brief.summaryCitations} />
    {brief.themes.length ? <section className="payroll-brief-section">
      <h4>Work observed</h4>
      <ul className="payroll-brief-observations">{brief.themes.map((theme, i) => (
        <li className="payroll-brief-observation" key={i}><strong>{payrollBriefText(theme.heading)}</strong><p>{payrollBriefText(theme.detail)}</p><BriefSources citations={theme.citations} /></li>
      ))}</ul>
    </section> : null}
    {brief.openItems.length ? <section className="payroll-brief-section payroll-brief-open">
      <h4>Open items</h4>
      <ul>{brief.openItems.map((item, i) => <li key={i}>{payrollBriefText(item.text)}<BriefSources citations={item.citations} /></li>)}</ul>
    </section> : null}
    {brief.gaps.length ? <section className="payroll-brief-section payroll-brief-limits">
      <h4>Limits and evidence gaps</h4>
      <ul>{brief.gaps.map((gap, i) => <li className="payroll-brief-limit" key={i}>{payrollBriefText(gap)}</li>)}</ul>
    </section> : null}
  </section>;
}
