import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanningDocumentText, PlanningSession } from "./PlanningSession";

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
    expect(markup).toContain("What should today");
    expect(markup).toContain("plan focus on?");
    expect(markup).toContain("Build my plan");
    expect(markup).toContain("Refine plan");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Confirm my day");
    expect(markup).not.toContain("Annotation");
  });

  it("leaves editable document text to the DOM so typing cannot reset the caret", () => {
    const base = { className: "planning-document-title", target: "title:ease", value: "Improve Work OS ease of use", annotations: [], label: "Commitment 1 title", maxLength: 240, onChange: () => undefined };
    const editing = renderToStaticMarkup(createElement(PlanningDocumentText, { ...base, editing: true }));
    // React must not render the value as a child while editing; the layout
    // effect fills it so the text node is never re-set under the caret.
    expect(editing).toMatch(/contenteditable="true"/i);
    expect(editing).not.toContain("Improve Work OS ease of use");

    const readOnly = renderToStaticMarkup(createElement(PlanningDocumentText, { ...base, editing: false }));
    expect(readOnly).toContain("Improve Work OS ease of use");
  });
});
