import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isWorkflowStatus, taskCapabilities, taskIsOverdue } from "../src/lib/work-os-task-permissions";

const read = (path: string) => readFileSync(path, "utf8");
const capabilities = read("src/lib/work-os-task-capabilities.ts");
const admin = read("src/lib/work-os-task-admin.ts");
function execute(source: string, dependencies: Record<string, unknown>) {
  const ast = ts.createSourceFile("source.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(ast)).join("\n");
  const js = ts.transpileModule(declarations, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports: Record<string, any> = {};
  new Function("exports", ...Object.keys(dependencies), js)(exports, ...Object.values(dependencies));
  return exports;
}
const seam = execute(capabilities, { taskCapabilities });
test("capability decoration copies rows without mutating input", () => {
  const tasks = Object.freeze([Object.freeze({ id: "task", completed: false, due_date: "2026-10-26", assignee_person_ids: ["person"] })]);
  const actor = { role: "employee" as const, personId: "person" };
  const result = seam.withTaskCapabilities(tasks, actor, "2026-10-27");
  assert.notEqual(result, tasks);
  assert.notEqual(result[0], tasks[0]);
  assert.deepEqual(result[0].capabilities, taskCapabilities(tasks[0], actor, "2026-10-27"));
  assert.equal("capabilities" in tasks[0], false);
});
test("employee date uses the canonical shift-local date seam", () => {
  assert.match(capabilities, /employeeTaskToday\(access, access.personId \?\? ""\)/);
});
test("all employee lists, creations and details decorate task rows", () => {
  const list = read("src/app/api/work-os/me/tasks/route.ts");
  assert.ok((list.match(/withTaskCapabilities\(/g) ?? []).length >= 6);
  assert.match(list, /workspace: \{ \.\.\.workspace, tasks/);
  const detail = read("src/app/api/work-os/me/tasks/[taskId]/route.ts");
  assert.match(detail, /withTaskCapabilities\(\[.*task\]/);
  assert.match(detail, /withTaskCapabilities\(.*subtasks/);
  const day = read("src/lib/work-os-day-view.ts");
  assert.match(day, /withTaskCapabilities\(workspace.tasks, actor, shiftDate\)/);
  assert.match(day, /withTaskCapabilities\(taskHistory \?\? \[\], actor, shiftDate\)/);
});
test("admin contracts preserve payload shapes and expose lifecycle routes", () => {
  const list = read("src/app/api/work-os/tasks/route.ts");
  assert.match(list, /tasks: withTaskCapabilities\(tasks,/);
  assert.match(list, /task: withTaskCapabilities\(\[task\]/);
  const detail = read("src/app/api/work-os/tasks/[taskId]/route.ts");
  assert.match(detail, /task: withTaskCapabilities/);
  assert.match(detail, /subtasks: withTaskCapabilities/);
  assert.match(detail, /export async function DELETE/);
  assert.match(detail, /removeWorkOsAdminTask\(auth.access, taskId, mode\)/);
  assert.match(detail, /updateWorkOsAdminTask\(auth.access, taskId,/);
  const tasks = read("src/lib/work-os-tasks.ts");
  assert.match(tasks, /if \("workflow_status" in patch\)/);
  assert.match(tasks, /if \("assigned_by_person_id" in patch\)/);
});
class Forbidden extends Error {}
class NotFound extends Error {}
class Validation extends Error {}
class Conflict extends Error { constructor(message: string, readonly reason?: string) { super(message); } }
const access = { role: "admin", personId: "admin", organizationId: "org" };
const row = { id: "task", provider: "local", organization_id: "org", completed: false, due_date: "2999-01-01", assignee_person_ids: ["old"] };
function harness(task: Record<string, any> = row) {
  const writes: any[] = [];
  const events: string[] = [];
  const run = execute(admin, {
    taskIsOverdue, isWorkflowStatus, withTaskCapabilities: seam.withTaskCapabilities,
    workOsOrganizationOwnerId: () => "owner",
    getTaskByLocalOrProviderId: async () => task,
    getWorkOsTaskCreationOptions: async () => ({ people: [{ id: "new" }, { id: "old" }] }),
    updateTask: async (_owner: string, _id: string, patch: any) => { writes.push(patch); return { ...task, ...patch }; },
    completeWorkOsTask: async (_access: unknown, _id: string, completed: boolean) => { writes.push({ lifecycle: completed }); return { ...task, completed }; },
    archiveWorkOsEmployeeTask: async () => ({ task: { ...task, status: "archived" } }),
    deleteWorkOsEmployeeTask: async () => ({ task: { ...task, status: "deleted" } }),
    audit: async (_access: unknown, event: string) => { events.push(event); },
    WorkOsForbiddenError: Forbidden, WorkOsNotFoundError: NotFound, WorkOsValidationError: Validation, WorkOsConflictError: Conflict,
  });
  return { updateWorkOsAdminTask: run.updateWorkOsAdminTask, removeWorkOsAdminTask: run.removeWorkOsAdminTask, writes, events };
}
test("admin refuses unauthorized, cross-workspace, malformed, mixed and locked updates before writes", async () => {
  for (const [task, actor, body, error, reason] of [
    [row, { ...access, role: "manager" }, { name: "Changed" }, Forbidden],
    [{ ...row, organization_id: "other" }, access, { name: "Changed" }, NotFound],
    [row, access, { completed: "true" }, Validation],
    [row, access, { completed: true, name: "Changed" }, Validation],
    [row, access, { workflow_status: "done" }, Validation],
    [{ ...row, due_date: "2000-01-01" }, access, { workflow_status: "pending" }, Conflict, "due_date_passed"],
    [{ ...row, completed: true }, access, { workflow_status: "pending" }, Conflict, "task_completed"],
    [row, access, { assignee_person_ids: ["outsider"] }, Validation],
  ] as const) {
    const h = harness(task);
    await assert.rejects(h.updateWorkOsAdminTask(actor, "task", body), (err: any) => err instanceof error && (!reason || err instanceof Conflict && err.reason === reason));
    assert.deepEqual(h.writes, []);
  }
});
test("admin completion uses the lifecycle seam and returns capabilities", async () => {
  const h = harness();
  const result = await h.updateWorkOsAdminTask(access, "task", { completed: true });
  assert.deepEqual(h.writes, [{ lifecycle: true }]);
  assert.equal(result.task.completed, true);
  assert.equal(result.task.capabilities.canReopen, true);
});
test("admin reassignment records provenance and audits only actual changes", async () => {
  const h = harness();
  await h.updateWorkOsAdminTask(access, "task", { assignee_person_ids: ["new"], assigned_by_person_id: "forged" });
  assert.deepEqual(h.writes, [{ assignee_person_ids: ["new"], assigned_by_person_id: "admin" }]);
  assert.ok(h.events.includes("task.assigned"));
  const unchanged = harness();
  await unchanged.updateWorkOsAdminTask(access, "task", { assignee_person_ids: ["old"] });
  assert.deepEqual(unchanged.writes, [{ assignee_person_ids: ["old"] }]);
  assert.ok(!unchanged.events.includes("task.assigned"));
});
test("admin status and removal return decorated rows", async () => {
  const h = harness();
  const result = await h.updateWorkOsAdminTask(access, "task", { workflow_status: "in_progress" });
  assert.equal(result.task.workflow_status, "in_progress");
  assert.equal(result.task.capabilities.canEdit, true);
  for (const mode of ["archive", "delete"]) {
    const removed = await h.removeWorkOsAdminTask(access, "task", mode);
    assert.equal(removed.task.status, mode === "archive" ? "archived" : "deleted");
    assert.ok(removed.task.capabilities);
  }
});

test("employee PATCH executes every single-action dispatch with decorated responses", async () => {
  const employee = { ...access, role: "employee" };
  const calls: string[] = [];
  const mutation = (kind: string) => async () => { calls.push(kind); return { task: row, providerStatus: "work_os_confirmed" }; };
  const routes = execute(read("src/app/api/work-os/me/tasks/[taskId]/route.ts"), {
    requireWorkOsAccess: async () => ({ access: employee }),
    NextResponse: Response, isWorkflowStatus,
    WorkOsValidationError: Validation,
    jsonError: (error: Error) => Response.json({ error: error.message }, { status: error instanceof Validation ? 400 : 500 }),
    employeeToday: async () => "2026-10-27", withTaskCapabilities: seam.withTaskCapabilities,
    updateWorkOsEmployeeTaskStatus: mutation("status"), setWorkOsEmployeeTaskCompletion: mutation("completion"),
    moveWorkOsEmployeeSubtask: mutation("move"), updateWorkOsEmployeeTask: mutation("edit"),
  });
  const send = (body: unknown) => routes.PATCH(new Request("http://localhost/tasks/task", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ taskId: "task" }) });
  for (const body of [{ completed: true }, { workflow_status: "pending" }, { parent_task_id: "parent" }, { name: "Changed" }]) {
    const response = await send(body);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).task.capabilities, taskCapabilities(row, employee as any, "2026-10-27"));
  }
  assert.deepEqual(calls, ["completion", "status", "move", "edit"]);
  assert.equal((await send({ completed: true, name: "Changed" })).status, 400);
  assert.equal(calls.length, 4);
});
