import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FlowStages, KpiCard, PlanReliability } from "./InsightCharts";
import { flowBreakdown, periodDeltas } from "./insights";
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

describe("insights dashboard primitives", () => {
  it("renders a KPI tile with its value, comparison pill, and sparkline", () => {
    const stat = periodDeltas({ tasksCompleted: 9 }, { tasksCompleted: 6 }).find((entry) => entry.key === "tasksCompleted")!;
    const markup = renderToStaticMarkup(createElement(KpiCard, {
      label: "Outcomes completed",
      value: "9",
      delta: stat,
      spark: [1, 3, 2, 3],
      sparkLabel: "Completed outcomes per day",
    }));
    expect(markup).toContain("Outcomes completed");
    expect(markup).toContain(">9<");
    expect(markup).toContain("+3");
    expect(markup).toContain("vs earlier period");
    expect(markup).toContain("delta-badge-wrap");
    expect(markup).toContain("delta-badge better");
    expect(markup).toContain("sparkline");
    expect(markup).toContain('aria-label="Completed outcomes per day"');
    expect(markup).toContain('title="Outcomes: 9 now, 6 in the equal earlier period"');
  });

  it("quiets a KPI tile without a comparison and marks closing attention", () => {
    const quiet = renderToStaticMarkup(createElement(KpiCard, {
      label: "Closing carry-over",
      value: "4",
      attention: true,
      detail: "Nothing carried at the close",
    }));
    expect(quiet).toContain("insight-kpi attention");
    expect(quiet).not.toContain("delta-badge");
    expect(quiet).toContain("Nothing carried at the close");
    expect(quiet).not.toContain("sparkline");

    const singleDay = renderToStaticMarkup(createElement(KpiCard, { label: "Outcomes", value: "0", spark: [0] }));
    expect(singleDay).not.toContain("sparkline");
  });

  it("reports recorded ratios with exact percentages and counts", () => {
    const markup = renderToStaticMarkup(createElement(PlanReliability, {
      rows: [
        { key: "on-time", label: "Outcomes on time", percent: 91, detail: "10 on time · 1 late" },
        { key: "coverage", label: "Days with an update", percent: null, detail: "0 of 5 days with a substantive update" },
      ],
    }));
    expect(markup).toContain("Outcomes on time");
    expect(markup).toContain("91%");
    expect(markup).toContain('aria-label="Outcomes on time: 91%"');
    expect(markup).toContain("10 on time · 1 late");
    expect(markup).toContain("Days with an update");
    expect(markup).toContain("—");
    expect(markup).toContain('aria-label="Days with an update: not recorded in this range"');
  });

  it("draws the record mix as counted blocks and shares, never a sequence", () => {
    const slices = flowBreakdown([day({ tasksCompleted: 3, progressed: 1 })]);
    const markup = renderToStaticMarkup(createElement(FlowStages, { slices, ariaLabel: "Record mix for these 7 days" }));
    expect(markup).toContain("flow-stage-plot");
    expect(markup).toContain("slice-completed");
    expect(markup).toContain("Outcomes completed");
    expect(markup).toContain("75%");
    expect(markup).toContain("25%");
    expect(markup).toContain('aria-label="Record mix for these 7 days"');
    expect(markup).not.toContain("→");
  });

  it("keeps an empty record mix quiet instead of drawing zeroed stages", () => {
    const markup = renderToStaticMarkup(createElement(FlowStages, {
      slices: flowBreakdown([day({ tasksCompleted: 0, progressed: 0 })]),
      ariaLabel: "Record mix",
    }));
    expect(markup).toContain("Nothing was recorded in this range yet.");
    expect(markup).not.toContain("flow-stage-plot");
  });
});
