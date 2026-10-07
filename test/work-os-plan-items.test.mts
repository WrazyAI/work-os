import { test } from "node:test";
import assert from "node:assert/strict";
import { planItemCompletionTargets } from "../src/lib/work-os-plan-items";

test("completing a task targets only the open plan items", () => {
  const items = [
    { id: "a", completion_state: "open" },
    { id: "b", completion_state: "completed" },
    { id: "c", completion_state: null },
  ];
  assert.deepEqual(planItemCompletionTargets(items, true), ["a", "c"]);
});

test("reopening a task targets only the completed plan items", () => {
  const items = [
    { id: "a", completion_state: "open" },
    { id: "b", completion_state: "completed" },
  ];
  assert.deepEqual(planItemCompletionTargets(items, false), ["b"]);
});

test("a missing completion state counts as open", () => {
  assert.deepEqual(planItemCompletionTargets([{ id: "a" }], true), ["a"]);
  assert.deepEqual(planItemCompletionTargets([{ id: "a" }], false), []);
});
