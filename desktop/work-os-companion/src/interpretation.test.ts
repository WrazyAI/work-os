import { describe, expect, it } from "vitest";
import { fileApprovedOperations, interpretationFallbackReason, normalizeInterpretation, operationLabel, operationToolCall } from "./interpretation";

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
  });
});

import { composeEodMarkdown, hasBottleneckAnswer, stripBottleneckSection } from "./interpretation";

describe("EOD composer helpers", () => {
  it("strips any existing bottleneck section before the employee answers", () => {
    const stripped = stripBottleneckSection("## Summary\nA day.\n## Bottleneck\n(needs your input — what prevented you from completing your task list?)");
    expect(stripped).toBe("## Summary\nA day.");
  });

  it("requires a real bottleneck answer before submission", () => {
    expect(hasBottleneckAnswer("  ")).toBe(false);
    expect(hasBottleneckAnswer("no")).toBe(false);
    expect(hasBottleneckAnswer("The signing certificate is still pending.")).toBe(true);
  });

  it("composes the final markdown with the employee's bottleneck answer", () => {
    const final = composeEodMarkdown("## Summary\nA day.\n## Bottleneck\n(placeholder)", "The certificate was pending.");
    expect(final).toContain("## Summary\nA day.");
    expect(final).toContain("## Bottleneck\nThe certificate was pending.");
    expect(final).not.toContain("(placeholder)");
  });
});

describe("fileApprovedOperations", () => {
  const context = { shiftDate: "2026-08-27", personId: "person-1", promptKind: "plan" };
  const ops = (overrides: Array<Partial<import("./interpretation").ProposedOperation>>) => overrides.map((o) => ({
    op: "record_progress" as const, statement: "Did the work.", enabled: true, ...o,
  })) as import("./interpretation").ProposedOperation[];

  it("routes each operation through the right transport and counts receipts", async () => {
    const calls: string[] = [];
    const transport = {
      completeTask: async () => { calls.push("complete"); return { providerStatus: "nifty_confirmed" }; },
      createTask: async () => { calls.push("create"); return { queued: true }; },
      fileCheckIn: async () => { calls.push("checkin"); return {}; },
    };
    const outcome = await fileApprovedOperations(ops([
      { op: "complete_task", taskId: "t-1" },
      { op: "create_task", taskTitle: "New work" },
      { op: "record_progress", taskId: "t-1" },
    ]), context, transport);
    expect(calls).toEqual(["complete", "create", "checkin"]);
    expect(outcome.recorded).toBe(2);
    expect(outcome.queued).toBe(1);
    expect(outcome.failed).toHaveLength(0);
    expect(outcome.results.map((result) => result.status)).toEqual(["recorded", "queued", "recorded"]);
  });

  it("never loses an approved operation to a mid-loop failure and reports per-op", async () => {
    const transport = {
      completeTask: async () => ({ providerStatus: "nifty_confirmed" }),
      createTask: async () => { throw new Error("Nifty is unreachable"); },
      fileCheckIn: async () => { throw new Error("offline"); },
    };
    const outcome = await fileApprovedOperations(ops([
      { op: "complete_task", taskId: "t-1" },
      { op: "create_task", taskTitle: "New work" },
      { op: "record_blocker", taskId: "t-2" },
    ]), context, transport);
    expect(outcome.recorded).toBe(1);
    expect(outcome.failed).toHaveLength(2);
    expect(outcome.failed[0]?.message).toBe("Nifty is unreachable");
    expect(outcome.failed[1]?.op.op).toBe("record_blocker");
    expect(outcome.results.map((result) => result.status)).toEqual(["recorded", "failed", "failed"]);
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
  });
});
