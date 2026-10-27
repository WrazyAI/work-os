import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { applyTaskCompletion, taskCompletionFailureMessage } from "../src/lib/work-os-task-completion";
import { taskCapabilities, type TaskActor } from "../src/lib/work-os-task-permissions";

type Node = { id: string; title: string };

const node = (id: string): Node => ({ id, title: `Task ${id}` });

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

/** Run a real function body against stubbed dependencies, the way the task
 * path guards do: the production source runs, the database and the provider
 * do not. */
function loadFunction(file: string, name: string, end: string, context: Record<string, unknown>) {
  const source = read(file);
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const stop = end ? source.indexOf(end, start) : source.length;
  assert.ok(stop > start, `end marker for ${name} not found in ${file}`);
  const body = source.slice(start, stop).replace("export async function", "async function");
  const js = ts.transpileModule(`${body}\nglobalThis.subject = ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, context);
  return (context as { subject: (...args: any[]) => Promise<any> }).subject;
}

/**
 * Completing a task also completes the open subtasks beneath it: a finished
 * task never shows open work underneath it. These cover the ordering (children
 * before their parent), the failure contract (a subtask that cannot close
 * leaves the parent open), and the reopen contract (reopening a task never
 * reopens its subtasks).
 */

test("completing a task closes its open subtasks before the parent closes", async () => {
  const parent = node("parent");
  const children: Record<string, Node[]> = { parent: [node("a"), node("b")], a: [node("a1")] };
  const order: string[] = [];

  const outcome = await applyTaskCompletion({
    task: parent,
    completed: true,
    openChildren: async (task) => children[task.id] ?? [],
    complete: async (task) => { order.push(task.id); },
  });

  assert.deepEqual(order, ["a1", "a", "b", "parent"]);
  assert.deepEqual(outcome.completed.map((task) => task.id), ["a1", "a", "b", "parent"]);
  assert.deepEqual(outcome.failures, []);
});

test("a subtask that cannot close leaves the parent open and names the failure", async () => {
  const parent = node("parent");
  const children: Record<string, Node[]> = { parent: [node("a"), node("b")] };
  const order: string[] = [];

  const outcome = await applyTaskCompletion({
    task: parent,
    completed: true,
    openChildren: async (task) => children[task.id] ?? [],
    complete: async (task) => {
      if (task.id === "b") throw new Error("the provider refused");
      order.push(task.id);
    },
  });

  // The parent never closes behind an open subtask.
  assert.deepEqual(order, ["a"]);
  assert.deepEqual(outcome.completed.map((task) => task.id), ["a"]);
  assert.equal(outcome.failures.length, 1);
  assert.equal(outcome.failures[0]?.task.id, "b");
  assert.match(outcome.failures[0]?.message ?? "", /the provider refused/);
});

test("a failing subtask does not stop the other subtasks from closing", async () => {
  const parent = node("parent");
  const children: Record<string, Node[]> = { parent: [node("a"), node("b"), node("c")] };
  const order: string[] = [];

  const outcome = await applyTaskCompletion({
    task: parent,
    completed: true,
    openChildren: async (task) => children[task.id] ?? [],
    complete: async (task) => {
      if (task.id === "a") throw new Error("nope");
      order.push(task.id);
    },
  });

  assert.deepEqual(order, ["b", "c"]);
  assert.deepEqual(outcome.failures.map((failure) => failure.task.id), ["a"]);
});

test("reopening a task never reopens or touches its subtasks", async () => {
  const parent = node("parent");
  const reopened: string[] = [];
  let askedForChildren = false;

  const outcome = await applyTaskCompletion({
    task: parent,
    completed: false,
    openChildren: async () => { askedForChildren = true; return [node("a")]; },
    complete: async () => { throw new Error("a reopen must not close anything"); },
    reopen: async (task) => { reopened.push(task.id); },
  });

  assert.deepEqual(reopened, ["parent"]);
  assert.equal(askedForChildren, false);
  assert.deepEqual(outcome.completed, []);
  assert.deepEqual(outcome.failures, []);
});

test("a failure of the task itself reports the reason without a task above it", async () => {
  const root = node("root");
  const children: Record<string, Node[]> = { root: [node("child")] };
  const outcome = await applyTaskCompletion({
    task: root,
    completed: true,
    openChildren: async (task) => children[task.id] ?? [],
    complete: async (task) => {
      if (task.id === "root") throw new Error("the provider refused the task");
    },
  });

  const message = taskCompletionFailureMessage(outcome.failures, "root");
  assert.equal(message, "the provider refused the task");
  assert.doesNotMatch(message, /above it stayed open/);
});

test("a subtask failure still names the subtask and the task above it", () => {
  const message = taskCompletionFailureMessage(
    [{ task: { id: "child", title: "Trim the header" }, message: "the provider refused" }],
    "root",
  );
  assert.equal(message, "“Trim the header” could not be completed, so the task above it stayed open: the provider refused");
});

test("a failure of the task itself never hides a failing subtask", async () => {
  const root = node("root");
  const children: Record<string, Node[]> = { root: [node("child")] };
  const outcome = await applyTaskCompletion({
    task: root,
    completed: true,
    openChildren: async (task) => children[task.id] ?? [],
    complete: async (task) => { throw new Error(`${task.id} refused`); },
  });

  const message = taskCompletionFailureMessage(outcome.failures, "root");
  assert.match(message, /“Task child” could not be completed, so the task above it stayed open: child refused/);
});

test("a parent link that loops back never closes the same task twice", async () => {
  const parent = node("parent");
  const child = node("child");
  const children: Record<string, Node[]> = { parent: [child], child: [parent] };
  const order: string[] = [];

  const outcome = await applyTaskCompletion({
    task: parent,
    completed: true,
    openChildren: async (task) => children[task.id] ?? [],
    complete: async (task) => { order.push(task.id); },
  });

  assert.deepEqual(order, ["child", "parent"]);
  assert.deepEqual(outcome.failures, []);
});

/* ------------------------------------------------------------------ */
/* The surfaces that mark a task done inherit the rule                 */
/* ------------------------------------------------------------------ */

const root = { id: "root-local", organization_id: "org", provider_task_id: "provider-root", title: "AnyDesk testing session with Lisa", provider: "nifty", completed: false, assignee_person_ids: ["person"] };
const child = { id: "child-local", organization_id: "org", provider_task_id: "provider-child", title: "Lisa is asked about availability", provider: "nifty", completed: false, assignee_person_ids: ["person"] };

class WorkOsForbiddenError extends Error {}
class WorkOsNotFoundError extends Error {}
const permissionContext = {
  taskCapabilities,
  taskActor: ({ role, personId }: TaskActor): TaskActor => ({ role, personId }),
  employeeTaskToday: async () => "2026-10-27",
  WorkOsForbiddenError,
  WorkOsNotFoundError,
  organizationOwnerId: async (organizationId: string) => {
    assert.equal(organizationId, "org");
    return "owner";
  },
};

const employeeContext = (overrides: Record<string, unknown> = {}) => ({
  ...permissionContext,
  employeeTaskContext: async () => ({ ownerId: "owner", task: root }),
  taskRequiresCompletionEvidence: () => false,
  completionEvidence: async () => null,
  WorkOsConflictError: class extends Error {},
  applyTaskCompletion,
  taskCompletionFailureMessage,
  completionRow: (value: Record<string, unknown>) => ({
    ...value,
    id: String(value.id ?? ""),
    title: String(value.title ?? "Untitled task"),
  }),
  openSubtaskRows: async () => [child],
  completeTask: async () => ({ ...root, completed_at: "2026-10-22T10:00:00Z" }),
  recordTaskDayEvent: async () => undefined,
  syncPlanItemCompletion: async () => undefined,
  audit: async () => undefined,
  text: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
  ...overrides,
});

test("the employee completion path closes the open subtasks before the task", async () => {
  const closed: string[] = [];
  const subject = loadFunction("src/lib/work-os-employee-tasks.ts", "setWorkOsEmployeeTaskCompletion", "export async function listWorkOsEmployeeTaskSelection", employeeContext({
    completeTask: async (_ownerId: string, id: string, completed: boolean) => {
      closed.push(`${id}:${completed}`);
      return { ...root, completed_at: "2026-10-22T10:00:00Z" };
    },
  }));

  const result = await subject({ organizationId: "org", personId: "person", role: "employee" }, "provider-root", true);

  assert.deepEqual(closed, ["provider-child:true", "provider-root:true"]);
  assert.equal(result.task.completed_at, "2026-10-22T10:00:00Z");
});

test("the employee completion path leaves the task open when a subtask cannot close", async () => {
  const closed: string[] = [];
  const subject = loadFunction("src/lib/work-os-employee-tasks.ts", "setWorkOsEmployeeTaskCompletion", "export async function listWorkOsEmployeeTaskSelection", employeeContext({
    completeTask: async (_ownerId: string, id: string, completed: boolean) => {
      if (id === "provider-child") throw new Error("the provider refused");
      closed.push(id);
      return { ...root, completed_at: "2026-10-22T10:00:00Z" };
    },
  }));

  await assert.rejects(
    () => subject({ organizationId: "org", personId: "person", role: "employee" }, "provider-root", true),
    /Lisa is asked about availability/,
  );
  // The task itself never closed behind an open subtask.
  assert.deepEqual(closed, []);
});

test("reopening a task through the employee path leaves its subtasks alone", async () => {
  const closed: string[] = [];
  const askedForChildren: string[] = [];
  const subject = loadFunction("src/lib/work-os-employee-tasks.ts", "setWorkOsEmployeeTaskCompletion", "export async function listWorkOsEmployeeTaskSelection", employeeContext({
    employeeTaskContext: async () => ({ ownerId: "owner", task: { ...root, completed: true } }),
    openSubtaskRows: async () => { askedForChildren.push("asked"); return [child]; },
    completeTask: async (_ownerId: string, id: string, completed: boolean) => {
      closed.push(`${id}:${completed}`);
      return { ...root };
    },
  }));

  await subject({ organizationId: "org", personId: "person", role: "employee" }, "provider-root", false);

  assert.deepEqual(closed, ["provider-root:false"]);
  assert.deepEqual(askedForChildren, []);
});

test("the administration completion path closes the open subtasks before the task", async () => {
  const closed: string[] = [];
  const subject = loadFunction("src/lib/work-os-employee-tasks.ts", "completeWorkOsTask", "", {
    ...permissionContext,
    getTaskByLocalOrProviderId: async () => root,
    taskRequiresCompletionEvidence: () => false,
    completionEvidence: async () => null,
    WorkOsConflictError: class extends Error {},
    applyTaskCompletion,
    taskCompletionFailureMessage,
    completionRow: (value: Record<string, unknown>) => ({
      ...value,
      id: String(value.id ?? ""),
      title: String(value.title ?? "Untitled task"),
    }),
    openSubtaskRows: async () => [child],
    completeTask: async (_ownerId: string, id: string, completed: boolean) => {
      closed.push(`${id}:${completed}`);
      return { ...root, completed_at: "2026-10-22T10:00:00Z" };
    },
    syncPlanItemCompletion: async () => undefined,
    text: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
  });

  await subject({ organizationId: "org", personId: null, role: "admin" }, "provider-root");

  assert.deepEqual(closed, ["provider-child:true", "provider-root:true"]);
});

for (const name of ["setWorkOsEmployeeTaskCompletion", "completeWorkOsTask"]) {
  test(`${name} refuses an unauthorized completion before any cascade or write`, async () => {
    const calls: string[] = [];
    const subject = loadFunction("src/lib/work-os-employee-tasks.ts", name, name === "completeWorkOsTask" ? "" : "export async function listWorkOsEmployeeTaskSelection", employeeContext({
      getTaskByLocalOrProviderId: async () => root,
      openSubtaskRows: async () => { calls.push("children"); return [child]; },
      completeTask: async () => { calls.push("complete"); return root; },
      syncPlanItemCompletion: async () => { calls.push("plan"); },
      recordTaskDayEvent: async () => { calls.push("event"); },
      audit: async () => { calls.push("audit"); },
    }));
    await assert.rejects(() => subject({ organizationId: "org", personId: "outsider", role: "employee" }, "provider-root", true), WorkOsForbiddenError);
    assert.deepEqual(calls, []);
  });
}

test("administration completion refuses another organization before any cascade or write", async () => {
  const calls: string[] = [];
  const subject = loadFunction("src/lib/work-os-employee-tasks.ts", "completeWorkOsTask", "", employeeContext({
    getTaskByLocalOrProviderId: async () => ({ ...root, organization_id: "other-org" }),
    openSubtaskRows: async () => { calls.push("children"); return [child]; },
    completeTask: async () => { calls.push("complete"); return root; },
    syncPlanItemCompletion: async () => { calls.push("plan"); },
  }));
  await assert.rejects(() => subject({ organizationId: "org", personId: null, role: "admin" }, "provider-root", true), WorkOsNotFoundError);
  assert.deepEqual(calls, []);
});
