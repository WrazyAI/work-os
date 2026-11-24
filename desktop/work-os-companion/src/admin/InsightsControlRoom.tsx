import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Gauge, Minus, TriangleAlert } from "lucide-react";
import { PlanReliability, type ReliabilityRow } from "../InsightCharts";
import { formatWorkOsFullDate } from "../dateFormat";
import { ShareBars, StackedTimeBars } from "./charts";
import { formatMinutes, relativeTime, shortDate, statusLabel } from "./data";
import { Drawer, Notice, Segmented, SelectField } from "./ui";
import type { AdminInsightPersonDay, AdminInsightPersonRow, AdminInsightRange, AdminInsights } from "./types";
import "./insights-control.css";

type MatrixMeasure = "observedMinutes" | "outcomesCompleted" | "updates" | "evidence";

const MEASURES: Array<{ id: MatrixMeasure; label: string; noun: string; ink: string; kind: "minutes" | "count" }> = [
  { id: "observedMinutes", label: "Session time", noun: "session minutes", ink: "var(--observed)", kind: "minutes" },
  { id: "outcomesCompleted", label: "Outcomes", noun: "recorded outcomes", ink: "var(--ink)", kind: "count" },
  { id: "updates", label: "Updates", noun: "recorded updates", ink: "var(--chart-7)", kind: "count" },
  { id: "evidence", label: "Evidence", noun: "evidence rows", ink: "var(--chart-4)", kind: "count" },
];

interface MatrixBucket {
  key: string;
  label: string;
  start: string;
  end: string;
  days: string[];
  kind: "day" | "week";
}

interface CellFacts {
  observedMinutes: number;
  outcomesCompleted: number;
  updates: number;
  eodSubmitted: number;
  evidenceOutput: number;
  evidenceActivity: number;
}

const EMPTY_FACTS: CellFacts = { observedMinutes: 0, outcomesCompleted: 0, updates: 0, eodSubmitted: 0, evidenceOutput: 0, evidenceActivity: 0 };

function percent(value: number, total: number): number | null {
  return total > 0 ? Math.round((value / total) * 100) : null;
}

function dayLabel(value: string) {
  return shortDate(`${value}T12:00:00Z`);
}

function rangeLabel(data: AdminInsights) {
  return `${formatWorkOsFullDate(data.from)} – ${formatWorkOsFullDate(data.through)}`;
}

function compactMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
}

function plural(value: number, singular: string, pluralForm = `${singular}s`) {
  return `${value} ${value === 1 ? singular : pluralForm}`;
}

function mondayOf(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return value;
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

/** Match the matrix to the selected range: daily for a week, weekly for the
 * longer ranges. The series already carries only workdays, so a "7 day" range
 * renders the five workdays the charts use. */
export function matrixBuckets(series: AdminInsights["series"], range: AdminInsightRange): MatrixBucket[] {
  if (range === "7d") {
    return series.map((point) => ({
      key: point.date,
      label: dayLabel(point.date),
      start: point.date,
      end: point.date,
      days: [point.date],
      kind: "day",
    }));
  }
  const weeks = new Map<string, string[]>();
  for (const point of series) {
    const key = mondayOf(point.date);
    const days = weeks.get(key) ?? [];
    days.push(point.date);
    weeks.set(key, days);
  }
  return [...weeks.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, days]) => ({
      key,
      label: days[0] === days[days.length - 1] ? dayLabel(days[0]) : `${dayLabel(days[0])}–${dayLabel(days[days.length - 1])}`,
      start: days[0],
      end: days[days.length - 1],
      days,
      kind: "week",
    }));
}

function valueFor(facts: Pick<CellFacts, "observedMinutes" | "outcomesCompleted" | "updates" | "evidenceOutput" | "evidenceActivity">, measure: MatrixMeasure) {
  if (measure === "observedMinutes") return facts.observedMinutes;
  if (measure === "outcomesCompleted") return facts.outcomesCompleted;
  if (measure === "updates") return facts.updates;
  return facts.evidenceOutput + facts.evidenceActivity;
}

function cellLabel(value: number, measure: MatrixMeasure) {
  return measure === "observedMinutes" ? compactMinutes(value) : String(value);
}

function aggregateFacts(days: AdminInsightPersonDay[], bucket: MatrixBucket): CellFacts {
  const wanted = new Set(bucket.days);
  return days.reduce((facts, day) => {
    if (!wanted.has(day.date)) return facts;
    facts.observedMinutes += day.observedMinutes;
    facts.outcomesCompleted += day.outcomesCompleted;
    facts.updates += day.updates;
    facts.eodSubmitted += day.eodSubmitted;
    facts.evidenceOutput += day.evidenceOutput;
    facts.evidenceActivity += day.evidenceActivity;
    return facts;
  }, { ...EMPTY_FACTS });
}

function delta(current: number, previous: number, unit: "count" | "minutes" | "points" = "count") {
  const difference = current - previous;
  const text = unit === "minutes"
    ? `${formatMinutes(Math.abs(difference))} ${difference >= 0 ? "more" : "less"}`
    : unit === "points"
      ? `${Math.abs(difference)} ${difference === 1 ? "point" : "points"} ${difference >= 0 ? "higher" : "lower"}`
      : `${Math.abs(difference)} ${difference >= 0 ? "more" : "fewer"}`;
  return { difference, text: difference === 0 ? "Same as the earlier period" : `${text} than the earlier period` };
}

function DeltaMark({ current, previous, unit = "count", tone = "neutral" }: {
  current: number;
  previous: number;
  unit?: "count" | "minutes" | "points";
  tone?: "neutral" | "warn";
}) {
  const value = delta(current, previous, unit);
  const Icon = value.difference === 0 ? Minus : value.difference > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`control-delta ${value.difference === 0 ? "is-flat" : ""} ${tone === "warn" ? "is-warn" : ""}`}>
      <Icon size={11} aria-hidden />
      {value.text}
    </span>
  );
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "neutral" | "signal" | "warn" }) {
  return (
    <div className={`control-metric ${tone === "signal" ? "is-signal" : tone === "warn" ? "is-warn" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function RatioLine({ label, value, detail, color = "var(--ink)" }: { label: string; value: number | null; detail: string; color?: string }) {
  return (
    <div className="control-ratio">
      <div className="control-ratio-head"><span>{label}</span><strong>{value === null ? "—" : `${value}%`}</strong></div>
      <div className="control-ratio-track" role="img" aria-label={`${label}: ${value === null ? "not recorded" : `${value}%`}`}>
        {value !== null ? <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /> : null}
      </div>
      <small>{detail}</small>
    </div>
  );
}

function AttentionList({ items }: { items: string[] }) {
  if (!items.length) return <p className="control-quiet">Nothing the record flagged in this range.</p>;
  return (
    <ul className="control-attention-list">
      {items.map((line, index) => (
        <li key={index}><TriangleAlert size={12} aria-hidden /><span>{line}</span></li>
      ))}
    </ul>
  );
}

function NextList({ items }: { items: string[] }) {
  return (
    <ul className="control-next-list">
      {items.map((line, index) => (
        <li key={index}><ArrowRight size={12} aria-hidden /><span>{line}</span></li>
      ))}
    </ul>
  );
}

interface Derived {
  commitment: number | null;
  onTime: number | null;
  activeRate: number | null;
  eodApproval: number | null;
  peopleLate: number;
  people: AdminInsightPersonRow[];
  personDays: Map<string, AdminInsightPersonDay[]>;
}

function derive(data: AdminInsights, people: AdminInsightPersonRow[]): Derived {
  const scopedIds = new Set(people.map((person) => person.personId));
  const personDays = new Map(
    (data.peopleSeries ?? [])
      .filter((series) => scopedIds.has(series.personId))
      .map((series) => [series.personId, series.days]),
  );
  return {
    commitment: percent(data.totals.plannedCompleted, data.totals.planned),
    onTime: percent(data.totals.outcomesCompleted, data.totals.outcomesCompleted + data.totals.outcomesLate),
    activeRate: percent(data.totals.activePeople, people.length),
    eodApproval: percent(data.totals.eodApproved, data.totals.eodSubmitted),
    peopleLate: people.filter((person) => person.outcomesLate > 0).length,
    people,
    personDays,
  };
}

function reliabilityRows(data: AdminInsights, derived: Derived): ReliabilityRow[] {
  return [
    {
      key: "commitment",
      label: "Commitments landed",
      percent: derived.commitment,
      detail: data.totals.planned > 0 ? `${data.totals.plannedCompleted} of ${data.totals.planned} planned items` : "No planned items in this range",
    },
    {
      key: "on-time",
      label: "Outcomes on time",
      percent: derived.onTime,
      detail: `${data.totals.outcomesLate} late of ${data.totals.outcomesCompleted + data.totals.outcomesLate} dated outcomes`,
    },
    {
      key: "active",
      label: "People with recorded work",
      percent: derived.activeRate,
      detail: `${data.totals.activePeople} of ${derived.people.length} people recorded outcomes, updates, tracked time, or an EOD`,
    },
  ];
}

function PersonFactsDrawer({ person, data, derived, onClose }: {
  person: AdminInsightPersonRow | null;
  data: AdminInsights;
  derived: Derived;
  onClose: () => void;
}) {
  if (!person) return null;
  const days = derived.personDays.get(person.personId) ?? [];
  const sessionMinutes = days.reduce((sum, day) => sum + day.observedMinutes, 0);
  const recent = days.slice(-7);
  return (
    <Drawer
      open
      onClose={onClose}
      title={person.displayName}
      subtitle={`${person.roleProfile ?? "Unmapped role"} · ${rangeLabel(data)}`}
      width={560}
    >
      <div className="control-drawer">
        <section className="control-drawer-section">
          <h3>Recorded facts</h3>
          <div className="control-kv-grid">
            <div><span>Outcomes</span><b>{person.outcomesCompleted}</b></div>
            <div><span>Late</span><b className={person.outcomesLate ? "is-warn" : undefined}>{person.outcomesLate}</b></div>
            <div><span>Updates</span><b>{person.updates}</b></div>
            <div><span>Substantive</span><b>{person.substantiveUpdates}</b></div>
            <div><span>EOD submitted</span><b>{person.eodSubmitted}</b></div>
            <div><span>Session time</span><b>{sessionMinutes ? formatMinutes(sessionMinutes) : "—"}</b></div>
            <div><span>App/site tracked</span><b>{person.trackedMinutes ? formatMinutes(person.trackedMinutes) : "—"}</b></div>
            <div><span>Output evidence</span><b>{person.evidenceOutput}</b></div>
            <div><span>Activity evidence</span><b>{person.evidenceActivity}</b></div>
          </div>
        </section>
        <section className="control-drawer-section">
          <h3>Commitment</h3>
          <PlanReliability rows={[{
            key: "person-commitment",
            label: "Commitments landed",
            percent: person.commitmentRate,
            detail: person.planned > 0 ? `${person.plannedCompleted} of ${person.planned} planned items` : "No planned items in this range",
          }]} />
        </section>
        <section className="control-drawer-section">
          <div className="control-drawer-heading">
            <h3>Last recorded days</h3>
            <span>{formatMinutes(sessionMinutes)} session time in range</span>
          </div>
          <div className="control-drawer-days">
            {recent.map((day) => (
              <div key={day.date} className="control-drawer-day">
                <span>{dayLabel(day.date)}</span>
                <b>{plural(day.outcomesCompleted + day.updates + day.eodSubmitted, "record", "records")}</b>
                <small>{day.observedMinutes ? formatMinutes(day.observedMinutes) : "—"}</small>
              </div>
            ))}
          </div>
        </section>
        {person.sessionsNeedingCorrection > 0 ? (
          <Notice tone="warn">{plural(person.sessionsNeedingCorrection, "session")} still need a correction; unresolved time stays excluded from observed totals.</Notice>
        ) : null}
        <p className="control-quiet">Last recorded activity {person.lastActivityAt ? relativeTime(person.lastActivityAt) : "—"}. Activity context never proves completion.</p>
      </div>
    </Drawer>
  );
}

export default function InsightsControlRoom({
  data,
  range,
  onRange,
  personId,
  onPerson,
}: {
  data: AdminInsights;
  range: AdminInsightRange;
  onRange: (range: AdminInsightRange) => void;
  personId: string;
  onPerson: (personId: string) => void;
}) {
  const [measure, setMeasure] = useState<MatrixMeasure>("observedMinutes");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [activeCell, setActiveCell] = useState<{
    personId: string;
    bucket: MatrixBucket;
    facts: CellFacts;
    rect: { left: number; top: number; width: number; height: number };
  } | null>(null);

  const scopedPeople = useMemo(
    () => personId ? data.people.filter((person) => person.personId === personId) : data.people,
    [data.people, personId],
  );
  const derived = useMemo(() => derive(data, scopedPeople), [data, scopedPeople]);
  const buckets = useMemo(() => matrixBuckets(data.series, range), [data.series, range]);
  const measureMeta = MEASURES.find((entry) => entry.id === measure) ?? MEASURES[0];
  const selected = selectedPersonId ? data.people.find((person) => person.personId === selectedPersonId) ?? null : null;
  const hasSession = data.timeSeries.some((point) => point.totalMinutes > 0);
  const rangeEmpty = data.totals.outcomesCompleted === 0 && data.totals.updates === 0 && data.totals.eodSubmitted === 0 && data.totals.trackedMinutes === 0 && !hasSession;

  const bucketFacts = (personIdValue: string, bucket: MatrixBucket) => aggregateFacts(derived.personDays.get(personIdValue) ?? [], bucket);
  const max = Math.max(1, ...scopedPeople.flatMap((person) => buckets.map((bucket) => valueFor(bucketFacts(person.personId, bucket), measure))));

  const activePerson = activeCell ? data.people.find((person) => person.personId === activeCell.personId) ?? null : null;
  const tipWidth = 230;
  const tipHeight = 118;
  const viewportWidth = typeof window === "undefined" ? 1440 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 1000 : window.innerHeight;
  const tipGap = 8;
  const tipRightSpace = activeCell ? viewportWidth - (activeCell.rect.left + activeCell.rect.width) - 12 : 0;
  const tipLeftSpace = activeCell ? activeCell.rect.left - 12 : 0;
  const tipRight = !!activeCell && tipRightSpace >= tipWidth + tipGap;
  const tipOnSide = !!activeCell && (tipRight || (!tipRight && tipLeftSpace >= tipWidth + tipGap));
  const tipLeft = activeCell
    ? (tipRight
      ? activeCell.rect.left + activeCell.rect.width + tipGap
      : tipOnSide
        ? activeCell.rect.left - tipWidth - tipGap
        : Math.max(12, Math.min(activeCell.rect.left + activeCell.rect.width / 2 - tipWidth / 2, viewportWidth - tipWidth - 12)))
    : 0;
  const tipBelow = !!activeCell && !tipOnSide && activeCell.rect.top < 190;
  const tipTop = activeCell
    ? (tipOnSide
      ? Math.max(12, Math.min(activeCell.rect.top, viewportHeight - tipHeight - 12))
      : tipBelow
        ? activeCell.rect.top + activeCell.rect.height + tipGap
        : activeCell.rect.top - tipGap)
    : 0;

  const showCell = (personIdValue: string, bucket: MatrixBucket, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setActiveCell({
      personId: personIdValue,
      bucket,
      facts: bucketFacts(personIdValue, bucket),
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    });
  };

  return (
    <div className="insights-control-page">
      <div className="control-toolbar">
        <div className="control-toolbar-title">
          <span>Range</span>
          <b>{rangeLabel(data)}</b>
        </div>
        <Segmented<AdminInsightRange>
          ariaLabel="Insight range"
          value={range}
          onChange={onRange}
          options={[
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "90d", label: "90 days" },
          ]}
        />
        <SelectField
          ariaLabel="Filter insights by person"
          value={personId}
          onChange={onPerson}
          placeholder="All people"
          options={data.people.map((person) => ({ value: person.personId, label: person.displayName }))}
        />
        <span className="control-toolbar-note">Generated {relativeTime(data.freshness.generatedAt)}</span>
      </div>

      <div className="control">
        <header className="control-head">
          <div className="control-title">
            <p>{rangeLabel(data)}</p>
            <h1>Control room</h1>
            <span>{data.notes.summary}</span>
          </div>
          <div className="control-ribbon">
            <Metric label="Outcomes" value={data.totals.outcomesCompleted} detail={<DeltaMark current={data.totals.outcomesCompleted} previous={data.previous.outcomesCompleted} />} />
            <Metric label="Commitments landed" value={derived.commitment === null ? "—" : `${derived.commitment}%`} tone="signal" detail={`${data.totals.plannedCompleted} of ${data.totals.planned} planned`} />
            <Metric label="People with work" value={`${data.totals.activePeople}/${derived.people.length}`} detail={`${derived.peopleLate} with late outcomes`} />
            <Metric label="EOD submitted" value={data.totals.eodSubmitted} detail={`${data.totals.eodApproved} approved · ${data.totals.eodRejected} returned`} />
          </div>
        </header>

        {rangeEmpty ? (
          <div className="control-empty">
            <Gauge size={22} aria-hidden />
            <h2>Nothing recorded in this range</h2>
            <p>No completed outcomes, updates, EOD reports, or tracked time landed between {formatWorkOsFullDate(data.from)} and {formatWorkOsFullDate(data.through)}.</p>
            <p className="control-quiet">Widen the range, choose another person, or check that the workspace sources are connected.</p>
          </div>
        ) : (
          <>
            <div className="control-grid">
              <section className="control-matrix">
                <header className="control-section-head">
                  <div>
                    <h2>People × {buckets[0]?.kind === "week" ? "weeks" : "days"}</h2>
                    <p>Session time per person per {buckets[0]?.kind === "week" ? "week" : "day"}. Switch the measure; hover for the full record.</p>
                  </div>
                  <Segmented<MatrixMeasure>
                    ariaLabel="Matrix measure"
                    value={measure}
                    onChange={setMeasure}
                    options={MEASURES.map((entry) => ({ value: entry.id, label: entry.label }))}
                  />
                </header>
                <div className="control-matrix-scroll" onScroll={() => setActiveCell(null)}>
                  <div className="control-matrix-grid" style={{ gridTemplateColumns: `minmax(150px, 1.4fr) repeat(${buckets.length}, minmax(24px, 1fr)) 74px` }}>
                    <div className="control-matrix-corner">Person</div>
                    {buckets.map((bucket) => <div key={bucket.key} className="control-matrix-day" title={bucket.label}>{bucket.kind === "week" ? dayLabel(bucket.start) : bucket.label}</div>)}
                    <div className="control-matrix-total-head">{measure === "observedMinutes" ? "Session" : measure === "evidence" ? "Evidence" : measure === "outcomesCompleted" ? "Outcomes" : "Updates"}</div>
                    {scopedPeople.map((person) => {
                      const total = buckets.reduce((sum, bucket) => sum + valueFor(bucketFacts(person.personId, bucket), measure), 0);
                      return (
                        <Fragment key={person.personId}>
                          <button type="button" className="control-matrix-person" onClick={() => setSelectedPersonId(person.personId)}>
                            <span>{person.displayName}</span>
                            <small>{person.outcomesCompleted} outcomes · {person.commitmentRate === null ? "no plan" : `${person.commitmentRate}%`}</small>
                          </button>
                          {buckets.map((bucket) => {
                            const facts = bucketFacts(person.personId, bucket);
                            const value = valueFor(facts, measure);
                            const level = Math.max(0, Math.min(1, value / max));
                            return (
                              <button
                                key={bucket.key}
                                type="button"
                                className={`control-cell ${level > 0.6 ? "is-strong" : ""} ${activeCell?.personId === person.personId && activeCell.bucket.key === bucket.key ? "is-active" : ""}`}
                                style={{ "--matrix-ink": measureMeta.ink, "--level": `${level}` } as CSSProperties}
                                onMouseEnter={(event) => showCell(person.personId, bucket, event.currentTarget)}
                                onFocus={(event) => showCell(person.personId, bucket, event.currentTarget)}
                                onMouseLeave={() => setActiveCell(null)}
                                onBlur={() => setActiveCell(null)}
                                onClick={() => setSelectedPersonId(person.personId)}
                                aria-label={`${person.displayName}, ${bucket.kind === "week" ? `week of ${bucket.label}` : bucket.label}: ${formatMinutes(facts.observedMinutes)} worked, ${plural(facts.outcomesCompleted, "outcome")}, ${plural(facts.updates, "update")}, ${plural(facts.eodSubmitted, "EOD report")}, ${facts.evidenceOutput + facts.evidenceActivity} evidence rows`}
                              >
                                {value ? <span>{cellLabel(value, measure)}</span> : null}
                              </button>
                            );
                          })}
                          <div className="control-matrix-total">{measure === "observedMinutes" ? formatMinutes(total) : total}</div>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
                <div className="control-matrix-foot">
                  <span className="control-key"><i style={{ background: "var(--inset)" }} /> 0 <i style={{ background: measureMeta.ink }} /> {measureMeta.kind === "minutes" ? formatMinutes(max) : max} {measureMeta.noun}</span>
                  <span className="control-hint">Hover or focus a cell for session time, outcomes, updates, EOD, and evidence.</span>
                </div>
                <p className="control-matrix-note">Session time runs clock-in to clock-out, minus pauses. It is not app/site tracking, and it is never a productivity score. Evidence counts recorded rows, not minutes.</p>
              </section>

              <aside className="control-rail">
                <section>
                  <h2>Needs a look</h2>
                  <AttentionList items={data.notes.attention} />
                </section>
                <section>
                  <h2>Update mix</h2>
                  <ShareBars ariaLabel="Recorded updates by kind" items={data.updateKinds.map((kind) => ({ label: statusLabel(kind.kind), value: kind.count }))} />
                </section>
                <section>
                  <h2>Next</h2>
                  <NextList items={data.notes.nextFocus} />
                </section>
                <p className="control-freshness">Generated {relativeTime(data.freshness.generatedAt)} · activity context is never a score.</p>
              </aside>
            </div>

            <div className="control-lower">
              <section>
                <header className="control-section-head"><div><h2>Time worked</h2><p>Observed session time per day, split by teammate.</p></div></header>
                <div className="control-chart">
                  <StackedTimeBars
                    ariaLabel={`Observed session time per day for ${rangeLabel(data)}, split by teammate`}
                    points={data.timeSeries}
                    onSelectPerson={setSelectedPersonId}
                  />
                </div>
              </section>
              <section>
                <header className="control-section-head"><div><h2>Plan reliability</h2><p>Recorded ratios from the plan and the task record.</p></div></header>
                <PlanReliability rows={reliabilityRows(data, derived)} />
                <p className="control-quiet">Ratios are facts from the record, never targets set for a person.</p>
              </section>
            </div>

            <section className="control-table-section">
              <header className="control-section-head">
                <div><h2>Person record</h2><p>Outcomes, timeliness, evidence, and the last recorded activity.</p></div>
                <span>{derived.people.length} people</span>
              </header>
              <div className="control-table-wrap">
                <table className="control-table">
                  <thead><tr><th>Person</th><th>Outcomes</th><th>Late</th><th>Updates</th><th>Commitment</th><th>EOD</th><th>Evidence</th><th>Tracked</th><th>Last</th></tr></thead>
                  <tbody>
                    {derived.people.map((person) => (
                      <tr key={person.personId} onClick={() => setSelectedPersonId(person.personId)}>
                        <td><span className="control-person">{person.displayName}<small>{person.roleProfile ?? "Unmapped role"}</small></span></td>
                        <td>{person.outcomesCompleted}</td>
                        <td className={person.outcomesLate ? "is-warn" : undefined}>{person.outcomesLate}</td>
                        <td>{person.updates}</td>
                        <td>{person.commitmentRate === null ? "—" : `${person.commitmentRate}%`}</td>
                        <td>{person.eodSubmitted}</td>
                        <td>{person.evidenceOutput + person.evidenceActivity}</td>
                        <td>{person.trackedMinutes ? formatMinutes(person.trackedMinutes) : "—"}</td>
                        <td className="is-quiet">{person.lastActivityAt ? relativeTime(person.lastActivityAt) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="control-table-note">Evidence is a row count. Tracked is app/site minutes from Worktivity evidence; session time in the matrix is separate clock-in/out time.</p>
            </section>

            <section className="control-context">
              <header className="control-section-head">
                <div><h2>App and site context</h2><p>Where the tracked app/site time went. Not session time.</p></div>
              </header>
              <div className="control-context-grid">
                <ShareBars ariaLabel="Tracked app and site minutes, strongest first" items={data.topApps.map((app) => ({ label: app.name, value: Math.round(app.minutes), note: "minutes" }))} />
                <div className="control-context-facts">
                  <div><span>Tracked context</span><b>{data.totals.trackedMinutes ? formatMinutes(data.totals.trackedMinutes) : "—"}</b><small>app/site minutes from Worktivity evidence</small></div>
                  <div><span>Activity evidence</span><b>{data.totals.evidenceActivity}</b><small>retained observation rows</small></div>
                  <div><span>Output evidence</span><b>{data.totals.evidenceOutput}</b><small>provider-recorded output rows</small></div>
                </div>
              </div>
            </section>
          </>
        )}
      </div>

      {activePerson && activeCell && typeof document !== "undefined" ? createPortal(
        <div
          className={`matrix-tip ${tipOnSide ? "is-side" : tipBelow ? "is-below" : "is-above"}`}
          role="tooltip"
          aria-hidden="true"
          style={{ left: tipLeft, top: tipTop, width: tipWidth }}
        >
          <span className="matrix-tip-head">{activePerson.displayName} · {activeCell.bucket.kind === "week" ? `Week of ${activeCell.bucket.label}` : activeCell.bucket.label}</span>
          <strong>{formatMinutes(activeCell.facts.observedMinutes)} worked</strong>
          <span>{plural(activeCell.facts.outcomesCompleted, "outcome")}</span>
          <span>{plural(activeCell.facts.updates, "update")}</span>
          {activeCell.facts.eodSubmitted ? <span>{plural(activeCell.facts.eodSubmitted, "EOD report")} submitted</span> : null}
          {activeCell.facts.evidenceOutput + activeCell.facts.evidenceActivity ? <span>{plural(activeCell.facts.evidenceOutput + activeCell.facts.evidenceActivity, "evidence row")}</span> : null}
        </div>,
        document.body,
      ) : null}

      <PersonFactsDrawer person={selected} data={data} derived={derived} onClose={() => setSelectedPersonId(null)} />
    </div>
  );
}

