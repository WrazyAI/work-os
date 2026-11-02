import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  adminAgentError,
  adminAgentRouteError,
  hasAdminAgentScope,
  parseAdminAgentAuthorization,
  requireAdminAgentAccess,
  type AdminAgentAccess,
} from "../src/lib/work-admin-agent-auth";
import { AgentRateLimitError } from "../src/lib/work-agent-rate-limit";
import { withAgentIdempotency } from "../src/lib/work-agent-idempotency";
import {
  WorkOsConflictError,
  WorkOsForbiddenError,
  WorkOsNotFoundError,
  WorkOsValidationError,
  type WorkOsAccess,
} from "../src/lib/work-os-api";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("only a wos_admin bearer is accepted", () => {
  assert.equal(parseAdminAgentAuthorization("Bearer wos_admin_abc"), "wos_admin_abc");
  assert.equal(parseAdminAgentAuthorization("bearer wos_admin_abc"), "wos_admin_abc");
  assert.equal(parseAdminAgentAuthorization("Bearer wos_agent_abc"), null);
  assert.equal(parseAdminAgentAuthorization("Bearer desktop-token"), null);
  assert.equal(parseAdminAgentAuthorization(null), null);
});

test("scopes are exact", () => {
  assert.equal(hasAdminAgentScope(["tasks:read"], "tasks:read"), true);
  assert.equal(hasAdminAgentScope(["tasks:read"], "tasks:write"), false);
  assert.equal(hasAdminAgentScope([], "tasks:read"), false);
  assert.equal(hasAdminAgentScope([]), true);
});

test("an employee bearer is unauthorized on the admin surface", async () => {
  // The wrong kind is simply unknown here: 401 before any database read, never
  // a 403 that would reveal the employee surface.
  const result = await requireAdminAgentAccess(new Request("https://example.test/api/agent/admin/v1/me", {
    headers: { authorization: "Bearer wos_agent_abc" },
  }));
  assert.ok(result.response);
  assert.equal(result.response.status, 401);
  assert.equal((await result.response.json() as { code: string }).code, "unauthorized");
});

test("the mapper keeps the API error contract", async () => {
  const notFound = adminAgentRouteError(new WorkOsNotFoundError());
  assert.equal(notFound.status, 404);
  assert.equal((await notFound.json() as { code: string }).code, "not_found");
  const forbidden = adminAgentRouteError(new WorkOsForbiddenError());
  assert.equal(forbidden.status, 403);
  const conflict = adminAgentRouteError(new WorkOsConflictError("changed", "preview_stale"));
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json() as { code: string }).code, "preview_stale");
  const validation = adminAgentRouteError(new WorkOsValidationError("bad"));
  assert.equal(validation.status, 400);
  const disabled = await adminAgentError("feature_disabled", "off", 403).json() as { code: string };
  assert.equal(disabled.code, "feature_disabled");
});

test("a rate-limited admin call carries a retry-after", () => {
  const response = adminAgentRouteError(new AgentRateLimitError(12));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "12");
});

test("a preview error keeps its own code and status without an import", async () => {
  // Task 10's class is mapped by name; the auth module must not import the
  // preview store and create a cycle.
  const previewError = Object.assign(new Error("This preview expired"), {
    name: "WorkAdminPreviewError",
    code: "preview_expired",
    status: 410,
  });
  const response = adminAgentRouteError(previewError);
  assert.equal(response.status, 410);
  assert.equal((await response.json() as { code: string }).code, "preview_expired");
});

test("an unknown failure is a 500 without leaking the message", async () => {
  const response = adminAgentRouteError(new Error("connection reset by peer"));
  assert.equal(response.status, 500);
  const body = await response.json() as { code: string; error: string };
  assert.equal(body.code, "internal_error");
  assert.equal(body.error, "Request failed");
});

test("the idempotency cache accepts an admin identity", async () => {
  // Admin tokens reuse the employee idempotency table, so the cache only needs
  // the organization access and the token id; an empty key still validates
  // before any database call.
  const access: WorkOsAccess = {
    ctx: {
      user: { id: "user-1" },
      profile: { id: "user-1", email: null, displayName: null, avatarUrl: null, role: "member", createdAt: "" },
    },
    organizationId: "org-1",
    organizationName: "Organization",
    organizationOwnerId: null,
    role: "admin",
    personId: null,
    membershipId: "membership-1",
    featureFlags: {},
    workspaces: [],
  };
  const admin: AdminAgentAccess = {
    access,
    tokenId: "token-1",
    tokenName: "Admin token",
    tokenPrefix: "wos_admin_ab",
    expiresAt: null,
    scopes: ["people:read"],
  };
  await assert.rejects(
    () => withAgentIdempotency({
      agent: admin,
      key: "  ",
      requestHash: "hash",
      handler: async () => ({ status: 200, body: {} }),
    }),
    WorkOsValidationError,
  );
});

test("the admin resolver is kind-scoped, membership-based, and flag-gated", async () => {
  const auth = await read("src/lib/work-admin-agent-auth.ts");
  assert.match(auth, /\.eq\("kind", "admin"\)/);

  const membership = auth.match(/from\("work_org_members"\)([\s\S]*?)\.maybeSingle\(\)/)?.[1] ?? "";
  assert.ok(membership, "the admin membership lookup is missing");
  assert.match(membership, /\.eq\("organization_id"/);
  assert.match(membership, /\.eq\("user_id"/);
  assert.match(membership, /\.eq\("active", true\)/);
  assert.doesNotMatch(membership, /person_id/, "admin membership must never be looked up by person");

  assert.match(auth, /role !== "admin"/);
  assert.match(auth, /ADMIN_AGENT_FEATURE_FLAG/);
  assert.match(auth, /employee_companion/);
});

test("the idempotency module no longer requires an employee token", async () => {
  const idempotency = await read("src/lib/work-agent-idempotency.ts");
  assert.match(idempotency, /export type AgentIdempotencyIdentity = \{ access: WorkOsAccess; tokenId: string \}/);
  assert.doesNotMatch(idempotency, /import type \{ AgentAccess \}/);
});
