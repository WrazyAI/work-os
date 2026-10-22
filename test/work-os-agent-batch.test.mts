import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateAgentBatch } from "../src/lib/work-agent-batch";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("batch validation accepts the five operations and keeps their payloads", () => {
  const items = validateAgentBatch({
    operations: [
      { operation: "create_task", name: "Ship it" },
      { operation: "update_task", task_id: "task-1", name: "Renamed" },
      { operation: "complete_task", task_id: "task-1" },
      { operation: "reopen_task", task_id: "task-1" },
      { operation: "log_progress", task_id: "task-1", summary: "Ran tests" },
    ],
  });
  assert.equal(items.length, 5);
  assert.deepEqual(items[0], { index: 0, operation: "create_task", payload: { name: "Ship it" } });
  assert.deepEqual(items[4], { index: 4, operation: "log_progress", payload: { task_id: "task-1", summary: "Ran tests" } });
});

test("batch validation rejects empty, oversized, and unknown batches", () => {
  assert.throws(() => validateAgentBatch({ operations: [] }), /at least one/i);
  assert.throws(() => validateAgentBatch({ operations: Array.from({ length: 21 }, () => ({ operation: "create_task", name: "x" })) }), /20/);
  assert.throws(() => validateAgentBatch({ operations: [{ operation: "delete_task" }] }), /Unknown batch operation/);
  assert.throws(() => validateAgentBatch({}), /at least one/i);
});

test("the progress route writes an agent-marked evidence row", async () => {
  const progress = await read("src/app/api/agent/v1/tasks/[taskId]/progress/route.ts");
  const service = await read("src/lib/work-agent-tasks.ts");
  assert.match(progress, /requireAgentAccess\(req, "progress:write"\)/);
  assert.match(progress, /withAgentIdempotency/);
  assert.match(service, /source: "agent"/);
  assert.match(service, /origin: "agent_progress"/);
  assert.match(service, /agentTokenId/);
  assert.match(service, /idempotency_key: idempotencyKey/);
  assert.match(service, /agent\.progress\.logged/);
});

test("the batch route is one idempotent request with per-item results", async () => {
  const batch = await read("src/app/api/agent/v1/batch/route.ts");
  assert.match(batch, /withAgentIdempotency/);
  assert.match(batch, /requireAgentAccess\(req\)/, "scope is enforced per operation, not on the whole batch");
  assert.match(batch, /\$\{key\}:\$\{item\.index\}/, "each create and progress item derives its own key");
  assert.match(batch, /"tasks:write"/);
  assert.match(batch, /"progress:write"/);
  assert.match(batch, /applied/);
  assert.match(batch, /failed/);
});
