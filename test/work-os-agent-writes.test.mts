import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateAgentTaskCreate } from "../src/lib/work-agent-tasks";
import { validateAgentTaskUpdate } from "../src/lib/work-os-employee-tasks";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("agent create accepts content fields and rejects structural or assignment fields", () => {
  assert.deepEqual(
    validateAgentTaskCreate({ name: "Ship the release", due_date: "2026-10-30", expected_outcome: "Published" }),
    { name: "Ship the release", due_date: "2026-10-30", expected_outcome: "Published" },
  );
  assert.throws(() => validateAgentTaskCreate({ name: "x", assignee_person_ids: ["p2"] }), /assignee_person_ids/);
  assert.throws(() => validateAgentTaskCreate({ name: "x", task_group_id: "group" }), /task_group_id/);
});

test("agent update rejects project and parent moves and requires a field", () => {
  assert.deepEqual(
    validateAgentTaskUpdate({ name: "Renamed", blocked: true, blocked_reason: "Waiting on review" }),
    { name: "Renamed", blocked: true, blocked_reason: "Waiting on review" },
  );
  assert.throws(() => validateAgentTaskUpdate({ project_id: "project" }), /project_id/);
  assert.throws(() => validateAgentTaskUpdate({ parent_task_id: "parent" }), /parent_task_id/);
  assert.throws(() => validateAgentTaskUpdate({ assignee_person_ids: ["p"] }), /assignee_person_ids/);
  assert.throws(() => validateAgentTaskUpdate({}), /field/i);
});

test("agent writes carry token provenance and idempotency markers", async () => {
  const local = await read("src/lib/work-os-local-tasks.ts");
  const employee = await read("src/lib/work-os-employee-tasks.ts");
  const day = await read("src/lib/work-os-daily-workspace.ts");
  const createRoute = await read("src/app/api/agent/v1/tasks/route.ts");
  const updateRoute = await read("src/app/api/agent/v1/tasks/[taskId]/route.ts");
  assert.match(local, /agent_token_id/);
  assert.match(local, /agent_idempotency_key/);
  assert.match(day, /"agent"/);
  assert.match(employee, /agent\.task\.created/);
  assert.match(employee, /agent\.task\.updated/);
  assert.match(employee, /agent_token_id/);
  assert.match(createRoute, /withAgentIdempotency/);
  assert.match(createRoute, /"tasks:write"/);
  assert.match(updateRoute, /withAgentIdempotency/);
  assert.match(updateRoute, /"tasks:write"/);
});
