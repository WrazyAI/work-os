import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TOKEN_DEFAULT_EXPIRY_DAYS,
  agentTokenExpiry,
  agentTokenPrefix,
  hashAgentToken,
  newAgentTokenSecret,
  validateAgentScopes,
} from "../src/lib/work-agent-tokens";
import { hasAgentScope, parseAgentAuthorization, agentRouteError } from "../src/lib/work-agent-auth";
import { WorkOsConflictError } from "../src/lib/work-os-api";

test("a token secret is prefixed, opaque, and hashes deterministically", () => {
  const secret = newAgentTokenSecret();
  assert.match(secret, /^wos_agent_[A-Za-z0-9_-]{43}$/);
  assert.equal(hashAgentToken(secret), hashAgentToken(secret));
  assert.match(hashAgentToken(secret), /^[0-9a-f]{64}$/);
  assert.notEqual(hashAgentToken(secret), hashAgentToken(newAgentTokenSecret()));
  assert.equal(agentTokenPrefix(secret), secret.slice(0, 12));
});

test("scopes default to read, write, and progress, and reject unknown values", () => {
  assert.deepEqual(validateAgentScopes(undefined), ["tasks:read", "tasks:write", "progress:write"]);
  assert.deepEqual(validateAgentScopes(["tasks:read", "tasks:read"]), ["tasks:read"]);
  assert.throws(() => validateAgentScopes(["tasks:read", "admin"]), /scope/i);
  assert.throws(() => validateAgentScopes([]), /scope/i);
});

test("expiry defaults to 90 days and stays within 1..365", () => {
  const now = new Date("2026-10-22T00:00:00Z");
  assert.equal(AGENT_TOKEN_DEFAULT_EXPIRY_DAYS, 90);
  assert.equal(agentTokenExpiry(undefined, now).toISOString(), "2027-01-20T00:00:00.000Z");
  assert.equal(agentTokenExpiry(30, now).toISOString(), "2026-11-21T00:00:00.000Z");
  assert.throws(() => agentTokenExpiry(0, now), /expiry/i);
  assert.throws(() => agentTokenExpiry(366, now), /expiry/i);
  assert.throws(() => agentTokenExpiry("soon", now), /expiry/i);
});

test("the guard accepts only a wos_agent bearer and enforces scopes", () => {
  assert.equal(parseAgentAuthorization("Bearer wos_agent_abc"), "wos_agent_abc");
  assert.equal(parseAgentAuthorization("bearer wos_agent_abc"), "wos_agent_abc");
  assert.equal(parseAgentAuthorization("Bearer desktop-token"), null);
  assert.equal(parseAgentAuthorization(null), null);
  assert.equal(hasAgentScope(["tasks:read"], "tasks:read"), true);
  assert.equal(hasAgentScope(["tasks:read"], "tasks:write"), false);
  assert.equal(hasAgentScope(["tasks:read"]), true);
  assert.equal(hasAgentScope([], "tasks:read"), false);
});

test("cross-person task denials map to 404, not a server error", async () => {
  const response = agentRouteError(new Error("Task is not available to this employee"));
  assert.equal(response.status, 404);
  const body = await response.json() as { code?: string };
  assert.equal(body.code, "not_found");
});

test("an in-flight idempotency conflict asks the caller to retry", () => {
  const response = agentRouteError(new WorkOsConflictError("The same request is still being applied", "idempotency_in_flight"));
  assert.equal(response.status, 409);
  assert.equal(response.headers.get("Retry-After"), "1");
});
