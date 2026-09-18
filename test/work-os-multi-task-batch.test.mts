import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { INTERPRET_RESPONSE_SCHEMA, parseInterpretation } from "../src/lib/aiInterpret";
import { interpretedOperations, prepareProposals, proposalDecisionEdits } from "../src/lib/work-os-proposals";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const TASKS = [
  { id: "t-1", title: "Ship the debugger fix", completed: false, taskGroupId: "col-done" },
  { id: "t-2", title: "Package the Windows build", completed: false, taskGroupId: "col-done" },
  { id: "t-3", title: "Write the release notes", completed: false, taskGroupId: "col-done" },
];

const batch = (tasks: unknown[], op = "multi_task_add") => ({ op, statement: "Add the launch checklist.", tasks });

test("parses a multi_task_add with nested steps", () => {
  const parsed = parseInterpretation({
    operations: [batch([
      { clientId: "t1", title: "Draft the launch plan", description: "Cover scope and owners.", subtasks: [{ clientId: "s1", title: "Collect inputs" }, { clientId: "s2", title: "Circulate for review", description: "Two days ahead." }] },
      { clientId: "t2", title: "Book the launch review" },
    ])],
  }, "add the launch checklist", TASKS);
  const operation = parsed?.operations[0];
  assert.equal(operation?.op, "multi_task_add");
  assert.equal(operation?.tasks?.length, 2);
  assert.deepEqual(operation?.tasks?.[0]?.subtasks?.map((subtask) => subtask.title), ["Collect inputs", "Circulate for review"]);
  assert.equal(operation?.tasks?.[1]?.subtasks, undefined);
});

test("keeps multi_task_add entries that attach steps to an existing task", () => {
  const parsed = parseInterpretation({
    operations: [batch([{ clientId: "t1", taskId: "t-1", subtasks: [{ title: "Verify the fixture" }] }])],
  }, "steps for the debugger fix", TASKS);
  assert.equal(parsed?.operations[0]?.tasks?.[0]?.taskId, "t-1");
  assert.equal(parsed?.operations[0]?.tasks?.[0]?.title, undefined);
});

test("drops batch entries that reference unknown tasks and batches with no usable entry", () => {
  const parsed = parseInterpretation({
    operations: [
      batch([{ clientId: "t1", taskId: "someone-elses-task", title: "Reword this" }], "multi_task_edit"),
      batch([{ clientId: "t1", title: "A real task" }]),
      batch([{ clientId: "t1", taskId: "t-2" }], "multi_task_edit"),
    ],
  }, "update", TASKS);
  // The foreign id is dropped, so the edit batch has nothing actionable and the
  // whole operation disappears; only the add batch survives.
  assert.equal(parsed?.operations.length, 1);
  assert.equal(parsed?.operations[0]?.op, "multi_task_add");
});

test("requires an edit to change something", () => {
  const parsed = parseInterpretation({
    operations: [batch([
      { clientId: "t1", taskId: "t-1", completed: true },
      { clientId: "t2", taskId: "t-2", title: "Package the Windows installer" },
      { clientId: "t3", taskId: "t-3", taskGroupId: "col-done" },
    ], "multi_task_edit")],
  }, "several edits", TASKS);
  const tasks = parsed?.operations[0]?.tasks ?? [];
  assert.equal(tasks.length, 3);
  assert.equal(tasks[0]?.completed, true);
  assert.equal(tasks[1]?.title, "Package the Windows installer");
  assert.equal(tasks[2]?.taskGroupId, "col-done");
});

test("rejects a status move to a column the employee never supplied", () => {
  const parsed = parseInterpretation({
    operations: [batch([{ clientId: "t1", taskId: "t-1", title: "x", taskGroupId: "col-invented" }], "multi_task_edit")],
  }, "update", TASKS);
  assert.equal(parsed?.operations[0]?.tasks?.[0]?.taskGroupId, undefined);
  assert.equal(parsed?.operations[0]?.tasks?.[0]?.title, "x");
});

test("caps a batch entry's description and title", () => {
  const parsed = parseInterpretation({
    operations: [batch([{ clientId: "t1", title: "T".repeat(400), description: "D".repeat(3000) }])],
  }, "add", TASKS);
  const task = parsed?.operations[0]?.tasks?.[0];
  assert.equal(task?.title?.length, 240);
  assert.equal(task?.description?.length, 2000);
});

test("the proposals endpoint validates a batch payload and rejects an empty one", () => {
  const [operation] = interpretedOperations([{
    op: "multi_task_add",
    statement: "Add the launch checklist.",
    tasks: [{ client_id: "t1", title: "Draft the launch plan", subtasks: [{ title: "Collect inputs" }] }],
  }]);
  assert.equal(operation?.op, "multi_task_add");
  assert.equal(operation?.tasks?.[0]?.subtasks?.[0]?.title, "Collect inputs");
  assert.throws(() => interpretedOperations([{ op: "multi_task_add", statement: "Empty.", tasks: [] }]), /carries no tasks/);
  assert.throws(() => interpretedOperations([{ op: "multi_task_edit", statement: "No table.", tasks: null }]), /carries no tasks/);
  assert.throws(() => interpretedOperations([{ op: "multi_task_bogus", statement: "Unknown.", tasks: [] }]), /is invalid/);
  assert.throws(() => interpretedOperations([{ op: "multi_task_edit", statement: "Nothing to change.", tasks: [{ task_id: "t-1", completed: null }] }]), /carries no tasks/);
});

test("expands an add batch into ordered proposals that share one batch id", () => {
  const prepared = prepareProposals(interpretedOperations([{
    op: "multi_task_add",
    statement: "Add the launch checklist.",
    tasks: [
      { client_id: "t1", title: "Draft the launch plan", subtasks: [{ client_id: "s1", title: "Collect inputs" }] },
      { client_id: "t2", task_id: "t-1", subtasks: [{ client_id: "s2", title: "Verify the fixture" }] },
    ],
  }]) as Parameters<typeof prepareProposals>[0]);

  assert.deepEqual(prepared.map((item) => item.providerOperation), ["create_task", "add_subtask", "add_subtask"]);
  assert.deepEqual(prepared.map((item) => item.batch?.index), [0, 1, 2]);
  assert.equal(prepared[0]?.batch?.clientId, "t1");
  assert.equal(prepared[0]?.batch?.parentClientId, undefined);
  assert.equal(prepared[1]?.batch?.parentClientId, "t1");
  assert.equal(prepared[1]?.taskId, undefined, "a step of a task created in this batch has no id yet");
  assert.equal(prepared[2]?.batch?.parentClientId, "t2");
  assert.equal(prepared[2]?.taskId, "t-1", "a step of an existing task keeps its parent");
  const batchIds = new Set(prepared.map((item) => item.batch?.id));
  assert.equal(batchIds.size, 1);
  assert.equal(prepared[0]?.clientOperationIndex, 0);
  const change = prepared[0]?.change as { name?: string; task_group_id?: string };
  assert.equal(change.name, "Draft the launch plan");
  assert.ok(change.task_group_id, "a created task carries the default status column");
});

test("expands an edit batch into a wording item plus a completion item", () => {
  const prepared = prepareProposals(interpretedOperations([{
    op: "multi_task_edit",
    statement: "Move two tasks on.",
    tasks: [
      { client_id: "t1", task_id: "t-1", title: "Ship the debugger fix (final)", task_group_id: "col-done" },
      { client_id: "t2", task_id: "t-2", completed: true },
      { client_id: "t3", task_id: "t-3", completed: false },
    ],
  }]) as Parameters<typeof prepareProposals>[0]);

  assert.deepEqual(prepared.map((item) => item.providerOperation), ["update_task", "complete_task", "reopen_task"]);
  assert.deepEqual(prepared[0]?.change, { name: "Ship the debugger fix (final)", task_group_id: "col-done" });
  assert.equal(prepared[0]?.taskGroupId, "col-done");
  assert.equal(prepared[1]?.batch?.clientId, "t2");
  assert.deepEqual(prepared[1]?.change, {});
});

test("keeps single operations byte-for-byte in their old shape", () => {
  const prepared = prepareProposals(interpretedOperations([
    { op: "create_task", statement: "Package the signed installer.", task_title: "Package the signed installer" },
    { op: "add_subtask", statement: "Verify the signature.", task_id: "t-1", task_title: "Verify the signature" },
    { op: "modify_task_status", statement: "Move it to done.", task_id: "t-1", task_group_id: "col-done" },
    { op: "complete_task", statement: "Mark it complete.", task_id: "t-2" },
  ]) as Parameters<typeof prepareProposals>[0]);

  assert.deepEqual(prepared.map((item) => item.providerOperation), ["create_task", "add_subtask", "update_task", "complete_task"]);
  assert.equal(prepared[0]?.batch, null);
  assert.equal((prepared[0]?.change as { description?: string }).description, "Package the signed installer.");
  assert.deepEqual(prepared[2]?.change, { task_group_id: "col-done" });
  assert.deepEqual(prepared[3]?.change, {});
  assert.deepEqual(prepared.map((item) => item.clientOperationIndex), [0, 1, 2, 3]);
});

test("narrows employee edits to the fields the operation owns", () => {
  assert.deepEqual(proposalDecisionEdits("create_task", { name: "  Reworded  ", description: "", injected: "nope" }), { name: "Reworded", description: null });
  assert.deepEqual(proposalDecisionEdits("add_subtask", { name: "Step two" }), { name: "Step two" });
  assert.deepEqual(proposalDecisionEdits("update_task", { name: "New name", task_group_id: "col-done" }), { name: "New name", task_group_id: "col-done" });
  assert.equal(proposalDecisionEdits("complete_task", { name: "Not editable" }), null);
  assert.equal(proposalDecisionEdits("create_task", {}), null);
  assert.equal(proposalDecisionEdits("create_task", null), null);
  const capped = proposalDecisionEdits("create_task", { name: "N".repeat(400) }) as { name: string };
  assert.equal(capped.name.length, 240);
});

test("the strict schema carries the batch payload but keeps every field required", () => {
  const schema = INTERPRET_RESPONSE_SCHEMA.schema as unknown as { properties: { operations: { items: { properties: Record<string, unknown>; required: readonly string[] } } } };
  const items = schema.properties.operations.items;
  assert.ok(Object.hasOwn(items.properties, "tasks"), "the operations schema must declare tasks");
  assert.ok(items.required.includes("tasks"), "strict json_schema requires every declared property");
  const batchItem = (items.properties.tasks as { items: { properties: Record<string, unknown>; required: readonly string[] } }).items;
  for (const key of Object.keys(batchItem.properties)) {
    assert.ok(batchItem.required.includes(key), `batch task ${key} must be required`);
  }
});

test("the interpretation prompt teaches both batch tools", () => {
  const source = read("src/lib/aiInterpret.ts");
  assert.match(source, /multi_task_add/);
  assert.match(source, /multi_task_edit/);
  assert.match(source, /Prefer multi_task_add or multi_task_edit over repeating single/);
});

test("batches stay a grouping over existing proposal operations", () => {
  const proposals = read("src/lib/work-os-proposals.ts");
  const migration = read("supabase/migrations/0049_work_task_proposal_batches.sql");
  // Children reuse the existing operations, so no new provider write path is
  // introduced and the outbox/lease machinery keeps covering every item.
  assert.match(proposals, /providerOperation: "create_task"/);
  assert.match(proposals, /providerOperation: "add_subtask"/);
  assert.doesNotMatch(proposals, /operation: "multi_task_add"/);
  assert.match(migration, /add column if not exists batch_id uuid/);
  assert.match(migration, /add column if not exists parent_client_id text/);
  assert.match(migration, /add column if not exists decided_change jsonb/);
});

test("the batch review owns ordering, parent resolution, and per-item outcomes", () => {
  const batches = read("src/lib/work-os-proposal-batches.ts");
  assert.match(batches, /export async function reviewWorkOsProposalBatch/);
  assert.match(batches, /export async function getWorkOsProposalBatch/);
  assert.match(batches, /parent_client_id/);
  assert.match(batches, /reviewWorkOsProposal\(/);
  assert.match(batches, /result\("skipped"/);
  assert.match(batches, /results,/);
  assert.ok(existsSync(resolve(root, "src/app/api/work-os/proposal-batches/[batchId]/route.ts")));
  const route = read("src/app/api/work-os/proposal-batches/[batchId]/route.ts");
  assert.match(route, /requireWorkOsAccess/);
  assert.match(route, /requirePerson: true/);
  assert.match(route, /idempotency-key/);
});

test("employee edits are validated per operation and never overwrite the agent's proposal", () => {
  const proposals = read("src/lib/work-os-proposals.ts");
  assert.match(proposals, /proposalDecisionEdits/);
  assert.match(proposals, /decided_change: decisionEdits/);
  assert.match(proposals, /already approved with different edits/);
  assert.match(proposals, /requireInInput: false/);
});

test("both chat surfaces render the batch card and keep the shared card for the rest", () => {
  for (const path of ["desktop/work-os-companion/src/App.tsx", "desktop/work-os-companion/src/AvatarApp.tsx", "desktop/work-os-companion/src/chat/HistoryTurn.tsx"]) {
    const source = read(path);
    assert.match(source, /BatchApprovalCards/, `${path} must render the batch cards`);
    assert.match(source, /isBatchToolOp/, `${path} must split batches out of the shared approval card`);
  }
  const card = read("desktop/work-os-companion/src/TaskBatchCard.tsx");
  assert.match(card, /Approve all /);
  assert.match(card, /Confirm /);
  assert.match(card, /Review new tasks|Review changes/);
  assert.match(card, /Technical details/);
  // The shared card's pinned contract stays intact: no second-confirmation
  // wording may leak into it, and the batch card is the only two-step surface.
  assert.doesNotMatch(card, /approval-summary|Final review|Approve & record/);
});

test("the client files a batch through its own endpoint", () => {
  const interpretation = read("desktop/work-os-companion/src/interpretation.ts");
  assert.match(interpretation, /reviewBatch\?/);
  assert.match(interpretation, /review_batch/);
  assert.match(interpretation, /api\/work-os\/proposal-batches/);
  assert.match(interpretation, /export function attachFiledProposals/);
  assert.match(interpretation, /export async function skipBatchOperation/);
  assert.match(interpretation, /export function batchItemCount/);
});
