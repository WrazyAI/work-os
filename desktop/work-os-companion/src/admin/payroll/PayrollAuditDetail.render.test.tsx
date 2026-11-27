import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayrollWeekBriefCard } from "./PayrollWeekBriefCard";

const period = {
  payDate: "2026-11-16", from: "2026-11-01", through: "2026-11-15", timezone: "UTC",
  weeks: [{ week: 1 as const, from: "2026-11-01", through: "2026-11-07" }, { week: 2 as const, from: "2026-11-08", through: "2026-11-15" }] as [
    { week: 1; from: string; through: string }, { week: 2; from: string; through: string },
  ],
};

describe("native payroll week brief", () => {
  it("presents the week, dates, grounding and structured observations", () => {
    const markup = renderToStaticMarkup(createElement(PayrollWeekBriefCard, {
      period,
      brief: {
        week: 1, status: "ready", title: "Queue and review",
        summary: "Reviewed the support queue.", summaryCitations: [{ type: "interval", id: "recap-7", revision: 3 }],
        themes: [{ heading: "Support queue", detail: "Cleared the backlog.", citations: [{ type: "interval", id: "recap-7", revision: 3 }] }],
        openItems: [{ text: "Confirm staging.", citations: [] }], gaps: ["Friday coverage is incomplete."], sourceHash: "week-1",
      },
    }));
    expect(markup).toContain('class="payroll-brief-week"');
    expect(markup).toContain("Week 1");
    expect(markup).toContain("Nov 1, 2026 – Nov 7, 2026");
    expect(markup).toContain("Grounded in 1 source");
    expect(markup).toContain('class="payroll-brief-observation"');
    expect(markup).toContain("Confirm staging.");
    expect(markup).toContain("Friday coverage is incomplete.");
  });

  it("drops repeated week/date titles and inline citation plumbing", () => {
    const markup = renderToStaticMarkup(createElement(PayrollWeekBriefCard, {
      period,
      brief: {
        week: 1, status: "ready", title: "Week 1 progress brief — 2026-11-01 through 2026-11-07",
        summary: "Reviewed the queue [interval:recap-7@3; interval:recap-8@2] and documented the result.",
        summaryCitations: [], themes: [], openItems: [], gaps: ["Coverage is incomplete [interval:recap-9@1]."], sourceHash: "week-1",
      },
    }));
    expect(markup).toContain("<h3>Progress brief</h3>");
    expect(markup).not.toContain("[interval:");
    expect(markup).toContain("Reviewed the queue and documented the result.");
    expect(markup).toContain("Coverage is incomplete.");
  });
});
