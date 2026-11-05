import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fixture, adminAccess, otherOrgAccess } from "./helpers/work-os-admin-agent-fixture.mts";
import { startOttoWorkflow, loadOttoWorkflow, prepareOttoWorkflow, abandonOttoWorkflow } from "../src/lib/work-os-admin-otto-workflows";
import { createAdminPreview, confirmAdminPreview } from "../src/lib/work-admin-action-previews";
import type { AdminOttoOperation, AdminOttoPlanStep } from "../src/modules/work-os/admin-otto/contracts";
import type { WorkOsAccess } from "../src/lib/work-os-api";

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => {
  f = await fixture();
  await f.db.exec(await readFile(new URL("../supabase/migrations/0071_work_admin_otto_session_actions.sql", import.meta.url), "utf8"));
  await f.db.exec(await readFile(new URL("../supabase/migrations/0072_work_admin_otto_workflows.sql", import.meta.url), "utf8"));
});
after(async () => { await f.close(); });
const create = (name: string): AdminOttoPlanStep => ({ intent: null, depends_on: null,
  operation: { action: "create_task", title: name, task_query: null, person_names: [], due_date: null } });
const deps = {
  read: async () => { throw new Error("unexpected read"); },
  replayRead: async () => { throw new Error("unexpected replay"); },
  operation: async (access: WorkOsAccess, op: AdminOttoOperation, key: string, taskId?: string) => {
    const action = op.action === "create_task" ? "task.create" : "task.assign";
    const preview = await createAdminPreview({ organizationId: access.organizationId, userId: access.ctx.user.id,
      source: "otto", tokenId: null, action, targetType: "task", targetId: taskId ?? null,
      request: { title: op.title, task_id: taskId ?? null }, state: {}, idempotencyKey: key,
      preview: { action, summary: op.title ?? "Assignment", changes: [], warnings: [], state: {}, expiresAt: "" },
    });
    return { reply: preview.summary, pendingAction: { previewId: preview.id, action, summary: preview.summary, changes: [], warnings: [], expiresAt: preview.expiresAt } };
  },
};

test("two creates are prepared once and replay keeps their stable step identities", async () => {
  const requestId = randomUUID();
  let preparations = 0;
  const runDeps = { ...deps, operation: async (...args: Parameters<typeof deps.operation>) => {
    preparations++; return deps.operation(...args);
  } };
  const first = await startOttoWorkflow(adminAccess, requestId, "create two tasks", [create("One"), create("Two")], runDeps);
  const again = await startOttoWorkflow(adminAccess, requestId, "create two tasks", [create("One"), create("Two")], runDeps);
  assert.equal(preparations, 2);
  assert.equal(first.id, again.id);
  assert.equal(first.steps.length, 2);
  assert.deepEqual(first.steps.map(s => s.pendingAction?.status), ["pending", "pending"]);
  assert.deepEqual(first.steps.map(s => s.pendingAction?.previewId), again.steps.map(s => s.pendingAction?.previewId));
});

test("a recorded prerequisite unlocks a new preview pinned to its actual task ID", async () => {
  const steps = [create("One"), { intent: null, depends_on: 0, operation: {
    action: "add_contributor", title: null, task_query: "task from step 1", person_names: ["Aden"], due_date: null,
  } }] as AdminOttoPlanStep[];
  const run = await startOttoWorkflow(adminAccess, randomUUID(), "create then assign", steps, deps);
  const previewId = run.steps[0].pendingAction!.previewId;
  const taskId = randomUUID();
  await confirmAdminPreview(adminAccess, previewId, "confirm", {
    readState: async () => ({}), apply: async () => ({ status: 201, body: { task: { id: taskId } } }),
  });
  const ready = await prepareOttoWorkflow(adminAccess, run.id, deps);
  assert.equal(ready.steps[0].status, "recorded");
  assert.equal(ready.steps[1].pendingAction?.status, "pending", "dependent preview still requires confirmation");
  const stored = await f.db.query<{ request: { task_id: string } }>("select request from work_admin_action_previews where id=$1", [ready.steps[1].pendingAction!.previewId]);
  assert.equal(stored.rows[0].request.task_id, taskId);
});

test("an independent preparation failure does not discard the other requested change", async () => {
  const run = await startOttoWorkflow(adminAccess, randomUUID(), "create both", [create("Bad"), create("Good")], {
    ...deps, operation: async (...args) => {
      if (args[1].title === "Bad") throw new Error("internal database detail that must not leak");
      return deps.operation(...args);
    },
  });
  assert.equal(run.steps[0].status, "failed");
  assert.doesNotMatch(run.steps[0].message ?? "", /database detail/);
  assert.equal(run.steps[1].pendingAction?.status, "pending");
});

test("dependent writes are blocked before the prerequisite is recorded", async () => {
  const steps = [create("One"), { ...create(""), depends_on: 0, operation: {
    action: "add_contributor", title: null, task_query: "task from step 1", person_names: ["Aden"], due_date: null,
  } }] as AdminOttoPlanStep[];
  const run = await startOttoWorkflow(adminAccess, randomUUID(), "create then assign", steps, deps);
  assert.equal(run.steps[1].status, "blocked");
  assert.equal(run.steps[1].pendingAction, undefined);
});

test("foreign organizations cannot load a workflow and abandoned workflows cannot resume", async () => {
  const run = await startOttoWorkflow(adminAccess, randomUUID(), "create", [create("One")], deps);
  await assert.rejects(loadOttoWorkflow(otherOrgAccess, run.id, deps), /available|found/i);
  await abandonOttoWorkflow(adminAccess, run.id);
  await assert.rejects(loadOttoWorkflow(adminAccess, run.id, deps), /available|discard/i);
});
