import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WorkOsNotFoundError, jsonError } from "../src/lib/work-os-api";
import { agentRouteError } from "../src/lib/work-agent-auth";
import { validateAgentAssignment, validateAgentTaskUpdate } from "../src/lib/work-os-employee-tasks";
import { agentCreateAssignees, validateAgentTaskCreate } from "../src/lib/work-agent-tasks";
import { effortMinutesPatch } from "../src/lib/work-os-tasks";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("a missing or archived task answers 404, not 400 or 502", async () => {
  const response = jsonError(new WorkOsNotFoundError("Task not found"));
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.deepEqual(body, { error: "Task not found" });
});

test("an unexpected failure still answers 500 instead of claiming not found", async () => {
  const response = jsonError(new Error("database is offline"));
  assert.equal(response.status, 500);
});

test("agent create accepts groups, effort, and validated assignees", () => {
  assert.deepEqual(
    validateAgentTaskCreate({
      name: "Plan the sprint",
      task_group_id: "group-1",
      estimated_effort_minutes: 90,
      effort_unit: "hours",
      assignee_person_ids: ["person-1"],
    }),
    {
      name: "Plan the sprint",
      task_group_id: "group-1",
      estimated_effort_minutes: 90,
      effort_unit: "hours",
      assignee_person_ids: ["person-1"],
    },
  );
});

test("agent update accepts assignment and subtask moves but still rejects project moves", () => {
  assert.deepEqual(
    validateAgentTaskUpdate({ assignee_person_ids: ["person-2"], parent_task_id: "parent-1" }),
    { assignee_person_ids: ["person-2"], parent_task_id: "parent-1" },
  );
  assert.throws(() => validateAgentTaskUpdate({ project_id: "project-1" }), /project_id/);
  assert.throws(() => validateAgentTaskUpdate({}), /field/i);
});

test("a local task update persists its group, effort, and estimate unit", async () => {
  const source = await read("src/lib/work-os-tasks.ts");
  const localBranch = source.slice(source.indexOf("export async function updateTask"), source.indexOf("const providerTaskId = task.provider_task_id"));
  assert.match(localBranch, /task_group_id/);
  assert.match(localBranch, /estimated_effort_minutes/);
  assert.match(localBranch, /effort_unit/);
});

test("task creation options expose projects beside assignable people", async () => {
  const source = await read("src/lib/work-os-employee-tasks.ts");
  const options = source.slice(source.indexOf("export async function getWorkOsTaskCreationOptions"), source.indexOf("async function employeeTaskContext"));
  assert.match(options, /projects:/);
  assert.match(options, /people:/);
});

test("employees list organization projects instead of being turned away", async () => {
  const source = await read("src/app/api/work-os/projects/route.ts");
  assert.doesNotMatch(source, /requireWorkOsAdmin/);
  assert.match(source, /requireWorkOsAccess/);
});

test("the agent API exposes creation options and task removal", async () => {
  const options = await read("src/app/api/agent/v1/options/route.ts");
  assert.match(options, /"tasks:read"/);
  assert.match(options, /projects/);
  assert.match(options, /people/);
  // Assignment through a token is self-only, so options never advertise a
  // coworker the create/update guards would reject.
  assert.match(options, /person\.id === auth\.agent\.access\.personId/);
  const task = await read("src/app/api/agent/v1/tasks/[taskId]/route.ts");
  assert.match(task, /export async function DELETE/);
  assert.match(task, /"tasks:write"/);
  assert.match(task, /mode/);
});

test("archived tasks stay reachable for removal but not for editing", async () => {
  const source = await read("src/lib/work-os-employee-tasks.ts");
  assert.match(source, /allowArchived/);
});

test("agent creation assigns only the token's own person", () => {
  assert.deepEqual(agentCreateAssignees("self", undefined), ["self"]);
  assert.deepEqual(agentCreateAssignees("self", ["self"]), ["self"]);
  assert.deepEqual(agentCreateAssignees("self", ["self", "self"]), ["self"]);
  assert.deepEqual(agentCreateAssignees("self", []), []);
  for (const requested of [["other"], ["self", "other"]]) {
    assert.throws(() => agentCreateAssignees("self", requested), /own person/);
  }
  assert.throws(() => agentCreateAssignees("self", ["other", 7]), /assignee_person_ids/);
});

test("an unknown or deleted task id is a 404 from the base lookup", async () => {
  const source = await read("src/lib/work-os-tasks.ts");
  const lookup = source.slice(source.indexOf("export async function getTaskByLocalOrProviderId"));
  assert.match(lookup, /throw new WorkOsNotFoundError/);
});

test("task effort rejects nonsense instead of silently clearing the estimate", () => {
  assert.equal(effortMinutesPatch(90), 90);
  assert.equal(effortMinutesPatch(0), 0);
  assert.equal(effortMinutesPatch(null), null);
  assert.throws(() => effortMinutesPatch(-1), /non-negative/);
  assert.throws(() => effortMinutesPatch(1.5), /whole number/);
  assert.throws(() => effortMinutesPatch("invalid"), /whole number/);
});

test("agent assignment validation rejects ids outside the assignable set", () => {
  assert.deepEqual(validateAgentAssignment(["a", "b"], ["a", "b", "a"]), ["a", "b"]);
  assert.throws(() => validateAgentAssignment(["a"], ["z"]), /active Work OS organization members/);
  assert.throws(() => validateAgentAssignment(["a"], "a"), /array of person ids/);
  assert.throws(() => validateAgentAssignment(["a"], [1]), /array of person ids/);
});

test("a subtask move validates assignment before changing the parent", async () => {
  const source = await read("src/lib/work-os-employee-tasks.ts");
  const update = source.slice(source.indexOf("export async function updateWorkOsAgentTask"), source.indexOf("export async function setWorkOsEmployeeTaskCompletion"));
  assert.ok(update.indexOf("validateAgentAssignment") < update.indexOf("moveWorkOsEmployeeSubtask"), "assignment validates before the move");
});

test("a retried agent delete replays instead of answering 404", async () => {
  const route = await read("src/app/api/agent/v1/tasks/[taskId]/route.ts");
  assert.match(route, /withAgentIdempotency/);
  const spec = await read("docs/openapi/work-os-agent-v1.yaml");
  const remove = spec.slice(spec.indexOf("operationId: removeTask"));
  assert.match(remove.slice(0, 900), /IdempotencyKey/);
});

test("effort accepts only real numbers or numeric strings", () => {
  assert.equal(effortMinutesPatch("45"), 45);
  assert.throws(() => effortMinutesPatch(" "), /whole number/);
  assert.throws(() => effortMinutesPatch([]), /whole number/);
  assert.throws(() => effortMinutesPatch({}), /whole number/);
  assert.throws(() => effortMinutesPatch(false), /whole number/);
});

test("an invalid estimate is refused before a subtask moves", async () => {
  const source = await read("src/lib/work-os-employee-tasks.ts");
  const update = source.slice(source.indexOf("export async function updateWorkOsAgentTask"), source.indexOf("export async function setWorkOsEmployeeTaskCompletion"));
  const validateAt = update.indexOf("effortMinutesPatch");
  const moveAt = update.indexOf("moveWorkOsEmployeeSubtask");
  assert.ok(validateAt >= 0 && moveAt >= 0, "both the estimate check and the move are present");
  assert.ok(validateAt < moveAt, "the estimate validates before the move");
});

test("task creation normalizes a supplied estimate instead of dropping it", async () => {
  const source = await read("src/lib/work-os-employee-tasks.ts");
  const create = source.slice(source.indexOf("export async function createWorkOsEmployeeTask"), source.indexOf("async function completionEvidence"));
  assert.match(create, /effortMinutesPatch/);
});

test("the agent error mapper answers 404 for a typed not-found, whatever its wording", async () => {
  const notFound = agentRouteError(new WorkOsNotFoundError("Task was removed earlier"));
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json()).code, "not_found");
  const accessible = agentRouteError(new WorkOsNotFoundError("Task is not available to this employee"));
  assert.equal(accessible.status, 404);
});

test("the documented delete operation lists the idempotency conflict", async () => {
  const spec = await read("docs/openapi/work-os-agent-v1.yaml");
  const remove = spec.slice(spec.indexOf("operationId: removeTask"), spec.indexOf("/tasks/{taskId}/complete:"));
  assert.match(remove, /"409": \{ \$ref: "#\/components\/responses\/Conflict" \}/);
});

test("moving a non-subtask is a caller error, not a server fault", async () => {
  const source = await read("src/lib/work-os-employee-tasks.ts");
  assert.match(source, /throw new WorkOsValidationError\("Only subtasks can be moved"\)/);
});

test("an agent update honors the exact assignee list it was given", async () => {
  const source = await read("src/lib/work-os-employee-tasks.ts");
  const update = source.slice(source.indexOf("export async function updateWorkOsAgentTask"), source.indexOf("export async function setWorkOsEmployeeTaskCompletion"));
  assert.match(update, /patch\.assignee_person_ids = assignees/);
  assert.doesNotMatch(update, /access\.personId as string, \.\.\.assignees/);
});

test("the documented agent reassignment contract matches the self-only rule", async () => {
  const spec = await read("docs/openapi/work-os-agent-v1.yaml");
  const update = spec.slice(spec.indexOf("TaskUpdate:"), spec.indexOf("ProgressNote:"));
  // The self-only rule rejects a coworker handoff, so the schema must not
  // promise a hand-over or a 404 after the token's person is removed.
  assert.match(update, /self-only/);
  assert.match(update, /any other id answers 400/);
  assert.doesNotMatch(update, /hands the work over/);
  assert.doesNotMatch(update, /without a tombstone/);
});

test("a board group id is a bounded opaque string, not free-form junk", () => {
  assert.equal(validateAgentTaskCreate({ name: "x", task_group_id: "PDp!eGkwR5" }).task_group_id, "PDp!eGkwR5");
  assert.throws(() => validateAgentTaskCreate({ name: "x", task_group_id: "g".repeat(201) }), /task_group_id/);
  assert.throws(() => validateAgentTaskUpdate({ task_group_id: 42 }), /task_group_id/);
});

test("subtask move refusals are caller errors, not server faults", async () => {
  const source = await read("src/lib/work-os-tasks.ts");
  const target = source.slice(source.indexOf("export function assertSubtaskMoveTarget"), source.indexOf("export async function moveTaskToParent"));
  assert.doesNotMatch(target, /throw new Error\(/);
  assert.match(target, /WorkOsValidationError/);
});

test("agent create accepts story points like the employee composer", () => {
  assert.deepEqual(
    validateAgentTaskCreate({ name: "Size the work", story_points: 5 }),
    { name: "Size the work", story_points: 5 },
  );
});
