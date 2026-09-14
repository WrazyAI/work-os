import { describe, expect, it } from "vitest";
import { buildPlanItemsFromInterpretation, type ServerPlanItem } from "./planItems";
import type { PlanningInterpretation } from "./PlanningSession";

const interpretation: PlanningInterpretation = {
  buildId: "build-1",
  rawIntent: "improve cash mgmt and migrate to mac",
  summary: "Improve Work OS cash management and migrate to macOS.",
  commitments: [
    { clientId: "c1", linkedTaskId: "task-1", title: "Audit spending", objective: "Know where money goes", successCriteria: ["Ledger current"], confidence: 0.9, sourceRefs: [] },
    { clientId: "c2", title: "Move companion to macOS", objective: "Build on Apple silicon", successCriteria: ["Signed build"], confidence: 0.8, sourceRefs: [] },
  ],
  clarifications: [{ id: "q1", commitmentId: "c2", question: "Which machine?", reason: "hardware" }],
  readiness: "ready",
};

const serverItems: ServerPlanItem[] = [
  { id: "item-1", task_id: "task-1", title_snapshot: "Audit spending", disposition: "selected", item_kind: "nifty_task", completion_state: "open" },
];

describe("buildPlanItemsFromInterpretation", () => {
  it("enriches the linked task item with the commitment fields", () => {
    const items = buildPlanItemsFromInterpretation(serverItems, interpretation, { q1: "MacBook" });
    expect(items).toHaveLength(2);
    const linked = items[0] as Record<string, unknown>;
    expect(linked.id).toBe("item-1");
    expect(linked.task_id).toBe("task-1");
    expect(linked.title_snapshot).toBe("Audit spending");
    expect(linked.objective).toBe("Know where money goes");
    expect(linked.success_criteria).toEqual(["Ledger current"]);
    expect(linked.clarification_state).toBe("none");
  });

  it("persists unlinked commitments as new outcome items", () => {
    const items = buildPlanItemsFromInterpretation([], interpretation, { q1: "MacBook" });
    expect(items).toHaveLength(1);
    const outcome = items[0] as Record<string, unknown>;
    expect(outcome.id).toBe("");
    expect(outcome.task_id).toBeNull();
    expect(outcome.title_snapshot).toBe("Move companion to macOS");
    expect(outcome.item_kind).toBe("outcome");
    expect(outcome.disposition).toBe("selected");
    expect(outcome.completion_state).toBe("open");
    expect(outcome.clarification_state).toBe("resolved");
  });

  it("marks unresolved clarifications as needs_clarification", () => {
    const items = buildPlanItemsFromInterpretation([], interpretation, {});
    const outcome = items[0] as Record<string, unknown>;
    expect(outcome.clarification_state).toBe("needs_clarification");
  });

  it("drops linked commitments whose task is missing from the server plan", () => {
    const items = buildPlanItemsFromInterpretation([], interpretation, {});
    expect(items).toHaveLength(1);
    expect((items[0] as Record<string, unknown>).title_snapshot).toBe("Move companion to macOS");
  });
});
