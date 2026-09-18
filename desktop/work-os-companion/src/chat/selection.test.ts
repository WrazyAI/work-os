import { describe, expect, it } from "vitest";
import { taskSelectionFromResult } from "./selection";

describe("taskSelectionFromResult", () => {
  it("reads a display-tool payload that carries a task array", () => {
    const selection = taskSelectionFromResult({
      data: { provider_result: { view: "pending", tasks: [{ id: "t-1", title: "Harden copy" }] } },
    });
    expect(selection?.view).toBe("pending");
    expect(selection?.tasks).toHaveLength(1);
  });

  it("normalizes an overdue view and any unknown view to a real one", () => {
    expect(taskSelectionFromResult({ data: { provider_result: { view: "overdue", tasks: [] } } })?.view).toBe("overdue");
    expect(taskSelectionFromResult({ data: { provider_result: { view: "weird", tasks: [] } } })?.view).toBe("pending");
  });

  it("ignores the provider row attached to a recorded mutation", () => {
    // work_task_proposals.provider_result is jsonb default '{}' and reaches the
    // client on every recorded result: it must never render a task card.
    expect(taskSelectionFromResult({
      data: { provider_result: {}, outcome: "applied" },
    })).toBeNull();
    expect(taskSelectionFromResult({
      data: { provider_result: { task_id: "provider-task", provider: "nifty" } },
    })).toBeNull();
  });

  it("ignores results with no provider row at all", () => {
    expect(taskSelectionFromResult(null)).toBeNull();
    expect(taskSelectionFromResult({ data: {} })).toBeNull();
    expect(taskSelectionFromResult({ data: { provider_result: { tasks: "not-an-array" } } })).toBeNull();
  });
});
