"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarRange, RefreshCw, Sparkles, Target, TrendingUp } from "lucide-react";
import { useEmployeeDay } from "./useEmployeeDay";
import { fetchJson, calendarDateLabel, formatDateTimeShort, longDateLabel, type EmployeeInsightsResponse } from "./model";
import {
  consistencyChips,
  durationLabel,
  flowBreakdown,
  insightRangeSummary,
  insightSeries,
  periodDeltas,
  sharePercent,
  trendSummary,
  onTimeRate,
  updateKindBreakdown,
  type DeltaStat,
  type FlowSlice,
  type InsightSeriesPoint,
} from "./insights";
import {
  EmptyState,
  IconButton,
  Masthead,
  Notice,
  Panel,
  PanelHeader,
  SecondaryButton,
  Skeleton,
  StatusPill,
  SyncChip,
  inputClass,
  inputStyle,
} from "./ui";

type Range = "day" | "7d" | "30d";

const RANGES: Array<{ id: Range; label: string }> = [
  { id: "day", label: "Day" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

const FLOW_COLORS: Record<string, string> = {
  completed: "var(--accent-deep)",
  progressed: "var(--status-info)",
  deferred: "var(--status-warn)",
  carried: "#8a6cc9",
  unplanned: "var(--text-tertiary)",
};

export default function EmployeeInsights() {
  const { day, refresh, sync, syncing } = useEmployeeDay();
  const [range, setRange] = useState<Range>("7d");
  const [through, setThrough] = useState("");
  const [showStats, setShowStats] = useState(false);
  const [synthesis, setSynthesis] = useState<{ status: "loading" } | { status: "ready"; text: string; mode?: "ai" | "evidence" } | { status: "failed" } | null>(null);

  useEffect(() => {
    if (day.data?.shiftDate) setThrough((current) => current || day.data!.shiftDate);
  }, [day.data?.shiftDate]);

  const insights = useQuery<EmployeeInsightsResponse>({
    queryKey: ["work-os", "employee-insights", range, through],
    queryFn: () => fetchJson(`/api/work-os/me/insights?range=${range}&through=${encodeURIComponent(through)}`),
    enabled: !!through,
    staleTime: 60_000,
  });

  // The synthesis is range-scoped: a narrative from another range must not sit
  // next to different numbers, and a response that arrives after the selection
  // moves on is dropped.
  const activeSynthesisScopeRef = useRef("");
  activeSynthesisScopeRef.current = `${range}:${through}`;
  useEffect(() => { setSynthesis(null); }, [range, through]);
  const synthesize = useMutation({
    mutationFn: (variables: { range: string; through: string }) => fetchJson<{ synthesis: string; mode?: "ai" | "evidence" }>("/api/work-os/me/insights/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ range: variables.range, through: variables.through }),
    }),
    onSuccess: (result, variables) => {
      if (`${variables.range}:${variables.through}` !== activeSynthesisScopeRef.current) return;
      setSynthesis(result.synthesis ? { status: "ready", text: String(result.synthesis), mode: result.mode } : { status: "failed" });
    },
    onError: (_error, variables) => {
      if (`${variables.range}:${variables.through}` !== activeSynthesisScopeRef.current) return;
      setSynthesis({ status: "failed" });
    },
  });

  const data = insights.data;
  const days = data?.days ?? [];
  const error = day.error || insights.error;
  const series = data ? insightSeries(data.days) : [];
  const rangeSummary = data ? insightRangeSummary(data) : null;
  const deltas = data ? periodDeltas(data.totals, data.comparison?.totals) : [];
  const flow = data ? flowBreakdown(data.days) : [];
  const chips = data ? consistencyChips(data.consistency, data.days) : [];
  const updateKinds = data ? updateKindBreakdown(data.updateKinds ?? data.days) : [];
  const timing = data ? onTimeRate(data.days) : null;
  const rangeLabel = range === "day" ? "today" : range === "7d" ? "these 7 days" : "these 30 days";

  return (
    <div>
      <Masthead
        eyebrow="Work OS · Insights"
        title="Your record"
        meta="Outcomes, plan reliability, updates, evidence, and Worktivity context stay separate — the record is not a score."
        actions={
          <>
            <nav aria-label="Insight range" className="flex rounded-[10px] border p-0.5" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
              {RANGES.map((item) => {
                const active = range === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setRange(item.id)}
                    className="rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition"
                    style={active ? { background: "color-mix(in srgb, var(--accent-deep) 12%, var(--bg-card))", color: "var(--accent-deep)" } : { color: "var(--text-secondary)" }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <input
              type="date"
              value={through}
              max={day.data?.shiftDate ?? undefined}
              onChange={(event) => setThrough(event.target.value)}
              aria-label="Through date"
              className={`${inputClass} w-auto`}
              style={inputStyle}
            />
            <IconButton label="Refresh insights" onClick={() => void refresh()} disabled={insights.isFetching}>
              <RefreshCw size={15} className={insights.isFetching ? "animate-spin" : undefined} />
            </IconButton>
            <SyncChip sync={day.data?.niftySync} syncing={syncing} onSync={() => sync.mutate()} />
          </>
        }
      />

      {error ? <Notice tone="err" className="mb-5">{(error as Error).message}</Notice> : null}

      {data?.freshness.stale ? (
        <Notice tone="warn" className="mb-5">
          Retained data is stale{data.freshness.staleAt ? ` since ${new Date(data.freshness.staleAt).toLocaleString()}` : ""}. {data.freshness.error || "Refresh is pending."}
        </Notice>
      ) : null}

      {insights.isLoading && !data ? (
        <div className="grid gap-5" aria-busy="true">
          <Panel className="p-5"><Skeleton className="h-4 w-44" /><Skeleton className="mt-3 h-12 w-full" /></Panel>
          <Panel className="p-5"><Skeleton className="h-4 w-32" /><Skeleton className="mt-3 h-28 w-full" /></Panel>
        </div>
      ) : data ? (
        <div className="grid gap-5">
          <Panel>
            <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--text-tertiary)]">
                  {calendarDateLabel(data.from)} → {calendarDateLabel(data.through)}
                </p>
                <h2 className="mt-1.5 text-[26px] font-bold leading-tight text-[var(--text-primary)]">
                  {data.totals.tasksCompleted} outcome{data.totals.tasksCompleted === 1 ? "" : "s"} completed
                </h2>
                <p className="mt-1.5 text-[13px] leading-6 text-[var(--text-secondary)]">
                  {Number(data.totals.planned ?? 0) > 0
                    ? <>{data.totals.plannedCompleted} of {data.totals.planned} planned commitments landed{rangeSummary?.commitmentRate != null ? <> · <strong className="text-[var(--text-primary)]">{rangeSummary.commitmentRate}%</strong> completion</> : null}.</>
                    : "No planned commitments were recorded in this range."}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-[var(--text-tertiary)]">
                  <span>Nifty {data.freshness.niftySyncedAt ? `updated ${formatDateTimeShort(data.freshness.niftySyncedAt)}` : "not synced"}</span>
                  <span>Worktivity {data.freshness.worktivityObservedAt ? `observed ${formatDateTimeShort(data.freshness.worktivityObservedAt)}` : "not observed"}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
                <Stat label="Recorded days" value={`${rangeSummary?.recordedDays ?? 0}/${days.length}`} />
                <Stat label="Avg recorded day" value={durationLabel(rangeSummary?.averageObservedSeconds ?? 0)} />
                <Stat label="Outcomes / day" value={rangeSummary?.recordedDays ? `${Math.round(((Number(data.totals.tasksCompleted ?? 0) / rangeSummary.recordedDays) + Number.EPSILON) * 10) / 10}` : "—"} />
                <Stat label="Closing carry-over" value={`${rangeSummary?.closingCarryOver ?? 0}`} delta={data.comparison?.days?.length ? { key: "carried", label: "Carry-over", current: rangeSummary?.closingCarryOver ?? 0, previous: (rangeSummary?.closingCarryOver ?? 0) - (rangeSummary?.carryOverDelta ?? 0), delta: rangeSummary?.carryOverDelta ?? 0, unit: "count", goodDirection: false } : null} />
              </div>
            </div>
          </Panel>

          <div className="grid gap-5 xl:grid-cols-2">
            <Panel>
              <PanelHeader
                icon={<TrendingUp size={16} />}
                title="Outcomes by day"
                meta={`Completed outcomes across ${rangeLabel}. Bars are exact counts; the brief below explains the narrative.`}
              />
              <div className="px-5 py-4">
                <DayBars points={series} />
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
                  <span>Peak day: {trendSummary(series).peak ? `${trendSummary(series).peak!.label} · ${trendSummary(series).peak!.observedMinutes} min observed` : "—"}</span>
                  <span>Recorded days: {trendSummary(series).recordedDays}</span>
                  <span>Average plan completion: {trendSummary(series).averageCompletionPercent != null ? `${trendSummary(series).averageCompletionPercent}%` : "—"}</span>
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={<CalendarRange size={16} />}
                title="Work flow"
                meta="Outcomes, progress updates, deferred, carried, and unplanned work — kept separate on purpose."
              />
              <div className="grid gap-4 px-5 py-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                <FlowDonut slices={flow} />
                <div className="grid content-center gap-2">
                  {flow.map((slice) => (
                    <div key={slice.key} className="flex items-center justify-between gap-3 text-[12px]">
                      <span className="flex items-center gap-2 text-[var(--text-secondary)]">
                        <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: FLOW_COLORS[slice.key] }} />
                        {slice.label}
                      </span>
                      <span className="tabular-nums text-[var(--text-primary)]">
                        {slice.value} <span className="text-[11px] text-[var(--text-tertiary)]">({sharePercent(slice.value, flow.reduce((sum, item) => sum + item.value, 0))}%)</span>
                      </span>
                    </div>
                  ))}
                  {timing && timing.total > 0 ? (
                    <div className="mt-2 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="text-[var(--text-secondary)]">Outcomes on time</span>
                        <span className="tabular-nums text-[var(--text-primary)]">{timing.onTime} on time · {timing.late} late{timing.percent != null ? ` · ${timing.percent}%` : ""}</span>
                      </div>
                      <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full" style={{ background: "var(--bg-tertiary)" }} role="img" aria-label={`${timing.onTime} outcomes on time and ${timing.late} late`}>
                        <span style={{ width: `${sharePercent(timing.onTime, timing.total)}%`, background: "var(--accent-deep)" }} />
                        <span style={{ width: `${sharePercent(timing.late, timing.total)}%`, background: "var(--status-warn)" }} />
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              {updateKinds.some((kind) => kind.value > 0) ? (
                <div className="flex flex-wrap gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border)" }}>
                  {updateKinds.filter((kind) => kind.value > 0).map((kind) => (
                    <span key={String(kind.key)} className="rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: kind.attention ? "color-mix(in srgb, var(--status-warn) 45%, var(--border))" : "var(--border)", color: kind.attention ? "var(--status-warn)" : "var(--text-secondary)" }}>
                      {kind.label} {kind.value}
                    </span>
                  ))}
                </div>
              ) : null}
            </Panel>
          </div>

          {chips.length ? (
            <Panel>
              <PanelHeader icon={<Target size={16} />} title="Rhythm" meta="Deterministic consistency signals from the same record — no streak pressure, no scoring." />
              <div className="flex flex-wrap gap-3 px-5 py-4">
                {chips.map((chip) => (
                  <div key={chip.key} className="min-w-[150px] flex-1 rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
                    <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{chip.label}</span>
                    <strong className="mt-1 block text-[18px] font-bold tabular-nums text-[var(--text-primary)]">{chip.value}</strong>
                    <span className="mt-0.5 block text-[11px] leading-4 text-[var(--text-tertiary)]">{chip.detail}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader
              icon={<Sparkles size={16} />}
              title="AI synthesis"
              meta={synthesis?.status === "ready" ? "A grounded read of this range." : "A short grounded read generated from the verified range facts."}
              actions={
                <SecondaryButton disabled={!data || synthesize.isPending} onClick={() => synthesize.mutate({ range, through: insights.data?.through ?? through })}>
                  {synthesize.isPending ? "Synthesizing…" : synthesis?.status === "ready" ? "Re-synthesize" : "Synthesize with AI"}
                </SecondaryButton>
              }
            />
            <div className="px-5 py-4">
              {synthesis?.status === "ready" ? (
                <>
                  <p className="whitespace-pre-line text-[14px] leading-6 text-[var(--text-primary)]">{synthesis.text}</p>
                  {synthesis.mode === "evidence" ? (
                    <p className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">The assistant&apos;s draft could not be verified — showing the exact fact record instead.</p>
                  ) : null}
                </>
              ) : synthesis?.status === "failed" ? (
                <p className="text-[12px] leading-5 text-[var(--text-secondary)]">The assistant is unavailable — the verified range facts and exact daily values remain available below.</p>
              ) : (
                <p className="text-[12px] leading-5 text-[var(--text-secondary)]">Adds short grounded paragraphs from the verified range facts. Every figure is checked against the record, and no productivity score is generated.</p>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              icon={<Target size={16} />}
              title="Brief"
              meta={`${calendarDateLabel(data.from)} – ${calendarDateLabel(data.through)} · generated from the same record you see below.`}
            />
            <div className="grid gap-6 px-5 py-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <p className="text-[14px] leading-6 text-[var(--text-primary)]">{data.brief.summary || "No insight record is available for this range."}</p>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                <BriefList title="Wins" items={data.brief.wins} />
                <BriefList title="Attention" items={data.brief.attention} />
                <BriefList title="Next focus" items={data.brief.nextFocus} />
              </div>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              icon={<CalendarRange size={16} />}
              title="Daily records"
              meta={`${days.length} day${days.length === 1 ? "" : "s"} in this range. Newest first.`}
              actions={<SecondaryButton onClick={() => setShowStats((value) => !value)}>{showStats ? "Hide exact numbers" : "Show exact numbers"}</SecondaryButton>}
            />
            {days.length ? (
              <ul>
                {[...days].reverse().map((item) => (
                  <li key={item.date} className="border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--border)" }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <button type="button" onClick={() => setThrough(item.date)} className="text-left text-[13px] font-semibold hover:underline" style={{ color: "var(--accent-deep)" }}>
                        {longDateLabel(item.date)}
                      </button>
                      <div className="flex flex-wrap items-center gap-2">
                        {item.sessionQuality?.message ? <StatusPill tone="overdue">{item.sessionQuality.message}</StatusPill> : null}
                        {item.breakFreshness ? <StatusPill tone="open">{item.breakFreshness}</StatusPill> : null}
                      </div>
                    </div>
                    <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums text-[var(--text-secondary)]">
                      <span>{item.tasksCompleted} completed</span>
                      <span>{item.progressed ?? 0} progressed</span>
                      <span>{item.deferred ?? 0} deferred</span>
                      <span>{item.carried ?? 0} carried</span>
                      <span>{item.unplanned ?? 0} unplanned</span>
                      {showStats ? <span>{durationLabel(item.observedSeconds)} observed</span> : null}
                      {showStats && item.trackedMinutes ? <span>{durationLabel(item.trackedMinutes * 60)} tracked context</span> : null}
                    </p>
                    {item.goal?.text ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-tertiary)]">Goal: {item.goal.text}</p> : null}
                    {item.references.length ? (
                      <p className="mt-1.5 flex flex-wrap gap-3">
                        {item.references.slice(0, 4).map((reference) => (
                          <a key={reference.id} href={reference.target} className="text-[11px] font-semibold" style={{ color: "var(--accent-deep)" }}>{reference.label}</a>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={<CalendarRange size={20} />} title="No recorded days in this range" message="Work you log or plan will appear here day by day." />
            )}
          </Panel>
        </div>
      ) : (
        <EmptyState
          title="Insights could not be loaded"
          message={(insights.error as Error)?.message}
          action={<SecondaryButton onClick={() => void insights.refetch()}>Try again</SecondaryButton>}
        />
      )}
    </div>
  );
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: DeltaStat | null }) {
  return (
    <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: "var(--border)", background: "var(--bg-primary)" }}>
      <span className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--text-tertiary)]">{label}</span>
      <strong className="mt-1 block text-[18px] font-bold tabular-nums text-[var(--text-primary)]">{value}</strong>
      {delta && delta.delta !== 0 ? <DeltaBadge stat={delta} /> : null}
    </div>
  );
}

function DeltaBadge({ stat }: { stat: DeltaStat }) {
  const rising = stat.delta > 0;
  const good = stat.goodDirection === null ? null : rising === stat.goodDirection;
  const color = good === null ? "var(--text-tertiary)" : good ? "var(--status-ok)" : "var(--status-warn)";
  return (
    <span className="mt-0.5 block text-[11px] font-semibold tabular-nums" style={{ color }}>
      {rising ? "+" : "−"}{Math.abs(stat.delta)} <span className="font-normal text-[var(--text-tertiary)]">vs prior window</span>
    </span>
  );
}

/** Compact exact-count bars. Undated or zero days render as a quiet baseline
 * with no implied value, and the exact numbers live in the accessible label. */
function DayBars({ points }: { points: InsightSeriesPoint[] }) {
  if (!points.length) return <p className="text-[12px] text-[var(--text-tertiary)]">No days in this range.</p>;
  const max = Math.max(1, ...points.map((point) => point.outcomes));
  const labelEvery = points.length > 14 ? 5 : points.length > 9 ? 2 : 1;
  return (
    <figure>
      <div
        className="flex items-end gap-1"
        style={{ height: 140 }}
        role="img"
        aria-label={`Outcomes completed per day: ${points.map((point) => `${point.label} ${point.outcomes}`).join(", ")}.`}
      >
        {points.map((point, index) => (
          <div key={point.date} className="flex h-full min-w-0 flex-1 flex-col justify-end gap-1" title={`${point.label}: ${point.outcomes} outcome${point.outcomes === 1 ? "" : "s"}`}>
            <span className="text-center text-[10px] tabular-nums text-[var(--text-tertiary)]">{point.outcomes > 0 ? point.outcomes : ""}</span>
            <div
              className="rounded-t-[4px]"
              style={{ height: `${Math.round((point.outcomes / max) * 100)}%`, minHeight: point.outcomes > 0 ? 4 : 2, background: point.outcomes > 0 ? "var(--accent-deep)" : "var(--bg-tertiary)" }}
            />
            <span className="truncate text-center text-[10px] text-[var(--text-tertiary)]">{index % labelEvery === 0 || index === points.length - 1 ? point.label : "\u00A0"}</span>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-[11px] leading-5 text-[var(--text-tertiary)]">Completed outcomes per day · unit: outcomes · exact counts labeled above each bar.</figcaption>
    </figure>
  );
}

/** SVG donut with a legend that carries the exact numbers — the chart never
 * relies on color alone. */
function FlowDonut({ slices }: { slices: FlowSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const size = 132;
  const stroke = 18;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Work flow shares: ${slices.map((slice) => `${slice.label} ${slice.value}`).join(", ")}.`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-tertiary)" strokeWidth={stroke} />
      {total > 0
        ? slices.filter((slice) => slice.value > 0).map((slice) => {
            const length = (slice.value / total) * circumference;
            const dash = `${length} ${circumference - length}`;
            const element = (
              <circle
                key={slice.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={FLOW_COLORS[slice.key]}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += length;
            return element;
          })
        : null}
      <text x="50%" y="47%" textAnchor="middle" style={{ fontSize: 20, fontWeight: 700, fill: "var(--text-primary)" }}>{total}</text>
      <text x="50%" y="62%" textAnchor="middle" style={{ fontSize: 9, fill: "var(--text-tertiary)" }}>items in range</text>
    </svg>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">{title}</h3>
      {items.length ? (
        <ul className="mt-1.5 grid gap-1">
          {items.map((item) => (
            <li key={item} className="text-[12px] leading-5 text-[var(--text-secondary)]">{item}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-[12px] text-[var(--text-tertiary)]">Nothing to report.</p>
      )}
    </div>
  );
}
