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
  it("shows one bounded decision with editable wording and disclosed transport details", () => {
    const markup = renderToStaticMarkup(createElement(ApprovalFlow, {
      operations,
      taskOptions: [{ id: "task-1", title: "Review launch" }],
      context: { shiftDate: "2026-09-11", personId: "person-1", promptKind: "optional" },
      onSubmit: () => undefined,
    }));

    expect(markup).toContain("Action 1 of 2");
    expect(markup).toContain("Mark “Review launch” done?");
    expect(markup).toContain("Proposed wording");
    expect(markup).toContain("Technical details");
    expect(markup).not.toContain("Shared the launch notes");
  });

  it("renders truthful result states after recording", () => {
    const results: ToolCallResult[] = [
      { op: operations[0]!, status: "recorded", message: "Recorded in Nifty." },
      { op: operations[1]!, status: "failed", message: "Provider unavailable." },
    ];
    const markup = renderToStaticMarkup(createElement(ApprovalResults, { results }));

    expect(markup).toContain("Action results");
    expect(markup).toContain("Recorded in Nifty.");
    expect(markup).toContain("Provider unavailable.");
    expect(markup).toContain("Failed");
  });
});
