import { Fragment, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronRight, Gauge, Minus, TriangleAlert } from "lucide-react";
import { PlanReliability, type ReliabilityRow } from "../InsightCharts";
import { formatWorkOsFullDate } from "../dateFormat";
import { ADMIN_PALETTE, GroupedBars, ShareBars, StackedTimeBars } from "./charts";
import { ADMIN_STALE_MS, adminKeys, fetchAdminInsights, formatMinutes, normalizeAdminInsights, relativeTime, shortDate, statusLabel } from "./data";
import { Avatar, Drawer, Notice, Segmented, SelectField, Skeleton } from "./ui";
import type { AdminInsightPersonDay, AdminInsightPersonRow, AdminInsightRange, AdminInsights } from "./types";
import "./insights-prototype.css";

type Variant = "edition" | "control" | "ledger";
const VARIANTS: Array<{ id: Variant; label: string; note: string }> = [
  { id: "edition", label: "Range edition", note: "A written brief for the period, led by one statement and a day-by-day rail." },
  { id: "control", label: "Control room", note: "A single instrument: people × days, attention, and the exact facts behind every cell." },
  { id: "ledger", label: "Team ledger", note: "The team as the page: one full-width entry per person, with the aggregate as the spine." },
];

const PARAM = "prototype";

function readVariant(): Variant {
  if (typeof window === "undefined") return "edition";
  const value = new URLSearchParams(window.location.search).get(PARAM);
  return VARIANTS.some((variant) => variant.id === value) ? value as Variant : "edition";
}

function writeVariant(variant: Variant) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, variant);
  window.history.replaceState(null, "", url);
}

function percent(value: number, total: number): number | null {
  return total > 0 ? Math.round((value / total) * 100) : null;
}

function dayLabel(value: string) {
  return shortDate(`${value}T12:00:00Z`);
}

function rangeLabel(data: AdminInsights) {
  return `${formatWorkOsFullDate(data.from)} – ${formatWorkOsFullDate(data.through)}`;
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
    <span className={`proto-delta ${value.difference === 0 ? "is-flat" : ""} ${tone === "warn" ? "is-warn" : ""}`}>
      <Icon size={11} aria-hidden />
      {value.text}
    </span>
  );
}

function Sparkline({ values, color, width = 100, height = 26, label }: {
  values: number[];
  color: string;
  width?: number;
  height?: number;
  label?: string;
}) {
  if (!values.length) return <span className="proto-spark-empty" aria-hidden />;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => `${(index * step).toFixed(2)},${(height - 3 - (value / max) * (height - 7)).toFixed(2)}`).join(" ");
  return (
    <svg className="proto-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role={label ? "img" : undefined} aria-label={label}>
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} stroke="var(--line)" strokeWidth="1" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Metric({ label, value, detail, tone = "neutral" }: { label: string; value: ReactNode; detail?: ReactNode; tone?: "neutral" | "signal" | "warn" }) {
  return (
    <div className={`proto-metric ${tone === "signal" ? "is-signal" : tone === "warn" ? "is-warn" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

function RatioLine({ label, value, detail, color = "var(--ink)" }: { label: string; value: number | null; detail: string; color?: string }) {
  return (
    <div className="proto-ratio">
      <div className="proto-ratio-head"><span>{label}</span><strong>{value === null ? "—" : `${value}%`}</strong></div>
      <div className="proto-ratio-track" role="img" aria-label={`${label}: ${value === null ? "not recorded" : `${value}%`}`}>
        {value !== null ? <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} /> : null}
      </div>
      <small>{detail}</small>
    </div>
  );
}

function AttentionList({ items, icon = true }: { items: string[]; icon?: boolean }) {
  if (!items.length) return <p className="proto-quiet">Nothing the record flagged in this range.</p>;
  return (
    <ul className="proto-attention-list">
      {items.map((line, index) => (
        <li key={index}>
          {icon ? <TriangleAlert size={12} aria-hidden /> : <span aria-hidden className="proto-dot" />}
          <span>{line}</span>
        </li>
      ))}
    </ul>
  );
}

function NextList({ items }: { items: string[] }) {
  return (
    <ul className="proto-next-list">
      {items.map((line, index) => (
        <li key={index}><ArrowRight size={12} aria-hidden /><span>{line}</span></li>
      ))}
    </ul>
  );
}

interface Derived {
  commitment: number | null;
  previousCommitment: number | null;
  onTime: number | null;
  activeRate: number | null;
  eodApproval: number | null;
  evidenceTotal: number;
  peopleByName: AdminInsightPersonRow[];
  colors: Map<string, string>;
  personDays: Map<string, AdminInsightPersonDay[]>;
  latestDays: AdminInsights["series"];
  maxDayTotal: number;
  maxObserved: number;
  busiestDay: AdminInsights["series"][number] | null;
  quietDays: number;
  peopleLate: number;
  peopleNoEod: number;
  peopleCorrections: number;
}

function derive(data: AdminInsights): Derived {
  const totals = data.totals;
  const peopleByName = [...data.people].sort((left, right) => left.displayName.localeCompare(right.displayName));
  const colors = new Map(peopleByName.map((person, index) => [person.personId, ADMIN_PALETTE[index % ADMIN_PALETTE.length]]));
  const personDays = new Map((data.peopleSeries ?? []).map((series) => [series.personId, series.days]));
  const maxDayTotal = Math.max(1, ...data.series.map((point) => point.outcomesCompleted + point.updates + point.eodSubmitted));
  const maxObserved = Math.max(1, ...[...personDays.values()].flatMap((days) => days.map((day) => day.observedMinutes)));
  const busiestDay = [...data.series].sort((left, right) => (right.outcomesCompleted + right.updates) - (left.outcomesCompleted + left.updates))[0] ?? null;
  return {
    commitment: percent(totals.plannedCompleted, totals.planned),
    previousCommitment: percent(data.previous.plannedCompleted, data.previous.planned),
    onTime: percent(totals.outcomesCompleted, totals.outcomesCompleted + totals.outcomesLate),
    activeRate: percent(totals.activePeople, data.people.length),
    eodApproval: percent(totals.eodApproved, totals.eodSubmitted),
    evidenceTotal: totals.evidenceOutput + totals.evidenceActivity,
    peopleByName,
    colors,
    personDays,
    latestDays: data.series.slice(-14),
    maxDayTotal,
    maxObserved,
    busiestDay,
    quietDays: data.series.filter((point) => point.outcomesCompleted + point.updates + point.eodSubmitted === 0).length,
    peopleLate: data.people.filter((person) => person.outcomesLate > 0).length,
    peopleNoEod: data.people.filter((person) => person.eodSubmitted === 0).length,
    peopleCorrections: data.people.filter((person) => person.sessionsNeedingCorrection > 0).length,
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
      detail: `${data.totals.activePeople} of ${data.people.length} people recorded outcomes, updates, tracked time, or an EOD`,
    },
  ];
}

function EmptyRange({ data }: { data: AdminInsights }) {
  return (
    <div className="proto-empty">
      <Gauge size={22} aria-hidden />
      <h2>Nothing recorded in this range</h2>
      <p>No completed outcomes, updates, EOD reports, or observed time landed between {formatWorkOsFullDate(data.from)} and {formatWorkOsFullDate(data.through)}.</p>
      <p className="proto-quiet">Widen the range, choose another person, or check that the workspace sources are connected.</p>
    </div>
  );
}

function PersonFactsDrawer({ person, data, derived, onClose }: {
  person: AdminInsightPersonRow | null;
  data: AdminInsights;
  derived: Derived;
  onClose: () => void;
}) {
  if (!person) return null;
  const days = derived.personDays.get(person.personId) ?? [];
  const recent = days.slice(-7);
  return (
    <Drawer
      open
      onClose={onClose}
      title={person.displayName}
      subtitle={`${person.roleProfile ?? "Unmapped role"} · ${rangeLabel(data)}`}
      width={560}
    >
      <div className="proto-drawer">
        <section className="proto-drawer-section">
          <h3>Recorded facts</h3>
          <div className="proto-kv-grid">
            <div><span>Outcomes</span><b>{person.outcomesCompleted}</b></div>
            <div><span>Late</span><b className={person.outcomesLate ? "is-warn" : undefined}>{person.outcomesLate}</b></div>
            <div><span>Updates</span><b>{person.updates}</b></div>
            <div><span>Substantive</span><b>{person.substantiveUpdates}</b></div>
            <div><span>EOD submitted</span><b>{person.eodSubmitted}</b></div>
            <div><span>Tracked context</span><b>{person.trackedMinutes ? formatMinutes(person.trackedMinutes) : "—"}</b></div>
            <div><span>Output evidence</span><b>{person.evidenceOutput}</b></div>
            <div><span>Activity evidence</span><b>{person.evidenceActivity}</b></div>
          </div>
        </section>
        <section className="proto-drawer-section">
          <h3>Commitment</h3>
          <PlanReliability rows={[{
            key: "person-commitment",
            label: "Commitments landed",
            percent: person.commitmentRate,
            detail: person.planned > 0 ? `${person.plannedCompleted} of ${person.planned} planned items` : "No planned items in this range",
          }]} />
        </section>
        <section className="proto-drawer-section">
          <div className="proto-drawer-heading">
            <h3>Last recorded days</h3>
            <span>{formatMinutes(person.trackedMinutes)} observed in range</span>
          </div>
          <div className="proto-drawer-days">
            {recent.map((day) => (
              <div key={day.date} className="proto-drawer-day">
                <span>{dayLabel(day.date)}</span>
                <b>{day.outcomesCompleted + day.updates + day.eodSubmitted ? `${day.outcomesCompleted + day.updates + day.eodSubmitted} recorded` : "No record"}</b>
                <small>{day.observedMinutes ? formatMinutes(day.observedMinutes) : "—"}</small>
              </div>
            ))}
          </div>
        </section>
        {person.sessionsNeedingCorrection > 0 ? (
          <Notice tone="warn">{person.sessionsNeedingCorrection} session{person.sessionsNeedingCorrection === 1 ? "" : "s"} still need a correction; unresolved time stays excluded from observed totals.</Notice>
        ) : null}
        <p className="proto-quiet">Last recorded activity {person.lastActivityAt ? relativeTime(person.lastActivityAt) : "—"}. Activity context never proves completion.</p>
      </div>
    </Drawer>
  );
}

export default function InsightsPrototype({ initialPersonId }: { initialPersonId?: string }) {
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [range, setRange] = useState<AdminInsightRange>("7d");
  const [focusPerson, setFocusPerson] = useState(initialPersonId ?? "");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const insights = useQuery<AdminInsights>({
    queryKey: adminKeys.insights(range, ""),
    queryFn: () => fetchAdminInsights(range, ""),
    select: normalizeAdminInsights,
    staleTime: ADMIN_STALE_MS,
  });

  if (insights.isLoading) {
    return (
      <div className="insights-proto">
        <Skeleton className="h-16" />
        <div className="proto-loading-grid">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (insights.error || !insights.data) {
    return <Notice tone="err">Insights could not be loaded. {(insights.error as Error | null)?.message}</Notice>;
  }

  const data = insights.data;
  const derived = derive(data);
  const selected = selectedPersonId ? data.people.find((person) => person.personId === selectedPersonId) ?? null : null;
  const empty = data.totals.outcomesCompleted === 0 && data.totals.updates === 0 && data.totals.eodSubmitted === 0 && data.totals.trackedMinutes === 0;

  const chooseVariant = (next: Variant) => {
    setVariant(next);
    writeVariant(next);
  };

  const openPerson = (personId: string) => setSelectedPersonId(personId);

  return (
    <div className="insights-proto">
      <div className="proto-bar" role="region" aria-label="Insights prototypes">
        <div className="proto-bar-title">
          <span className="proto-mark">Prototype</span>
          <strong>{VARIANTS.find((entry) => entry.id === variant)?.label}</strong>
        </div>
        <div className="proto-tabs" role="tablist" aria-label="Prototype direction">
          {VARIANTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={variant === entry.id}
              className={variant === entry.id ? "is-active" : undefined}
              onClick={() => chooseVariant(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="proto-tools">
          <Segmented<AdminInsightRange>
            ariaLabel="Insight range"
            value={range}
            onChange={setRange}
            options={[
              { value: "7d", label: "7 days" },
              { value: "30d", label: "30 days" },
              { value: "90d", label: "90 days" },
            ]}
          />
          <SelectField
            ariaLabel="Focus a person"
            value={focusPerson}
            onChange={setFocusPerson}
            placeholder="All people"
            options={data.people.map((person) => ({ value: person.personId, label: person.displayName }))}
          />
        </div>
      </div>
      <p className="proto-note">{VARIANTS.find((entry) => entry.id === variant)?.note}</p>

      {empty ? <EmptyRange data={data} /> : variant === "edition"
        ? <EditionView data={data} derived={derived} focusPerson={focusPerson} onOpenPerson={openPerson} />
        : variant === "control"
          ? <ControlView data={data} derived={derived} focusPerson={focusPerson} onOpenPerson={openPerson} />
          : <LedgerView data={data} derived={derived} focusPerson={focusPerson} onOpenPerson={openPerson} />}

      <PersonFactsDrawer person={selected} data={data} derived={derived} onClose={() => setSelectedPersonId(null)} />
    </div>
  );
}

function EditionView({ data, derived, focusPerson, onOpenPerson }: {
  data: AdminInsights;
  derived: Derived;
  focusPerson: string;
  onOpenPerson: (personId: string) => void;
}) {
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const active = activeDay === null ? null : data.series[activeDay];
  const activeTotal = active ? active.outcomesCompleted + active.updates + active.eodSubmitted : 0;

  return (
    <div className="edition">
      <header className="edition-head">
        <div className="edition-lead">
          <p className="edition-kicker">{rangeLabel(data)}</p>
          <h1>
            {data.totals.outcomesCompleted} outcomes landed. {derived.commitment === null ? "No plan was confirmed." : `${derived.commitment}% of commitments held.`}
          </h1>
          <p className="edition-summary">{data.notes.summary}</p>
        </div>
        <div className="edition-side">
          <span className="edition-side-label">Against the equal earlier period</span>
          <div><b>Outcomes</b><DeltaMark current={data.totals.outcomesCompleted} previous={data.previous.outcomesCompleted} /></div>
          <div><b>Updates</b><DeltaMark current={data.totals.updates} previous={data.previous.updates} /></div>
          <div><b>EOD reports</b><DeltaMark current={data.totals.eodSubmitted} previous={data.previous.eodSubmitted} /></div>
          <div><b>Observed</b><DeltaMark current={data.totals.trackedMinutes} previous={data.previous.trackedMinutes} unit="minutes" /></div>
        </div>
      </header>

      <section className="edition-rail-section" aria-label="Daily recorded volume">
        <div className="edition-rail-head">
          <span>Daily recorded volume</span>
          <span>{derived.quietDays} quiet {derived.quietDays === 1 ? "day" : "days"}</span>
        </div>
        <div className="edition-rail" onMouseLeave={() => setActiveDay(null)}>
          {data.series.map((point, index) => {
            const total = point.outcomesCompleted + point.updates + point.eodSubmitted;
            return (
              <button
                key={point.date}
                type="button"
                className={`edition-day ${activeDay === index ? "is-active" : ""}`}
                onMouseEnter={() => setActiveDay(index)}
                onFocus={() => setActiveDay(index)}
                aria-label={`${dayLabel(point.date)}: ${point.outcomesCompleted} outcomes, ${point.updates} updates, ${point.eodSubmitted} EOD reports`}
              >
                <span className="edition-day-plot" aria-hidden>
                  <i className="is-outcomes" style={{ height: `${(point.outcomesCompleted / derived.maxDayTotal) * 100}%` }} />
                  <i className="is-updates" style={{ height: `${(point.updates / derived.maxDayTotal) * 100}%` }} />
                  <i className="is-eod" style={{ height: `${(point.eodSubmitted / derived.maxDayTotal) * 100}%` }} />
                  {!total ? <i className="is-empty" /> : null}
                </span>
                <span className="edition-day-label">{index % 3 === 0 || index === data.series.length - 1 ? dayLabel(point.date) : ""}</span>
              </button>
            );
          })}
        </div>
        <div className="edition-rail-readout" aria-live="polite">
          {active ? (
            <><b>{dayLabel(active.date)}</b><span>{active.outcomesCompleted} outcomes</span><span>{active.updates} updates</span><span>{active.eodSubmitted} EOD</span><span>{formatMinutes(active.trackedMinutes)} observed</span></>
          ) : (
            <><span>Hover or focus a day for the exact record.</span><span className="edition-rail-key"><i className="is-outcomes" /> outcomes <i className="is-updates" /> updates <i className="is-eod" /> EOD</span></>
          )}
        </div>
      </section>

      <div className="edition-body">
        <section className="edition-narrative">
          <h2>What moved</h2>
          <ul className="edition-list is-good">
            {data.notes.wins.map((line, index) => <li key={index}><span aria-hidden className="edition-list-mark" />{line}</li>)}
          </ul>
          <h2>What needs a look</h2>
          <AttentionList items={data.notes.attention} />
          <h2>Next</h2>
          <NextList items={data.notes.nextFocus} />
        </section>
        <aside className="edition-balance">
          <div className="edition-balance-title">
            <span>The record</span>
            <small>Generated {relativeTime(data.freshness.generatedAt)}</small>
          </div>
          <RatioLine label="Commitments landed" value={derived.commitment} detail={`${data.totals.plannedCompleted} of ${data.totals.planned} planned items`} color="var(--signal-deep)" />
          <RatioLine label="Outcomes on time" value={derived.onTime} detail={`${data.totals.outcomesLate} late of ${data.totals.outcomesCompleted + data.totals.outcomesLate} dated outcomes`} color="var(--ink)" />
          <RatioLine label="People with recorded work" value={derived.activeRate} detail={`${data.totals.activePeople} of ${data.people.length} people`} color="var(--observed)" />
          <div className="edition-evidence">
            <div><span>Output evidence</span><b>{data.totals.evidenceOutput}</b></div>
            <div><span>Activity evidence</span><b>{data.totals.evidenceActivity}</b></div>
            <div><span>EOD approval</span><b>{derived.eodApproval === null ? "—" : `${derived.eodApproval}%`}</b></div>
          </div>
        </aside>
      </div>

      <section className="edition-record">
        <header className="edition-section-head">
          <div><h2>Daily record</h2><p>Completed outcomes, recorded updates, and EOD submissions by day.</p></div>
          <span>{derived.busiestDay ? `${dayLabel(derived.busiestDay.date)} carried the most recorded items` : "No recorded items"}</span>
        </header>
        <GroupedBars
          ariaLabel={`Completed outcomes, recorded updates, and EOD submissions for ${rangeLabel(data)}`}
          points={data.series.map((point) => ({
            label: dayLabel(point.date),
            values: { outcomes: point.outcomesCompleted, updates: point.updates, eod: point.eodSubmitted },
          }))}
          series={[
            { key: "outcomes", label: "Outcomes", color: "var(--chart-ink)" },
            { key: "updates", label: "Updates", color: "var(--muted)" },
            { key: "eod", label: "EOD reports", color: "var(--observed)" },
          ]}
        />
      </section>

      <section className="edition-people">
        <header className="edition-section-head">
          <div><h2>People in the record</h2><p>Each teammate's recorded facts. Open a row for the full day-level record.</p></div>
          <span>{data.people.length} in scope</span>
        </header>
        <div className="edition-people-head" aria-hidden>
          <span>Person</span><span>Outcomes</span><span>Commitment</span><span>Observed</span><span>Last activity</span>
        </div>
        {data.people.length ? (
          <div className="edition-people-list">
            {data.people.map((person) => (
              <button
                key={person.personId}
                type="button"
                className={`edition-person ${focusPerson === person.personId ? "is-focused" : ""}`}
                onClick={() => onOpenPerson(person.personId)}
              >
                <span className="edition-person-name">
                  <Avatar name={person.displayName} size={30} />
                  <span><b>{person.displayName}</b><small>{person.roleProfile ?? "Unmapped role"}</small></span>
                </span>
                <span className="edition-person-value"><b>{person.outcomesCompleted}</b><small>{person.outcomesLate ? `${person.outcomesLate} late` : "on time"}</small></span>
                <span className="edition-person-commitment">
                  <span className="edition-person-track"><i style={{ width: `${person.commitmentRate ?? 0}%` }} /></span>
                  <small>{person.commitmentRate === null ? "No plan" : `${person.commitmentRate}%`}</small>
                </span>
                <span className="edition-person-value"><b>{person.trackedMinutes ? formatMinutes(person.trackedMinutes) : "—"}</b><small>{person.updates} updates</small></span>
                <span className="edition-person-last">{person.lastActivityAt ? relativeTime(person.lastActivityAt) : "—"}<ChevronRight size={13} aria-hidden /></span>
              </button>
            ))}
          </div>
        ) : <p className="proto-quiet">No people are in scope for this range.</p>}
      </section>

      <div className="edition-context">
        <section>
          <h2>Where the observed time went</h2>
          <ShareBars ariaLabel="Tracked app and site minutes, strongest first" items={data.topApps.map((app) => ({ label: app.name, value: Math.round(app.minutes), note: "minutes" }))} />
        </section>
        <section>
          <h2>What filled the updates</h2>
          <ShareBars ariaLabel="Recorded updates by kind" items={data.updateKinds.map((kind) => ({ label: statusLabel(kind.kind), value: kind.count }))} />
        </section>
      </div>
    </div>
  );
}

type MatrixMeasure = "observedMinutes" | "outcomesCompleted" | "updates";
const MEASURES: Array<{ id: MatrixMeasure; label: string; noun: string; ink: string }> = [
  { id: "observedMinutes", label: "Observed time", noun: "observed minutes", ink: "var(--observed)" },
  { id: "outcomesCompleted", label: "Outcomes", noun: "recorded outcomes", ink: "var(--ink)" },
  { id: "updates", label: "Updates", noun: "recorded updates", ink: "var(--observed)" },
];

function ControlView({ data, derived, focusPerson, onOpenPerson }: {
  data: AdminInsights;
  derived: Derived;
  focusPerson: string;
  onOpenPerson: (personId: string) => void;
}) {
  const [measure, setMeasure] = useState<MatrixMeasure>("observedMinutes");
  const [activeCell, setActiveCell] = useState<{ personId: string; date: string } | null>(null);
  const matrixDays = data.series.slice(-14);
  const measureMeta = MEASURES.find((entry) => entry.id === measure) ?? MEASURES[0];
  const valueFor = (day: AdminInsightPersonDay) => measure === "observedMinutes" ? day.observedMinutes : measure === "outcomesCompleted" ? day.outcomesCompleted : day.updates;
  const max = Math.max(1, ...[...derived.personDays.values()].flatMap((days) => days.filter((day) => matrixDays.some((point) => point.date === day.date)).map(valueFor)));
  const activePerson = activeCell ? data.people.find((person) => person.personId === activeCell.personId) ?? null : null;
  const activeDay = activeCell ? derived.personDays.get(activeCell.personId)?.find((day) => day.date === activeCell.date) ?? null : null;

  return (
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
          <Metric label="People with work" value={`${data.totals.activePeople}/${data.people.length}`} detail={`${derived.peopleLate} with late outcomes`} />
          <Metric label="EOD submitted" value={data.totals.eodSubmitted} detail={`${data.totals.eodApproved} approved · ${data.totals.eodRejected} returned`} />
        </div>
      </header>

      <div className="control-grid">
        <section className="control-matrix">
          <header className="control-section-head">
            <div><h2>People × days</h2><p>One cell per teammate per day. Switch the measure; the exact facts sit below.</p></div>
            <Segmented<MatrixMeasure>
              ariaLabel="Matrix measure"
              value={measure}
              onChange={setMeasure}
              options={MEASURES.map((entry) => ({ value: entry.id, label: entry.label }))}
            />
          </header>
          <div className="control-matrix-scroll">
            <div className="control-matrix-grid" style={{ gridTemplateColumns: `minmax(150px, 1.4fr) repeat(${matrixDays.length}, minmax(24px, 1fr)) 68px` }}>
              <div className="control-matrix-corner">Person</div>
              {matrixDays.map((day) => <div key={day.date} className="control-matrix-day">{dayLabel(day.date)}</div>)}
              <div className="control-matrix-total-head">{measure === "observedMinutes" ? "Observed" : measure === "outcomesCompleted" ? "Outcomes" : "Updates"}</div>
              {derived.peopleByName.map((person) => {
                const days = derived.personDays.get(person.personId) ?? [];
                const total = days.filter((day) => matrixDays.some((point) => point.date === day.date)).reduce((sum, day) => sum + valueFor(day), 0);
                return (
                  <Fragment key={person.personId}>
                    <button
                      type="button"
                      className={`control-matrix-person ${focusPerson === person.personId ? "is-focused" : ""}`}
                      onClick={() => onOpenPerson(person.personId)}
                    >
                      <span>{person.displayName}</span>
                      <small>{person.outcomesCompleted} outcomes · {person.commitmentRate === null ? "no plan" : `${person.commitmentRate}%`}</small>
                    </button>
                    {matrixDays.map((point) => {
                      const day = days.find((entry) => entry.date === point.date);
                      if (!day) return <span key={point.date} className="control-cell is-empty" aria-hidden />;
                      const value = valueFor(day);
                      const level = Math.max(0, Math.min(1, value / max));
                      return (
                        <button
                          key={point.date}
                          type="button"
                          className={`control-cell ${level > 0.6 ? "is-strong" : ""} ${activeCell?.personId === person.personId && activeCell.date === point.date ? "is-active" : ""}`}
                          style={{ "--matrix-ink": measureMeta.ink, "--level": `${level}` } as CSSProperties}
                          onMouseEnter={() => setActiveCell({ personId: person.personId, date: point.date })}
                          onFocus={() => setActiveCell({ personId: person.personId, date: point.date })}
                          onMouseLeave={() => setActiveCell(null)}
                          onBlur={() => setActiveCell(null)}
                          aria-label={`${person.displayName}, ${dayLabel(point.date)}: ${day.observedMinutes} observed minutes, ${day.outcomesCompleted} outcomes, ${day.updates} updates, ${day.eodSubmitted} EOD reports`}
                        >
                          {value ? <span>{measure === "observedMinutes" ? Math.round(value) : value}</span> : null}
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
            <span className="control-key"><i style={{ background: "var(--inset)" }} /> 0 <i style={{ background: measureMeta.ink }} /> {max} {measureMeta.noun}</span>
            <span className="control-readout" aria-live="polite">
              {activePerson && activeDay ? (
                <><b>{activePerson.displayName} · {dayLabel(activeDay.date)}</b><span>{activeDay.outcomesCompleted} outcomes</span><span>{activeDay.updates} updates</span><span>{formatMinutes(activeDay.observedMinutes)} observed</span><span>{activeDay.eodSubmitted} EOD</span></>
              ) : "Hover or focus a cell for the full day."}
            </span>
          </div>
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
          <p className="proto-freshness">Generated {relativeTime(data.freshness.generatedAt)} · activity context is never a score.</p>
        </aside>
      </div>

      <div className="control-lower">
        <section>
          <header className="control-section-head"><div><h2>Time worked</h2><p>Observed work time per day, split by teammate.</p></div></header>
          <div className="control-chart">
            <StackedTimeBars
              ariaLabel={`Observed work time per day for ${rangeLabel(data)}, split by teammate`}
              points={data.timeSeries}
              onSelectPerson={onOpenPerson}
            />
          </div>
        </section>
        <section>
          <header className="control-section-head"><div><h2>Plan reliability</h2><p>Recorded ratios from the plan and the task record.</p></div></header>
          <PlanReliability rows={reliabilityRows(data, derived)} />
          <p className="proto-quiet">Ratios are facts from the record, never targets set for a person.</p>
        </section>
      </div>

      <section className="control-table-section">
        <header className="control-section-head">
          <div><h2>Person record</h2><p>Outcomes, timeliness, evidence, and the last recorded activity.</p></div>
          <span>{data.people.length} people</span>
        </header>
        <div className="control-table-wrap">
          <table className="control-table">
            <thead><tr><th>Person</th><th>Outcomes</th><th>Late</th><th>Updates</th><th>Commitment</th><th>EOD</th><th>Evidence</th><th>Last</th></tr></thead>
            <tbody>
              {data.people.map((person) => (
                <tr key={person.personId} className={focusPerson === person.personId ? "is-focused" : undefined} onClick={() => onOpenPerson(person.personId)}>
                  <td><span className="control-person">{person.displayName}<small>{person.roleProfile ?? "Unmapped role"}</small></span></td>
                  <td>{person.outcomesCompleted}</td>
                  <td className={person.outcomesLate ? "is-warn" : undefined}>{person.outcomesLate}</td>
                  <td>{person.updates}</td>
                  <td>{person.commitmentRate === null ? "—" : `${person.commitmentRate}%`}</td>
                  <td>{person.eodSubmitted}</td>
                  <td>{person.evidenceOutput + person.evidenceActivity}</td>
                  <td className="is-quiet">{person.lastActivityAt ? relativeTime(person.lastActivityAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function LedgerView({ data, derived, focusPerson, onOpenPerson }: {
  data: AdminInsights;
  derived: Derived;
  focusPerson: string;
  onOpenPerson: (personId: string) => void;
}) {
  return (
    <div className="ledger">
      <header className="ledger-head">
        <div>
          <p>{rangeLabel(data)}</p>
          <h1>Team ledger</h1>
          <span>{data.notes.summary}</span>
        </div>
        <div className="ledger-stamp">
          <span>Commitments held</span>
          <strong>{derived.commitment === null ? "—" : `${derived.commitment}%`}</strong>
          <small>{data.totals.plannedCompleted} of {data.totals.planned} planned items</small>
        </div>
      </header>

      <div className="ledger-body">
        <aside className="ledger-spine">
          <div className="ledger-balance">
            <div><span>Outcomes</span><strong>{data.totals.outcomesCompleted}</strong><DeltaMark current={data.totals.outcomesCompleted} previous={data.previous.outcomesCompleted} /></div>
            <div><span>Updates</span><strong>{data.totals.updates}</strong><DeltaMark current={data.totals.updates} previous={data.previous.updates} /></div>
            <div><span>EOD submitted</span><strong>{data.totals.eodSubmitted}</strong><DeltaMark current={data.totals.eodSubmitted} previous={data.previous.eodSubmitted} /></div>
            <div><span>Observed time</span><strong>{formatMinutes(data.totals.trackedMinutes)}</strong><DeltaMark current={data.totals.trackedMinutes} previous={data.previous.trackedMinutes} unit="minutes" /></div>
          </div>
          <div className="ledger-ratios">
            <RatioLine label="On time" value={derived.onTime} detail={`${data.totals.outcomesLate} late of ${data.totals.outcomesCompleted + data.totals.outcomesLate}`} color="var(--ink)" />
            <RatioLine label="EOD approval" value={derived.eodApproval} detail={`${data.totals.eodApproved} of ${data.totals.eodSubmitted} submitted`} color="var(--observed)" />
          </div>
          <section className="ledger-attention">
            <h2>Needs a look</h2>
            <AttentionList items={data.notes.attention} />
          </section>
          <section className="ledger-next">
            <h2>Next</h2>
            <NextList items={data.notes.nextFocus} />
          </section>
          <p className="proto-freshness">Generated {relativeTime(data.freshness.generatedAt)}</p>
        </aside>

        <section className="ledger-people">
          <header className="ledger-people-head">
            <div><h2>People</h2><p>Every row is one teammate's record. Select a row for the full day-level facts.</p></div>
            <span>{data.people.length} in scope</span>
          </header>
          <div className="ledger-columns" aria-hidden>
            <span>Person</span><span>Recorded</span><span>Commitment</span><span>Observed time</span><span>Last</span>
          </div>
          {data.people.length ? (
            <div className="ledger-list">
              {data.people.map((person) => {
                const days = derived.personDays.get(person.personId) ?? [];
                const color = derived.colors.get(person.personId) ?? "var(--ink)";
                return (
                  <button
                    key={person.personId}
                    type="button"
                    className={`ledger-row ${focusPerson === person.personId ? "is-focused" : ""}`}
                    onClick={() => onOpenPerson(person.personId)}
                  >
                    <span className="ledger-person">
                      <span className="ledger-person-mark" style={{ background: color }} aria-hidden />
                      <Avatar name={person.displayName} size={32} />
                      <span><b>{person.displayName}</b><small>{person.roleProfile ?? "Unmapped role"}</small></span>
                    </span>
                    <span className="ledger-record">
                      <span><b>{person.outcomesCompleted}</b><small>outcomes</small></span>
                      <span><b>{person.outcomesLate}</b><small>late</small></span>
                      <span><b>{person.updates}</b><small>updates</small></span>
                      <span><b>{person.eodSubmitted}</b><small>EOD</small></span>
                    </span>
                    <span className="ledger-commit">
                      <span className="ledger-track"><i style={{ width: `${person.commitmentRate ?? 0}%` }} /></span>
                      <small>{person.commitmentRate === null ? "No plan" : `${person.commitmentRate}% · ${person.plannedCompleted}/${person.planned}`}</small>
                    </span>
                    <span className="ledger-time">
                      <Sparkline values={days.map((day) => day.observedMinutes)} color={color} />
                      <b>{person.trackedMinutes ? formatMinutes(person.trackedMinutes) : "—"}</b>
                    </span>
                    <span className="ledger-last">{person.lastActivityAt ? relativeTime(person.lastActivityAt) : "—"}<ChevronRight size={13} aria-hidden /></span>
                  </button>
                );
              })}
            </div>
          ) : <p className="proto-quiet">No people are in scope for this range.</p>}
          <p className="ledger-note">Observed time is context from sessions; recorded facts are never combined into a productivity score.</p>
        </section>
      </div>

      <div className="ledger-lower">
        <section>
          <header className="ledger-section-head"><div><h2>Daily record</h2><p>Completed outcomes, recorded updates, and EOD submissions.</p></div></header>
          <GroupedBars
            ariaLabel={`Daily completed outcomes, recorded updates, and EOD submissions for ${rangeLabel(data)}`}
            points={data.series.map((point) => ({
              label: dayLabel(point.date),
              values: { outcomes: point.outcomesCompleted, updates: point.updates, eod: point.eodSubmitted },
            }))}
            series={[
              { key: "outcomes", label: "Outcomes", color: "var(--chart-ink)" },
              { key: "updates", label: "Updates", color: "var(--muted)" },
              { key: "eod", label: "EOD reports", color: "var(--observed)" },
            ]}
          />
        </section>
        <section>
          <header className="ledger-section-head"><div><h2>Where the time went</h2><p>Observed app and site minutes.</p></div></header>
          <ShareBars ariaLabel="Tracked app and site minutes, strongest first" items={data.topApps.map((app) => ({ label: app.name, value: Math.round(app.minutes), note: "minutes" }))} />
          <h3 className="ledger-subhead">Update mix</h3>
          <ShareBars ariaLabel="Recorded updates by kind" items={data.updateKinds.map((kind) => ({ label: statusLabel(kind.kind), value: kind.count }))} />
        </section>
      </div>
    </div>
  );
}
