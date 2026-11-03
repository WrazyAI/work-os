import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { GET as insightsGET } from "../src/app/api/agent/admin/v1/insights/route";
import { GET as overviewGET } from "../src/app/api/agent/admin/v1/overview/route";
import { GET as recordsGET } from "../src/app/api/agent/admin/v1/records/route";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import { listAdminOttoRecords } from "../src/lib/work-os-admin-otto-reads";
import { getAdminAgentInsights, getAdminAgentOverview } from "../src/lib/work-admin-agent-insights";
import { listAdminAgentRecords, parseAdminAgentRecordFilters } from "../src/lib/work-admin-agent-records";
import {
  adminAccess, adminUser, checkoutEvent, eodCheckout, eodDraft, fixture, org, otherEod,
  otherOrg, otherOrgAccess, otherPerson, otherUpdate, personA, personB, recapInterval,
  updateCheckout, updatePercent, updateUnderscore, workdaySession,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** The records projection runs the real SQL over PGlite: sources, the escaped
 * text query, the local windows, ordering, and the tenant boundary are all
 * exercised. Overview and insights read through the Supabase-compatible data
 * client, whose administration tables this fixture does not model, so their
 * delegation is asserted at source level and everything this task owns —
 * authorization, range validation, and the foreign-person 404 — runs live. */

const WINDOWS = [
  { personId: personA, timezone: "UTC", from: "2026-11-01", through: "2026-11-02" },
  { personId: personB, timezone: "UTC", from: "2026-11-01", through: "2026-11-02" },
];
const OTHER_WINDOW = [{ personId: otherPerson, timezone: "UTC", from: "2026-11-01", through: "2026-11-02" }];

/** Error identity is asserted by name: this test file and the source resolve
 * `@/lib/work-os-api` through different module URLs under tsx, so `instanceof`
 * would compare two loads of the same class. */
const namedError = (name: string) => (error: Error) => error.name === name;

const RECORDS_TOKEN = "90000000-0000-4000-8000-000000000021";
const TASKS_TOKEN = "90000000-0000-4000-8000-000000000022";
const INSIGHTS_TOKEN = "90000000-0000-4000-8000-000000000023";
const RECORDS_SECRET = "wos_admin_records_route";
const TASKS_SECRET = "wos_admin_records_tasks";
const INSIGHTS_SECRET = "wos_admin_records_insights";

let f: Awaited<ReturnType<typeof fixture>>;

async function insertToken(id: string, secret: string, scopes: string[]) {
  await f.db.query(
    `insert into work_agent_tokens
      (id, organization_id, person_id, user_id, kind, name, token_hash, token_prefix, scopes, expires_at)
     values ($1,$2,null,$3,'admin','records route token',$4,$5,$6::text[], now() + interval '1 day')`,
    [id, org, adminUser, hashAgentToken(secret), secret.slice(0, 12), scopes],
  );
}

const request = (pathname: string, secret?: string) =>
  new Request(`https://example.test${pathname}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

before(async () => {
  f = await fixture();
  await f.seedDirectory();
  await f.seedTasks();
  await f.seedRecords();
  // The admin resolver reads the profile and organization metadata the fixture
  // does not model by default; the route tests exercise it for real.
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
    `insert into profiles (id, email, display_name, role) values
      ($1, 'admin@example.com', 'Admin', 'member')`,
    [adminUser],
  );
  await f.db.query(
    `update work_organizations
     set feature_flags = '{"employee_companion":true,"admin_agent_api":true}'::jsonb,
       legacy_owner_id = case when id = $1 then $2::uuid end,
       created_by = case when id = $1 then $2::uuid end
     where id in ($1, $3)`,
    [org, adminUser, otherOrg],
  );
  await insertToken(RECORDS_TOKEN, RECORDS_SECRET, ["records:read"]);
  await insertToken(TASKS_TOKEN, TASKS_SECRET, ["tasks:read"]);
  await insertToken(INSIGHTS_TOKEN, INSIGHTS_SECRET, ["insights:read"]);
});

after(async () => {
  await f.close();
});

test("records are filtered by source and by the projected text, in the normal order", async () => {
  const page = await listAdminOttoRecords(adminAccess, {
    windows: WINDOWS,
    sources: ["update", "submitted_eod"],
    query: "checkout",
  });
  assert.equal(page.total, 2);
  // Occurred descending: the submitted EOD at 10:00 precedes the update at 09:00.
  assert.deepEqual(page.items.map((item) => item.id), [`submitted_eod:${eodCheckout}`, `update:${updateCheckout}`]);
  for (const item of page.items) assert.match(item.text.toLowerCase(), /checkout/);
  assert.deepEqual(page.items.map((item) => item.localDate), ["2026-11-02", "2026-11-02"]);
  assert.ok(page.coverage.some((line) => line === "Sources: update, submitted_eod."));
});

test("the same query over every source returns the task event and the reviewed recap", async () => {
  const page = await listAdminOttoRecords(adminAccess, { windows: WINDOWS, query: "checkout" });
  assert.deepEqual(page.items.map((item) => item.id), [
    `task:${checkoutEvent}`,
    `submitted_eod:${eodCheckout}`,
    `update:${updateCheckout}`,
    `reviewed_recap:${recapInterval}`,
  ]);
  assert.equal(page.total, 4);
});

test("an unsubmitted draft and every other organization never appear", async () => {
  const page = await listAdminOttoRecords(adminAccess, { windows: WINDOWS, query: "checkout" });
  const ids = page.items.map((item) => item.id);
  assert.equal(ids.some((id) => id.includes(otherUpdate)), false, "no other-organization update");
  assert.equal(ids.some((id) => id.includes(otherEod)), false, "no other-organization EOD");
  const all = await listAdminOttoRecords(adminAccess, { windows: WINDOWS });
  assert.deepEqual([...new Set(all.items.map((item) => item.personId))].sort(), [personA, personB],
    "an organization read returns exactly its own people");
  assert.equal(all.items.some((item) => item.text === "Checkout report for the other org"), false);
  assert.equal(all.items.some((item) => item.text === "Checkout in the other organization"), false);
  assert.equal(all.items.some((item) => item.id === `submitted_eod:${eodDraft}`), false,
    "an unsubmitted EOD draft is employee-private");

  const otherOrgPage = await listAdminOttoRecords(otherOrgAccess, { windows: OTHER_WINDOW, query: "checkout" });
  assert.deepEqual(otherOrgPage.items.map((item) => item.id).sort(), [
    `submitted_eod:${otherEod}`,
    `update:${otherUpdate}`,
  ].sort());
});

test("LIKE metacharacters in the query are literal", async () => {
  const percent = await listAdminOttoRecords(adminAccess, { windows: WINDOWS, sources: ["update"], query: "0%" });
  assert.deepEqual(percent.items.map((item) => item.id), [`update:${updatePercent}`],
    "an unescaped % would also match the '500 items' update");
  const underscore = await listAdminOttoRecords(adminAccess, { windows: WINDOWS, sources: ["update"], query: "under_score" });
  assert.deepEqual(underscore.items.map((item) => item.id), [`update:${updateUnderscore}`],
    "an unescaped _ would also match 'underXscore'");
  const literalPercent = await listAdminOttoRecords(adminAccess, { windows: WINDOWS, sources: ["update"], query: "100%" });
  assert.deepEqual(literalPercent.items.map((item) => item.id), [`update:${updatePercent}`]);
});

test("workday snapshots project as one bounded record", async () => {
  const page = await listAdminOttoRecords(adminAccess, { windows: WINDOWS, sources: ["workday"] });
  assert.deepEqual(page.items.map((item) => item.id), [`workday:${workdaySession}`]);
  assert.equal(page.items[0].text, "Workday completed");
});

test("an over-long or unmatched query is a validation result, not a widening", async () => {
  await assert.rejects(
    () => listAdminOttoRecords(adminAccess, { windows: WINDOWS, query: "x".repeat(201) }),
    namedError("WorkOsValidationError"),
  );
  const empty = await listAdminOttoRecords(adminAccess, { windows: WINDOWS, query: "no such record text" });
  assert.deepEqual(empty.items, []);
  assert.equal(empty.total, 0);
  assert.equal(empty.nextCursor, null);
});

test("the records parser maps the documented query string and rejects bad values", async () => {
  const filters = parseAdminAgentRecordFilters(new URLSearchParams(
    `person_ids=${personA},${personB}&sources=update,submitted_eod&from=2026-11-01&to=2026-11-02&q= checkout &cursor=abc`,
  ));
  assert.deepEqual(filters.personIds, [personA, personB]);
  assert.deepEqual(filters.sources, ["update", "submitted_eod"]);
  assert.equal(filters.from, "2026-11-01");
  assert.equal(filters.to, "2026-11-02");
  assert.equal(filters.query, "checkout");
  assert.equal(filters.cursor, "abc");

  const absent = parseAdminAgentRecordFilters(new URLSearchParams(""));
  assert.equal(absent.personIds, null, "an absent person_ids reads the whole organization");
  assert.equal(absent.sources, null);
  assert.equal(absent.query, null);

  assert.throws(() => parseAdminAgentRecordFilters(new URLSearchParams("sources=chat")), /sources/);
  assert.throws(() => parseAdminAgentRecordFilters(new URLSearchParams("from=today")), /from/);
  assert.throws(() => parseAdminAgentRecordFilters(new URLSearchParams("from=2026-11-05&to=2026-11-01")), /to/);
  assert.throws(() => parseAdminAgentRecordFilters(new URLSearchParams(`q=${"y".repeat(201)}`)), /200/);
  assert.throws(
    () => parseAdminAgentRecordFilters(new URLSearchParams(`person_ids=${Array.from({ length: 21 }, (_, index) => `20000000-0000-4000-8000-0000000000${(index + 10).toString().padStart(2, "0")}`).join(",")}`)),
    /20/,
  );
});

test("the service lists the page and keeps the organization scope", async () => {
  const page = await listAdminAgentRecords(adminAccess, {
    personIds: [personA, personB],
    sources: ["update", "submitted_eod"],
    from: "2026-11-01",
    to: "2026-11-02",
    query: "checkout",
    cursor: null,
  });
  assert.deepEqual(page.records.map((record) => record.id), [`submitted_eod:${eodCheckout}`, `update:${updateCheckout}`]);
  assert.equal(page.total, 2);
  assert.equal(page.nextCursor, null);

  // An explicit empty person list is no rows, never the whole organization.
  const none = await listAdminAgentRecords(adminAccess, {
    personIds: [], sources: null, from: null, to: null, query: null, cursor: null,
  });
  assert.deepEqual(none.records, []);
  assert.equal(none.total, 0);

  // An id outside this organization is ignored rather than turning the list into
  // an authorization or validation failure.
  const foreign = await listAdminAgentRecords(adminAccess, {
    personIds: [otherPerson, personA], sources: ["update"], from: "2026-11-01", to: "2026-11-02",
    query: "checkout", cursor: null,
  });
  assert.deepEqual(foreign.records.map((record) => record.id), [`update:${updateCheckout}`]);
  assert.deepEqual(foreign.records.map((record) => record.personId), [personA]);
});

test("the service reads the whole organization when person_ids is absent", async () => {
  const page = await listAdminAgentRecords(adminAccess, {
    personIds: null, sources: ["update"], from: "2026-11-02", to: "2026-11-02",
    query: "checkout", cursor: null,
  });
  assert.deepEqual(page.records.map((record) => record.id), [`update:${updateCheckout}`]);
});

test("overview and insights delegate to the administration readers", async () => {
  const source = await readFile(new URL("../src/lib/work-admin-agent-insights.ts", import.meta.url), "utf8");
  assert.match(source, /getAdminOverview\(\s*\{\s*\.\.\.access\s*\},\s*\{\s*date\s*\}\s*\)/,
    "the overview wrapper spreads the access object into the shared reader");
  assert.match(source, /getAdminInsights\(access, range, \{ personId, through \}\)/,
    "the insights wrapper forwards the validated person and window end unchanged");
  assert.doesNotMatch(source, /createAdminClient|getPool/, "the wrappers never open a second data client");
  assert.match(source, /access\.role !== "admin"/, "both wrappers require an admin role");
});

test("the wrappers reject a non-admin before any read", async () => {
  const employee = { ...adminAccess, role: "employee" } as typeof adminAccess;
  await assert.rejects(() => getAdminAgentOverview(employee), namedError("WorkOsForbiddenError"));
  await assert.rejects(
    () => getAdminAgentInsights(employee, "7d", { personId: null, through: null }),
    namedError("WorkOsForbiddenError"),
  );
});

test("an insight person outside the organization is not found", async () => {
  await assert.rejects(
    () => getAdminAgentInsights(adminAccess, "7d", { personId: otherPerson, through: null }),
    namedError("WorkOsNotFoundError"),
  );
});

test("an unsupported insight range is a validation result", async () => {
  await assert.rejects(
    () => getAdminAgentInsights(adminAccess, "14d" as never, { personId: null, through: null }),
    namedError("WorkOsValidationError"),
  );
  await assert.rejects(
    () => getAdminAgentInsights(adminAccess, "7d", { personId: null, through: "last-week" }),
    namedError("WorkOsValidationError"),
  );
});

test("the records route needs a bearer with records:read", async () => {
  const absent = await recordsGET(request("/api/agent/admin/v1/records"));
  assert.equal(absent.status, 401);
  assert.equal((await absent.json() as { code: string }).code, "unauthorized");

  const wrongScope = await recordsGET(request("/api/agent/admin/v1/records", TASKS_SECRET));
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json() as { code: string }).code, "insufficient_scope");
});

test("the records route returns the documented envelope", async () => {
  const response = await recordsGET(request(
    `/api/agent/admin/v1/records?person_ids=${personA},${personB}`
      + "&sources=update,submitted_eod&from=2026-11-01&to=2026-11-02&q=checkout",
    RECORDS_SECRET,
  ));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    records: Array<{ id: string; personId: string; source: string; text: string }>;
    total: number;
    cursor: { next: string | null };
    coverage: string[];
  };
  assert.deepEqual(Object.keys(body).sort(), ["coverage", "cursor", "records", "total"]);
  assert.deepEqual(body.records.map((record) => record.id), [`submitted_eod:${eodCheckout}`, `update:${updateCheckout}`]);
  assert.equal(body.total, 2);
  assert.equal(body.cursor.next, null);
  assert.ok(body.coverage.some((line) => line === "Sources: update, submitted_eod."));
});

test("the records route answers a validation error for an unknown source", async () => {
  const response = await recordsGET(request("/api/agent/admin/v1/records?sources=chat", RECORDS_SECRET));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { code: string }).code, "validation_error");
});

test("the overview and insights routes require the insights scope", async () => {
  for (const [route, path] of [[overviewGET, "/api/agent/admin/v1/overview"], [insightsGET, "/api/agent/admin/v1/insights"]] as const) {
    const absent = await route(request(path));
    assert.equal(absent.status, 401, `${path} without a bearer`);
    const wrongScope = await route(request(path, TASKS_SECRET));
    assert.equal(wrongScope.status, 403, `${path} with the wrong scope`);
    assert.equal((await wrongScope.json() as { code: string }).code, "insufficient_scope");
  }
  const recordsScoped = await insightsGET(request("/api/agent/admin/v1/insights", RECORDS_SECRET));
  assert.equal(recordsScoped.status, 403, "records:read does not imply insights:read");
});

test("the insights route validates the range and hides a foreign person", async () => {
  const badRange = await insightsGET(request("/api/agent/admin/v1/insights?range=14d", INSIGHTS_SECRET));
  assert.equal(badRange.status, 400);
  assert.equal((await badRange.json() as { code: string }).code, "validation_error");

  const foreign = await insightsGET(request(
    `/api/agent/admin/v1/insights?person_id=${otherPerson}`,
    INSIGHTS_SECRET,
  ));
  assert.equal(foreign.status, 404);
  assert.equal((await foreign.json() as { code: string }).code, "not_found");
});

test("the overview route validates its date", async () => {
  const response = await overviewGET(request("/api/agent/admin/v1/overview?date=02-11-2026", INSIGHTS_SECRET));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { code: string }).code, "validation_error");
});
