import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { GET as activityGET } from "../src/app/api/agent/admin/v1/tasks/[taskId]/activity/route";
import { GET as detailGET } from "../src/app/api/agent/admin/v1/tasks/[taskId]/route";
import { GET as tasksGET } from "../src/app/api/agent/admin/v1/tasks/route";
import { createDbClient } from "../src/lib/db/query";
import { adminAgentRouteError } from "../src/lib/work-admin-agent-auth";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import {
  AdminAgentInvalidCursorError,
  listAdminAgentTasks,
  parseAdminAgentTaskFilters,
} from "../src/lib/work-admin-agent-tasks";
import {
  adminAccess, adminUser, checkoutBlocker, checkoutEvent, checkoutEvidence,
  fixture, org, otherAdminUser, otherOrg, otherOrgAccess, otherPerson, otherTask,
  personA, personB, personC, projectApp, taskArchived, taskCheckout,
  taskCheckoutDone, taskCheckoutReview, taskDeleted, taskDocumentation,
  taskDueToday, taskOverdue, taskOverdueDone, taskPercent, taskShared,
  taskSubtask, taskUnderscore,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** The list runs over the real PGlite pool. Detail, activity, and the route
 * tests also run for real: the fixture installs the same query shim the app
 * uses, so the employee readers execute their actual SQL against PGlite. The
 * fixture is read-only here, so one instance serves every test. */

const TODAY = "2026-11-02";

const defaults = {
  personIds: [personA, personB] as string[] | null,
  query: null as string | null,
  completed: null as boolean | null,
  overdue: null as boolean | null,
  status: "active" as "active" | "archived" | "deleted" | null,
  projectId: null as string | null,
  dueFrom: null as string | null,
  dueTo: null as string | null,
  updatedSince: null as string | null,
  limit: 50,
  cursor: null as string | null,
};

const READ_TOKEN = "90000000-0000-4000-8000-000000000011";
const PEOPLE_TOKEN = "90000000-0000-4000-8000-000000000012";
const OTHER_TOKEN = "90000000-0000-4000-8000-000000000013";
const READ_SECRET = "wos_admin_tasks_route_read";
const PEOPLE_SECRET = "wos_admin_tasks_route_people";
const OTHER_SECRET = "wos_admin_tasks_route_other";

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
     values ($1,$2,null,$3,'admin','tasks route token',$4,$5,$6::text[], now() + interval '1 day')`,
    [id, organizationId, userId, hashAgentToken(secret), secret.slice(0, 12), scopes],
  );
}

const request = (pathname: string, secret?: string) =>
  new Request(`https://example.test${pathname}`, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });

const detailRoute = (taskId: string, secret: string) =>
  detailGET(request(`/api/agent/admin/v1/tasks/${taskId}`, secret), {
    params: Promise.resolve({ taskId }),
  });

const activityRoute = (taskId: string, secret: string, query = "") =>
  activityGET(request(`/api/agent/admin/v1/tasks/${taskId}/activity${query}`, secret), {
    params: Promise.resolve({ taskId }),
  });

before(async () => {
  f = await fixture();
  await f.seedDirectory();
  await f.seedTasks();
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
  await insertToken(READ_TOKEN, READ_SECRET, ["tasks:read"]);
  await insertToken(PEOPLE_TOKEN, PEOPLE_SECRET, ["people:read"]);
  await insertToken(OTHER_TOKEN, OTHER_SECRET, ["tasks:read"], otherOrg, otherAdminUser);
  // Same query shim the deployed app uses, executing on the fixture pool.
  (globalThis as unknown as { __workOsDbClient?: unknown }).__workOsDbClient = createDbClient();
});

after(async () => {
  delete (globalThis as unknown as { __workOsDbClient?: unknown }).__workOsDbClient;
  await f.close();
});

test("the tasks route needs a bearer with tasks:read", async () => {
  const absent = await tasksGET(request("/api/agent/admin/v1/tasks"));
  assert.equal(absent.status, 401);
  assert.equal((await absent.json() as { code: string }).code, "unauthorized");

  const wrongScope = await tasksGET(request("/api/agent/admin/v1/tasks", PEOPLE_SECRET));
  assert.equal(wrongScope.status, 403);
  assert.equal((await wrongScope.json() as { code: string }).code, "insufficient_scope");
});

test("the tasks route returns the documented envelope with capabilities", async () => {
  const response = await tasksGET(request(
    `/api/agent/admin/v1/tasks?person_ids=${personA},${personB}&completed=false&limit=2`,
    READ_SECRET,
  ));
  assert.equal(response.status, 200);
  const body = await response.json() as {
    tasks: Array<{ id: string; capabilities: { canEdit: boolean; overdue: boolean } }>;
    total: number;
    cursor: { next: string | null };
  };
  assert.deepEqual(Object.keys(body).sort(), ["cursor", "tasks", "total"]);
  assert.deepEqual(body.tasks.map((task) => task.id), [taskCheckoutReview, taskCheckout]);
  assert.equal(body.total, 6);
  assert.ok(body.cursor.next);
  // Admin capabilities are computed from the token's role, not a person map.
  assert.equal(body.tasks[0].capabilities.canEdit, true);
  assert.equal(typeof body.tasks[0].capabilities.overdue, "boolean");
});

test("the tasks route answers invalid_cursor for a malformed or stale cursor", async () => {
  const malformed = await tasksGET(request(
    "/api/agent/admin/v1/tasks?cursor=not-a-cursor",
    READ_SECRET,
  ));
  assert.equal(malformed.status, 422);
  assert.equal((await malformed.json() as { code: string }).code, "invalid_cursor");

  // An explicit empty person list still validates the cursor first.
  const emptyWithCursor = await tasksGET(request(
    "/api/agent/admin/v1/tasks?person_ids=&cursor=not-a-cursor",
    READ_SECRET,
  ));
  assert.equal(emptyWithCursor.status, 422);
  assert.equal((await emptyWithCursor.json() as { code: string }).code, "invalid_cursor");

  const first = await tasksGET(request("/api/agent/admin/v1/tasks?limit=1", READ_SECRET));
  const { cursor } = await first.json() as { cursor: { next: string } };
  assert.ok(cursor.next);
  const stale = await tasksGET(request(
    `/api/agent/admin/v1/tasks?limit=1&q=checkout&cursor=${cursor.next}`,
    READ_SECRET,
  ));
  assert.equal(stale.status, 422);
  assert.equal((await stale.json() as { code: string }).code, "invalid_cursor");
});

test("the tasks route rejects a non-boolean overdue value", async () => {
  const response = await tasksGET(request("/api/agent/admin/v1/tasks?overdue=maybe", READ_SECRET));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { code: string }).code, "validation_error");
});

test("detail returns another person's task with subtasks and completion evidence", async () => {
  const response = await detailRoute(taskCheckout, READ_SECRET);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    task: { id: string; title: string };
    subtasks: Array<{ id: string; title: string }>;
    completionEvidence: Array<{ id: string; title: string }>;
  };
  assert.deepEqual(Object.keys(body).sort(), ["completionEvidence", "subtasks", "task"]);
  assert.equal(body.task.id, taskCheckout);
  assert.equal(body.task.title, "Fix checkout");
  assert.deepEqual(body.subtasks.map((task) => task.id), [taskSubtask]);
  assert.deepEqual(body.completionEvidence.map((evidence) => evidence.id), [checkoutEvidence]);
});

test("detail answers 404 across organizations and for a tombstone", async () => {
  const crossOrg = await detailRoute(taskCheckout, OTHER_SECRET);
  assert.equal(crossOrg.status, 404);
  assert.equal((await crossOrg.json() as { code: string }).code, "not_found");

  const deleted = await detailRoute(taskDeleted, READ_SECRET);
  assert.equal(deleted.status, 404);
  assert.equal((await deleted.json() as { code: string }).code, "not_found");
});

test("admin detail keeps archived work readable", async () => {
  const response = await detailRoute(taskArchived, READ_SECRET);
  assert.equal(response.status, 200);
  const body = await response.json() as { task: { id: string; status: string } };
  assert.equal(body.task.id, taskArchived);
  assert.equal(body.task.status, "archived");
});

test("activity returns the merged timeline for an in-organization task", async () => {
  const response = await activityRoute(taskCheckout, READ_SECRET);
  assert.equal(response.status, 200);
  const body = await response.json() as {
    items: Array<{ id: string; kind: string; actor: string; at: string }>;
    cursor: { next: string | null };
  };
  assert.deepEqual(body.items.map((item) => item.kind), [
    "blocker.opened", "task.status_changed", "evidence.completion",
  ]);
  assert.equal(body.items[0].id, `blocker:${checkoutBlocker}`);
  assert.equal(body.items[1].id, `task_event:${checkoutEvent}`);
  assert.equal(body.items[2].id, `evidence:${checkoutEvidence}`);
  assert.deepEqual(body.items.map((item) => item.actor), ["employee", "employee", "employee"]);
  assert.equal(body.cursor.next, null);

  const crossOrg = await activityRoute(taskCheckout, OTHER_SECRET);
  assert.equal(crossOrg.status, 404);
  const deleted = await activityRoute(taskDeleted, READ_SECRET);
  assert.equal(deleted.status, 404);
  assert.equal((await deleted.json() as { code: string }).code, "not_found");
});

test("activity keeps an archived task's timeline readable", async () => {
  const response = await activityRoute(taskArchived, READ_SECRET);
  assert.equal(response.status, 200);
  const body = await response.json() as { items: unknown[] };
  assert.deepEqual(body.items, []);
});

test("person_ids, text, completion, project, and due filters compose", async () => {
  const page = await listAdminAgentTasks(adminAccess, {
    personIds: [personA, personB], query: "checkout", completed: false,
    status: "active", projectId: null, dueFrom: "2026-11-01", dueTo: "2026-11-30",
    updatedSince: null, limit: 50, cursor: null, overdue: null,
  });
  assert.deepEqual(page.tasks.map((t) => t.title), ["Fix checkout"]);
  assert.equal(page.total, 1);
});

test("each filter narrows the cross-person list on its own", async () => {
  const byPerson = await listAdminAgentTasks(adminAccess, { ...defaults, personIds: [personA] });
  assert.deepEqual(byPerson.tasks.map((t) => t.id), [
    taskCheckout, taskPercent, taskUnderscore, taskShared, taskDocumentation,
  ]);
  assert.equal(byPerson.total, 5);

  const byProject = await listAdminAgentTasks(adminAccess, { ...defaults, projectId: projectApp });
  assert.deepEqual(byProject.tasks.map((t) => t.id), [taskCheckout, taskCheckoutDone, taskShared]);

  const byDue = await listAdminAgentTasks(adminAccess, {
    ...defaults, completed: false, dueFrom: "2026-11-01", dueTo: "2026-11-30",
  });
  assert.deepEqual(byDue.tasks.map((t) => t.id), [
    taskCheckout, taskPercent, taskUnderscore, taskShared,
  ]);

  const byCompletion = await listAdminAgentTasks(adminAccess, { ...defaults, completed: true });
  assert.deepEqual(byCompletion.tasks.map((t) => t.id), [taskCheckoutDone]);
});

test("the text search ignores case, escapes LIKE wildcards, and matches project names", async () => {
  const upper = await listAdminAgentTasks(adminAccess, { ...defaults, query: "CHECKOUT" });
  assert.deepEqual(upper.tasks.map((t) => t.id), [taskCheckoutReview, taskCheckout, taskCheckoutDone]);

  // A bare wildcard stays a literal character instead of matching every row.
  const percent = await listAdminAgentTasks(adminAccess, { ...defaults, query: "%" });
  assert.deepEqual(percent.tasks.map((t) => t.id), [taskPercent]);
  const underscore = await listAdminAgentTasks(adminAccess, { ...defaults, query: "_" });
  assert.deepEqual(underscore.tasks.map((t) => t.id), [taskUnderscore]);

  const description = await listAdminAgentTasks(adminAccess, { ...defaults, query: "next release" });
  assert.deepEqual(description.tasks.map((t) => t.id), [taskPercent]);

  // No task title or description says "Website"; the project name is the match.
  const project = await listAdminAgentTasks(adminAccess, { ...defaults, query: "website" });
  assert.deepEqual(project.tasks.map((t) => t.id), [
    taskCheckoutReview, taskPercent, taskDocumentation,
  ]);
  for (const task of project.tasks) {
    assert.doesNotMatch(String(task.title).toLowerCase(), /website/);
    assert.doesNotMatch(String(task.description ?? "").toLowerCase(), /website/);
  }
  // The join stays organization-scoped: another tenant's project never matches.
  const other = await listAdminAgentTasks(otherOrgAccess, {
    ...defaults, personIds: null, query: "website",
  });
  assert.deepEqual(other.tasks, []);
});

test("overdue uses the effective due date against the admin's local today", async () => {
  const overdueOnly = await listAdminAgentTasks(
    adminAccess, { ...defaults, personIds: [personC], overdue: true }, { today: TODAY },
  );
  assert.deepEqual(overdueOnly.tasks.map((t) => t.id), [taskOverdue]);

  const notOverdue = await listAdminAgentTasks(
    adminAccess, { ...defaults, personIds: [personC], overdue: false }, { today: TODAY },
  );
  // The due-today task is not overdue yet; a completed past-due task never is.
  assert.deepEqual(notOverdue.tasks.map((t) => t.id), [taskDueToday, taskOverdueDone]);

  const omitted = await listAdminAgentTasks(
    adminAccess, { ...defaults, personIds: [personC] }, { today: TODAY },
  );
  assert.deepEqual(omitted.tasks.map((t) => t.id), [taskOverdue, taskDueToday, taskOverdueDone]);

  // Moving the reference day moves the boundary: due today is not overdue.
  const beforeDue = await listAdminAgentTasks(
    adminAccess, { ...defaults, personIds: [personC], overdue: true }, { today: "2026-11-01" },
  );
  assert.deepEqual(beforeDue.tasks, []);

  // The overdue cursor is bound to the day it was minted for.
  const first = await listAdminAgentTasks(
    adminAccess, { ...defaults, personIds: [personC], overdue: false, limit: 1 }, { today: TODAY },
  );
  assert.ok(first.nextCursor);
  await assert.rejects(
    () => listAdminAgentTasks(
      adminAccess,
      { ...defaults, personIds: [personC], overdue: false, limit: 1, cursor: first.nextCursor },
      { today: "2026-11-03" },
    ),
    (error: Error) => error.name === "AdminAgentInvalidCursorError",
  );
});

test("status defaults to active and can name the archive or the tombstone", async () => {
  const active = await listAdminAgentTasks(adminAccess, defaults);
  assert.ok(!active.tasks.some((task) => task.id === taskArchived || task.id === taskDeleted));
  assert.equal(active.total, 7);

  const archived = await listAdminAgentTasks(adminAccess, { ...defaults, status: "archived" });
  assert.deepEqual(archived.tasks.map((t) => t.id), [taskArchived]);
  const deleted = await listAdminAgentTasks(adminAccess, { ...defaults, status: "deleted" });
  assert.deepEqual(deleted.tasks.map((t) => t.id), [taskDeleted]);
});

test("an empty person list is no rows, not the whole team", async () => {
  const page = await listAdminAgentTasks(adminAccess, { ...defaults, personIds: [] });
  assert.deepEqual(page.tasks, []);
  assert.equal(page.total, 0);
  assert.equal(page.nextCursor, null);
});

test("the list never returns another organization's tasks", async () => {
  const page = await listAdminAgentTasks(adminAccess, { ...defaults, personIds: null });
  assert.ok(!page.tasks.some((task) => task.id === otherTask));

  const otherPage = await listAdminAgentTasks(otherOrgAccess, { ...defaults, personIds: null });
  assert.deepEqual(otherPage.tasks.map((t) => t.id), [otherTask]);

  // A named person from the other organization is simply not in this tenant.
  const crossOrg = await listAdminAgentTasks(adminAccess, { ...defaults, personIds: [otherPerson] });
  assert.deepEqual(crossOrg.tasks, []);
});

test("the cursor walks the list without gaps and keeps the total", async () => {
  const first = await listAdminAgentTasks(adminAccess, { ...defaults, limit: 2 });
  assert.deepEqual(first.tasks.map((t) => t.id), [taskCheckoutReview, taskCheckout]);
  assert.equal(first.total, 7);
  assert.ok(first.nextCursor);
  // Microseconds survive the cursor: truncating to milliseconds could skip a
  // row that changed inside the same millisecond as the page boundary.
  const encoded = JSON.parse(Buffer.from(first.nextCursor, "base64url").toString("utf8")) as { updatedAt: string };
  assert.equal(encoded.updatedAt, "2026-11-02T10:00:00.123456Z");

  const second = await listAdminAgentTasks(adminAccess, {
    ...defaults, limit: 2, cursor: first.nextCursor,
  });
  assert.deepEqual(second.tasks.map((t) => t.id), [taskCheckoutDone, taskPercent]);
  assert.equal(second.total, 7);
  assert.ok(second.nextCursor);

  const walked: string[] = [...first.tasks, ...second.tasks].map((task) => String(task.id));
  let cursor: string | null = second.nextCursor;
  while (cursor) {
    const page = await listAdminAgentTasks(adminAccess, { ...defaults, limit: 2, cursor });
    walked.push(...page.tasks.map((task) => String(task.id)));
    cursor = page.nextCursor;
  }
  assert.deepEqual(walked, [
    taskCheckoutReview, taskCheckout, taskCheckoutDone, taskPercent,
    taskUnderscore, taskShared, taskDocumentation,
  ]);
});

test("updated_since replays changed rows in ascending order", async () => {
  const page = await listAdminAgentTasks(adminAccess, {
    ...defaults, updatedSince: "2026-11-01T00:00:00Z",
  });
  assert.deepEqual(page.tasks.map((t) => t.id), [
    taskShared, taskUnderscore, taskPercent, taskCheckoutDone, taskCheckout, taskCheckoutReview,
  ]);
  const stamps = page.tasks.map((task) => String(task.updated_at));
  assert.deepEqual(stamps, [...stamps].sort());

  const first = await listAdminAgentTasks(adminAccess, {
    ...defaults, updatedSince: "2026-11-01T00:00:00Z", limit: 2,
  });
  const second = await listAdminAgentTasks(adminAccess, {
    ...defaults, updatedSince: "2026-11-01T00:00:00Z", limit: 2, cursor: first.nextCursor,
  });
  assert.deepEqual(first.tasks.map((t) => t.id), [taskShared, taskUnderscore]);
  assert.deepEqual(second.tasks.map((t) => t.id), [taskPercent, taskCheckoutDone]);
});

test("a malformed cursor is an invalid cursor, even with an empty person list", async () => {
  await assert.rejects(
    () => listAdminAgentTasks(adminAccess, { ...defaults, cursor: "not-a-cursor" }),
    (error: Error) => error.name === "AdminAgentInvalidCursorError",
  );
  await assert.rejects(
    () => listAdminAgentTasks(adminAccess, { ...defaults, personIds: [], cursor: "not-a-cursor" }),
    (error: Error) => error.name === "AdminAgentInvalidCursorError",
  );
});

test("changing the filters invalidates the cursor with invalid_cursor", async () => {
  const first = await listAdminAgentTasks(adminAccess, { ...defaults, limit: 1 });
  assert.ok(first.nextCursor);

  await assert.rejects(
    () => listAdminAgentTasks(adminAccess, { ...defaults, limit: 1, cursor: first.nextCursor, query: "checkout" }),
    AdminAgentInvalidCursorError,
  );
  // A descending cursor cannot be spent on the ascending change feed.
  await assert.rejects(
    () => listAdminAgentTasks(adminAccess, {
      ...defaults, limit: 1, cursor: first.nextCursor, updatedSince: "2026-11-01T00:00:00Z",
    }),
    AdminAgentInvalidCursorError,
  );

  const response = adminAgentRouteError(new AdminAgentInvalidCursorError());
  assert.equal(response.status, 422);
  assert.equal((await response.json() as { code: string }).code, "invalid_cursor");
});

test("the list rejects bad filters before querying", async () => {
  const tooMany = Array.from({ length: 21 }, (_, index) =>
    `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  await assert.rejects(
    () => listAdminAgentTasks(adminAccess, { ...defaults, personIds: tooMany }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  await assert.rejects(
    () => listAdminAgentTasks(adminAccess, { ...defaults, personIds: ["not-a-uuid"] }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
  await assert.rejects(
    () => listAdminAgentTasks(adminAccess, { ...defaults, overdue: true }, { today: "soon" }),
    (error: Error) => error.name === "WorkOsValidationError",
  );
});

test("query parameters default to active tasks and reject bad input", () => {
  const parsed = parseAdminAgentTaskFilters(new URLSearchParams(""));
  assert.deepEqual(parsed, {
    personIds: null, query: null, completed: null, overdue: null, status: "active",
    projectId: null, dueFrom: null, dueTo: null, updatedSince: null,
    limit: 50, cursor: null,
  });

  const named = parseAdminAgentTaskFilters(new URLSearchParams(
    `person_ids=${personA},${personB}&q=checkout&completed=false&overdue=true&status=archived`
    + `&project_id=${projectApp}&due_from=2026-11-01&due_to=2026-11-30`
    + "&updated_since=2026-11-01T00:00:00Z&limit=5&cursor=abc",
  ));
  assert.deepEqual(named, {
    personIds: [personA, personB], query: "checkout", completed: false, overdue: true,
    status: "archived", projectId: projectApp, dueFrom: "2026-11-01", dueTo: "2026-11-30",
    updatedSince: "2026-11-01T00:00:00Z", limit: 5, cursor: "abc",
  });

  // An explicit empty person list stays explicit rather than becoming the team.
  assert.deepEqual(parseAdminAgentTaskFilters(new URLSearchParams("person_ids=")).personIds, []);
  assert.deepEqual(parseAdminAgentTaskFilters(new URLSearchParams("person_ids=,,")).personIds, []);
  assert.equal(parseAdminAgentTaskFilters(new URLSearchParams("q=%20%20")).query, null);
  assert.equal(parseAdminAgentTaskFilters(new URLSearchParams("limit=5000")).limit, 200);
  assert.equal(parseAdminAgentTaskFilters(new URLSearchParams("status=")).status, "active");
  assert.equal(parseAdminAgentTaskFilters(new URLSearchParams("overdue=")).overdue, null);
  assert.equal(parseAdminAgentTaskFilters(new URLSearchParams("overdue=false")).overdue, false);

  for (const bad of [
    "person_ids=not-a-uuid",
    `person_ids=${Array.from({ length: 21 }, (_, index) => `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`).join(",")}`,
    // Repeating one id still exceeds the raw contract bound before dedupe.
    `person_ids=${Array.from({ length: 21 }, () => personA).join(",")}`,
    "completed=maybe",
    "overdue=maybe",
    "status=open",
    "project_id=nope",
    "due_from=soon",
    "due_to=2026-02-30",
    "updated_since=yesterday",
    "limit=zero",
  ]) {
    assert.throws(
      () => parseAdminAgentTaskFilters(new URLSearchParams(bad)),
      (error: Error) => error.name === "WorkOsValidationError",
      bad,
    );
  }
});
