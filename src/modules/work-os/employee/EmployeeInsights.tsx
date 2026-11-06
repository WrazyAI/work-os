"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { SyncChip } from "./ui";
import styles from "./EmployeeInsights.module.css";

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
  const { day, sync, syncing } = useEmployeeDay();
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
  // A range with no recorded plan, outcome, update, observation, or evidence
  // is an invitation to begin, not a dashboard of zeros (design §9).
  const hasRecordedWork = Boolean(data) && (
    Number(data?.totals.tasksCompleted ?? 0) > 0 ||
    Number(data?.totals.updates ?? 0) > 0 ||
    Number(data?.totals.observedSeconds ?? 0) > 0 ||
    Number(data?.totals.outputEvidence ?? 0) > 0 ||
    Number(data?.totals.planned ?? 0) > 0 ||
    days.some((item) => Boolean(item.goal?.text?.trim()))
  );

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div className={styles.metaRow}><span>{through ? longDateLabel(through) : "Loading your record"}</span></div>
        <div className={styles.titleRow}>
          <h1>Your record</h1>
          <p className={styles.titleMeta}>Outcomes, plan reliability, updates, evidence, and Worktivity context stay separate — the record is not a score.</p>
          <div className={styles.utilities}>
            <nav className={styles.segmented} aria-label="Insight range">
              {RANGES.map((item) => {
                const active = range === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "true" : undefined}
                    onClick={() => setRange(item.id)}
                    className={`${styles.segment} ${active ? styles.segmentActive : ""}`}
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
              className={styles.dateField}
            />
            <SyncChip compact sync={day.data?.niftySync} syncing={syncing || insights.isFetching} onSync={() => sync.mutate()} />
          </div>
        </div>
      </header>

      {error ? <div className={`${styles.notice} ${styles.noticeErr}`}>{(error as Error).message}</div> : null}

      {data?.freshness.stale ? (
        <div className={`${styles.notice} ${styles.noticeWarn}`}>
          Retained data is stale{data.freshness.staleAt ? ` since ${new Date(data.freshness.staleAt).toLocaleString()}` : ""}. {data.freshness.error || "Refresh is pending."}
        </div>
      ) : null}

      {insights.isLoading && !data ? (
        <div aria-busy="true">
          <div className={styles.skeletonKpis}>{[0, 1, 2, 3, 4].map((key) => <div key={key} className={styles.skeletonKpi} />)}</div>
          <div className="mt-5 grid gap-3">
            <div className={styles.skeleton} style={{ width: "38%" }} />
            <div className={styles.skeleton} style={{ width: "72%" }} />
            <div className={styles.skeleton} style={{ width: "54%" }} />
          </div>
        </div>
      ) : data ? (
        <>
          <div className={styles.rangeLine}>
            <span><strong>{calendarDateLabel(data.from)} → {calendarDateLabel(data.through)}</strong></span>
            <span>
              {Number(data.totals.planned ?? 0) > 0
                ? `${data.totals.plannedCompleted} of ${data.totals.planned} planned commitments landed`
                : "No planned commitments were recorded in this range"}
            </span>
            <span>Worktivity {data.freshness.worktivityObservedAt ? `observed ${formatDateTimeShort(data.freshness.worktivityObservedAt)}` : "not observed"}</span>
          </div>

          {hasRecordedWork ? <>
          <section className={`${styles.kpis} ${styles.reveal}`} style={{ "--delay": "60ms" } as CSSProperties} aria-label="Range facts">
            <Kpi label="Outcomes completed" value={String(data.totals.tasksCompleted)} delta={pillFor("tasksCompleted")} />
            <Kpi
              label="Commitment rate"
              value={rangeSummary?.commitmentRate != null ? `${rangeSummary.commitmentRate}%` : "—"}
              detail={rangeSummary?.commitmentRate != null ? `${data.totals.plannedCompleted} of ${data.totals.planned} planned` : "No planned commitments in this range"}
            />
            <Kpi label="Updates recorded" value={String(data.totals.updates)} delta={pillFor("updates")} />
            <Kpi label="Observed context" value={durationLabel(Number(data.totals.observedSeconds ?? 0))} delta={pillFor("observedMinutes")} />
            <Kpi
              label="Closing carry-over"
              value={String(closingCarryOver)}
              attention={closingCarryOver > 0}
              detail={closingCarryOver > 0 ? "Still open at the close" : "Nothing carried at the close"}
            />
          </section>

          <section className={`${styles.section} ${styles.synthesis} ${styles.reveal}`} style={{ "--delay": "120ms" } as CSSProperties} aria-labelledby="insights-synthesis-title">
            <header className={styles.sectionHead}>
              <div>
                <h2 id="insights-synthesis-title">AI synthesis</h2>
                <p className={styles.sectionMeta}>
                  {synthesis?.status === "ready" ? "A grounded read of this range." : "A short grounded read generated from the verified range facts."}
                </p>
              </div>
              <div className={styles.sectionAction}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={!data || synthesize.isPending}
                  onClick={() => synthesize.mutate({ range, through: insights.data?.through ?? through })}
                >
                  {synthesize.isPending ? "Synthesizing…" : synthesis?.status === "ready" ? "Re-synthesize" : "Synthesize with AI"}
                </button>
              </div>
            </header>
            <div className={styles.synthesisBody}>
              {synthesis?.status === "ready" ? (
                <>
                  <p className={styles.synthesisText}>{synthesis.text}</p>
                  {synthesis.mode === "evidence" ? (
                    <p className={styles.synthesisNote}>The assistant&apos;s draft could not be verified — showing the exact fact record instead.</p>
                  ) : null}
                </>
              ) : synthesis?.status === "failed" ? (
                <p className={styles.synthesisNote}>The assistant is unavailable — the verified range facts and exact daily values remain available below.</p>
              ) : (
                <p className={styles.synthesisNote}>Adds short grounded paragraphs from the verified range facts. Every figure is checked against the record, and no productivity score is generated.</p>
              )}
            </div>
          </section>

          <section className={`${styles.section} ${styles.brief} ${styles.reveal}`} style={{ "--delay": "170ms" } as CSSProperties} aria-labelledby="insights-brief-title">
            <header className={styles.sectionHead}>
              <div>
                <h2 id="insights-brief-title">Brief</h2>
                <p className={styles.sectionMeta}>{calendarDateLabel(data.from)} – {calendarDateLabel(data.through)} · generated from the same record you see below.</p>
              </div>
            </header>
            <div className={styles.briefGrid}>
              <p className={styles.briefSummary}>{data.brief.summary || "No insight record is available for this range."}</p>
              <div className={styles.briefLists}>
                <BriefList title="Wins" items={data.brief.wins} />
                <BriefList title="Attention" items={data.brief.attention} />
                <BriefList title="Next focus" items={data.brief.nextFocus} />
              </div>
            </div>
          </section>

          <section className={`${styles.section} ${styles.chartSection} ${styles.reveal}`} style={{ "--delay": "220ms" } as CSSProperties} aria-labelledby="insights-chart-title">
            <header className={styles.sectionHead}>
              <div>
                <h2 id="insights-chart-title">Outcomes by day</h2>
                <p className={styles.sectionMeta}>Completed outcomes across {rangeLabel}. Bars are exact counts; the brief above explains the narrative.</p>
              </div>
            </header>
            <div className={styles.chartWrap}>
              <DayBars points={series} />
              <div className={styles.chartStats}>
                <span>Most observed day: {summary.peak ? `${summary.peak.label} · ${summary.peak.observedMinutes} min observed` : "—"}</span>
                <span>Recorded days: {summary.recordedDays}</span>
                <span>Average plan completion: {Number(data.totals.planned ?? 0) > 0 && summary.averageCompletionPercent != null ? `${summary.averageCompletionPercent}%` : "—"}</span>
              </div>
              <p className={styles.chartNote}>Completed outcomes per day · unit: outcomes · values appear above non-zero bars for 14 or fewer days; hover any bar for its exact count.</p>
            </div>
          </section>

          <div className={`${styles.duo} ${styles.reveal}`} style={{ "--delay": "270ms" } as CSSProperties}>
            <section className={styles.section} aria-labelledby="insights-reliability-title">
              <header className={styles.sectionHead}>
                <div>
                  <h2 id="insights-reliability-title">Plan reliability</h2>
                  <p className={styles.sectionMeta}>Recorded ratios from this range.</p>
                </div>
              </header>
              <div className={styles.reliability}>
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
                <p className={styles.relNote}>Undated work is never classified either way.</p>
              </div>
            </section>

            <section className={styles.section} aria-labelledby="insights-mix-title">
              <header className={styles.sectionHead}>
                <div>
                  <h2 id="insights-mix-title">Record mix</h2>
                  <p className={styles.sectionMeta}>How this range&apos;s recorded items split — a composition, not a sequence.</p>
                </div>
              </header>
              <div className={styles.mix}>
                <FlowDonut slices={flow} />
                <div className={styles.legend}>
                  {flow.map((slice) => (
                    <div key={slice.key} className={styles.legendRow}>
                      <span className={styles.legendLabel}>
                        <span aria-hidden className={styles.legendDot} style={{ background: FLOW_COLORS[slice.key] }} />
                        {slice.label}
                      </span>
                      <span className={styles.legendValue}>
                        {slice.value} <span className={styles.legendShare}>({sharePercent(slice.value, flow.reduce((sum, item) => sum + item.value, 0))}%)</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {activeKinds.length ? (
                <div className={styles.updateMix}>
                  <span>Update mix</span>
                  {activeKinds.map((kind) => (
                    <span key={String(kind.key)}>{kind.label} <strong>{kind.value}</strong></span>
                  ))}
                </div>
              ) : null}
            </section>
          </div>

          <div className={`${styles.duo} ${styles.duoEven} ${styles.reveal}`} style={{ "--delay": "310ms" } as CSSProperties}>
            <section className={styles.section} aria-labelledby="insights-attention-title">
              <header className={styles.sectionHead}>
                <div>
                  <h2 id="insights-attention-title">Needs attention</h2>
                  <p className={styles.sectionMeta}>Closing state, not accumulated snapshots.</p>
                </div>
              </header>
              <div className={styles.attentionRows}>
                <AttentionRow count={closingCarryOver} amber>carried item{closingCarryOver === 1 ? "" : "s"} still open at the end of the range</AttentionRow>
                <AttentionRow count={closingOverdue}>overdue item{closingOverdue === 1 ? "" : "s"} in the latest day</AttentionRow>
                <AttentionRow count={blockers} amber>blocker{blockers === 1 ? "" : "s"} raised through recorded updates</AttentionRow>
                {data.brief.nextFocus[0] ? (
                  <p className={styles.nextFocus}>
                    <span className={styles.nextFocusLabel}>Next focus</span>
                    <strong>{data.brief.nextFocus[0]}</strong>
                  </p>
                ) : null}
              </div>
            </section>

            <section className={styles.section} aria-labelledby="insights-rhythm-title">
              <header className={styles.sectionHead}>
                <div>
                  <h2 id="insights-rhythm-title">Work rhythm</h2>
                  <p className={styles.sectionMeta}>Goals, updates, outcomes, and the closing streak.</p>
                </div>
              </header>
              <div className={styles.rhythm}>
                {chips.length ? (
                  chips.map((chip) => (
                    <div key={chip.key} className={styles.rhythmFact}>
                      <span className={styles.rhythmLabel}>{chip.label}</span>
                      <span className={styles.rhythmValue}>{chip.value}</span>
                      {chip.detail ? <span className={styles.rhythmDetail}>{chip.detail}</span> : null}
                    </div>
                  ))
                ) : (
                  <p className={styles.emptyCopy}>No rhythm signals were recorded in this range yet.</p>
                )}
              </div>
            </section>
          </div>

          {/* Exact daily values stay behind the disclosure (design §4.5) */}
          <details className={styles.details}>
            <summary>
              <span className={styles.detailsTitle}>View daily breakdown</span>
              <span className={styles.detailsMeta}>{dayCount} day{dayCount === 1 ? "" : "s"} in this range · newest first</span>
            </summary>
            {days.length ? (
              <ul className={styles.dailyRows}>
                {[...days].reverse().map((item) => (
                  <li key={item.date} className={styles.dailyRow}>
                    <div className={styles.dailyTop}>
                      <button type="button" onClick={() => setThrough(item.date)} className={styles.dailyDate}>
                        {longDateLabel(item.date)}
                      </button>
                      <div className={styles.dailyTags}>
                        {item.sessionQuality?.message ? <span className={`${styles.dailyTag} ${styles.dailyTagWarn}`}>{item.sessionQuality.message}</span> : null}
                        {item.breakFreshness ? <span className={styles.dailyTag}>{item.breakFreshness}</span> : null}
                      </div>
                    </div>
                    <p className={styles.dailyFacts}>
                      <span>{item.tasksCompleted} completed</span>
                      <span>{item.progressed ?? 0} progressed</span>
                      <span>{item.deferred ?? 0} deferred</span>
                      <span>{item.carried ?? 0} carried</span>
                      <span>{item.unplanned ?? 0} unplanned</span>
                      <span>{durationLabel(item.observedSeconds)} observed</span>
                      {item.trackedMinutes ? <span>{durationLabel(item.trackedMinutes * 60)} tracked context</span> : null}
                    </p>
                    {item.goal?.text ? <p className={styles.dailyGoal}>Goal: {item.goal.text}</p> : null}
                    {item.references.length ? (
                      <p className={styles.dailyRefs}>
                        {item.references.slice(0, 4).map((reference) => (
                          <a key={reference.id} href={reference.target}>{reference.label}</a>
                        ))}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className={styles.empty}>
                <strong className={styles.emptyTitle}>No recorded days in this range</strong>
                <p className={styles.emptyCopy}>Work you log or plan will appear here day by day.</p>
              </div>
            )}
          </details>

          <p className={styles.footnote}>
            These are descriptive personal signals, not a performance score. Idle activity is never labeled productivity, and activity context never proves task completion.
          </p>
          </> : (
            <section className={styles.insightsEmpty} aria-labelledby="insights-empty-title">
              <h2 id="insights-empty-title">No work recorded in this range</h2>
              <p>Goals, updates, completed tasks, evidence, and observed time will appear here as you record them. Activity alone never becomes an outcome.</p>
              <div className={styles.emptyActions}>
                <Link className={styles.primaryButton} href="/work-os/today">Open today</Link>
                <Link className={styles.secondaryButton} href="/work-os/tasks">View tasks</Link>
              </div>
            </section>
          )}
        </>
      ) : (
        <div className={styles.empty}>
          <strong className={styles.emptyTitle}>Insights could not be loaded</strong>
          <p className={styles.emptyCopy}>{(insights.error as Error)?.message}</p>
          <button type="button" className={styles.secondaryButton} onClick={() => void insights.refetch()}>Try again</button>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, detail, delta, attention = false }: { label: string; value: string; detail?: string; delta?: DeltaStat | null; attention?: boolean }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>
        {attention ? <span aria-hidden className={styles.kpiDot} /> : null}
        {label}
      </span>
      <strong className={styles.kpiValue}>{value}</strong>
      {detail ? <span className={styles.kpiDetail}>{detail}</span> : null}
      {delta && delta.delta !== 0 ? <DeltaBadge stat={delta} /> : null}
    </div>
  );
}

function DeltaBadge({ stat }: { stat: DeltaStat }) {
  const rising = stat.delta > 0;
  const good = stat.goodDirection === null ? null : rising === stat.goodDirection;
  const color = good === null ? "var(--text-tertiary)" : good ? "var(--status-ok)" : "var(--status-warn)";
  return (
    <span className={styles.kpiDelta} style={{ color }}>
      {rising ? "+" : "−"}{Math.abs(stat.delta)} <span style={{ color: "var(--text-tertiary)" }}>vs prior window</span>
    </span>
  );
}

function ReliabilityRow({ label, percent, detail }: { label: string; percent: number | null; detail: string }) {
  return (
    <div className={styles.relRow}>
      <div className={styles.relTop}>
        <span className={styles.relLabel}>{label}</span>
        <span className={styles.relValue}>{percent == null ? "—" : `${percent}%`}</span>
      </div>
      <div className={styles.relTrack} role="img" aria-label={`${label}: ${percent == null ? "not recorded in this range" : `${percent}%`}`}>
        <div className={styles.relFill} style={{ width: `${percent ?? 0}%`, background: percent == null ? "transparent" : "var(--accent-deep)" }} />
      </div>
      <span className={styles.relDetail}>{detail}</span>
    </div>
  );
}

function AttentionRow({ count, amber = false, children }: { count: number; amber?: boolean; children: ReactNode }) {
  const active = count > 0;
  return (
    <p className={`${styles.attentionRow} ${active ? styles.attentionRowActive : ""}`}>
      <span
        aria-hidden
        className={`${styles.attentionDot} ${active ? (amber ? styles.attentionDotAmber : styles.attentionDotActive) : ""}`}
      />
      <span>
        <strong className={styles.attentionCount}>{count}</strong>{" "}
        <span>{children}</span>
      </span>
    </p>
  );
}

/** Exact-count bars. Undated or zero days render as a quiet baseline with no
 * implied value, and the exact numbers live in the accessible label. */
function DayBars({ points }: { points: InsightSeriesPoint[] }) {
  if (!points.length) return <p className={styles.chartEmpty}>No days in this range.</p>;
  if (!points.some((point) => point.outcomes > 0)) {
    return <p className={styles.chartEmpty}>No completed outcomes were recorded in this range. The daily record is still available below.</p>;
  }
  const width = 720;
  const height = 190;
  const left = 36;
  const right = 10;
  const top = 18;
  const bottom = 30;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const max = Math.max(1, ...points.map((point) => point.outcomes));
  const ticks = [...new Set([max, Math.round(max / 2), 0])].sort((a, b) => b - a);
  const y = (value: number) => top + innerH - (value / max) * innerH;
  const slot = innerW / points.length;
  const barWidth = Math.max(3, Math.min(30, slot * 0.55));
  const labelEvery = points.length > 14 ? 5 : points.length > 9 ? 2 : 1;
  const showValues = points.length <= 14;
  return (
    <svg
      className={styles.chart}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Outcomes completed per day: ${points.map((point) => `${point.label} ${point.outcomes}`).join(", ")}.`}
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line className={styles.chartGrid} x1={left} y1={y(tick)} x2={width - right} y2={y(tick)} />
          <text className={styles.chartLabel} x={left - 8} y={y(tick) + 3} textAnchor="end">{tick}</text>
        </g>
      ))}
      {points.map((point, index) => {
        const x = left + index * slot + (slot - barWidth) / 2;
        const barHeight = Math.max(point.outcomes > 0 ? 3 : 2, (point.outcomes / max) * innerH);
        return (
          <g key={point.date}>
            <rect
              className={`${styles.chartBar} ${point.outcomes > 0 ? "" : styles.chartBarZero}`}
              x={x}
              y={top + innerH - barHeight}
              width={barWidth}
              height={barHeight}
              rx={2}
              style={{ animationDelay: `${index * 18}ms` }}
            >
              <title>{point.label}: {point.outcomes} outcome{point.outcomes === 1 ? "" : "s"}</title>
            </rect>
            {showValues && point.outcomes > 0 ? (
              <text className={styles.chartValue} x={x + barWidth / 2} y={top + innerH - barHeight - 5} textAnchor="middle">{point.outcomes}</text>
            ) : null}
            {index % labelEvery === 0 || index === points.length - 1 ? (
              <text className={styles.chartX} x={x + barWidth / 2} y={height - 8} textAnchor="middle">{point.label}</text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

/** SVG donut with a legend that carries the exact numbers — the chart never
 * relies on color alone. */
function FlowDonut({ slices }: { slices: FlowSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  const size = 120;
  const stroke = 14;
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
      <text x="50%" y="47%" textAnchor="middle" style={{ fontSize: 19, fontWeight: 600, fill: "var(--text-primary)" }}>{total}</text>
      <text x="50%" y="62%" textAnchor="middle" style={{ fontSize: 8.5, fill: "var(--text-tertiary)" }}>item{total === 1 ? "" : "s"} in range</text>
    </svg>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className={styles.briefList}>
      <h3>{title}</h3>
      {items.length ? (
        <ul>
          {items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      ) : (
        <p className={styles.briefEmpty}>Nothing to report.</p>
      )}
    </div>
  );
}
