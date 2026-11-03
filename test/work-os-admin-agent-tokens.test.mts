import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  ADMIN_AGENT_DEFAULT_SCOPES,
  ADMIN_AGENT_TOKEN_SCOPES,
  newAdminAgentTokenSecret,
  validateAdminAgentScopes,
} from "../src/lib/work-agent-tokens";

test("admin secrets use their own prefix and are opaque", () => {
  const secret = newAdminAgentTokenSecret();
  assert.match(secret, /^wos_admin_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret, newAdminAgentTokenSecret());
});

test("admin scopes default to reads and reject employee-only or unknown scopes", () => {
  assert.deepEqual(validateAdminAgentScopes(undefined), [
    "people:read", "tasks:read", "eods:read", "records:read", "insights:read",
  ]);
  assert.deepEqual(validateAdminAgentScopes(["tasks:read", "tasks:write"]), ["tasks:read", "tasks:write"]);
  assert.deepEqual([...ADMIN_AGENT_TOKEN_SCOPES], [
    "people:read", "tasks:read", "tasks:write", "eods:read", "eods:review", "records:read", "insights:read",
  ]);
  assert.throws(() => validateAdminAgentScopes(["progress:write"]), /scope/i);
  assert.throws(() => validateAdminAgentScopes([]), /scope/i);
  assert.deepEqual(ADMIN_AGENT_DEFAULT_SCOPES, [
    "people:read", "tasks:read", "eods:read", "records:read", "insights:read",
  ]);
});

// ---------------------------------------------------------------------------
// Token lifecycle runs against the production module with the data layer
// stubbed, so the assertions see the real insert/filter/audit values.

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);

type Call = { op: "select" | "insert" | "update"; table: string; values?: Record<string, unknown>; filters: string[] };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Shape a stored row like a PostgREST column list would. */
function project(row: Record<string, unknown>, columns: string) {
  return Object.fromEntries(columns.split(",").map((column) => [column, row[column]]));
}

function tokenFixture() {
  const calls: Call[] = [];
  const rows: Array<Record<string, unknown>> = [];
  const audits: Array<{
    action: string; targetType: string; targetId: string | null; metadata: Record<string, unknown>;
  }> = [];
  let nextId = 1;
  let failure: string | null = null;

  const matches = (row: Record<string, unknown>, filters: string[]) => filters.every((filter) => {
    const [column, raw] = filter.split("=");
    const expected = raw === "null" ? null : raw;
    return (row[column] ?? null) === expected;
  });

  function query(table: string) {
    const call: Call = { op: "select", table, filters: [] };
    calls.push(call);
    let inserted: Record<string, unknown> | null = null;
    let columns: string | null = null;
    const q: any = {
      insert: (values: Record<string, unknown>) => {
        call.op = "insert";
        call.values = values;
        inserted = values;
        return q;
      },
      update: (values: Record<string, unknown>) => {
        call.op = "update";
        call.values = values;
        return q;
      },
      select: (selected?: unknown) => {
        if (typeof selected === "string") columns = selected;
        return q;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push(`${column}=${String(value)}`);
        return q;
      },
      is: (column: string, value: unknown) => {
        call.filters.push(`${column}=${value === null ? "null" : String(value)}`);
        return q;
      },
      order: () => q,
      maybeSingle: async () => {
        if (failure) return { data: null, error: { message: failure } };
        if (call.op === "update") {
          const row = rows.find((candidate) => matches(candidate, call.filters));
          if (!row) return { data: null, error: null };
          Object.assign(row, call.values);
          return { data: { id: row.id }, error: null };
        }
        return { data: rows.find((candidate) => matches(candidate, call.filters)) ?? null, error: null };
      },
      single: async () => {
        if (failure) return { data: null, error: { message: failure } };
        assert.ok(inserted, "single() without an insert");
        const row = { id: `token-${nextId++}`, ...inserted };
        rows.push(row);
        return { data: columns ? project(row, columns) : row, error: null };
      },
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => {
        try {
          if (failure) {
            resolve({ data: null, error: { message: failure } });
            return;
          }
          resolve({
            data: rows.filter((row) => matches(row, call.filters)).map((row) => columns ? project(row, columns) : row),
            error: null,
          });
        } catch (error) {
          reject(error);
        }
      },
    };
    return q;
  }

  const stubs: Record<string, unknown> = {
    "@/lib/work-os-internal": {
      db: () => ({ from: query }),
      audit: async (
        _access: unknown, action: string, targetType: string, targetId: string | null,
        metadata: Record<string, unknown>,
      ) => {
        audits.push({ action, targetType, targetId, metadata });
        calls.push({ op: "insert", table: "work_audit_log", filters: [] });
      },
    },
    "@/lib/work-os-api": {
      WorkOsValidationError: class extends Error {
        constructor(message: string) { super(message); this.name = "WorkOsValidationError"; }
      },
      WorkOsForbiddenError: class extends Error {
        constructor(message: string) { super(message); this.name = "WorkOsForbiddenError"; }
      },
    },
  };

  const file = "src/lib/work-agent-tokens.ts";
  const js = ts.transpileModule(readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const require = (specifier: string) => stubs[specifier] ?? nativeRequire(specifier);
  const exports = {};
  new Function("require", "exports", "module", js)(require, exports, { exports });

  return {
    calls,
    rows,
    audits,
    fail: (message: string) => { failure = message; },
    module: exports as Record<string, any>,
  };
}

function adminAccess(overrides: Record<string, unknown> = {}) {
  return {
    ctx: { user: { id: "admin-user" }, profile: {} },
    organizationId: "org-1",
    organizationName: "Workspace",
    organizationOwnerId: null,
    role: "admin",
    personId: null,
    membershipId: "membership-1",
    featureFlags: { admin_agent_api: true },
    workspaces: [],
    ...overrides,
  };
}

/** The same account seen through the employee token model; the admin user owns
 * both kinds, so only the kind filter can separate them. */
function employeeAccess(overrides: Record<string, unknown> = {}) {
  return adminAccess({
    role: "employee",
    personId: "person-1",
    featureFlags: {},
    ...overrides,
  });
}

test("creating an admin token needs the admin role and the admin agent feature", async () => {
  const fixture = tokenFixture();
  const create = fixture.module.createAdminAgentToken;

  await assert.rejects(
    () => create(adminAccess({ role: "employee" }), { name: "Admin agent" }),
    (error: Error) => error.name === "WorkOsForbiddenError" && /admin/i.test(error.message),
  );
  await assert.rejects(
    () => create(adminAccess({ featureFlags: {} }), { name: "Admin agent" }),
    (error: Error) => error.name === "WorkOsForbiddenError" && /not enabled/i.test(error.message),
  );
  await assert.rejects(
    () => create(adminAccess({ featureFlags: { admin_agent_api: false } }), { name: "Admin agent" }),
    (error: Error) => error.name === "WorkOsForbiddenError",
  );
  assert.equal(fixture.rows.length, 0, "a refused caller never mints a token");
  assert.equal(fixture.audits.length, 0, "a refused caller never writes an audit row");
});

test("an admin token is kind admin, organization- and user-bound, with a null person", async () => {
  const fixture = tokenFixture();
  const { token, secret } = await fixture.module.createAdminAgentToken(adminAccess(), {
    name: "  Admin agent  ",
  });

  const insert = fixture.calls.find((call: Call) => call.table === "work_agent_tokens" && call.op === "insert");
  assert.ok(insert, "the token row was inserted");
  assert.equal(insert.values?.kind, "admin");
  assert.equal(insert.values?.organization_id, "org-1");
  assert.equal(insert.values?.user_id, "admin-user");
  assert.ok("person_id" in (insert.values ?? {}), "person_id is written explicitly, including null");
  assert.equal(insert.values?.person_id, null);
  assert.equal(insert.values?.name, "Admin agent");
  assert.deepEqual(insert.values?.scopes, [
    "people:read", "tasks:read", "eods:read", "records:read", "insights:read",
  ]);
  assert.equal(insert.values?.token_hash, sha256(secret), "only the digest is stored");
  assert.match(secret, /^wos_admin_/);
  assert.equal((token as Record<string, unknown>).token_hash, undefined, "the digest never leaves the data layer");

  assert.deepEqual(fixture.audits.map((entry) => entry.action), ["agent_token.created"]);
  assert.equal(fixture.audits[0].targetType, "agent_token");
  assert.equal(fixture.audits[0].targetId, "token-1");
  assert.equal(fixture.audits[0].metadata.kind, "admin");
  assert.equal(fixture.audits[0].metadata.name, "Admin agent");
  assert.deepEqual(fixture.audits[0].metadata.scopes, [
    "people:read", "tasks:read", "eods:read", "records:read", "insights:read",
  ]);
  assert.ok(typeof fixture.audits[0].metadata.expiresAt === "string");
});

test("an admin token keeps a person mapping when the admin also has one", async () => {
  const fixture = tokenFixture();
  await fixture.module.createAdminAgentToken(adminAccess({ personId: "person-1" }), {
    name: "Admin agent", scopes: ["tasks:read", "tasks:write"], expiresInDays: 30,
  });
  const insert = fixture.calls.find((call: Call) => call.table === "work_agent_tokens" && call.op === "insert");
  assert.equal(insert?.values?.person_id, "person-1");
  assert.deepEqual(insert?.values?.scopes, ["tasks:read", "tasks:write"]);
  assert.ok(typeof insert?.values?.expires_at === "string");
});

test("admin token list and revoke scope to the admin kind and the owning user", async () => {
  const fixture = tokenFixture();
  fixture.rows.push(
    { id: "admin-token", kind: "admin", organization_id: "org-1", user_id: "admin-user", person_id: null, revoked_at: null },
    { id: "employee-token", kind: "employee", organization_id: "org-1", user_id: "admin-user", person_id: "person-1", revoked_at: null },
    { id: "foreign-token", kind: "admin", organization_id: "org-1", user_id: "other-user", person_id: null, revoked_at: null },
  );

  const listed = await fixture.module.listAdminAgentTokens(adminAccess());
  assert.deepEqual(listed.map((row: Record<string, unknown>) => row.id), ["admin-token"]);

  const revoke = fixture.module.revokeAdminAgentToken;
  assert.equal(await revoke(adminAccess(), "employee-token"), false, "an employee token is not revocable through the admin model");
  assert.equal(await revoke(adminAccess(), "foreign-token"), false, "another admin's token is not revocable");
  assert.equal(await revoke(adminAccess(), "admin-token"), true);
  assert.equal(fixture.rows[0].revoked_at !== null, true, "revoke stamps revoked_at");
  assert.equal(await revoke(adminAccess(), "admin-token"), false, "an already revoked token is not found");

  const tokenCalls = fixture.calls.filter((call: Call) => call.table === "work_agent_tokens");
  for (const call of tokenCalls) {
    assert.ok(call.filters.includes("organization_id=org-1"), "the organization always scopes the query");
    assert.ok(call.filters.includes("user_id=admin-user"), "the owning admin user scopes the query");
    assert.ok(call.filters.includes("kind=admin"), "the admin kind scopes the query");
  }
  assert.ok(
    tokenCalls.every((call: Call) => !call.filters.some((filter) => filter.startsWith("person_id="))),
    "admin tokens never filter on person_id",
  );
});

test("employee token management cannot list or revoke a person-mapped admin token", async () => {
  const fixture = tokenFixture();
  fixture.rows.push(
    // Same organization, same owning user, same person: only `kind` separates
    // the admin token from the employee token.
    { id: "admin-token", kind: "admin", organization_id: "org-1", user_id: "admin-user", person_id: "person-1", revoked_at: null },
    { id: "employee-token", kind: "employee", organization_id: "org-1", user_id: "admin-user", person_id: "person-1", revoked_at: null },
  );

  const listed = await fixture.module.listAgentTokens(employeeAccess());
  assert.deepEqual(listed.map((row: Record<string, unknown>) => row.id), ["employee-token"],
    "a person-mapped admin token never appears in the employee list");

  assert.equal(await fixture.module.revokeAgentToken(employeeAccess(), "admin-token"), false,
    "the employee path cannot revoke an admin token");
  assert.equal(fixture.rows[0].revoked_at, null, "the admin token stays active");
  assert.equal(fixture.audits.length, 0, "a failed employee revoke writes no audit row");

  const adminListed = await fixture.module.listAdminAgentTokens(adminAccess());
  assert.deepEqual(adminListed.map((row: Record<string, unknown>) => row.id), ["admin-token"],
    "the admin list still owns the person-mapped admin token");
  assert.equal(await fixture.module.revokeAdminAgentToken(adminAccess(), "admin-token"), true,
    "the admin path revokes it");
  assert.equal(fixture.rows[0].revoked_at !== null, true);
  assert.deepEqual(fixture.audits, [{
    action: "agent_token.revoked",
    targetType: "agent_token",
    targetId: "admin-token",
    metadata: { kind: "admin" },
  }], "only the admin revoke is audited, with the admin kind");

  const employeeCalls = fixture.calls.filter((call: Call) => call.filters.includes("kind=employee"));
  assert.equal(employeeCalls.length, 2, "the employee list and revoke both filter the kind");
  for (const call of employeeCalls) {
    assert.equal(call.table, "work_agent_tokens");
    assert.ok(call.filters.includes("person_id=person-1"));
  }
});

test("admin list and revoke refuse a manager and a disabled feature without side effects", async () => {
  const fixture = tokenFixture();
  fixture.rows.push(
    { id: "admin-token", kind: "admin", organization_id: "org-1", user_id: "admin-user", person_id: null, revoked_at: null },
  );
  const { listAdminAgentTokens, revokeAdminAgentToken } = fixture.module;
  const refusals = [
    adminAccess({ role: "manager", personId: "person-1" }),
    adminAccess({ featureFlags: { admin_agent_api: false } }),
    adminAccess({ featureFlags: {} }),
  ];

  for (const access of refusals) {
    await assert.rejects(
      () => listAdminAgentTokens(access),
      (error: Error) => error.name === "WorkOsForbiddenError",
      "listing admin tokens needs an admin in an enabled organization",
    );
    await assert.rejects(
      () => revokeAdminAgentToken(access, "admin-token"),
      (error: Error) => error.name === "WorkOsForbiddenError",
      "revoking an admin token needs an admin in an enabled organization",
    );
  }

  assert.equal(fixture.rows[0].revoked_at, null, "a refused revoke never stamps revoked_at");
  assert.equal(fixture.audits.length, 0, "a refused caller writes no audit row");
  assert.equal(fixture.calls.length, 0, "a refused caller never reaches the data layer");
});
