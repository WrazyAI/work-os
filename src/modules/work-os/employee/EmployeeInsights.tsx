"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, RefreshCw, Sparkles, Target, TrendingUp } from "lucide-react";
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
  Metric,
  Notice,
  Panel,
  PanelHeader,
  SecondaryButton,
  Skeleton,
  StateMark,
  StatusPill,
  SyncChip,
  cx,
  inputClass,
  inputStyle,
} from "./ui";

type Range = "day" | "7d" | "30d";

const RANGES: Array<{ id: Range; label: string }> = [
  { id: "day", label: "Day" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
];

/* Calm composition colors: completed stays the deepest signal, context keeps
 * the cool observation tone, and nothing here is danger red. The carried hue
 * comes from the theme-aware chart family so it reads on both grounds. */
const FLOW_COLORS: Record<string, string> = {
  completed: "var(--accent-deep)",
  progressed: "var(--status-observed)",
  deferred: "var(--status-warn)",
  carried: "var(--chart-5)",
  unplanned: "var(--text-tertiary)",
};

export default function EmployeeInsights() {
  const { day, refresh, refreshAttendance, sync, syncing } = useEmployeeDay();
  const [range, setRange] = useState<Range>("7d");
  const [through, setThrough] = useState("");
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
  // A layout effect keeps the scope current at commit: a passive effect can run
  // after paint, and a response landing in that window must still be dropped.
  useLayoutEffect(() => { activeSynthesisScopeRef.current = `${range}:${through}`; }, [range, through]);
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
  const dayCount = days.length;
  const recordedDays = rangeSummary?.recordedDays ?? 0;
  const daysWithUpdate = data?.consistency?.daysWithUpdate ?? days.filter((item) => Number(item.updates ?? 0) > 0).length;
  const ratio = (part: number, of: number) => (of > 0 ? Math.round((part / of) * 100) : null);
  // Comparison marks only render when the response actually carries an equal
  // earlier period; a missing comparison must never read as a drop against zero.
  const comparisonAvailable = Boolean(data?.comparison?.days?.length);
  const pillFor = (key: string) => (comparisonAvailable ? deltas.find((stat) => stat.key === key) ?? null : null);
  const activeKinds = updateKinds.filter((kind) => kind.value > 0);
  const summary = trendSummary(series);
  const closingCarryOver = rangeSummary?.closingCarryOver ?? 0;
  const closingOverdue = rangeSummary?.closingOverdue ?? 0;
  const blockers = rangeSummary?.blockers ?? 0;

  return (
    <div>
      <Masthead
        eyebrow="Work OS"
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
                    className={cx(
                      "rounded-[8px] px-3 py-1.5 text-[12px] font-semibold transition",
                      active ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                    )}
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
            <IconButton label="Refresh insights" onClick={() => { void refreshAttendance().then(refresh); }} disabled={insights.isFetching}>
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
          {/* Range summary — one quiet line, no hero card */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px] text-[var(--text-tertiary)]">
            <span className="font-semibold text-[var(--text-primary)]">{calendarDateLabel(data.from)} → {calendarDateLabel(data.through)}</span>
            <span>
              {Number(data.totals.planned ?? 0) > 0
                ? `${data.totals.plannedCompleted} of ${data.totals.planned} planned commitments landed`
                : "No planned commitments were recorded in this range"}
            </span>
            <span>Worktivity {data.freshness.worktivityObservedAt ? `observed ${formatDateTimeShort(data.freshness.worktivityObservedAt)}` : "not observed"}</span>
          </div>

          {/* Five-fact KPI strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KpiCard label="Outcomes completed" value={String(data.totals.tasksCompleted)} delta={pillFor("tasksCompleted")} />
            <KpiCard
              label="Commitment rate"
              value={rangeSummary?.commitmentRate != null ? `${rangeSummary.commitmentRate}%` : "—"}
              detail={rangeSummary?.commitmentRate != null ? `${data.totals.plannedCompleted} of ${data.totals.planned} planned` : "No planned commitments in this range"}
            />
            <KpiCard label="Updates recorded" value={String(data.totals.updates)} delta={pillFor("updates")} />
            <KpiCard label="Observed context" value={durationLabel(Number(data.totals.observedSeconds ?? 0))} delta={pillFor("observedMinutes")} />
            <KpiCard
              label="Closing carry-over"
              value={String(closingCarryOver)}
              attention={closingCarryOver > 0}
              detail={closingCarryOver > 0 ? "Still open at the close" : "Nothing carried at the close"}
            />
          </div>

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
              <p className="text-[13.5px] leading-6 text-[var(--text-primary)]">{data.brief.summary || "No insight record is available for this range."}</p>
              <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
                <BriefList title="Wins" items={data.brief.wins} />
                <BriefList title="Attention" items={data.brief.attention} />
                <BriefList title="Next focus" items={data.brief.nextFocus} />
              </div>
            </div>
          </Panel>

          {/* The range's daily record — one chart, exact counts */}
          <Panel>
            <PanelHeader
              icon={<TrendingUp size={16} />}
              title="Outcomes by day"
              meta={`Completed outcomes across ${rangeLabel}. Bars are exact counts; the brief above explains the narrative.`}
            />
            <div className="px-5 py-4">
              <DayBars points={series} />
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--text-tertiary)]">
                <span>Most observed day: {summary.peak ? `${summary.peak.label} · ${summary.peak.observedMinutes} min observed` : "—"}</span>
                <span>Recorded days: {summary.recordedDays}</span>
                <span>Average plan completion: {summary.averageCompletionPercent != null ? `${summary.averageCompletionPercent}%` : "—"}</span>
              </div>
            </div>
          </Panel>

          {/* Plan reliability beside the record mix */}
          <div className="grid gap-5 lg:grid-cols-12">
            <Panel className="lg:col-span-7">
              <PanelHeader icon={<Target size={16} />} title="Plan reliability" meta="Recorded ratios from this range." />
              <div className="grid gap-4 px-5 py-4">
                <ReliabilityRow
                  label="Outcomes on time"
                  percent={timing?.percent ?? null}
                  detail={timing && timing.total > 0 ? `${timing.onTime} on time · ${timing.late} late` : "No outcomes with a due date in this range"}
                />
                <ReliabilityRow
                  label="Days with an update"
                  percent={ratio(daysWithUpdate, dayCount)}
                  detail={`${daysWithUpdate} of ${dayCount} day${dayCount === 1 ? "" : "s"} with a substantive update`}
                />
                <ReliabilityRow
                  label="Days recorded"
                  percent={ratio(recordedDays, dayCount)}
                  detail={`${recordedDays} of ${dayCount} day${dayCount === 1 ? "" : "s"} with observed time${recordedDays > 0 && rangeSummary ? ` · ${durationLabel(rangeSummary.averageObservedSeconds)} average` : ""}`}
                />
                <p className="text-[11px] leading-4 text-[var(--text-tertiary)]">Undated work is never classified either way.</p>
              </div>
            </Panel>

            <Panel className="lg:col-span-5">
              <PanelHeader
                icon={<CalendarRange size={16} />}
                title="Record mix"
                meta="How this range's recorded items split — a composition, not a sequence."
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
                </div>
              </div>
              {activeKinds.length ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t px-5 py-3 text-[11.5px] text-[var(--text-secondary)]" style={{ borderColor: "var(--border-subtle)" }}>
                  <span className="text-[var(--text-tertiary)]">Update mix</span>
                  {activeKinds.map((kind) => (
                    <span key={String(kind.key)}>
                      {kind.label} <strong className="font-semibold tabular-nums text-[var(--text-primary)]">{kind.value}</strong>
                    </span>
                  ))}
                </div>
              ) : null}
            </Panel>
          </div>

          {/* Closing attention beside the rhythm signals */}
          <div className="grid gap-5 lg:grid-cols-12">
            <Panel className="lg:col-span-7">
              <PanelHeader icon={<AlertTriangle size={16} />} title="Needs attention" meta="Closing state, not accumulated snapshots." />
              <div className="grid gap-2.5 px-5 py-4">
                <AttentionRow count={closingCarryOver} amber>carried item{closingCarryOver === 1 ? "" : "s"} still open at the end of the range</AttentionRow>
                <AttentionRow count={closingOverdue}>overdue item{closingOverdue === 1 ? "" : "s"} in the latest day</AttentionRow>
                <AttentionRow count={blockers} amber>blocker{blockers === 1 ? "" : "s"} raised through recorded updates</AttentionRow>
                {data.brief.nextFocus[0] ? (
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 border-t pt-3 text-[12.5px] leading-5" style={{ borderColor: "var(--border-subtle)" }}>
                    <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-tertiary)]">Next focus</span>
                    <b className="font-semibold text-[var(--text-primary)]">{data.brief.nextFocus[0]}</b>
                  </p>
                ) : null}
              </div>
            </Panel>

            <Panel className="lg:col-span-5">
              <PanelHeader icon={<Target size={16} />} title="Work rhythm" meta="Goals, updates, outcomes, and the closing streak." />
              <div className="grid grid-cols-2 gap-x-5 gap-y-4 px-5 py-4">
                {chips.length ? (
                  chips.map((chip) => <Metric key={chip.key} label={chip.label} value={chip.value} detail={chip.detail} />)
                ) : (
                  <p className="col-span-2 text-[12px] text-[var(--text-tertiary)]">No rhythm signals were recorded in this range yet.</p>
                )}
              </div>
            </Panel>
          </div>

          {/* Exact daily values stay behind the disclosure (design §4.5) */}
          <details className="rounded-2xl border" style={{ borderColor: "var(--border)", background: "var(--bg-card)", boxShadow: "0 1px 2px rgba(20,30,18,.035), 0 10px 28px rgba(20,30,18,.045)" }}>
            <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
              <span className="flex items-center gap-2 text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--text-primary)]">
                <CalendarRange size={14} className="shrink-0" style={{ color: "var(--text-tertiary)" }} />
                View daily breakdown
              </span>
              <span className="text-[11.5px] text-[var(--text-tertiary)]">{dayCount} day{dayCount === 1 ? "" : "s"} in this range · newest first</span>
            </summary>
            <div className="border-t" style={{ borderColor: "var(--border-subtle)" }}>
              {days.length ? (
                <ul>
                  {[...days].reverse().map((item) => (
                    <li key={item.date} className="border-b px-5 py-4 last:border-b-0" style={{ borderColor: "var(--border-subtle)" }}>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <button type="button" onClick={() => setThrough(item.date)} className="text-left text-[13px] font-semibold text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
                          {longDateLabel(item.date)}
                        </button>
                        <div className="flex flex-wrap items-center gap-2">
                          {item.sessionQuality?.message ? <StateMark tone="warn">{item.sessionQuality.message}</StateMark> : null}
                          {item.breakFreshness ? <StateMark tone="neutral">{item.breakFreshness}</StateMark> : null}
                        </div>
                      </div>
                      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums text-[var(--text-secondary)]">
                        <span>{item.tasksCompleted} completed</span>
                        <span>{item.progressed ?? 0} progressed</span>
                        <span>{item.deferred ?? 0} deferred</span>
                        <span>{item.carried ?? 0} carried</span>
                        <span>{item.unplanned ?? 0} unplanned</span>
                        <span>{durationLabel(item.observedSeconds)} observed</span>
                        {item.trackedMinutes ? <span>{durationLabel(item.trackedMinutes * 60)} tracked context</span> : null}
                      </p>
                      {item.goal?.text ? <p className="mt-1 text-[12px] leading-5 text-[var(--text-tertiary)]">Goal: {item.goal.text}</p> : null}
                      {item.references.length ? (
                        <p className="mt-1.5 flex flex-wrap gap-3">
                          {item.references.slice(0, 4).map((reference) => (
                            <a key={reference.id} href={reference.target} className="text-[11px] font-semibold text-[var(--text-secondary)] underline-offset-2 transition hover:text-[var(--text-primary)] hover:underline">{reference.label}</a>
                          ))}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={<CalendarRange size={18} />} title="No recorded days in this range" message="Work you log or plan will appear here day by day." />
              )}
            </div>
          </details>

          <p className="text-[11px] leading-5 text-[var(--text-tertiary)]">
            These are descriptive personal signals, not a performance score. Idle activity is never labeled productivity, and activity context never proves task completion.
          </p>
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

function KpiCard({ label, value, detail, delta, attention = false }: { label: string; value: string; detail?: string; delta?: DeltaStat | null; attention?: boolean }) {
  return (
    <div className="rounded-[14px] border p-3.5" style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
        {attention ? <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: "var(--status-warn)" }} /> : null}
        {label}
      </span>
      <strong className="mt-1.5 block text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--text-primary)]">{value}</strong>
      {detail ? <span className="mt-1.5 block text-[10.5px] leading-4 text-[var(--text-tertiary)]">{detail}</span> : null}
      {delta && delta.delta !== 0 ? <DeltaBadge stat={delta} /> : null}
    </div>
  );
}

function DeltaBadge({ stat }: { stat: DeltaStat }) {
  const rising = stat.delta > 0;
  const good = stat.goodDirection === null ? null : rising === stat.goodDirection;
  const color = good === null ? "var(--text-tertiary)" : good ? "var(--status-ok)" : "var(--status-warn)";
  return (
    <span className="mt-1 block text-[10.5px] font-medium tabular-nums" style={{ color }}>
      {rising ? "+" : "−"}{Math.abs(stat.delta)} <span className="text-[var(--text-tertiary)]">vs prior window</span>
    </span>
  );
}

function ReliabilityRow({ label, percent, detail }: { label: string; percent: number | null; detail: string }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-[var(--text-primary)]">{label}</span>
        <span className="text-[12.5px] font-semibold tabular-nums text-[var(--text-primary)]">{percent == null ? "—" : `${percent}%`}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--bg-tertiary)" }} role="img" aria-label={`${label}: ${percent == null ? "not recorded in this range" : `${percent}%`}`}>
        <div className="h-full rounded-full" style={{ width: `${percent ?? 0}%`, background: percent == null ? "transparent" : "var(--accent-deep)" }} />
      </div>
      <span className="text-[11px] leading-4 text-[var(--text-tertiary)]">{detail}</span>
    </div>
  );
}

function AttentionRow({ count, amber = false, children }: { count: number; amber?: boolean; children: ReactNode }) {
  const active = count > 0;
  return (
    <p className="flex items-baseline gap-2.5 text-[12.5px] leading-5 text-[var(--text-secondary)]">
      <span
        aria-hidden
        className="relative top-[-1px] size-1.5 shrink-0 rounded-full"
        style={active ? { background: amber ? "var(--status-warn)" : "var(--text-tertiary)" } : { border: "1px solid var(--border-hot)" }}
      />
      <span>
        <strong className={cx("font-semibold tabular-nums", active ? "" : "text-[var(--text-tertiary)]")} style={active && amber ? { color: "var(--status-warn)" } : { color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}>{count}</strong>{" "}
        <span className={active ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"}>{children}</span>
      </span>
    </p>
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
        className="flex items-end justify-center gap-1"
        style={{ height: 140 }}
        role="img"
        aria-label={`Outcomes completed per day: ${points.map((point) => `${point.label} ${point.outcomes}`).join(", ")}.`}
      >
        {points.map((point, index) => (
          <div key={point.date} className="flex h-full min-w-0 max-w-[84px] flex-1 flex-col justify-end gap-1" title={`${point.label}: ${point.outcomes} outcome${point.outcomes === 1 ? "" : "s"}`}>
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
      <text x="50%" y="47%" textAnchor="middle" style={{ fontSize: 20, fontWeight: 600, fill: "var(--text-primary)" }}>{total}</text>
      <text x="50%" y="62%" textAnchor="middle" style={{ fontSize: 9, fill: "var(--text-tertiary)" }}>items in range</text>
    </svg>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-[11.5px] font-semibold text-[var(--text-secondary)]">{title}</h3>
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
