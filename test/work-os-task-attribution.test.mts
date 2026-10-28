import assert from "node:assert/strict";
import test from "node:test";

import { isNiftyTaskAttributableToMember, isTaskAttributableToPerson } from "../src/lib/work-os";
import { isEmployeeTaskAccessible } from "../src/lib/work-os-employee-tasks";
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
  const source = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  assert.match(source, /localId \? "id" : "provider_task_id"/);
  assert.doesNotMatch(source, /\.or\(`id\.eq\.\$\{taskId\}/);
});

test("subtask moves keep their safety checks now that work is native", () => {
  const workOsSource = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  assert.match(workOsSource, /Only subtasks can be moved to another task/);
  assert.match(workOsSource, /Subtasks can only be moved beneath a top-level task/);
  assert.match(workOsSource, /Subtasks can only be moved between tasks in the same project/);
  assert.doesNotMatch(workOsSource, /niftyForOwner|updateNiftyTask/);
});

test("the unified predicate covers local assignment and provider metadata", () => {
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-a"] }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"] }, "person-a", "member-a"), false);
  assert.equal(isTaskAttributableToPerson({ raw: { created_by: "member-a" } }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ raw: { subscribers: ["member-a"] } }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ assignee_provider_ids: ["member-a"], raw: {} }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ raw: { created_by: "member-b" } }, null, "member-a"), false);
});

test("an assigner also sees the work they delegated", () => {
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, "person-a", null), true);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, "person-b", null), true);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, "person-c", null), false);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: [], assigned_by_person_id: null }, "person-a", null), false);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, null, null), false);
});

test("both task surfaces share the unified attribution predicate", () => {
  const tasksSource = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  const workspaceSource = readFileSync(new URL("../src/lib/work-os-daily-workspace.ts", import.meta.url), "utf8");
  assert.match(tasksSource, /export function isTaskAttributableToPerson/);
  assert.match(tasksSource, /isTaskAttributableToPerson\(task, personId, niftyMemberId\)/);
  assert.match(tasksSource, /assignedByPersonId: personId/);
  assert.match(tasksSource, /eq\("assigned_by_person_id", opts\.assignedByPersonId\)/);
  assert.match(workspaceSource, /isTaskAttributableToPerson\(task, access\.personId, context\.niftyMemberId\)/);
  assert.doesNotMatch(workspaceSource, /isNiftyTaskAttributableToMember/);
  assert.match(tasksSource, /export async function listPersonOpenTasks/);
});

test("unassigned child tasks inherit access from their active parent", () => {
  const parent = { id: "parent", assignee_person_ids: ["person-a"], status: "open" };
  assert.equal(isEmployeeTaskAccessible({ id: "child", parent_task_id: "parent", assignee_person_ids: [] }, parent, "person-a", null), true);
  assert.equal(isEmployeeTaskAccessible({ id: "child", parent_task_id: "parent", assignee_person_ids: [] }, parent, "person-b", null), false);
  assert.equal(isEmployeeTaskAccessible({ id: "child", parent_task_id: "parent", assignee_person_ids: [] }, { ...parent, status: "archived" }, "person-a", null), false);
});
