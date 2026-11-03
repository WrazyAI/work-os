import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
import yaml from "js-yaml";
import { GET as meGET } from "../src/app/api/agent/admin/v1/me/route";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import { adminUser, fixture, org } from "./helpers/work-os-admin-agent-fixture.mts";

const root = new URL("../", import.meta.url);
const read = (file: string) => readFile(new URL(file, root), "utf8");

const ADMIN_SCOPES = [
  "none",
  "people:read",
  "tasks:read",
  "tasks:write",
  "eods:read",
  "eods:review",
  "records:read",
  "insights:read",
];

const DESIGN_CODES = [
  "unauthorized",
  "token_revoked",
  "token_expired",
  "forbidden",
  "feature_disabled",
  "insufficient_scope",
  "not_found",
  "preview_stale",
  "preview_expired",
  "preview_in_flight",
  "conflict",
  "validation_error",
  "invalid_cursor",
  "rate_limited",
  "evidence_required",
  "file_too_large",
  "unsupported_file_type",
  "idempotency_conflict",
];

/** Every consequential write answers `202` with a preview instead of writing. */
const PREVIEW_ROUTES = [
  "/eods/{reportId}/review",
  "/previews",
  "/tasks",
  "/tasks/{taskId}",
  "/tasks/{taskId}/assign",
  "/tasks/{taskId}/complete",
  "/tasks/{taskId}/move",
  "/tasks/{taskId}/reopen",
];

async function routePaths(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      paths.push(...await routePaths(path.join(dir, entry.name), `${prefix}/${entry.name}`));
    } else if (entry.name === "route.ts") {
      paths.push(prefix || "/");
    }
  }
  return paths;
}

async function openapi() {
  return yaml.load(await read("docs/openapi/work-os-admin-agent-v1.yaml")) as Record<string, any>;
}

/** Follow one local `$ref` so an assertion can inspect the resolved schema. */
function resolveRef(spec: Record<string, any>, node: Record<string, any>) {
  if (typeof node.$ref !== "string" || !node.$ref.startsWith("#/")) return node;
  return node.$ref.slice(2).split("/").reduce((current, key) => current?.[key], spec as any) as Record<string, any>;
}

test("the admin OpenAPI document covers every admin v1 route in both directions", async () => {
  const spec = await openapi();
  const directory = fileURLToPath(new URL("../src/app/api/agent/admin/v1", import.meta.url));
  const actual = (await routePaths(directory)).map((route) => route.replace(/\[([^\]]+)\]/g, "{$1}")).sort();
  assert.deepEqual(Object.keys(spec.paths as Record<string, unknown>).sort(), actual);
  for (const [route, item] of Object.entries(spec.paths as Record<string, Record<string, any>>)) {
    for (const [method, operation] of Object.entries(item)) {
      if (route === "/openapi.yaml") {
        assert.deepEqual(operation.security, [], "the schema itself is public");
        continue;
      }
      assert.deepEqual(operation.security ?? spec.security, [{ bearerAuth: [] }], `${method} ${route} must require the bearer scheme`);
      assert.ok(
        ADMIN_SCOPES.includes(operation["x-required-scope"]),
        `${method} ${route} needs a known scope`,
      );
    }
  }
});

test("the document names every admin scope", async () => {
  const spec = await openapi();
  const used = new Set<string>();
  for (const [route, item] of Object.entries(spec.paths as Record<string, Record<string, any>>)) {
    if (route === "/openapi.yaml") continue;
    for (const operation of Object.values(item)) used.add(operation["x-required-scope"]);
  }
  for (const scope of ADMIN_SCOPES) assert.ok(used.has(scope), `the document never uses ${scope}`);
});

test("the error enum carries every design code", async () => {
  const spec = await openapi();
  const codes = spec.components.schemas.Error.properties.code.enum as string[];
  for (const code of DESIGN_CODES) assert.ok(codes.includes(code), `missing ${code}`);
});

test("GET /me documents identity without the token secret", async () => {
  const spec = await openapi();
  const operation = spec.paths["/me"].get;
  assert.equal(operation["x-required-scope"], "none");
  const schema = resolveRef(spec, operation.responses["200"].content["application/json"].schema);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["organization_id", "person_id", "role", "token", "user_id"]);
  assert.deepEqual([...schema.required].sort(), ["organization_id", "person_id", "role", "token", "user_id"]);
  const token = resolveRef(spec, schema.properties.token);
  assert.deepEqual(
    Object.keys(token.properties).sort(),
    ["expires_at", "id", "name", "prefix", "scopes"],
    "the token metadata must never name a secret field",
  );
  assert.equal(schema.properties.person_id.type, "string");
  assert.equal(schema.properties.person_id.nullable, true, "the token's person mapping is optional");
  assert.equal(schema.properties.role.enum.includes("admin"), true);
});

test("every consequential write documents a 202 preview and only confirm executes", async () => {
  const spec = await openapi();
  for (const route of PREVIEW_ROUTES) {
    const operations = spec.paths[route];
    const writer = operations.post ?? operations.patch ?? operations.delete;
    assert.ok(writer, `${route} has a write operation`);
    assert.ok(writer.responses["202"], `${route} must answer 202 with a preview`);
    assert.equal(writer.responses["201"], undefined, `${route} must not create directly`);
  }
  const confirm = spec.paths["/previews/{previewId}/confirm"].post;
  assert.ok(confirm.responses["200"] || confirm.responses["201"], "confirm returns the applied result");
  const preview = spec.components.schemas.Preview;
  assert.deepEqual(
    [...preview.required].sort(),
    ["action", "changes", "expiresAt", "id", "summary", "warnings"],
  );
});

test("the generic preview routes document the action's own write scope", async () => {
  const spec = await openapi();
  for (const route of ["/previews", "/previews/{previewId}", "/previews/{previewId}/confirm"]) {
    for (const operation of Object.values(spec.paths[route] as Record<string, any>)) {
      assert.deepEqual(operation["x-required-scope-any"].sort(), ["eods:review", "tasks:write"], `${route} accepts either write scope`);
    }
  }
});

test("the evidence contract documents the 8 MB upload limit", async () => {
  const spec = await openapi();
  const upload = spec.components.schemas.EvidenceUpload;
  assert.deepEqual([...upload.required], ["file"]);
  assert.match(upload.properties.file.description, /8 MB/);
  const operation = spec.paths["/tasks/{taskId}/evidence"].post;
  const media = operation.requestBody.content["multipart/form-data"];
  assert.ok(media, "evidence is multipart");
});

test("the served schema reads the repository contract", async () => {
  const route = await read("src/app/api/agent/admin/v1/openapi.yaml/route.ts");
  assert.match(route, /docs\/openapi\/work-os-admin-agent-v1\.yaml/);
  assert.match(route, /application\/yaml/);
  assert.match(route, /public, max-age=300/);
});

const TOKEN_ID = "91000000-0000-4000-8000-000000000001";
const SECRET = "wos_admin_openapi_me_secret";

let f: Awaited<ReturnType<typeof fixture>>;

before(async () => {
  f = await fixture();
  await f.db.exec(`
    alter table work_organizations add column name text not null default 'Workspace';
    alter table work_organizations add column legacy_owner_id uuid;
    alter table work_organizations add column created_by uuid;
    create table profiles (
      id uuid primary key,
      email text,
      display_name text,
      avatar_url text,
      role text,
      created_at timestamptz not null default now()
    );
  `);
  await f.db.query(
    "insert into profiles (id, email, display_name, role) values ($1, 'admin@example.com', 'Admin', 'member')",
    [adminUser],
  );
  await f.db.query(
    `update work_organizations
     set feature_flags = '{"employee_companion":true,"admin_agent_api":true}'::jsonb
     where id = $1`,
    [org],
  );
  await f.db.query(
    `insert into work_agent_tokens
      (id, organization_id, person_id, user_id, kind, name, token_hash, token_prefix, scopes, expires_at)
     values ($1,$2,null,$3,'admin','identity token',$4,$5,$6::text[], now() + interval '1 day')`,
    [TOKEN_ID, org, adminUser, hashAgentToken(SECRET), SECRET.slice(0, 12), ["people:read"]],
  );
});

after(async () => {
  await f.close();
});

test("GET /me answers the resolved admin identity with any valid token", async () => {
  const response = await meGET(new Request("https://example.test/api/agent/admin/v1/me", {
    headers: { authorization: `Bearer ${SECRET}` },
  }));
  assert.equal(response.status, 200);
  const raw = await response.text();
  assert.equal(raw.includes(SECRET), false, "the response must never echo the secret");
  const body = JSON.parse(raw) as Record<string, any>;
  assert.deepEqual(Object.keys(body).sort(), ["organization_id", "person_id", "role", "token", "user_id"]);
  assert.equal(body.organization_id, org);
  assert.equal(body.user_id, adminUser);
  assert.equal(body.role, "admin");
  assert.equal(body.person_id, null);
  assert.deepEqual(Object.keys(body.token).sort(), ["expires_at", "id", "name", "prefix", "scopes"]);
  assert.equal(body.token.id, TOKEN_ID);
  assert.equal(body.token.name, "identity token");
  assert.equal(body.token.prefix, SECRET.slice(0, 12));
  assert.deepEqual(body.token.scopes, ["people:read"]);
  assert.equal(typeof body.token.expires_at, "string");
});

test("GET /me refuses an absent bearer", async () => {
  const response = await meGET(new Request("https://example.test/api/agent/admin/v1/me"));
  assert.equal(response.status, 401);
  assert.equal((await response.json() as { code: string }).code, "unauthorized");
});
