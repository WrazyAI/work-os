import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mergeAgentActivity } from "../src/lib/work-agent-activity";
import { agentLimitParam } from "../src/lib/work-agent-params";
import { decodeAgentTaskCursor, encodeAgentTaskCursor } from "../src/lib/work-agent-tasks";

test("task cursors reject malformed values rather than restarting pagination", () => {
  assert.equal(decodeAgentTaskCursor(null), null);
  const valid = { order: "asc" as const, updatedAt: "2026-10-26T12:00:00.000Z", id: "b094c847-1332-4cab-9588-bdd7f8e99e7d" };
  assert.deepEqual(decodeAgentTaskCursor(encodeAgentTaskCursor(valid)), valid);
  const postgresTimestamp = { ...valid, updatedAt: "2026-10-26T12:00:00.123456+00:00" };
  assert.deepEqual(decodeAgentTaskCursor(encodeAgentTaskCursor(postgresTimestamp)), postgresTimestamp);
  for (const cursor of ["not-a-cursor", "", Buffer.from(JSON.stringify({ ...valid, id: "bad" })).toString("base64url"), Buffer.from(JSON.stringify({ ...valid, updatedAt: "invalid" })).toString("base64url"), encodeAgentTaskCursor({ ...valid, updatedAt: "2026-02-30T12:00:00.000Z" })]) {
    assert.throws(() => decodeAgentTaskCursor(cursor), /cursor/i);
  }
});

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const fixtures = {
  events: [
    {
      id: "e1",
      event_type: "completed",
      provenance: "agent",
      exact_at: "2026-10-22T10:00:00Z",
      observed_at: "2026-10-22T10:00:00Z",
      task_snapshot: { title: "Ship the release" },
      metadata: { agentTokenId: "token-1" },
    },
    {
      id: "e2",
      event_type: "reopened",
      provenance: "employee_explicit",
      exact_at: "2026-10-22T08:00:00Z",
      observed_at: "2026-10-22T08:00:00Z",
      task_snapshot: { title: "Ship the release" },
      metadata: {},
    },
  ],
  evidence: [
    {
      id: "v1",
      title: "Progress: Ship the release",
      summary: "Ran the smoke suite",
      source: "agent",
      metrics: { origin: "agent_progress", agentTokenId: "token-1" },
      created_at: "2026-10-22T11:00:00Z",
    },
  ],
  blockers: [
    {
      id: "b1",
      description: "Waiting on review",
      status: "active",
      created_at: "2026-10-22T09:00:00Z",
      resolved_at: null,
      agent_token_id: "token-1",
    },
  ],
};

test("activity merges newest first and marks agent actors", () => {
  const { items, nextCursor } = mergeAgentActivity(fixtures, null, 50);
  assert.equal(nextCursor, null);
  assert.deepEqual(items.map((item) => item.kind), ["evidence.progress", "task.completed", "blocker.opened", "task.reopened"]);
  assert.deepEqual(items.map((item) => item.actor), ["agent", "agent", "agent", "employee"]);
  assert.equal(items[0]?.summary, "Progress: Ship the release");
  assert.equal(items[1]?.summary, "Ship the release");
});

test("activity pages with an opaque cursor and never repeats an item", () => {
  const first = mergeAgentActivity(fixtures, null, 2);
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = mergeAgentActivity(fixtures, first.nextCursor, 2);
  assert.equal(second.items.length, 2);
  assert.equal(second.nextCursor, null);
  const firstIds = new Set(first.items.map((item) => item.id));
  assert.ok(second.items.every((item) => !firstIds.has(item.id)));
});

test("agent read routes enforce scopes and the change-feed RPC", async () => {
  const me = await read("src/app/api/agent/v1/me/route.ts");
  const tasks = await read("src/app/api/agent/v1/tasks/route.ts");
  const detail = await read("src/app/api/agent/v1/tasks/[taskId]/route.ts");
  const activity = await read("src/app/api/agent/v1/tasks/[taskId]/activity/route.ts");
  const service = await read("src/lib/work-agent-tasks.ts");
  const activityService = await read("src/lib/work-agent-activity.ts");
  assert.match(me, /requireAgentAccess\(req\)/, "identity needs any valid token, no scope");
  assert.doesNotMatch(me, /requireAgentAccess\(req,\s*"/);
  for (const source of [tasks, detail, activity]) assert.match(source, /requireAgentAccess\(req, "tasks:read"\)/);
  for (const source of [me, tasks, detail, activity]) assert.match(source, /assertAgentRateLimit\(/);
  assert.match(service, /work_agent_list_tasks/);
  assert.match(service, /p_limit: limit \+ 1/);
  assert.match(service, /includeArchived|include_archived/);
  assert.match(activityService, /lte\("observed_at", decoded\.at\)/, "day events bound the page before the limit");
  assert.match(activityService, /lte\("created_at", decoded\.at\)/, "evidence and blockers bound the page before the limit");
});

test("an absent or invalid limit falls back, and bounds clamp", () => {
  assert.equal(agentLimitParam(null, 50, 100), 50);
  assert.equal(agentLimitParam("", 50, 100), 50);
  assert.equal(agentLimitParam("abc", 50, 100), 50);
  assert.equal(agentLimitParam("0", 50, 100), 1);
  assert.equal(agentLimitParam("200", 50, 100), 100);
  assert.equal(agentLimitParam("25", 50, 100), 25);
});

test("activity timestamps are ISO and invalid rows are skipped", () => {
  const { items } = mergeAgentActivity({
    evidence: [
      { id: "e1", title: "Good", source: "agent", metrics: { origin: "agent_progress" }, created_at: new Date("2026-10-22T10:00:00Z") },
      { id: "e2", title: "Bad", source: "agent", metrics: {}, created_at: "not a date" },
    ],
  }, null, 50);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.at, "2026-10-22T10:00:00.000Z");
});

test("a resolved blocker shows both its opening and its resolution", () => {
  const { items } = mergeAgentActivity({
    blockers: [{
      id: "b1",
      description: "Waiting on review",
      status: "resolved",
      created_at: new Date("2026-10-22T09:00:00Z"),
      resolved_at: new Date("2026-10-22T12:00:00Z"),
      agent_token_id: "token-1",
    }],
  }, null, 50);
  assert.deepEqual(items.map((item) => [item.kind, item.at]), [
    ["blocker.resolved", "2026-10-22T12:00:00.000Z"],
    ["blocker.opened", "2026-10-22T09:00:00.000Z"],
  ]);
});
