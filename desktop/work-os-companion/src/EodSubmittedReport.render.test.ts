import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodSubmittedReport, submittedEodStatus } from "./EodSubmittedReport";

const props = { status: "submitted" as const, date: "2026-11-04", onAllEods: () => undefined, onToday: () => undefined };

describe("submitted EOD review", () => {
  it.each([
    [{ status: "submitted" }, "submitted"],
    [{ status: "approved" }, "approved"],
    [{ submitted_at: "2026-11-04T17:00:00Z" }, "submitted"],
    [{ status: "draft" }, null],
    [{ status: "rejected", submitted_at: "2026-11-04T17:00:00Z" }, null],
    [null, null],
  ])("selects the read-only state from the report %j", (report, expected) => {
    expect(submittedEodStatus(report)).toBe(expected);
  });

  it("owns the page with confirmation, navigation and the actual read-only report", () => {
    const html = renderToStaticMarkup(createElement(EodSubmittedReport, {
      ...props,
      markdown: "## Summary\nShipped the handoff.\n\n## Completed today\n- Publish checklist [Operations · 4:10 PM]\n\n## Full record\n### Other tasks\n- Update notes",
    }));
    expect(html).toContain("EOD submitted");
    expect(html).toContain("with your manager");
    expect(html).toContain("Nov 4, 2026");
    expect(html).toContain("All EODs");
    expect(html).toContain("Return to today");
    expect(html).toContain('aria-label="End-of-day report"');
    expect(html).toContain("Shipped the handoff.");
    expect(html).toContain("Publish checklist");
    expect(html).toContain("Full record");
    expect(html).toContain("checked-moment");
    expect(html).not.toMatch(/textarea|contenteditable|Submit EOD|Refine draft|Prepare today/);
  });

  it("distinguishes an approved report from an awaiting-review report", () => {
    const html = renderToStaticMarkup(createElement(EodSubmittedReport, { ...props, status: "approved" }));
    expect(html).toContain("EOD approved");
    expect(html).toContain("approved by your manager");
    expect(html).not.toContain("with your manager");
  });

  it("keeps an employee's plain-text submission readable instead of an empty preview", () => {
    const html = renderToStaticMarkup(createElement(EodSubmittedReport, { ...props, markdown: "Finished the handoff.\nWaiting for review. <script>untrusted</script>" }));
    expect(html).toContain("Finished the handoff.");
    expect(html).toContain("Waiting for review.");
    expect(html).toContain("&lt;script&gt;untrusted&lt;/script&gt;");
    expect(html).not.toContain("Nothing to preview yet");
  });

  it("preserves every line of a customized report behind the read-only text disclosure", () => {
    const html = renderToStaticMarkup(createElement(EodSubmittedReport, { ...props, markdown: "## Summary\nFirst update\nSecond update" }));
    expect(html).toContain("Report text");
    expect(html).toContain("Second update");
    expect(html).not.toContain("textarea");
  });

  it("shows an appendix-only report as text rather than an empty structured preview", () => {
    const html = renderToStaticMarkup(createElement(EodSubmittedReport, { ...props, markdown: "## Full record\n### Other tasks\n- Update notes" }));
    expect(html).toContain("Update notes");
    expect(html).not.toContain("Nothing to preview yet");
  });

  it.each([undefined, null, "", "   "])("does not invent a report when markdown is %j", (markdown) => {
    const html = renderToStaticMarkup(createElement(EodSubmittedReport, { ...props, markdown }));
    expect(html).toContain("EOD submitted");
    expect(html).toContain("The submitted report’s text is not available in this view.");
    expect(html).not.toContain('aria-label="End-of-day report"');
    expect(html).not.toContain("Nothing to preview");
  });
});
