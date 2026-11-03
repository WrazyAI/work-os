import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { adminAgentRouteError } from "../src/lib/work-admin-agent-auth";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import {
  confirmAdminPreview,
  createAdminPreview,
  getAdminPreview,
  previewFingerprint,
  stableStateJson,
  WorkAdminPreviewError,
  type CreateAdminPreviewInput,
} from "../src/lib/work-admin-action-previews";
import { WorkOsConflictError, type WorkOsAccess } from "../src/lib/work-os-api";
import {
  adminAccess, adminMembership, adminUser, fixture, org, otherOrgAccess,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** The preview store runs over the real PGlite pool, so the fixture installs
 * the same connection shim the app uses and the store executes its actual SQL
 * (including the partial unique index on `(token_id, idempotency_key)`). The
 * suite writes rows, so each run owns its own fixture. */

const TOKEN_A = "91000000-0000-4000-8000-000000000001";
const TOKEN_SECRET = "wos_admin_previews_token_a";
const OTHER_USER = "40000000-0000-4000-8000-000000000014";

let f: Awaited<ReturnType<typeof fixture>>;

/** A second admin in the same organization: the preview belongs to the user
 * that created it, not to whoever holds the organization id. */
const sameOrgOtherUserAccess = {
  organizationId: org,
  personId: null,
  membershipId: adminMembership,
  role: "admin",
  ctx: { user: { id: OTHER_USER }, profile: { id: OTHER_USER } },
  featureFlags: { employee_companion: true, admin_agent_api: true },
  organizationOwnerId: adminUser,
  workspaces: [{ organizationId: org, name: "Workspace", role: "admin", personId: null }],
} as unknown as WorkOsAccess;

const input: Omit<CreateAdminPreviewInput, "state"> = {
  organizationId: org,
  userId: adminUser,
  tokenId: null,
  source: "api",
  action: "task.assign",
  targetType: "task",
  targetId: "t1",
  request: {},
  preview: { action: "task.assign", summary: "Assign", changes: [], warnings: [], state: {}, expiresAt: "" },
  expiresAt: new Date(Date.now() + 60_000),
};

const state = { updatedAt: "a", status: "open" };

before(async () => {
  f = await fixture();
  await f.db.query(
    `insert into work_agent_tokens
      (id, organization_id, person_id, user_id, kind, name, token_hash, token_prefix, scopes, expires_at)
     values ($1,$2,null,$3,'admin','preview token',$4,$5,'{}'::text[], now() + interval '1 day')`,
    [TOKEN_A, org, adminUser, hashAgentToken(TOKEN_SECRET), TOKEN_SECRET.slice(0, 12)],
  );
});

after(async () => {
  await f.close();
});

test("confirm applies once and replays the stored result", async () => {
  const created = await createAdminPreview({ ...input, state: { updatedAt: "a", status: "open" } });
  let applied = 0;
  const first = await confirmAdminPreview(adminAccess, created.id, "key-1", {
    readState: async () => ({ updatedAt: "a", status: "open" }),
    apply: async () => { applied += 1; return { status: 200, body: { ok: true } }; },
  });
  assert.equal(first.replayed, false);
  const second = await confirmAdminPreview(adminAccess, created.id, "key-2", {
    readState: async () => ({ updatedAt: "a", status: "open" }),
    apply: async () => { applied += 1; return { status: 200, body: { ok: false } }; },
  });
  assert.equal(second.replayed, true);
  assert.equal(applied, 1);
  assert.deepEqual(second.body, { ok: true });
});

test("a changed target state is stale and writes nothing", async () => {
  const created = await createAdminPreview({ ...input, state: { updatedAt: "a", status: "open" } });
  await assert.rejects(
    () => confirmAdminPreview(adminAccess, created.id, "key-1", {
      readState: async () => ({ updatedAt: "b", status: "open" }),
      apply: async () => { throw new Error("must not apply"); },
    }),
    (error: Error) => error.name === "WorkAdminPreviewError" && (error as Error & { code: string }).code === "preview_stale",
  );
  // Nothing was claimed, so a confirm against the unchanged state still runs.
  let applied = 0;
  const accepted = await confirmAdminPreview(adminAccess, created.id, "key-2", {
    readState: async () => ({ updatedAt: "a", status: "open" }),
    apply: async () => { applied += 1; return { status: 200, body: { ok: true } }; },
  });
  assert.equal(accepted.replayed, false);
  assert.equal(applied, 1);
});

test("expired previews answer preview_expired", async () => {
  const created = await createAdminPreview({ ...input, state, expiresAt: new Date(Date.now() - 1_000) });
  await assert.rejects(
    () => confirmAdminPreview(adminAccess, created.id, "key-1", {
      readState: async () => state,
      apply: async () => { throw new Error("must not apply"); },
    }),
    (error: Error) => error.name === "WorkAdminPreviewError" && (error as Error & { code: string }).code === "preview_expired",
  );
});

test("another user or organization cannot read or confirm the preview", async () => {
  const created = await createAdminPreview({ ...input, state });
  assert.ok(await getAdminPreview(adminAccess, created.id), "the owner can read its preview");
  assert.equal(await getAdminPreview(sameOrgOtherUserAccess, created.id), null);
  assert.equal(await getAdminPreview(otherOrgAccess, created.id), null);
  await assert.rejects(
    () => confirmAdminPreview(otherOrgAccess, created.id, "key-1", {
      readState: async () => state,
      apply: async () => { throw new Error("must not apply"); },
    }),
    (error: Error) => error.name === "WorkAdminPreviewError" && (error as Error & { code: string }).code === "preview_not_found",
  );
  await assert.rejects(
    () => confirmAdminPreview(sameOrgOtherUserAccess, created.id, "key-1", {
      readState: async () => state,
      apply: async () => { throw new Error("must not apply"); },
    }),
    (error: Error) => error.name === "WorkAdminPreviewError" && (error as Error & { code: string }).code === "preview_not_found",
  );
  assert.ok(await getAdminPreview(adminAccess, created.id), "a refused confirm leaves the preview readable");
});

test("a new preview defaults to a fifteen-minute expiry", async () => {
  const before = Date.now();
  const created = await createAdminPreview({ ...input, expiresAt: undefined, state });
  const delta = new Date(created.expiresAt).getTime() - before;
  assert.ok(delta >= 14 * 60_000 && delta <= 16 * 60_000, `unexpected expiry delta ${delta}`);
  assert.equal(new Date((await getAdminPreview(adminAccess, created.id))?.expiresAt ?? 0).getTime(), new Date(created.expiresAt).getTime());
});

test("an execution error leaves the preview unconfirmed so a retry can run", async () => {
  const created = await createAdminPreview({ ...input, state });
  await assert.rejects(
    () => confirmAdminPreview(adminAccess, created.id, "key-1", {
      readState: async () => state,
      apply: async () => { throw new Error("upstream write failed"); },
    }),
    /upstream write failed/,
  );
  let applied = 0;
  const retried = await confirmAdminPreview(adminAccess, created.id, "key-1", {
    readState: async () => ({ updatedAt: "a", status: "open" }),
    apply: async () => { applied += 1; return { status: 201, body: { ok: true } }; },
  });
  assert.equal(retried.replayed, false);
  assert.equal(retried.status, 201);
  assert.equal(applied, 1);
});

test("a missing preview is not found for read and confirm", async () => {
  const missing = "91000000-0000-4000-8000-0000000000ff";
  assert.equal(await getAdminPreview(adminAccess, missing), null);
  await assert.rejects(
    () => confirmAdminPreview(adminAccess, missing, "key-1", {
      readState: async () => state,
      apply: async () => { throw new Error("must not apply"); },
    }),
    (error: Error) => error.name === "WorkAdminPreviewError" && (error as Error & { code: string }).code === "preview_not_found",
  );
});

test("an API preview reuses one idempotency key for the same request only", async () => {
  const first = await createAdminPreview({ ...input, tokenId: TOKEN_A, idempotencyKey: "create-1", state });
  const replay = await createAdminPreview({ ...input, tokenId: TOKEN_A, idempotencyKey: "create-1", state });
  assert.equal(replay.id, first.id, "the same request replays the stored preview");

  await assert.rejects(
    () => createAdminPreview({
      ...input, tokenId: TOKEN_A, idempotencyKey: "create-1", request: { mode: "remove" }, state,
    }),
    (error: Error) => {
      // The alias import inside the store can be a distinct module instance, so
      // match the stable class name (the same rule the admin error mapper uses).
      assert.equal(error.name, "WorkOsConflictError");
      return (error as Error & { reason?: string }).reason === "idempotency_conflict";
    },
  );
  const response = adminAgentRouteError(new WorkOsConflictError("Idempotency-Key was already used", "idempotency_conflict"));
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, "idempotency_conflict");
});

test("session and Otto previews have no token row and are never deduped", async () => {
  const first = await createAdminPreview({
    ...input, source: "otto", tokenId: null, idempotencyKey: "create-otto", state,
  });
  const second = await createAdminPreview({
    ...input, source: "otto", tokenId: null, idempotencyKey: "create-otto", state,
  });
  assert.notEqual(second.id, first.id, "the partial unique index excludes null token ids");
});

test("a readState query through the shared pool does not deadlock the confirm transaction", async () => {
  const created = await createAdminPreview({ ...input, state: { marker: "real-query" } });
  const result = await confirmAdminPreview(adminAccess, created.id, "key-1", {
    readState: async () => {
      // The route's reader talks to the same pool the store just took a
      // connection from; the claim must not hold the connection hostage.
      const { rows } = await f.db.query<{ marker: string }>("select 'real-query' as marker");
      return { marker: rows[0]?.marker ?? "missing" };
    },
    apply: async () => ({ status: 200, body: { ok: true } }),
  });
  assert.equal(result.replayed, false);
  assert.equal(result.status, 200);
});

test("a preview whose confirm is still running answers preview_in_flight", async () => {
  const created = await createAdminPreview({ ...input, state });
  // A claim commits before `apply()` runs, so this is the exact state another
  // confirm observes while the first apply is still executing.
  await f.db.query(
    `update work_admin_action_previews set confirmed_at = now() where id = $1`,
    [created.id],
  );
  await assert.rejects(
    () => confirmAdminPreview(adminAccess, created.id, "key-1", {
      readState: async () => state,
      apply: async () => { throw new Error("must not apply"); },
    }),
    (error: Error) => error.name === "WorkAdminPreviewError"
      && (error as Error & { code: string; status: number }).code === "preview_in_flight"
      && (error as Error & { status: number }).status === 409,
  );
});

test("preview errors keep their own code and status through the admin mapper", async () => {
  const expired = new WorkAdminPreviewError("preview_expired");
  assert.equal(expired.name, "WorkAdminPreviewError");
  const response = adminAgentRouteError(expired);
  assert.equal(response.status, 410);
  assert.equal((await response.json() as { code: string }).code, "preview_expired");
});

test("the fingerprint ignores key and value order but not a real change", () => {
  const left = { updatedAt: "a", status: "open", assignees: ["p2", "p1"] };
  const right = { assignees: ["p1", "p2"], status: "open", updatedAt: "a" };
  assert.equal(stableStateJson({ b: 1, a: 2 }), stableStateJson({ a: 2, b: 1 }));
  assert.equal(previewFingerprint({ x: { b: 1, a: 2 } }), previewFingerprint({ x: { a: 2, b: 1 } }));
  assert.equal(previewFingerprint(left), previewFingerprint(right));
  assert.notEqual(previewFingerprint(left), previewFingerprint({ ...left, updatedAt: "b" }));
  assert.notEqual(previewFingerprint(left), previewFingerprint({ ...left, status: "completed" }));
  // Arrays of objects keep their order: there the sequence is the structure.
  assert.notEqual(
    previewFingerprint({ items: [{ id: "a" }, { id: "b" }] }),
    previewFingerprint({ items: [{ id: "b" }, { id: "a" }] }),
  );
  assert.match(previewFingerprint(left), /^[0-9a-f]{64}$/);
});
