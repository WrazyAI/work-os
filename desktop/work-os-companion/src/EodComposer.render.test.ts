import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodComposer } from "./taskSurfaces";

const baseProps = {
  reportId: "report-12345678",
  initialMarkdown: "## Summary\n\nDid the work.\n\n## Completed\n\n- Shipped it",
  source: null as null,
  suggestedBottleneck: null as null,
  allTasksCompleted: true,
  redrafting: false,
  busy: false,
  onRedraft: () => undefined,
  onRefine: async () => true,
  onSubmit: () => undefined,
};

describe("EodComposer review surface", () => {
  it("opens on rendered preview with a raw editing mode", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, baseProps));
    expect(markup).toContain("Preview");
    expect(markup).toContain("Raw");
    expect(markup).toContain("Report preview");
    expect(markup).toContain("Did the work.");
    expect(markup).toContain("Shipped it");
    expect(markup).not.toContain("## Summary");
    expect(markup).not.toContain("eod-raw");
  });

  it("keeps refine and submit actions available", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, baseProps));
    expect(markup).toContain("Refine draft");
    expect(markup).toContain("Submit EOD");
    expect(markup).toContain("Draft with AI");
    expect(markup).toContain("Select text in the preview to add a note");
    expect(markup).not.toContain("Draft notes");
  });

  it("renders the screenshot gallery with a carousel and honest breakdown", () => {
    const frames = Array.from({ length: 9 }, (_, index) => ({
      summaryId: `frame-${index + 1}`,
      capturedAt: `2026-09-14T1${index}:00:00.000Z`,
      visibleApp: index % 2 ? "VS Code" : "Google Chrome",
      summary: `Frame ${index + 1} shows work in progress.`,
      confidence: 0.95,
    }));
    const markup = renderToStaticMarkup(createElement(EodComposer, {
      ...baseProps,
      source: "ai" as const,
      screenshotContext: { processed: 9, excluded: 69, failed: 0, pending: 0, observations: frames.slice(-4) },
      screenshotGallery: { processed: 9, excludedPolicy: 0, excludedSensitive: 69, unavailable: 0, pending: 0, total: 9, viewable: frames },
      screenshotResolveSrc: () => "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E",
    }));
    expect(markup).toContain("9 screenshot samples analyzed for this day");
    expect(markup).toContain("eod-shot-carousel");
    expect(markup).toContain("+2");
    expect(markup).toContain("more");
    expect(markup).toContain("9 analyzed");
    expect(markup).toContain("69 flagged as sensitive (images deleted)");
    expect(markup).not.toContain("excluded by privacy policy");
    expect(markup).toContain("Screenshot captured at 18:00 in Google Chrome");
  });

  it("hides the gallery panel when the day has no frames", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, {
      ...baseProps,
      screenshotGallery: { processed: 0, excludedPolicy: 0, excludedSensitive: 69, unavailable: 0, pending: 0, total: 0, viewable: [] },
    }));
    expect(markup).not.toContain("eod-screenshot-context");
    expect(markup).not.toContain("eod-shot-carousel");
  });

  it("waits for on-demand analysis with honest counts and a Draft Anyway escape", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, {
      ...baseProps,
      source: "ai" as const,
      screenshotGallery: { processed: 2, excludedPolicy: 0, excludedSensitive: 0, unavailable: 0, pending: 4, total: 6, viewable: [] },
      preparing: { analyzed: 2, total: 6, pending: 4 },
      onDraftAnyway: () => undefined,
    }));
    expect(markup).toContain("Preparing Worktivity analysis…");
    expect(markup).toContain("2 of 6 frames analyzed — 4 still analyzing");
    expect(markup).toContain("Draft Anyway");
    // The panel states the pending frames instead of implying zero analyzed.
    expect(markup).toContain("2 screenshot samples analyzed for this day · 4 still analyzing");
  });

  it("shows the pending frames even before the first batch lands", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, {
      ...baseProps,
      source: "ai" as const,
      screenshotGallery: { processed: 0, excludedPolicy: 0, excludedSensitive: 0, unavailable: 0, pending: 6, total: 6, viewable: [] },
      preparing: { analyzed: 0, total: 0, pending: null },
      onDraftAnyway: () => undefined,
    }));
    expect(markup).toContain("Preparing Worktivity analysis…");
    expect(markup).toContain("Checking today&#x27;s screenshots.");
    expect(markup).toContain("0 screenshot samples analyzed for this day · 6 still analyzing");
  });

  const submitButton = (markup: string) => markup.match(/<button class="primary"[^>]*>Submit EOD<\/button>/)?.[0] ?? "";

  it("unlocks Submit when the reason was written in the report draft", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, {
      ...baseProps,
      allTasksCompleted: false,
      initialMarkdown: "## Summary\n\nDid the work.\n\n## Bottleneck\nWaiting on the security review.",
    }));
    expect(markup).toContain("Found in the report draft");
    expect(submitButton(markup)).toContain("Submit EOD");
    expect(submitButton(markup)).not.toContain("disabled");
    expect(markup).not.toContain("Add the reason above");
  });

  it("keeps Submit disabled and names the missing reason when only the placeholder exists", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, {
      ...baseProps,
      allTasksCompleted: false,
      initialMarkdown: "## Summary\n\nDid the work.\n\n## Bottleneck\n(needs your input — what prevented you from completing your task list?)",
    }));
    expect(submitButton(markup)).toContain("disabled");
    expect(markup).toContain("Add the reason above (Bottleneck) to submit.");
    expect(markup).not.toContain("Found in the report draft");
  });

  it("explains a disabled Submit while the draft is still being written", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, { ...baseProps, allTasksCompleted: false, redrafting: true }));
    expect(submitButton(markup)).toContain("disabled");
    expect(markup).toContain("Waiting for the draft to finish before this can be submitted.");
  });

  it("puts the required reason before the optional refine block", () => {
    const markup = renderToStaticMarkup(createElement(EodComposer, { ...baseProps, allTasksCompleted: false }));
    expect(markup.indexOf("Bottleneck — required")).toBeGreaterThan(-1);
    expect(markup.indexOf("Bottleneck — required")).toBeLessThan(markup.indexOf("Refine this draft"));
  });
});
