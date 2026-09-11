import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodOutstandingBell, outstandingRowMeta } from "./EodOutstanding";
import type { OutstandingEodDay } from "./types";

const noop = () => undefined;
const days: OutstandingEodDay[] = [
  { date: "2026-09-10", status: "draft_unsubmitted", reportId: "r-1", observedMinutes: 290, completedTasks: 10, hasPlan: true },
  { date: "2026-09-08", status: "no_draft", reportId: null, observedMinutes: 319, completedTasks: 7, hasPlan: true },
];

function render(rows: OutstandingEodDay[]) {
  return renderToStaticMarkup(createElement(EodOutstandingBell, { days: rows, loading: false, error: null, open: false, onToggle: noop, onClose: noop, onSelect: noop, onRetry: noop }));
}

describe("EodOutstandingBell trigger", () => {
  it("hides the count when no day is outstanding", () => {
    const markup = render([]);
    expect(markup).toContain('aria-label="Outstanding EODs"');
    expect(markup).not.toContain("eod-bell-count");
  });

  it("names the count for assistive tech and shows a badge", () => {
    const markup = render(days);
    expect(markup).toContain('aria-label="Outstanding EODs, 2 days need attention"');
    expect(markup).toContain("eod-bell-count");
    expect(markup).toContain(">2<");
  });
});

describe("outstandingRowMeta", () => {
  it("names the weekday, observed time, and outcomes", () => {
    expect(outstandingRowMeta(days[0]!)).toBe("Thursday · 4h 50m observed · 10 task outcomes");
  });

  it("omits empty observed and outcome segments", () => {
    expect(outstandingRowMeta({ ...days[0]!, observedMinutes: 0, completedTasks: 0 })).toBe("Thursday");
  });

  it("never renders an invalid date", () => {
    expect(outstandingRowMeta({ ...days[0]!, date: "not-a-date" })).toBe("4h 50m observed · 10 task outcomes");
  });
});
