import assert from "node:assert/strict";
import test from "node:test";
import { agentRequestHash, idempotencyDecision } from "../src/lib/work-agent-idempotency";
import { AgentRateLimitError, assertAgentRateLimit } from "../src/lib/work-agent-rate-limit";

test("same key and hash replays, different hash conflicts, fresh in-flight waits", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const row = { request_hash: "abc", status: 201, body: { id: "t1" }, updated_at: now.toISOString() };
  assert.deepEqual(idempotencyDecision(row, "abc", now), { kind: "replay", status: 201, body: { id: "t1" } });
  assert.deepEqual(idempotencyDecision(row, "other", now), { kind: "conflict" });
  assert.deepEqual(idempotencyDecision({ ...row, status: 0 }, "abc", now), { kind: "in_flight" });
  assert.deepEqual(idempotencyDecision({ ...row, status: 0, updated_at: "2026-10-21T23:58:00Z" }, "abc", now), { kind: "claim" });
  assert.deepEqual(idempotencyDecision(null, "abc", now), { kind: "claim" });
});

test("an in-flight claim with a different request hash conflicts", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  const row = { request_hash: "abc", status: 0, body: null, updated_at: now.toISOString() };
  assert.deepEqual(idempotencyDecision(row, "other", now), { kind: "conflict" });
});

test("the request hash is stable across key order and changes with the body", () => {
  assert.equal(
    agentRequestHash("POST", "/api/agent/v1/tasks", { a: 1, b: [2, 3] }),
    agentRequestHash("post", "/api/agent/v1/tasks", { b: [2, 3], a: 1 }),
  );
  assert.notEqual(
    agentRequestHash("POST", "/api/agent/v1/tasks", { a: 1 }),
    agentRequestHash("POST", "/api/agent/v1/tasks", { a: 2 }),
  );
  assert.match(agentRequestHash("POST", "/api/agent/v1/tasks", {}), /^[0-9a-f]{64}$/);
});

test("the limiter resets on a new minute and separates writes", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  for (let i = 0; i < 120; i++) assertAgentRateLimit("token", false, now);
  assert.throws(() => assertAgentRateLimit("token", false, now), AgentRateLimitError);
  for (let i = 0; i < 20; i++) assertAgentRateLimit("other", true, now);
  assert.throws(() => assertAgentRateLimit("other", true, now), AgentRateLimitError);
  assertAgentRateLimit("token", false, new Date("2026-10-22T00:01:01Z"));
});

test("a rate-limited write reports a retry-after within the window", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  for (let i = 0; i < 20; i++) assertAgentRateLimit("retry-token", true, now);
  try {
    assertAgentRateLimit("retry-token", true, new Date("2026-10-22T00:00:30Z"));
    assert.fail("expected a rate limit error");
  } catch (error) {
    assert.ok(error instanceof AgentRateLimitError);
    assert.equal(error.retryAfter, 30);
  }
});
