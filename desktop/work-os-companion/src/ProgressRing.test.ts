import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProgressRing } from "./ProgressRing";

describe("ProgressRing", () => {
  it("draws an SVG stroke ring whose offset follows the progress", () => {
    const markup = renderToStaticMarkup(createElement(ProgressRing, { completed: 3, total: 5, label: "subtasks" }));
    expect(markup).toContain('class="progress-ring-track"');
    expect(markup).toContain('class="progress-ring-fill"');
    expect(markup).toContain('stroke-dasharray="');
    expect(markup).toContain('stroke-dashoffset="');
    expect(markup).toContain(">3/5<");
    expect(markup).toContain('aria-label="3 of 5 subtasks, 60%"');
  });

  it("renders the hero shape with center content and a trailing label", () => {
    const markup = renderToStaticMarkup(createElement(ProgressRing, {
      completed: 2,
      total: 4,
      size: 44,
      stroke: 5,
      label: "tasks done",
      trailing: "tasks done",
      children: [createElement("strong", { key: "n" }, "2"), createElement("small", { key: "of" }, "of 4")],
    }));
    expect(markup).toContain('class="progress-ring-center"');
    expect(markup).toContain("tasks done");
    expect(markup).not.toContain(">2/4<");
  });

  it("clamps impossible totals and never divides by zero", () => {
    const empty = renderToStaticMarkup(createElement(ProgressRing, { completed: 0, total: 0, label: "subtasks" }));
    expect(empty).toContain("0 of 0 subtasks, 0%");
    const over = renderToStaticMarkup(createElement(ProgressRing, { completed: 9, total: 4, label: "subtasks" }));
    expect(over).toContain("4 of 4 subtasks, 100%");
  });
});
