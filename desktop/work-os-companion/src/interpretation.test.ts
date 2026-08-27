import { describe, expect, it } from "vitest";
import { interpretationFallbackReason, normalizeInterpretation, operationLabel } from "./interpretation";

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
    expect(review?.operations).toHaveLength(0);
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
