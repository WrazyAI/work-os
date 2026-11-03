import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { GET as detailGET } from "../src/app/api/agent/admin/v1/eods/[reportId]/route";
import { GET as eodsGET } from "../src/app/api/agent/admin/v1/eods/route";
import { createDbClient } from "../src/lib/db/query";
import { adminAgentRouteError, requireAdminAgentAccess } from "../src/lib/work-admin-agent-auth";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import {
  AdminAgentInvalidCursorError,
  getAdminAgentEod,
  listAdminAgentEods,
  parseAdminAgentEodFilters,
  reviewAdminAgentEod,
  type AdminAgentEodFilters,
} from "../src/lib/work-admin-agent-eods";
import {
  adminAccess, adminMembership, adminUser, fixture, mappedAdminAccess, org, otherAdminUser,
  otherOrg, otherOrgAccess, otherPerson, personA, personB,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** The EOD list and detail run over the real PGlite pool; review runs through
 * `reviewWorkOsEod`, so the fixture installs the same query shim the app uses
 * and both paths execute their actual SQL. */

const eodA1 = "e0000000-0000-4000-8000-000000000001";
const approvedReportId = "e0000000-0000-4000-8000-000000000002";
const eodA3 = "e0000000-0000-4000-8000-000000000003";
const eodB1 = "e0000000-0000-4000-8000-000000000004";
const eodB2 = "e0000000-0000-4000-8000-000000000005";
const eodOther = "e0000000-0000-4000-8000-000000000006";
const versionA1Draft = "f0000000-0000-4000-8000-000000000001";
const versionA1Submission = "f0000000-0000-4000-8000-000000000002";
const versionA2Submission = "f0000000-0000-4000-8000-000000000003";
const versionA2Manager = "f0000000-0000-4000-8000-000000000004";
const versionB1Submission = "f0000000-0000-4000-8000-000000000005";

const EOD_READ_TOKEN = "90000000-0000-4000-8000-000000000021";
const PEOPLE_TOKEN = "90000000-0000-4000-8000-000000000022";
const OTHER_TOKEN = "90000000-0000-4000-8000-000000000023";
const EOD_READ_SECRET = "wos_admin_eods_route_read";
const PEOPLE_SECRET = "wos_admin_eods_route_people";
const OTHER_SECRET = "wos_admin_eods_route_other";

const defaults: AdminAgentEodFilters = {
  personIds: null,
  status: null,
  from: null,
  to: null,
  query: null,
  limit: 50,
  cursor: null,
};

let f: Awaited<ReturnType<typeof fixture>>;

async function insertToken(
  id: string,
  secret: string,
  scopes: string[],
  organizationId = org,
  userId = adminUser,
) {
  await f.db.query(
    `insert into work_agent_tokens
      (id, organization_id, person_id, user_id, kind, name, token_hash, token_prefix, scopes, expires_at)
     values ($1,$2,null,$3,'admin','eods route token',$4,$5,$6::text[], now() + interval '1 day')`,
    [id, organizationId, userId, hashAgentToken(secret), secret.slice(0, 12), scopes],
  );
}

const request = (pathname: string, secret?: string) =>
  new Request(`https://example.test${pathname}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

const detailRoute = (reportId: string, secret: string) =>
  detailGET(request(`/api/agent/admin/v1/eods/${reportId}`, secret), {
    params: Promise.resolve({ reportId }),
  });

/** Reports carry the review columns the real schema has and the shared fixture
 * does not model; the admin EOD surface reads and reviews them for real. */
async function seedEods() {
  await f.db.query(
    `insert into work_reports
      (id, organization_id, person_id, user_id, report_date, kind, status, title, markdown,
       submitted_markdown, submitted_at, metrics, missing_evidence, manager_notes,
       reviewed_by, reviewed_at, submission_idempotency_key, created_at, updated_at) values
      ($1,$7,$8,$9,'2026-10-30','eod','pending_review','Checkout shipped',
        '# Checkout shipped', '# Checkout shipped\n\nShipped the checkout flow.', '2026-10-30T17:00:02Z',
        '{"completed":3}'::jsonb, '[]'::jsonb, null, null, null, 'seed-eod-a1',
        '2026-10-30T17:00:00.100001Z','2026-10-30T17:00:02Z'),
      ($2,$7,$8,$9,'2026-10-29','eod','approved','Under_score cleanup',
        '# Under_score cleanup', '# Under_score cleanup\n\nRenamed under_score fields.', '2026-10-29T17:00:01Z',
        '{}'::jsonb, '[]'::jsonb, 'Thanks, approved.', $9, '2026-10-29T18:00:00Z', 'seed-eod-a2',
        '2026-10-29T17:00:00Z','2026-10-29T18:00:00Z'),
      ($3,$7,$8,$9,'2026-10-28','eod','draft','Draft planning notes',
        '# Draft planning notes', null, null,
        '{}'::jsonb, '[]'::jsonb, null, null, null, null,
        '2026-10-28T09:00:00Z','2026-10-28T09:00:00Z'),
      ($4,$7,$10,$9,'2026-10-30','eod','pending_review','Docs refresh',
        '# Docs refresh', '# Docs refresh\n\nUpdated the onboarding docs.', '2026-10-30T17:00:03Z',
        '{}'::jsonb, '[]'::jsonb, null, null, null, 'seed-eod-b1',
        '2026-10-30T17:00:00.200002Z','2026-10-30T17:00:03Z'),
      ($5,$7,$10,$9,'2026-10-31','eod','rejected','Percent % review',
        '# Percent % review', '# Percent % review\n\nNeeds more detail.', '2026-10-31T17:00:00Z',
        '{}'::jsonb, '[]'::jsonb, 'Please add detail.', $9, '2026-10-31T18:00:00Z', 'seed-eod-b2',
        '2026-10-31T17:00:00Z','2026-10-31T18:00:00Z'),
      ($6,$12,$11,$13,'2026-10-30','eod','pending_review','Other org secret',
        '# Other org secret', '# Other org secret', '2026-10-30T17:00:00Z',
        '{}'::jsonb, '[]'::jsonb, null, null, null, 'seed-eod-other',
        '2026-10-30T17:00:00Z','2026-10-30T17:00:00Z')`,
    [
      eodA1, approvedReportId, eodA3, eodB1, eodB2, eodOther, org, personA, adminUser,
      personB, otherPerson, otherOrg, otherAdminUser,
    ],
  );
  // A1 keeps its draft and its employee submission; A2 already carries the
  // submission and the manager edit an approved report has.
  await f.db.query(
    `insert into work_report_versions
      (id, organization_id, report_id, version_kind, markdown, created_by, created_at) values
      ($1,$2,$3,'draft','# Checkout shipped',null,'2026-10-30T09:00:00Z'),
      ($4,$2,$5,'employee_submission','# Checkout shipped\n\nShipped the checkout flow.',$6,'2026-10-30T17:00:02Z'),
      ($7,$2,$8,'employee_submission','# Under_score cleanup\n\nRenamed under_score fields.',$6,'2026-10-29T17:00:01Z'),
      ($9,$2,$8,'manager_edit','# Under_score cleanup\n\nRenamed under_score fields. Nice work.',$6,'2026-10-29T18:00:00Z'),
      ($10,$2,$11,'employee_submission','# Docs refresh\n\nUpdated the onboarding docs.',$6,'2026-10-30T17:00:03Z')`,
    [
      versionA1Draft, org, eodA1, versionA1Submission, eodA1, adminUser,
      versionA2Submission, approvedReportId, versionA2Manager, versionB1Submission, eodB1,
    ],
  );
}

before(async () => {
  f = await fixture();
  await f.seedDirectory();
  // The admin resolver and the review path read organization ownership and
  // profile metadata the fixture keeps out of its prerequisite set.
  await f.db.exec(`
    alter table work_organizations add column name text not null default 'Workspace';
    alter table work_organizations add column legacy_owner_id uuid;
    alter table work_organizations add column created_by uuid;
    alter table work_reports
      add column user_id uuid,
      add column metrics jsonb not null default '{}'::jsonb,
      add column missing_evidence jsonb not null default '[]'::jsonb,
      add column manager_notes text,
      add column reviewed_by uuid,
      add column reviewed_at timestamptz,
      add column submission_idempotency_key text;
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
      ($1, 'admin@example.com', 'Admin', 'member'),
      ($2, 'other-admin@example.com', 'Other Admin', 'member')`,
    [adminUser, otherAdminUser],
  );
  await f.db.query(
    `update work_organizations
     set feature_flags = '{"employee_companion":true,"admin_agent_api":true}'::jsonb,
       legacy_owner_id = case when id = $1 then $2::uuid else $3::uuid end,
       created_by = case when id = $1 then $2::uuid else $3::uuid end
     where id in ($1, $4)`,
    [org, adminUser, otherAdminUser, otherOrg],
  );
  // The admin has a membership person while its token stays unmapped: the
  // resolver must still know who the reviewer is. This is the shape that made
  // a token-only self-review check bypassable.
  await f.db.query(
    `update work_org_members set person_id = $1 where id = $2`,
    [personA, adminMembership],
  );
  await seedEods();
  await insertToken(EOD_READ_TOKEN, EOD_READ_SECRET, ["eods:read"]);
  await insertToken(PEOPLE_TOKEN, PEOPLE_SECRET, ["people:read"]);
  await insertToken(OTHER_TOKEN, OTHER_SECRET, ["eods:read"], otherOrg, otherAdminUser);
  (globalThis as unknown as { __workOsDbClient?: unknown }).__workOsDbClient = createDbClient();
});

after(async () => {
  delete (globalThis as unknown as { __workOsDbClient?: unknown }).__workOsDbClient;
  await f.close();
});

test("the eods routes need a bearer with eods:read", async () => {
  const absent = await eodsGET(request("/api/agent/admin/v1/eods"));
  assert.equal(absent.status, 401);
  assert.equal((await absent.json() as { code: string }).code, "unauthorized");

  const wrongScope = await eodsGET(request("/api/agent/admin/v1/eods", PEOPLE_SECRET));
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json() as { code: string }).code, "insufficient_scope");

  const detailWrongScope = await detailRoute(eodA1, PEOPLE_SECRET);
  assert.equal(detailWrongScope.status, 403);
  assert.equal((await detailWrongScope.json() as { code: string }).code, "insufficient_scope");
});

test("the eods route returns the documented envelope with per-status counts", async () => {
  const response = await eodsGET(request("/api/agent/admin/v1/eods", EOD_READ_SECRET));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    eods: Array<{ id: string; person: { id: string; displayName: string }; status: string; excerpt: string }>;
    counts: { pending_review: number; approved: number; rejected: number; total: number };
    total: number;
    cursor: { next: string | null };
  };
  assert.deepEqual(Object.keys(body).sort(), ["counts", "cursor", "eods", "total"]);
  assert.deepEqual(body.eods.map((eod) => eod.id), [
    eodB2, eodB1, eodA1, approvedReportId,
  ]);
  assert.deepEqual(body.eods[2].person, { id: personA, displayName: "Ada Lovelace" });
  assert.match(body.eods[2].excerpt, /^# Checkout shipped/);
  assert.deepEqual(body.counts, {
    pending_review: 2, approved: 1, rejected: 1, total: 4,
  });
  assert.equal(body.total, 4);
  assert.equal(body.cursor.next, null);
});

test("the eod list orders by report date then creation and honors each filter", async () => {
  const byPerson = await listAdminAgentEods(adminAccess, { ...defaults, personIds: [personA] });
  assert.deepEqual(byPerson.eods.map((eod) => eod.id), [eodA1, approvedReportId]);
  assert.equal(byPerson.total, 2);

  const byStatus = await listAdminAgentEods(adminAccess, { ...defaults, status: "pending_review" });
  assert.deepEqual(byStatus.eods.map((eod) => eod.id), [eodB1, eodA1]);
  assert.equal(byStatus.total, 2);
  // Counts stay per status: the status filter narrows rows, not the summary.
  assert.deepEqual(byStatus.counts, {
    pending_review: 2, approved: 1, rejected: 1, total: 4,
  });

  const byDate = await listAdminAgentEods(adminAccess, {
    ...defaults, from: "2026-10-30", to: "2026-10-30",
  });
  assert.deepEqual(byDate.eods.map((eod) => eod.id), [eodB1, eodA1]);
  assert.deepEqual(byDate.counts, {
    pending_review: 2, approved: 0, rejected: 0, total: 2,
  });
});

test("unsubmitted drafts stay out of the admin EOD surface", async () => {
  const page = await listAdminAgentEods(adminAccess, defaults);
  assert.ok(!page.eods.some((eod) => eod.id === eodA3));

  // Detail answers not-found for a draft, and no status filter can request one.
  assert.equal(await getAdminAgentEod(adminAccess, eodA3), null);
  assert.equal((await detailRoute(eodA3, EOD_READ_SECRET)).status, 404);
  assert.throws(
    () => parseAdminAgentEodFilters(new URLSearchParams("status=draft")),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  await assert.rejects(
    () => listAdminAgentEods(adminAccess, { ...defaults, status: "draft" as never }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  // A draft cannot be reviewed either; it is not waiting for a decision.
  await assert.rejects(
    () => reviewAdminAgentEod(adminAccess, eodA3, { status: "approved" }),
    (error: Error) => error.name === "WorkOsConflictError"
      && (error as Error & { reason?: string }).reason === "report_not_pending",
  );
});

test("the eod text search covers title, submission, and body with literal wildcards", async () => {
  const upper = await listAdminAgentEods(adminAccess, { ...defaults, query: "CHECKOUT" });
  assert.deepEqual(upper.eods.map((eod) => eod.id), [eodA1]);

  // The submission text is searchable even when the title would not match.
  const submitted = await listAdminAgentEods(adminAccess, { ...defaults, query: "onboarding" });
  assert.deepEqual(submitted.eods.map((eod) => eod.id), [eodB1]);

  // A bare wildcard stays a literal character instead of matching every row.
  const percent = await listAdminAgentEods(adminAccess, { ...defaults, query: "%" });
  assert.deepEqual(percent.eods.map((eod) => eod.id), [eodB2]);
  const underscore = await listAdminAgentEods(adminAccess, { ...defaults, query: "_" });
  assert.deepEqual(underscore.eods.map((eod) => eod.id), [approvedReportId]);
});

test("an empty person list is no rows, not the whole team", async () => {
  const page = await listAdminAgentEods(adminAccess, { ...defaults, personIds: [] });
  assert.deepEqual(page.eods, []);
  assert.equal(page.total, 0);
  assert.equal(page.nextCursor, null);
  // Counts describe the same filters, so an empty person list counts nothing.
  assert.deepEqual(page.counts, {
    pending_review: 0, approved: 0, rejected: 0, total: 0,
  });
});

test("the eod list never returns another organization's reports", async () => {
  const page = await listAdminAgentEods(adminAccess, defaults);
  assert.ok(!page.eods.some((eod) => eod.id === eodOther));

  const otherPage = await listAdminAgentEods(otherOrgAccess, defaults);
  assert.deepEqual(otherPage.eods.map((eod) => eod.id), [eodOther]);

  // A named person from the other organization is simply not in this tenant.
  const crossOrg = await listAdminAgentEods(adminAccess, { ...defaults, personIds: [otherPerson] });
  assert.deepEqual(crossOrg.eods, []);
});

test("the cursor walks the list without gaps and keeps full precision", async () => {
  const first = await listAdminAgentEods(adminAccess, { ...defaults, limit: 2 });
  assert.deepEqual(first.eods.map((eod) => eod.id), [eodB2, eodB1]);
  assert.equal(first.total, 4);
  assert.ok(first.nextCursor);
  const encoded = JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8")) as {
    reportDate: string; createdAt: string;
  };
  assert.equal(encoded.reportDate, "2026-10-30");
  assert.equal(encoded.createdAt, "2026-10-30T17:00:00.200002Z");

  const walked: string[] = first.eods.map((eod) => eod.id);
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const page = await listAdminAgentEods(adminAccess, { ...defaults, limit: 2, cursor });
    walked.push(...page.eods.map((eod) => eod.id));
    cursor = page.nextCursor;
  }
  assert.deepEqual(walked, [eodB2, eodB1, eodA1, approvedReportId]);
});

test("a malformed or stale cursor is invalid_cursor", async () => {
  await assert.rejects(
    () => listAdminAgentEods(adminAccess, { ...defaults, cursor: "not-a-cursor" }),
    (error: Error) => error.name === "AdminAgentInvalidCursorError",
  );

  const first = await listAdminAgentEods(adminAccess, { ...defaults, limit: 1 });
  assert.ok(first.nextCursor);

  // A cursor with a nonsense timestamp is rejected before the Postgres cast.
  const badTimestamp = Buffer.from(JSON.stringify({
    reportDate: "2026-10-30", createdAt: "yesterday", id: eodA1, filters: "anything",
  }), "utf8").toString("base64url");
  await assert.rejects(
    () => listAdminAgentEods(adminAccess, { ...defaults, cursor: badTimestamp }),
    AdminAgentInvalidCursorError,
  );

  await assert.rejects(
    () => listAdminAgentEods(adminAccess, {
      ...defaults, limit: 1, cursor: first.nextCursor, status: "approved",
    }),
    AdminAgentInvalidCursorError,
  );

  const response = adminAgentRouteError(new AdminAgentInvalidCursorError("EOD cursor is invalid"));
  assert.equal(response.status, 422);
  assert.equal((await response.json() as { code: string }).code, "invalid_cursor");
});

test("the eod list rejects bad filters before querying", async () => {
  const tooMany = Array.from({ length: 21 }, (_, index) =>
    `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  await assert.rejects(
    () => listAdminAgentEods(adminAccess, { ...defaults, personIds: tooMany }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  await assert.rejects(
    () => listAdminAgentEods(adminAccess, { ...defaults, personIds: ["not-a-uuid"] }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  await assert.rejects(
    () => listAdminAgentEods(adminAccess, { ...defaults, from: "October" }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
});

test("query parameters default to the whole organization and reject bad input", () => {
  assert.deepEqual(parseAdminAgentEodFilters(new URLSearchParams("")), defaults);

  const named = parseAdminAgentEodFilters(new URLSearchParams(
    `person_ids=${personA},${personB}&status=pending_review&from=2026-10-01`
    + "&to=2026-10-31&q=%20checkout%20&limit=5&cursor=abc",
  ));
  assert.deepEqual(named, {
    personIds: [personA, personB], status: "pending_review", from: "2026-10-01",
    to: "2026-10-31", query: "checkout", limit: 5, cursor: "abc",
  });

  // An explicit empty person list stays explicit rather than becoming the team.
  assert.deepEqual(parseAdminAgentEodFilters(new URLSearchParams("person_ids=")).personIds, []);
  assert.deepEqual(parseAdminAgentEodFilters(new URLSearchParams("person_ids=,,")).personIds, []);
  assert.equal(parseAdminAgentEodFilters(new URLSearchParams("q=%20%20")).query, null);
  assert.equal(parseAdminAgentEodFilters(new URLSearchParams("limit=5000")).limit, 100);
  assert.equal(parseAdminAgentEodFilters(new URLSearchParams("status=")).status, null);

  for (const bad of [
    "person_ids=not-a-uuid",
    `person_ids=${Array.from({ length: 21 }, (_, index) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`).join(",")}`,
    `person_ids=${Array.from({ length: 21 }, () => personA).join(",")}`,
    "status=open",
    "status=draft",
    "from=soon",
    "to=2026-02-30",
    "limit=zero",
  ]) {
    assert.throws(
      () => parseAdminAgentEodFilters(new URLSearchParams(bad)),
      (error: Error) => error.name === "WorkOsValidationError",
      bad,
    );
  }
});

test("detail returns the report, its person, and its versions oldest first", async () => {
  const result = await getAdminAgentEod(adminAccess, eodA1);
  assert.ok(result);
  assert.equal(result.eod.id, eodA1);
  assert.deepEqual(result.eod.person, { id: personA, displayName: "Ada Lovelace" });
  assert.equal(result.eod.status, "pending_review");
  assert.equal(result.eod.reportDate, "2026-10-30");
  assert.equal(result.eod.submittedMarkdown, "# Checkout shipped\n\nShipped the checkout flow.");
  assert.equal(result.eod.markdown, "# Checkout shipped");
  assert.deepEqual(result.eod.metrics, { completed: 3 });
  // Only the versions a reviewer was allowed to see: the employee submission.
  // The pre-submission draft is employee-private and stays out.
  assert.deepEqual(result.versions.map((version) => version.id), [versionA1Submission]);
  assert.deepEqual(result.versions.map((version) => version.versionKind), [
    "employee_submission",
  ]);
  assert.ok(!result.versions.some((version) => version.id === versionA1Draft));
  assert.ok(!result.versions.some((version) => version.markdown === "# Checkout shipped"));

  const approved = await getAdminAgentEod(adminAccess, approvedReportId);
  assert.ok(approved);
  assert.equal(approved.eod.managerNotes, "Thanks, approved.");
  assert.equal(approved.eod.reviewedBy, adminUser);
  assert.deepEqual(approved.versions.map((version) => version.versionKind), [
    "employee_submission", "manager_edit",
  ]);
});

test("detail answers null across organizations and for an unknown id", async () => {
  assert.equal(await getAdminAgentEod(otherOrgAccess, eodA1), null);
  assert.equal(await getAdminAgentEod(adminAccess, eodOther), null);
  assert.equal(await getAdminAgentEod(adminAccess, "not-a-uuid"), null);
  assert.equal(
    await getAdminAgentEod(adminAccess, "e0000000-0000-4000-8000-0000000000ff"),
    null,
  );
});

test("the detail route returns the envelope and 404s outside the tenant", async () => {
  const response = await detailRoute(eodA1, EOD_READ_SECRET);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    eod: { id: string; person: { displayName: string } };
    versions: Array<{ versionKind: string }>;
  };
  assert.deepEqual(Object.keys(body).sort(), ["eod", "versions"]);
  assert.equal(body.eod.id, eodA1);
  assert.equal(body.eod.person.displayName, "Ada Lovelace");
  assert.deepEqual(body.versions.map((version) => version.versionKind), [
    "employee_submission",
  ]);

  const crossOrg = await detailRoute(eodA1, OTHER_SECRET);
  assert.equal(crossOrg.status, 404);
  assert.equal((await crossOrg.json() as { code: string }).code, "not_found");

  const unknown = await detailRoute("not-a-uuid", EOD_READ_SECRET);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json() as { code: string }).code, "not_found");
});

test("the eods route answers invalid_cursor with its own code", async () => {
  const response = await eodsGET(request(
    "/api/agent/admin/v1/eods?cursor=not-a-cursor",
    EOD_READ_SECRET,
  ));
  assert.equal(response.status, 422);
  assert.equal((await response.json() as { code: string }).code, "invalid_cursor");
});

test("review refuses a report the admin owns and one already decided", async () => {
  await assert.rejects(
    () => reviewAdminAgentEod(mappedAdminAccess, eodA1, { status: "approved" }),
    (error: Error) => error.name === "WorkOsForbiddenError",
  );
  await assert.rejects(
    () => reviewAdminAgentEod(adminAccess, approvedReportId, { status: "approved" }),
    (error: Error) => error.name === "WorkOsConflictError"
      && (error as Error & { reason?: string }).reason === "report_not_pending",
  );
});

test("an unmapped admin token cannot review its membership person's own EOD", async () => {
  const resolved = await requireAdminAgentAccess(
    request("/api/agent/admin/v1/eods", EOD_READ_SECRET),
    "eods:read",
  );
  assert.ok(resolved.agent, "the seeded admin token must resolve");
  // The token itself carries no person; the membership does.
  assert.equal(resolved.agent.access.personId, null);
  assert.equal(resolved.agent.reviewerPersonId, personA);

  // Without the resolved reviewer person the wrapper only sees the token's null
  // mapping; with it, the report person is the reviewer's own person.
  await assert.rejects(
    () => reviewAdminAgentEod(
      resolved.agent.access,
      eodA1,
      { status: "approved" },
      resolved.agent.reviewerPersonId,
    ),
    (error: Error) => error.name === "WorkOsForbiddenError"
      && /cannot review your own/i.test(error.message),
  );

  // The refusal is a read, not a decision: the report is still waiting.
  const detail = await getAdminAgentEod(adminAccess, eodA1);
  assert.equal(detail?.eod.status, "pending_review");
});

test("review answers not-found across organizations and for an unknown report", async () => {
  await assert.rejects(
    () => reviewAdminAgentEod(adminAccess, eodOther, { status: "approved" }),
    (error: Error) => error.name === "WorkOsNotFoundError",
  );
  await assert.rejects(
    () => reviewAdminAgentEod(adminAccess, "not-a-uuid", { status: "approved" }),
    (error: Error) => error.name === "WorkOsNotFoundError",
  );
  await assert.rejects(
    () => reviewAdminAgentEod(adminAccess, eodB1, { status: "pending" as never }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
});

test("review decides a pending report and preserves the employee submission", async () => {
  // Task 13's review route resolves the admin token and passes the reviewer
  // person alongside the access, exactly as this call does.
  const resolved = await requireAdminAgentAccess(
    request("/api/agent/admin/v1/eods", EOD_READ_SECRET),
    "eods:read",
  );
  assert.ok(resolved.agent);
  const reviewed = await reviewAdminAgentEod(
    resolved.agent.access,
    eodB1,
    {
      status: "approved",
      manager_notes: "Clear and well evidenced.",
      markdown: "# Docs refresh\n\nUpdated the onboarding docs. Nice work.",
    },
    resolved.agent.reviewerPersonId,
  );
  assert.equal(reviewed.status, "approved");
  assert.equal(reviewed.manager_notes, "Clear and well evidenced.");
  assert.equal(reviewed.reviewed_by, adminUser);
  // The employee's own words survive the manager edit.
  assert.equal(reviewed.submitted_markdown, "# Docs refresh\n\nUpdated the onboarding docs.");
  assert.equal(reviewed.markdown, "# Docs refresh\n\nUpdated the onboarding docs. Nice work.");

  const detail = await getAdminAgentEod(adminAccess, eodB1);
  assert.ok(detail);
  assert.deepEqual(detail.versions.map((version) => version.versionKind), [
    "employee_submission", "manager_edit",
  ]);
  assert.equal(detail.versions[0].markdown, "# Docs refresh\n\nUpdated the onboarding docs.");
  assert.equal(
    detail.versions[1].markdown,
    "# Docs refresh\n\nUpdated the onboarding docs. Nice work.",
  );

  const audit = await f.db.query<{ action: string; metadata: Record<string, unknown> }>(
    `select action, metadata from work_audit_log
     where organization_id = $1 and target_id = $2 order by id`,
    [org, eodB1],
  );
  assert.deepEqual(audit.rows.map((row) => row.action), ["report.approved"]);
  assert.deepEqual(audit.rows[0].metadata, {
    personId: personB,
    employeeSubmissionPreserved: true,
  });

  // A decided report cannot be decided twice.
  await assert.rejects(
    () => reviewAdminAgentEod(adminAccess, eodB1, { status: "rejected" }),
    (error: Error) => error.name === "WorkOsConflictError",
  );
});

test("a decision that loses the conditional update is a conflict, not a 500", async () => {
  const raceReportId = "e0000000-0000-4000-8000-000000000007";
  await f.db.query(
    `insert into work_reports
      (id, organization_id, person_id, user_id, report_date, kind, status, title, markdown,
       submitted_markdown, submitted_at, created_at, updated_at)
     values ($1,$2,$3,$4,'2026-10-27','eod','pending_review','Race report',
       '# Race report', '# Race report', '2026-10-27T17:00:00Z',
       '2026-10-27T17:00:00Z','2026-10-27T17:00:00Z')`,
    [raceReportId, org, personA, adminUser],
  );

  // Simulate a concurrent reviewer winning between this call's pre-check read
  // and the shared service's conditional update: the competing decision commits
  // immediately before that UPDATE statement runs.
  const pool = globalThis.__workOsPgPool as unknown as {
    query: (sql: string, values?: unknown[]) => Promise<unknown>;
  };
  const originalQuery = pool.query;
  let raced = false;
  pool.query = async (sql: string, values?: unknown[]) => {
    if (
      !raced
      && /^UPDATE "work_reports" SET/i.test(sql.trim())
      && (values ?? []).includes(raceReportId)
    ) {
      raced = true;
      await originalQuery.call(pool, "update work_reports set status = 'approved' where id = $1", [raceReportId]);
    }
    return originalQuery.call(pool, sql, values);
  };
  let failure: Error | null = null;
  try {
    await reviewAdminAgentEod(adminAccess, raceReportId, { status: "approved" });
  } catch (error) {
    failure = error as Error;
  } finally {
    pool.query = originalQuery;
  }

  assert.equal(raced, true, "the conditional update must have lost the race");
  assert.ok(failure, "the lost race must reject");
  assert.equal(failure.name, "WorkOsConflictError");
  assert.equal((failure as Error & { reason?: string }).reason, "report_not_pending");
  assert.match(failure.message, /no longer pending review/i);

  // The route contract answers 409 with its own code, never a 500.
  const response = adminAgentRouteError(failure);
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { code: string }).code, "report_not_pending");

  // The competing decision stands and this call wrote nothing.
  const row = await f.db.query<{ status: string; reviewed_by: string | null }>(
    "select status, reviewed_by from work_reports where id = $1",
    [raceReportId],
  );
  assert.equal(row.rows[0].status, "approved");
  assert.notEqual(row.rows[0].reviewed_by, adminUser);
});
