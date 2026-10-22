import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectParentSubtasks } from "./TaskSelectionCard";

/**
 * Completing a task completes the open subtasks beneath it. The card makes
 * that visible before anything is filed: ticking a task ticks its open
 * subtasks, so the count, the review, and the record all say the same thing.
 */

const children = [
  { id: "child-open", title: "Lisa is asked about availability", completed: false },
  { id: "child-done", title: "Move the tabs", completed: true },
];

describe("selectParentSubtasks", () => {
  it("ticks the open subtasks beneath a task and records which ones it ticked", () => {
    const outcome = selectParentSubtasks({ children, selectedIds: new Set<string>() });

    expect(outcome.selected).toEqual(["child-open"]);
    expect(outcome.autoChecked).toEqual(["child-open"]);
  });

  it("never selects a subtask that is already done", () => {
    const outcome = selectParentSubtasks({
      children: [{ id: "child-done", title: "Move the tabs", completed: true }],
      selectedIds: new Set<string>(),
    });

    expect(outcome.selected).toEqual([]);
    expect(outcome.autoChecked).toEqual([]);
  });

  it("never selects a subtask that already has a pending proposal", () => {
    const outcome = selectParentSubtasks({
      children,
      selectedIds: new Set<string>(),
      proposedIds: new Set(["child-open"]),
    });

    expect(outcome.selected).toEqual([]);
    expect(outcome.autoChecked).toEqual([]);
  });

  it("leaves a subtask the employee ticked first out of the task's own ticks", () => {
    const outcome = selectParentSubtasks({ children, selectedIds: new Set(["child-open"]) });

    expect(outcome.selected).toEqual(["child-open"]);
    // It was already selected, so unticking the task must not clear it.
    expect(outcome.autoChecked).toEqual([]);
  });
});

describe("TaskSelectionCard subtask cascade", () => {
  it("wires the cascade into the card's selection handling", () => {
    const source = readFileSync(new URL("./TaskSelectionCard.tsx", import.meta.url), "utf8");
    expect(source).toContain("selectParentSubtasks");
    expect(source).toContain("autoCheckedByParent");
  });
});
