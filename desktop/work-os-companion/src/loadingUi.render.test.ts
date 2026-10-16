import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Bench, DashboardSkeleton, FadeArc, InsightsSkeleton, TaskDetailSkeleton, TaskListSkeleton, Wave } from "./LoadingUi";

describe("loading language", () => {
  it("wave renders a status with five animated bars", () => {
    const markup = renderToStaticMarkup(createElement(Wave));
    expect(markup).toContain('role="status"');
    expect((markup.match(/loading-wave-bar/g) || []).length).toBe(5);
    expect(markup).toContain("Loading");
    expect(markup).toContain('class="loading-wave"');
  });

  it("bench renders a decorative hairline with one traveling pulse, no status role", () => {
    const markup = renderToStaticMarkup(createElement(Bench));
    expect(markup).toContain('class="loading-bench"');
    expect(markup).toContain('class="loading-bench-pulse"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="status"');
  });

  it("fade arc renders an accessible spinner with gradient stops", () => {
    const markup = renderToStaticMarkup(createElement(FadeArc, { size: 18 }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain("loading-ui-fade-arc-spin");
    expect(markup).toContain("linearGradient");
  });

  it("dashboard skeleton mirrors the dashboard anatomy", () => {
    const markup = renderToStaticMarkup(createElement(DashboardSkeleton));
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("skeleton-kpi-row");
    expect((markup.match(/skeleton-card\b/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  it("list, detail, and insights skeletons render their rows", () => {
    const list = renderToStaticMarkup(createElement(TaskListSkeleton, { rows: 4 }));
    expect((list.match(/skeleton-task-row/g) || []).length).toBe(4);
    const detail = renderToStaticMarkup(createElement(TaskDetailSkeleton));
    expect((detail.match(/class="skeleton-subtask-row"/g) || []).length).toBe(3);
    const insights = renderToStaticMarkup(createElement(InsightsSkeleton));
    expect((insights.match(/skeleton-bar\b/g) || []).length).toBe(7);
  });
});
