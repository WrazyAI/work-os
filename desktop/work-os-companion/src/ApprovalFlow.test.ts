import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalFlow, ApprovalResults, settleDecisions } from "./ApprovalFlow";
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
    expect(markup).toContain('data-workos-tool-surface="approval"');
    expect(markup).toContain("Mark “Review launch” done?");
    expect(markup).toContain("Technical details");
    // The card is feedback, not an editor: no wording field, no task remapping.
    expect(markup).not.toContain("Proposed wording");
    expect(markup).not.toContain("Apply to task");
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("<textarea");
    // The decision question carries the action; the card shows no separate
    // proposed-action section, so the statement never renders.
    expect(markup).not.toContain("Proposed action");
    expect(markup).not.toContain("Finish the review");
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
      { op: operations[0]!, status: "recorded", message: "Recorded." },
      { op: blocker, status: "processing", message: "Still processing this change." },
      { op: operations[1]!, status: "failed", message: "Provider unavailable." },
    ];
    const markup = renderToStaticMarkup(createElement(ApprovalResults, { results }));

    expect(markup).toContain("Action results");
    expect(markup).toContain('data-workos-tool-surface="action-results"');
    expect(markup).toContain("Recorded.");
    expect(markup).toContain("Provider unavailable.");
    expect(markup).toContain("Failed");
    expect(markup).toContain("Processing");
    expect(markup).toContain("Still processing");
  });

  it("does not count queued actions as recorded", () => {
    const queued: ToolCallResult = { op: operations[0]!, status: "queued", message: "Queued locally." };
    const markup = renderToStaticMarkup(createElement(ApprovalResults, {
      results: [queued, { op: operations[1]!, status: "recorded", message: "Recorded." }],
    }));

    expect(markup).toContain("1 recorded · 1 queued");
    expect(markup).not.toContain("2 actions recorded");
  });

  it("collapses to an action-count summary and opens itself when something failed", () => {
    const recorded: ToolCallResult[] = [
      { op: operations[0]!, status: "recorded", message: "Recorded." },
      { op: operations[1]!, status: "recorded", message: "Recorded." },
    ];
    const calm = renderToStaticMarkup(createElement(ApprovalResults, { results: recorded }));
    expect(calm).toContain("2 actions recorded");
    expect(calm).toContain('aria-expanded="false"');
    expect(calm).toContain('aria-controls="');
    expect(calm).toContain('title="Expand action results"');
    expect(calm).toMatch(/class="approval-results-body"[^>]*hidden/);

    const failing: ToolCallResult[] = [
      { op: operations[0]!, status: "recorded", message: "Recorded." },
      { op: operations[1]!, status: "failed", message: "Provider unavailable." },
    ];
    const alert = renderToStaticMarkup(createElement(ApprovalResults, { results: failing }));
    expect(alert).toContain("1 recorded · 1 failed");
    expect(alert).toContain('aria-expanded="true"');
    expect(alert).toContain('title="Collapse action results"');
    expect(alert).not.toMatch(/class="approval-results-body"[^>]*hidden/);

    const single = renderToStaticMarkup(createElement(ApprovalResults, { results: [recorded[0]!] }));
    expect(single).toContain("1 action recorded");
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

  it("names the clear-and-retry recovery when the create outcome is unknown", () => {
    const uncreated = { ...operations[1]!, op: "create_task" as const, taskTitle: "New work" };
    const results: ToolCallResult[] = [
      { op: uncreated, status: "failed", message: "A previous attempt may have created this task earlier but it is not listed yet.", retryable: true, createResolution: "no_task_created" },
    ];
    const markup = renderToStaticMarkup(createElement(ApprovalResults, { results, onRetry: () => undefined }));

    expect(markup).toContain("Nothing was created — retry");
    expect(markup).not.toContain(">Retry</button>");
  });

  it("files nothing until every action is decided", () => {
    const pending = operations.map((op, index) => ({ op, index }));
    expect(settleDecisions(pending, {})).toBeNull();
    expect(settleDecisions(pending, { "proposal-1": "approve" })).toBeNull();
  });

  it("settles the batch once the last action is decided — no second confirmation", () => {
    const pending = operations.map((op, index) => ({ op, index }));
    const settled = settleDecisions(pending, { "proposal-1": "approve", "proposal-2": "skip" });
    expect(settled).not.toBeNull();
    expect(settled!.approved.map((op) => op.proposalId)).toEqual(["proposal-1"]);
    expect(settled!.rejected.map((op) => op.proposalId)).toEqual(["proposal-2"]);
  });

  it("settles an all-approved batch in one pass", () => {
    const pending = operations.map((op, index) => ({ op, index }));
    const settled = settleDecisions(pending, { "proposal-1": "approve", "proposal-2": "approve" });
    expect(settled!.approved).toHaveLength(2);
    expect(settled!.rejected).toHaveLength(0);
  });

  it("no longer renders a final review step", () => {
    const markup = renderToStaticMarkup(createElement(ApprovalFlow, {
      operations,
      context: { shiftDate: "2026-09-11", personId: "person-1", promptKind: "optional" },
      onSubmit: () => undefined,
    }));
    expect(markup).not.toContain("Final review");
    expect(markup).not.toContain("Approve & record");
  });
});
