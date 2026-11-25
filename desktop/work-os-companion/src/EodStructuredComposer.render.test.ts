import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodStructuredComposer } from "./EodStructuredComposer";
import { eodCompositionSignature } from "./eodStructured";

const submitTag = (html: string) => html.match(/<button[^>]*class="eod-structured-submit"[^>]*>/)?.[0] ?? "";

const structured = {
  version: 1 as const,
  summary: "",
  summaryGeneratedAt: null,
  summarySource: null,
  summarySignature: null,
  completed: [],
  inProgress: [],
  next: [],
  suggestions: {
    completed: ["Reconcile September settlements"],
    inProgress: ["Companion approvals"],
    next: ["Update the checklist"],
  },
  evidence: [
    {
      source: "tasks",
      label: "Tasks",
      items: [
        { id: "t1", title: "Reconcile September settlements", summary: null, meta: "Payments · 3:30 PM", url: null, at: "2026-11-25T15:30:00.000Z", kind: "completed" },
      ],
    },
  ],
  loomUrl: null,
  preparedAt: "2026-11-25T16:50:00.000Z",
  source: "scheduled" as const,
};

const base = {
  reportId: "r-1",
  structured,
  onSave: async () => "saved" as const,
  onWriteSummary: async () => ({ source: "otto" as const }),
  onSubmit: async () => "saved" as const,
  onRedraft: () => undefined,
  onDelete: () => undefined,
};

describe("EodStructuredComposer", () => {
  it("shows the three sections and waits on entries", () => {
    const markup = renderToStaticMarkup(createElement(EodStructuredComposer, base));
    expect(markup).toContain("Completed");
    expect(markup).toContain("In progress");
    expect(markup).toContain("Next");
    expect(markup).toContain("Waiting on your entries");
    expect(markup).toContain("Submit for review");
    expect(submitTag(markup)).toContain("disabled");
  });

  it("asks for a current summary before submitting", () => {
    const markup = renderToStaticMarkup(createElement(EodStructuredComposer, {
      ...base,
      structured: { ...structured, completed: ["Shipped the handoff"], inProgress: ["Review is open"], next: ["Send the note"] },
    }));
    expect(markup).toContain("Ready to write");
    expect(markup).toContain("Write the summary");
    expect(markup).toContain("Write the summary before submitting.");
  });

  it("renders stale, immutable evidence and an attached Loom", () => {
    const markup = renderToStaticMarkup(createElement(EodStructuredComposer, {
      ...base,
      structured: {
        ...structured,
        completed: ["Shipped"],
        inProgress: ["Review"],
        next: ["Send"],
        summary: "A finished day.",
        summarySignature: "old",
        loomUrl: "https://www.loom.com/share/0123456789abcdef0123456789abcdef",
      },
    }));
    expect(markup).toContain("Refresh summary");
    expect(markup).toContain("Recorded evidence");
    expect(markup).toContain("Immutable");
    expect(markup).toContain("Loom");
    expect(markup).toContain("Submit for review");
    expect(submitTag(markup)).toContain("disabled");
  });

  it("enables Submit only for a complete composition with a current summary", () => {
    const completed = ["Shipped the handoff"];
    const inProgress = ["Review is open"];
    const next = ["Send the note"];
    const markup = renderToStaticMarkup(createElement(EodStructuredComposer, {
      ...base,
      structured: {
        ...structured,
        completed,
        inProgress,
        next,
        summary: "A finished day.",
        summarySource: "otto",
        summarySignature: eodCompositionSignature({ completed, inProgress, next }),
      },
    }));
    expect(submitTag(markup)).not.toContain("disabled");
  });
});
