import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, Minus, Users } from "lucide-react";
import { StackedTimeBars } from "./charts";
import {
  adminKeys,
  attendanceLabel,
  attendanceTone,
  fetchAdminOverview,
  formatMinutes,
  normalizeAdminOverview,
  relativeTime,
  shortDate,
  statusLabel,
  todayIso,
} from "./data";
import { Avatar, Notice, Pill } from "./ui";
import type { AdminOverview, AdminSection, AdminSectionFocus } from "./types";
import "./overview-prototype.css";

/** Dev-only Overview directions. Each prototype reads the same normalized
 * admin snapshot as the shipped page, so the data, empty states, and person
 * destinations are real; only the composition changes. `?prototype=` chooses
 * the direction and the switcher rewrites it in place. */

type PrototypeId = "brief" | "signal" | "ledger";
type MetricKey = "completed" | "updates" | "recaps" | "evidence";

interface OverviewPrototypeProps {
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
  today: Day | null;
  people: AdminOverview["people"];
  reviewWaiting: number;
  oldestReview: { value: number; unit: "hour" | "day"; phrase: string } | null;
  eodSubmittedPeople: number;
  personMinutes: Map<string, number[]>;
  personMinutesTotal: Map<string, number>;
  generatedAt: number;
  headline: string;
  deck: string;
}

const PROTOTYPES: Array<{ id: PrototypeId; label: string; note: string }> = [
  { id: "brief", label: "Brief", note: "Editorial" },
  { id: "signal", label: "Signal board", note: "Analytical" },
  { id: "ledger", label: "Ledger", note: "People first" },
];

const METRICS: Array<{ id: MetricKey; label: string; noun: string }> = [
  { id: "completed", label: "Outcomes", noun: "completed outcomes" },
  { id: "updates", label: "Updates", noun: "recorded updates" },
  { id: "recaps", label: "Recaps", noun: "generated recaps" },
  { id: "evidence", label: "Evidence", noun: "evidence rows" },
];

function readPrototype(): PrototypeId {
  if (typeof window === "undefined") return "brief";
  const requested = new URLSearchParams(window.location.search).get("prototype");
  return requested === "signal" || requested === "ledger" ? requested : "brief";
}

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

function comparisonPhrase(current: number, previous: number) {
  const delta = deltaPercent(current, previous);
  if (delta === null) return "with no prior record to compare";
  if (delta === 0) return "level with the seven before";
  return `${Math.abs(delta)}% ${delta > 0 ? "above" : "below"} the seven before`;
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

function buildModel(data: AdminOverview): Model {
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
  const eodSubmittedPeople = data.people.filter((person) => person.eodToday === "submitted" || person.eodToday === "pending_review" || person.eodToday === "approved").length;
  const people = [...data.people].sort((left, right) => {
    const rank = (person: AdminOverview["people"][number]) =>
      person.attendance.state === "active" ? 0
        : person.attendance.state === "paused" ? 1
          : person.attendance.state === "off_shift" ? 2 : 3;
    return rank(left) - rank(right) || left.displayName.localeCompare(right.displayName);
  });

  const dayIndex = new Map(days.map((day, index) => [day.date, index]));
  const personMinutes = new Map<string, number[]>();
  for (const person of data.people) personMinutes.set(person.personId, days.map(() => 0));
  for (const point of data.timeSeries) {
    const index = dayIndex.get(point.date);
    if (index === undefined) continue;
    for (const person of point.people) {
      const values = personMinutes.get(person.personId);
      if (values) values[index] = person.minutes;
    }
  }
  const personMinutesTotal = new Map<string, number>();
  for (const [personId, values] of personMinutes) {
    personMinutesTotal.set(personId, values.reduce((sum, value) => sum + value, 0));
  }

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
    today: days[days.length - 1] ?? null,
    people, reviewWaiting, oldestReview, eodSubmittedPeople, personMinutes, personMinutesTotal, generatedAt,
    headline, deck: deckParts.join(" "),
  };
}

function useOverviewPrototype() {
  return useQuery<AdminOverview>({
    queryKey: adminKeys.overview(todayIso()),
    queryFn: () => fetchAdminOverview(),
    select: normalizeAdminOverview,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
}

export default function OverviewPrototype(props: OverviewPrototypeProps) {
  const [prototype, setPrototype] = useState<PrototypeId>(readPrototype);
  const overview = useOverviewPrototype();
  const model = useMemo(() => (overview.data ? buildModel(overview.data) : null), [overview.data]);

  const choose = (next: PrototypeId) => {
    setPrototype(next);
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("prototype", next);
    const query = params.toString().replace("preview-admin=&", "preview-admin&").replace(/&preview-admin=$/, "&preview-admin");
    window.history.replaceState({}, "", `${window.location.pathname}?${query}`);
  };

  if (overview.isLoading) {
    return (
      <div className="ovp ovp-loading" aria-busy="true">
        <span className="ovp-skeleton is-tall" />
        <span className="ovp-skeleton" />
        <span className="ovp-skeleton is-short" />
      </div>
    );
  }
  if (overview.error || !model) {
    return (
      <Notice tone="err">
        The overview prototype could not load the workspace snapshot.
        <button type="button" className="admin-button ghost" onClick={() => void overview.refetch()}>Retry</button>
      </Notice>
    );
  }

  const isEmpty = model.data.people.length === 0
    && !model.days.some((day) => day.completed || day.updates || day.recaps || day.evidence || day.minutes);
  if (isEmpty) {
    return (
      <>
        <div className="ovp ovp-empty">
          <p className="ovp-kicker">No recorded work</p>
          <h2 className="ovp-display">The window is empty.</h2>
          <p className="ovp-deck">No teammate, outcome, update, recap, evidence, or session minute was recorded in the last fourteen workdays. The instrument fills as the record arrives.</p>
        </div>
        <PrototypeSwitcher value={prototype} onChange={choose} />
      </>
    );
  }

  return (
    <>
      {prototype === "brief" ? <Brief model={model} {...props} /> : null}
      {prototype === "signal" ? <SignalBoard model={model} {...props} /> : null}
      {prototype === "ledger" ? <Ledger model={model} {...props} /> : null}
      <PrototypeSwitcher value={prototype} onChange={choose} />
    </>
  );
}

/* --- Shared chart primitives --------------------------------------------- */

const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 24;

function Sparkline({ values, exactLabel }: { values: number[]; exactLabel?: string }) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? SPARK_WIDTH / 2 : (index / (values.length - 1)) * SPARK_WIDTH;
    const y = SPARK_HEIGHT - (value / max) * (SPARK_HEIGHT - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const last = points[points.length - 1]?.split(",").map(Number) ?? [0, 0];
  return (
    <>
      <svg className="ovp-spark" viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
        <line x1={SPARK_WIDTH / 2} y1="0" x2={SPARK_WIDTH / 2} y2={SPARK_HEIGHT} stroke="var(--line)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        <polyline points={points.join(" ")} fill="none" stroke="var(--observed)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={last[0]} cy={last[1]} r="2.2" fill="var(--observed)" vectorEffect="non-scaling-stroke" />
      </svg>
      {exactLabel ? <span className="ovp-visually-hidden">{exactLabel}</span> : null}
    </>
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
  const plotRef = useRef<HTMLDivElement | null>(null);
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
        ref={plotRef}
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
        <thead><tr><th>Workday</th><th>{metricLabel}</th><th>Outcomes</th><th>Updates</th><th>Recaps</th><th>Evidence</th><th>Observed minutes</th></tr></thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th>{day.date}</th>
              <td>{day[metric]}</td>
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

interface HeatMetric { id: MetricKey; label: string }

const HEAT_METRICS: HeatMetric[] = [
  { id: "completed", label: "Outcomes" },
  { id: "updates", label: "Updates" },
  { id: "recaps", label: "Recaps" },
  { id: "evidence", label: "Evidence" },
];

function FortnightHeat({ days }: { days: Day[] }) {
  const [active, setActive] = useState<{ row: number; column: number }>({ row: 0, column: days.length - 1 });
  const [announcement, setAnnouncement] = useState("");
  const maxima = HEAT_METRICS.map((metric) => Math.max(1, ...days.map((day) => day[metric.id])));
  const activeDay = days[active.column];

  const move = (rowDelta: number, columnDelta: number) => {
    const row = (active.row + rowDelta + HEAT_METRICS.length) % HEAT_METRICS.length;
    const column = Math.min(Math.max(active.column + columnDelta, 0), days.length - 1);
    setActive({ row, column });
    const day = days[column];
    if (day) setAnnouncement(`${HEAT_METRICS[row].label} row. ${shortDate(day.date)}. ${plural(day.completed, "outcome")}, ${plural(day.updates, "update")}, ${plural(day.recaps, "recap")}, ${plural(day.evidence, "evidence row")}, ${formatMinutes(day.minutes)} observed.`);
  };

  return (
    <figure className="ovp-heat">
      <figcaption className="ovp-heat-head">
        <span>Consistency across the fortnight</span>
        <span className="ovp-heat-scale" aria-hidden>Less <i /><i /><i /><i /> More</span>
      </figcaption>
      <div
        className="ovp-heat-body"
        tabIndex={0}
        role="img"
        aria-label={`Heatmap of outcomes, updates, recaps, and evidence across ${days.length} workdays. Use the arrow keys to review each day and measure. The exact values are listed after the chart.`}
        onFocus={() => { if (!activeDay) move(0, 0); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") { event.preventDefault(); move(0, 1); }
          if (event.key === "ArrowLeft") { event.preventDefault(); move(0, -1); }
          if (event.key === "ArrowDown") { event.preventDefault(); move(1, 0); }
          if (event.key === "ArrowUp") { event.preventDefault(); move(-1, 0); }
          if (event.key === "Home") { event.preventDefault(); setActive({ ...active, column: 0 }); }
          if (event.key === "End") { event.preventDefault(); setActive({ ...active, column: days.length - 1 }); }
        }}
      >
        <span className="ovp-heat-labels" aria-hidden>
          {HEAT_METRICS.map((metric) => <b key={metric.id}>{metric.label}</b>)}
        </span>
        <span className="ovp-heat-grid" aria-hidden>
          {HEAT_METRICS.map((metric, row) => (
            <span className="ovp-heat-row" key={metric.id}>
              {days.map((day, column) => {
                const value = day[metric.id];
                const strength = value / maxima[row];
                const isActive = active.row === row && active.column === column;
                return (
                  <i
                    key={day.date}
                    className={`ovp-heat-cell${isActive ? " is-active" : ""}${column === days.length - 1 ? " is-today" : ""}`}
                    style={{ "--heat": (0.06 + strength * 0.78).toFixed(2), animationDelay: `${Math.min(row * 40 + column * 6, 220)}ms` } as CSSProperties}
                    onMouseEnter={() => setActive({ row, column })}
                    title={`${metric.label} · ${shortDate(day.date)}: ${value}`}
                  />
                );
              })}
            </span>
          ))}
        </span>
        {activeDay ? (
          <span className="ovp-heat-readout" aria-hidden>
            <b>{shortDate(activeDay.date)}</b>
            <span>Outcomes<em>{activeDay.completed}</em></span>
            <span>Updates<em>{activeDay.updates}</em></span>
            <span>Recaps<em>{activeDay.recaps}</em></span>
            <span>Evidence<em>{activeDay.evidence}</em></span>
            <span>Observed<em>{formatMinutes(activeDay.minutes)}</em></span>
          </span>
        ) : null}
      </div>
      <span className="ovp-heat-axis" aria-hidden>
        {days.map((day, index) => {
          const parts = axisParts(day.date);
          const show = index === 0 || index === days.length - 1 || index % 2 === 0;
          return <i key={day.date}>{show ? <><span className="ovp-axis-month">{parts.month} </span>{parts.day}</> : ""}</i>;
        })}
      </span>
      <table className="ovp-visually-hidden">
        <caption>Exact daily values behind the heatmap</caption>
        <thead><tr><th>Workday</th><th>Outcomes</th><th>Updates</th><th>Recaps</th><th>Evidence</th><th>Observed minutes</th></tr></thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}><th>{day.date}</th><td>{day.completed}</td><td>{day.updates}</td><td>{day.recaps}</td><td>{day.evidence}</td><td>{day.minutes}</td></tr>
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

function Meter({ value, total, label }: { value: number; total: number; label: string }) {
  const share = percent(value, total);
  return (
    <span className="ovp-meter" role="img" aria-label={`${label}: ${value} of ${total}`}>
      <i style={{ width: `${share}%` }} />
    </span>
  );
}

function Delta({ current, previous, unit = "" }: { current: number; previous: number; unit?: string }) {
  const delta = deltaPercent(current, previous);
  if (delta === null) return <span className="ovp-delta is-flat">no prior record</span>;
  if (delta === 0) return <span className="ovp-delta is-flat"><Minus size={12} aria-hidden />{unit}level with prior 7</span>;
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`ovp-delta ${delta > 0 ? "is-up" : "is-down"}`}>
      <Icon size={12} aria-hidden />{Math.abs(delta)}%<small> vs prior 7</small>
    </span>
  );
}

function Decisions({ model, onOpenSection, compact = false }: { model: Model; onOpenSection: OverviewPrototypeProps["onOpenSection"]; compact?: boolean }) {
  const items = [...model.data.attention].sort((left, right) => {
    const severity = { error: 0, warn: 1, info: 2 } as Record<string, number>;
    return (severity[left.severity] ?? 3) - (severity[right.severity] ?? 3) || right.count - left.count;
  });
  if (!items.length) {
    return (
      <span className="ovp-clear">
        <CheckCircle2 size={16} aria-hidden />
        Nothing needs a decision. Reviews, EODs, and the task record are clear.
      </span>
    );
  }
  return (
    <ul className={`ovp-decisions${compact ? " is-compact" : ""}`}>
      {items.map((item) => (
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
          <Meter value={row.value} total={row.total} label={row.label} />
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

/* --- Direction 1: the Brief ---------------------------------------------- */

function Brief({ model, onOpenSection, onOpenRecaps }: { model: Model } & OverviewPrototypeProps) {
  const counts = model.data.counts;
  const recentMean = model.recent.length ? model.recentTotals.completed / model.recent.length : 0;
  const priorMean = model.prior.length ? model.priorTotals.completed / model.prior.length : 0;
  const evidenceShare = percent(counts.evidenceOutputToday, counts.evidenceToday);
  const facts = [
    { label: "On shift", value: String(counts.onShift), detail: `of ${counts.people} teammates`, onClick: () => onOpenSection("people") },
    { label: "Outcomes today", value: String(counts.tasksCompletedToday), detail: `${counts.tasksOpen} open · ${counts.tasksOverdue} overdue · ${model.recentTotals.completed} in 7d`, onClick: () => onOpenSection("tasks") },
    { label: "Recaps today", value: String(counts.recapsToday), detail: `${counts.recapsReviewedToday} reviewed · ${model.reviewWaiting} waiting · ${model.recentTotals.recaps} in 7d`, onClick: onOpenRecaps },
    { label: "Evidence today", value: String(counts.evidenceToday), detail: `${counts.evidenceOutputToday} output · ${counts.evidenceActivityToday} activity · ${model.recentTotals.evidence} in 7d`, onClick: () => onOpenSection("evidence") },
    { label: "Awaiting review", value: String(counts.reportsPendingReview), detail: model.oldestReview ? `oldest ${model.oldestReview.phrase}` : "queue is clear", onClick: () => onOpenSection("review") },
  ];

  return (
    <div className="ovp ovp-brief">
      <header className="ovp-brief-head">
        <div>
          <p className="ovp-kicker">{new Date(`${model.data.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · updated {relativeTime(model.data.generatedAt, model.generatedAt)}</p>
          <h2 className="ovp-display">{model.headline}</h2>
          <p className="ovp-deck">{model.deck}</p>
        </div>
        <div className="ovp-brief-index">
          <p className="ovp-kicker">Oldest waiting</p>
          <OldestReview model={model} />
          <button type="button" className="ovp-text-action" onClick={() => onOpenSection("review")}>
            Open EOD Review <ArrowRight size={13} aria-hidden />
          </button>
        </div>
      </header>

      <section className="ovp-facts" aria-label="Today at a glance">
        {facts.map((fact) => (
          <button key={fact.label} type="button" className="ovp-fact" onClick={fact.onClick} aria-label={`${fact.label}: ${fact.value}. ${fact.detail}`}>
            <span className="ovp-kicker">{fact.label}</span>
            <b className="ovp-fact-value">{fact.value}</b>
            <span className="ovp-fact-detail">{fact.detail}</span>

          </button>
        ))}
      </section>

      <div className="ovp-brief-body">
        <section className="ovp-panel ovp-brief-chart" aria-labelledby="ovp-brief-chart-title">
          <div className="ovp-section-head">
            <div>
              <h3 id="ovp-brief-chart-title">Two weeks of outcomes</h3>
              <p>Completed outcomes per workday, with the seven-day average before and after the turn.</p>
            </div>
            <span className="ovp-chart-total"><b>{model.recentTotals.completed}</b><small>last 7 workdays</small></span>
          </div>
          <TrendBars
            days={model.days}
            metric="completed"
            metricLabel="Outcomes"
            refs={[
              { value: priorMean, label: "prior 7-day avg", kind: "prior" },
              { value: recentMean, label: "last 7-day avg", kind: "recent" },
            ]}
            caption={<>The last seven workdays produced <b>{plural(model.recentTotals.completed, "outcome")}</b>, {comparisonPhrase(model.recentTotals.completed, model.priorTotals.completed)}.</>}
          />
        </section>

        <aside className="ovp-brief-decisions" aria-labelledby="ovp-brief-decisions-title">
          <div className="ovp-section-head">
            <div>
              <h3 id="ovp-brief-decisions-title">What needs a decision</h3>
              <p>Ranked by consequence, not arrival.</p>
            </div>
          </div>
          <Decisions model={model} onOpenSection={onOpenSection} />
        </aside>
      </div>

      <section className="ovp-panel ovp-brief-time" aria-labelledby="ovp-brief-time-title">
        <div className="ovp-section-head">
          <div>
            <h3 id="ovp-brief-time-title">Where the hours went</h3>
            <p>Observed work time per workday, split by teammate. This is session context, never a score.</p>
          </div>
          <span className="ovp-chart-total"><b>{formatMinutes(model.recentTotals.minutes)}</b><small>last 7 workdays</small></span>
        </div>
        {model.days.some((day) => day.minutes > 0)
          ? <StackedTimeBars ariaLabel="Observed work time per workday for the last 14 workdays, split by teammate" points={model.data.timeSeries} />
          : <p className="ovp-empty-note">No observed work time was recorded in this window.</p>}
      </section>

      <p className="ovp-footnote">
        Activity context is descriptive and never proves attendance, productivity, or task completion.
        <span> Evidence counts rows, not minutes. Session time is clock-in to clock-out minus pauses.</span>
      </p>
    </div>
  );
}

/* --- Direction 2: the Signal board --------------------------------------- */

function SignalBoard({ model, onOpenSection, onOpenPerson }: { model: Model } & OverviewPrototypeProps) {
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
        <PulseFact label="Outcomes" metric="completed" model={model} spark={model.days.map((day) => day.completed)} />
        <PulseFact label="Updates" metric="updates" model={model} spark={model.days.map((day) => day.updates)} />
        <PulseFact label="Recaps" metric="recaps" model={model} spark={model.days.map((day) => day.recaps)} />
        <PulseFact label="Evidence" metric="evidence" model={model} spark={model.days.map((day) => day.evidence)} />
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

        <section className="ovp-module ovp-span-12" aria-labelledby="ovp-signal-heat-title">
          <div className="ovp-module-head">
            <div>
              <h3 id="ovp-signal-heat-title">Where the fortnight was strong</h3>
              <p>Each row is scaled to its own fourteen-day high, so shape, not volume, is the comparison.</p>
            </div>
            <span className="ovp-heat-today"><i aria-hidden />Latest workday</span>
          </div>
          <FortnightHeat days={model.days} />
        </section>

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
          <Decisions model={model} onOpenSection={onOpenSection} compact />
        </section>
      </div>

      <p className="ovp-footnote">
        Observed time and evidence are context, not a score. Recaps count generated intervals; reviews count the employee's confirmations and corrections.
      </p>
    </div>
  );
}

function PulseFact({ label, metric, model, spark }: { label: string; metric: MetricKey; model: Model; spark: number[] }) {
  return (
    <div className="ovp-pulse-cell">
      <span className="ovp-kicker">{label}</span>
      <span className="ovp-pulse-main">
        <b>{model.recentTotals[metric]}</b>
        <Sparkline values={spark} />
      </span>
      <span className="ovp-pulse-foot">
        <Delta current={model.recentTotals[metric]} previous={model.priorTotals[metric]} />
        <small>{Math.round(mean(spark.slice(-7)) * 10) / 10}/day</small>
      </span>
    </div>
  );
}

/* --- Direction 3: the Ledger --------------------------------------------- */

function Ledger({ model, onOpenSection, onOpenPerson }: { model: Model } & OverviewPrototypeProps) {
  const counts = model.data.counts;
  const totals = model.personMinutesTotal;
  const teamMinutes = [...totals.values()].reduce((sum, value) => sum + value, 0);
  const eodSubmitted = model.eodSubmittedPeople;

  return (
    <div className="ovp ovp-ledger">
      <header className="ovp-ledger-head">
        <div>
          <p className="ovp-kicker">{new Date(`${model.data.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</p>
          <h2 className="ovp-display">Today, person by person.</h2>
          <p className="ovp-deck">{model.deck}</p>
        </div>
        <dl className="ovp-ledger-facts">
          <div><dt>On shift</dt><dd>{counts.onShift}<small> / {counts.people}</small></dd></div>
          <div><dt>EOD in</dt><dd>{eodSubmitted}<small> / {counts.people}</small></dd></div>
          <div><dt>Reviews</dt><dd>{counts.reportsPendingReview}</dd></div>
        </dl>
      </header>

      <div className="ovp-ledger-body">
        <section className="ovp-panel ovp-ledger-table-wrap" aria-labelledby="ovp-ledger-table-title">
          <div className="ovp-section-head">
            <div>
              <h3 id="ovp-ledger-table-title">The day's ledger</h3>
              <p>Status, today's record, and the fourteen-workday time shape for every teammate.</p>
            </div>
          </div>
          <div className="ovp-ledger-scroll">
            <table className="ovp-table">
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Now</th>
                  <th scope="col" className="is-num">Outcomes</th>
                  <th scope="col" className="is-num">Recaps</th>
                  <th scope="col" className="is-num">Evidence</th>
                  <th scope="col">EOD</th>
                  <th scope="col">14 workdays</th>
                </tr>
              </thead>
              <tbody>
                {model.people.map((person, index) => {
                  const values = model.personMinutes.get(person.personId) ?? [];
                  return (
                    <tr
                      key={person.personId}
                      className={person.attendance.state === "active" ? "is-on" : ""}
                      style={{ animationDelay: `${Math.min(index * 18, 140)}ms` }}
                    >
                      <td data-label="Person">
                        <span className="ovp-person">
                          <Avatar name={person.displayName} size={28} />
                          <span>
                            <button type="button" className="ovp-person-name" onClick={() => onOpenPerson(person.personId)}>{person.displayName}</button>
                            <small>{person.roleProfile ?? "Unmapped role"}</small>
                          </span>
                        </span>
                      </td>
                      <td data-label="Now">
                        <Pill tone={attendanceTone(person.attendance.state)}>
                          {attendanceLabel(person.attendance.state)}{person.attendance.freshness === "stale" ? " · stale" : ""}
                        </Pill>
                      </td>
                      <td data-label="Outcomes" className="is-num">{person.tasksCompletedToday}</td>
                      <td data-label="Recaps" className="is-num">{person.recapsReviewedToday}<small className="ovp-muted"> of {person.recapsToday}</small></td>
                      <td data-label="Evidence" className="is-num">{person.evidenceToday}</td>
                      <td data-label="EOD">
                        {person.eodToday
                          ? <Pill tone={person.eodToday === "approved" ? "ok" : person.eodToday === "pending_review" ? "info" : "neutral"}>{statusLabel(person.eodToday)}</Pill>
                          : person.eodOutstanding ? <Pill tone="warn">Outstanding</Pill> : <span className="ovp-muted">—</span>}
                      </td>
                      <td data-label="14 workdays">
                        <span className="ovp-person-time">
                          <Sparkline values={values} exactLabel={`${person.displayName} observed minutes by workday: ${values.join(", ")}`} />
                          <small>{formatMinutes(totals.get(person.personId) ?? 0)}</small>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                <tr className="ovp-table-total">
                  <td data-label="Team">Team</td>
                  <td data-label="Now" />
                  <td data-label="Outcomes" className="is-num">{counts.tasksCompletedToday}</td>
                  <td data-label="Recaps" className="is-num">{counts.recapsReviewedToday}<small className="ovp-muted"> of {counts.recapsToday}</small></td>
                  <td data-label="Evidence" className="is-num">{counts.evidenceToday}</td>
                  <td data-label="EOD">{eodSubmitted} in</td>
                  <td data-label="14 workdays">
                    <span className="ovp-person-time">
                      <Sparkline values={model.days.map((day) => day.minutes)} exactLabel={`Team observed minutes by workday: ${model.days.map((day) => day.minutes).join(", ")}`} />
                      <small>{formatMinutes(teamMinutes)}</small>
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="ovp-table-note">Observed time is the fourteen-workday shape behind each person, never a ranking.</p>
        </section>

        <aside className="ovp-ledger-rail">
          <section aria-labelledby="ovp-ledger-decisions-title">
            <div className="ovp-section-head">
              <div>
                <h3 id="ovp-ledger-decisions-title">Needs a decision</h3>
                <p>The oldest and most consequential first.</p>
              </div>
            </div>
            <Decisions model={model} onOpenSection={onOpenSection} />
          </section>
          <section className="ovp-ledger-close" aria-labelledby="ovp-ledger-close-title">
            <div className="ovp-section-head">
              <div>
                <h3 id="ovp-ledger-close-title">The day closes when</h3>
                <p>What is still open at the record level.</p>
              </div>
            </div>
            <DayClose model={model} />
            <button type="button" className="ovp-text-action" onClick={() => onOpenSection("review")}>Open EOD Review <ArrowRight size={13} aria-hidden /></button>
          </section>
        </aside>
      </div>

      <section className="ovp-panel ovp-ledger-fortnight" aria-labelledby="ovp-ledger-fortnight-title">
        <div className="ovp-section-head">
          <div>
            <h3 id="ovp-ledger-fortnight-title">The fortnight behind the day</h3>
            <p>Totals and observed time across the same fourteen workdays.</p>
          </div>
          <div className="ovp-fortnight-totals">
            <span><b>{model.days.reduce((sum, day) => sum + day.completed, 0)}</b><small>outcomes</small></span>
            <span><b>{model.days.reduce((sum, day) => sum + day.updates, 0)}</b><small>updates</small></span>
            <span><b>{model.days.reduce((sum, day) => sum + day.evidence, 0)}</b><small>evidence</small></span>
            <span><b>{formatMinutes(model.days.reduce((sum, day) => sum + day.minutes, 0))}</b><small>observed</small></span>
          </div>
        </div>
        {model.days.some((day) => day.minutes > 0)
          ? <StackedTimeBars ariaLabel="Observed work time per workday for the last 14 workdays, split by teammate" points={model.data.timeSeries} />
          : <p className="ovp-empty-note">No observed work time was recorded in this window.</p>}
      </section>

      <p className="ovp-footnote">
        The ledger reports what was recorded. Evidence counts rows, not minutes; session time is clock-in to clock-out minus pauses.
      </p>
    </div>
  );
}

/* --- Prototype switcher --------------------------------------------------- */

function PrototypeSwitcher({ value, onChange }: { value: PrototypeId; onChange: (next: PrototypeId) => void }) {
  const switcher = (
    <div className="ovp-switcher" role="group" aria-label="Overview prototype">
      <span className="ovp-switcher-label">Prototype</span>
      {PROTOTYPES.map((prototype) => (
        <button
          key={prototype.id}
          type="button"
          className={prototype.id === value ? "is-active" : ""}
          aria-pressed={prototype.id === value}
          title={prototype.note}
          onClick={() => onChange(prototype.id)}
        >
          {prototype.label}
        </button>
      ))}
    </div>
  );
  return typeof document === "undefined" ? switcher : createPortal(switcher, document.body);
}

