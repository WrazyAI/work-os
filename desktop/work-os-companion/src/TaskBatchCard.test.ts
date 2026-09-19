import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BatchApprovalCards, TaskBatchCard } from "./TaskBatchCard";
import {
  attachFiledProposals,
  batchEntryOutcome,
  batchItemCount,
  fileApprovedOperations,
  filedProposalGroups,
  isBatchToolOp,
  isDestructiveBatchOp,
  isPlanImportOp,
  normalizeInterpretation,
  operationToolCall,
  skipBatchOperation,
  toolCallKey,
  type ApprovalTransport,
  type BatchReviewResult,
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
    expect(markup).toContain('data-workos-tool-surface="batch"');
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

  it("uses explicit action pills and separates an old and new status", () => {
    const markup = render({
      ...editBatch,
      tasks: [{ clientId: "t1", taskId: "t-1", title: "Ship the debugger fix (final)", taskGroupId: "col-done", fromStatus: "In review", toStatus: "Done", subtasks: [] }],
    });
    expect(markup).toContain(">EDIT<");
    expect(markup).toContain(">In review<");
    expect(markup).toContain("task-batch-status-arrow");
    expect(markup).toContain(">Done<");
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
    // The card settles and collapses; the per-entry result is what the expanded
    // accordion reports, so assert it through the shared outcome helper.
    expect(markup).toContain("Filed");
    expect(markup).toContain("is-settled");
    expect(markup).not.toContain("task-batch-list");
    expect(markup).not.toContain("Approve all 4 changes");
    const items = (result.data as { batch: { results: BatchReviewResult[] } }).batch.results;
    expect(batchEntryOutcome(items, "s3")).toMatchObject({ tone: "failed", label: "Needs attention", message: "That task is no longer in your task list." });
    expect(batchEntryOutcome(items, "t1")).toMatchObject({ tone: "ok", label: "Filed" });
  });

  it("offers a retry when the batch itself failed", () => {
    const result: ToolCallResult = { op: addBatch, status: "failed", message: "Nothing was filed. The batch needs attention.", retryable: true };
    const markup = render(addBatch, result);
    expect(markup).toContain("Nothing was filed. The batch needs attention.");
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

  it("keeps a skip in processing when the server has not settled every item", async () => {
    const transport: ApprovalTransport = {
      reviewProposal: async () => ({}),
      reviewBatch: async (batchId, body) => ({
        batch_id: batchId,
        decision: body.decision,
        results: [
          { proposal_id: "p1", client_id: "t1", parent_client_id: null, operation: "create_task", status: "processing", outcome: "processing", message: "Still processing." },
          { proposal_id: "p2", client_id: "s1", parent_client_id: "t1", operation: "add_subtask", status: "skipped", outcome: "skipped", message: "Skipped." },
        ],
        accepted: 0,
        failed: 0,
        skipped: 1,
        outcome: "processing",
      }),
    };
    const result = await skipBatchOperation(addBatch, transport);
    expect(result.status).toBe("processing");
    expect(result.message).toContain("still being processed");
  });

  it("keeps a failed skip retryable instead of calling it skipped", async () => {
    const transport: ApprovalTransport = {
      reviewProposal: async () => ({}),
      reviewBatch: async (batchId, body) => ({
        batch_id: batchId,
        decision: body.decision,
        results: [{ proposal_id: "p1", client_id: "t1", parent_client_id: null, operation: "create_task", status: "failed", outcome: "failed", message: "Provider unavailable." }],
        accepted: 0,
        failed: 1,
        skipped: 0,
        outcome: "failed",
      }),
    };
    const result = await skipBatchOperation(addBatch, transport);
    expect(result.status).toBe("failed");
    expect(result.retryable).toBe(true);
  });

  it("carries an explicit status clear without sending the display title", async () => {
    const calls: Array<{ batchId: string; body: unknown }> = [];
    const operation: ProposedOperation = {
      ...editBatch,
      tasks: [{ clientId: "t1", taskId: "t-1", displayTitle: "Ship the debugger fix", clearTaskGroupId: true, subtasks: [], proposalIds: ["p3"] }],
    };
    const transport: ApprovalTransport = {
      reviewProposal: async () => ({}),
      reviewBatch: async (batchId, body) => {
        calls.push({ batchId, body });
        return { batch_id: batchId, decision: "accept", results: [{ proposal_id: "p3", client_id: "t1", parent_client_id: null, operation: "update_task", status: "applied", outcome: "applied", message: "Recorded." }], accepted: 1, failed: 0, skipped: 0, outcome: "applied" };
      },
    };
    const outcome = await fileApprovedOperations([operation], transport);
    expect(outcome.recorded).toBe(1);
    expect(calls[0]?.body).toMatchObject({ decisions: [{ proposal_id: "p3", clear_fields: ["task_group_id"] }] });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("Ship the debugger fix");
  });
});

const archiveBatch: ProposedOperation = {
  op: "multi_task_archive",
  statement: "Archive the finished work.",
  enabled: true,
  batchId: "batch-archive",
  tasks: [{ clientId: "t1", taskId: "t-1", subtasks: [], proposalIds: ["p1"] }, { clientId: "t2", taskId: "t-2", subtasks: [], proposalIds: ["p2"] }],
};

const logBatch: ProposedOperation = {
  op: "multi_task_log",
  statement: "Note progress on two tasks.",
  enabled: true,
  batchId: "batch-log",
  tasks: [
    { clientId: "t1", taskId: "t-1", description: "Shipped the schema.", subtasks: [], proposalIds: ["p1"] },
    { clientId: "t2", taskId: "t-2", description: "Paired on the review.", subtasks: [], proposalIds: ["p2"] },
  ],
};

const reassignBatch: ProposedOperation = {
  op: "multi_task_reassign",
  statement: "Hand the launch work over.",
  enabled: true,
  batchId: "batch-reassign",
  tasks: [{ clientId: "t1", taskId: "t-1", assigneePersonId: "person-9", subtasks: [], proposalIds: ["p1"] }],
};

const importBatch: ProposedOperation = {
  op: "plan_import",
  statement: "Import the SEO onboarding plan.",
  enabled: true,
  batchId: "batch-import",
  planImport: { blueprintId: "bp-1", clientName: "Acme", startDate: "2026-09-22" },
};

describe("TaskBatchCard — the extra tools", () => {
  it("labels each tool and names its change", () => {
    expect(render(archiveBatch)).toContain("Archive 2 tasks");
    expect(render(archiveBatch)).toContain("Review archiving");
    expect(render({ ...archiveBatch, op: "multi_task_delete" })).toContain("Delete 2 tasks");
    expect(render({ ...archiveBatch, op: "multi_task_delete" })).toContain("Review deletion");
    expect(render(logBatch)).toContain("Log progress on 2 tasks");
    expect(render(reassignBatch)).toContain("Reassign 1 task");
    expect(render(importBatch)).toContain("Import Acme’s plan");
    expect(render(importBatch)).toContain("Review plan import");
  });

  it("uses the danger tone for removal and says what it means", () => {
    const markup = render({ ...archiveBatch, op: "multi_task_delete" });
    expect(markup).toContain("is-destructive");
    expect(markup).toContain("Delete permanently");
    expect(markup).toContain("Deleting removes these tasks permanently.");
    const archive = render(archiveBatch);
    expect(archive).toContain("is-destructive");
    expect(archive).toContain("Archiving hides these tasks from your lists.");
    expect(archive).not.toContain("Delete permanently");
  });

  it("makes a progress note editable and shows the reassignment", () => {
    const log = render(logBatch);
    expect(log).toContain("Shipped the schema.");
    expect(log).toContain("Approve all 2 changes");
    const reassign = render(reassignBatch);
    expect(reassign).toContain("Assign to the named person");
    // A log batch has no status control and no completion statement.
    expect(log).not.toContain("task-batch-status");
    expect(log).not.toContain("Mark this task done");
  });

  it("renders a plan import as one template, not a task table", () => {
    const markup = render(importBatch);
    expect(markup).toContain("Acme");
    expect(markup).toContain("Starting 2026-09-22");
    expect(markup).toContain("Approve import");
    expect(markup).toContain("tasks and steps are created together");
    expect(markup).not.toContain("task-batch-list");
    expect(markup).not.toContain("Approve all");
  });

  it("counts one item per named task for the removal and handoff tools", () => {
    expect(batchItemCount(archiveBatch)).toBe(2);
    expect(batchItemCount(logBatch)).toBe(2);
    expect(batchItemCount(reassignBatch)).toBe(1);
    expect(render(archiveBatch)).toContain("Approve all 2 changes");
    expect(render(reassignBatch)).toContain("Approve all 1 change");
  });

  it("recognizes the new operations and keeps plan_import out of the batch predicate", () => {
    expect(isBatchToolOp(archiveBatch)).toBe(true);
    expect(isBatchToolOp(logBatch)).toBe(true);
    expect(isBatchToolOp(reassignBatch)).toBe(true);
    expect(isBatchToolOp(importBatch)).toBe(false);
    expect(isPlanImportOp(importBatch)).toBe(true);
    expect(isDestructiveBatchOp(archiveBatch)).toBe(true);
    expect(isDestructiveBatchOp({ ...archiveBatch, op: "multi_task_delete" })).toBe(true);
    expect(isDestructiveBatchOp(logBatch)).toBe(false);
  });

  it("renders a plan import card through the grouped renderer", () => {
    const markup = renderToStaticMarkup(createElement(BatchApprovalCards, {
      operations: [importBatch, archiveBatch],
      results: [],
      context,
      onApprove: () => undefined,
      onSkip: () => undefined,
    }));
    expect(markup).toContain("Approve import");
    expect(markup).toContain("Approve all 2 changes");
  });

  it("names the import request and files it without per-entry ids", () => {
    const call = operationToolCall(importBatch, context);
    expect(call.tool).toBe("work_os.proposals.review_batch");
    expect(call.command).toContain("/api/work-os/proposal-batches/batch-import");
  });
});

describe("batch entry titles", () => {
  it("names an id-only entry from the task list the employee sees", () => {
    const review = normalizeInterpretation({
      operations: [{
        op: "multi_task_log",
        statement: "Note progress on two tasks.",
        tasks: [
          { taskId: "t-1", description: "Shipped the schema." },
          { taskId: "t-2", title: "Package the Windows build", description: "Paired on the review." },
        ],
      }],
    }, "note progress", [
      { id: "t-1", title: "Ship the debugger fix" },
      { id: "t-2", title: "Package the Windows build" },
    ]);
    const tasks = review?.operations[0]?.tasks ?? [];
    // The log names only ids, so the card takes the real titles from the list.
    expect(tasks[0]?.displayTitle).toBe("Ship the debugger fix");
    // A stated title wins over the list title.
    expect(tasks[1]?.title).toBe("Package the Windows build");
    expect(tasks[0]?.description).toBe("Shipped the schema.");
  });

  it("does not turn an id-only status edit into a title edit", () => {
    const review = normalizeInterpretation({
      operations: [{ op: "multi_task_edit", statement: "Move the task to done.", tasks: [{ taskId: "t-1", taskGroupId: "col-done" }] }],
    }, "move it", [{ id: "t-1", title: "Ship the debugger fix" }]);
    const task = review?.operations[0]?.tasks?.[0];
    expect(task?.title).toBeUndefined();
    expect(task?.displayTitle).toBe("Ship the debugger fix");
    expect(batchItemCount(review?.operations[0] ?? { op: "multi_task_edit", tasks: [] })).toBe(1);
  });

  it("drops an id-only entry whose task is not in the list", () => {
    const review = normalizeInterpretation({
      operations: [{ op: "multi_task_archive", statement: "Archive.", tasks: [{ taskId: "foreign" }] }],
    }, "archive", [{ id: "t-1", title: "Ship the debugger fix" }]);
    expect(review?.operations ?? []).toHaveLength(0);
  });

  it("parses a plan import and rejects one without a blueprint", () => {
    const review = normalizeInterpretation({
      operations: [
        { op: "plan_import", statement: "Import.", planImport: { blueprintId: "bp-1", clientName: "Acme", startDate: "2026-09-22" } },
        { op: "plan_import", statement: "No template.", planImport: { blueprintId: "" } },
      ],
    }, "import", []);
    expect(review?.operations).toHaveLength(1);
    expect(review?.operations[0]?.planImport).toMatchObject({ blueprintId: "bp-1", clientName: "Acme", startDate: "2026-09-22" });
  });
});

const approvedResult = (op: ProposedOperation): ToolCallResult => ({
  op,
  status: "recorded",
  message: "Filed 2 changes.",
  data: { batch: { results: [
    { proposal_id: "p1", client_id: "t1", parent_client_id: null, operation: "create_task", status: "applied", outcome: "applied", message: "Recorded." },
    { proposal_id: "p2", client_id: "s3", parent_client_id: "t-1", operation: "add_subtask", status: "applied", outcome: "applied", message: "Recorded." },
  ] } },
});

const skippedResult: ToolCallResult = {
  op: addBatch,
  status: "denied",
  message: "Skipped. Nothing from this batch was recorded.",
  data: { batch: { results: [
    { proposal_id: "p1", client_id: "t1", parent_client_id: null, operation: "create_task", status: "rejected", outcome: "rejected", message: "Rejected." },
    { proposal_id: "p2", client_id: "s3", parent_client_id: "t-1", operation: "add_subtask", status: "skipped", outcome: null, message: "Its task was not created, so this step was left alone." },
  ] } },
};

describe("TaskBatchCard — settled states", () => {
  it("keys a batch by its id so a re-mapped copy still matches", () => {
    expect(toolCallKey(addBatch)).toBe("batch-1");
    const remapped: ProposedOperation = { ...addBatch, statement: "A different statement.", tasks: [...(addBatch.tasks ?? [])] };
    expect(toolCallKey(remapped)).toBe("batch-1");
  });

  it("stays settled when the filed result carries a copy of the operation", () => {
    // The host files a copy ({...op, tasks: draft}) and re-maps the turn's
    // operations, so identity matching made an approved card look unapproved —
    // and clickable — again.
    const filedCopy = { ...addBatch, tasks: [...(addBatch.tasks ?? [])] };
    const markup = renderToStaticMarkup(createElement(BatchApprovalCards, {
      operations: [addBatch],
      results: [{ ...approvedResult(filedCopy), op: filedCopy }],
      context,
      onApprove: () => undefined,
      onSkip: () => undefined,
    }));
    expect(markup).toContain("task-batch-card");
    expect(markup).not.toContain("Approve all");
    expect(markup).not.toContain(">Skip<");
  });

  it("collapses an approved card and offers no further action", () => {
    const markup = render(addBatch, approvedResult(addBatch));
    expect(markup).toContain("is-settled");
    expect(markup).not.toContain("task-batch-list");
    expect(markup).not.toContain("Approve all");
    expect(markup).not.toContain("Confirm ");
    expect(markup).not.toContain("Edit these changes");
    expect(markup).not.toContain(">Skip<");
  });

  it("collapses a skipped card into a muted Skipped summary and never claims approval", () => {
    const markup = render(addBatch, skippedResult);
    expect(markup).toContain("is-skipped");
    expect(markup).toContain("Skipped");
    expect(markup).not.toContain("Approved.");
    expect(markup).not.toContain("Approve all");
    expect(markup).not.toContain("Edit these changes");
    expect(markup).not.toContain(">Skip<");
  });

  it("reports a rejected item as Skipped rather than Pending", () => {
    const skippedItems = (skippedResult.data as { batch: { results: BatchReviewResult[] } }).batch.results;
    expect(batchEntryOutcome(skippedItems, "t1")).toMatchObject({ tone: "skipped", label: "Skipped" });
    const approvedItems = (approvedResult(addBatch).data as { batch: { results: BatchReviewResult[] } }).batch.results;
    expect(batchEntryOutcome(approvedItems, "t1")).toMatchObject({ tone: "ok", label: "Filed" });
  });

  it("keeps a failed batch expanded and actionable", () => {
    const markup = render(addBatch, { op: addBatch, status: "failed", message: "Nothing was filed.", retryable: true });
    expect(markup).toContain("task-batch-list");
    expect(markup).toContain("Retry");
    expect(markup).toContain(">Skip<");
    expect(markup).not.toContain("is-settled");
  });
});
