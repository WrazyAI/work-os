import { useMemo, useState } from "react";
import { applyDayScenario, DEFAULT_DEBUG_SCENARIO, insightsFixture } from "./scenarios";
import { PersonalInsights } from "./InsightsView";
import type { DayData, InsightDay, InsightsData } from "./types";

type Range = "day" | "7d" | "30d";
type PreviewState = "dense" | "empty";

const RANGES: Range[] = ["day", "7d", "30d"];

/** Zero one day's recorded facts so the empty fixture shows the honest
 * no-record state instead of synthetic numbers. */
function zeroDay(day: InsightDay): InsightDay {
  return {
    ...day,
    observedSeconds: 0,
    pausedSeconds: 0,
    pauseRatio: 0,
    planned: 0,
    plannedCompleted: 0,
    carryOver: 0,
    overdue: 0,
    updates: 0,
    updatesByKind: undefined,
    outputEvidence: 0,
    activityContext: 0,
    trackedMinutes: 0,
    topApps: [],
    tasksCompleted: 0,
    tasksOpen: 0,
    completed: 0,
    progressed: 0,
    deferred: 0,
    carried: 0,
    unplanned: 0,
    outcomesOnTime: 0,
    outcomesLate: 0,
    sessionCorrections: 0,
    goal: undefined,
    goalSet: false,
    references: [],
    sessionQuality: { status: "valid", message: null },
  };
}

function zeroTotals(totals: InsightsData["totals"]): InsightsData["totals"] {
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, typeof value === "number" ? 0 : value])) as InsightsData["totals"];
}

/** Dev-only rendered-QA fixture for the employee Insights dashboard: the real
 * extracted view rendered against the on-device scenario record, with range
 * and dense/empty switches. `?preview-insights&range=30d&state=empty`
 * deep-links a state for screenshots and automated checks. */
export default function InsightsPreview() {
  const params = new URLSearchParams(window.location.search);
  const initialRange = RANGES.find((value) => value === params.get("range")) ?? "7d";
  const initialstate: PreviewState = params.get("state") === "empty" ? "empty" : "dense";
  const [range, setRange] = useState<Range>(initialRange);
  const [state, setState] = useState<PreviewState>(initialstate);
  const data = useMemo(() => {
    const day = applyDayScenario(null, {
      ...DEFAULT_DEBUG_SCENARIO,
      enabled: true,
      dayState: state === "empty" ? "no_shift" : "clocked_in",
      emptyTasks: state === "empty",
      emptyEvidence: state === "empty",
    }) as DayData;
    const fixture = insightsFixture(day, range);
    if (state !== "empty") return fixture;
    return {
      ...fixture,
      days: fixture.days.map(zeroDay),
      totals: zeroTotals(fixture.totals),
      updateKinds: { progress: 0, starting: 0, completionClaim: 0, blocked: 0, priorityChange: 0, unplannedWork: 0 },
      consistency: fixture.consistency
        ? { ...fixture.consistency, daysWithGoal: 0, daysWithUpdate: 0, daysWithCompletion: 0, currentStreak: 0, commitmentRate: null, bestDay: null }
        : undefined,
      comparison: fixture.comparison
        ? { ...fixture.comparison, days: fixture.comparison.days.map(zeroDay), totals: zeroTotals(fixture.comparison.totals) }
        : fixture.comparison,
    };
  }, [range, state]);
  return <div className="workspace preview-workspace">
    <section className="stage">
      <header className="masthead">
        <div><p>Preview</p><h1>Employee insights</h1></div>
        <div className="mast-actions">
          <div className="range-switch" aria-label="Preview range">
            {RANGES.map((value) => <button key={value} type="button" className={range === value ? "active" : ""} aria-pressed={range === value} onClick={() => setRange(value)}>{value === "day" ? "Today" : value}</button>)}
          </div>
          <div className="range-switch" aria-label="Preview record state">
            {(["dense", "empty"] as const).map((value) => <button key={value} type="button" className={state === value ? "active" : ""} aria-pressed={state === value} onClick={() => setState(value)}>{value === "dense" ? "Dense" : "Empty"}</button>)}
          </div>
        </div>
      </header>
      <PersonalInsights data={data} loading={false} range={range} onRange={setRange} onReference={() => undefined} onCorrect={() => undefined} />
    </section>
  </div>;
}
