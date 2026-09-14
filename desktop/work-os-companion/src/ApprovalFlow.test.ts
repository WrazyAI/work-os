import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalFlow, ApprovalResults } from "./ApprovalFlow";
import type { ProposedOperation, ToolCallResult } from "./interpretation";

const operations: ProposedOperation[] = [
  { op: "complete_task", statement: "Finish the review", taskId: "task-1", taskTitle: "Review launch", proposalId: "proposal-1", enabled: false },
  { op: "record_progress", statement: "Shared the launch notes", taskId: "task-2", taskTitle: "Launch notes", proposalId: "proposal-2", enabled: false },
];

describe("ApprovalFlow", () => {
  it("shows one bounded decision as read-only feedback with disclosed transport details", () => {
    const markup = renderToStaticMarkup(createElement(ApprovalFlow, {
      operations,
      context: { shiftDate: "2026-09-11", personId: "person-1", promptKind: "optional" },
      onSubmit: () => undefined,
    }));

    expect(markup).toContain("Action 1 of 2");
    expect(markup).toContain("Mark “Review launch” done?");
    expect(markup).toContain("Finish the review");
    expect(markup).toContain("Technical details");
    // The card is feedback, not an editor: no wording field, no task remapping.
    expect(markup).not.toContain("Proposed wording");
    expect(markup).not.toContain("Apply to task");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("Shared the launch notes");
  });

  it("flags a mutating action that lost its task instead of offering an editable picker", () => {
    const dangling: ProposedOperation[] = [
      { op: "complete_task", statement: "Mark done", proposalId: "proposal-9", enabled: false },
    ];
    const markup = renderToStaticMarkup(createElement(ApprovalFlow, {
      operations: dangling,
      context: { shiftDate: "2026-09-11", personId: "person-1", promptKind: "optional" },
      onSubmit: () => undefined,
    }));
    expect(markup).toContain("approval-unresolved");
    expect(markup).toContain("no task attached");
  });

  it("renders truthful result states after recording", () => {
    const blocker: ProposedOperation = { op: "record_blocker", statement: "Waiting on access", taskId: "task-3", taskTitle: "Access review", proposalId: "proposal-3", enabled: false };
    const results: ToolCallResult[] = [
      { op: operations[0]!, status: "recorded", message: "Recorded in Nifty." },
      { op: blocker, status: "processing", message: "Still processing this change." },
      { op: operations[1]!, status: "failed", message: "Provider unavailable." },
    ];
    const markup = renderToStaticMarkup(createElement(ApprovalResults, { results }));

    expect(markup).toContain("Action results");
    expect(markup).toContain("Recorded in Nifty.");
    expect(markup).toContain("Provider unavailable.");
    expect(markup).toContain("Failed");
    expect(markup).toContain("Processing");
    expect(markup).toContain("Still processing");
  });

  it("offers a retry for an unfiled proposal and keeps it actionable", () => {
    const results: ToolCallResult[] = [
      { op: operations[0]!, status: "failed", message: "Not filed. Safe to retry.", retryable: true },
      { op: operations[1]!, status: "failed", message: "Provider rejected the change." },
    ];
    const markup = renderToStaticMarkup(createElement(ApprovalResults, { results, onRetry: () => undefined }));

    expect(markup).toContain("approval-retry");
    expect(markup).toContain(">Retry</button>");
    // Only the retryable failure gets the control.
    expect(markup.match(/>Retry<\/button>/g)).toHaveLength(1);
  });
});
