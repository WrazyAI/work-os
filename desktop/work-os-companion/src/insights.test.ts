import { describe, expect, it } from "vitest";
import { consistencyChips, flowBreakdown, heatmapCells, heatmapColumns, insightChartData, insightSeries, niceCeil, niceTicks, onTimeRate, periodDeltas, sharePercent, trendAxis, trendLineSegments, trendSummary, updateKindBreakdown } from "./insights";
import type { DayData, InsightDay } from "./types";

const baseDay: DayData = {
  at: "2026-08-18T19:30:00.000Z",
  shiftDate: "2026-08-18",
  shift: null,
  prompt: { kind: null, nextPromptAt: null, required: false, reason: "" },
  tasks: [], evidence: [], proposals: [], report: null, session: null, plan: null,
};

describe("live insight chart data", () => {
  it("uses server-derived signals and task completion", () => {
    const result = insightChartData({
      ...baseDay,
      signals: { employeeUpdates: 4, outputEvidence: 2, activityContext: 1, completedTasks: 3, openTasks: 1 },
    });
    expect(result.signals.map((item) => item.percent)).toEqual([100, 50, 25]);
    expect(result.completedPercent).toBe(75);
  });

  it("renders a truthful zero state without NaN geometry", () => {
    const result = insightChartData(baseDay);
    expect(result.signals.every((item) => item.percent === 0)).toBe(true);
    expect(result.completedPercent).toBe(0);
  });
});

const day = (overrides: Partial<InsightDay>): InsightDay => ({
  date: "2026-08-18",
  observedSeconds: 14400,
  pausedSeconds: 1200,
  planStatus: "confirmed",
  planned: 4,
  plannedCompleted: 3,
  carryOver: 0,
  overdue: 0,
  updates: 2,
  outputEvidence: 1,
  activityContext: 1,
  tasksCompleted: 3,
  tasksOpen: 1,
  references: [],
  ...overrides,
});

describe("insight chart builders", () => {
  it("keeps per-day units separate and never invents a completion rate", () => {
    const series = insightSeries([day({ date: "2026-08-17" }), day({ date: "2026-08-18", planned: 0, plannedCompleted: 0, observedSeconds: 5400 })]);
    expect(series[0].observedMinutes).toBe(240);
    expect(series[0].completionPercent).toBe(75);
    expect(series[1].completionPercent).toBeNull();
    expect(series.every((point) => Number.isFinite(point.observedMinutes))).toBe(true);
  });

  it("rounds axis maxima to readable values", () => {
    expect(niceCeil(0)).toBe(0);
    expect(niceCeil(1.4)).toBe(2);
    expect(niceCeil(7)).toBe(10);
    expect(niceCeil(23)).toBe(50);
    expect(niceTicks(0)).toEqual([0]);
    expect(niceTicks(8)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(240)).toEqual([0, 50, 100, 150, 200, 250]);
  });

  it("breaks the work mix into completed, progress, deferred, carried, and unplanned", () => {
    const slices = flowBreakdown([day({ tasksCompleted: 3, progressed: 2, deferred: 1, carried: 2, unplanned: 1 })]);
    expect(slices.map((slice) => [slice.key, slice.value])).toEqual([["completed", 3], ["progressed", 2], ["deferred", 1], ["carried", 2], ["unplanned", 1]]);
  });

  it("rolls update kinds across the range and marks attention kinds", () => {
    const slices = updateKindBreakdown([
      day({ updatesByKind: { progress: 3, starting: 1, completionClaim: 0, blocked: 2, priorityChange: 1, unplannedWork: 0 } }),
      day({ updatesByKind: { progress: 1, starting: 0, completionClaim: 1, blocked: 0, priorityChange: 0, unplannedWork: 1 } }),
    ]);
    expect(slices.find((slice) => slice.key === "progress")?.value).toBe(4);
    expect(slices.find((slice) => slice.key === "blocked")).toMatchObject({ value: 2, attention: true });
    expect(slices.find((slice) => slice.key === "unplannedWork")).toMatchObject({ value: 1, attention: true });
    expect(updateKindBreakdown(null).every((slice) => slice.value === 0)).toBe(true);
    expect(updateKindBreakdown({ progress: 2, starting: 0, completionClaim: 0, blocked: 1, priorityChange: 0, unplannedWork: 0 }).find((slice) => slice.key === "blocked")?.value).toBe(1);
  });

  it("reports on-time rates only for outcomes that carried a due date", () => {
    expect(onTimeRate([day({ outcomesOnTime: 3, outcomesLate: 1 })])).toEqual({ onTime: 3, late: 1, total: 4, percent: 75 });
    expect(onTimeRate([day({ outcomesOnTime: 0, outcomesLate: 0 })]).percent).toBeNull();
  });

  it("compares the equal previous period without implying a score", () => {
    const deltas = periodDeltas(
      { tasksCompleted: 12, plannedCompleted: 10, updates: 6, outcomesLate: 2, observedSeconds: 36000, trackedMinutes: 300 },
      { tasksCompleted: 8, plannedCompleted: 9, updates: 6, outcomesLate: 4, observedSeconds: 32400, trackedMinutes: 420 },
    );
    expect(deltas.find((stat) => stat.key === "tasksCompleted")).toMatchObject({ delta: 4, unit: "count", goodDirection: true });
    expect(deltas.find((stat) => stat.key === "outcomesLate")).toMatchObject({ delta: -2, goodDirection: false });
    expect(deltas.find((stat) => stat.key === "observedMinutes")).toMatchObject({ current: 600, previous: 540, delta: 60, goodDirection: null });
    expect(deltas.find((stat) => stat.key === "trackedMinutes")?.delta).toBe(-120);
    expect(periodDeltas(null, null)).toEqual([]);
  });

  it("lays days out on a Monday-first calendar heatmap", () => {
    const days = [day({ date: "2026-08-17", tasksCompleted: 0 }), day({ date: "2026-08-18", tasksCompleted: 1 }), day({ date: "2026-08-19", tasksCompleted: 3 }), day({ date: "2026-08-24", tasksCompleted: 6 })];
    const cells = heatmapCells(days);
    expect(cells.map((cell) => [cell.weekday, cell.weekIndex, cell.bucket])).toEqual([[0, 0, 0], [1, 0, 1], [2, 0, 3], [0, 1, 4]]);
    expect(heatmapCells([])).toEqual([]);
  });

  it("groups heatmap cells into fixed seven-day columns with month labels", () => {
    const cells = heatmapCells([
      day({ date: "2026-08-31", tasksCompleted: 1 }),
      day({ date: "2026-09-01", tasksCompleted: 2 }),
      day({ date: "2026-09-07", tasksCompleted: 3 }),
    ]);
    const columns = heatmapColumns(cells);
    expect(columns).toHaveLength(2);
    expect(columns.every((column) => column.days.length === 7)).toBe(true);
    expect(columns[0].monthLabel).toBe("Aug");
    expect(columns[1].monthLabel).toBe("Sep");
    expect(columns[0].days[0]?.date).toBe("2026-08-31");
    expect(columns[0].days[1]?.date).toBe("2026-09-01");
    expect(columns[1].days[0]?.date).toBe("2026-09-07");
    expect(columns[1].days[1]).toBeNull();
    expect(heatmapColumns([])).toEqual([]);
  });

  it("scales the trend axis to round hour ticks with aligned percentages", () => {
    const axis = trendAxis(387);
    expect(axis.max).toBe(480);
    expect(axis.ticks).toEqual([0, 120, 240, 360, 480]);
    expect(axis.percents).toEqual([0, 25, 50, 75, 100]);
    expect(axis.ticks[axis.ticks.length - 1]).toBe(axis.max);
    expect(axis.ticks.every((tick) => tick <= axis.max)).toBe(true);
    const short = trendAxis(47);
    expect(short.max).toBe(80);
    expect(short.ticks).toEqual([0, 20, 40, 60, 80]);
    const empty = trendAxis(0);
    expect(empty.max).toBeGreaterThan(0);
    expect(empty.ticks[0]).toBe(0);
    expect(empty.percents).toEqual([0, 25, 50, 75, 100]);
  });

  it("breaks the completion line at days without planned commitments", () => {
    const series = insightSeries([
      day({ date: "2026-08-17", planned: 4, plannedCompleted: 2 }),
      day({ date: "2026-08-18", planned: 4, plannedCompleted: 4 }),
      day({ date: "2026-08-19", planned: 0, plannedCompleted: 0 }),
      day({ date: "2026-08-20", planned: 4, plannedCompleted: 1 }),
    ]);
    const segments = trendLineSegments(series);
    expect(segments).toHaveLength(2);
    expect(segments[0].points).toEqual([{ index: 0, percent: 50 }, { index: 1, percent: 100 }]);
    expect(segments[1].points).toEqual([{ index: 3, percent: 25 }]);
    expect(trendLineSegments([])).toEqual([]);
  });

  it("summarises the trend without counting empty days as zero performance", () => {
    const series = insightSeries([
      day({ date: "2026-08-17", observedSeconds: 7200, planned: 2, plannedCompleted: 1 }),
      day({ date: "2026-08-18", observedSeconds: 0, planned: 0, plannedCompleted: 0 }),
      day({ date: "2026-08-19", observedSeconds: 14400, planned: 2, plannedCompleted: 2 }),
    ]);
    const summary = trendSummary(series);
    expect(summary.peak).toMatchObject({ date: "2026-08-19", observedMinutes: 240 });
    expect(summary.averageMinutes).toBe(120);
    expect(summary.zeroDays).toBe(1);
    expect(summary.recordedDays).toBe(2);
    expect(summary.averageCompletionPercent).toBe(75);
    expect(trendSummary([])).toMatchObject({ peak: null, averageMinutes: 0, zeroDays: 0, averageCompletionPercent: null });
  });

  it("computes range shares without dividing by zero", () => {
    expect(sharePercent(25, 100)).toBe(25);
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(5, 0)).toBe(0);
    expect(sharePercent(Number.NaN, 10)).toBe(0);
    expect(sharePercent(200, 100)).toBe(100);
  });

  it("summarises consistency without falling back to a score", () => {
    const chips = consistencyChips(
      { dayCount: 7, daysWithGoal: 5, daysWithUpdate: 4, daysWithCompletion: 6, currentStreak: 3, commitmentRate: 72, bestDay: { date: "2026-08-16", tasksCompleted: 5 } },
      [day({})],
    );
    expect(chips.map((chip) => chip.key)).toEqual(["goal", "update", "completion", "streak", "commitments", "best"]);
    expect(chips.find((chip) => chip.key === "commitments")?.value).toBe("72%");
    const fallback = consistencyChips(null, [day({ goalSet: true, updates: 0 }), day({ goalSet: false, updates: 2 })]);
    expect(fallback.find((chip) => chip.key === "goal")?.value).toBe("1/2");
    expect(fallback.find((chip) => chip.key === "update")?.value).toBe("1/2");
  });
});
