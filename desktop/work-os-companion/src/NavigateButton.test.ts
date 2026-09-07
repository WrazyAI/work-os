import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NavigateButton } from "./NavigateButton";
import { normalizeInterpretation } from "./interpretation";

const TASKS = [{ id: "t-1", title: "Ship the debugger fix" }];

describe("navigate_to_page", () => {
  it("keeps validated destinations and drops anything else", () => {
    const review = normalizeInterpretation({
      operations: [
        { op: "navigate_to_page", statement: "Open the EOD review.", page: "review" },
        { op: "navigate_to_page", statement: "Open nowhere.", page: "admin-console" },
      ],
    }, "take me to my EOD", TASKS);
    expect(review?.operations.map((operation) => operation.op)).toEqual(["navigate_to_page"]);
    expect(review?.operations[0]).toMatchObject({ page: "review", enabled: true });
  });

  it("renders an inline shortcut button", () => {
    const markup = renderToStaticMarkup(createElement(NavigateButton, { page: "review", statement: "EOD due", onNavigate: () => undefined }));
    expect(markup).toContain("Open Review &amp; EOD");
    expect(markup).toContain('class="navigate-button"');
  });
});
