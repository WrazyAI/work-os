import { describe, expect, it } from "vitest";
import { insightChartData } from "./insights";
import type { DayData } from "./types";

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
