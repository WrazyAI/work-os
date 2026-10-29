import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isCalendarDate, isWorkflowStatus, taskCapabilities, taskIsOverdue } from "../src/lib/work-os-task-permissions";

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
  // A row without embedded children gains no empty array.
  assert.equal("subtasks" in result[0], false);
});
test("capability decoration reaches one level of embedded subtasks", () => {
  const actor = { role: "employee" as const, personId: "worker" };
  const parent = { id: "parent", completed: false, due_date: "2026-10-28", assignee_person_ids: ["manager"], assigned_by_person_id: "manager" };
  const child = { id: "child", completed: false, due_date: "2026-10-28", assignee_person_ids: ["worker"], assigned_by_person_id: "manager" };
  const [row] = seam.withTaskCapabilities([{ ...parent, subtasks: [child] }], actor, "2026-10-27");
  // The parent is delegated work the worker cannot manage; the child is the
  // worker's own, so a web list that renders `task.subtasks` gates each one.
  assert.equal(row.capabilities.canEdit, false);
  assert.equal(row.capabilities.canComplete, false);
  assert.equal(row.subtasks.length, 1);
  assert.deepEqual(row.subtasks[0].capabilities, taskCapabilities(child, actor, "2026-10-27"));
  assert.equal(row.subtasks[0].capabilities.canComplete, true);
  assert.equal(row.subtasks[0].capabilities.canEdit, false);
  // The input row and child stay untouched.
  assert.equal("capabilities" in child, false);
});
test("web employee controls follow the server capability payload", () => {
  const employees = read("src/modules/work-os/employee/EmployeeTasks.tsx");
  const drawer = read("src/modules/work-os/employee/EmployeeTaskDrawer.tsx");
  assert.match(employees, /rowCompletionAllowed\(task\)/);
  assert.match(employees, /rowCompletionAllowed\(subtask\)/);
  assert.match(employees, /rowActionAllowed\(task, "canEdit"\)/);
  assert.match(employees, /rowActionAllowed\(task, "canArchive"\)/);
  assert.match(employees, /rowActionAllowed\(task, "canDelete"\)/);
  assert.match(drawer, /capabilities\.canEdit === true/);
  assert.match(drawer, /capabilities\.canArchive === true/);
  assert.match(drawer, /capabilities\.canDelete === true/);
});

test("employee date uses the canonical shift-local date seam", () => {
  assert.match(capabilities, /employeeTaskToday\(access\)/);
  const adminList = read("src/app/api/work-os/tasks/route.ts");
  const adminDetail = read("src/app/api/work-os/tasks/[taskId]/route.ts");
  const adminLibrary = read("src/lib/work-os-task-admin.ts");
  for (const source of [adminList, adminDetail, adminLibrary]) assert.match(source, /employeeTaskToday\(/);
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
    taskIsOverdue, isWorkflowStatus, isCalendarDate, withTaskCapabilities: seam.withTaskCapabilities,
    employeeTaskToday: async () => "2026-10-27",
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
test("an unmapped admin assignment leaves no assigner and no assignee management", async () => {
  // The assigner is the actor's person mapping. An admin without one must never
  // inherit the stale assigner from the row it is changing.
  const h = harness({ ...row, assigned_by_person_id: "old-assigner" });
  const unmapped = { ...access, personId: null };
  const result = await h.updateWorkOsAdminTask(unmapped, "task", { assignee_person_ids: ["new"] });
  assert.deepEqual(h.writes, [{ assignee_person_ids: ["new"], assigned_by_person_id: null }]);
  assert.equal(result.task.assigned_by_person_id, null);
  // The new assignee keeps completion and status, but not edit/archive/delete.
  const assignee = taskCapabilities({ ...row, assigned_by_person_id: null, assignee_person_ids: ["new"] }, { role: "employee", personId: "new" }, "2026-10-27");
  assert.equal(assignee.canComplete, true);
  assert.equal(assignee.canChangeStatus, true);
  assert.equal(assignee.canEdit, false);
  assert.equal(assignee.canArchive, false);
  assert.equal(assignee.canDelete, false);
  assert.equal(assignee.canAssign, false);
});

test("admin due-date validation rejects malformed and impossible dates before writing", async () => {
  const h = harness();
  for (const due_date of ["soon", "2026-02-30", "2026-13-01"]) {
    await assert.rejects(h.updateWorkOsAdminTask(access, "task", { due_date }), Validation);
  }
  assert.deepEqual(h.writes, []);
  await h.updateWorkOsAdminTask(access, "task", { due_date: "2026-10-29" });
  assert.deepEqual(h.writes, [{ due_date: "2026-10-29" }]);
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

/** Execute the admin task route against stubbed handlers and a query chain that
 * records the filters the summary actually sends. */
function adminRouteHarness(overrides: Record<string, unknown> = {}) {
  const comparisons: Array<[string, unknown]> = [];
  const query: any = {
    select: () => query,
    eq: () => query,
    not: () => query,
    contains: () => query,
    gte: () => query,
    lt: (column: string, value: unknown) => { comparisons.push([column, value]); return query; },
    then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null, count: 0 }),
  };
  const routes = execute(read("src/app/api/work-os/tasks/route.ts"), {
    requireWorkOsAdmin: async () => ({ access }),
    workOsOrganizationOwnerId: () => "owner",
    listTasks: async () => [],
    listPersonTasks: async () => [],
    createAdminClient: () => ({ from: () => query }),
    getTaskByLocalOrProviderId: async () => null,
    createLocalWorkOsTask: async () => { throw new Error("not used"); },
    defaultWorkOsTaskProjectId: async () => null,
    NextResponse: Response,
    jsonError: (error: Error) => Response.json({ error: error.message }, { status: error instanceof Validation ? 400 : 500 }),
    employeeTaskToday: async () => "2026-10-27",
    withTaskCapabilities: seam.withTaskCapabilities,
    isCalendarDate,
    WorkOsValidationError: Validation,
    ...overrides,
  });
  return { routes, comparisons };
}

test("the admin summary counts overdue against the employee day the rows are decorated with", async () => {
  const tasks = [{ id: "task", completed: false, due_date: "2026-10-26", assignee_person_ids: ["admin"], assigned_by_person_id: "admin" }];
  const { routes, comparisons } = adminRouteHarness({ listTasks: async () => tasks });
  const response = await routes.GET(new Request("http://localhost/tasks?limit=50"));
  assert.equal(response.status, 200);
  const body = await response.json();
  // The row capabilities use 2026-10-27 (the employee's day), so the summary
  // count must use that same day rather than the UTC date.
  assert.deepEqual(comparisons, [["due_date", "2026-10-27"]]);
  assert.equal(body.tasks[0].capabilities.overdue, true);
  assert.equal(body.tasks[0].capabilities.statusLocked, true);
  assert.deepEqual(body.summary, { open: 0, overdue: 0, completedWeek: 0 });
});

test("admin task creation refuses a malformed due date before the write", async () => {
  const creations: Array<Record<string, any>> = [];
  const { routes } = adminRouteHarness({
    createLocalWorkOsTask: async (_access: unknown, input: Record<string, any>) => { creations.push(input); return { id: "created", ...input }; },
  });
  const post = (body: unknown) => routes.POST(new Request("http://localhost/tasks", { method: "POST", body: JSON.stringify(body) }));
  for (const due_date of ["soon", "2026-02-30", "2026-13-01", "2026-1-2"]) {
    assert.equal((await post({ name: "Task", due_date })).status, 400);
  }
  assert.equal(creations.length, 0);
  const created = await post({ name: "Task", due_date: "2026-10-30" });
  assert.equal(created.status, 201);
  assert.equal(creations.at(-1)?.dueDate, "2026-10-30");
  // Absent or empty stays "no due date" instead of becoming an invalid string.
  assert.equal((await post({ name: "Task", due_date: "" })).status, 201);
  assert.equal(creations.at(-1)?.dueDate, null);
});
