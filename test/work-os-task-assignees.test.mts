import assert from "node:assert/strict";
import test from "node:test";
import { attachTaskAssigneeIdentities, filterAssignableTaskPeople } from "../src/lib/work-os-task-assignees";

const people = [
  { id: "employee", name: "Employee" },
  { id: "admin-worker", name: "Admin worker" },
  { id: "admin-only", name: "Admin only" },
];
const administrators = ["admin-worker", "admin-only"];

test("keeps the authenticated worker assignable when they also hold admin privileges", () => {
  assert.deepEqual(
    filterAssignableTaskPeople(people, administrators, "admin-worker").map((person) => person.id),
    ["employee", "admin-worker"],
  );
});

test("continues to exclude admin-only peers", () => {
  assert.deepEqual(
    filterAssignableTaskPeople(people, administrators, "employee").map((person) => person.id),
    ["employee"],
  );
});

test("does not expose administrators when no worker identity is mapped", () => {
  assert.deepEqual(
    filterAssignableTaskPeople(people, administrators, null).map((person) => person.id),
    ["employee"],
  );
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
