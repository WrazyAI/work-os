import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TaskRemovalConfirmation } from "./taskSurfaces";

describe("EOD draft removal confirmation", () => {
  it("names the draft and states that the removal is permanent", () => {
    const markup = renderToStaticMarkup(createElement(TaskRemovalConfirmation, {
      mode: "delete",
      scope: "draft",
      title: "EOD Report: Sam Rivera — Sep 30, 2026",
      subtaskCount: 0,
      busy: false,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }));
    expect(markup).toContain("Permanently delete this draft?");
    expect(markup).toContain("EOD Report: Sam Rivera — Sep 30, 2026");
    expect(markup).toContain("will be permanently removed from Work OS and cannot be restored");
    expect(markup).toContain("Delete draft");
    expect(markup).toContain("Cancel");
  });

  it("keeps the task wording untouched", () => {
    const markup = renderToStaticMarkup(createElement(TaskRemovalConfirmation, {
      mode: "delete",
      scope: "task",
      title: "Settle the invoice",
      subtaskCount: 2,
      busy: false,
      onCancel: () => undefined,
      onConfirm: () => undefined,
    }));
    expect(markup).toContain("Permanently delete this task?");
    expect(markup).toContain("Its 2 remaining subtasks will also be permanently deleted.");
    expect(markup).toContain("Delete permanently");
  });
});
