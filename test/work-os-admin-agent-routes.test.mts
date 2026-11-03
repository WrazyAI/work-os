import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { GET as peopleGET } from "../src/app/api/agent/admin/v1/people/route";
import { GET as personGET } from "../src/app/api/agent/admin/v1/people/[personId]/route";
import { GET as projectsGET } from "../src/app/api/agent/admin/v1/projects/route";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import {
  adminUser, fixture, org, otherPerson, personA,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** Route-level harness: the real resolver, real PGlite pool, and real rate
 * limiter. Only the session cookie layer is absent because an admin agent call
 * authenticates with its bearer token, which is the path under test. */

const READ_TOKEN = "90000000-0000-4000-8000-000000000001";
const NO_SCOPE_TOKEN = "90000000-0000-4000-8000-000000000002";
const RATE_TOKEN = "90000000-0000-4000-8000-000000000003";
const READ_SECRET = "wos_admin_route_read_secret";
const NO_SCOPE_SECRET = "wos_admin_route_no_scope_secret";
const RATE_SECRET = "wos_admin_route_rate_secret";

let f: Awaited<ReturnType<typeof fixture>>;

const request = (pathname: string, secret?: string) =>
  new Request(`https://example.test${pathname}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

async function insertToken(id: string, secret: string, scopes: string[]) {
  await f.db.query(
    `insert into work_agent_tokens
      (id, organization_id, person_id, user_id, kind, name, token_hash, token_prefix, scopes, expires_at)
     values ($1,$2,null,$3,'admin','route token',$4,$5,$6::text[], now() + interval '1 day')`,
    [id, org, adminUser, hashAgentToken(secret), secret.slice(0, 12), scopes],
  );
}

before(async () => {
  f = await fixture();
  await f.seedDirectory();
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
  await insertToken(READ_TOKEN, READ_SECRET, ["people:read"]);
  await insertToken(NO_SCOPE_TOKEN, NO_SCOPE_SECRET, ["tasks:read"]);
  await insertToken(RATE_TOKEN, RATE_SECRET, ["people:read"]);
});

after(async () => {
  await f.close();
});

test("every directory route refuses an absent bearer", async () => {
  const responses = await Promise.all([
    peopleGET(request("/api/agent/admin/v1/people")),
    personGET(request(`/api/agent/admin/v1/people/${personA}`), { params: Promise.resolve({ personId: personA }) }),
    projectsGET(request("/api/agent/admin/v1/projects")),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 401);
    assert.equal((await response.json() as { code: string }).code, "unauthorized");
  }
});

test("every directory route requires people:read", async () => {
  const responses = await Promise.all([
    peopleGET(request("/api/agent/admin/v1/people", NO_SCOPE_SECRET)),
    personGET(request(`/api/agent/admin/v1/people/${personA}`, NO_SCOPE_SECRET), { params: Promise.resolve({ personId: personA }) }),
    projectsGET(request("/api/agent/admin/v1/projects", NO_SCOPE_SECRET)),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { code: string }).code, "insufficient_scope");
  }
});

test("the three routes return their documented envelopes", async () => {
  const peopleResponse = await peopleGET(request("/api/agent/admin/v1/people?q=ada", READ_SECRET));
  assert.equal(peopleResponse.status, 200);
  const peopleBody = await peopleResponse.json() as {
    people: Array<{ id: string; displayName: string }>;
    total: number;
    cursor: { next: string | null };
  };
  assert.deepEqual(Object.keys(peopleBody).sort(), ["cursor", "people", "total"]);
  assert.deepEqual(peopleBody.people.map((person) => person.displayName), ["Ada Lovelace"]);
  assert.equal(peopleBody.total, 1);
  assert.equal(peopleBody.cursor.next, null);

  const detailResponse = await personGET(
    request(`/api/agent/admin/v1/people/${personA}`, READ_SECRET),
    { params: Promise.resolve({ personId: personA }) },
  );
  assert.equal(detailResponse.status, 200);
  const detailBody = await detailResponse.json() as {
    person: { id: string; manager: { id: string } | null; teams: Array<{ id: string }> };
  };
  assert.deepEqual(Object.keys(detailBody), ["person"]);
  assert.equal(detailBody.person.id, personA);
  assert.ok(detailBody.person.manager);
  assert.ok(detailBody.person.teams.length > 0);

  const projectsResponse = await projectsGET(request("/api/agent/admin/v1/projects", READ_SECRET));
  assert.equal(projectsResponse.status, 200);
  const projectsBody = await projectsResponse.json() as { projects: Array<{ name: string }> };
  assert.deepEqual(Object.keys(projectsBody), ["projects"]);
  assert.deepEqual(projectsBody.projects.map((project) => project.name), ["App", "Website"]);
});

test("person detail answers 404 for a cross-organization or malformed id", async () => {
  for (const personId of [otherPerson, "not-a-uuid"]) {
    const response = await personGET(
      request(`/api/agent/admin/v1/people/${personId}`, READ_SECRET),
      { params: Promise.resolve({ personId }) },
    );
    assert.equal(response.status, 404);
    assert.equal((await response.json() as { code: string }).code, "not_found");
  }
});

test("a directory read never consumes the write bucket", async () => {
  // The write budget is 20 per minute. Twenty-five successful reads prove the
  // route passed write=false; a write-counted read would 429 on the 21st call.
  for (let index = 0; index < 25; index += 1) {
    const response = await peopleGET(request("/api/agent/admin/v1/people", RATE_SECRET));
    assert.equal(response.status, 200, `read ${index + 1} was rate-limited`);
  }
});
