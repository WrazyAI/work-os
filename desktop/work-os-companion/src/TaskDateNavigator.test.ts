import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskDateNavigator } from "./TaskDateNavigator";

describe("TaskDateNavigator", () => {
  it("renders a masthead date control with a bounded next day", () => {
    const markup = renderToStaticMarkup(createElement(TaskDateNavigator, {
      currentDate: "2026-09-22",
      selectedDate: "2026-09-21",
      onDate: () => undefined,
    }));

    expect(markup).toContain('aria-label="Tasks date navigation"');
    expect(markup).toContain('aria-label="Workspace date"');
    expect(markup).not.toContain('aria-label="Next day" disabled');
  });

  it("disables forward navigation on the current workday", () => {
    const markup = renderToStaticMarkup(createElement(TaskDateNavigator, {
      currentDate: "2026-09-22",
      selectedDate: "2026-09-22",
      onDate: () => undefined,
    }));

    expect(markup).toContain('aria-label="Next day" disabled');
  });
});
