import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { GET as evidenceFileGET } from "../src/app/api/agent/admin/v1/evidence/[evidenceId]/file/route";
import { POST as taskEvidencePOST } from "../src/app/api/agent/admin/v1/tasks/[taskId]/evidence/route";
import { POST as taskProgressPOST } from "../src/app/api/agent/admin/v1/tasks/[taskId]/progress/route";
import {
  addAdminAgentProgress,
  adminEvidenceMetrics,
  adminEvidenceObjectPath,
  attachAdminAgentEvidence,
  getAdminAgentEvidenceFile,
  setAdminEvidenceStorageForTests,
} from "../src/lib/work-admin-agent-evidence";
import { hashAgentToken } from "../src/lib/work-agent-tokens";
import { getWorkOsEmployeeTaskDetails } from "../src/lib/work-os-employee-tasks";
import { listEvidence } from "../src/lib/work-os-evidence-log";
import type { Json } from "../src/lib/work-os-internal";
import { CompletionEvidenceError, COMPLETION_EVIDENCE_MAX_BYTES } from "../src/modules/work-os/completion-evidence";
import { isTaskOutcomeEvidence } from "../src/modules/work-os/companion";
import {
  adminAccess,
  adminUser,
  fixture,
  org,
  otherAdminUser,
  otherOrg,
  otherPerson,
  otherTask,
  personA,
  personB,
  taskCheckout,
  taskShared,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** Service- and route-level coverage for the two additive admin writes and the
 * authenticated evidence download. The real resolver, PGlite pool, rate
 * limiter, idempotency cache, and evidence service execute; only object storage
 * is an in-memory fake, because the test must not touch R2 or the filesystem. */

const OTHER_EVIDENCE = "b0000000-0000-4000-8000-0000000000ff";
const MISSING_TASK = "a0000000-0000-4000-8000-0000000000ff";
const actor = { tokenId: "token-1", tokenName: "Admin automation" };
const WRITE_SCOPES = ["tasks:read", "tasks:write", "eods:read", "eods:review"];

type Fixture = Awaited<ReturnType<typeof fixture>>;
let f: Fixture;

type FakeStorage = {
  objects: Map<string, Uint8Array>;
  uploads: Array<{ bucket: string; path: string; contentType?: string }>;
  removals: string[];
  upload: (
    bucket: string,
    objectPath: string,
    body: Buffer,
    options?: { contentType?: string; upsert?: boolean },
  ) => Promise<{ data: { path: string } | null; error: { message: string } | null }>;
  download: (
    bucket: string,
    objectPath: string,
  ) => Promise<{ data: { arrayBuffer: ArrayBuffer } | null; error: { message: string } | null }>;
  remove: (
    bucket: string,
    objectPaths: string[],
  ) => Promise<{ data: { message: string } | null; error: { message: string } | null }>;
};

let storage: FakeStorage;

function fakeStorage(): FakeStorage {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    uploads: [],
    removals: [],
    async upload(bucket, objectPath, body, options) {
      this.uploads.push({ bucket, path: objectPath, contentType: options?.contentType });
      objects.set(`${bucket}:${objectPath}`, new Uint8Array(body));
      return { data: { path: objectPath }, error: null };
    },
    async download(bucket, objectPath) {
      const found = objects.get(`${bucket}:${objectPath}`);
      if (!found) return { data: null, error: { message: "The specified key does not exist." } };
      const copy = new Uint8Array(found);
      return {
        data: { arrayBuffer: copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer },
        error: null,
      };
    },
    async remove(bucket, objectPaths) {
      this.removals.push(...objectPaths);
      for (const objectPath of objectPaths) objects.delete(`${bucket}:${objectPath}`);
      return { data: { message: "Deleted" }, error: null };
    },
  };
}

function useFakeStorage(): FakeStorage {
  storage = fakeStorage();
  setAdminEvidenceStorageForTests(storage);
  return storage;
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

function pngUpload(idempotencyKey: string, note = "Release proof") {
  return {
    fileName: "proof.png",
    contentType: "image/png",
    bytes: PNG_BYTES,
    note,
    idempotencyKey,
  };
}

async function evidenceRow(id: string) {
  const { rows } = await f.db.query<{
    id: string;
    user_id: string | null;
    person_id: string | null;
    task_id: string | null;
    source: string;
    title: string;
    summary: string;
    url: string | null;
    metrics: Record<string, unknown>;
    raw: Record<string, unknown>;
    idempotency_key: string | null;
  }>("select * from work_evidence where id = $1", [id]);
  return rows[0]!;
}

async function evidenceCount(key: string) {
  const { rows } = await f.db.query<{ total: number }>(
    "select count(*)::int as total from work_evidence where idempotency_key = $1",
    [key],
  );
  return rows[0]!.total;
}

async function newToken(scopes: string[]) {
  const id = randomUUID();
  const secret = `wos_admin_${randomUUID().replace(/-/g, "")}`;
  await f.db.query(
    `insert into work_agent_tokens
      (id, organization_id, person_id, user_id, kind, name, token_hash, token_prefix, scopes, expires_at)
     values ($1,$2,null,$3,'admin','evidence route token',$4,$5,$6::text[], now() + interval '1 day')`,
    [id, org, adminUser, hashAgentToken(secret), secret.slice(0, 12), scopes],
  );
  return secret;
}

const taskParams = (taskId: string) => ({ params: Promise.resolve({ taskId }) });
const evidenceParams = (evidenceId: string) => ({ params: Promise.resolve({ evidenceId }) });

function jsonRequest(pathname: string, secret: string, options: { key?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    "content-type": "application/json",
  };
  if (options.key !== undefined) headers["Idempotency-Key"] = options.key;
  return new Request(`https://example.test${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {}),
  });
}

function evidenceRequest(
  taskId: string,
  secret: string,
  options: { key?: string; bytes?: Uint8Array; name?: string; type?: string; note?: string; omitFile?: boolean } = {},
) {
  const form = new FormData();
  if (!options.omitFile) {
    const bytes = options.bytes ?? PNG_BYTES;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    form.set("file", new File([buffer], options.name ?? "proof.png", { type: options.type ?? "image/png" }));
  }
  if (options.note !== undefined) form.set("note", options.note);
  const headers: Record<string, string> = { authorization: `Bearer ${secret}` };
  if (options.key !== undefined) headers["Idempotency-Key"] = options.key;
  return new Request(`https://example.test/api/agent/admin/v1/tasks/${taskId}/evidence`, {
    method: "POST",
    headers,
    body: form,
  });
}

function downloadRequest(evidenceId: string, secret: string) {
  return new Request(`https://example.test/api/agent/admin/v1/evidence/${evidenceId}/file`, {
    headers: { authorization: `Bearer ${secret}` },
  });
}

before(async () => {
  f = await fixture();
  await f.seedDirectory();
  await f.seedTasks();
  await f.seedRecords();
  // The production columns the resolver, evidence writers, and detail read
  // touch; the shared admin fixture predates them.
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
    create table work_schedule_exceptions (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      person_id uuid not null,
      exception_date date not null,
      reason text,
      created_at timestamptz not null default now()
    );
    create table work_evidence_events (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid,
      person_id uuid,
      task_id uuid,
      correction_status text,
      evidence_class text
    );
    alter table work_evidence
      add column evidence_event_id uuid references work_evidence_events(id) on delete set null;
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
  // A completion evidence row in the other organization, so a cross-tenant
  // download proves the organization filter rather than a missing row.
  await f.db.query(
    `insert into work_evidence
      (id, organization_id, person_id, task_id, evidence_date, source, title, summary, url, metrics)
     values ($1,$2,$3,$4,'2026-11-02','manual','Other org receipt','Not ours',
       '/api/work-os/evidence/other/file',
       '{"employeeAttached":true,"evidenceClass":"output_evidence","contentType":"image/png","sizeBytes":10,"fileName":"other.png"}'::jsonb)`,
    [OTHER_EVIDENCE, otherOrg, otherPerson, otherTask],
  );
});

after(async () => {
  setAdminEvidenceStorageForTests(null);
  await f.close();
});

test("admin evidence is task-scoped and records the uploader, not a person", () => {
  const metrics = adminEvidenceMetrics({
    contentType: "image/png",
    fileName: "proof.png",
    sizeBytes: 10,
    note: "Done",
    adminUserId: adminUser,
    adminTokenId: "token-1",
    targetPersonId: personB,
  });
  assert.equal(metrics.employeeAttached, true);
  assert.equal(metrics.evidenceClass, "output_evidence");
  assert.equal(metrics.adminUserId, adminUser);
  assert.equal(metrics.attachedForPersonId, personB);
  assert.equal(metrics.personId, undefined);
});

test("the storage path is task-based", () => {
  assert.equal(
    adminEvidenceObjectPath({ organizationId: org, taskId: "t1", evidenceId: "e1", contentType: "image/png" }),
    `organizations/${org}/tasks/t1/evidence/e1.png`,
  );
});

test("attaching evidence writes a task-scoped row and one task-path object", async () => {
  const fake = useFakeStorage();
  const { evidence } = await attachAdminAgentEvidence(adminAccess, taskCheckout, pngUpload("attach-1"), actor);
  const id = String(evidence.id);
  const row = await evidenceRow(id);

  assert.equal(row.user_id, adminUser);
  assert.equal(row.person_id, null);
  assert.equal(row.task_id, taskCheckout);
  assert.equal(row.source, "manual");
  assert.equal(row.url, `/api/agent/admin/v1/evidence/${id}/file`);
  assert.equal(row.metrics.evidenceClass, "output_evidence");
  assert.equal(row.metrics.employeeAttached, true);
  assert.equal(row.metrics.origin, "admin_task_evidence");
  assert.equal(row.metrics.adminUserId, adminUser);
  assert.equal(row.metrics.adminTokenId, "token-1");
  assert.equal(row.metrics.attachedForPersonId, personA);
  assert.equal(row.metrics.personId, undefined);
  assert.equal(row.metrics.note, "Release proof");
  assert.deepEqual(row.raw, {
    origin: "admin_task_completion",
    adminUserId: adminUser,
    adminTokenId: "token-1",
  });
  assert.equal(row.idempotency_key, "attach-1");
  assert.deepEqual(fake.uploads.map((upload) => upload.path), [
    `organizations/${org}/tasks/${taskCheckout}/evidence/${id}.png`,
  ]);
  assert.equal(fake.uploads[0]?.contentType, "image/png");

  const { rows: audits } = await f.db.query<{ action: string; target_id: string; metadata: Record<string, unknown> }>(
    "select action, target_id, metadata from work_audit_log where action = 'admin.task.evidence' order by id desc limit 1",
  );
  assert.equal(audits[0]?.target_id, taskCheckout);
  assert.equal(audits[0]?.metadata.tokenId, "token-1");
  assert.equal(audits[0]?.metadata.tokenName, "Admin automation");
  assert.equal(audits[0]?.metadata.targetPersonId, personA);
});

test("admin evidence appears on the task and satisfies the gate without joining a person's evidence", async () => {
  useFakeStorage();
  const { evidence } = await attachAdminAgentEvidence(adminAccess, taskCheckout, pngUpload("attach-visible"), actor);
  const id = String(evidence.id);

  const details = await getWorkOsEmployeeTaskDetails(adminAccess, taskCheckout);
  assert.ok(
    (details.completionEvidence as Json[]).some((item) => item.id === id),
    "the trusted task detail must show the admin attachment",
  );

  // The completion gate reads the owner's evidence for the task; the admin row
  // is output evidence there even though it belongs to no person.
  const forTask = await listEvidence(adminUser, { taskId: taskCheckout }) as Json[];
  assert.ok(forTask.some((row) => row.id === id && isTaskOutcomeEvidence(row)));

  const forAssignee = await listEvidence(adminUser, { taskId: taskCheckout, personId: personA }) as Json[];
  assert.equal(forAssignee.some((row) => row.id === id), false);
  const forCoworker = await listEvidence(adminUser, { personId: personB }) as Json[];
  assert.equal(forCoworker.some((row) => row.id === id), false);
});

test("a retried evidence key returns the first row and uploads once", async () => {
  const fake = useFakeStorage();
  const first = await attachAdminAgentEvidence(adminAccess, taskCheckout, pngUpload("attach-retry"), actor);
  const second = await attachAdminAgentEvidence(adminAccess, taskCheckout, pngUpload("attach-retry"), actor);
  assert.equal(second.evidence.id, first.evidence.id);
  assert.equal(fake.uploads.length, 1);
  assert.equal(await evidenceCount("attach-retry"), 1);
});

test("a key reused for another task is a conflict, not a silent overwrite", async () => {
  useFakeStorage();
  await attachAdminAgentEvidence(adminAccess, taskCheckout, pngUpload("attach-conflict"), actor);
  await assert.rejects(
    () => attachAdminAgentEvidence(adminAccess, taskShared, pngUpload("attach-conflict"), actor),
    (error: unknown) => (error as { reason?: string }).reason === "evidence_conflict",
  );
});

test("a missing or cross-organization task is not found", async () => {
  useFakeStorage();
  await assert.rejects(
    () => attachAdminAgentEvidence(adminAccess, otherTask, pngUpload("attach-other-org"), actor),
    (error: unknown) => (error as Error).name === "WorkOsNotFoundError",
  );
  await assert.rejects(
    () => attachAdminAgentEvidence(adminAccess, MISSING_TASK, pngUpload("attach-missing"), actor),
    (error: unknown) => (error as Error).name === "WorkOsNotFoundError",
  );
});

test("unsupported, oversized, and lying uploads are rejected before storage", async () => {
  const fake = useFakeStorage();
  await assert.rejects(
    () => attachAdminAgentEvidence(adminAccess, taskCheckout, {
      fileName: "page.html",
      contentType: "text/html",
      bytes: new TextEncoder().encode("<html></html>"),
      idempotencyKey: "attach-html",
    }, actor),
    CompletionEvidenceError,
  );
  await assert.rejects(
    () => attachAdminAgentEvidence(adminAccess, taskCheckout, {
      fileName: "huge.png",
      contentType: "image/png",
      bytes: new Uint8Array(COMPLETION_EVIDENCE_MAX_BYTES + 1),
      idempotencyKey: "attach-huge",
    }, actor),
    (error: unknown) => (error as CompletionEvidenceError).code === "file_too_large",
  );
  await assert.rejects(
    () => attachAdminAgentEvidence(adminAccess, taskCheckout, {
      fileName: "fake.png",
      contentType: "image/png",
      bytes: new TextEncoder().encode("not a png"),
      idempotencyKey: "attach-fake",
    }, actor),
    (error: unknown) => (error as CompletionEvidenceError).code === "unsupported_file_type",
  );
  assert.equal(fake.uploads.length, 0);
});

test("the download returns the stored bytes and content type, and hides other tenants", async () => {
  useFakeStorage();
  const { evidence } = await attachAdminAgentEvidence(adminAccess, taskCheckout, pngUpload("download-1"), actor);
  const id = String(evidence.id);
  const file = await getAdminAgentEvidenceFile(adminAccess, id);
  assert.ok(file);
  assert.equal(file.contentType, "image/png");
  assert.equal(file.fileName, "proof.png");
  assert.deepEqual([...file.bytes], [...PNG_BYTES]);

  assert.equal(await getAdminAgentEvidenceFile(adminAccess, randomUUID()), null);
  assert.equal(await getAdminAgentEvidenceFile(adminAccess, OTHER_EVIDENCE), null);
});

test("a shared task records no single attached-for person", async () => {
  useFakeStorage();
  const { evidence } = await attachAdminAgentEvidence(adminAccess, taskShared, pngUpload("attach-shared"), actor);
  const row = await evidenceRow(String(evidence.id));
  assert.equal(row.metrics.attachedForPersonId, undefined);
  assert.equal(row.metrics.adminUserId, adminUser);
});

test("progress is a task-scoped agent note, never completion proof", async () => {
  useFakeStorage();
  const progress = await addAdminAgentProgress(
    adminAccess,
    taskCheckout,
    { summary: "Checked the redirect", title: "Checkout check" },
    "progress-1",
    actor,
  );
  assert.equal(progress.origin, "admin_progress");
  assert.equal(progress.taskId, taskCheckout);

  const row = await evidenceRow(String(progress.id));
  assert.equal(row.person_id, null);
  assert.equal(row.task_id, taskCheckout);
  assert.equal(row.source, "agent");
  assert.equal(row.url, null);
  assert.equal(row.metrics.origin, "admin_progress");
  assert.equal(row.metrics.adminUserId, adminUser);
  assert.equal(row.metrics.adminTokenId, "token-1");
  assert.equal(row.metrics.attachedForPersonId, personA);
  assert.equal(row.metrics.evidenceClass, undefined);
  assert.equal(isTaskOutcomeEvidence(row as unknown as Json), false);

  const details = await getWorkOsEmployeeTaskDetails(adminAccess, taskCheckout);
  assert.equal((details.completionEvidence as Json[]).some((item) => item.id === progress.id), false);
  const forTask = await listEvidence(adminUser, { taskId: taskCheckout }) as Json[];
  assert.equal(forTask.filter((item) => item.id === progress.id && isTaskOutcomeEvidence(item)).length, 0);

  const { rows: audits } = await f.db.query<{ target_id: string; metadata: Record<string, unknown> }>(
    "select target_id, metadata from work_audit_log where action = 'admin.task.progress' order by id desc limit 1",
  );
  assert.equal(audits[0]?.target_id, taskCheckout);
  assert.equal(audits[0]?.metadata.tokenId, "token-1");
  assert.equal(audits[0]?.metadata.targetPersonId, personA);
});

test("a retried progress key returns the first row, and bad notes are rejected", async () => {
  useFakeStorage();
  const first = await addAdminAgentProgress(adminAccess, taskCheckout, { summary: "First pass" }, "progress-retry", actor);
  const second = await addAdminAgentProgress(adminAccess, taskCheckout, { summary: "First pass" }, "progress-retry", actor);
  assert.equal(second.id, first.id);
  assert.equal(await evidenceCount("progress-retry"), 1);

  await assert.rejects(
    () => addAdminAgentProgress(adminAccess, taskCheckout, { summary: "  " }, "progress-empty", actor),
    /summary is required/,
  );
  await assert.rejects(
    () => addAdminAgentProgress(adminAccess, taskCheckout, { summary: "Looks done", url: "https://example.test/x" }, "progress-url", actor),
    /cannot be set/,
  );
});

test("a read-only token cannot write progress or attach evidence", async () => {
  useFakeStorage();
  const token = await newToken(["tasks:read"]);

  const progress = await taskProgressPOST(
    jsonRequest(`/api/agent/admin/v1/tasks/${taskCheckout}/progress`, token, {
      key: "route-scope-progress",
      body: { summary: "Should not write" },
    }),
    taskParams(taskCheckout),
  );
  assert.equal(progress.status, 403);
  assert.equal(((await progress.json()) as Json).code, "insufficient_scope");

  const evidence = await taskEvidencePOST(
    evidenceRequest(taskCheckout, token, { key: "route-scope-evidence" }),
    taskParams(taskCheckout),
  );
  assert.equal(evidence.status, 403);
  assert.equal(((await evidence.json()) as Json).code, "insufficient_scope");
  assert.equal(storage.uploads.length, 0);
});

test("both additive write routes require an Idempotency-Key", async () => {
  useFakeStorage();
  const token = await newToken(WRITE_SCOPES);

  const progress = await taskProgressPOST(
    jsonRequest(`/api/agent/admin/v1/tasks/${taskCheckout}/progress`, token, { body: { summary: "No key" } }),
    taskParams(taskCheckout),
  );
  assert.equal(progress.status, 400);
  assert.equal(((await progress.json()) as Json).code, "validation_error");

  const evidence = await taskEvidencePOST(
    evidenceRequest(taskCheckout, token, { note: "No key" }),
    taskParams(taskCheckout),
  );
  assert.equal(evidence.status, 400);
  assert.equal(((await evidence.json()) as Json).code, "validation_error");
});

test("the progress route writes directly and replays the same row", async () => {
  useFakeStorage();
  const token = await newToken(WRITE_SCOPES);
  const body = { summary: "Route progress", title: "Route check" };

  const first = await taskProgressPOST(
    jsonRequest(`/api/agent/admin/v1/tasks/${taskCheckout}/progress`, token, { key: "route-progress", body }),
    taskParams(taskCheckout),
  );
  assert.equal(first.status, 201);
  const firstBody = await first.json() as { evidence: { id: string; origin: string } };
  assert.equal(firstBody.evidence.origin, "admin_progress");

  const second = await taskProgressPOST(
    jsonRequest(`/api/agent/admin/v1/tasks/${taskCheckout}/progress`, token, { key: "route-progress", body }),
    taskParams(taskCheckout),
  );
  assert.equal(second.status, 201);
  assert.equal(second.headers.get("idempotent-replay"), "true");
  assert.equal(((await second.json()) as { evidence: { id: string } }).evidence.id, firstBody.evidence.id);

  const row = await evidenceRow(firstBody.evidence.id);
  assert.equal(row.person_id, null);
  assert.equal(row.source, "agent");
});

test("the evidence route attaches one file and the download route serves it", async () => {
  const fake = useFakeStorage();
  const token = await newToken(WRITE_SCOPES);

  const attached = await taskEvidencePOST(
    evidenceRequest(taskCheckout, token, { key: "route-evidence", note: "Shipped from the route" }),
    taskParams(taskCheckout),
  );
  assert.equal(attached.status, 201);
  const evidence = ((await attached.json()) as { evidence: { id: string; url: string; contentType: string } }).evidence;
  assert.equal(evidence.contentType, "image/png");
  assert.equal(evidence.url, `/api/agent/admin/v1/evidence/${evidence.id}/file`);

  const replay = await taskEvidencePOST(
    evidenceRequest(taskCheckout, token, { key: "route-evidence", note: "Shipped from the route" }),
    taskParams(taskCheckout),
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.headers.get("idempotent-replay"), "true");
  assert.equal(((await replay.json()) as { evidence: { id: string } }).evidence.id, evidence.id);
  assert.equal(fake.uploads.length, 1);

  const download = await evidenceFileGET(downloadRequest(evidence.id, token), evidenceParams(evidence.id));
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "image/png");
  assert.match(download.headers.get("content-disposition") ?? "", /^inline; filename="proof\.png"$/);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()), PNG_BYTES);

  const missing = await evidenceFileGET(downloadRequest(randomUUID(), token), evidenceParams(randomUUID()));
  assert.equal(missing.status, 404);
  assert.equal(((await missing.json()) as Json).code, "not_found");
  const crossOrg = await evidenceFileGET(downloadRequest(OTHER_EVIDENCE, token), evidenceParams(OTHER_EVIDENCE));
  assert.equal(crossOrg.status, 404);
});

test("the evidence upload rejects a second file and oversized bytes", async () => {
  const fake = useFakeStorage();
  const token = await newToken(WRITE_SCOPES);
  const form = new FormData();
  form.append("file", new File([PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength) as ArrayBuffer], "one.png", { type: "image/png" }));
  form.append("file", new File([PNG_BYTES.buffer.slice(PNG_BYTES.byteOffset, PNG_BYTES.byteOffset + PNG_BYTES.byteLength) as ArrayBuffer], "two.png", { type: "image/png" }));
  const twoFiles = new Request(`https://example.test/api/agent/admin/v1/tasks/${taskCheckout}/evidence`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "Idempotency-Key": "route-two-files" },
    body: form,
  });
  const rejected = await taskEvidencePOST(twoFiles, taskParams(taskCheckout));
  assert.equal(rejected.status, 400);

  const huge = await taskEvidencePOST(
    evidenceRequest(taskCheckout, token, {
      key: "route-huge",
      bytes: new Uint8Array(COMPLETION_EVIDENCE_MAX_BYTES + 1),
      name: "huge.png",
    }),
    taskParams(taskCheckout),
  );
  assert.equal(huge.status, 413);
  assert.equal(((await huge.json()) as Json).code, "file_too_large");
  assert.equal(fake.uploads.length, 0);
});

test("the download route requires the read scope and a write route is rate limited", async () => {
  useFakeStorage();
  const readScopes = await newToken(["tasks:write"]);
  const denied = await evidenceFileGET(downloadRequest(OTHER_EVIDENCE, readScopes), evidenceParams(OTHER_EVIDENCE));
  assert.equal(denied.status, 403);

  // The write limiter is 20 per token per minute; the twenty-first write is a
  // 429, which proves the routes claim the write budget, not the read budget.
  const token = await newToken(WRITE_SCOPES);
  for (let index = 0; index < 20; index += 1) {
    const response = await taskProgressPOST(
      jsonRequest(`/api/agent/admin/v1/tasks/${taskCheckout}/progress`, token, {
        key: `rate-${index}`,
        body: { summary: `Rate note ${index}` },
      }),
      taskParams(taskCheckout),
    );
    assert.equal(response.status, 201, `write ${index} should be accepted`);
  }
  const limited = await taskProgressPOST(
    jsonRequest(`/api/agent/admin/v1/tasks/${taskCheckout}/progress`, token, {
      key: "rate-overflow",
      body: { summary: "One too many" },
    }),
    taskParams(taskCheckout),
  );
  assert.equal(limited.status, 429);
  assert.equal(((await limited.json()) as Json).code, "rate_limited");
});
