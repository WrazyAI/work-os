import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronRight, Fingerprint, Gauge, Inbox, MessageSquareText, MoveRight } from "lucide-react";
import { apiRequest } from "./api";
import { formatWorkOsDate, formatWorkOsDateTime } from "./dateFormat";
import { useNotifications } from "./NotificationFlyouts";
import { Empty, PageIntro } from "./SharedUi";
import { InsightSynthesisCard, type InsightSynthesisState } from "./InsightSynthesis";
import { consistencyChips, durationLabel, heatmapCells, insightRangeSummary, insightSeries, onTimeRate, periodDeltas, updateKindBreakdown } from "./insights";
import { ActivityDonut, ConsistencyChips, DailyRhythmStrip, DeltaBadge, HeatmapGrid, OnTimeBar, TrackedBars, TrendChart, UpdateKindChart } from "./InsightCharts";
import { ScrollFadeRegion } from "./ScrollFadeRegion";
import { InsightsSkeleton } from "./LoadingUi";
import type { InsightDay, InsightsData } from "./types";

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
  const deltas = useMemo(() => (data ? periodDeltas(data.totals, data.comparison?.totals) : []), [data]);
  const deltaFor = (key: string) => deltas.find((stat) => stat.key === key) ?? null;
  const hasRecord = !!data?.days.some((day) => day.observedSeconds > 0 || day.tasksCompleted > 0 || day.updates > 0 || day.outputEvidence > 0 || (day.trackedMinutes ?? 0) > 0);
  const blockedTotal = updateSlices.find((slice) => slice.key === "blocked")?.value ?? 0;
  const pausedTotal = data ? data.totals.pausedSeconds : 0;
  const observedTotal = data ? data.totals.observedSeconds : 0;
  const pauseShare = observedTotal + pausedTotal > 0 ? Math.round((pausedTotal / (observedTotal + pausedTotal)) * 100) : null;
  const githubSource = data?.evidenceSources?.find((source) => source.provider === "github") ?? null;
  const outcomePerRecordedDay = rangeSummary?.recordedDays ? Math.round((Number(data?.totals.tasksCompleted ?? 0) / rangeSummary.recordedDays) * 10) / 10 : 0;

  return <main className="page insights-page">
    <div className="insights-heading">
      <PageIntro eyebrow="Personal insights" title="Your work, without the noise." body="Outcomes, plan reliability, updates, evidence, and Worktivity context stay separate so the story is useful without becoming a score." />
      <div className="range-switch" aria-label="Insight range">{(["day", "7d", "30d"] as const).map((value) => <button className={range === value ? "active" : ""} key={value} aria-pressed={range === value} onClick={() => onRange(value)}>{value === "day" ? "Today" : value}</button>)}</div>
    </div>

    {loading && !data ? <section className="panel"><InsightsSkeleton /></section> : data ? <>
      <section className="panel insight-hero">
        <header className="insight-hero-head">
          <div>
            <span className="insight-eyebrow">{formatWorkOsDate(data.from)} → {formatWorkOsDate(data.through)}</span>
            <h2>{data.totals.tasksCompleted} outcome{data.totals.tasksCompleted === 1 ? "" : "s"} completed</h2>
            <p>{data.totals.planned > 0
              ? <>{data.totals.plannedCompleted} of {data.totals.planned} planned commitments landed{rangeSummary?.commitmentRate != null ? <> · <strong>{rangeSummary.commitmentRate}%</strong> completion</> : null}.</>
              : <>No planned commitments were recorded in this range.</>}</p>
          </div>
          <div className="insight-source-status">
            {data.freshness.stale
              ? <span className="stale">Nifty sync delayed{staleAt ? " · " + formatWorkOsDateTime(staleAt) : ""}</span>
              : <span>Nifty updated {data.freshness.niftySyncedAt ? formatWorkOsDateTime(data.freshness.niftySyncedAt) : "—"}</span>}
            <span>Worktivity {data.freshness.worktivityObservedAt ? "observed " + formatWorkOsDateTime(data.freshness.worktivityObservedAt) : "not observed"}</span>
          </div>
        </header>
        <div className="insight-hero-stats">
          <div><small>Recorded days</small><strong>{rangeSummary?.recordedDays ?? 0}/{data.days.length}</strong></div>
          <div><small>Avg recorded day</small><strong>{durationLabel(rangeSummary?.averageObservedSeconds ?? 0)}</strong></div>
          <div><small>Outcomes / recorded day</small><strong>{outcomePerRecordedDay || "—"}</strong></div>
          <div><small>Closing carry-over</small><strong>{rangeSummary?.closingCarryOver ?? 0}</strong></div>
        </div>
        {!hasRecord ? <p className="insight-empty-note">No work record is stored for {rangeLabel} yet. Goals, updates, task outcomes, and evidence will appear here as they are recorded.</p> : null}
      </section>

      <InsightSynthesisCard state={synthesis} onSynthesize={synthesize} />

      <div className="insight-decision-grid">
        <section className="panel insight-decision-panel">
          <div className="card-title"><span><MoveRight size={17} /> What changed</span><small>Compared with the equal earlier period</small></div>
          <div className="insight-change-list">
            {deltaFor("plannedCompleted") ? <div><span>Commitment rate</span><DeltaBadge stat={deltaFor("plannedCompleted")!} /></div> : null}
            {deltaFor("tasksCompleted") ? <div><span>Completed outcomes</span><DeltaBadge stat={deltaFor("tasksCompleted")!} /></div> : null}
            {deltaFor("observedMinutes") ? <div><span>Observed context</span><DeltaBadge stat={deltaFor("observedMinutes")!} /></div> : null}
          </div>
        </section>
        <section className="panel insight-decision-panel insight-attention-panel">
          <div className="card-title"><span><AlertTriangle size={17} /> Needs attention</span><small>Closing state, not accumulated snapshots</small></div>
          <div className="insight-attention-list">
            <p><strong>{rangeSummary?.closingCarryOver ?? 0}</strong><span>carried items still open at the end of the range</span></p>
            <p><strong>{rangeSummary?.closingOverdue ?? 0}</strong><span>overdue items in the latest day</span></p>
            <p><strong>{blockedTotal}</strong><span>blocker{blockedTotal === 1 ? "" : "s"} raised through recorded updates</span></p>
            {data.consistency && data.consistency.daysWithUpdate === 0 ? <p className="attention-copy"><span>No substantive updates were recorded in this range.</span></p> : null}
            {data.brief.nextFocus[0] ? <p className="attention-next"><span>Next focus</span><b>{data.brief.nextFocus[0]}</b></p> : null}
          </div>
        </section>
      </div>

      <section className="panel insight-primary-chart">
        <div className="card-title"><span><Gauge size={17} /> {range === "7d" ? "Weekly rhythm" : "Workday trend"}</span><small>{range === "7d" ? "Daily outcomes with planned-commitment completion" : "Observed time and planned commitments · separate scales"}</small></div>
        {range === "7d" && series.length
          ? <DailyRhythmStrip points={series} rangeLabel={rangeLabel} />
          : series.length >= 2
            ? <TrendChart points={series} rangeLabel={rangeLabel} />
            : <p className="insight-empty-note">A trend needs at least two recorded days. Switch to 7 days or 30 days for comparison.</p>}
      </section>

      <section className="panel insight-rhythm">
        <div className="card-title"><span><CalendarDays size={17} /> Work rhythm</span><small>{pauseShare === null ? "Goals, updates, outcomes, and closing streak" : "Paused share " + pauseShare + "% of observed+paused time"}</small></div>
        <div className="insight-rhythm-layout">
          {range === "30d" ? <div className="split-chart"><HeatmapGrid cells={heatmap} rangeLabel={rangeLabel} /></div> : null}
          <div className="split-data">
            <ConsistencyChips chips={chips} />
            <div className="rhythm-timing">
              <div className="card-title"><span><CheckCircle2 size={16} /> Outcomes with a due date</span><small>Undated work is never classified either way</small></div>
              {timing ? <OnTimeBar onTime={timing.onTime} late={timing.late} percent={timing.percent} /> : null}
            </div>
          </div>
        </div>
      </section>

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

      {updateSlices.some((slice) => slice.value > 0) ? <section className="panel insight-updates">
        <div className="card-title"><span><MessageSquareText size={17} /> Recorded updates</span><small>{blockedTotal > 0 ? blockedTotal + " blocker" + (blockedTotal === 1 ? "" : "s") + " raised" : "No blockers raised"}</small></div>
        <UpdateKindChart slices={updateSlices} />
        <p className="activity-provenance">Update kinds come from the employee&apos;s own recorded updates. Blockers and priority changes remain separate.</p>
      </section> : null}

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
