import { describe, expect, it } from "vitest";
import { deriveTaskContext, taskContextTitle } from "./avatarTaskContext";

const tasks = [
  { id: "t1", title: "Write the release notes", dueDate: "2026-09-06", completed: false },
  { id: "t2", title: "Fix the flaky upload", dueDate: "2026-09-07", completed: false },
  { id: "t3", title: "Already shipped", dueDate: "2026-09-05", completed: true },
  { id: "t4", title: "Plan the migration", dueDate: null, completed: false },
  { id: "t5", title: "Broken date task", dueDate: "not-a-date", completed: false },
];

describe("deriveTaskContext", () => {
  it("separates overdue from pending and excludes completed work", () => {
    const context = deriveTaskContext(tasks, "2026-09-07");
    expect(context.overdueCount).toBe(1);
    expect(context.pendingCount).toBe(3);
    expect(context.visible[0]).toMatchObject({ id: "t1", overdue: true });
    expect(context.visible.some((task) => task.id === "t3")).toBe(false);
  });

  it("treats malformed dates as pending instead of throwing", () => {
    const context = deriveTaskContext(tasks, "2026-09-07");
    expect(context.visible.some((task) => task.id === "t5" && !task.overdue)).toBe(true);
  });

  it("bounds the visible slice overdue-first", () => {
    const context = deriveTaskContext(tasks, "2026-09-07", 2);
    expect(context.visible).toHaveLength(2);
    expect(context.visible[0]?.overdue).toBe(true);
    expect(context.overdueCount).toBe(1);
    expect(context.pendingCount).toBe(3);
  });

  it("states both counts in the card title", () => {
    expect(taskContextTitle(deriveTaskContext(tasks, "2026-09-07"))).toBe(
      "Today's tasks · 3 pending · 1 overdue",
    );
  });
});
