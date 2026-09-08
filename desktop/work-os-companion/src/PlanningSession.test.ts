import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanningSession } from "./PlanningSession";

const props = {
  open: true,
  plan: null,
  active: true,
  busy: false,
  onClose: () => undefined,
  onInterpret: () => Promise.reject(new Error("no AI in tests")),
  onRefine: () => Promise.reject(new Error("no AI in tests")),
  onConfirm: () => Promise.resolve("failed" as const),
};

describe("PlanningSession footer gating", () => {
  it("requires Build before Confirm can appear", () => {
    const markup = renderToStaticMarkup(createElement(PlanningSession, props));
    expect(markup).toContain("Plan your day");
    expect(markup).toContain("What do you want to get done today?");
    expect(markup).toContain("Build my plan");
    expect(markup).toContain("Refine plan");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Confirm my day");
    expect(markup).not.toContain("Annotation");
  });
});
