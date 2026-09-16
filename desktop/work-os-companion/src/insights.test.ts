import { describe, expect, it } from "vitest";
import { consistencyChips, flowBreakdown, heatmapCells, insightChartData, insightSeries, niceCeil, niceTicks, onTimeRate, periodDeltas, updateKindBreakdown } from "./insights";
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
