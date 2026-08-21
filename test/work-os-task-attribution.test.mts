import assert from "node:assert/strict";
import test from "node:test";

import { isNiftyTaskAttributableToMember } from "../src/lib/work-os";
import { normalizeNiftyTask } from "../src/lib/integrations/nifty";
import { readFileSync } from "node:fs";

test("Nifty ledger tasks are attributable through creator metadata", () => {
  assert.equal(isNiftyTaskAttributableToMember({ raw: { created_by: "member-a" } }, "member-a"), true);
  assert.equal(isNiftyTaskAttributableToMember({ raw: { created_by: "member-b" } }, "member-a"), false);
});

test("Nifty ledger tasks are attributable through subscribers or assignees", () => {
  assert.equal(isNiftyTaskAttributableToMember({ raw: { subscribers: ["member-a"] } }, "member-a"), true);
  assert.equal(isNiftyTaskAttributableToMember({ assignee_provider_ids: ["member-a"], raw: {} }, "member-a"), true);
  assert.equal(isNiftyTaskAttributableToMember({ raw: { subscribers: ["member-b"] } }, "member-a"), false);
});

test("unmapped people cannot inherit unassigned ledger tasks", () => {
  assert.equal(isNiftyTaskAttributableToMember({ raw: { created_by: "member-a", subscribers: ["member-a"] } }, null), false);
});

test("task lookup routes provider IDs away from the UUID column", () => {
  const source = readFileSync(new URL("../src/lib/work-os.ts", import.meta.url), "utf8");
  assert.match(source, /localId \? "id" : "provider_task_id"/);
  assert.doesNotMatch(source, /\.or\(`id\.eq\.\$\{taskId\}/);
});

test("Nifty task groups normalize from the provider's task_group field", () => {
  const task = normalizeNiftyTask({ id: "provider-task", name: "Task", task_group: "status-group" });
  assert.equal(task.taskGroupId, "status-group");
});

test("subtask moves require Nifty parent readback and preserve safety checks", () => {
  const workOsSource = readFileSync(new URL("../src/lib/work-os.ts", import.meta.url), "utf8");
  assert.match(workOsSource, /updateNiftyTask\(providerTaskId, \{ task_id: providerParentId \}\)/);
  assert.match(workOsSource, /include_subtasks: "true"/);
  assert.match(workOsSource, /Nifty did not confirm the subtask move/);
  assert.match(workOsSource, /Only subtasks can be moved to another task/);
  assert.match(workOsSource, /Subtasks can only be moved beneath a top-level task/);
  assert.match(workOsSource, /same Nifty project/);
});
