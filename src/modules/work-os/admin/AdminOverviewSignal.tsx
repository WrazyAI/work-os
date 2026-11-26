"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, ChevronRight, Minus, Users } from "lucide-react";
import type { AdminOverview } from "@/lib/work-os-admin-overview";
import type { WorkOsReadinessReport } from "@/lib/work-os-readiness";
import { StackedTimeBars } from "./charts";
import {
  OVERVIEW_METRICS,
  buildOverviewModel,
  comparisonPhrase,
  deltaPercent,
  deltaText,
  plural,
  type OverviewDay,
  type OverviewMetric,
  type OverviewModel,
} from "./overview-model";
import {
  Avatar,
  Button,
  EmptyState,
  Notice,
  SectionHeading,
  Skeleton,
  StateMark,
  cx,
  relativeTime,
  statusLabel,
} from "./ui";
import styles from "./AdminOverviewSignal.module.css";

/** The web administration Overview as one instrument.
 *
 * A seven-workday pulse, a switchable fortnight trend, the live shape of the
 * day, the observed-time bars, and the people and decisions that need the
 * operator. The composition mirrors the companion signal board; the layout,
 * type, and controls use the web administration primitives. */

export interface AdminOverviewSignalProps {
  data: AdminOverview;
  attention: AdminOverview["attention"];
  readiness: {
    pending: boolean;
    error: boolean;
    report: WorkOsReadinessReport | undefined;
    onRetry: () => void;
  };
}

const attentionVerb: Record<string, string> = {
  reports_pending_review: "Review",
  eod_outstanding: "Open review",
  tasks_overdue: "Open tasks",
  evidence_disputed: "Inspect",
  readiness_blocked: "Fix setup",
};

const METER = "h-1 overflow-hidden rounded-full bg-[var(--bg-tertiary)]";

function formatMinutes(value: number) {
  const safe = Math.max(0, Math.round(value));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function shortDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function axisParts(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return {
    month: Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short" }),
    day: Number.isNaN(date.getTime()) ? value : date.getDate(),
  };
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function attendanceLabel(state: AdminOverview["people"][number]["attendance"]["state"]) {
  if (state === "active") return "On shift";
  if (state === "paused") return "Paused";
  if (state === "off_shift") return "Off shift";
  return "Not observed";
}

function attendanceTone(state: AdminOverview["people"][number]["attendance"]["state"]) {
  if (state === "active") return "ok" as const;
  if (state === "paused") return "warn" as const;
  return "neutral" as const;
}

export default function AdminOverviewSignal({ data, attention, readiness }: AdminOverviewSignalProps) {
  const model = useMemo(() => buildOverviewModel(data), [data]);
  const isEmpty = data.people.length === 0
    && !model.days.some((day) => day.completed || day.updates || day.recaps || day.evidence || day.minutes);
  if (isEmpty) {
    return (
      <div className="flex flex-col gap-5">
        <div className="rounded-[16px] border px-6 py-12" style={{ borderColor: "var(--border)", background: "var(--color-paper)" }}>
          <EmptyState
            title="The window is empty"
            body="No teammate, outcome, update, recap, evidence, or session minute was recorded in the last fourteen workdays. People are created through onboarding or membership mapping in Settings."
            action={<Link href="/work-os/admin/settings" className="text-[11.5px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Open Settings</Link>}
          />
        </div>
        <section className="rounded-[16px] border bg-[var(--color-paper)] p-4 lg:p-5" style={{ borderColor: "var(--border)" }}>
          <SectionHeading title="Needs a decision" detail="Every row opens the record that can resolve it." />
          {readiness.pending ? <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">Checking workspace setup…</p> : null}
          {readiness.error ? (
            <div className="mb-2"><Notice tone="warn" action={<Button size="sm" onClick={readiness.onRetry}>Retry setup checks</Button>}>Setup checks could not be refreshed.</Notice></div>
          ) : null}
          <Decisions attention={attention} />
        </section>
        <SetupAndSources data={data} readiness={readiness} />
      </div>
    );
  }
  return <SignalBoard model={model} attention={attention} readiness={readiness} />;
}

export function AdminOverviewSignalSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

function SignalBoard({ model, attention, readiness }: {
  model: OverviewModel;
  attention: AdminOverview["attention"];
  readiness: AdminOverviewSignalProps["readiness"];
}) {
  const [metric, setMetric] = useState<OverviewMetric>("completed");
  const counts = model.data.counts;
  const selection = OVERVIEW_METRICS.find((item) => item.id === metric) ?? OVERVIEW_METRICS[0];
  const recentMean = model.recent.length ? model.recentTotals[metric] / model.recent.length : 0;
  const priorMean = model.prior.length ? model.priorTotals[metric] / model.prior.length : 0;
  const values = model.days.map((day) => day[metric]);
  const bestIndex = values.reduce((best, value, index) => (value > values[best] ? index : best), 0);
  const dailyMean = mean(values);
  const daysAbove = values.filter((value) => value > dailyMean).length;
  const peopleForList = [...model.people]
    .sort((left, right) => {
      const score = (person: AdminOverview["people"][number]) => person.tasksCompletedToday * 3 + person.updatesToday * 2 + person.evidenceToday;
      return score(right) - score(left) || left.displayName.localeCompare(right.displayName);
    })
    .slice(0, 6);

  return (
    <div className="flex flex-col gap-5">
      <header className={cx("flex flex-wrap items-end justify-between gap-4", styles.rise)}>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold text-[var(--text-tertiary)]">Last seven workdays against the seven before</p>
          <h2 className="mt-2 max-w-[34ch] text-[26px] font-[640] leading-[1.1] tracking-[-0.035em] text-[var(--text-primary)]">{model.headline}</h2>
        </div>
        <p className="text-[11px] text-[var(--text-tertiary)]">Snapshot updated {relativeTime(model.data.generatedAt, new Date(model.generatedAt))}</p>
      </header>

      <section aria-label="The last seven workdays" className="grid gap-px overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 lg:grid-cols-4">
        {OVERVIEW_METRICS.map((item, index) => (
          <PulseFact key={item.id} item={item} model={model} spark={model.days.map((day) => day[item.id])} delay={index * 35} />
        ))}
      </section>

      <div className="grid gap-px overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--border)] lg:grid-cols-12">
        <section className="min-w-0 bg-[var(--color-paper)] p-4 lg:col-span-8 lg:p-5">
          <SectionHeading
            title="Daily shape"
            detail={`${selection.noun} per workday, with the prior and current seven-day means.`}
            action={(
              <div role="group" aria-label="Choose the trend measure" className="inline-flex flex-wrap items-center gap-0.5 rounded-[9px] border border-[var(--border)] bg-[var(--bg-tertiary)] p-0.5">
                {OVERVIEW_METRICS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={item.id === metric}
                    onClick={() => setMetric(item.id)}
                    className={cx(
                      "rounded-[7px] px-2.5 py-1.5 text-[10.5px] font-semibold transition motion-reduce:transition-none",
                      item.id === metric ? "bg-[var(--color-paper)] text-[var(--text-primary)] shadow-sm" : "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          />
          <TrendChart
            days={model.days}
            metric={metric}
            metricLabel={selection.label}
            refs={[
              { value: priorMean, label: "prior mean", kind: "prior" },
              { value: recentMean, label: "recent mean", kind: "recent" },
            ]}
            caption={<><strong>{model.recentTotals[metric]}</strong> in the last seven workdays <Delta current={model.recentTotals[metric]} previous={model.priorTotals[metric]} /></>}
          />
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3 sm:grid-cols-4">
            <SummaryFact value={values[bestIndex] ?? 0} label={`best day · ${model.days[bestIndex] ? shortDate(model.days[bestIndex].date) : "—"}`} />
            <SummaryFact value={dailyMean.toFixed(1)} label="14-day mean" />
            <SummaryFact value={daysAbove} label="days above mean" />
            <SummaryFact value={model.priorTotals[metric]} label="prior 7 days" />
          </div>
          <p className="mt-3 text-[10.5px] leading-4 text-[var(--text-tertiary)]">
            {comparisonPhrase(model.recentTotals[metric], model.priorTotals[metric])}. Hover or focus a workday for the full record.
          </p>
        </section>

        <aside className="min-w-0 bg-[var(--color-paper)] p-4 lg:col-span-4 lg:p-5" aria-labelledby="web-signal-now-title">
          <div className="mb-3.5 flex items-start justify-between gap-3">
            <div>
              <h2 id="web-signal-now-title" className="text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">Right now</h2>
              <p className="mt-1 text-[11.5px] leading-5 text-[var(--text-tertiary)]">{counts.onShift} on shift of {counts.people}, {counts.paused} paused.</p>
            </div>
            <Link href="/work-os/admin/people" aria-label="Open People" className="grid size-8 shrink-0 place-items-center rounded-[8px] border border-[var(--border)] text-[var(--text-tertiary)] transition hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] motion-reduce:transition-none">
              <Users size={14} aria-hidden />
            </Link>
          </div>
          <CoverageBar counts={counts} />
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <p className="text-[10.5px] font-semibold text-[var(--text-tertiary)]">Oldest waiting report</p>
            <OldestReview model={model} />
          </div>
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <p className="mb-2 text-[10.5px] font-semibold text-[var(--text-tertiary)]">Day close</p>
            <DayClose model={model} />
          </div>
        </aside>

        <section className="min-w-0 bg-[var(--color-paper)] p-4 lg:col-span-12 lg:p-5">
          <SectionHeading
            title="Observed time"
            detail="Session time per workday, split by teammate. Clock-in to clock-out minus pauses, never app tracking or a score."
            action={<span className="text-right"><span className="block text-[19px] font-[620] leading-none tracking-[-0.03em] text-[var(--text-primary)]">{formatMinutes(model.recentTotals.minutes)}</span><span className="mt-1 block text-[9.5px] text-[var(--text-tertiary)]">last 7 workdays</span></span>}
          />
          {model.days.some((day) => day.minutes > 0)
            ? <StackedTimeBars data={model.data.timeSeries} ariaLabel="Observed work time per workday for the last 14 workdays, split by teammate" />
            : <p className="text-[12px] text-[var(--text-tertiary)]">No observed work time was recorded in this window.</p>}
          <ExactTimeTable data={model.data.timeSeries} />
        </section>

        <section className="min-w-0 bg-[var(--color-paper)] p-4 lg:col-span-7 lg:p-5">
          <SectionHeading
            title="Today, by person"
            detail="The six most active records, with status and today's counts."
            action={<Link href="/work-os/admin/people" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Open People <ArrowRight size={13} aria-hidden /></Link>}
          />
          <ul className="grid">
            {peopleForList.map((person) => (
              <li key={person.personId} className="border-t border-[var(--border)] first:border-t-0">
                <Link
                  href={`/work-os/admin/people?person=${encodeURIComponent(person.personId)}`}
                  aria-label={`Open ${person.displayName}'s record`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 transition hover:bg-[var(--bg-secondary)] motion-reduce:transition-none"
                >
                  <Avatar name={person.displayName} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-semibold text-[var(--text-primary)]">{person.displayName}</span>
                    <span className="block text-[9.5px] text-[var(--text-tertiary)]">{person.roleProfile ?? "Unmapped role"}</span>
                  </span>
                  <StateMark tone={attendanceTone(person.attendance.state)}>{attendanceLabel(person.attendance.state)}</StateMark>
                  <span className="flex w-full flex-wrap items-center gap-x-2 pl-[37px] text-[9.5px] text-[var(--text-tertiary)] sm:w-auto sm:justify-end sm:pl-0">
                    <span><b className="font-semibold text-[var(--text-primary)]">{person.tasksCompletedToday}</b> outcomes</span>
                    <span><b className="font-semibold text-[var(--text-primary)]">{person.updatesToday}</b> updates</span>
                    <span><b className="font-semibold text-[var(--text-primary)]">{person.evidenceToday}</b> evidence</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="min-w-0 bg-[var(--color-paper)] p-4 lg:col-span-5 lg:p-5">
          <SectionHeading title="Needs a decision" detail="Every row opens the record that can resolve it." />
          {readiness.pending ? <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">Checking workspace setup…</p> : null}
          {readiness.error ? (
            <div className="mb-2"><div className="mb-2"><Notice tone="warn" action={<Button size="sm" onClick={readiness.onRetry}>Retry setup checks</Button>}>Setup checks could not be refreshed.</Notice></div></div>
          ) : null}
          <Decisions attention={attention} />
        </section>
      </div>

      <SetupAndSources data={model.data} readiness={readiness} />
    </div>
  );
}

function PulseFact({ item, model, spark, delay }: {
  item: (typeof OVERVIEW_METRICS)[number];
  model: OverviewModel;
  spark: number[];
  delay: number;
}) {
  return (
    <Link
      href={item.href}
      aria-label={`${item.label}: ${model.recentTotals[item.id]} in the last seven workdays, ${deltaText(model.recentTotals[item.id], model.priorTotals[item.id])}. ${item.action}`}
      className={cx("group grid min-w-0 gap-1.5 bg-[var(--color-paper)] px-4 py-3.5 text-left transition hover:bg-[var(--bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] motion-reduce:transition-none", styles.rise)}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="text-[10.5px] font-semibold text-[var(--text-tertiary)]">{item.label}</span>
      <span className="flex items-end justify-between gap-3">
        <b className="text-[28px] font-[620] leading-none tracking-[-0.035em] text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">{model.recentTotals[item.id]}</b>
        <Sparkline values={spark} />
      </span>
      <span className="flex items-center justify-between gap-2">
        <Delta current={model.recentTotals[item.id]} previous={model.priorTotals[item.id]} />
        <small className="whitespace-nowrap text-[9.5px] text-[var(--text-tertiary)]">{Math.round(mean(spark.slice(-7)) * 10) / 10}/day</small>
      </span>
    </Link>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (!values.length) return null;
  const width = 100;
  const height = 24;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
    const y = height - (value / max) * (height - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const last = points[points.length - 1]?.split(",").map(Number) ?? [0, 0];
  return (
    <svg className={styles.spark} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={width / 2} y1="0" x2={width / 2} y2={height} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      <polyline points={points.join(" ")} fill="none" stroke="var(--status-observed)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="2.2" fill="var(--status-observed)" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

interface RefLine { value: number; label: string; kind: "prior" | "recent" }

function TrendChart({ days, metric, metricLabel, refs = [], caption, height = 210 }: {
  days: OverviewDay[];
  metric: OverviewMetric;
  metricLabel: string;
  refs?: RefLine[];
  caption: ReactNode;
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const values = days.map((day) => day[metric]);
  const max = Math.max(1, ...values, ...refs.map((ref) => ref.value));
  const activeDay = active === null ? null : days[active];
  const edge = active !== null && active <= 1 ? "start" : active !== null && active >= days.length - 2 ? "end" : null;

  const focusAt = (index: number) => {
    const clamped = Math.min(Math.max(index, 0), days.length - 1);
    setActive(clamped);
    const day = days[clamped];
    setAnnouncement(`${shortDate(day.date)}. ${plural(day.completed, "outcome")}, ${plural(day.updates, "update")}, ${plural(day.recaps, "recap")}, ${plural(day.evidence, "evidence row")}, ${formatMinutes(day.minutes)} observed.`);
  };
  const step = (direction: number) => focusAt((active ?? days.length - 1) + direction);

  return (
    <figure className={styles.chart}>
      <div
        className={styles.plot}
        style={{ height }}
        tabIndex={0}
        role="img"
        aria-label={`${metricLabel} per workday, ${days.length} workdays ending ${shortDate(days[days.length - 1]?.date ?? "")}. Use the left and right arrow keys to review each workday. The exact values follow the chart.`}
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
        <span className={styles.grid} aria-hidden>
          {[25, 50, 75].map((tick) => <i key={tick} className={styles.gridLine} style={{ bottom: `${tick}%` }} />)}
        </span>
        {refs.map((ref) => (
          <span key={ref.label} className={cx(styles.ref, ref.kind === "recent" ? styles.refRecent : styles.refPrior)} style={{ bottom: `${(ref.value / max) * 100}%` }} aria-hidden>
            <i className={styles.refLine} />
            <b className={styles.refLabel}>{ref.label}</b>
          </span>
        ))}
        <span className={styles.bars} aria-hidden>
          {days.map((day, index) => (
            <span key={day.date} className={cx(styles.slot, active === index && styles.slotActive)} onMouseEnter={() => setActive(index)}>
              <i
                className={styles.bar}
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
            className={cx(styles.readout, edge === "start" && styles.readoutStart, edge === "end" && styles.readoutEnd)}
            style={edge === "start" ? { left: 0 } : edge === "end" ? { right: 0 } : { left: `${((Number(active) + 0.5) / days.length) * 100}%` }}
            aria-hidden
          >
            <b className={styles.readoutTitle}>{shortDate(activeDay.date)}</b>
            <ReadoutRow label="Outcomes" value={activeDay.completed} />
            <ReadoutRow label="Updates" value={activeDay.updates} />
            <ReadoutRow label="Recaps" value={activeDay.recaps} />
            <ReadoutRow label="Evidence" value={activeDay.evidence} />
            <ReadoutRow label="Observed" value={formatMinutes(activeDay.minutes)} />
          </span>
        ) : null}
      </div>
      <span className={styles.axis} aria-hidden>
        {days.map((day, index) => {
          const parts = axisParts(day.date);
          const show = index === 0 || index === days.length - 1 || index % 2 === 0;
          return <i key={day.date} className={styles.axisLabel}>{show ? <><span className={styles.axisMonth}>{parts.month} </span>{parts.day}</> : ""}</i>;
        })}
      </span>
      <figcaption className={styles.caption}>{caption}</figcaption>
      <div className="sr-only">
        <table>
          <caption>{metricLabel} per workday with the full daily record</caption>
        <thead><tr><th>Workday</th><th>Outcomes</th><th>Updates</th><th>Recaps</th><th>Evidence</th><th>Observed minutes</th></tr></thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}><th>{day.date}</th><td>{day.completed}</td><td>{day.updates}</td><td>{day.recaps}</td><td>{day.evidence}</td><td>{day.minutes}</td></tr>
          ))}
          </tbody>
        </table>
      </div>
      <p className="sr-only" aria-live="polite">{announcement}</p>
    </figure>
  );
}

function ReadoutRow({ label, value }: { label: string; value: number | string }) {
  return (
    <span className={styles.readoutRow}>
      <i className={styles.readoutDot} aria-hidden />
      {label}
      <em>{value}</em>
    </span>
  );
}

function SummaryFact({ value, label }: { value: ReactNode; label: string }) {
  return (
    <span className="grid gap-0.5">
      <b className="text-[15px] font-[620] leading-none tracking-[-0.02em] text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">{value}</b>
      <small className="text-[9px] leading-[1.3] text-[var(--text-tertiary)]">{label}</small>
    </span>
  );
}

function Delta({ current, previous }: { current: number; previous: number }) {
  const delta = deltaPercent(current, previous);
  if (delta === null) return <span className="text-[10px] font-medium text-[var(--text-tertiary)]">no prior record</span>;
  if (delta === 0) return <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--text-tertiary)]"><Minus size={12} aria-hidden />level with prior 7</span>;
  const Icon = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-[var(--text-tertiary)]">
      <Icon size={12} aria-hidden />{Math.abs(delta)}%<small className="text-[9.5px] font-medium"> vs prior 7</small>
    </span>
  );
}

function CoverageBar({ counts }: { counts: AdminOverview["counts"] }) {
  const segments = [
    { label: "On shift", value: counts.onShift, color: "var(--color-ink)" },
    { label: "Paused", value: counts.paused, color: "var(--status-warn)" },
    { label: "Off shift", value: counts.offShift, color: "var(--border)" },
    { label: "Not observed", value: counts.unknown, color: "var(--text-tertiary)" },
  ];
  return (
    <div className="grid gap-2.5">
      <span className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]" aria-hidden>
        {segments.map((segment) => (
          <i key={segment.label} style={{ width: `${counts.people ? Math.round((segment.value / counts.people) * 100) : 0}%`, background: segment.color }} />
        ))}
      </span>
      <span className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] text-[var(--text-tertiary)]">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1">
            <i className="size-1.5 rounded-full" style={{ background: segment.color }} aria-hidden />
            {segment.label}<b className="font-semibold text-[var(--text-primary)]">{segment.value}</b>
          </span>
        ))}
      </span>
    </div>
  );
}

function OldestReview({ model }: { model: OverviewModel }) {
  const age = model.oldestReview;
  if (!age) return <p className="mt-1.5 text-[11px] text-[var(--text-tertiary)]">No report is waiting for review.</p>;
  return (
    <p className="mt-1.5 flex items-baseline gap-2">
      <b className="text-[42px] font-[620] leading-[0.95] tracking-[-0.05em] text-[var(--text-primary)] [font-variant-numeric:tabular-nums]">{age.value}</b>
      <span className="text-[12px] leading-[1.25] text-[var(--text-primary)]">
        {age.unit === "hour" ? (age.value === 1 ? "hour" : "hours") : (age.value === 1 ? "day" : "days")}
        <small className="mt-0.5 block text-[10px] leading-[1.35] text-[var(--text-tertiary)]">oldest report waiting</small>
      </span>
    </p>
  );
}

function DayClose({ model }: { model: OverviewModel }) {
  const counts = model.data.counts;
  const autoApproved = counts.recapsAutoApprovedToday ?? 0;
  const recapTotal = counts.recapsReviewedToday + autoApproved;
  return (
    <div className="grid gap-2.5">
      <CloseRow label="EOD submitted today" value={model.eodSubmittedPeople} total={counts.people} detail={`${counts.reportsDraftedToday} drafted`} />
      <CloseRow label="Recaps reviewed" value={recapTotal} total={counts.recapsToday} detail={`${autoApproved ? `${autoApproved} auto-approved · ` : ""}${model.reviewWaiting} waiting`} />
      <div className={cx("flex items-baseline justify-between gap-3 border-t border-[var(--border)] pt-2.5", counts.disputedEvidence > 0 && "text-[var(--status-error)]")}>
        <span className="grid gap-0.5">
          <b className="text-[11px] font-semibold leading-[1.3]">Disputed evidence</b>
          <small className="text-[9.5px] font-medium text-[var(--text-tertiary)]">Needs a ruling</small>
        </span>
        <b className="text-[13px] font-[620] [font-variant-numeric:tabular-nums]">{counts.disputedEvidence}</b>
      </div>
    </div>
  );
}

function CloseRow({ label, value, total, detail }: { label: string; value: number; total: number; detail: string }) {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5">
      <span className="grid gap-0">
        <b className="text-[11px] font-semibold leading-[1.3]">{label}</b>
        <small className="text-[9.5px] font-medium text-[var(--text-tertiary)]">{detail}</small>
      </span>
      <span className="whitespace-nowrap text-[12px] [font-variant-numeric:tabular-nums]"><b className="text-[13px] font-[620]">{value}</b><small className="text-[10px] font-medium text-[var(--text-tertiary)]"> / {total}</small></span>
      <span className={cx(METER, "col-span-2")} aria-hidden><span className="block h-full rounded-full bg-[var(--accent)]" style={{ width: `${share}%` }} /></span>
    </div>
  );
}

function Decisions({ attention }: { attention: AdminOverview["attention"] }) {
  const sorted = [...attention].sort((left, right) => {
    const severity = { error: 0, warn: 1, info: 2 } as Record<string, number>;
    return (severity[left.severity] ?? 3) - (severity[right.severity] ?? 3) || right.count - left.count;
  });
  if (!sorted.length) {
    return (
      <p className="flex items-start gap-2 text-[11.5px] leading-5 text-[var(--text-secondary)]">
        <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-[var(--status-ok)]" aria-hidden />
        Nothing needs a decision. Reviews, EODs, and the task record are clear.
      </p>
    );
  }
  return (
    <ul className="grid">
      {sorted.map((item) => (
        <li key={item.code} className="border-t border-[var(--border)] first:border-t-0">
          <Link href={item.href ?? "#"} className="group flex items-center justify-between gap-3 py-2.5 transition hover:bg-[var(--bg-secondary)] motion-reduce:transition-none">
            <span className="flex min-w-0 items-start gap-2.5">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: item.severity === "error" ? "var(--status-error)" : item.severity === "warn" ? "var(--status-warn)" : "var(--status-info)" }} />
              <span className="min-w-0 text-[11.5px] leading-5 text-[var(--text-primary)]">{item.message}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-[var(--text-tertiary)] transition group-hover:text-[var(--text-primary)]">
              {attentionVerb[item.code] ?? "Open"}
              <ChevronRight size={12} aria-hidden />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SetupAndSources({ data, readiness }: { data: AdminOverview; readiness: AdminOverviewSignalProps["readiness"] }) {
  const report = readiness.report;
  const generatedAt = Date.parse(data.generatedAt);
  // Agent OS carries live GoHighLevel sources; Work OS does not. Read them
  // structurally so the same board preserves the source row where it exists.
  const ghlSync = (data.freshness as { ghlLastSyncAt?: string | null }).ghlLastSyncAt;
  const ghlCounts = data.counts as { ghlPerformedToday?: number; ghlContextToday?: number };
  const showGhl = ghlSync !== undefined || ghlCounts.ghlPerformedToday !== undefined;
  return (
    <details className="group border-y border-[var(--border)]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-2.5 text-[10.5px] font-semibold text-[var(--text-tertiary)] transition hover:text-[var(--text-primary)] [&::-webkit-details-marker]:hidden">
        Setup and sources
        <ChevronDown size={14} className="shrink-0 transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
      </summary>
      <div className="grid gap-6 py-4 lg:grid-cols-2">
        <div className="min-w-0">
          <SectionHeading
            title="Workspace setup"
            detail="Configuration gaps and the current readiness state."
            action={<Link href="/work-os/admin/settings" className="text-[11px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Open Settings</Link>}
          />
          {report ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <StateMark tone={report.status === "ready" ? "ok" : report.status === "blocked" ? "err" : "warn"}>{statusLabel(report.status)}</StateMark>
                <span className="text-[11px] text-[var(--text-tertiary)]">{report.checks.people.active} people · {report.checks.organization.activeTeams} teams · {report.checks.tasks.open} open tasks</span>
              </div>
              {report.issues.length ? (
                <ul className="grid gap-1.5 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {report.issues.slice(0, 6).map((issue) => (
                    <li key={issue.code} className="flex gap-2">
                      <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: issue.severity === "blocked" ? "var(--status-error)" : "var(--status-warn)" }} />
                      <span><strong className="font-semibold text-[var(--text-primary)]">{issue.count}</strong> {issue.message}</span>
                    </li>
                  ))}
                  {report.issues.length > 6 ? <li className="text-[11px] text-[var(--text-tertiary)]">+ {report.issues.length - 6} more configuration checks</li> : null}
                </ul>
              ) : (
                <p className="text-[12px] text-[var(--status-ok)]">Pilot configuration is complete.</p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--text-tertiary)]">{readiness.pending ? "Checking workspace setup…" : "Readiness is unavailable right now. Retry from Needs a decision."}</p>
          )}
        </div>
        <div className="min-w-0">
          <SectionHeading title="Sources" detail="When each source last delivered, measured at generation time." />
          <ul className="grid">
            <SourceRow label="Tasks" at={data.freshness.niftySyncedAt} now={generatedAt} freshWithinMs={60 * 60_000} volume={`${data.freshness.niftyTasksToday} task${data.freshness.niftyTasksToday === 1 ? "" : "s"} created today`} />
            <SourceRow label="Worktivity" at={data.freshness.worktivityObservedAt} now={generatedAt} freshWithinMs={15 * 60_000} volume={`${data.counts.evidenceActivityToday} frame${data.counts.evidenceActivityToday === 1 ? "" : "s"} today`} />
            <SourceRow label="GitHub" at={data.freshness.githubLastEventAt} now={generatedAt} freshWithinMs={24 * 60 * 60_000} volume={`${data.freshness.githubEventsToday} event${data.freshness.githubEventsToday === 1 ? "" : "s"} today`} />
            {showGhl ? <SourceRow label="GoHighLevel" at={ghlSync ?? null} now={generatedAt} freshWithinMs={15 * 60_000} volume={`${ghlCounts.ghlPerformedToday ?? 0} performed · ${ghlCounts.ghlContextToday ?? 0} context today`} /> : null}
            <SourceRow label="Plans" at={data.freshness.lastPlanAt} now={generatedAt} freshWithinMs={24 * 60 * 60_000} volume="Plan edits and confirmations" />
            <SourceRow label="EOD reports" at={data.freshness.lastReportSubmittedAt} now={generatedAt} freshWithinMs={48 * 60 * 60_000} volume={`${data.counts.reportsPendingReview} awaiting review`} />
          </ul>
        </div>
      </div>
    </details>
  );
}

function SourceRow({ label, at, now, freshWithinMs, volume }: { label: string; at: string | null; now: number; freshWithinMs: number; volume: string }) {
  const parsed = at ? Date.parse(at) : Number.NaN;
  const age = Number.isFinite(parsed) ? now - parsed : Number.POSITIVE_INFINITY;
  const tone = !Number.isFinite(age) ? "none" : age <= freshWithinMs ? "fresh" : age <= freshWithinMs * 3 ? "stale" : "cold";
  const color = tone === "fresh" ? "var(--status-ok)" : tone === "stale" ? "var(--status-warn)" : "var(--text-tertiary)";
  return (
    <li className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0" title={at ? `Last data ${new Date(at).toLocaleString()}` : "No data recorded yet"}>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[12px] font-medium text-[var(--text-primary)]">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="mt-0.5 block text-[10.5px] text-[var(--text-tertiary)]">{volume}</span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-[var(--text-secondary)]">{Number.isFinite(parsed) ? relativeTime(at, new Date(now)) : "no data yet"}</span>
    </li>
  );
}

function ExactTimeTable({ data }: { data: AdminOverview["timeSeries"] }) {
  const people = [...new Map(data.flatMap((point) => point.people).map((person) => [person.personId, person.name])).entries()];
  return (
    <div className="sr-only">
      <table>
        <caption>Observed minutes by workday and teammate</caption>
      <thead><tr><th>Workday</th><th>Total minutes</th>{people.map(([personId, name]) => <th key={personId}>{name}</th>)}</tr></thead>
      <tbody>
        {data.map((point) => (
          <tr key={point.date}>
            <th>{point.date}</th>
            <td>{point.totalMinutes}</td>
            {people.map(([personId]) => <td key={personId}>{point.people.find((person) => person.personId === personId)?.minutes ?? 0}</td>)}
          </tr>
        ))}
        </tbody>
      </table>
    </div>
  );
}
