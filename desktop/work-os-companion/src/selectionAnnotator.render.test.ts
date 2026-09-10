import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnnotationPopover, SelectionAnnotator } from "./SelectionAnnotator";

const rect = { top: 100, left: 200, width: 120, height: 18, bottom: 118 };
const annotation = { id: "a-1", target: "summary", start: 0, end: 6, quote: "Review", comment: "Make this a bullet" };

describe("selection annotator", () => {
  it("composes feedback anchored to the highlighted quote", () => {
    const markup = renderToStaticMarkup(createElement(SelectionAnnotator, {
      quote: "Review the draft",
      anchor: rect,
      value: "Make this shorter",
      canSave: true,
      onChange: () => undefined,
      onSave: () => undefined,
      onCancel: () => undefined,
    }));
    expect(markup).toContain('class="selection-annotator"');
    expect(markup).toContain("Review the draft");
    expect(markup).toContain('aria-label="Feedback on the highlighted text"');
    expect(markup).toContain('aria-label="Add feedback"');
    expect(markup).toContain('aria-label="Cancel feedback"');
  });

  it("disables save until the comment is meaningful", () => {
    const markup = renderToStaticMarkup(createElement(SelectionAnnotator, {
      quote: "Review",
      anchor: rect,
      value: "ab",
      canSave: false,
      onChange: () => undefined,
      onSave: () => undefined,
      onCancel: () => undefined,
    }));
    expect(markup).toMatch(/aria-label="Add feedback"[^>]*disabled=""/);
  });

  it("reviews saved annotations with edit and delete", () => {
    const markup = renderToStaticMarkup(createElement(AnnotationPopover, {
      annotations: [annotation],
      anchor: rect,
      onEdit: () => undefined,
      onDelete: () => undefined,
      onClose: () => undefined,
    }));
    expect(markup).toContain('class="annotation-popover"');
    expect(markup).toContain("Make this a bullet");
    expect(markup).toContain("Edit");
    expect(markup).toContain("Delete");
  });
});
