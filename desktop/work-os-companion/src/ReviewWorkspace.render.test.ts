import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReviewWorkspace } from "./App";

describe("ReviewWorkspace", () => {
  it("renders non-recap proposals with their statement and decision", () => {
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
    expect(markup).toContain("Log progress");
    expect(markup).toContain("Phase 1 runtime is ready for review");
    expect(markup).toContain("Approve change");
    expect(markup).toContain("review-page");
    expect(markup).toContain("Proposals awaiting review");
  });

  it("explains a stale proposal instead of claiming it has a decision", () => {
    const markup = renderToStaticMarkup(createElement(ReviewWorkspace, {
      proposals: [{
        id: "proposal-3",
        operation: "update_task",
        status: "stale",
        input_text: "Move this task to In review.",
        proposed_change: { task_group_id: "group-1" },
        source_interval_id: null,
      }],
      busy: false,
      onReject: () => undefined,
      onApprove: () => undefined,
    }));
    expect(markup).toContain("This suggestion is outdated because the task changed; it was not applied.");
    expect(markup).not.toContain("This proposal already has a recorded decision.");
  });
});
