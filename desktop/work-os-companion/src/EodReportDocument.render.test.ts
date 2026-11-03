import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EodReportDocument from "./EodReportDocument";

const markdown = [
  "# EOD Report: Preview Employee — October 22, 2026",
  "",
  "Role profile: Engineer",
  "Goal: Ship the handoff",
  "Goal source: Employee",
  "Session: 9:00 AM – 5:30 PM",
  "",
  "## Summary",
  "Completed 2 work tasks today, including the handoff and the review.",
  "",
  "## Completed today",
  "- Ship the handoff — Work OS · 3:30 PM",
  "- Review the queue — Work OS · 4:10 PM",
  "",
  "## In progress",
  "- 2:00–2:30 PM — Confirmed: Work OS retry screen",
  "",
  "## Blocked",
  "- Awaiting the ops lead's sign-off.",
  "",
  "## Plan check",
  "- Ship the handoff — completed in the task record; the plan still shows it open.",
  "",
  "## Evidence",
  "- 2 work deliverables · 1 recorded recap.",
  "",
  "## Full record",
  "",
  "### Work completed (2)",
  "- Ship the handoff — Work OS · 3:30 PM",
  "- Review the queue — Work OS · 4:10 PM",
  "",
  "### Other tasks (1)",
  "- Choose a walking route — Personal task",
  "",
  "### Activity context (1)",
  "- 2:00–2:30 PM — Confirmed: Work OS retry screen",
  "  The interval moved between Work OS and a local preview that would not load.",
].join("\n");

describe("EodReportDocument", () => {
  it("renders the brief and the full record as one document", () => {
    const markup = renderToStaticMarkup(createElement(EodReportDocument, { markdown }));
    expect(markup).toContain("Completed 2 work tasks today");
    expect(markup).toContain("Ship the handoff");
    expect(markup).toContain("Work OS");
    expect(markup).toContain("3:30 PM");
    expect(markup).toContain("Full record");
    expect(markup).toContain("eod-doc-appendix");
    expect(markup).toContain("eod-doc-title");
    expect(markup).toContain("eod-doc-project");
  });

  it("renders a recap continuation as a quiet note, not another fact", () => {
    const markup = renderToStaticMarkup(createElement(EodReportDocument, { markdown }));
    expect(markup).toContain("eod-doc-note");
    expect(markup).toContain("The interval moved between Work OS");
    const note = markup.match(/<li class="eod-doc-note">[\s\S]*?<\/li>/)?.[0] ?? "";
    expect(note).toContain("The interval moved");
    expect(note).not.toContain("eod-doc-title");
  });

  it("keeps personal tasks in the appendix and out of the brief", () => {
    const markup = renderToStaticMarkup(createElement(EodReportDocument, { markdown }));
    expect(markup).toContain("Choose a walking route");
    expect(markup).toContain("Personal task");
    expect(markup).toContain("Other tasks");
  });
});
