// A retried create_task proposal must never issue a second Nifty POST. These
// source-level contract checks pin the outbox shape: the provider id is
// recorded on the applying proposal before any mirror work, retries adopt the
// recorded task, and the stalled-lease recovery cannot flip a freshly claimed
// attempt.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NiftyHttpError } from "../src/lib/integrations/nifty";
import { providerCreateFailureDefinite } from "../src/lib/work-os-tasks";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const proposals = read("src/lib/work-os-proposals.ts");
const tasks = read("src/lib/work-os-tasks.ts");
const migration = read("supabase/migrations/0044_work_task_provider_outbox.sql");
const intentMigration = read("supabase/migrations/0047_work_task_provider_create_intent.sql");

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
  assert.match(proposals, /opts\.firstAttempt[\s\S]{0,60}?findNiftyTaskByMarker/);
  assert.match(proposals, /const firstAttempt = proposal\.status === "pending";/);
  assert.match(proposals, /onProviderTaskCreated: async \(providerTaskId\) => \{[\s\S]*?rememberProviderTaskId\(proposal\.id as string, providerTaskId, applyAttempt\)/);
  assert.match(proposals, /The proposal lease moved to another attempt before the created task could be recorded\./);
});

test("migration records a pre-POST create intent", () => {
  assert.match(intentMigration, /add column if not exists provider_create_issued_at timestamptz/);
});

test("the create intent is recorded after credentials and before the POST", () => {
  const thunkAt = tasks.indexOf("niftyForOwner(userId, async () => {");
  const tokenAt = tasks.indexOf("ensureNiftyAccessToken()");
  const intentAt = tasks.indexOf("hooks?.beforeProviderCreate?.()");
  const postAt = tasks.indexOf("createNiftyTask(payload)");
  assert.ok(thunkAt > 0 && tokenAt > thunkAt, "credentials resolve inside the owner scope");
  assert.ok(intentAt > tokenAt, "the intent write follows the credential proof");
  assert.ok(postAt > intentAt, "the POST is dispatched only after the intent is durable");
  const helperAt = proposals.indexOf("async function rememberProviderCreateIssued");
  assert.ok(helperAt > 0);
  const helper = proposals.slice(helperAt, proposals.indexOf("async function clearProviderCreateIssued"));
  assert.match(helper, /\.eq\("status", "applying"\)\.eq\("apply_attempt", applyAttempt\)/, "intent write is fenced");
});

test("an unresolved intent refuses to POST again and searches with retries", () => {
  const branchAt = proposals.indexOf('if (operation === "create_task")');
  const branch = proposals.slice(branchAt, proposals.indexOf("if (!taskId)"));
  const issuedAt = branch.indexOf("const createIssued = hasTimestamp((proposal as Json).provider_create_issued_at);");
  const retriesAt = branch.indexOf("retries: 3, retryDelayMs: 1_500");
  const refuseAt = branch.indexOf("if (createIssued && !opts.confirmedNoTaskCreated) {");
  const confirmAt = branch.indexOf("if (createIssued) {");
  const createAt = branch.indexOf("createTask(ownerId, body, {");
  assert.ok(issuedAt > 0, "prior intent is read");
  assert.ok(retriesAt > issuedAt, "uncertain attempts retry the provider listing");
  assert.ok(refuseAt > retriesAt, "the refusal is the last check before create");
  assert.ok(confirmAt > refuseAt, "the confirmed-clear path stays separate from the refusal");
  assert.ok(createAt > confirmAt, "create stays the final fallback");
  assert.match(branch.slice(refuseAt, confirmAt), /may have created this task in Nifty but it is not listed yet/);
});

test("only a definite 4xx clears the intent", () => {
  assert.match(proposals, /if \(providerCreateFailureDefinite\(error\)\) \{[\s\S]{0,240}?clearProviderCreateIssued/);
  const helperAt = proposals.indexOf("async function clearProviderCreateIssued");
  assert.ok(helperAt > 0);
  assert.match(proposals.slice(helperAt, helperAt + 400), /provider_create_issued_at: null/);
  assert.match(proposals, /may have created/i, "uncertain failures land in needs_review");
  assert.match(proposals, /clearing the recorded create intent also failed/, "a clear failure never hides the provider reason");
  assert.match(proposals, /function hasTimestamp\(value: unknown\)[\s\S]{0,140}?value instanceof Date/, "timestamps are read as Date objects, not strings");
});

test("a confirmed clear-and-retry resolves the intent before the POST", () => {
  assert.match(proposals, /provider_create_resolution must be no_task_created/);
  assert.match(proposals, /const confirmedNoTaskCreated = resolution === "no_task_created"/);
  assert.match(proposals, /if \(confirmedNoTaskCreated && !proposalCreateIntentUnresolved/, "the action requires a real unresolved intent");
  assert.match(proposals, /opts\.confirmedNoTaskCreated/, "the decision reaches applyProposal");
  const branchAt = proposals.indexOf('if (operation === "create_task")');
  const branch = proposals.slice(branchAt, proposals.indexOf("if (!taskId)"));
  const clearAt = branch.indexOf('// The employee confirmed Nifty holds no such task.');
  const createAt = branch.indexOf("createTask(ownerId, body, {");
  assert.ok(clearAt > 0, "the confirmed path clears the recorded attempt");
  assert.match(branch.slice(clearAt, createAt), /proposal\.create_intent_cleared/, "the clear is audited");
  assert.match(proposals, /create_intent_unresolved: true/, "the server returns the machine-readable flag");
});

test("an unresolved intent returns the review row instead of dead-ending", () => {
  assert.match(proposals, /export function proposalCreateIntentUnresolved\(row: Json\)/);
  assert.match(proposals, /if \(unresolved && failedRow\) return withOutcome/, "the companion can offer recovery");
  assert.match(proposals, /createIntentUnresolved: unresolved/, "the audit records the uncertainty");
});

test("create failures classify by HTTP status", () => {
  const http = (status: number) => new NiftyHttpError(status, "/api/v1.0/tasks", "body");
  assert.equal(providerCreateFailureDefinite(http(422)), true);
  assert.equal(providerCreateFailureDefinite(http(404)), true);
  assert.equal(providerCreateFailureDefinite(http(500)), false);
  assert.equal(providerCreateFailureDefinite(http(408)), false, "a server timeout cannot prove nothing was created");
  assert.equal(providerCreateFailureDefinite(new Error("Nifty /api/v1.0/tasks -> HTTP 422 bad request")), false, "message text is never classified");
  assert.equal(providerCreateFailureDefinite(new Error("The operation was aborted due to timeout")), false);
  assert.equal(providerCreateFailureDefinite(new TypeError("fetch failed")), false);
  assert.equal(providerCreateFailureDefinite("plain failure"), false);
  assert.equal(providerCreateFailureDefinite(null), false);
});

test("an unparseable create response never finalizes without the id", () => {
  const guardAt = tasks.indexOf("Nifty accepted the create but did not return the task");
  const syncAt = tasks.indexOf("await syncNifty(userId);\n  return { providerResult: result };");
  assert.ok(guardAt > 0, "outbox mode throws instead of returning a provider result");
  assert.ok(syncAt > guardAt, "the legacy fallback stays for non-outbox callers");
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
  assert.match(recovery, /recovery\.eq\("apply_attempt", proposal\.apply_attempt as string\)/);
  assert.match(recovery, /recovery\.is\("apply_attempt", null\)/, "null attempts are fenced explicitly");
  assert.match(recovery, /apply_attempt: null/);
});

test("adoption and orphan lookup are shared task-side helpers", () => {
  assert.match(tasks, /export async function adoptProviderTask\(userId: string, providerTaskId: string, body: Json\)/);
  assert.match(tasks, /export async function findNiftyTaskByMarker\(/);
  assert.match(tasks, /include_subtasks: "true"/, "orphan search pages like the sync does");
});
