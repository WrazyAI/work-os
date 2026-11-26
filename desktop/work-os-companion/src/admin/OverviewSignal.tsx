import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, Minus, Users } from "lucide-react";
import { StackedTimeBars } from "./charts";
import { attendanceLabel, attendanceTone, formatMinutes, relativeTime, shortDate } from "./data";
import { AdminButton, Avatar, Pill } from "./ui";
import { Skeleton } from "../LoadingUi";
import type { AdminOverview, AdminSection, AdminSectionFocus } from "./types";
import "./overview-signal.css";

/** The administration overview as one instrument.
 *
 * A seven-workday pulse, a switchable fortnight trend, the live shape of the
 * day, a consistency heatmap, and the people and decisions that need the
 * operator. Observed time and source freshness close the record without
 * turning the page back into a card wall. Every chart carries exact values,
 * keyboard review, and a reduced-motion path. */

type MetricKey = "completed" | "updates" | "recaps" | "evidence";

export interface OverviewSignalProps {
  data: AdminOverview;
  attention: AdminOverview["attention"];
  readiness: {
    pending: boolean;
    error: boolean;
    onRetry: () => void;
  };
  onOpenSection: (section: AdminSection, focus?: AdminSectionFocus) => void;
  onOpenPerson: (personId: string) => void;
  onOpenRecaps: () => void;
}

interface Day {
  date: string;
  completed: number;
  updates: number;
  recaps: number;
  evidence: number;
  minutes: number;
}

interface Totals {
  completed: number;
  updates: number;
  recaps: number;
  evidence: number;
  minutes: number;
}

interface Model {
  data: AdminOverview;
  days: Day[];
  recent: Day[];
  prior: Day[];
  recentTotals: Totals;
  priorTotals: Totals;
  people: AdminOverview["people"];
  reviewWaiting: number;
  oldestReview: { value: number; unit: "hour" | "day"; phrase: string } | null;
  eodSubmittedPeople: number;
  generatedAt: number;
  headline: string;
  deck: string;
}

const METRICS: Array<{ id: MetricKey; label: string; noun: string; action: string }> = [
  { id: "completed", label: "Outcomes", noun: "completed outcomes", action: "Open Tasks" },
  { id: "updates", label: "Updates", noun: "recorded updates", action: "Open People" },
  { id: "recaps", label: "Recaps", noun: "generated recaps", action: "Open Admin Otto recaps" },
  { id: "evidence", label: "Evidence", noun: "evidence rows", action: "Open Evidence" },
];

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function isAre(value: number) {
  return value === 1 ? "is" : "are";
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function deltaPercent(current: number, previous: number) {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function deltaText(current: number, previous: number) {
  const delta = deltaPercent(current, previous);
  if (delta === null) return "no prior record";
  if (delta === 0) return "level with prior 7";
  return `${Math.abs(delta)}% ${delta > 0 ? "above" : "below"} prior 7`;
}

function axisParts(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    month: Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { month: "short" }) : "",
    day: Number.isFinite(date.getTime()) ? date.getDate() : value,
  };
}

function totalsFor(days: Day[]): Totals {
  return days.reduce((total, day) => ({
    completed: total.completed + day.completed,
    updates: total.updates + day.updates,
    recaps: total.recaps + day.recaps,
    evidence: total.evidence + day.evidence,
    minutes: total.minutes + day.minutes,
  }), { completed: 0, updates: 0, recaps: 0, evidence: 0, minutes: 0 });
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sectionForHref(href: string | null): AdminSection {
  const tail = href?.replace(/\/$/, "").split("/").pop() ?? "";
  if (tail === "people" || tail === "tasks" || tail === "review" || tail === "insights" || tail === "evidence" || tail === "settings") return tail;
  return "overview";
}

function actionForCode(code: string) {
  if (code === "reports_pending_review") return "Review";
  if (code === "eod_outstanding") return "Open review";
  if (code === "tasks_overdue") return "Open tasks";
  if (code === "evidence_disputed") return "Inspect";
  if (code === "readiness_blocked") return "Fix setup";
  return "Open";
}

function buildOverviewModel(data: AdminOverview): Model {
  // The admin overview endpoint supplies fourteen chronological workdays
  // (weekends skipped), so the final seven rows are the last seven workdays.
  const minutesByDate = new Map(data.timeSeries.map((point) => [point.date, point]));
  const days: Day[] = data.series.map((point) => ({
    date: point.date,
    completed: point.completed,
    updates: point.updates,
    recaps: point.recaps,
    evidence: point.evidence,
    minutes: minutesByDate.get(point.date)?.totalMinutes ?? 0,
  }));
  const recent = days.slice(-7);
  const prior = days.slice(Math.max(0, days.length - 14), Math.max(0, days.length - 7));
  const recentTotals = totalsFor(recent);
  const priorTotals = totalsFor(prior);
  const counts = data.counts;
  const reviewWaiting = Math.max(0, counts.recapsToday - counts.recapsReviewedToday);
  const generatedAt = Date.parse(data.generatedAt) || Date.now();
  const oldestAt = counts.pendingReviewOldestAt ? Date.parse(counts.pendingReviewOldestAt) : NaN;
  const oldestAgeMs = Number.isFinite(oldestAt) ? Math.max(0, generatedAt - oldestAt) : null;
  const oldestReview = oldestAgeMs === null
    ? null
    : oldestAgeMs < 86_400_000
      ? { value: Math.max(1, Math.floor(oldestAgeMs / 3_600_000)), unit: "hour" as const, phrase: "" }
      : { value: Math.floor(oldestAgeMs / 86_400_000), unit: "day" as const, phrase: "" };
  if (oldestReview) oldestReview.phrase = plural(oldestReview.value, oldestReview.unit);
  const eodSubmittedPeople = data.people.filter((person) =>
    person.eodToday === "submitted" || person.eodToday === "pending_review" || person.eodToday === "approved").length;
  const people = [...data.people].sort((left, right) => {
    const rank = (person: AdminOverview["people"][number]) =>
      person.attendance.state === "active" ? 0
        : person.attendance.state === "paused" ? 1
          : person.attendance.state === "off_shift" ? 2 : 3;
    return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
  });

  let headline = "The day's record is clear.";
  if (counts.disputedEvidence > 0) {
    headline = `${plural(counts.disputedEvidence, "evidence record")} ${isAre(counts.disputedEvidence)} waiting on a ruling.`;
  } else if (counts.tasksOverdue > counts.reportsPendingReview && counts.tasksOverdue > 0) {
    headline = `${plural(counts.tasksOverdue, "outcome")} ${isAre(counts.tasksOverdue)} past due.`;
  } else if (counts.reportsPendingReview > 0) {
    headline = `${plural(counts.reportsPendingReview, "report")} ${isAre(counts.reportsPendingReview)} waiting on review.`;
  } else if (counts.eodOutstandingDays > 0) {
    headline = `${plural(counts.eodOutstandingDays, "workday")} still ${counts.eodOutstandingDays === 1 ? "lacks" : "lack"} an EOD report.`;
  }

  const deckParts = [
    `${counts.onShift} of ${counts.people} ${counts.people === 1 ? "teammate" : "teammates"} ${isAre(counts.onShift)} on shift.`,
    `${plural(counts.tasksCompletedToday, "outcome")} landed today, with ${plural(counts.evidenceToday, "evidence item")} recorded.`,
  ];
  if (oldestReview) {
    deckParts.push(`The oldest report has waited ${oldestReview.phrase}.`);
  } else if (reviewWaiting > 0) {
    deckParts.push(`${plural(reviewWaiting, "recap")} ${isAre(reviewWaiting)} still waiting for review.`);
  }

  return {
    data, days, recent, prior, recentTotals, priorTotals,
    people, reviewWaiting, oldestReview, eodSubmittedPeople, generatedAt,
    headline, deck: deckParts.join(" "),
  };
}

export default function OverviewSignal({ data, attention, readiness, onOpenSection, onOpenPerson, onOpenRecaps }: OverviewSignalProps) {
  const model = useMemo(() => buildOverviewModel(data), [data]);
  const isEmpty = data.people.length === 0
    && !model.days.some((day) => day.completed || day.updates || day.recaps || day.evidence || day.minutes);

  if (isEmpty) {
    return (
      <div className="ovp ovp-empty">
        <p className="ovp-kicker">No recorded work</p>
        <h2 className="ovp-display">The window is empty.</h2>
        <p className="ovp-deck">No teammate, outcome, update, recap, evidence, or session minute was recorded in the last fourteen workdays. The instrument fills as the record arrives. People are created through onboarding or membership mapping in Settings.</p>
        <button type="button" className="ovp-text-action" onClick={() => onOpenSection("settings")}>Open Settings <ArrowRight size={13} aria-hidden /></button>
      </div>
    );
  }

  return <SignalBoard model={model} attention={attention} readiness={readiness} onOpenSection={onOpenSection} onOpenPerson={onOpenPerson} onOpenRecaps={onOpenRecaps} />;
}

export function OverviewSignalSkeleton() {
  return (
    <div className="ovp ovp-signal" role="group" aria-label="Loading overview" aria-busy="true">
      <div className="admin-loading-fields">
        <Skeleton className="skeleton-line skeleton-kicker" />
        <Skeleton className="skeleton-line skeleton-title" />
      </div>
      <div className="ovp-pulse">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="ovp-pulse-cell admin-loading-fields" key={index}>
            <Skeleton className="skeleton-line skeleton-kicker" />
            <Skeleton className="skeleton-line skeleton-value" />
            <Skeleton className="skeleton-line skeleton-body short" />
          </div>
        ))}
      </div>
      <div className="ovp-board">
        <div className="ovp-module ovp-span-8 admin-loading-fields">
          <Skeleton className="skeleton-line skeleton-title" />
          <div className="skeleton-bars ovp-loading-bars" aria-hidden="true">
            {Array.from({ length: 14 }, (_, index) => (
              <Skeleton className="skeleton-bar" key={index} style={{ height: `${30 + (index * 19) % 63}%` }} />
            ))}
          </div>
        </div>
        <div className="ovp-module ovp-span-4 admin-loading-fields">
          <Skeleton className="skeleton-line skeleton-title" />
          <Skeleton className="skeleton-line skeleton-value" />
          <Skeleton className="skeleton-line skeleton-body" />
          <Skeleton className="skeleton-line skeleton-body short" />
        </div>
      </div>
    </div>
  );
}

/* --- Chart primitives ---------------------------------------------------- */

const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 24;

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? SPARK_WIDTH / 2 : (index / (values.length - 1)) * SPARK_WIDTH;
    const y = SPARK_HEIGHT - (value / max) * (SPARK_HEIGHT - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const last = points[points.length - 1]?.split(",").map(Number) ?? [0, 0];
  return (
    <svg className="ovp-spark" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={SPARK_WIDTH / 2} y1="0" x2={SPARK_WIDTH / 2} y2={SPARK_HEIGHT} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <polyline points={points.join(" ")} fill="none" stroke="var(--observed)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="var(--observed)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface RefLine { value: number; label: string; kind: "prior" | "recent" }

function TrendBars({ days, metric, metricLabel, refs = [], caption, height = 168 }: {
  days: Day[];
  metric: MetricKey;
  metricLabel: string;
  refs?: RefLine[];
  caption: ReactNode;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const values = days.map((day) => day[metric]);
  const max = Math.max(1, ...values, ...refs.map((ref) => ref.value));
  const focusAt = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), days.length - 1);
    setActive(clamped);
    const day = days[clamped];
    setAnnouncement(`${shortDate(day.date)}. ${plural(day.completed, "outcome")}, ${plural(day.updates, "update")}, ${plural(day.recaps, "recap")}, ${plural(day.evidence, "evidence row")}, ${formatMinutes(day.minutes)} observed.`);
  };
  const step = (direction: number) => {
    const current = active ?? days.length - 1;
    focusAt(current + direction);
  };
  const activeDay = active === null ? null : days[active];

  return (
    <figure className="ovp-chart">
      <div
        className="ovp-chart-plot"
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`${metricLabel} per workday, ${days.length} workdays ending ${shortDate(days[days.length - 1]?.date)}. Use the left and right arrow keys to review each workday. The exact values are listed after the chart.`}
        onFocus={() => { if (active === null) setActive(days.length - 1); }}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); step(1); }
          if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); step(-1); }
          if (event.key === "Home") { event.preventDefault(); focusAt(0); }
          if (event.key === "End") { event.preventDefault(); focusAt(days.length - 1); }
        }}
      >
        <span className="ovp-chart-grid" aria-hidden>
          {[25, 50, 75].map((tick) => <i key={tick} style={{ bottom: `${tick}%` }} />)}
        </span>
        {refs.map((ref) => (
          <span key={ref.label} className={`ovp-chart-ref is-${ref.kind}`} style={{ bottom: `${(ref.value / max) * 100}%` }} aria-hidden>
            <i />
            <b>{ref.label}</b>
          </span>
        ))}
        <span className="ovp-chart-bars" aria-hidden>
          {days.map((day, index) => (
            <span
              key={day.date}
              className={`ovp-chart-slot${active === index ? " is-active" : ""}`}
              onMouseEnter={() => setActive(index)}
            >
              <i
                className="ovp-chart-bar"
                style={{
                  height: `${values[index] === 0 ? 1.5 : Math.max(4, (values[index] / max) * 100)}%`,
                  animationDelay: `${Math.min(index * 18, 150)}ms`,
                }}
              />
            </span>
          ))}
        </span>
        {activeDay ? (
          <span
            className={`ovp-readout${active !== null && active <= 1 ? " edge-start" : active !== null && active >= days.length - 2 ? " edge-end" : ""}`}
            style={active !== null && active <= 1 ? { left: 0 } : active !== null && active >= days.length - 2 ? { right: 0 } : { left: `${((Number(active) + 0.5) / days.length) * 100}%` }}
            aria-hidden
          >
            <b>{shortDate(activeDay.date)}</b>
            <span><i />Outcomes<em>{activeDay.completed}</em></span>
            <span><i />Updates<em>{activeDay.updates}</em></span>
            <span><i />Recaps<em>{activeDay.recaps}</em></span>
            <span><i />Evidence<em>{activeDay.evidence}</em></span>
            <span><i />Observed<em>{formatMinutes(activeDay.minutes)}</em></span>
          </span>
        ) : null}
      </div>
      <span className="ovp-chart-axis" aria-hidden>
        {days.map((day, index) => {
          const parts = axisParts(day.date);
          const show = index === 0 || index === days.length - 1 || index % 2 === 0;
          return <i key={day.date}>{show ? <><span className="ovp-axis-month">{parts.month} </span>{parts.day}</> : ""}</i>;
        })}
      </span>
      <figcaption className="ovp-chart-caption">{caption}</figcaption>
      <table className="ovp-visually-hidden">
        <caption>{metricLabel} per workday with the full daily record</caption>
        <thead><tr><th>Workday</th><th>Outcomes</th><th>Updates</th><th>Recaps</th><th>Evidence</th><th>Observed minutes</th></tr></thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th>{day.date}</th>
              <td>{day.completed}</td>
              <td>{day.updates}</td>
              <td>{day.recaps}</td>
              <td>{day.evidence}</td>
              <td>{day.minutes}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ovp-visually-hidden" aria-live="polite">{announcement}</p>
    </figure>
  );
}

function CoverageBar({ counts }: { counts: AdminOverview["counts"] }) {
  const segments = [
    { label: "On shift", value: counts.onShift, className: "is-active" },
    { label: "Paused", value: counts.paused, className: "is-paused" },
    { label: "Off shift", value: counts.offShift, className: "is-off" },
    { label: "Not observed", value: counts.unknown, className: "is-unknown" },
  ];
  return (
    <div className="ovp-coverage">
      <span className="ovp-coverage-bar" aria-hidden>
        {segments.map((segment) => (
          <i key={segment.label} className={segment.className} style={{ width: `${percent(segment.value, counts.people)}%` }} />
        ))}
      </span>
      <span className="ovp-coverage-legend">
        {segments.map((segment) => (
          <span key={segment.label}><i className={segment.className} aria-hidden />{segment.label}<b>{segment.value}</b></span>
        ))}
      </span>
    </div>
  );
}

function Meter({ value, total }: { value: number; total: number }) {
  const share = percent(value, total);
  return (
    <span className="ovp-meter" aria-hidden="true">
      <i style={{ width: `${share}%` }} />
    </span>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const delta = deltaPercent(current, previous);
  if (delta === null) return <span className="ovp-delta is-flat">no prior record</span>;
  if (delta === 0) return <span className="ovp-delta is-flat"><Minus size={12} aria-hidden />level with prior 7</span>;
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`ovp-delta ${delta > 0 ? "is-up" : "is-down"}`}>
      <Icon size={12} aria-hidden />{Math.abs(delta)}%<small> vs prior 7</small>
    </span>
  );
}

function Decisions({ items, onOpenSection, compact = false }: {
  items: AdminOverview["attention"];
  onOpenSection: OverviewSignalProps["onOpenSection"];
  compact?: boolean;
}) {
  const sorted = [...items].sort((left, right) => {
    const severity = { error: 0, warn: 1, info: 2 } as Record<string, number>;
    return (severity[left.severity] ?? 3) - (severity[right.severity] ?? 3) || right.count - left.count;
  });
  if (!sorted.length) {
    return (
      <span className="ovp-clear">
        <CheckCircle2 size={16} aria-hidden />
        Nothing needs a decision. Reviews, EODs, and the task record are clear.
      </span>
    );
  }
  return (
    <ul className={`ovp-decisions${compact ? " is-compact" : ""}`}>
      {sorted.map((item) => (
        <li key={item.code}>
          <button type="button" className="ovp-decision" onClick={() => onOpenSection(sectionForHref(item.href))}>
            <span className={`admin-dot ${item.severity}`} aria-hidden />
            <span className="ovp-decision-copy">
              <b>{item.message}</b>
              <small>{actionForCode(item.code)}</small>
            </span>
            <span className="ovp-decision-count">{item.count}</span>
            <ArrowRight size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function DayClose({ model }: { model: Model }) {
  const counts = model.data.counts;
  const rows = [
    { label: "EOD submitted today", value: model.eodSubmittedPeople, total: counts.people, detail: `${counts.reportsDraftedToday} drafted` },
    { label: "Recaps reviewed", value: counts.recapsReviewedToday, total: counts.recapsToday, detail: `${model.reviewWaiting} waiting` },
  ];
  return (
    <span className="ovp-close">
      {rows.map((row) => (
        <span className="ovp-close-row" key={row.label}>
          <span><b>{row.label}</b><small>{row.detail}</small></span>
          <span className="ovp-close-value"><b>{row.value}</b><small> / {row.total}</small></span>
          <Meter value={row.value} total={row.total} />
        </span>
      ))}
      <span className={`ovp-close-row is-flag${counts.disputedEvidence > 0 ? " is-on" : ""}`}>
        <span><b>Disputed evidence</b><small>Needs a ruling</small></span>
        <span className="ovp-close-value"><b>{counts.disputedEvidence}</b></span>
      </span>
    </span>
  );
}

function OldestReview({ model }: { model: Model }) {
  const age = model.oldestReview;
  if (!age) {
    return <p className="ovp-note">No report is waiting for review.</p>;
  }
  return (
    <p className="ovp-oldest">
      <b>{age.value}</b>
      <span>{age.unit === "hour" ? (age.value === 1 ? "hour" : "hours") : (age.value === 1 ? "day" : "days")}<small>oldest report waiting</small></span>
    </p>
  );
}

function TimeBand({ model }: { model: Model }) {
  const hasTime = model.days.some((day) => day.minutes > 0);
  return (
    <section className="ovp-module ovp-span-12" aria-labelledby="ovp-time-title">
      <div className="ovp-module-head">
        <div>
          <h3 id="ovp-time-title">Observed time</h3>
          <p>Session time per workday, split by teammate. Clock-in to clock-out minus pauses, never app tracking or a score.</p>
        </div>
        <span className="ovp-chart-total"><b>{formatMinutes(model.recentTotals.minutes)}</b><small>last 7 workdays</small></span>
      </div>
      {hasTime
        ? <StackedTimeBars ariaLabel="Observed work time per workday for the last 14 workdays, split by teammate" points={model.data.timeSeries} />
        : <p className="ovp-empty-note">No observed work time was recorded in this window.</p>}
    </section>
  );
}

function Sources({ data }: { data: AdminOverview }) {
  const generatedAt = Date.parse(data.generatedAt);
  const rows = [
    { label: "Tasks", time: data.freshness.niftySyncedAt, detail: `${data.freshness.niftyTasksToday} created today` },
    { label: "Worktivity", time: data.freshness.worktivityObservedAt, detail: `${data.counts.evidenceActivityToday} frames today` },
    { label: "GitHub", time: data.freshness.githubLastEventAt, detail: `${data.freshness.githubEventsToday} events today` },
    { label: "Plans", time: data.freshness.lastPlanAt, detail: "Plan edits and confirmations" },
    { label: "EOD reports", time: data.freshness.lastReportSubmittedAt, detail: `${data.counts.reportsPendingReview} awaiting review` },
  ];
  return (
    <details className="ovp-sources">
      <summary><span>Sources and freshness</span><ChevronDown size={14} aria-hidden /></summary>
      <dl>
        {rows.map((row) => (
          <div key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.time ? relativeTime(row.time, generatedAt) : "never"}<small>{row.detail}</small></dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function PulseFact({ label, metric, model, spark, onSelect, action }: {
  label: string;
  metric: MetricKey;
  model: Model;
  spark: number[];
  onSelect: () => void;
  action: string;
}) {
  return (
    <button
      type="button"
      className="ovp-pulse-cell"
      onClick={onSelect}
      aria-label={`${label}: ${model.recentTotals[metric]} in the last seven workdays, ${deltaText(model.recentTotals[metric], model.priorTotals[metric])}. ${action}`}
    >
      <span className="ovp-kicker">{label}</span>
      <span className="ovp-pulse-main">
        <b>{model.recentTotals[metric]}</b>
        <Sparkline values={spark} />
      </span>
      <span className="ovp-pulse-foot">
        <Delta current={model.recentTotals[metric]} previous={model.priorTotals[metric]} />
        <small>{Math.round(mean(spark.slice(-7)) * 10) / 10}/day</small>
      </span>
    </button>
  );
}

function SignalBoard({ model, attention, readiness, onOpenSection, onOpenPerson, onOpenRecaps }: {
  model: Model;
  attention: AdminOverview["attention"];
  readiness: OverviewSignalProps["readiness"];
} & Omit<OverviewSignalProps, "data" | "attention" | "readiness">) {
  const [metric, setMetric] = useState<MetricKey>("completed");
  const counts = model.data.counts;
  const selection = METRICS.find((item) => item.id === metric) ?? METRICS[0];
  const recentMean = model.recent.length ? model.recentTotals[metric] / model.recent.length : 0;
  const priorMean = model.prior.length ? model.priorTotals[metric] / model.prior.length : 0;
  const peopleForList = [...model.people]
    .sort((left, right) => {
      const score = (person: AdminOverview["people"][number]) => person.tasksCompletedToday * 3 + person.updatesToday * 2 + person.evidenceToday;
      return score(right) - score(left) || left.displayName.localeCompare(right.displayName);
    })
    .slice(0, 6);
  const values = model.days.map((day) => day[metric]);
  const bestIndex = values.reduce((best, value, index) => (value > values[best] ? index : best), 0);
  const dailyMean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const daysAbove = values.filter((value) => value > dailyMean).length;

  return (
    <div className="ovp ovp-signal">
      <header className="ovp-signal-head">
        <div>
          <p className="ovp-kicker">Last seven workdays against the seven before</p>
          <h2 className="ovp-display-sm">{model.headline}</h2>
        </div>
        <p className="ovp-note">Snapshot updated {relativeTime(model.data.generatedAt, model.generatedAt)}</p>
      </header>

      <section className="ovp-pulse" aria-label="The last seven workdays">
        <PulseFact label="Outcomes" metric="completed" model={model} spark={model.days.map((day) => day.completed)} onSelect={() => onOpenSection("tasks")} action={METRICS[0].action} />
        <PulseFact label="Updates" metric="updates" model={model} spark={model.days.map((day) => day.updates)} onSelect={() => onOpenSection("people")} action={METRICS[1].action} />
        <PulseFact label="Recaps" metric="recaps" model={model} spark={model.days.map((day) => day.recaps)} onSelect={onOpenRecaps} action={METRICS[2].action} />
        <PulseFact label="Evidence" metric="evidence" model={model} spark={model.days.map((day) => day.evidence)} onSelect={() => onOpenSection("evidence")} action={METRICS[3].action} />
      </section>

      <div className="ovp-board">
        <section className="ovp-module ovp-span-8" aria-labelledby="ovp-signal-trend-title">
          <div className="ovp-module-head">
            <div>
              <h3 id="ovp-signal-trend-title">Daily shape</h3>
              <p>{selection.noun} per workday, with the prior and current seven-day means.</p>
            </div>
            <div className="ovp-metric-switch" role="group" aria-label="Choose the trend measure">
              {METRICS.map((item) => (
                <button key={item.id} type="button" className={item.id === metric ? "is-active" : ""} aria-pressed={item.id === metric} onClick={() => setMetric(item.id)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <TrendBars
            days={model.days}
            metric={metric}
            metricLabel={selection.label}
            refs={[
              { value: priorMean, label: "prior mean", kind: "prior" },
              { value: recentMean, label: "recent mean", kind: "recent" },
            ]}
            caption={<><b>{model.recentTotals[metric]}</b> in the last seven workdays <Delta current={model.recentTotals[metric]} previous={model.priorTotals[metric]} /></>}
            height={210}
          />
          <div className="ovp-trend-summary">
            <span><b>{values[bestIndex] ?? 0}</b><small>best day · {model.days[bestIndex] ? shortDate(model.days[bestIndex].date) : "—"}</small></span>
            <span><b>{dailyMean.toFixed(1)}</b><small>14-day mean</small></span>
            <span><b>{daysAbove}</b><small>days above mean</small></span>
            <span><b>{model.priorTotals[metric]}</b><small>prior 7 days</small></span>
          </div>
        </section>

        <aside className="ovp-module ovp-span-4" aria-labelledby="ovp-signal-now-title">
          <div className="ovp-module-head">
            <div>
              <h3 id="ovp-signal-now-title">Right now</h3>
              <p>{counts.onShift} on shift of {counts.people}, {counts.paused} paused.</p>
            </div>
            <button type="button" className="ovp-icon-action" onClick={() => onOpenSection("people")} aria-label="Open People">
              <Users size={15} aria-hidden />
            </button>
          </div>
          <CoverageBar counts={counts} />
          <div className="ovp-now-block">
            <span className="ovp-kicker">Oldest waiting report</span>
            <OldestReview model={model} />
          </div>
          <div className="ovp-now-block">
            <span className="ovp-kicker">Day close</span>
            <DayClose model={model} />
          </div>
        </aside>

        <TimeBand model={model} />

        <section className="ovp-module ovp-span-7" aria-labelledby="ovp-signal-people-title">
          <div className="ovp-module-head">
            <div>
              <h3 id="ovp-signal-people-title">Today, by person</h3>
              <p>The six most active records, with status and today's counts.</p>
            </div>
            <button type="button" className="ovp-text-action" onClick={() => onOpenSection("people")}>Open People <ArrowRight size={13} aria-hidden /></button>
          </div>
          <ul className="ovp-people">
            {peopleForList.map((person) => (
              <li key={person.personId}>
                <button type="button" className="ovp-person-row" onClick={() => onOpenPerson(person.personId)}>
                  <Avatar name={person.displayName} size={28} />
                  <span className="ovp-person-copy">
                    <b>{person.displayName}</b>
                    <small>{person.roleProfile ?? "Unmapped role"}</small>
                  </span>
                  <Pill tone={attendanceTone(person.attendance.state)}>{attendanceLabel(person.attendance.state)}</Pill>
                  <span className="ovp-person-facts">
                    <b>{person.tasksCompletedToday}</b> outcomes
                    <b>{person.updatesToday}</b> updates
                    <b>{person.evidenceToday}</b> evidence
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="ovp-module ovp-span-5" aria-labelledby="ovp-signal-decisions-title">
          <div className="ovp-module-head">
            <div>
              <h3 id="ovp-signal-decisions-title">Needs a decision</h3>
              <p>Every row opens the record that can resolve it.</p>
            </div>
          </div>
          {readiness.pending ? <p className="ovp-note">Checking workspace setup…</p> : null}
          {readiness.error ? (
            <p className="ovp-note">
              Setup checks could not be refreshed.
              <AdminButton variant="ghost" onClick={readiness.onRetry}>Retry setup checks</AdminButton>
            </p>
          ) : null}
          <Decisions items={attention} onOpenSection={onOpenSection} compact />
        </section>

      </div>

      <Sources data={model.data} />

      <p className="ovp-footnote">
        Observed time and evidence are context, not a score. Recaps count generated intervals; reviews count the employee's confirmations and corrections.
        <span> Evidence counts rows, not minutes. Session time is clock-in to clock-out minus pauses.</span>
      </p>
    </div>
  );
}
