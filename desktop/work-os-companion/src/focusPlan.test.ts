import { describe, expect, it } from "vitest";
import { buildFocusPlan } from "./focusPlan";
import type { DailyPlan } from "./types";

const plan: DailyPlan = {
  id: "plan",
  status: "confirmed",
  freeform_intent: "Ship the workspace",
  shift_date: "2026-11-11",
  revision: 3,
  items: [
    {
      id: "item-second", task_id: "parent-2", source: "due_today", disposition: "selected", rank: 1,
      title_snapshot: "Review provider sync", blocker: null, item_kind: "nifty_task", completion_state: "completed",
    },
    {
      id: "item-first", task_id: "parent-1", source: "carry_over", disposition: "selected", rank: 0,
      title_snapshot: "Ship the workspace", blocker: null, item_kind: "nifty_task", completion_state: "open",
    },
    {
      id: "item-deferred", task_id: "parent-3", source: "existing", disposition: "deferred", rank: 2,
      title_snapshot: "Deferred work", blocker: null, item_kind: "nifty_task", completion_state: "open",
    },
    {
      id: "item-outcome", task_id: null, source: "existing", disposition: "selected", rank: 3,
      title_snapshot: "Write the release note", blocker: null, item_kind: "outcome", completion_state: "open",
    },
  ],
};

const tasks = [
  {
    id: "parent-1", title: "Ship the workspace", subtask_total: 3, subtask_completed: 1,
    subtasks: [
      { id: "child-open", title: "Trim the header", completed: false },
      { id: "child-done", title: "Move the tabs", completed: true },
      { id: "child-open-2", title: "Check the narrow window", completed: false },
    ],
  },
  {
    id: "parent-2", provider_task_id: "provider-2", title: "Review provider sync",
    subtask_total: 2, subtask_completed: 2,
  },
];

describe("focus plan grouping", () => {
  it("orders the selected parents and attaches their subtasks", () => {
    const focus = buildFocusPlan(plan, tasks);
    expect(focus.groups.map((group) => group.title)).toEqual(["Ship the workspace", "Review provider sync", "Write the release note"]);
    expect(focus.total).toBe(3);
    expect(focus.open).toBe(2);
    expect(focus.completed).toBe(1);
    expect(focus.groups[0].subtasks.map((child) => child.title)).toEqual(["Trim the header", "Check the narrow window", "Move the tabs"]);
    expect(focus.groups[0].subtaskTotal).toBe(3);
    expect(focus.groups[0].subtaskCompleted).toBe(1);
    // A parent without the embedded list still reports the payload's counts.
    expect(focus.groups[1].subtasks).toEqual([]);
    expect(focus.groups[1].subtaskTotal).toBe(2);
    expect(focus.groups[1].subtaskCompleted).toBe(2);
  });

  it("matches provider ids and skips a separately planned child when its parent is planned", () => {
    const withChildItem: DailyPlan = {
      ...plan,
      items: [
        ...plan.items,
        {
          id: "item-child", task_id: "child-open", source: "existing", disposition: "selected", rank: 4,
          title_snapshot: "Trim the header", blocker: null, item_kind: "nifty_task", completion_state: "open",
        },
        {
          id: "item-provider", task_id: "provider-2", source: "existing", disposition: "selected", rank: 5,
          title_snapshot: "Stale snapshot title", blocker: null, item_kind: "nifty_task", completion_state: "open",
        },
      ],
    };
    const focus = buildFocusPlan(withChildItem, tasks);
    expect(focus.groups).toHaveLength(3);
    expect(focus.groups.map((group) => group.title)).not.toContain("Trim the header");
    // The provider id resolves to the real task title, and the duplicate item
    // cannot create a second group for the same task.
    expect(focus.groups[1].title).toBe("Review provider sync");
    expect(focus.groups[1].recordedState).toBe("completed");
  });

  it("keeps an unplanned parent visible when only its child is planned", () => {
    const childOnly: DailyPlan = {
      ...plan,
      items: [{
        id: "item-child", task_id: "child-open", source: "existing", disposition: "selected", rank: 0,
        title_snapshot: "Trim the header", blocker: null, item_kind: "nifty_task", completion_state: "open",
      }],
    };
    const focus = buildFocusPlan(childOnly, tasks);
    expect(focus.groups).toHaveLength(1);
    expect(focus.groups[0].title).toBe("Trim the header");
  });

  it("falls back to the plan snapshot when the task is no longer in the payload", () => {
    const focus = buildFocusPlan(plan, []);
    expect(focus.groups[0].title).toBe("Ship the workspace");
    expect(focus.groups[0].subtasks).toEqual([]);
    expect(focus.groups[0].subtaskTotal).toBe(0);
  });

  it("returns an empty plan for no plan or no selected items", () => {
    expect(buildFocusPlan(null, tasks)).toMatchObject({ groups: [], total: 0, open: 0, completed: 0 });
    expect(buildFocusPlan({ ...plan, items: plan.items.map((item) => ({ ...item, disposition: "removed" as const })) }, tasks).total).toBe(0);
  });

  it("keeps the full subtask counts when the compact payload truncates the list", () => {
    const truncated: DailyPlan = {
      ...plan,
      items: [{
        ...plan.items[1], id: "item-truncated", task_id: "parent-truncated", rank: 0,
        title_snapshot: "Ship the workspace", completion_state: "open",
      }],
    };
    const focus = buildFocusPlan(truncated, [{
      id: "parent-truncated",
      title: "Ship the workspace",
      subtask_total: 12,
      subtask_completed: 5,
      subtasks: Array.from({ length: 8 }, (_, index) => ({
        id: `child-${index}`,
        title: `Child ${index + 1}`,
        completed: index < 3,
      })),
    }]);
    expect(focus.groups[0].subtasks).toHaveLength(8);
    expect(focus.groups[0].subtaskTotal).toBe(12);
    expect(focus.groups[0].subtaskCompleted).toBe(5);
    expect(focus.groups[0].subtasksTruncated).toBe(true);
  });

  it("sanitizes provider errors and untitled records", () => {
    const unsafe: DailyPlan = {
      ...plan,
      items: [{ ...plan.items[0], task_id: null, title_snapshot: "Failed to fetch", item_kind: "outcome" }],
    };
    const focus = buildFocusPlan(unsafe, []);
    expect(focus.groups[0].title).toBe("Untitled plan item");
  });
});
