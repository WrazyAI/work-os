import assert from "node:assert/strict";
import test from "node:test";
import { attachTaskAssigneeIdentities, scopedAssignableTaskPeople } from "../src/lib/work-os-task-assignees";

const people = [
  { id: "employee", name: "Employee" },
  { id: "admin-worker", name: "Admin worker" },
  { id: "admin-only", name: "Admin only" },
];
test("administrators may assign every active candidate", () => {
  assert.deepEqual(
    scopedAssignableTaskPeople(people, null).map((person) => person.id),
    ["employee", "admin-worker", "admin-only"],
  );
});

test("employees may assign only themselves", () => {
  assert.deepEqual(
    scopedAssignableTaskPeople(people, ["employee"]).map((person) => person.id),
    ["employee"],
  );
});

test("an empty access scope exposes nobody", () => {
  assert.deepEqual(
    scopedAssignableTaskPeople(people, []).map((person) => person.id),
    [],
  );
});

test("managers may assign themselves and their managed team only", () => {
  assert.deepEqual(scopedAssignableTaskPeople(people, ["employee", "admin-worker"]).map((person) => person.id), ["employee", "admin-worker"]);
});

test("projects ordered assignee identity tags without exposing unknown mappings", () => {
  const [task] = attachTaskAssigneeIdentities([
    { id: "task", assignee_person_ids: ["person-2", "missing", "person-1"] },
  ], [
    { id: "person-1", display_name: "David Z", email: "david@example.com" },
    { id: "person-2", display_name: "Aden Badon", email: null },
  ]);
  assert.deepEqual(task.assignees, [
    { personId: "person-2", displayName: "Aden Badon", email: null },
    { personId: "person-1", displayName: "David Z", email: "david@example.com" },
  ]);
});
