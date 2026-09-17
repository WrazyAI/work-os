import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EodLoadingState } from "./taskSurfaces";

describe("EodLoadingState", () => {
  it("renders a composer-shaped skeleton with one status line", () => {
    const markup = renderToStaticMarkup(createElement(EodLoadingState, {
      title: "Drafting your EOD…",
      detail: "Checking today's recorded work and writing a draft for you to review.",
    }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain("eod-composer");
    expect(markup).toContain("eod-loading-skeleton");
    expect(markup).toContain("skeleton eod-loading-line is-heading");
    expect(markup).toContain("Drafting your EOD…");
    expect(markup).not.toContain("Draft Anyway");
  });

  it("shows analysis progress and a quiet escape hatch while preparing", () => {
    const markup = renderToStaticMarkup(createElement(EodLoadingState, {
      title: "Preparing Worktivity analysis…",
      detail: "Checking today’s screenshots.",
      progress: "23 of 117 frames analyzed — 40 still analyzing.",
      onDraftAnyway: () => undefined,
    }));
    expect(markup).toContain("23 of 117 frames analyzed — 40 still analyzing.");
    expect(markup).toContain("Draft Anyway");
    expect(markup).toContain("eod-loading-footer");
  });
});
