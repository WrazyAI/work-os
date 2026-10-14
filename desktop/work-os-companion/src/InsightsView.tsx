import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, ChevronRight, Fingerprint, Gauge, Inbox, Layers, MessageSquareText, Target } from "lucide-react";
import { apiRequest } from "./api";
import { formatWorkOsDate, formatWorkOsDateTime } from "./dateFormat";
import { useNotifications } from "./NotificationFlyouts";
import { Empty, PageIntro } from "./SharedUi";
import { InsightSynthesisCard, type InsightSynthesisState } from "./InsightSynthesis";
import { consistencyChips, durationLabel, flowBreakdown, heatmapCells, insightRangeSummary, insightSeries, minutesLabel, onTimeRate, periodDeltas, updateKindBreakdown } from "./insights";
import { ActivityDonut, ConsistencyChips, DailyRhythmStrip, FlowStages, HeatmapGrid, KpiCard, PlanReliability, TrackedBars, TrendChart, UpdateKindChart, type ReliabilityRow } from "./InsightCharts";
import { ScrollFadeRegion } from "./ScrollFadeRegion";
import { InsightsSkeleton } from "./LoadingUi";
import type { InsightDay, InsightsData } from "./types";
import "./insight-dashboard.css";

/** The employee Insights page (design §4.3): outcomes, plan reliability,
 * updates, evidence, and Worktivity context stay separate — the record is not
 * a score. Extracted from App so the view can be previewed and rendered-
 * tested on its own while App keeps the data wiring. */

const sentence = (value: string) => value.replaceAll("_", " ").replace(/^./, (char) => char.toUpperCase());

export function PersonalInsights({ data, loading, range, onRange, onReference, onCorrect }: { data: InsightsData | null; loading: boolean; range: "day" | "7d" | "30d"; onRange: (value: "day" | "7d" | "30d") => void; onReference: (reference: InsightDay["references"][number]) => void; onCorrect: (quality: NonNullable<InsightDay["sessionQuality"]>, date: string) => void }) {
  const notifications = useNotifications();
  const [synthesis, setSynthesis] = useState<InsightSynthesisState | null>(null);
  const liveInsights = new URLSearchParams(window.location.search).has("liveinsights");
  const synthesize = () => {
    if (!data || synthesis?.status === "loading") return;
    setSynthesis({ status: "loading" });
    apiRequest<{ synthesis: string; mode?: "ai" | "evidence" }>("/api/work-os/me/insights/synthesize", {
      method: "POST", body: JSON.stringify({ range, through: data.through }),
    }).then((result) => setSynthesis(result.synthesis ? { status: "ready", text: String(result.synthesis), mode: result.mode } : { status: "failed" }))
      .catch(() => {
        setSynthesis({ status: "failed" });
        notifications.info("The assistant is unavailable — the deterministic brief below stands as-is.", "Synthesis unavailable");
      });
  };
  const latest = data?.days.at(-1);
  const activityTotals = (() => {
    const byApp = new Map<string, number>();
    let trackedMinutes = 0;
    for (const day of data?.days ?? []) {
      trackedMinutes += day.trackedMinutes ?? 0;
      for (const app of day.topApps ?? []) byApp.set(app.name, (byApp.get(app.name) ?? 0) + app.minutes);
    }
    return { trackedMinutes, topApps: [...byApp.entries()].map(([name, minutes]) => ({ name, minutes })).sort((left, right) => right.minutes - left.minutes).slice(0, 5) };
  })();
  const staleAt = data?.freshness.staleAt ?? null;
  const correctionMessage = latest?.sessionQuality?.status === "needs_correction"
    ? latest.sessionQuality.message || "This session needs correction before duration can be reported."
    : null;
  useEffect(() => {
    if (!data?.freshness.stale) return;
    notifications.persistent("insights-stale-data", `Retained insight data is stale${staleAt ? ` as of ${formatWorkOsDateTime(staleAt)}` : ""}. Refresh is pending.`, "Insights refresh pending", "info");
  }, [data?.freshness.stale, notifications, staleAt]);
  useEffect(() => {
    if (!correctionMessage) return;
    notifications.persistent("insights-session-correction", correctionMessage, "Session needs correction", "error");
  }, [correctionMessage, notifications]);

  const rangeLabel = range === "day" ? "this day" : range === "7d" ? "these 7 days" : "these 30 days";
  const series = useMemo(() => (data ? insightSeries(data.days) : []), [data]);
  const rangeSummary = useMemo(() => (data ? insightRangeSummary(data) : null), [data]);
  const updateSlices = useMemo(() => (data ? updateKindBreakdown(data.updateKinds ?? data.days) : []), [data]);
  const timing = useMemo(() => (data ? onTimeRate(data.days) : null), [data]);
  const heatmap = useMemo(() => (data ? heatmapCells(data.days) : []), [data]);
  const chips = useMemo(() => (data ? consistencyChips(data.consistency, data.days) : []), [data]);
  const flow = useMemo(() => (data ? flowBreakdown(data.days) : []), [data]);
  const deltas = useMemo(() => (data ? periodDeltas(data.totals, data.comparison?.totals) : []), [data]);
  // Comparison pills only render when the response actually carries an equal
  // earlier period; a missing comparison must never read as a drop against zero.
  const comparisonAvailable = Boolean(data?.comparison?.days?.length);
  const pillFor = (key: string) => (comparisonAvailable ? deltas.find((stat) => stat.key === key) ?? null : null);
  const hasRecord = !!data?.days.some((day) => day.observedSeconds > 0 || day.tasksCompleted > 0 || day.updates > 0 || day.outputEvidence > 0 || (day.trackedMinutes ?? 0) > 0);
  const blockedTotal = updateSlices.find((slice) => slice.key === "blocked")?.value ?? 0;
  const pausedTotal = data ? data.totals.pausedSeconds : 0;
  const observedTotal = data ? data.totals.observedSeconds : 0;
  const pauseShare = observedTotal + pausedTotal > 0 ? Math.round((pausedTotal / (observedTotal + pausedTotal)) * 100) : null;
  const githubSource = data?.evidenceSources?.find((source) => source.provider === "github") ?? null;
  const carryOverCount = rangeSummary?.closingCarryOver ?? 0;
  const overdueCount = rangeSummary?.closingOverdue ?? 0;
  const dayCount = data?.days.length ?? 0;
  const recordedDays = rangeSummary?.recordedDays ?? 0;
  const plannedDays = data ? data.days.filter((day) => day.planStatus === "confirmed" || day.planStatus === "closed").length : 0;
  const daysWithUpdate = data?.consistency?.daysWithUpdate ?? (data ? data.days.filter((day) => Number(day.updates ?? 0) > 0).length : 0);
  const ratio = (part: number, of: number) => (of > 0 ? Math.round((part / of) * 100) : null);
  const reliabilityRows: ReliabilityRow[] = [
    {
      key: "on-time",
      label: "Outcomes on time",
      percent: timing?.percent ?? null,
      detail: timing && timing.total > 0 ? `${timing.onTime} on time · ${timing.late} late` : "No outcomes with a due date in this range",
    },
    { key: "update-coverage", label: "Days with an update", percent: ratio(daysWithUpdate, dayCount), detail: `${daysWithUpdate} of ${dayCount} day${dayCount === 1 ? "" : "s"} with a substantive update` },
    {
      key: "recorded-days",
      label: "Days recorded",
      percent: ratio(recordedDays, dayCount),
      detail: `${recordedDays} of ${dayCount} day${dayCount === 1 ? "" : "s"} with observed time${recordedDays > 0 && rangeSummary ? ` · ${durationLabel(rangeSummary.averageObservedSeconds)} average` : ""}`,
    },
  ];
  const carryOverDelta = comparisonAvailable && rangeSummary
    ? { key: "carried", label: "Carry-over", current: carryOverCount, previous: carryOverCount - rangeSummary.carryOverDelta, delta: rangeSummary.carryOverDelta, unit: "count" as const, goodDirection: false }
    : null;
  const hasUpdateChart = updateSlices.some((slice) => slice.value > 0);

  return <main className="page insights-page">
    <div className="insights-heading">
      <PageIntro eyebrow="Personal insights" title="Your work, without the noise." body="Outcomes, plan reliability, updates, evidence, and Worktivity context stay separate so the story is useful without becoming a score." />
      <div className="range-switch" aria-label="Insight range">{(["day", "7d", "30d"] as const).map((value) => <button className={range === value ? "active" : ""} key={value} aria-pressed={range === value} onClick={() => onRange(value)}>{value === "day" ? "Today" : value}</button>)}</div>
    </div>

    {loading && !data ? <section className="panel"><InsightsSkeleton /></section> : data ? <>
      <div className="insight-summary" aria-label="Range and sources">
        <strong>{formatWorkOsDate(data.from)} → {formatWorkOsDate(data.through)}</strong>
        {data.totals.planned > 0
          ? <span>{data.totals.plannedCompleted} of {data.totals.planned} planned commitments landed</span>
          : <span>No planned commitments were recorded in this range</span>}
        <span className="insight-summary-status">
          {data.freshness.stale
            ? <em className="stale">Nifty sync delayed{staleAt ? " · " + formatWorkOsDateTime(staleAt) : ""}</em>
            : <em>Nifty updated {data.freshness.niftySyncedAt ? formatWorkOsDateTime(data.freshness.niftySyncedAt) : "—"}</em>}
          <em>Worktivity {data.freshness.worktivityObservedAt ? "observed " + formatWorkOsDateTime(data.freshness.worktivityObservedAt) : "not observed"}</em>
        </span>
      </div>

      <div className="insight-kpi-strip" aria-label={`Key measurements for ${rangeLabel}`}>
        <KpiCard label="Outcomes completed" value={String(data.totals.tasksCompleted)} delta={pillFor("tasksCompleted")} spark={series.map((point) => point.outcomes)} sparkLabel={`Completed outcomes per day for ${rangeLabel}`} />
        <KpiCard label="Commitment rate" value={rangeSummary?.commitmentRate != null ? `${rangeSummary.commitmentRate}%` : "—"} delta={pillFor("plannedCompleted")} detail="No planned commitments in this range" />
        <KpiCard label="Updates recorded" value={String(data.totals.updates)} delta={pillFor("updates")} spark={series.map((point) => point.updates)} sparkLabel={`Recorded updates per day for ${rangeLabel}`} />
        <KpiCard label="Observed context" value={durationLabel(data.totals.observedSeconds)} delta={pillFor("observedMinutes")} spark={series.map((point) => point.observedMinutes)} sparkLabel={`Observed minutes per day for ${rangeLabel}`} />
        <KpiCard label="Closing carry-over" value={String(carryOverCount)} delta={carryOverDelta} attention={carryOverCount > 0} detail="Nothing carried at the close" />
      </div>
      {!hasRecord ? <p className="insight-empty-note">No work record is stored for {rangeLabel} yet. Goals, updates, task outcomes, and evidence will appear here as they are recorded.</p> : null}

      <InsightSynthesisCard state={synthesis} onSynthesize={synthesize} />

      <section className="panel insight-primary-chart">
        <div className="card-title"><span><Gauge size={17} /> {range === "7d" ? "Weekly rhythm" : "Workday trend"}</span><small>{range === "7d" ? "Daily outcomes with planned-commitment completion" : "Observed time and planned commitments · separate scales"}</small></div>
        {range === "7d" && series.length
          ? <DailyRhythmStrip points={series} rangeLabel={rangeLabel} />
          : series.length >= 2
            ? <TrendChart points={series} rangeLabel={rangeLabel} />
            : <p className="insight-empty-note">A trend needs at least two recorded days. Switch to 7 days or 30 days for comparison.</p>}
      </section>

      <div className="insight-band">
        <section className="panel insight-reliability">
          <div className="card-title"><span><Target size={17} /> Plan reliability</span><small>Recorded ratios from this range</small></div>
          <PlanReliability rows={reliabilityRows} />
          <p className="insight-reliability-note">Undated work is never classified either way.</p>
        </section>
        <section className="panel insight-mix">
          <div className="card-title"><span><Layers size={17} /> Record mix</span><small>How this range&apos;s recorded items split — a composition, not a sequence</small></div>
          <FlowStages slices={flow} ariaLabel={`Record mix for ${rangeLabel}: ${flow.map((slice) => `${slice.label} ${slice.value}`).join(", ")}`} />
        </section>
      </div>

      <div className="insight-band insight-band-second">
        <section className="panel insight-attention-panel">
          <div className="card-title"><span><AlertTriangle size={17} /> Needs attention</span><small>Closing state, not accumulated snapshots</small></div>
          <div className="insight-attention-list">
            <p className={carryOverCount > 0 ? "active amber" : undefined}><strong>{carryOverCount}</strong><span>carried items still open at the end of the range</span></p>
            <p className={overdueCount > 0 ? "active" : undefined}><strong>{overdueCount}</strong><span>overdue items in the latest day</span></p>
            <p className={blockedTotal > 0 ? "active amber" : undefined}><strong>{blockedTotal}</strong><span>blocker{blockedTotal === 1 ? "" : "s"} raised through recorded updates</span></p>
            {data.consistency && data.consistency.daysWithUpdate === 0 ? <p className="attention-copy"><span>No substantive updates were recorded in this range.</span></p> : null}
            {data.brief.nextFocus[0] ? <p className="attention-next"><span>Next focus</span><b>{data.brief.nextFocus[0]}</b></p> : null}
          </div>
        </section>
        <section className="panel insight-rhythm">
          <div className="card-title"><span><CalendarDays size={17} /> Work rhythm</span><small>{pauseShare === null ? "Goals, updates, outcomes, and closing streak" : "Paused share " + pauseShare + "% of observed+paused time"}</small></div>
          <div className="insight-rhythm-layout">
            {range === "30d" ? <div className="split-chart"><HeatmapGrid cells={heatmap} rangeLabel={rangeLabel} /></div> : null}
            <div className="split-data">
              {chips.length ? <ConsistencyChips chips={chips} /> : <p className="insight-empty-note">No rhythm signals were recorded in this range yet.</p>}
            </div>
          </div>
        </section>
      </div>

      <div className={`insight-band insight-band-evidence${hasUpdateChart ? "" : " insight-band-single"}`}>
        <section className="panel insight-evidence-context">
          <div className="card-title"><span><Fingerprint size={17} /> Evidence &amp; context</span><small>Source health and neutral activity context</small></div>
          <div className="insight-source-grid">
            <div><strong>Nifty</strong><span>{data.freshness.stale ? "Sync delayed" : "Synced"}{data.freshness.niftySyncedAt ? " · " + formatWorkOsDateTime(data.freshness.niftySyncedAt) : ""}</span></div>
            <div><strong>Worktivity</strong><span>{data.freshness.worktivityObservedAt ? "Observed · " + formatWorkOsDateTime(data.freshness.worktivityObservedAt) : "No observation in range"}</span></div>
            <div><strong>GitHub</strong><span>{githubSource?.connected ? !githubSource.enabled ? "Connected · evidence disabled" : githubSource.verifiedForPerson ? githubSource.evidenceCount + " evidence item" + (githubSource.evidenceCount === 1 ? "" : "s") + " · verified account" : "Connected · employee account not verified" : "Not connected"}</span></div>
            <div><strong>Output evidence</strong><span>{data.totals.outputEvidence} linked artifact{data.totals.outputEvidence === 1 ? "" : "s"} or record{data.totals.outputEvidence === 1 ? "" : "s"}</span></div>
          </div>
          {activityTotals.trackedMinutes > 0 ? <div className="insight-activity-inline">
            <div className="activity-distribution">
              <p className="split-chart-title">App &amp; site distribution</p>
              <ActivityDonut
                ariaLabel={"Tracked app and site distribution for " + rangeLabel}
                items={activityTotals.topApps}
                total={activityTotals.trackedMinutes}
              />
              <p className="activity-provenance">Observed app and site usage is neutral context. It is not a productivity score and never proves task completion.</p>
            </div>
            <div className="split-chart">
              <p className="split-chart-title">Tracked minutes per day</p>
              <TrackedBars points={series} rangeLabel={rangeLabel} />
            </div>
          </div> : null}
        </section>
        {hasUpdateChart ? <section className="panel insight-updates">
          <div className="card-title"><span><MessageSquareText size={17} /> Recorded updates</span><small>{blockedTotal > 0 ? blockedTotal + " blocker" + (blockedTotal === 1 ? "" : "s") + " raised" : "No blockers raised"}</small></div>
          <UpdateKindChart slices={updateSlices} />
          <p className="activity-provenance">Update kinds come from the employee&apos;s own recorded updates. Blockers and priority changes remain separate.</p>
        </section> : null}
      </div>

      <details className="panel insight-detail-disclosure">
        <summary><span>View daily breakdown</span><small>Exact values, linked records, and provenance</small><ChevronRight size={16} /></summary>
        <div className="insight-detail-body">
          <ScrollFadeRegion label="Exact personal insight values" maxHeight={360} scrollAxis="both" className="insight-table-wrap">
            <table>
              <caption>Exact personal insight values · {formatWorkOsDate(data.from)} → {formatWorkOsDate(data.through)}</caption>
              <thead>
                <tr><th>Date</th><th>Observed</th><th>Paused</th><th>Commitments</th><th>Outcomes</th><th>On time</th><th>Late</th><th>Updates</th><th>Blockers</th><th>Tracked</th><th>Output evidence</th><th>Session quality</th></tr>
              </thead>
              <tbody>
                {data.days.map((day) => <tr key={day.date}>
                  <th scope="row">{formatWorkOsDate(day.date)}</th>
                  <td data-label="Observed">{durationLabel(day.observedSeconds)}</td>
                  <td data-label="Paused">{durationLabel(day.pausedSeconds)}</td>
                  <td data-label="Commitments">{day.plannedCompleted}/{day.planned}</td>
                  <td data-label="Outcomes">{day.tasksCompleted}</td>
                  <td data-label="On time">{day.outcomesOnTime ?? 0}</td>
                  <td data-label="Late">{(day.outcomesLate ?? 0) > 0 ? day.outcomesLate : "—"}</td>
                  <td data-label="Updates">{day.updates}</td>
                  <td data-label="Blockers">{(day.updatesByKind?.blocked ?? 0) > 0 ? day.updatesByKind!.blocked : "—"}</td>
                  <td data-label="Tracked">{day.trackedMinutes ? day.trackedMinutes + "m" : "—"}</td>
                  <td data-label="Output evidence">{day.outputEvidence}</td>
                  <td data-label="Session quality">{day.sessionQuality?.status === "needs_correction" ? <button onClick={() => onCorrect(day.sessionQuality!, day.date)}>Needs correction</button> : sentence(day.sessionQuality?.status ?? "none")}</td>
                </tr>)}
              </tbody>
            </table>
          </ScrollFadeRegion>
          <section className="insight-drilldown-flat">
            <div className="card-title"><span><Inbox size={17} /> Latest-day record</span><small>{formatWorkOsDate(latest?.date)}</small></div>
            {latest?.references?.length
              ? <ScrollFadeRegion label="Latest-day linked records" maxHeight={320}>
                  <div className="drilldown-list">{(latest.references ?? []).map((reference) => <button key={[reference.type, reference.id].join(":")} onClick={() => onReference(reference)}><span>{reference.type === "plan" ? "Daily workspace" : sentence(reference.type)}</span><strong>{reference.label}</strong><ChevronRight size={15} /></button>)}</div>
                </ScrollFadeRegion>
              : <Empty title="No linked records" body="This day has no daily goal, task completion, substantive update, or evidence record yet." />}
          </section>
        </div>
      </details>

      <p className="insight-disclaimer">These are descriptive personal signals, not a performance score. Idle activity is never labeled productivity, and activity context never proves task completion.</p>
    </> : <section className="panel"><Empty title="Insights unavailable" body="Refresh to retry the personal insights record." /></section>}
  </main>;
}
