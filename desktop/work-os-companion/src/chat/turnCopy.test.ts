import { describe, expect, it } from "vitest";
import { turnCopyText } from "./turnCopy";

describe("turnCopyText", () => {
  it("copies the prose of a plain turn", () => {
    expect(turnCopyText({ role: "user", text: "Can you show my tasks?" })).toBe("Can you show my tasks?");
    expect(turnCopyText({ role: "assistant", text: "Here you go." })).toBe("Here you go.");
    expect(turnCopyText({ role: "assistant", receipt: "Update recorded." })).toBe("Update recorded.");
  });

  it("returns null when a turn has nothing to copy", () => {
    expect(turnCopyText({ role: "assistant" })).toBeNull();
    expect(turnCopyText({ role: "assistant", text: "   " })).toBeNull();
    expect(turnCopyText({ role: "system", text: "Notice" })).toBeNull();
  });

  it("summarises the task cards a turn rendered", () => {
    const text = turnCopyText({
      role: "assistant",
      text: "I'll show you the currently incomplete tasks.",
      operations: [{ op: "display_pending_tasks", statement: "Show." }],
      toolResults: [
        {
          op: { op: "display_pending_tasks", statement: "Show." },
          status: "recorded",
          message: "Loaded.",
          data: { provider_result: { view: "pending", tasks: [
            { id: "t-1", title: "Harden task fallback copy", state: "pending", due_date: "2026-08-29" },
            { id: "t-2", title: "Order and group task records", state: "overdue" },
          ] } },
        },
      ],
    });
    expect(text).toContain("I'll show you the currently incomplete tasks.");
    expect(text).toContain("Pending tasks:");
    expect(text).toContain("- Harden task fallback copy (pending, due 2026-08-29)");
    expect(text).toContain("- Order and group task records (overdue)");
  });

  it("names the action results with their status and failure detail", () => {
    const text = turnCopyText({
      role: "assistant",
      text: "Review the selected task completions before anything changes.",
      operations: [{ op: "complete_task", taskTitle: "Fix desktop history persistence" }],
      toolResults: [
        { op: { op: "complete_task", taskTitle: "Fix desktop history persistence" }, status: "processing", message: "Still processing." },
        { op: { op: "complete_task", taskTitle: "Work Memory P3" }, status: "failed", message: "Not filed. Safe to retry." },
      ],
    });
    expect(text).toContain("Actions recorded:");
    expect(text).toContain("- Fix desktop history persistence — Processing");
    expect(text).toContain("- Work Memory P3 — Failed: Not filed. Safe to retry.");
  });

  it("copies unresolved mutations without inventing a task card", () => {
    const text = turnCopyText({
      role: "assistant",
      operations: [{ op: "complete_task", taskTitle: "Repair provider sync" }],
    });
    expect(text).toBe("Actions recorded:\n- Repair provider sync — Awaiting review");
  });

  it("does not turn a mutation provider payload into a task list", () => {
    const text = turnCopyText({
      role: "assistant",
      toolResults: [{
        op: { op: "complete_task", taskTitle: "Repair provider sync" },
        status: "recorded",
        message: "Recorded.",
        data: { provider_result: { view: "pending", tasks: [{ id: "t-1", title: "Provider row" }] } },
      }],
    });
    expect(text).toContain("Actions recorded:");
    expect(text).not.toContain("Pending tasks:");
    expect(text).not.toContain("Provider row");
  });

  it("keeps a card-only turn copyable without prose", () => {
    const text = turnCopyText({
      role: "assistant",
      toolResults: [
        { op: { op: "complete_task", taskTitle: "Ship the composer" }, status: "recorded", message: "Recorded." },
      ],
    });
    expect(text).toBe("Actions recorded:\n- Ship the composer — Recorded");
  });
});
