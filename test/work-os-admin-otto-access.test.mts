import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Execute complete production modules, replacing only external auth/database
 * and provider readiness boundaries. No server credentials or live I/O. */
function fixture(options: { role?: string; profileRole?: "owner" | "member"; personId?: string | null; flags?: Record<string, boolean> } = {}) {
  const writes: Array<{ table: string; operation: string; value: any }> = [];
  const tables: Record<string, any[]> = {
    profiles: [{ id: "actor-1", email: "admin@example.test", display_name: "Admin", avatar_url: null, role: options.profileRole ?? (options.role && options.role !== "admin" ? "member" : "owner"), created_at: "2026-01-01T00:00:00Z" }],
    work_org_members: [{ id: "member-1", user_id: "actor-1", organization_id: "org-1", role: options.role ?? "admin", person_id: options.personId ?? null, active: true, feature_flags: {}, created_at: "2026-01-01T00:00:00Z" }],
    work_organizations: [{ id: "org-1", feature_flags: { employee_companion: true, desktop_companion: true, voice_input: true, ...options.flags }, legacy_owner_id: "owner-1", created_by: "creator-1" }],
    work_desktop_sessions: [{ id: "session-1", organization_id: "org-1", user_id: "actor-1", token_hash: hash("local-session"), expires_at: "2099-01-01T00:00:00Z", revoked_at: null, last_used_at: new Date().toISOString() }],
    work_desktop_auth_codes: [], work_audit_log: [], work_people: [],
  };
  const state = {
    signedIn: true, speech: true, transcription: true, activations: 0, preferenceReads: 0, preferenceSaves: 0,
    savedInput: null as { mode: "all" | "selected"; personIds: string[]; expectedRevision: number } | null,
    preferenceError: null as Error | null,
  };
  const db = {
    from(table: string) {
      assert.ok(table in tables, `unexpected database table ${table}`);
      const filters: Array<(row: any) => boolean> = [];
      let operation = "select";
      let value: any;
      let conflictKeys: string[] = [];
      let single = false;
      const query: any = {
        select() { return query; },
        eq(key: string, expected: unknown) { filters.push((row) => row[key] === expected); return query; },
        is(key: string, expected: unknown) { filters.push((row) => (row[key] ?? null) === expected); return query; },
        insert(input: any) { operation = "insert"; value = input; return query; },
        update(input: any) { operation = "update"; value = input; return query; },
        upsert(input: any, options: { onConflict: string }) { operation = "upsert"; value = input; conflictKeys = options.onConflict.split(","); return query; },
        single() { single = true; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve: (result: any) => void, reject: (error: unknown) => void) {
          return Promise.resolve().then(() => {
            let rows = tables[table].filter((row) => filters.every((filter) => filter(row)));
            if (operation !== "select") {
              writes.push({ table, operation, value });
              if (operation === "insert") {
                const row = { id: `inserted-${tables[table].length + 1}`, ...value };
                tables[table].push(row);
                rows = [row];
              } else if (operation === "update") {
                rows.forEach((row) => Object.assign(row, value));
              } else {
                const existing = tables[table].find((row) => conflictKeys.every((key) => row[key] === value[key]));
                if (existing) {
                  Object.assign(existing, value);
                  rows = [existing];
                } else {
                  const row = { id: `upserted-${tables[table].length + 1}`, person_id: null, feature_flags: {}, ...value };
                  tables[table].push(row);
                  rows = [row];
                }
              }
            }
            return { data: single ? rows[0] ?? null : rows, error: null };
          }).then(resolve, reject);
        },
      };
      return query;
    },
  };
  const stubs: Record<string, unknown> = {
    "src/lib/supabase/admin.ts": { createAdminClient: () => db },
    "src/lib/supabase/auth.ts": {
      requireUserProfile: async () => {
        if (!state.signedIn) throw Object.assign(new Error("sign in"), { digest: "NEXT_REDIRECT;replace;/login" });
        const row = tables.profiles[0];
        return { user: { id: row.id }, profile: { id: row.id, role: row.role, email: row.email, displayName: row.display_name, avatarUrl: row.avatar_url, createdAt: row.created_at } };
      },
    },
    "src/lib/work-os.ts": { isWorkOsMigrationRequired: () => false },
    "src/lib/work-os-companion.ts": { getWorkOsDay: () => { throw new Error("unmapped personal day must not load"); } },
    "src/lib/work-os-recap-speech.ts": { recapSpeechConfigured: () => state.speech },
    "src/lib/aiTranscribe.ts": { voiceInputConfigured: () => state.transcription },
    "src/lib/work-os-admin-otto-preferences.ts": {
      initializeAdminOtto: async () => {
        state.activations++;
        return { mode: "all", personIds: [], revision: 0, activated: true };
      },
      getAdminOttoPreferences: async () => {
        state.preferenceReads++;
        return { mode: "all", personIds: [], revision: 3, activated: true };
      },
      saveAdminOttoPreferences: async (_access: unknown, input: { mode: "all" | "selected"; personIds: string[]; expectedRevision: number }) => {
        state.preferenceSaves++;
        if (state.preferenceError) throw state.preferenceError;
        state.savedInput = input;
        return { mode: input.mode, personIds: input.personIds, revision: input.expectedRevision + 1, activated: true };
      },
    },
  };
  const cache = new Map<string, any>();
  function load(relative: string): any {
    const file = relative.endsWith(".ts") ? relative : `${relative}.ts`;
    if (stubs[file]) return stubs[file];
    if (cache.has(file)) return cache.get(file);
    assert.ok(existsSync(path.join(root, file)), `missing production module: ${file}`);
    const exports = {};
    cache.set(file, exports);
    const js = ts.transpileModule(readFileSync(path.join(root, file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    }).outputText;
    const require = (specifier: string) => specifier.startsWith("@/")
      ? load(`src/${specifier.slice(2)}`)
      : specifier.startsWith(".")
        ? load(path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)))
        : nativeRequire(specifier);
    new Function("require", "exports", "module", js)(require, exports, { exports });
    return exports;
  }
  return { tables, writes, state, load };
}

const contextRoute = "src/app/api/work-os/admin/otto/context/route.ts";
const accessModule = "src/lib/work-os-admin-otto-access.ts";
const sessionRoute = "src/app/api/work-os/desktop/session/route.ts";
const authorizeRoute = "src/app/api/work-os/desktop/authorize/route.ts";
const request = (headers: Record<string, string> = {}, method = "POST", body?: unknown) => new Request("https://app.example.test/api/work-os/admin/otto/context", {
  method, headers: { authorization: "Bearer local-session", ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const authorizeBody = () => ({
  challenge: createHash("sha256").update("v".repeat(43)).digest("base64url"),
  state: "s".repeat(16),
  redirect_uri: "wrazy-workos://auth",
});

test("unmapped_admin_can_bootstrap_without_person_writes", async () => {
  for (const personId of [null, "person-1"]) {
    const f = fixture({ personId });
    const response = await f.load(contextRoute).POST(request({}, "POST", { userId: "forged", organizationId: "other", mode: "employee" }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      schemaVersion: 1, scope: { userId: "actor-1", organizationId: "org-1", mode: "admin" },
      personId, voiceAvailable: true, transcriptionAvailable: true,
    });
    assert.equal(f.state.activations, 1, "the explicit POST context activates following");
    assert.deepEqual(f.writes, [], "context does not insert people or enable flags");
    if (!personId) {
      const personal = await f.load("src/app/api/work-os/me/day/route.ts").GET(request({}, "GET"));
      assert.equal(personal.status, 409, "admin context never grants an unmapped personal day");
    }
  }
});

test("employee_and_manager_cannot_use_admin_context", async () => {
  for (const role of ["employee", "manager"]) {
    const f = fixture({ role, personId: "person-1" });
    assert.equal((await f.load(contextRoute).POST(request())).status, 403);
    assert.deepEqual(f.writes, []);
    assert.equal(f.state.activations, 0, "a denied context never activates follows");
  }
});

test("cross_org_header_and_expired_token_are_denied", async () => {
  const f = fixture();
  const route = f.load(contextRoute);
  assert.equal((await route.POST(request({ "x-work-os-organization-id": "org-other" }))).status, 403);
  f.tables.work_desktop_sessions[0].expires_at = "2000-01-01T00:00:00Z";
  assert.equal((await route.POST(request())).status, 401);
  f.tables.work_desktop_sessions[0].expires_at = "2099-01-01T00:00:00Z";
  f.tables.work_desktop_sessions[0].revoked_at = new Date().toISOString();
  assert.equal((await route.POST(request())).status, 401);
  assert.equal((await route.POST(request({ authorization: "Bearer unknown" }))).status, 401);
  assert.deepEqual(f.writes, []);
  assert.equal(f.state.activations, 0, "denied contexts never activate follows");
});

test("employee_desktop_still_requires_person", async () => {
  for (const role of ["employee", "manager"]) {
    const f = fixture({ role });
    assert.equal((await f.load(sessionRoute).GET(request({}, "GET"))).status, 409);
    assert.equal((await f.load(authorizeRoute).POST(request({ origin: "https://app.example.test" }, "POST", authorizeBody()))).status, 409);
    assert.equal((await f.load("src/app/api/work-os/me/day/route.ts").GET(request({}, "GET"))).status, 409);
    assert.deepEqual(f.writes, []);
    f.tables.work_org_members[0].person_id = "employee-1";
    assert.equal((await f.load(sessionRoute).GET(request({}, "GET"))).status, 200);
  }
});

test("admin_desktop_connect_preserves_origin_pkce_expiry_and_single_use", async () => {
  for (const personId of [null, "person-1"]) {
    const f = fixture({ personId });
    const authorize = f.load(authorizeRoute).POST;
    const verifier = "v".repeat(43);
    const body = { challenge: createHash("sha256").update(verifier).digest("base64url"), state: "s".repeat(16), redirect_uri: "wrazy-workos://auth" };
    assert.equal((await authorize(request({ origin: "https://evil.test" }, "POST", body))).status, 403);
    assert.equal((await authorize(request({ origin: "https://app.example.test" }, "POST", { ...body, challenge: "bad" }))).status, 400);
    const response = await authorize(request({ origin: "https://app.example.test" }, "POST", body));
    assert.equal(response.status, 200);
    const code = new URL((await response.json()).callbackUrl).searchParams.get("code");
    const { exchangeDesktopCode } = f.load("src/lib/work-os-desktop-auth.ts");
    await assert.rejects(exchangeDesktopCode({ code, verifier: "x".repeat(43) }), /PKCE/);
    f.tables.work_desktop_auth_codes[0].expires_at = "2000-01-01T00:00:00Z";
    await assert.rejects(exchangeDesktopCode({ code, verifier }), /expired/);
    f.tables.work_desktop_auth_codes[0].expires_at = "2099-01-01T00:00:00Z";
    const session = await exchangeDesktopCode({ code, verifier });
    assert.equal(session.organization_id, "org-1");
    assert.equal((await f.load(sessionRoute).GET(request({ authorization: `Bearer ${session.access_token}` }, "GET"))).status, 200);
    await assert.rejects(exchangeDesktopCode({ code, verifier }), /expired|used/);
    assert.equal(f.writes.filter((write) => write.table === "work_people").length, 0);
    assert.ok(f.writes.every((write) => ["work_desktop_auth_codes", "work_desktop_sessions", "work_audit_log"].includes(write.table)));
  }
});

test("existing_companion_and_voice_flags_are_required_not_enabled", async () => {
  const disabled = fixture({ flags: { employee_companion: false } });
  const denied = await disabled.load(contextRoute).POST(request());
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.deepEqual(disabled.writes, []);
  const noDesktop = fixture({ flags: { desktop_companion: false } });
  assert.equal((await noDesktop.load(sessionRoute).GET(request({}, "GET"))).status, 403);
  assert.equal((await noDesktop.load(authorizeRoute).POST(request({ origin: "https://app.example.test" }, "POST", authorizeBody()))).status, 403);
  const noVoice = fixture({ flags: { voice_input: false } });
  assert.equal((await noVoice.load(accessModule).requireAdminOttoAccess(request(), "voice")).response.status, 403);
  const body = await (await noVoice.load(contextRoute).POST(request())).json();
  assert.equal(body.voiceAvailable, false);
  assert.equal(body.transcriptionAvailable, false);
  assert.deepEqual(noVoice.writes, []);
  assert.equal(disabled.state.activations, 0);
});

test("context_reports_speech_and_transcription_readiness_independently", async () => {
  const f = fixture();
  f.state.speech = false;
  let body = await (await f.load(contextRoute).POST(request())).json();
  assert.equal(body.voiceAvailable, false);
  assert.equal(body.transcriptionAvailable, true);
  f.state.speech = true;
  f.state.transcription = false;
  body = await (await f.load(contextRoute).POST(request())).json();
  assert.equal(body.voiceAvailable, true);
  assert.equal(body.transcriptionAvailable, false);
});

test("preferences_route_reads_without_activation_and_saves_with_revision", async () => {
  const f = fixture();
  const route = f.load("src/app/api/work-os/admin/otto/preferences/route.ts");
  const get = await route.GET(request({}, "GET"));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.deepEqual(await get.json(),
    { schemaVersion: 1, mode: "all", personIds: [], revision: 3, activated: true });
  assert.equal(f.state.preferenceReads, 1);
  assert.equal(f.state.activations, 0, "GET preferences never activates first use");

  const put = await route.PUT(request({}, "PUT", {
    mode: "selected", personIds: ["person-1"], expectedRevision: 3,
  }));
  assert.equal(put.status, 200);
  assert.equal(put.headers.get("cache-control"), "no-store");
  assert.deepEqual(await put.json(),
    { schemaVersion: 1, mode: "selected", personIds: ["person-1"], revision: 4, activated: true });
  assert.deepEqual(f.state.savedInput,
    { mode: "selected", personIds: ["person-1"], expectedRevision: 3 });
  assert.equal(f.state.preferenceSaves, 1);

  const denied = await route.PUT(request({ authorization: "Bearer unknown" }, "PUT", {
    mode: "all", personIds: [], expectedRevision: 4,
  }));
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.equal(f.state.preferenceSaves, 1, "a denied save never reaches the service");

  const api = f.load("src/lib/work-os-api.ts");
  f.state.preferenceError = new api.WorkOsConflictError(
    "Follow preferences changed on another device. Reload before saving.", "preferences_conflict");
  const stale = await route.PUT(request({}, "PUT", { mode: "all", personIds: [], expectedRevision: 4 }));
  assert.equal(stale.status, 409);
  assert.equal(stale.headers.get("cache-control"), "no-store");
  assert.deepEqual(await stale.json(), {
    schemaVersion: 1, error: "Follow preferences changed on another device. Reload before saving.",
    reason: "preferences_conflict",
  });
  f.state.preferenceError = new api.WorkOsValidationError("personIds must be organization employee ids");
  const invalid = await route.PUT(request({}, "PUT", { mode: "selected", personIds: ["missing"], expectedRevision: 4 }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    schemaVersion: 1, error: "personIds must be organization employee ids",
  });
});

test("cookie_writes_require_expected_origin_and_bearer_is_unchanged", async () => {
  const f = fixture();
  const context = f.load(contextRoute);
  const denied = await context.POST(request({ authorization: "" }, "POST"));
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("cache-control"), "no-store");
  assert.equal(f.state.activations, 0, "a cookie POST without an origin never activates follows");

  const cross = await context.POST(request({ authorization: "", origin: "https://evil.example.test" }, "POST"));
  assert.equal(cross.status, 403);
  assert.equal(f.state.activations, 0);

  const allowed = await context.POST(request({ authorization: "", origin: "https://app.example.test" }, "POST"));
  assert.equal(allowed.status, 200);
  assert.equal(f.state.activations, 1);

  const bearer = await context.POST(request({}, "POST"));
  assert.equal(bearer.status, 200);
  assert.equal(f.state.activations, 2, "native bearer context keeps working without an origin");

  const route = f.load("src/app/api/work-os/admin/otto/preferences/route.ts");
  const saveDenied = await route.PUT(request({ authorization: "" }, "PUT", {
    mode: "all", personIds: [], expectedRevision: 0,
  }));
  assert.equal(saveDenied.status, 403);
  assert.equal(f.state.preferenceSaves, 0);

  const saveAllowed = await route.PUT(request({ authorization: "", origin: "https://app.example.test" }, "PUT", {
    mode: "all", personIds: [], expectedRevision: 0,
  }));
  assert.equal(saveAllowed.status, 200);
  assert.equal(f.state.preferenceSaves, 1);

  const saveBearer = await route.PUT(request({}, "PUT", {
    mode: "all", personIds: [], expectedRevision: 0,
  }));
  assert.equal(saveBearer.status, 200);
  assert.equal(f.state.preferenceSaves, 2, "native bearer saves keep working without an origin");
});

test("preferences_put_rejects_non_object_json", async () => {
  const f = fixture();
  const route = f.load("src/app/api/work-os/admin/otto/preferences/route.ts");
  for (const body of [null, []]) {
    const response = await route.PUT(request({}, "PUT", body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(f.state.preferenceSaves, 0);
  }
  const malformed = new Request("https://app.example.test/api/work-os/admin/otto/preferences", {
    method: "PUT",
    headers: { authorization: "Bearer local-session", "content-type": "application/json" },
    body: "{",
  });
  const malformedResponse = await route.PUT(malformed);
  assert.equal(malformedResponse.status, 400);
  assert.equal(f.state.preferenceSaves, 0);

  const empty = await route.PUT(request({}, "PUT", {}));
  assert.equal(empty.status, 400);
  assert.equal(f.state.preferenceSaves, 0);
});

test("cookie_context_uses_authoritative_membership_and_owner_selection", async () => {
  const f = fixture();
  f.tables.work_org_members.push({ ...f.tables.work_org_members[0], id: "member-2", organization_id: "org-2", created_at: "2026-02-01T00:00:00Z" });
  f.tables.work_organizations.push({ id: "org-2", feature_flags: { employee_companion: true }, legacy_owner_id: null, created_by: "owner-2" });
  const helper = f.load(accessModule);
  const cookie = request({ authorization: "" });
  const first = await helper.requireAdminOttoAccess(cookie);
  assert.equal(first.response?.status, 409);
  assert.equal((await first.response?.json())?.reason, "organization_required");
  const selected = await helper.requireAdminOttoAccess(request({ authorization: "", "x-work-os-organization-id": "org-2" }));
  assert.equal(selected.access.organizationId, "org-2");
  assert.equal(selected.access.organizationOwnerId, "owner-2");
  assert.equal((await helper.requireAdminOttoAccess(request({ authorization: "", "x-work-os-organization-id": "org-missing" }))).response.status, 403);
  f.state.signedIn = false;
  assert.equal((await f.load(contextRoute).POST(cookie)).status, 401);
});

test("revalidation_reloads_role_membership_token_flags_and_exact_scope", async () => {
  const f = fixture();
  const helper = f.load(accessModule);
  const scope = { userId: "actor-1", organizationId: "org-1", mode: "admin" };
  const denied = (status: number) => (error: unknown) => error instanceof Response && error.status === status;
  assert.equal((await helper.revalidateAdminOttoAccess(request(), scope)).role, "admin");
  for (const changed of [{ ...scope, userId: "actor-2" }, { ...scope, organizationId: "org-other" }, { ...scope, mode: "employee" }]) {
    await assert.rejects(helper.revalidateAdminOttoAccess(request(), changed), denied(403));
  }
  f.tables.work_org_members[0].role = "employee";
  await assert.rejects(helper.revalidateAdminOttoAccess(request(), scope), denied(403));
  f.tables.work_org_members[0].role = "admin";
  f.tables.work_org_members[0].active = false;
  await assert.rejects(helper.revalidateAdminOttoAccess(request(), scope), denied(403));
  f.tables.work_org_members[0].active = true;
  f.tables.work_organizations[0].feature_flags.voice_input = false;
  await assert.rejects(helper.revalidateAdminOttoAccess(request(), scope), denied(403));
  f.tables.work_organizations[0].feature_flags.voice_input = true;
  f.tables.work_organizations[0].feature_flags.employee_companion = false;
  await assert.rejects(helper.revalidateAdminOttoAccess(request(), scope), denied(403));
  f.tables.work_organizations[0].feature_flags.employee_companion = true;
  f.tables.work_desktop_sessions[0].revoked_at = new Date().toISOString();
  await assert.rejects(helper.revalidateAdminOttoAccess(request(), scope), denied(401));
});

test("initial_otto_access_never_provisions_revoked_or_missing_owner_membership", async () => {
  for (const profileRole of ["owner", "member"] as const) {
    for (const authorization of ["", "Bearer local-session"]) {
      for (const missing of [false, true]) {
        const f = fixture({ profileRole });
        f.tables.work_organizations[0].legacy_owner_id = "actor-1";
        if (missing) f.tables.work_org_members = [];
        else f.tables.work_org_members[0].active = false;
        const response = await f.load(contextRoute).POST(request({ authorization }));
        assert.equal(response.status, 403, `${profileRole}, ${authorization ? "bearer" : "cookie"}, ${missing ? "missing" : "revoked"}`);
        const body = await response.json();
        assert.deepEqual(Object.keys(body).sort(), ["error", "schemaVersion"], "denials contain no protected context data");
        assert.equal(body.scope, undefined, "denials return no authorized context");
        assert.equal(body.personId, undefined);
        assert.deepEqual(f.writes, [], "Otto reads must not create an organization or restore membership");
        assert.equal(f.tables.work_org_members[0]?.active ?? false, false);
      }
    }
  }
});

test("owner_revalidation_without_org_header_cannot_restore_revoked_membership", async () => {
  for (const authorization of ["", "Bearer local-session"]) {
    const f = fixture();
    f.tables.work_organizations[0].legacy_owner_id = "actor-1";
    f.tables.work_org_members[0].active = false;
    const scope = { userId: "actor-1", organizationId: "org-1", mode: "admin" };
    await assert.rejects(f.load(accessModule).revalidateAdminOttoAccess(request({ authorization }), scope),
      (error: unknown) => error instanceof Response && error.status === 403);
    assert.deepEqual(f.writes, []);
    assert.equal(f.tables.work_org_members[0].active, false);
  }
});

test("revalidation_binds_expected_org_and_rejects_conflicting_header_or_bearer", async () => {
  const f = fixture({ profileRole: "member" });
  f.tables.work_org_members.push({ ...f.tables.work_org_members[0], id: "member-2", organization_id: "org-2", created_at: "2026-02-01T00:00:00Z" });
  f.tables.work_organizations.push({ ...f.tables.work_organizations[0], id: "org-2" });
  const scope = { userId: "actor-1", organizationId: "org-2", mode: "admin" };
  const helper = f.load(accessModule);
  const bound = await helper.revalidateAdminOttoAccess(request({ authorization: "" }), scope);
  assert.equal(bound.organizationId, "org-2", "expected scope wins over oldest-membership selection");
  const conflictingHeaders: Array<Record<string, string>> = [
    { authorization: "", "x-work-os-organization-id": "org-1" },
    { authorization: "Bearer local-session" },
    { authorization: "Bearer local-session", "x-work-os-organization-id": "org-2" },
  ];
  for (const headers of conflictingHeaders) {
    await assert.rejects(helper.revalidateAdminOttoAccess(request(headers), scope),
      (error: unknown) => error instanceof Response && error.status === 403);
  }
  assert.deepEqual(f.writes, []);
});

test("legacy_owner_bootstrap_remains_available_outside_otto", async () => {
  const f = fixture();
  f.tables.work_organizations[0].legacy_owner_id = "actor-1";
  f.tables.work_org_members[0].active = false;
  const result = await f.load("src/lib/work-os-api.ts").requireWorkOsAccess();
  assert.equal(result.access.role, "admin");
  assert.equal(f.tables.work_org_members[0].active, true);
  assert.deepEqual(f.writes.map(({ table, operation }) => ({ table, operation })), [
    { table: "work_organizations", operation: "upsert" },
    { table: "work_org_members", operation: "upsert" },
  ]);
});
