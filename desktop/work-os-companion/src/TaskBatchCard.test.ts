import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BatchApprovalCards, TaskBatchCard } from "./TaskBatchCard";
import {
  attachFiledProposals,
  filedProposalGroups,
  isBatchToolOp,
  operationToolCall,
  skipBatchOperation,
  type ApprovalTransport,
  type ProposedOperation,
  type ToolCallResult,
} from "./interpretation";

const context = { shiftDate: "2026-09-18", personId: "person-1", promptKind: "optional" };

const addBatch: ProposedOperation = {
  op: "multi_task_add",
  statement: "Add the launch checklist.",
  enabled: true,
  batchId: "batch-1",
  tasks: [
    {
      clientId: "t1",
      title: "Draft the launch plan",
      description: "Cover scope and owners.",
      subtasks: [
        { clientId: "s1", title: "Collect inputs" },
        { clientId: "s2", title: "Circulate for review", description: "Two days ahead." },
      ],
      proposalIds: ["p1"],
    },
    { clientId: "t2", taskId: "t-1", subtasks: [{ clientId: "s3", title: "Verify the fixture" }], proposalIds: ["p2"] },
  ],
};

const editBatch: ProposedOperation = {
  op: "multi_task_edit",
  statement: "Move two tasks on.",
  enabled: true,
  batchId: "batch-2",
  tasks: [
    { clientId: "t1", taskId: "t-1", title: "Ship the debugger fix (final)", taskGroupId: "col-done", subtasks: [], proposalIds: ["p3"] },
    { clientId: "t2", taskId: "t-2", completed: true, subtasks: [], proposalIds: ["p4"] },
  ],
};

function render(operation: ProposedOperation, result?: ToolCallResult) {
  return renderToStaticMarkup(createElement(TaskBatchCard, {
    operation,
    result,
    context,
    onApprove: () => undefined,
    onSkip: () => undefined,
    onRetry: () => undefined,
  }));
}

describe("TaskBatchCard", () => {
  it("shows the whole batch as numbered entries with their steps", () => {
    const markup = render(addBatch);
    expect(markup).toContain("Add 1 task with 3 steps");
    expect(markup).toContain("Draft the launch plan");
    expect(markup).toContain("Cover scope and owners.");
    expect(markup).toContain("Collect inputs");
    expect(markup).toContain("Circulate for review");
    expect(markup).toContain("Existing task");
    expect(markup).toContain("Review new tasks");
    // It reads like a document, not a form: no editing fields until the pencil.
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<textarea");
    expect(markup).toContain('aria-pressed="false"');
  });

  it("arms the approval before it files anything", () => {
    const markup = render(addBatch);
    expect(markup).toContain("Approve all 4 changes");
    expect(markup).toContain("Skip");
    expect(markup).not.toContain("Confirm 4 changes");
    expect(markup).toContain("Check the tasks and steps, then approve them together.");
  });

  it("names the exact request it will make", () => {
    const markup = render(addBatch);
    expect(markup).toContain("Technical details");
    expect(markup).toContain("POST /api/work-os/proposal-batches/batch-1");
  });

  it("summarizes an edit batch and marks completion entries", () => {
    const markup = render(editBatch);
    expect(markup).toContain("Update 2 tasks");
    expect(markup).toContain("Review changes");
    expect(markup).toContain("Move to the proposed status");
    expect(markup).toContain("Mark this task done");
    expect(markup).toContain("Approve all 2 changes");
  });

  it("reports each entry after filing and stops offering edits", () => {
    const result: ToolCallResult = {
      op: addBatch,
      status: "recorded",
      message: "Filed 2 changes.",
      data: {
        batch: {
          results: [
            { proposal_id: "p1", client_id: "t1", parent_client_id: null, operation: "create_task", status: "applied", outcome: "applied", message: "Recorded." },
            { proposal_id: "p2", client_id: "s3", parent_client_id: "t-1", operation: "add_subtask", status: "failed", outcome: "failed", message: "That task is no longer in your task list." },
          ],
        },
      },
    };
    const markup = render(addBatch, result);
    expect(markup).toContain("Filed");
    expect(markup).toContain("Needs attention");
    expect(markup).toContain("That task is no longer in your task list.");
    expect(markup).toContain("Approved. Each item reports its own result below.");
    expect(markup).not.toContain("Approve all 4 changes");
  });

  it("offers a retry when the batch itself failed", () => {
    const result: ToolCallResult = { op: addBatch, status: "failed", message: "Nothing was filed. The batch needs attention.", retryable: true };
    const markup = render(addBatch, result);
    expect(markup).toContain("Some items could not be filed. Nothing else was changed.");
    expect(markup).toContain("Retry");
    expect(markup).toContain("Skip");
  });

  it("renders one card per batch and leaves the rest to the shared card", () => {
    const single: ProposedOperation = { op: "complete_task", statement: "Finish the review.", taskId: "t-9", proposalId: "p9", enabled: true };
    const markup = renderToStaticMarkup(createElement(BatchApprovalCards, {
      operations: [addBatch, single],
      results: [],
      context,
      onApprove: () => undefined,
      onSkip: () => undefined,
    }));
    expect(markup).toContain("task-batch-card");
    expect(markup).toContain("Add 1 task with 3 steps");
    expect(markup).not.toContain("Finish the review.");
    const none = renderToStaticMarkup(createElement(BatchApprovalCards, {
      operations: [single],
      results: [],
      context,
      onApprove: () => undefined,
      onSkip: () => undefined,
    }));
    expect(none).toBe("");
  });
});

describe("batch filing helpers", () => {
  it("recognizes batch operations", () => {
    expect(isBatchToolOp(addBatch)).toBe(true);
    expect(isBatchToolOp(editBatch)).toBe(true);
    const single: ProposedOperation = { op: "create_task", statement: "x", enabled: true };
    expect(isBatchToolOp(single)).toBe(false);
  });

  it("names the batch request for a card that has filed", () => {
    const call = operationToolCall(addBatch, context);
    expect(call.tool).toBe("work_os.proposals.review_batch");
    expect(call.command).toContain("/api/work-os/proposal-batches/batch-1");
    expect(call.command).toContain("4 item(s)");
  });

  it("groups filed rows by the operation they came from", () => {
    const groups = filedProposalGroups(
      [
        { id: "p1", client_operation_index: 0, client_id: "t1", batch_id: "batch-1", batch_index: 0 },
        { id: "p2", client_operation_index: 0, client_id: "s1", batch_id: "batch-1", batch_index: 1 },
        { id: "p3", client_operation_index: 1, client_id: null },
      ],
      (clientOperationIndex) => [3, 4, 5][clientOperationIndex],
    );
    expect([...groups.keys()].sort()).toEqual([3, 4]);
    expect(groups.get(3)?.map((row) => row.id)).toEqual(["p1", "p2"]);
    expect(groups.get(4)?.map((row) => row.id)).toEqual(["p3"]);
  });

  it("attaches a batch id and gives every entry the ids it filed", () => {
    const attached = attachFiledProposals({
      op: "multi_task_add",
      statement: "Add the launch checklist.",
      enabled: true,
      tasks: [{ clientId: "t1", title: "Draft the launch plan", subtasks: [{ clientId: "s1", title: "Collect inputs" }] }],
    }, [
      { id: "p1", client_operation_index: 0, client_id: "t1", batch_id: "batch-1", batch_index: 0 },
      { id: "p2", client_operation_index: 0, client_id: "s1", batch_id: "batch-1", batch_index: 1 },
    ]);
    expect(attached.batchId).toBe("batch-1");
    expect(attached.tasks?.[0]?.proposalIds).toEqual(["p1"]);
    expect(attached.tasks?.[0]?.subtasks[0]?.proposalIds).toEqual(["p2"]);
    expect(attached.proposalId).toBeUndefined();
  });

  it("keeps the single-operation contract for everything else", () => {
    const attached = attachFiledProposals(
      { op: "complete_task", statement: "Finish the review.", taskId: "t-1", enabled: true },
      [{ id: "p1", client_operation_index: 0 }],
    );
    expect(attached.proposalId).toBe("p1");
    expect(attached.batchId).toBeUndefined();
  });

  it("skips a whole batch with one reject decision", async () => {
    const calls: Array<{ batchId: string; body: unknown }> = [];
    const transport: ApprovalTransport = {
      reviewProposal: async () => ({}),
      reviewBatch: async (batchId, body) => {
        calls.push({ batchId, body });
        return { batch_id: batchId, decision: "reject", results: [], accepted: 0, failed: 0, skipped: 0, outcome: "applied" };
      },
    };
    const result = await skipBatchOperation(addBatch, transport);
    expect(result.status).toBe("denied");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.batchId).toBe("batch-1");
    expect(calls[0]?.body).toMatchObject({ decision: "reject", decisions: [] });
  });
});
