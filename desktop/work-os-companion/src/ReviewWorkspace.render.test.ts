import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewWorkspace } from "./App";

describe("ReviewWorkspace", () => {
  it("labels recap-sourced suggestions with their provenance and offers the decision", () => {
    const markup = renderToStaticMarkup(createElement(ReviewWorkspace, {
      proposals: [{
        id: "proposal-1",
        operation: "complete_task",
        status: "pending",
        input_text: "The render tests pass and the card renders, so this task looks finished.",
        proposed_change: {},
        source_interval_id: "interval-1",
        task_id: "task-1",
      }],
      busy: false,
      onReject: () => undefined,
      onApprove: () => undefined,
    }));
    expect(markup).toContain("From your recap");
    expect(markup).toContain("The render tests pass and the card renders");
    expect(markup).toContain("Approve change");
    expect(markup).toContain("Reject");
    expect(markup).toContain("review-page");
    expect(markup).toContain("Proposals awaiting review");
  });

  it("keeps non-recap proposals on the operation label", () => {
    const markup = renderToStaticMarkup(createElement(ReviewWorkspace, {
      proposals: [{
        id: "proposal-2",
        operation: "log_progress",
        status: "pending",
        input_text: "Finished the runtime flow.",
        proposed_change: { summary: "Phase 1 runtime is ready for review" },
        source_interval_id: null,
      }],
      busy: false,
      onReject: () => undefined,
      onApprove: () => undefined,
    }));
    expect(markup).not.toContain("From your recap");
    expect(markup).toContain("Log progress");
    expect(markup).toContain("Phase 1 runtime is ready for review");
  });
});
