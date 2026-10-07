import { describe, expect, it } from "vitest";
import { disableDecidedOperations, fileApprovedOperations, interpretationFallbackReason, mergeToolResults, normalizeInterpretation, operationLabel, operationToolCall, partialFilingMessage, pendingApprovalCount, proposalApprovalCommand, sameToolCall, toolCallKey } from "./interpretation";

const TASKS = [{ id: "t-1", title: "Ship the debugger fix" }, { id: "t-2", title: "Package the build" }];

describe("normalizeInterpretation", () => {
  it("normalizes a ready interpretation into reviewable operations", () => {
    const review = normalizeInterpretation({
      operations: [
        { op: "complete_task", statement: "Mark the debugger fix complete.", taskId: "t-1" },
        { op: "create_task", statement: "Package the signed installer.", taskTitle: "Package the signed installer" },
      ],
    }, "debugger fix done, installer next", TASKS);
    expect(review?.operations).toHaveLength(2);
    expect(review?.operations[0]).toMatchObject({ op: "complete_task", taskId: "t-1", enabled: true });
    expect(review?.operations[1]?.taskTitle).toBe("Package the signed installer");
    expect(operationLabel("complete_task")).toBe("Mark done:");
  });

  it("keeps every supported AI operation reviewable before filing", () => {
    const review = normalizeInterpretation({
      operations: [
        { op: "record_progress", statement: "Continued the debugger fix.", taskId: "t-1" },
        { op: "record_blocker", statement: "Waiting for the signing certificate.", taskId: "t-1" },
        { op: "complete_task", statement: "Finished the debugger fix.", taskId: "t-1" },
        { op: "reopen_task", statement: "Reopened the debugger fix.", taskId: "t-1" },
        { op: "create_task", statement: "Package the release.", taskTitle: "Package the release" },
      ],
    }, "Update my work", TASKS);

    expect(review?.operations.map((operation) => operation.op)).toEqual([
      "record_progress", "record_blocker", "complete_task", "reopen_task", "create_task",
    ]);
    expect(review?.operations.every((operation) => operation.enabled)).toBe(true);
  });

  it("drops operations with unknown task ids and structural surprises", () => {
    const review = normalizeInterpretation({
      operations: [
        { op: "complete_task", statement: "Foreign id.", taskId: "other-org" },
        { op: "record_progress", statement: "No id at all." },
        { op: "nonsense_op", statement: "Unknown kind." },
        "<script>alert(1)</script>",
      ],
    }, "update", TASKS);
    expect(review?.operations ?? []).toHaveLength(0);
  });

  it("sanitizes hostile or malformed text into safe fallback copy", () => {
    const review = normalizeInterpretation({
      operations: [{ op: "create_task", statement: { evil: true }, taskTitle: "[object Object]" }],
    }, "update", TASKS);
    // Nothing usable survived sanitizing and there is no chat reply either,
    // so the caller falls back to the manual classifier.
    expect(review).toBeNull();
  });

  it("returns null for non-object payloads so the UI falls back to manual", () => {
    expect(normalizeInterpretation("garbage", "update", TASKS)).toBeNull();
    expect(normalizeInterpretation(null, "update", TASKS)).toBeNull();
    expect(normalizeInterpretation({ operations: "nope" }, "update", TASKS)).toBeNull();
  });

  it("maps failures to human fallback reasons", () => {
    expect(interpretationFallbackReason(new Error("AI interpretation unavailable (503)"))).toContain("unavailable");
    expect(interpretationFallbackReason(new Error("fetch failed: offline"))).toContain("offline");
    expect(interpretationFallbackReason(new Error("The assistant couldn't read that update."))).toContain("couldn't");
    expect(interpretationFallbackReason({ reason: "ai_malformed", message: "invalid response" })).toContain("couldn't");
    expect(interpretationFallbackReason({ reason: "nifty_failure", message: "Nifty unavailable" })).toContain("tasks");
  });

  it("surfaces server filing errors verbatim so stale-task copy is actionable", () => {
    expect(interpretationFallbackReason(new Error("That task is no longer in your task list. Refresh and try again.")))
      .toContain("no longer in your task list");
  });

  it("summarizes a partially filed completion batch without hiding the reason", () => {
    expect(partialFilingMessage(0, [{ title: "Fix the build", error: "That task is not assigned to you." }]))
      .toBe("That task is not assigned to you.");
    const partial = partialFilingMessage(2, [{ title: "Fix the build", error: "That task is no longer in your task list. Refresh and try again." }]);
    expect(partial).toContain("1 of 3 tasks could not be filed");
    expect(partial).toContain("Fix the build");
    expect(partial).toContain("no longer in your task list");
    expect(partialFilingMessage(1, [{ title: "A", error: "x" }, { title: "B", error: "y" }, { title: "C", error: "z" }]))
      .toContain("(A, B…");
  });
});

import { extractBottleneckAnswer, extractBottleneckSection, restoreBottleneckSection, stripBottleneckSection, stripPlaceholderBottleneck } from "./interpretation";

describe("EOD composer helpers", () => {
  it("strips any existing bottleneck section before refine sends the narrative", () => {
    const stripped = stripBottleneckSection("## Summary\nA day.\n## Bottleneck\n(needs your input — what prevented you from completing your task list?)");
    expect(stripped).toBe("## Summary\nA day.");
  });

  it("reads a real answer out of the report draft and rejects the placeholder", () => {
    expect(extractBottleneckAnswer("## Summary\nA day.")).toBe("");
    expect(extractBottleneckAnswer("## Summary\nA day.\n\n## Bottleneck\n(needs your input — what prevented you from completing your task list?)")).toBe("");
    expect(extractBottleneckAnswer("## Summary\nA day.\n\n## Bottleneck\n   ")).toBe("");
    expect(extractBottleneckAnswer("## Summary\nA day.\n\n## Bottleneck\nThe signing certificate was still pending."))
      .toBe("The signing certificate was still pending.");
  });

  it("never shows or files the legacy placeholder, but keeps a real bottleneck section", () => {
    expect(stripPlaceholderBottleneck("## Summary\nA day.\n\n## Bottleneck\n(needs your input — what prevented you from completing your task list?)"))
      .toBe("## Summary\nA day.");
    const recorded = "## Summary\nA day.\n\n## Bottleneck\nWaiting on finance.";
    expect(stripPlaceholderBottleneck(recorded)).toBe(recorded);
    expect(stripPlaceholderBottleneck("## Summary\nA day.")).toBe("## Summary\nA day.");
  });

  it("strips only the exact Bottleneck section and keeps other sections", () => {
    expect(stripBottleneckSection("## Summary\nA day.\n\n## Bottleneck\nWaiting on finance.\n\n## Notes\nExtra context."))
      .toBe("## Summary\nA day.\n\n## Notes\nExtra context.");
    const analysis = "## Summary\nA day.\n\n## Bottleneck analysis\nLate starts were common.";
    expect(stripBottleneckSection(analysis)).toBe(analysis);
  });

  it("extracts the exact section for preservation across refine", () => {
    expect(extractBottleneckSection("## Summary\nA day.\n\n## Bottleneck\nWaiting on finance.\n\n## Notes\nExtra."))
      .toBe("## Bottleneck\nWaiting on finance.");
    expect(extractBottleneckSection("## Summary\nA day.")).toBe("");
  });

  it("restores a preserved section onto a refined draft exactly once", () => {
    expect(restoreBottleneckSection("## Summary\nRefined.", "## Bottleneck\nWaiting on finance."))
      .toBe("## Summary\nRefined.\n\n## Bottleneck\nWaiting on finance.");
    expect(restoreBottleneckSection("## Summary\nRefined.\n\n## Bottleneck\nKept.", "## Bottleneck\nWaiting on finance."))
      .toBe("## Summary\nRefined.\n\n## Bottleneck\nKept.");
    expect(restoreBottleneckSection("## Summary\nRefined.", "")).toBe("## Summary\nRefined.");
  });
});

describe("fileApprovedOperations", () => {
  const ops = (overrides: Array<Partial<import("./interpretation").ProposedOperation>>) => overrides.map((o) => ({
    op: "record_progress" as const, statement: "Did the work.", enabled: true, proposalId: "proposal-1", ...o,
  })) as import("./interpretation").ProposedOperation[];

  it("accepts only persisted proposals and counts receipts", async () => {
    const calls: string[] = [];
    const transport = {
      reviewProposal: async (id: string) => { calls.push(id); return id === "proposal-2" ? { queued: true } : {}; },
    };
    const outcome = await fileApprovedOperations(ops([
      { op: "complete_task", taskId: "t-1", proposalId: "proposal-1" },
      { op: "create_task", taskTitle: "New work", proposalId: "proposal-2" },
      { op: "record_progress", taskId: "t-1", proposalId: "proposal-3" },
    ]), transport);
    expect(calls).toEqual(["proposal-1", "proposal-2", "proposal-3"]);
    expect(outcome.recorded).toBe(2);
    expect(outcome.queued).toBe(1);
    expect(outcome.failed).toHaveLength(0);
    expect(outcome.results.map((result) => result.status)).toEqual(["recorded", "queued", "recorded"]);
  });

  it("never loses an approved operation to a mid-loop failure and reports per-op", async () => {
    const transport = {
      reviewProposal: async (id: string) => {
        if (id === "proposal-2") throw new Error("Nifty is unreachable");
        if (id === "proposal-3") throw new Error("offline");
        return {};
      },
    };
    const outcome = await fileApprovedOperations(ops([
      { op: "complete_task", taskId: "t-1", proposalId: "proposal-1" },
      { op: "create_task", taskTitle: "New work", proposalId: "proposal-2" },
      { op: "record_blocker", taskId: "t-2", proposalId: "proposal-3" },
    ]), transport);
    expect(outcome.recorded).toBe(1);
    expect(outcome.failed).toHaveLength(2);
    expect(outcome.failed[0]?.message).toBe("Nifty is unreachable");
    expect(outcome.failed[1]?.op.op).toBe("record_blocker");
    expect(outcome.results.map((result) => result.status)).toEqual(["recorded", "failed", "failed"]);
  });

  it("never reports a stale or applying 200 as recorded", async () => {
    const transport = {
      reviewProposal: async (id: string) => {
        if (id === "proposal-stale") return { id, status: "stale", outcome: "stale", failure_reason: "The task changed after this proposal was drafted." };
        if (id === "proposal-applying") return { id, status: "applying", outcome: "applying" };
        if (id === "proposal-rejected") return { id, status: "rejected", outcome: "rejected" };
        return { id, status: "applied", outcome: "applied" };
      },
    };
    const outcome = await fileApprovedOperations(ops([
      { op: "complete_task", taskId: "t-1", proposalId: "proposal-stale" },
      { op: "record_progress", taskId: "t-2", proposalId: "proposal-applying" },
      { op: "record_progress", taskId: "t-3", proposalId: "proposal-rejected" },
      { op: "record_progress", taskId: "t-4", proposalId: "proposal-applied" },
    ]), transport);
    expect(outcome.recorded).toBe(1);
    expect(outcome.processing).toBe(1);
    expect(outcome.failed).toHaveLength(2);
    expect(outcome.failed[0]?.message).toContain("task changed");
    expect(outcome.results.map((result) => result.status)).toEqual(["failed", "processing", "failed", "recorded"]);
  });

  it("treats a legacy 200 without an outcome as recorded", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "record_progress" }]), {
      reviewProposal: async () => ({ id: "proposal-1", status: "applied" }),
    });
    expect(outcome.recorded).toBe(1);
  });

  it("offers the clear-and-retry recovery for an unresolved Nifty create", async () => {
    const seen: Array<{ id: string; options?: { providerCreateResolution?: "no_task_created" } }> = [];
    const transport = {
      reviewProposal: async (id: string, options?: { providerCreateResolution?: "no_task_created" }) => {
        seen.push({ id, options });
        return { id, status: "needs_review", outcome: "needs_review", failure_reason: "A previous attempt may have created this task in Nifty but it is not listed yet.", create_intent_unresolved: true };
      },
    };
    const outcome = await fileApprovedOperations(ops([{ op: "create_task", taskTitle: "New work" }]), transport, { createResolution: "no_task_created" });
    expect(seen[0]?.options).toEqual({ providerCreateResolution: "no_task_created" });
    expect(outcome.recorded).toBe(0);
    expect(outcome.results[0]?.retryable).toBe(true);
    expect(outcome.results[0]?.createResolution).toBe("no_task_created");
    expect(outcome.failed[0]?.message).toContain("may have created");
  });

  it("keeps a needs_review without an unresolved create non-retryable", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "record_progress" }]), {
      reviewProposal: async () => ({ id: "proposal-1", status: "needs_review", outcome: "needs_review", failure_reason: "sufficient outcome or artifact evidence is required" }),
    });
    expect(outcome.results[0]?.retryable).toBeFalsy();
    expect(outcome.results[0]?.createResolution).toBeUndefined();
  });

  it("offers the recovery from the timeout readback too", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "create_task", taskTitle: "New work" }]), {
      reviewProposal: async () => { throw new Error("signal timed out"); },
      readProposal: async () => ({ proposal: { status: "needs_review", failure_reason: "A previous attempt may have created this task in Nifty but it is not listed yet.", create_intent_unresolved: true } }),
    });
    expect(outcome.results[0]?.retryable).toBe(true);
    expect(outcome.results[0]?.createResolution).toBe("no_task_created");
  });

  it("uses the persisted proposal as a tool-result payload", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "display_pending_tasks" }]), {
      reviewProposal: async () => ({ proposal: { provider_result: { view: "pending", tasks: [{ id: "task-1" }] } } }),
    });
    expect(outcome.results[0]?.data).toEqual({ provider_result: { view: "pending", tasks: [{ id: "task-1" }] } });
  });

  it("translates a client timeout into guidance instead of timer jargon", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "complete_task", taskId: "t-1" }]), {
      reviewProposal: async () => { throw new Error("signal timed out"); },
    });
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.results[0]?.status).toBe("failed");
    expect(outcome.failed[0]?.message).toContain("may still have filed");
    expect(outcome.failed[0]?.message).toContain("Review");
    expect(outcome.failed[0]?.message).not.toContain("signal timed out");
  });

  it("reconciles an interrupted approval that actually applied", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "complete_task", taskId: "t-1" }]), {
      reviewProposal: async () => { throw new Error("signal timed out"); },
      readProposal: async () => ({ proposal: { status: "applied", failure_reason: null } }),
    });
    expect(outcome.recorded).toBe(1);
    expect(outcome.failed).toHaveLength(0);
    expect(outcome.results[0]?.status).toBe("recorded");
    expect(outcome.results[0]?.message).toContain("confirmed");
  });

  it("reports the server's real failure reason after a timeout", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "complete_task", taskId: "t-1" }]), {
      reviewProposal: async () => { throw new Error("signal timed out"); },
      readProposal: async () => ({ proposal: { status: "needs_review", failure_reason: "sufficient outcome or artifact evidence is required" } }),
    });
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]?.message).toContain("sufficient outcome");
    expect(outcome.results[0]?.status).toBe("failed");
  });

  it("reports a still-processing approval as processing, not failure", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "complete_task", taskId: "t-1" }]), {
      reviewProposal: async () => { throw new Error("signal timed out"); },
      readProposal: async () => ({ proposal: { status: "applying", failure_reason: null } }),
    });
    expect(outcome.processing).toBe(1);
    expect(outcome.failed).toHaveLength(0);
    expect(outcome.results[0]?.status).toBe("processing");
    expect(outcome.results[0]?.message).toContain("Do not retry");
  });

  it("reports a still-pending proposal as unfiled and safe to retry", async () => {
    const outcome = await fileApprovedOperations(ops([{ op: "complete_task", taskId: "t-1" }]), {
      reviewProposal: async () => { throw new Error("signal timed out"); },
      readProposal: async () => ({ proposal: { status: "pending", failure_reason: null } }),
    });
    expect(outcome.processing).toBe(0);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.results[0]?.message).toContain("safe to retry");
    expect(outcome.results[0]?.retryable).toBe(true);
  });
});

describe("filingFailureMessage", () => {
  it("passes ordinary failures through untouched", async () => {
    const { filingFailureMessage } = await import("./interpretation");
    expect(filingFailureMessage(new Error("Nifty is unreachable"))).toBe("Nifty is unreachable");
  });
});

describe("operationToolCall", () => {
  const context = { shiftDate: "2026-08-27", personId: "person-1", promptKind: "optional" };

  it("shows the exact request before approval", () => {
    expect(operationToolCall({ op: "complete_task", statement: "Finished", taskId: "task-1", enabled: true }, context)).toEqual({
      tool: "work_os.tasks.update_completion",
      command: 'PATCH /api/work-os/me/tasks/task-1 {"completed":true}',
    });
    expect(operationToolCall({ op: "create_task", statement: "Write release notes", enabled: true }, context).command).toContain('"assignee_person_ids":["person-1"]');
    expect(operationToolCall({ op: "record_blocker", statement: "Waiting for access", enabled: true }, context)).toEqual({
      tool: "work_os.check_ins.create",
      command: 'POST /api/work-os/check-ins {"source":"desktop","kind":"optional","update_kind":"blocked","input_text":"Waiting for access"}',
    });
    const proposal = { op: "create_task" as const, statement: "Write release notes", proposalId: "proposal-1", enabled: true };
    expect(operationToolCall(proposal, context).tool).toBe("work_os.proposals.review");
    expect(proposalApprovalCommand(proposal)).toBe('PATCH /api/work-os/proposals/proposal-1 {"decision":"accept"}');
  });

  it("preserves reply line breaks so chat lists stay readable", () => {
    const review = normalizeInterpretation({
      reply: "You have 2 pending tasks:\n- Fix the crash\n- Ship the build",
      operations: [],
    }, "show my pending tasks", TASKS);
    expect(review?.reply).toContain("- Fix the crash\n- Ship the build");
  });
});

describe("toolCallKey", () => {
  it("prefers the server proposal id and falls back to content coordinates", () => {
    const withId = { op: "complete_task", statement: "Done.", taskId: "t-1", proposalId: "p-1", enabled: true } as const;
    expect(toolCallKey(withId)).toBe("p-1");
    const a = { op: "display_pending_tasks", statement: "Show.", enabled: true } as const;
    const b = { op: "display_pending_tasks", statement: "Show.", enabled: true } as const;
    const c = { op: "display_overdue_tasks", statement: "Show.", enabled: true } as const;
    expect(toolCallKey(a)).toBe(toolCallKey(b));
    expect(toolCallKey(a)).not.toBe(toolCallKey(c));
  });

  it("matches rehydrated operation copies by stable identity", () => {
    const operation = { op: "complete_task", statement: "Done.", taskId: "t-1" } as const;
    expect(sameToolCall(operation, { ...operation })).toBe(true);
    expect(sameToolCall(operation, { ...operation, taskId: "t-2" })).toBe(false);
  });

  it("merges filed results by stable key with incoming wins", () => {
    const op = { op: "complete_task", statement: "Done.", taskId: "t-1", proposalId: "p-1", enabled: true } as const;
    const display = { op: "display_pending_tasks", statement: "Show.", enabled: false } as const;
    const existing = [{ op: display, status: "recorded", message: "Loaded." } as const];
    const incoming = [{ op, status: "recorded", message: "Recorded." } as const];
    const merged = mergeToolResults([...existing], [...incoming]);
    expect(merged).toHaveLength(2);
    const updated = mergeToolResults(merged, [{ op, status: "failed", message: "Nope." }]);
    expect(updated).toHaveLength(2);
    expect(updated.find((item) => item.op === op)?.status).toBe("failed");
  });
});

describe("pendingApprovalCount", () => {
  const op = (overrides: Record<string, unknown>) => ({ op: "complete_task", statement: "Done.", enabled: true, ...overrides }) as never;
  it("counts only enabled mutating proposals that have no result yet", () => {
    expect(pendingApprovalCount([op({}), op({ enabled: false })])).toBe(1);
  });
  it("ignores display-only operations so an approve bar never reads 0 tool calls", () => {
    expect(pendingApprovalCount([op({ op: "display_overdue_tasks" })])).toBe(0);
    expect(pendingApprovalCount([op({ op: "navigate_to_page", page: "review" })])).toBe(0);
  });
  it("drops proposals that already have a matching result", () => {
    const operations = [op({ proposalId: "p-1" })];
    const results = [{ op: { op: "complete_task", statement: "Done.", proposalId: "p-1" }, status: "recorded", message: "Recorded." }] as never;
    expect(pendingApprovalCount(operations, results)).toBe(0);
    expect(pendingApprovalCount(operations)).toBe(1);
  });

  it("keeps unsubmitted operations pending after a partial decision", () => {
    const first = op({ taskId: "t-1" });
    const second = op({ taskId: "t-2" });
    const updated = disableDecidedOperations([first, second], [first]);

    expect(updated).toMatchObject([{ enabled: false, taskId: "t-1" }, { enabled: true, taskId: "t-2" }]);
    expect(pendingApprovalCount(updated)).toBe(1);
  });
});
