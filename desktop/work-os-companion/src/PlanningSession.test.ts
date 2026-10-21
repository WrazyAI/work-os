import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanningConfirmation, PlanningDocumentText, PlanningSession, planningBuildState, planningPrimaryAction } from "./PlanningSession";

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

  it("bullets every row of a read-only list and keeps annotations on their line", () => {
    const value = "Review the flows\nDocument the changes\nShip the fix";
    const annotations = [{ id: "a1", target: "criteria:ease", start: 17, end: 37, quote: "Document the changes", comment: "Tighten this" }];
    const list = renderToStaticMarkup(createElement(PlanningDocumentText, {
      className: "planning-document-criteria", target: "criteria:ease", value, annotations, editing: false,
      label: "Commitment 1 success criteria", maxLength: 1500, lines: true, onChange: () => undefined,
    }));
    // Every criterion is its own row, so the CSS bullet applies to each one.
    expect(list.match(/class="planning-document-line"/g)?.length).toBe(3);
    // The rendered DOM text keeps the newline separators: selection offsets
    // must match the stored newline-joined value.
    expect(list.replace(/<[^>]*>/g, "")).toBe(value);
    const [, first, second, third] = list.split('class="planning-document-line"');
    expect(first).not.toContain("<mark");
    expect(second).toContain("<mark");
    expect(second).toContain("Document the changes");
    expect(third).not.toContain("<mark");

    const single = renderToStaticMarkup(createElement(PlanningDocumentText, {
      className: "planning-document-criteria", target: "criteria:ease", value, annotations: [], editing: false,
      label: "Commitment 1 success criteria", maxLength: 1500, onChange: () => undefined,
    }));
    expect(single).not.toContain("planning-document-line");
  });
});

describe("PlanningSession Loom source gating", () => {
  it("treats a pasted transcript as a buildable Loom source without a link", () => {
    const state = planningBuildState("", "", "1:04 So, that is just a quick update for me today.", null);
    expect(state.hasLoomSource).toBe(true);
    expect(state.effectiveInput).toContain("Loom recording");
    expect(state.canBuild).toBe(true);
  });

  it("lets Build start before Read Loom, so the click can read the link first", () => {
    const state = planningBuildState("", "https://www.loom.com/share/912e89a68ccc42c5ab5096fec7cd63d6", "", null);
    expect(state.hasLoomSource).toBe(true);
    expect(state.canBuild).toBe(true);
  });

  it("still blocks a recording Loom says is not usable for the day", () => {
    const state = planningBuildState("", "https://www.loom.com/share/912e89a68ccc42c5ab5096fec7cd63d6", "", { usableForDay: false });
    expect(state.canBuild).toBe(false);
  });

  it("keeps the input requirement when there is no Loom source at all", () => {
    expect(planningBuildState("", "", "", null).canBuild).toBe(false);
    expect(planningBuildState("Focus on the release.", "", "", null).canBuild).toBe(true);
  });
});

describe("PlanningSession two-view flow", () => {
  it("confirms a submitted plan once, with OK and no close control", () => {
    const markup = renderToStaticMarkup(createElement(PlanningConfirmation, {
      title: "Plan confirmed",
      body: "Your daily commitments are on the record.",
      onClose: () => undefined,
    }));
    // The plan workspace is gone: the confirmation replaces it.
    expect(markup).not.toContain("planning-session");
    expect(markup).toContain("planning-confirmation-title");
    expect(markup).toContain("Plan confirmed");
    expect(markup).toContain("Your daily commitments are on the record.");
    expect(markup).toContain(">OK<");
    // The checked animation owns the moment, not a spinner or a second action.
    expect(markup).toContain("checked-moment");
    expect(markup).not.toContain("Continue working");
    expect(markup).not.toContain('aria-label="Close planning session"');
    expect(markup).toContain("planning-confirmation-backdrop");
  });

  it("offers one primary action per view", () => {
    expect(planningPrimaryAction("compose", false, false)).toBe("build");
    expect(planningPrimaryAction("compose", true, false)).toBe("review");
    expect(planningPrimaryAction("review", true, false)).toBe("confirm");
    expect(planningPrimaryAction("compose", false, true)).toBe("confirm");
  });

  it("opens on the input view without the removed helper copy", () => {
    const markup = renderToStaticMarkup(createElement(PlanningSession, props));
    expect(markup).toContain('class="planning-session-body is-compose"');
    expect(markup).toContain("What should today");
    expect(markup).toContain("Build my plan");
    // The drafted plan is its own view: the input view never renders the
    // review screen or the back control that returns from it.
    expect(markup).not.toContain("Review commitments");
    expect(markup).not.toContain('className="planning-back"');
    // The mechanical helper copy no longer ships with the input view.
    expect(markup).not.toContain("Your words stay attached");
    expect(markup).not.toContain("Read the date first");
    expect(markup).not.toContain("reads the recording's own transcript");
    expect(markup).not.toContain("Nothing is filed from the recording");
  });
});
