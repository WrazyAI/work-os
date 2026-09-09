import assert from "node:assert/strict";
import test from "node:test";
import { ghostPlanItemIds } from "../src/lib/work-os-plan-ghosts";

const statuses = new Map([
  ["t-open", "open"],
  ["t-done", "completed"],
  ["t-arch", "archived"],
  ["t-del", "deleted"],
]);

const item = (id: string, task_id: string | null, disposition = "selected") => ({ id, task_id, disposition });

test("ghost sweep targets only live-work items whose task row is tombstoned or missing", () => {
  const items = [
    item("i-open", "t-open"),
    item("i-done", "t-done"),
    item("i-arch", "t-arch"),
    item("i-del", "t-del"),
    item("i-missing", "t-gone"),
    item("i-already-removed", "t-arch", "removed"),
    item("i-outcome", null),
  ];
  assert.deepEqual(ghostPlanItemIds(items, statuses), ["i-arch", "i-del", "i-missing"]);
});

test("a removed item is never re-flagged and open tasks survive the sweep", () => {
  assert.deepEqual(ghostPlanItemIds([item("i-arch", "t-arch", "removed"), item("i-open", "t-open")], statuses), []);
});

test("items without any status map entries are all ghosts unless they are outcomes", () => {
  const items = [item("a", "x"), item("b", "y", "deferred"), item("c", null), item("d", "z", "removal_proposed")];
  assert.deepEqual(ghostPlanItemIds(items, new Map()), ["a", "b", "d"]);
});
