import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { scopedAssignableTaskPeople } from "../src/lib/work-os-task-assignees";
import { isWorkflowStatus, taskCapabilities } from "../src/lib/work-os-task-permissions";

const employee = readFileSync("src/lib/work-os-employee-tasks.ts", "utf8");
const local = readFileSync("src/lib/work-os-local-tasks.ts", "utf8");
const route = readFileSync("src/app/api/work-os/me/tasks/[taskId]/route.ts", "utf8");
const api = readFileSync("src/lib/work-os-api.ts", "utf8");
function functionSource(name: string) {
  const start = employee.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  return employee.slice(start, employee.indexOf("\nexport ", start + 1) === -1 ? undefined : employee.indexOf("\nexport ", start + 1));
}

test("assignment scope keeps all, self, or none without widening access", () => {
  const people = ["employee", "manager", "teammate", "admin"].map((id) => ({ id }));
  assert.deepEqual(scopedAssignableTaskPeople(people, null), people);
  assert.deepEqual(scopedAssignableTaskPeople(people, ["employee"]), [{ id: "employee" }]);
  assert.deepEqual(scopedAssignableTaskPeople(people, []), []);
});

for (const [name, capability, write] of [
  ["updateWorkOsEmployeeTask", "canEdit", "await updateTask("],
  ["updateWorkOsEmployeeTaskStatus", "canChangeStatus", "await updateTask("],
  ["setWorkOsEmployeeTaskCompletion", "canComplete", "await applyTaskCompletion("],
  ["completeWorkOsTask", "canComplete", "await applyTaskCompletion("],
  ["archiveWorkOsEmployeeTask", "canArchive", "await archiveTask("],
  ["deleteWorkOsEmployeeTask", "canDelete", "await deleteTask("],
  ["moveWorkOsEmployeeSubtask", "canMove", "await moveTaskToParent("],
]) {
  test(`${name} refuses unauthorized actions before writing`, () => {
    const source = functionSource(name);
    assert.match(source, /taskCapabilities\(task,/);
    assert.match(source, new RegExp(`\\.${capability}`));
    assert.match(source, /throw new WorkOsForbiddenError/);
    assert.ok(source.indexOf("throw new WorkOsForbiddenError") < source.indexOf(write));
  });
}

test("status uses workflow validation and overdue/completed conflicts", () => {
  const source = functionSource("updateWorkOsEmployeeTaskStatus");
  assert.match(source, /isWorkflowStatus\(status\)/);
  assert.match(source, /due_date_passed/);
  assert.match(source, /task_completed/);
  assert.match(source, /workflow_status: status/);
  assert.match(source, /task.status_changed/);
});
test("creation records assigner and pending status", () => {
  assert.match(local, /assigned_by_person_id: input.assignedByPersonId \?\? access.personId \?\? null/);
  assert.match(local, /workflow_status: "pending"/);
  assert.match(functionSource("createWorkOsEmployeeTask"), /assignedByPersonId: access.personId/);
});
test("creation options use the canonical access scope", () => {
  const source = functionSource("getWorkOsTaskCreationOptions");
  assert.match(source, /accessibleWorkOsPersonIds\(access\)/);
  assert.match(source, /scopedAssignableTaskPeople\(people, allowed\)/);
});
test("status route rejects malformed or mixed patches", () => {
  assert.match(route, /updateWorkOsEmployeeTaskStatus\(auth.access, taskId, body.workflow_status\)/);
  assert.match(route, /isWorkflowStatus\(body.workflow_status\)/);
  assert.match(route, /Object.keys\(body\)/);
  assert.match(route, /status: 400/);
});
test("forbidden errors are mapped to 403", () => {
  assert.match(api, /export class WorkOsForbiddenError extends Error/);
  assert.match(api, /err instanceof WorkOsForbiddenError[\s\S]*?status: 403/);
});

// Execute the actual declarations with the database/provider boundaries replaced;
// pure capabilities and validation stay real. No production test hooks are needed.
const ast = ts.createSourceFile("employee.ts", employee, ts.ScriptTarget.Latest, true);
function declaration(name: string) {
  const node = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, `${name} exists`);
  return node.getText(ast);
}
class Forbidden extends Error {}
class NotFound extends Error {}
class Validation extends Error {}
class Conflict extends Error {
  constructor(message: string, readonly reason?: string) { super(message); }
}
const access = { role: "employee", personId: "employee", organizationId: "org" };
const row = { id: "task", organization_id: "org", title: "Original", provider: "local", completed: false, assigned_by_person_id: "manager", assignee_person_ids: ["employee"], due_date: "2026-10-28" };
function harness(name: string, task: Record<string, unknown> = row, optionsPeople = ["employee"]) {
  const writes: Array<Record<string, unknown>> = [];
  const events: string[] = [];
  const dependencies = {
    taskCapabilities, isWorkflowStatus,
    taskActor: (actor: any) => ({ role: actor.role, personId: actor.personId }),
    employeeTaskToday: async () => "2026-10-27",
    employeeTaskContext: async (_access: unknown, id: string) => {
      if (id === "missing") throw new NotFound();
      return { ownerId: "owner", task: id === "parent" ? { ...row, id, assigned_by_person_id: "employee" } : task };
    },
    organizationOwnerId: async () => "owner",
    getTaskByLocalOrProviderId: async () => task,
    getWorkOsTaskCreationOptions: async () => ({ people: optionsPeople.map((id) => ({ id })) }),
    updateTask: async (_owner: string, _id: string, patch: Record<string, unknown>) => { writes.push(patch); return { ...task, ...patch }; },
    audit: async (_access: unknown, event: string) => { events.push(event); },
    text: (value: unknown) => typeof value === "string" ? value.trim() || null : null,
    WorkOsForbiddenError: Forbidden, WorkOsNotFoundError: NotFound, WorkOsValidationError: Validation, WorkOsConflictError: Conflict,
    taskRequiresCompletionEvidence: () => false,
    completionRow: (task: Record<string, unknown>) => task,
    // Any lifecycle I/O here means a refusal arrived too late.
    applyTaskCompletion: async () => { writes.push({ completion: true }); return { failures: [] }; },
    archiveTask: async () => { writes.push({ archive: true }); return task; },
    deleteTask: async () => { writes.push({ delete: true }); return task; },
    moveTaskToParent: async () => { writes.push({ move: true }); return task; },
  };
  const javascript = ts.transpileModule(`${declaration("validateAgentAssignment")}\n${declaration(name)}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  new Function("exports", ...Object.keys(dependencies), javascript)(exports, ...Object.values(dependencies));
  return { run: exports[name], writes, events };
}

for (const [name, body] of [
  ["updateWorkOsEmployeeTask", { name: "Changed" }],
  ["archiveWorkOsEmployeeTask", undefined],
  ["deleteWorkOsEmployeeTask", undefined],
  ["moveWorkOsEmployeeSubtask", { parent_task_id: "parent" }],
] as const) {
  test(`${name}: assigned-by-other tasks are read-only even when their parent is editable`, async () => {
    const { run, writes } = harness(name, { ...row, parent_task_id: "parent" });
    await assert.rejects(run(access, "task", body), Forbidden);
    assert.deepEqual(writes, []);
  });
}
for (const name of ["setWorkOsEmployeeTaskCompletion", "completeWorkOsTask"]) {
  test(`${name}: assigners cannot complete or reopen someone else's work`, async () => {
    for (const completed of [true, false]) {
      const { run, writes } = harness(name, { ...row, completed: !completed, assigned_by_person_id: "employee", assignee_person_ids: ["other"] });
      await assert.rejects(run(access, "task", completed), Forbidden);
      assert.deepEqual(writes, []);
    }
  });
}
test("status rejects invalid, invisible, completed, overdue, and unauthorized work without writes", async () => {
  for (const fixture of [
    { task: row, id: "task", status: "complete", error: Validation },
    { task: row, id: "missing", status: "pending", error: NotFound },
    { task: { ...row, completed: true }, id: "task", status: "pending", error: Conflict, reason: "task_completed" },
    { task: { ...row, due_date: "2026-10-26" }, id: "task", status: "pending", error: Conflict, reason: "due_date_passed" },
    { task: { ...row, assignee_person_ids: ["other"] }, id: "task", status: "pending", error: Forbidden },
  ]) {
    const { run, writes } = harness("updateWorkOsEmployeeTaskStatus", fixture.task);
    await assert.rejects(run(access, fixture.id, fixture.status), (error: unknown) => error instanceof fixture.error && (!fixture.reason || error instanceof Conflict && error.reason === fixture.reason));
    assert.deepEqual(writes, []);
  }
});
test("assignees may change status and the status write retains workflow provenance", async () => {
  const { run, writes, events } = harness("updateWorkOsEmployeeTaskStatus");
  assert.equal((await run(access, "task", "in_progress")).task.workflow_status, "in_progress");
  assert.deepEqual(writes, [{ workflow_status: "in_progress" }]);
  assert.deepEqual(events, ["task.status_changed"]);
});
test("editing supports partial dates/priority and scopes reassignment before writing", async () => {
  const task = { ...row, assigned_by_person_id: "employee" };
  const h = harness("updateWorkOsEmployeeTask", task);
  await assert.rejects(h.run(access, "task", { name: "Changed", assignee_person_ids: ["outsider"] }), Validation);
  assert.deepEqual(h.writes, []);
  await h.run(access, "task", { due_date: "2026-10-29", start_date: null, priority: "high", assignee_person_ids: [] });
  assert.deepEqual(h.writes, [{ due_date: "2026-10-29", start_date: null, priority: "high", assignee_person_ids: [], assigned_by_person_id: "employee" }]);
  assert.deepEqual(h.events, ["task.updated", "task.assigned"]);
});
test("replaying an identical assignment succeeds without rewriting its provenance", async () => {
  const h = harness("updateWorkOsEmployeeTask", { ...row, assigned_by_person_id: "employee" });
  await h.run(access, "task", { assignee_person_ids: ["employee"] });
  assert.deepEqual(h.writes, [{ assignee_person_ids: ["employee"] }]);
  assert.deepEqual(h.events, ["task.updated"]);
});
test("a creator can still access reassigned work and null identities grant no access", () => {
  const javascript = ts.transpileModule(declaration("isEmployeeTaskAccessible"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports: Record<string, any> = {};
  new Function("exports", "isTaskAttributableToPerson", javascript)(exports, (task: any, personId: string | null) => personId !== null && task.assignee_person_ids?.includes(personId));
  assert.equal(exports.isEmployeeTaskAccessible({ ...row, assigned_by_person_id: "employee", assignee_person_ids: ["other"] }, null, "employee", null), true);
  assert.equal(exports.isEmployeeTaskAccessible(row, null, null, null), false);
});

test("task context denies cross-workspace rows before the admin bypass", async () => {
  const javascript = ts.transpileModule(`${declaration("employeeTaskContext")}\nexports.context = employeeTaskContext;`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  new Function("exports", "organizationOwnerId", "getTaskByLocalOrProviderId", "WorkOsNotFoundError", javascript)(exports, async () => "owner", async () => ({ ...row, organization_id: "other-org" }), NotFound);
  await assert.rejects(exports.context({ ...access, role: "admin", personId: null }, "task"), NotFound);
});
test("admin completion denies cross-workspace rows before any lifecycle write", async () => {
  const h = harness("completeWorkOsTask", { ...row, organization_id: "other-org" });
  await assert.rejects(h.run({ ...access, role: "admin" }, "task", true), NotFound);
  assert.deepEqual(h.writes, []);
});

test("PATCH routes status-only changes and rejects mixed or malformed workflow requests", async () => {
  const routeAst = ts.createSourceFile("route.ts", route, ts.ScriptTarget.Latest, true);
  const node = routeAst.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "PATCH");
  assert.ok(node);
  const javascript = ts.transpileModule(node.getText(routeAst), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls: unknown[] = [];
  const exports: Record<string, any> = {};
  const unexpected = () => { throw new Error("status request reached a different mutation"); };
  new Function("exports", "access", "NextResponse", "isWorkflowStatus", "updateWorkOsEmployeeTaskStatus", "setWorkOsEmployeeTaskCompletion", "moveWorkOsEmployeeSubtask", "updateWorkOsEmployeeTask", "jsonError", javascript)(
    exports, async () => ({ access }), Response, isWorkflowStatus,
    async (...args: unknown[]) => { calls.push(args); return { task: { workflow_status: args[2] } }; },
    unexpected, unexpected, unexpected, (error: Error) => Response.json({ error: error.message }, { status: 500 }),
  );
  const context = { params: Promise.resolve({ taskId: "task" }) };
  for (const body of [null, [], { workflow_status: null }, { workflow_status: "complete" }, { workflow_status: "pending", completed: true }, { workflow_status: "pending", name: "Changed" }, { workflow_status: "pending", parent_task_id: "parent" }]) {
    const response = await exports.PATCH(new Request("http://localhost/tasks/task", { method: "PATCH", body: JSON.stringify(body) }), context);
    assert.equal(response.status, 400);
  }
  assert.deepEqual(calls, []);
  const response = await exports.PATCH(new Request("http://localhost/tasks/task", { method: "PATCH", body: JSON.stringify({ workflow_status: "in_progress" }) }), context);
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [[access, "task", "in_progress"]]);
});
