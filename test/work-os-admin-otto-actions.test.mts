import assert from "node:assert/strict";
import test from "node:test";
import { validateAdminOttoInterpretation } from "../src/lib/work-os-admin-otto-intent";

function response(overrides: Record<string, unknown> = {}) {
  return {
    reply: "",
    action: null,
    target: { kind: "team", names: null, ids: null },
    date: null,
    from: null,
    through: null,
    relativeDay: null,
    overdueOnly: false,
    latest: false,
    operation: null,
    ...overrides,
  };
}

test("an assign operation is parsed as a preview request, not a read", () => {
  const parsed = validateAdminOttoInterpretation(response({
    operation: {
      action: "assign_task",
      task_query: "checkout",
      person_names: ["Aden"],
      title: null,
      due_date: null,
    },
  }));
  assert.equal(parsed.intent, null);
  assert.deepEqual(parsed.operation, {
    action: "assign_task",
    task_query: "checkout",
    person_names: ["Aden"],
    title: null,
    due_date: null,
  });
});

test("a create operation requires a title and allows no task query", () => {
  const parsed = validateAdminOttoInterpretation(response({
    operation: {
      action: "create_task",
      task_query: null,
      person_names: ["Aden"],
      title: "Prepare the launch brief",
      due_date: "2026-11-10",
    },
  }));
  assert.equal(parsed.operation?.action, "create_task");
  assert.throws(() => validateAdminOttoInterpretation(response({
    operation: { action: "create_task", task_query: null, person_names: [], title: null, due_date: null },
  })), /title/i);
});

test("a turn cannot carry both a read and an action", () => {
  assert.throws(() => validateAdminOttoInterpretation(response({
    action: "unfinished",
    operation: {
      action: "complete_task",
      task_query: "checkout",
      person_names: [],
      title: null,
      due_date: null,
    },
  })), /both a read and an action/i);
});

test("an assignment operation requires a task query", () => {
  assert.throws(() => validateAdminOttoInterpretation(response({
    operation: {
      action: "add_contributor",
      task_query: null,
      person_names: ["Aden"],
      title: null,
      due_date: null,
    },
  })), /task_query/i);
});

test("old conversational responses without an operation field remain valid", () => {
  const parsed = validateAdminOttoInterpretation(response({ reply: "Here is the summary." }));
  assert.equal(parsed.intent, null);
  assert.equal(parsed.operation, undefined);
});

const create = (title: string, person: string) => ({
  action: "create_task", task_query: null, person_names: [person], title, due_date: null,
});

test("two requested creations remain two ordered operations", () => {
  const parsed = validateAdminOttoInterpretation(response({ steps: [
    { intent: null, operation: create("Example Task 1", "David"), depends_on: null },
    { intent: null, operation: create("Example Task 2", "Aden"), depends_on: null },
  ] }));
  assert.deepEqual(parsed.steps?.map((step) => step.operation?.title), ["Example Task 1", "Example Task 2"]);
});

test("plans reject forward dependencies and excess work", () => {
  const step = { intent: null, operation: create("Example", "David"), depends_on: null };
  assert.throws(() => validateAdminOttoInterpretation(response({ steps: [{ ...step, depends_on: 1 }] })), /depend/i);
  assert.throws(() => validateAdminOttoInterpretation(response({ steps: Array(9).fill(step) })), /8/i);
});

test("an explicit multi-step plan wins over an accidental legacy field", () => {
  const step = { intent: null, operation: create("Example", "David"), depends_on: null };
  const parsed = validateAdminOttoInterpretation(response({ steps: [step], operation: create("Other", "David") }));
  assert.equal(parsed.steps?.length, 1);
  assert.equal(parsed.operation, undefined);
});

test("a read cannot depend on a write and a dependency must follow a write", () => {
  assert.throws(() => validateAdminOttoInterpretation(response({ steps: [
    { intent: null, operation: create("Example", "David"), depends_on: null },
    { intent: { action: "unfinished", target: { kind: "team", names: null, ids: null }, date: null, from: null, through: null, relativeDay: null, overdueOnly: false, latest: false }, operation: null, depends_on: 0 },
  ] })), /only task changes/i);
  assert.throws(() => validateAdminOttoInterpretation(response({ steps: [
    { intent: { action: "unfinished", target: { kind: "team", names: null, ids: null }, date: null, from: null, through: null, relativeDay: null, overdueOnly: false, latest: false }, operation: null, depends_on: null },
    { intent: null, operation: { action: "add_contributor", task_query: null, person_names: ["Aden"], title: null, due_date: null }, depends_on: 0 },
  ] })), /earlier task change/i);
});

test("a dependent task operation references a prior step rather than inventing a UUID", () => {
  const parsed = validateAdminOttoInterpretation(response({ steps: [
    { intent: null, operation: create("Example", "David"), depends_on: null },
    { intent: null, operation: { action: "add_contributor", task_query: null, person_names: ["Aden"], title: null, due_date: null }, depends_on: 0 },
  ] }));
  assert.equal(parsed.steps?.[1].depends_on, 0);
});
