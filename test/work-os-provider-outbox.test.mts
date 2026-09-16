// A retried create_task proposal must never issue a second Nifty POST. These
// source-level contract checks pin the outbox shape: the provider id is
// recorded on the applying proposal before any mirror work, retries adopt the
// recorded task, and the stalled-lease recovery cannot flip a freshly claimed
// attempt.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const proposals = read("src/lib/work-os-proposals.ts");
const tasks = read("src/lib/work-os-tasks.ts");
const migration = read("supabase/migrations/0044_work_task_provider_outbox.sql");

test("migration anchors the provider task id on the proposal", () => {
  assert.match(migration, /alter table work_task_proposals add column if not exists provider_task_id text/);
  assert.match(migration, /create index if not exists work_task_proposals_provider_task_idx/);
});

test("create_task adopts a recorded provider id before any provider work", () => {
  const branchAt = proposals.indexOf('if (operation === "create_task")');
  assert.ok(branchAt > 0);
  const branch = proposals.slice(branchAt, proposals.indexOf("if (!taskId)"));
  const adoptAt = branch.indexOf("adoptProviderTask(ownerId, recordedProviderId, body)");
  const mirrorAt = branch.indexOf('.from("work_tasks")');
  const listAt = branch.indexOf("findNiftyTaskByMarker(ownerId");
  const createAt = branch.indexOf("createTask(ownerId, body, {");
  assert.ok(adoptAt > 0, "recorded id is adopted");
  assert.ok(mirrorAt > adoptAt, "mirror reconcile runs only after the id path misses");
  assert.ok(listAt > mirrorAt, "orphan search runs last before create");
  assert.ok(createAt > listAt, "create is the fallback");
});

test("orphan search is skipped on a first attempt and the hook records the id", () => {
  assert.match(proposals, /opts\.firstAttempt \? null : await findNiftyTaskByMarker/);
  assert.match(proposals, /const firstAttempt = proposal\.status === "pending";/);
  assert.match(proposals, /onProviderTaskCreated: async \(providerTaskId\) => \{[\s\S]*?rememberProviderTaskId\(proposal\.id as string, providerTaskId, applyAttempt\)/);
  assert.match(proposals, /The proposal lease moved to another attempt before the created task could be recorded\./);
});

test("the outbox write is fenced on the live attempt", () => {
  const helperAt = proposals.indexOf("async function rememberProviderTaskId");
  assert.ok(helperAt > 0);
  const helper = proposals.slice(helperAt, proposals.indexOf("async function applyProposal"));
  assert.match(helper, /\.eq\("status", "applying"\)\.eq\("apply_attempt", applyAttempt\)/);
});

test("createTask records the provider id before assign/mirror work", () => {
  const postAt = tasks.indexOf("createNiftyTask(payload)");
  const hookAt = tasks.indexOf("hooks?.onProviderTaskCreated");
  const finalizeAt = tasks.indexOf("finalizeCreatedNiftyTask(userId, initial, body)");
  assert.ok(postAt > 0 && hookAt > postAt, "hook follows the POST");
  assert.ok(finalizeAt > hookAt, "hook runs before the shared tail");
  assert.doesNotMatch(tasks.slice(postAt, finalizeAt), /assignNiftyTask|upsertNiftyTask|mirrorExtendedTaskFields/);
  const tailAt = tasks.indexOf("async function finalizeCreatedNiftyTask");
  const tail = tasks.slice(tailAt, tasks.indexOf("export async function createTask"));
  assert.match(tail, /assignNiftyTask\(initial\.id, requestedAssignees\)/);
  assert.match(tail, /mirrorExtendedTaskFields/);
});

test("stalled-lease recovery is fenced to the attempt it read", () => {
  const recoveryAt = proposals.indexOf("Previous provider application did not finalize");
  const recovery = proposals.slice(recoveryAt - 800, recoveryAt + 700);
  assert.match(recovery, /\.eq\("id", proposalId\)\.eq\("status", "applying"\)/);
  assert.match(recovery, /if \(proposal\.apply_attempt\) recovery = recovery\.eq\("apply_attempt", proposal\.apply_attempt as string\)/);
  assert.match(recovery, /apply_attempt: null/);
});

test("adoption and orphan lookup are shared task-side helpers", () => {
  assert.match(tasks, /export async function adoptProviderTask\(userId: string, providerTaskId: string, body: Json\)/);
  assert.match(tasks, /export async function findNiftyTaskByMarker\(/);
  assert.match(tasks, /include_subtasks: "true"/, "orphan search pages like the sync does");
});
