import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodStructuredReadingView } from "./EodStructuredReadingView";

const report = {
  version: 1 as const,
  summary: "A day of finished threads. The settlement reconciliation closed and the handoff is ready for review.",
  summaryGeneratedAt: "2026-09-14T17:01:00.000Z",
  summarySource: "otto" as const,
  summarySignature: "current",
  completed: ["Reconcile September settlements", "Ship the handoff checklist"],
  inProgress: ["Companion approvals review"],
  next: ["Update the intake checklist"],
  suggestions: { completed: [], inProgress: [], next: [] },
  evidence: [
    {
      source: "tasks",
      label: "Tasks",
      items: [
        { id: "t1", title: "Reconcile September settlements", summary: null, meta: "Payments · completed by you", url: null, at: "2026-09-14T15:30:00.000Z", kind: "completed" },
        { id: "t2", title: "Ship the handoff checklist", summary: null, meta: "Payments · completed by you", url: null, at: "2026-09-14T16:10:00.000Z", kind: "completed" },
      ],
    },
    {
      source: "github",
      label: "GitHub",
      items: [
        { id: "g1", title: "Pull request #482 · Reconcile Q4 supplier ledger", summary: null, meta: "Performed by you · work-os", url: "https://github.com/WrazyAI/work-os/pull/482", at: "2026-09-14T16:12:00.000Z", kind: "performed" },
      ],
    },
  ],
  loomUrl: "https://www.loom.com/share/6f2a9c4b8e1d4f5a6b7c8d9e0f1a2b3c",
  preparedAt: "2026-09-14T16:50:00.000Z",
  source: "scheduled" as const,
};

describe("EodStructuredReadingView", () => {
  it("renders the structured brief read-only", () => {
    const html = renderToStaticMarkup(createElement(EodStructuredReadingView, { report, variant: "employee" }));
    expect(html).toContain("A day of finished threads.");
    expect(html).toContain("Otto · written from your entries");
    expect(html).toContain("Completed");
    expect(html).toContain("In progress");
    expect(html).toContain("Next");
    expect(html).toContain("Reconcile September settlements");
    expect(html).toContain("Loom recording attached");
    expect(html).toContain("Recorded");
    expect(html).toContain("Evidence");
    expect(html).toContain("Immutable");
    expect(html).toContain("2 records");
    expect(html).not.toMatch(/<(input|textarea)\b|contenteditable/i);
    expect(html).not.toContain("Submit for review");
    expect(html).not.toContain("Refresh summary");
  });

  it("addresses the admin reader from the employee's entries", () => {
    const html = renderToStaticMarkup(createElement(EodStructuredReadingView, { report, variant: "admin", personName: "Amara Okafor", date: "2026-09-14", status: "pending_review" }));
    expect(html).toContain("written from the employee");
    expect(html).toContain("Amara Okafor");
    expect(html).toContain("Sep 14");
    expect(html).toContain("Pending review");
  });

  it("keeps the full record behind the supplied disclosure", () => {
    const html = renderToStaticMarkup(createElement(EodStructuredReadingView, {
      report,
      fullRecord: createElement("details", null, createElement("summary", null, "Full recorded day"), createElement("p", null, "Appendix row")),
    }));
    expect(html).toContain("Full recorded day");
    expect(html).toContain("Appendix row");
  });
});
