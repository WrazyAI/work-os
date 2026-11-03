import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { POST as previewsPOST } from "../src/app/api/agent/admin/v1/previews/route";
import { GET as previewGET } from "../src/app/api/agent/admin/v1/previews/[previewId]/route";
import { POST as previewConfirmPOST } from "../src/app/api/agent/admin/v1/previews/[previewId]/confirm/route";
import { POST as tasksPOST } from "../src/app/api/agent/admin/v1/tasks/route";
import {
  DELETE as taskDELETE,
  PATCH as taskPATCH,
} from "../src/app/api/agent/admin/v1/tasks/[taskId]/route";
import { POST as taskAssignPOST } from "../src/app/api/agent/admin/v1/tasks/[taskId]/assign/route";
import { POST as taskMovePOST } from "../src/app/api/agent/admin/v1/tasks/[taskId]/move/route";
import { POST as taskCompletePOST } from "../src/app/api/agent/admin/v1/tasks/[taskId]/complete/route";
import { POST as taskReopenPOST } from "../src/app/api/agent/admin/v1/tasks/[taskId]/reopen/route";
import { POST as eodReviewPOST } from "../src/app/api/agent/admin/v1/eods/[reportId]/review/route";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import {
  adminUser,
  eodCheckout,
  fixture,
  org,
  otherAdminUser,
  otherEod,
  otherOrg,
  otherTask,
  personA,
  personB,
  taskCheckout,
  taskCheckoutDone,
  taskCheckoutReview,
  taskDocumentation,
  taskSubtask,
  taskUnassigned,
  taskUnderscore,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** Route-level harness for the preview creators and the single confirm path.
 * The real resolver, PGlite pool, rate limiter, preview store, action services,
 * and write services all execute; only the browser session layer is absent,
 * because an admin agent call authenticates with its bearer token. */

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const ROUTE_ROOT = new URL("../src/app/api/agent/admin/v1/", import.meta.url);

/** A write token carries every write scope; each test that can approach the
 * 20-per-minute write budget mints its own token, because the limiter keys on
 * the token id. */
const WRITE_SCOPES = ["tasks:read", "tasks:write", "eods:read", "eods:review"];
const READ_SCOPES = ["tasks:read", "eods:read"];

type Fixture = Awaited<ReturnType<typeof fixture>>;

let f: Fixture;

async function newToken(scopes: string[], organizationId = org, userId = adminUser) {
  const id = randomUUID();
  const secret = `wos_admin_${randomUUID().replace(/-/g, "")}`;
  await f.db.query(
    `insert into work_agent_tokens
      (id, organization_id, person_id, user_id, kind, name, token_hash, token_prefix, scopes, expires_at)
     values ($1,$2,null,$3,'admin','write route token',$4,$5,$6::text[], now() + interval '1 day')`,
    [id, organizationId, userId, hashAgentToken(secret), secret.slice(0, 12), scopes],
  );
  return secret;
}

type RequestOptions = {
  /** `undefined` omits the header, which is the missing-key case. */
  key?: string;
  method?: string;
  body?: unknown;
  /** An exact body, so a test can send a truncated payload that `JSON.stringify`
   * would never produce. */
  rawBody?: string;
};

function request(pathname: string, secret: string, options: RequestOptions = {}) {
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  if (options.key !== undefined) headers["Idempotency-Key"] = options.key;
  const hasBody = options.body !== undefined || options.rawBody !== undefined;
  if (hasBody) headers["content-type"] = "application/json";
  return new Request(`https://example.test${pathname}`, {
    method: options.method ?? "POST",
    headers,
    body: options.rawBody !== undefined
      ? options.rawBody
      : options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

const taskParams = (taskId: string) => params({ taskId });

async function taskRow(taskId: string) {
  const { rows } = await f.db.query<{
    title: string;
    status: string;
    completed: boolean;
    assignee_person_ids: string[];
    updated_at: string | Date;
  }>("select title, status, completed, assignee_person_ids, updated_at from work_tasks where id = $1", [taskId]);
  return rows[0];
}

async function eodRow(reportId: string) {
  const { rows } = await f.db.query<{ status: string; manager_notes: string | null }>(
    "select status, manager_notes from work_reports where id = $1",
    [reportId],
  );
  return rows[0];
}

async function previewCount() {
  const { rows } = await f.db.query<{ total: number }>(
    "select count(*)::int as total from work_admin_action_previews",
  );
  return rows[0].total;
}

before(async () => {
  f = await fixture();
  await f.seedDirectory();
  await f.seedTasks();
  await f.seedRecords();
  // The production schema columns the delegated write services and the admin
  // resolvers touch; the shared fixture predates them.
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
    alter table work_tasks alter column id set default gen_random_uuid();
    alter table work_tasks add column priority text;
    alter table work_tasks add column labels text[] not null default '{}'::text[];
    alter table work_tasks add column story_points numeric;
    alter table work_tasks add column expected_outcome text;
    alter table work_tasks add column definition_of_done text;
    alter table work_tasks add column task_group_id text;
    alter table work_tasks add column estimated_effort_minutes integer;
    alter table work_tasks add column effort_unit text;
    alter table work_tasks add column blocked boolean not null default false;
    alter table work_tasks add column blocked_reason text;
    alter table work_tasks add column synced_at timestamptz;
    alter table work_reports add column user_id uuid;
    alter table work_reports add column metrics jsonb not null default '{}'::jsonb;
    alter table work_reports add column missing_evidence jsonb not null default '[]'::jsonb;
    alter table work_reports add column manager_notes text;
    alter table work_reports add column reviewed_by uuid;
    alter table work_reports add column reviewed_at timestamptz;
  `);
  await f.db.query(
    "insert into profiles (id, email, display_name, role) values ($1, 'admin@example.com', 'Admin', 'member'), ($2, 'other@example.com', 'Other Admin', 'member')",
    [adminUser, otherAdminUser],
  );
  await f.db.query(
    `update work_organizations
     set feature_flags = '{"employee_companion":true,"admin_agent_api":true}'::jsonb,
         legacy_owner_id = $2
     where id = $1`,
    [org, adminUser],
  );
  await f.db.query(
    `update work_organizations
     set feature_flags = '{"employee_companion":true,"admin_agent_api":true}'::jsonb,
         legacy_owner_id = $2
     where id = $1`,
    [otherOrg, otherAdminUser],
  );
  // `reviewReport` updates a report by its owning user; the admin review path
  // resolves that owner from the organization row.
  await f.db.query("update work_reports set user_id = $2 where id = $1", [eodCheckout, adminUser]);
});

after(async () => {
  await f.close();
});

test("every consequential write route answers 202 with a preview", async () => {
  for (const file of [
    "tasks/route.ts",
    "tasks/[taskId]/route.ts",
    "tasks/[taskId]/assign/route.ts",
    "tasks/[taskId]/move/route.ts",
    "tasks/[taskId]/complete/route.ts",
    "tasks/[taskId]/reopen/route.ts",
    "eods/[reportId]/review/route.ts",
  ]) {
    const body = await read(`src/app/api/agent/admin/v1/${file}`);
    assert.match(body, /createAdminPreview/, file);
    assert.match(body, /202/, file);
    // A preview creator describes the action; it never executes one.
    assert.doesNotMatch(body, /applyAdminAction/, `${file} must not apply an action`);
    assert.doesNotMatch(body, /confirmAdminPreview/, `${file} must not confirm a preview`);
  }
});

test("only the preview confirm route applies an action", async () => {
  const confirm = await read("src/app/api/agent/admin/v1/previews/[previewId]/confirm/route.ts");
  assert.match(confirm, /confirmAdminPreview/);
  assert.match(confirm, /Idempotency-Key/i);

  const files = (await readdir(ROUTE_ROOT, { recursive: true })).map(String)
    .filter((name) => name.endsWith("route.ts"));
  assert.ok(files.length > 7, "route inventory is incomplete");
  for (const file of files) {
    if (file === "previews/[previewId]/confirm/route.ts") continue;
    const source = await readFile(new URL(file, ROUTE_ROOT), "utf8");
    assert.doesNotMatch(source, /applyAdminAction|confirmAdminPreview/, `${file} must not execute an action`);
  }
});

test("every action route returns a preview and writes nothing", async () => {
  const token = await newToken(WRITE_SCOPES);
  const before = await previewCount();
  const cases: Array<{ label: string; action: string; response: () => Promise<Response> }> = [
    {
      label: "create",
      action: "task.create",
      response: () => tasksPOST(request("/api/agent/admin/v1/tasks", token, {
        key: "create-preview", body: { name: "Admin preview create", assignee_person_ids: [personA] },
      })),
    },
    {
      label: "update",
      action: "task.update",
      response: () => taskPATCH(request(`/api/agent/admin/v1/tasks/${taskCheckout}`, token, {
        key: "update-preview", method: "PATCH", body: { name: "Fix checkout v2" },
      }), taskParams(taskCheckout)),
    },
    {
      label: "assign",
      action: "task.assign",
      response: () => taskAssignPOST(request(`/api/agent/admin/v1/tasks/${taskUnassigned}/assign`, token, {
        key: "assign-preview", body: { mode: "add", person_ids: [personB] },
      }), taskParams(taskUnassigned)),
    },
    {
      label: "move",
      action: "task.move",
      response: () => taskMovePOST(request(`/api/agent/admin/v1/tasks/${taskSubtask}/move`, token, {
        key: "move-preview", body: { parent_task_id: taskCheckoutReview },
      }), taskParams(taskSubtask)),
    },
    {
      label: "complete",
      action: "task.complete",
      response: () => taskCompletePOST(request(`/api/agent/admin/v1/tasks/${taskCheckout}/complete`, token, {
        key: "complete-preview",
      }), taskParams(taskCheckout)),
    },
    {
      label: "reopen",
      action: "task.reopen",
      response: () => taskReopenPOST(request(`/api/agent/admin/v1/tasks/${taskCheckoutDone}/reopen`, token, {
        key: "reopen-preview",
      }), taskParams(taskCheckoutDone)),
    },
    {
      label: "archive",
      action: "task.archive",
      response: () => taskDELETE(request(`/api/agent/admin/v1/tasks/${taskCheckout}`, token, {
        key: "archive-preview", method: "DELETE",
      }), taskParams(taskCheckout)),
    },
    {
      label: "delete",
      action: "task.delete",
      response: () => taskDELETE(request(`/api/agent/admin/v1/tasks/${taskCheckoutReview}?mode=delete`, token, {
        key: "delete-preview", method: "DELETE",
      }), taskParams(taskCheckoutReview)),
    },
    {
      label: "eod review",
      action: "eod.review",
      response: () => eodReviewPOST(request(`/api/agent/admin/v1/eods/${eodCheckout}/review`, token, {
        key: "eod-review-preview", body: { status: "approved", manager_notes: "Ship it" },
      }), params({ reportId: eodCheckout })),
    },
    {
      label: "generic preview",
      action: "task.complete",
      response: () => previewsPOST(request("/api/agent/admin/v1/previews", token, {
        key: "generic-preview", body: { action: "task.complete", payload: { task_id: taskUnderscore } },
      })),
    },
  ];

  for (const entry of cases) {
    const response = await entry.response();
    assert.equal(response.status, 202, `${entry.label} was not accepted`);
    const preview = await response.json() as {
      id: string;
      action: string;
      summary: string;
      changes: unknown[];
      warnings: string[];
      state: Record<string, unknown>;
      expiresAt: string;
    };
    assert.equal(preview.action, entry.action, entry.label);
    assert.ok(preview.id, `${entry.label} did not return a preview id`);
    assert.ok(preview.summary.length > 0, `${entry.label} returned no summary`);
    assert.ok(Array.isArray(preview.changes), `${entry.label} returned no changes`);
    assert.ok(Array.isArray(preview.warnings), `${entry.label} returned no warnings`);
    assert.ok(new Date(preview.expiresAt).getTime() > Date.now(), `${entry.label} returned an expired preview`);
  }
  assert.equal(await previewCount(), before + cases.length, "each accepted write stores exactly one preview");

  // Nothing the previews described has happened yet.
  const checkout = await taskRow(taskCheckout);
  assert.equal(checkout.title, "Fix checkout");
  assert.equal(checkout.status, "open");
  assert.deepEqual(checkout.assignee_person_ids, [personA]);
  assert.equal((await taskRow(taskCheckoutDone)).completed, true);
  assert.deepEqual((await taskRow(taskUnassigned)).assignee_person_ids, []);
  assert.equal((await eodRow(eodCheckout)).status, "pending_review");
  const created = await f.db.query<{ total: number }>(
    "select count(*)::int as total from work_tasks where title = $1",
    ["Admin preview create"],
  );
  assert.equal(created.rows[0].total, 0);
});

test("a missing Idempotency-Key answers 400 before anything is stored", async () => {
  const token = await newToken(WRITE_SCOPES);
  const before = await previewCount();
  const responses = await Promise.all([
    tasksPOST(request("/api/agent/admin/v1/tasks", token, { body: { name: "No key" } })),
    taskPATCH(request(`/api/agent/admin/v1/tasks/${taskCheckout}`, token, {
      method: "PATCH", body: { name: "No key" },
    }), taskParams(taskCheckout)),
    taskAssignPOST(request(`/api/agent/admin/v1/tasks/${taskUnassigned}/assign`, token, {
      body: { mode: "add", person_ids: [personB] },
    }), taskParams(taskUnassigned)),
    taskCompletePOST(request(`/api/agent/admin/v1/tasks/${taskCheckout}/complete`, token, {}),
      taskParams(taskCheckout)),
    eodReviewPOST(request(`/api/agent/admin/v1/eods/${eodCheckout}/review`, token, {
      body: { status: "approved" },
    }), params({ reportId: eodCheckout })),
    previewsPOST(request("/api/agent/admin/v1/previews", token, {
      body: { action: "task.complete", payload: { task_id: taskCheckout } },
    })),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 400);
    assert.equal((await response.json() as { code: string }).code, "validation_error");
  }
  assert.equal(await previewCount(), before, "a keyless write must not store a preview");
});

test("a malformed lifecycle body answers 400 instead of being ignored", async () => {
  const token = await newToken(WRITE_SCOPES);
  const before = await previewCount();
  // `Request.json()` rejects on a truncated payload. Treating that as "no
  // body" would skip the transition guard (complete) and the mode (delete).
  const complete = await taskCompletePOST(request(
    `/api/agent/admin/v1/tasks/${taskCheckout}/complete`,
    token,
    { key: "malformed-complete", rawBody: '{"completed": false' },
  ), taskParams(taskCheckout));
  assert.equal(complete.status, 400);
  assert.equal((await complete.json() as { code: string }).code, "validation_error");

  const remove = await taskDELETE(request(
    `/api/agent/admin/v1/tasks/${taskCheckout}?mode=delete`,
    token,
    { key: "malformed-delete", method: "DELETE", rawBody: '{"mode": "delete"' },
  ), taskParams(taskCheckout));
  assert.equal(remove.status, 400);
  assert.equal((await remove.json() as { code: string }).code, "validation_error");

  assert.equal(await previewCount(), before, "a malformed write must not store a preview");
  assert.equal((await taskRow(taskCheckout)).status, "open", "a malformed delete must not archive");
});

test("a blank ?mode= is treated as absent", async () => {
  const token = await newToken(WRITE_SCOPES);
  const response = await taskDELETE(request(
    `/api/agent/admin/v1/tasks/${taskCheckout}?mode=`,
    token,
    { key: "blank-mode", method: "DELETE" },
  ), taskParams(taskCheckout));
  assert.equal(response.status, 202);
  assert.equal((await response.json() as { action: string }).action, "task.archive");
});

test("a preview with an unrecognized action fails closed", async () => {
  const token = await newToken(WRITE_SCOPES);
  const created = await tasksPOST(request("/api/agent/admin/v1/tasks", token, {
    key: "legacy-action-preview", body: { name: "Legacy preview" },
  }));
  assert.equal(created.status, 202);
  const preview = await created.json() as { id: string };
  // A legacy or hand-edited row can name an action this surface no longer
  // knows. It has no scope, so it must not be readable or confirmable.
  await f.db.query(
    "update work_admin_action_previews set action = $2 where id = $1",
    [preview.id, "task.legacy"],
  );
  const read = await previewGET(
    request(`/api/agent/admin/v1/previews/${preview.id}`, token, { method: "GET" }),
    params({ previewId: preview.id }),
  );
  assert.equal(read.status, 404);
  assert.equal((await read.json() as { code: string }).code, "preview_not_found");
  const confirm = await previewConfirmPOST(
    request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, { key: "legacy-action-confirm" }),
    params({ previewId: preview.id }),
  );
  assert.equal(confirm.status, 404);
});

test("a token without the action's write scope answers 403", async () => {
  const readOnly = await newToken(READ_SCOPES);
  const responses = await Promise.all([
    tasksPOST(request("/api/agent/admin/v1/tasks", readOnly, {
      key: "scope-create", body: { name: "Not allowed" },
    })),
    taskPATCH(request(`/api/agent/admin/v1/tasks/${taskCheckout}`, readOnly, {
      key: "scope-update", method: "PATCH", body: { name: "Not allowed" },
    }), taskParams(taskCheckout)),
    taskCompletePOST(request(`/api/agent/admin/v1/tasks/${taskCheckout}/complete`, readOnly, {
      key: "scope-complete",
    }), taskParams(taskCheckout)),
    eodReviewPOST(request(`/api/agent/admin/v1/eods/${eodCheckout}/review`, readOnly, {
      key: "scope-eod", body: { status: "approved" },
    }), params({ reportId: eodCheckout })),
    // The generic creator derives the scope from the action it is asked to
    // describe, so `tasks:write` cannot mint an EOD decision preview.
    previewsPOST(request("/api/agent/admin/v1/previews", await newToken(["tasks:write"]), {
      key: "scope-generic", body: { action: "eod.review", payload: { report_id: eodCheckout, status: "approved" } },
    })),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { code: string }).code, "insufficient_scope");
  }
});

test("confirm applies the update once and a second confirm replays it", async () => {
  const token = await newToken(WRITE_SCOPES);
  const created = await taskPATCH(request(`/api/agent/admin/v1/tasks/${taskCheckout}`, token, {
    key: "confirm-update-preview", method: "PATCH", body: { name: "Fix checkout safely" },
  }), taskParams(taskCheckout));
  assert.equal(created.status, 202);
  const preview = await created.json() as { id: string };
  assert.equal((await taskRow(taskCheckout)).title, "Fix checkout", "the preview wrote the task");

  const first = await previewConfirmPOST(request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, {
    key: "confirm-update-first",
  }), params({ previewId: preview.id }));
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { task: { title: string } };
  assert.equal(firstBody.task.title, "Fix checkout safely");
  assert.equal(first.headers.get("Idempotent-Replay"), null);
  assert.equal((await taskRow(taskCheckout)).title, "Fix checkout safely");

  const second = await previewConfirmPOST(request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, {
    key: "confirm-update-second",
  }), params({ previewId: preview.id }));
  assert.equal(second.status, 200);
  assert.equal(second.headers.get("Idempotent-Replay"), "true");
  assert.deepEqual(await second.json(), firstBody, "a replay returns the stored result");

  const audits = await f.db.query<{ total: number }>(
    "select count(*)::int as total from work_audit_log where action = $1",
    ["admin.task.update"],
  );
  assert.equal(audits.rows[0].total, 1, "the confirm path ran the action exactly once");
});

test("a confirmed assign applies the resolved final list", async () => {
  const token = await newToken(WRITE_SCOPES);
  const created = await taskAssignPOST(request(
    `/api/agent/admin/v1/tasks/${taskDocumentation}/assign`,
    token,
    { key: "assign-confirm-preview", body: { mode: "add", person_ids: [personB] } },
  ), taskParams(taskDocumentation));
  assert.equal(created.status, 202);
  const preview = await created.json() as {
    id: string;
    changes: Array<{ field: string; from: unknown; to: unknown }>;
  };
  // The preview resolves the delta once; the stored request is the exact list.
  assert.deepEqual(preview.changes[0], { field: "assignees", from: [personA], to: [personA, personB] });
  assert.deepEqual((await taskRow(taskDocumentation)).assignee_person_ids, [personA]);

  const confirmed = await previewConfirmPOST(
    request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, { key: "assign-confirm-first" }),
    params({ previewId: preview.id }),
  );
  assert.equal(confirmed.status, 200);
  assert.deepEqual(
    (await taskRow(taskDocumentation)).assignee_person_ids,
    [personA, personB],
    "confirm applies the preview's resolved list, not the delta",
  );
});

test("a confirmed create returns 201 and records the preview as its idempotency key", async () => {
  const token = await newToken(WRITE_SCOPES);
  const created = await previewsPOST(request("/api/agent/admin/v1/previews", token, {
    key: "confirm-create-preview",
    body: { action: "task.create", payload: { name: "Admin created task", assignee_person_ids: [personA] } },
  }));
  assert.equal(created.status, 202);
  const preview = await created.json() as { id: string };
  assert.ok(preview.id);

  const confirmed = await previewConfirmPOST(request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, {
    key: "confirm-create-first",
  }), params({ previewId: preview.id }));
  assert.equal(confirmed.status, 201);
  const body = await confirmed.json() as { task: { id: string; title: string; agent_idempotency_key?: string } };
  assert.equal(body.task.title, "Admin created task");
  assert.equal(body.task.agent_idempotency_key, preview.id);

  const rows = await f.db.query<{ agent_idempotency_key: string }>(
    "select agent_idempotency_key from work_tasks where id = $1",
    [body.task.id],
  );
  assert.equal(rows.rows[0].agent_idempotency_key, preview.id);

  const replayed = await previewConfirmPOST(request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, {
    key: "confirm-create-second",
  }), params({ previewId: preview.id }));
  assert.equal(replayed.status, 201);
  assert.equal(replayed.headers.get("Idempotent-Replay"), "true");
});

test("a confirmed EOD review decides the report", async () => {
  const token = await newToken(WRITE_SCOPES);
  const created = await eodReviewPOST(request(`/api/agent/admin/v1/eods/${eodCheckout}/review`, token, {
    key: "confirm-eod-preview", body: { status: "approved", manager_notes: "Clean ship log" },
  }), params({ reportId: eodCheckout }));
  assert.equal(created.status, 202);
  const preview = await created.json() as { id: string; targetType?: string };
  assert.equal((await eodRow(eodCheckout)).status, "pending_review");

  const confirmed = await previewConfirmPOST(request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, {
    key: "confirm-eod-first",
  }), params({ previewId: preview.id }));
  assert.equal(confirmed.status, 200);
  const report = await eodRow(eodCheckout);
  assert.equal(report.status, "approved");
  assert.equal(report.manager_notes, "Clean ship log");

  const audits = await f.db.query<{ target_type: string; target_id: string }>(
    "select target_type, target_id from work_audit_log where action = $1",
    ["admin.eod.review"],
  );
  assert.equal(audits.rows.length, 1);
  assert.equal(audits.rows[0].target_type, "work_report");
  assert.equal(audits.rows[0].target_id, eodCheckout);
});

test("a stale target answers 409 preview_stale and writes nothing", async () => {
  const token = await newToken(WRITE_SCOPES);
  const created = await taskAssignPOST(request(`/api/agent/admin/v1/tasks/${taskUnassigned}/assign`, token, {
    key: "stale-assign-preview", body: { mode: "add", person_ids: [personB] },
  }), taskParams(taskUnassigned));
  assert.equal(created.status, 202);
  const preview = await created.json() as { id: string };
  await f.db.query("update work_tasks set updated_at = now() where id = $1", [taskUnassigned]);

  const confirmed = await previewConfirmPOST(request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, {
    key: "stale-assign-confirm",
  }), params({ previewId: preview.id }));
  assert.equal(confirmed.status, 409);
  const body = await confirmed.json() as { code: string; current_state?: Record<string, unknown> };
  assert.equal(body.code, "preview_stale");
  assert.ok(body.current_state, "a stale confirm reports the fresh state");
  assert.deepEqual((await taskRow(taskUnassigned)).assignee_person_ids, []);
});

test("an expired preview answers 410", async () => {
  const token = await newToken(WRITE_SCOPES);
  const created = await taskCompletePOST(request(`/api/agent/admin/v1/tasks/${taskUnderscore}/complete`, token, {
    key: "expired-complete-preview",
  }), taskParams(taskUnderscore));
  assert.equal(created.status, 202);
  const preview = await created.json() as { id: string };
  await f.db.query(
    "update work_admin_action_previews set expires_at = now() - interval '1 minute' where id = $1",
    [preview.id],
  );
  const confirmed = await previewConfirmPOST(request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, token, {
    key: "expired-complete-confirm",
  }), params({ previewId: preview.id }));
  assert.equal(confirmed.status, 410);
  assert.equal((await confirmed.json() as { code: string }).code, "preview_expired");
  assert.equal((await taskRow(taskUnderscore)).completed, false);
});

test("previews are private to the token that created them", async () => {
  const owner = await newToken(WRITE_SCOPES);
  const otherToken = await newToken(WRITE_SCOPES);
  const otherOrganization = await newToken(WRITE_SCOPES, otherOrg, otherAdminUser);
  const created = await tasksPOST(request("/api/agent/admin/v1/tasks", owner, {
    key: "private-preview", body: { name: "Private preview" },
  }));
  assert.equal(created.status, 202);
  const preview = await created.json() as { id: string };

  const own = await previewGET(
    request(`/api/agent/admin/v1/previews/${preview.id}`, owner, { method: "GET" }),
    params({ previewId: preview.id }),
  );
  assert.equal(own.status, 200);
  const ownBody = await own.json() as { id: string; action: string };
  assert.equal(ownBody.id, preview.id);
  assert.equal(ownBody.action, "task.create");

  for (const [label, secret] of [
    ["another token", otherToken],
    ["another organization", otherOrganization],
  ] as const) {
    const response = await previewGET(
      request(`/api/agent/admin/v1/previews/${preview.id}`, secret, { method: "GET" }),
      params({ previewId: preview.id }),
    );
    assert.equal(response.status, 404, label);
    const confirm = await previewConfirmPOST(
      request(`/api/agent/admin/v1/previews/${preview.id}/confirm`, secret, { key: "private-confirm" }),
      params({ previewId: preview.id }),
    );
    assert.equal(confirm.status, 404, `${label} could confirm`);
  }

  const malformed = await previewGET(
    request("/api/agent/admin/v1/previews/not-a-uuid", owner, { method: "GET" }),
    params({ previewId: "not-a-uuid" }),
  );
  assert.equal(malformed.status, 404);
});

test("a preview create replays its Idempotency-Key and conflicts on a new body", async () => {
  const token = await newToken(WRITE_SCOPES);
  const send = () => tasksPOST(request("/api/agent/admin/v1/tasks", token, {
    key: "reused-create-key", body: { name: "Idempotent create", assignee_person_ids: [personA] },
  }));
  const first = await send();
  const second = await send();
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  const firstPreview = await first.json() as { id: string };
  const secondPreview = await second.json() as { id: string };
  assert.equal(secondPreview.id, firstPreview.id, "a retried create replays the same preview");

  const conflicting = await tasksPOST(request("/api/agent/admin/v1/tasks", token, {
    key: "reused-create-key", body: { name: "Different work" },
  }));
  assert.equal(conflicting.status, 409);
  assert.equal((await conflicting.json() as { code: string }).code, "idempotency_conflict");
});

test("the write routes spend the write budget", async () => {
  const token = await newToken(WRITE_SCOPES);
  for (let index = 0; index < 20; index += 1) {
    const response = await tasksPOST(request("/api/agent/admin/v1/tasks", token, {
      key: `budget-${index}`, body: { name: `Budget task ${index}` },
    }));
    assert.equal(response.status, 202, `write ${index + 1} was rate-limited early`);
  }
  const over = await tasksPOST(request("/api/agent/admin/v1/tasks", token, {
    key: "budget-over", body: { name: "Budget overflow" },
  }));
  assert.equal(over.status, 429);
  assert.equal((await over.json() as { code: string }).code, "rate_limited");
  assert.ok(Number(over.headers.get("Retry-After")) >= 1);
});

test("a cross-organization EOD review preview answers 404", async () => {
  // `otherEod` belongs to the other tenant; this token's organization scopes
  // every EOD read, so the preview cannot even describe the decision.
  const token = await newToken(WRITE_SCOPES);
  const foreignReport = await eodReviewPOST(request(`/api/agent/admin/v1/eods/${otherEod}/review`, token, {
    key: "cross-org-eod", body: { status: "approved" },
  }), params({ reportId: otherEod }));
  assert.equal(foreignReport.status, 404);
  assert.equal((await foreignReport.json() as { code: string }).code, "not_found");
});

test("a task outside the organization answers 404 before any preview", async () => {
  const token = await newToken(WRITE_SCOPES);
  for (const taskId of [otherTask, "not-a-task-id"]) {
    const response = await taskPATCH(request(`/api/agent/admin/v1/tasks/${taskId}`, token, {
      key: `foreign-task-${taskId}`, method: "PATCH", body: { name: "Retargeted" },
    }), taskParams(taskId));
    assert.equal(response.status, 404, taskId);
    assert.equal((await response.json() as { code: string }).code, "not_found");
  }
});

test("the generic creator rejects an unknown action and a foreign field", async () => {
  const token = await newToken(WRITE_SCOPES);
  const unknownAction = await previewsPOST(request("/api/agent/admin/v1/previews", token, {
    key: "unknown-action", body: { action: "task.progress", payload: { task_id: taskCheckout } },
  }));
  assert.equal(unknownAction.status, 400);
  assert.equal((await unknownAction.json() as { code: string }).code, "validation_error");

  const foreignField = await previewsPOST(request("/api/agent/admin/v1/previews", token, {
    key: "foreign-field", body: { action: "task.complete", payload: { task_id: taskCheckout }, mode: "now" },
  }));
  assert.equal(foreignField.status, 400);
  assert.equal((await foreignField.json() as { code: string }).code, "validation_error");
});
