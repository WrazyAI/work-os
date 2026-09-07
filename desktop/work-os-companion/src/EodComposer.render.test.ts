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
  });
});
