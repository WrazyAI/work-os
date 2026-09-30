import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityDonut, BarBreakdown, DailyRhythmStrip, FlowDonut, HeatmapGrid, TrackedBars, TrendChart, UpdateKindChart } from "./InsightCharts";
import { flowBreakdown, heatmapCells, insightSeries, updateKindBreakdown } from "./insights";
import type { InsightDay } from "./types";

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

describe("insight chart rendering", () => {
  it("labels every donut class with its count and share of the range", () => {
    const markup = renderToStaticMarkup(createElement(FlowDonut, {
      slices: flowBreakdown([day({ tasksCompleted: 3, progressed: 1 })]),
      ariaLabel: "Work mix",
    }));
    expect(markup).toContain("Outcomes completed");
    expect(markup).toContain("· 75%");
    expect(markup).toContain("· 25%");
    expect(markup).toContain("records");
    expect(markup).toContain('role="img"');
  });

  it("renders a quiet empty state instead of zeroed rows", () => {
    const empty = renderToStaticMarkup(createElement(UpdateKindChart, { slices: updateKindBreakdown(null) }));
    expect(empty).toContain("No updates recorded in this range.");
    expect(empty).not.toContain("bar-track");
    const filled = renderToStaticMarkup(createElement(UpdateKindChart, {
      slices: updateKindBreakdown({ progress: 3, starting: 0, completionClaim: 0, blocked: 1, priorityChange: 0, unplannedWork: 0 }),
    }));
    expect(filled).toContain("bar-track");
    expect(filled).toContain("· 75%");
    expect(filled).toContain("needs attention");
  });

  it("renders an interactive app distribution donut with a truthful residual slice", () => {
    const markup = renderToStaticMarkup(createElement(ActivityDonut, {
      items: [{ name: "VS Code", minutes: 90 }, { name: "Chrome", minutes: 30 }],
      total: 150,
      ariaLabel: "Tracked app distribution",
    }));
    expect(markup).toContain("activity-donut");
    expect(markup).toContain("VS Code");
    expect(markup).toContain("Chrome");
    expect(markup).toContain("Other apps/sites");
    expect(markup).toContain("60%");
    expect(markup).toContain('tabindex="0"');
  });

  it("keeps the heatmap flat and scrollable only sideways", () => {
    const markup = renderToStaticMarkup(createElement(HeatmapGrid, {
      cells: heatmapCells([day({ date: "2026-08-17", tasksCompleted: 2 }), day({ date: "2026-08-24", tasksCompleted: 5 })]),
      rangeLabel: "these 7 days",
    }));
    expect(markup).toContain("heatmap-scroll");
    expect(markup).toContain("Aug");
    expect(markup).toContain("darker means more completed work");
    expect((markup.match(/heatmap-cell bucket-/g) ?? []).length).toBe(2);
    expect(markup).toContain("August 24: 5 completed outcomes");
  });

  it("renders seven-day rhythm as a compact daily strip with exact accessible values", () => {
    const markup = renderToStaticMarkup(createElement(DailyRhythmStrip, {
      points: insightSeries([
        day({ date: "2026-08-17", tasksCompleted: 2, planned: 4, plannedCompleted: 3 }),
        day({ date: "2026-08-18", tasksCompleted: 0, planned: 0, plannedCompleted: 0 }),
      ]),
      rangeLabel: "these 7 days",
    }));
    expect(markup).toContain("daily-rhythm-strip");
    expect(markup).toContain("daily-rhythm-plot");
    expect(markup).toContain("daily-rhythm-hit");
    expect(markup).toContain("75% plan");
    expect(markup).toContain("No plan");
    expect(markup).toContain("August 17: 2 completed outcomes");
  });

  it("connects consecutive weekly commitment points with one shared line", () => {
    const markup = renderToStaticMarkup(createElement(DailyRhythmStrip, {
      points: insightSeries([
        day({ date: "2026-08-17", planned: 4, plannedCompleted: 3 }),
        day({ date: "2026-08-18", planned: 5, plannedCompleted: 4 }),
        day({ date: "2026-08-19", planned: 3, plannedCompleted: 3 }),
      ]),
      rangeLabel: "these 7 days",
    }));
    expect((markup.match(/class="daily-rhythm-line"/g) ?? []).length).toBe(1);
    expect((markup.match(/daily-rhythm-dot/g) ?? []).length).toBe(3);
  });

  it("scales the trend axis to round ticks and breaks the line at unrecorded days", () => {
    const points = insightSeries([
      day({ date: "2026-08-17", observedSeconds: 7200, planned: 2, plannedCompleted: 1 }),
      day({ date: "2026-08-18", observedSeconds: 0, planned: 0, plannedCompleted: 0 }),
      day({ date: "2026-08-19", observedSeconds: 14400, planned: 2, plannedCompleted: 2 }),
    ]);
    const markup = renderToStaticMarkup(createElement(TrendChart, { points, rangeLabel: "these 7 days" }));
    expect(markup).toContain("2h");
    expect(markup).toContain("4h");
    expect(markup).toContain("0%");
    expect(markup).toContain("100%");
    expect(markup).toContain("Range summary");
    expect(markup).toContain("Peak day");
    expect((markup.match(/trend-dot/g) ?? []).length).toBe(2);
    expect((markup.match(/class="trend-line"/g) ?? []).length).toBe(0);
    expect((markup.match(/trend-bar empty/g) ?? []).length).toBe(1);
  });

  it("draws one contiguous line segment for consecutive recorded days", () => {
    const markup = renderToStaticMarkup(createElement(TrendChart, {
      points: insightSeries([day({ date: "2026-08-17" }), day({ date: "2026-08-18" })]),
      rangeLabel: "these 7 days",
    }));
    expect((markup.match(/class="trend-line"/g) ?? []).length).toBe(1);
    expect((markup.match(/trend-dot/g) ?? []).length).toBe(2);
  });

  it("renders tracked minute bars per day without inventing zero bars", () => {
    const markup = renderToStaticMarkup(createElement(TrackedBars, {
      points: insightSeries([day({ date: "2026-08-17", trackedMinutes: 120 }), day({ date: "2026-08-18", trackedMinutes: 0 })]),
      rangeLabel: "these 7 days",
    }));
    expect((markup.match(/tracked-bar"/g) ?? []).length).toBe(1);
    expect(markup).toContain("Tracked activity minutes per day");
  });

  it("keeps the activity bar list scoped to the tracked total", () => {
    const markup = renderToStaticMarkup(createElement(BarBreakdown, {
      ariaLabel: "Tracked minutes by app",
      rows: [{ key: "Figma", label: "Figma", value: 80, detail: "min" }, { key: "Chrome", label: "Chrome", value: 20, detail: "min" }],
      total: 200,
      emptyNote: "No tracked app activity in this range.",
    }));
    expect(markup).toContain("40%");
    expect(markup).toContain("Figma");
    expect(markup).toContain("min · 10%");
  });
});
