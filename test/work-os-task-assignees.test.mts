import assert from "node:assert/strict";
import test from "node:test";
import { filterAssignableTaskPeople } from "../src/lib/work-os-task-assignees";

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
