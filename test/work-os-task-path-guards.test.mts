import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

import { assertSubtaskMoveTarget, assertTopLevelTaskParent } from "../src/lib/work-os";
import { assertSubtaskProjectInherited } from "../src/lib/work-os-local-tasks";

/**
 * Regression coverage for the task paths that could leave their project or
 * outlive their own authorization:
 *
 * 1. a Work OS subtask could be re-homed into another local project while the
 *    Nifty path rejected the same move;
 * 2. employee task creation accepted a subtask as parent, producing a
 *    second-level subtask the move path explicitly forbids;
 * 3. `getWorkOsEmployeeTaskDetails` returned the row a provider refresh had
 *    just reassigned to another employee, because access was checked against
 *    the stale pre-refresh mirror.
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const localTask = (over: Record<string, unknown> = {}) => ({
  id: "child",
  provider: "local",
  organization_id: "org",
  project_id: "project-a",
  provider_project_id: null,
  parent_task_id: "parent-a",
  ...over,
});

const localParent = (over: Record<string, unknown> = {}) => ({
  id: "parent-b",
  provider: "local",
  organization_id: "org",
  project_id: "project-a",
  parent_task_id: null,
  ...over,
});

test("a local subtask cannot move into another project", () => {
  assert.throws(
    () => assertSubtaskMoveTarget(localTask(), localParent({ project_id: "project-b" })),
    /Subtasks can only be moved between tasks in the same project/,
  );
  assert.doesNotThrow(() => assertSubtaskMoveTarget(localTask(), localParent()));
  // An unprojected subtask stays unprojected rather than inheriting a project.
  assert.throws(
    () => assertSubtaskMoveTarget(localTask({ project_id: null }), localParent()),
    /same project/,
  );
});

test("the move guard still blocks the original shapes", () => {
  assert.throws(() => assertSubtaskMoveTarget(localTask({ id: "same" }), localParent({ id: "same" })), /own parent/);
  assert.throws(
    () => assertSubtaskMoveTarget(localTask({ parent_task_id: null, parent_provider_task_id: null }), localParent()),
    /Only subtasks can be moved/,
  );
  assert.throws(() => assertSubtaskMoveTarget(localTask(), localParent({ parent_task_id: "grandparent" })), /top-level task/);
  assert.throws(() => assertSubtaskMoveTarget(localTask(), localParent({ organization_id: "other-org" })), /same project/);
});

test("Nifty moves keep the same provider project", () => {
  const niftyChild = {
    id: "child",
    provider: "nifty",
    organization_id: "org",
    provider_task_id: "provider-child",
    provider_project_id: "provider-project-a",
    parent_provider_task_id: "provider-old-parent",
    project_id: "project-a",
  };
  const niftyParent = {
    id: "parent",
    provider: "nifty",
    organization_id: "org",
    provider_task_id: "provider-parent",
    provider_project_id: "provider-project-a",
    parent_task_id: null,
  };
  assert.doesNotThrow(() => assertSubtaskMoveTarget(niftyChild, niftyParent));
  assert.throws(
    () => assertSubtaskMoveTarget(niftyChild, { ...niftyParent, provider_project_id: "provider-project-b" }),
    /same Nifty project/,
  );
  assert.throws(
    () => assertSubtaskMoveTarget(niftyChild, localParent()),
    /Nifty subtasks cannot be moved beneath a Work OS task/,
  );
});

test("employee-created subtasks hang from a top-level task only", () => {
  assert.throws(() => assertTopLevelTaskParent(localTask()), /created beneath a top-level task/);
  assert.throws(() => assertTopLevelTaskParent(localTask({ parent_provider_task_id: "provider-parent" })), /top-level task/);
  assert.doesNotThrow(() => assertTopLevelTaskParent(localParent()));
});

/** Run a real function body against stubbed dependencies. Mirrors the provider
 * refresh path without a database or provider call. */
function loadFunction(file: string, name: string, end: string, context: Record<string, unknown>) {
  const source = read(file);
  const start = source.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found in ${file}`);
  const body = source.slice(start, source.indexOf(end, start)).replace("export async function", "async function");
  const js = ts.transpileModule(`${body}\nglobalThis.subject = ${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(js, context);
  return (context as { subject: (access: unknown, taskId: string) => Promise<Record<string, any>> }).subject;
}

function detailHarness() {
  const stale = {
    id: "nifty-local",
    provider: "nifty",
    provider_task_id: "provider-task",
    synced_at: "2020-01-01T00:00:00Z",
    assignee_person_ids: ["person"],
    provider_project_id: "provider-project-a",
    title: "My task",
  };
  let mirror: Record<string, any> = stale;
  const query = new Proxy({}, {
    get: (_target, key) => (key === "then" ? (resolve: (value: unknown) => void) => resolve({ data: [], error: null }) : () => query),
  });
  const attributable = (task: Record<string, any>, personId: string | null | undefined) =>
    (task.assignee_person_ids ?? []).includes(personId);
  const context: Record<string, unknown> = {
    employeeTaskContext: async (access: { personId: string }) => {
      if (!attributable(mirror, access.personId)) throw new Error("Task is not available to this employee");
      return { ownerId: "owner", task: mirror, niftyMemberId: "member" };
    },
    getTaskByLocalOrProviderId: async () => mirror,
    db: () => ({ from: () => query }),
    isTaskAttributableToPerson: attributable,
    hydrateTaskAssignees: async (_ownerId: string, rows: unknown[]) => rows,
    isEmployeeAttachedEvidence: () => false,
    taskEvidenceFromRow: () => ({}),
    console,
  };
  const subject = loadFunction(
    "src/lib/work-os-employee-tasks.ts",
    "getWorkOsEmployeeTaskDetails",
    "export async function moveWorkOsEmployeeSubtask",
    context,
  );
  return {
    subject,
    // The record is the authority, so the stored assignee decides access.
    reassignTo: (personId: string) => {
      mirror = {
        ...stale,
        assignee_person_ids: [personId],
        title: personId === "person" ? "Still mine" : "Another employee's task",
      };
    },
  };
}

test("task detail rejects a task assigned to another employee", async () => {
  const harness = detailHarness();
  harness.reassignTo("other-person");
  await assert.rejects(
    () => harness.subject({ organizationId: "org", personId: "person" }, "nifty-local"),
    /Task is not available to this employee/,
  );
});

test("task detail returns a task assigned to this employee", async () => {
  const harness = detailHarness();
  harness.reassignTo("person");
  const details = await harness.subject({ organizationId: "org", personId: "person" }, "nifty-local");
  assert.equal(details.task.assignee_person_ids[0], "person");
});

test("a subtask inherits its parent's project", () => {
  const parent = { id: "parent-a", project_id: "project-a" };
  // Regression: the caller could file a subtask under a different project than
  // its parent while both projects passed the organization check.
  assert.throws(() => assertSubtaskProjectInherited("project-b", parent), /parent's project/);
  assert.throws(() => assertSubtaskProjectInherited("project-b", { id: "parent", project_id: null }), /parent's project/);
  assert.doesNotThrow(() => assertSubtaskProjectInherited(null, parent));
  assert.doesNotThrow(() => assertSubtaskProjectInherited("project-a", parent));
  // Top-level tasks have no parent to inherit from.
  assert.doesNotThrow(() => assertSubtaskProjectInherited("project-a", null));
});

test("a caller-supplied project must belong to the acting organization", () => {
  const source = read("src/lib/work-os-local-tasks.ts");
  assert.match(source, /async function validateLocalTaskProject/);
  assert.match(source, /from\("work_projects"\)\.select\("id"\)/);
  assert.match(source, /\.eq\("organization_id", access\.organizationId\)\s*\n\s*\.eq\("id", id\)/);
  assert.match(source, /Task project must belong to the organization/);
  assert.match(source, /assertSubtaskProjectInherited\(projectId, input\.parent \?\? null\)/);
  assert.match(source, /project_id: projectId \?\? input\.parent\?\.project_id \?\? null/);
});
