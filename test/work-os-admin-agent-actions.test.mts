import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  adminEodPreviewState,
  adminTaskPreviewState,
  applyAdminAction,
  previewAdminAction,
  validateAdminTaskCreate,
  type AdminAgentActionServices,
} from "../src/lib/work-admin-agent-actions";
import { previewFingerprint } from "../src/lib/work-admin-action-previews";
import type { AdminAgentEodDetail } from "../src/lib/work-admin-agent-eods";
import type { AdminPreviewAction } from "../src/modules/work-os/admin-agent/contracts";
import {
  adminAccess,
  adminUser,
  fixture,
  mappedAdminAccess,
  personA,
  personB,
  personC,
} from "./helpers/work-os-admin-agent-fixture.mts";

/** tsx loads an extensionless relative import through a CommonJS preparse
 * virtual module, so the class object can differ from the one an aliased
 * `@/lib/...` import loads. The error carries a stable `name`, which is the same
 * discriminator the server's error mapper uses. */
function isValidationError(error: unknown): boolean {
  return error instanceof Error && error.name === "WorkOsValidationError";
}

/** The preview layer is deliberately service-shaped: these tests hand it fakes
 * and assert what it would describe, store, and send, while the audit write
 * (the one side effect apply owns) runs against the PGlite fixture. Nothing
 * here needs a real task table, which is the point of the dependency boundary. */

type Json = Record<string, unknown>;

const task: Json = {
  id: "t1",
  title: "Ship",
  assignee_person_ids: [personA],
  completed: false,
  status: "open",
  updated_at: "2026-11-02T00:00:00Z",
  parent_task_id: null,
};

const ada = { id: personA, displayName: "Ada Lovelace", active: true };
const grace = { id: personB, displayName: "Grace Hopper", active: true };
const linus = { id: personC, displayName: "Linus Torvalds", active: false };

type FakeExtras = {
  /** Tasks returned by id; a missing id falls back to the supplied row. */
  tasks?: Record<string, Json>;
  /** The row createTask returns; defaults to the supplied task plus payload. */
  created?: Json;
  /** The production detail shape the EOD reader returns; null means not found. */
  report?: AdminAgentEodDetail | null;
  /** Directory used to name and validate assignees. */
  people?: Array<{ id: string; displayName: string; active?: boolean }>;
};

function fakeServices(taskRow: Json, extras: FakeExtras = {}) {
  const calls = {
    getTask: [] as string[],
    createTask: [] as Array<{
      payload: Json;
      options?: { idempotencyKey?: string; actor?: { tokenId: string; tokenName: string } };
    }>,
    updateTask: [] as Array<{ taskId: string; payload: Json }>,
    moveTask: [] as Array<{ taskId: string; parentTaskId: string }>,
    completeTask: [] as Array<{ taskId: string; completed: boolean }>,
    archiveTask: [] as Array<{ taskId: string; mode: "archive" | "delete" }>,
    getEod: [] as string[],
    reviewEod: [] as Array<{ reportId: string; body: Json; reviewerPersonId?: string | null }>,
  };
  const createdByIdempotencyKey = new Map<string, Json>();
  const services: AdminAgentActionServices = {
    getTask: async (_access, taskId) => {
      calls.getTask.push(taskId);
      return extras.tasks?.[taskId] ?? taskRow;
    },
    createTask: async (_access, payload, options) => {
      calls.createTask.push({ payload, options });
      const key = options?.idempotencyKey;
      if (key && createdByIdempotencyKey.has(key)) return createdByIdempotencyKey.get(key) as Json;
      const created = extras.created ?? { ...taskRow, ...payload };
      if (key) createdByIdempotencyKey.set(key, created);
      return created;
    },
    updateTask: async (_access, taskId, payload) => {
      calls.updateTask.push({ taskId, payload });
      return taskRow;
    },
    moveTask: async (_access, taskId, parentTaskId) => {
      calls.moveTask.push({ taskId, parentTaskId });
      return { ...taskRow, parent_task_id: parentTaskId };
    },
    completeTask: async (_access, taskId, completed) => {
      calls.completeTask.push({ taskId, completed });
      return { ...taskRow, completed };
    },
    archiveTask: async (_access, taskId, mode) => {
      calls.archiveTask.push({ taskId, mode });
      return taskRow;
    },
    getEod: async (_access, reportId) => {
      calls.getEod.push(reportId);
      return extras.report ?? null;
    },
    reviewEod: async (_access, reportId, body, reviewerPersonId) => {
      calls.reviewEod.push({ reportId, body, reviewerPersonId });
      return (extras.report ?? taskRow) as unknown as Json;
    },
    ...(extras.people
      ? {
        listPeople: async () => (extras.people ?? []).map((person) => ({
          id: person.id,
          displayName: person.displayName,
          active: person.active !== false,
        })),
      }
      : {}),
  };
  return { services, calls, createdByIdempotencyKey };
}

const token = {
  tokenId: "90000000-0000-4000-8000-000000000011",
  tokenName: "Admin laptop",
  previewId: "91000000-0000-4000-8000-000000000021",
  reviewerPersonId: null as string | null,
};

/** The resolved membership person travels with the applied action so a decision
 * is self-review checked even when the token itself is unmapped. */
const reviewerToken = { ...token, reviewerPersonId: personA };

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
after(async () => { await f.close(); });

async function lastAudit(action: string) {
  const { rows } = await f.db.query<{
    action: string;
    target_type: string;
    target_id: string | null;
    actor_user_id: string | null;
    metadata: Json;
  }>("select action, target_type, target_id, actor_user_id, metadata from work_audit_log where action = $1 order by id desc limit 1", [action]);
  return rows[0];
}

test("assign add resolves the final list once and lists the change", async () => {
  const { services, calls } = fakeServices(task);
  const preview = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "add", person_ids: [personB] },
    services,
  );
  assert.deepEqual(preview.changes, [{ field: "assignees", from: [personA], to: [personA, personB] }]);
  // The stored state is the target before the action, not the planned result.
  assert.deepEqual(preview.state, adminTaskPreviewState(task));
  assert.deepEqual((preview.state as Json).assignees, [personA]);
  assert.deepEqual(preview.request.final_assignee_person_ids, [personA, personB]);
  // The final list is resolved against one snapshot, not once per id.
  assert.deepEqual(calls.getTask, ["t1"]);
});

test("remove and replace are exact final lists", async () => {
  const shared = { ...task, assignee_person_ids: [personA, personB] };
  const remove = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "remove", person_ids: [personA] },
    fakeServices(shared).services,
  );
  assert.deepEqual(remove.changes, [{ field: "assignees", from: [personA, personB], to: [personB] }]);
  assert.deepEqual(remove.request.final_assignee_person_ids, [personB]);

  const replace = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "replace", person_ids: [personC, personC] },
    fakeServices(shared, { people: [ada, grace, { ...linus, active: true }] }).services,
  );
  assert.deepEqual(replace.changes, [{ field: "assignees", from: [personA, personB], to: [personC] }]);
  assert.deepEqual(replace.request.final_assignee_person_ids, [personC]);

  const empty = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "replace", person_ids: [] },
    fakeServices(shared, { people: [ada, grace] }).services,
  );
  assert.ok(empty.warnings.some((warning) => /no assignees/i.test(warning)));
});

test("assign rejects an inactive or unknown person instead of warning", async () => {
  for (const requested of [[personC], ["90000000-0000-4000-8000-000000000099"]]) {
    await assert.rejects(
      previewAdminAction(
        adminAccess,
        "task.assign",
        { task_id: "t1", mode: "add", person_ids: requested },
        fakeServices(task, { people: [ada, grace, linus] }).services,
      ),
      (error: unknown) => isValidationError(error)
        && /Assignees must be active Work OS organization members/.test((error as Error).message),
    );
  }
});

test("assign rejects an unknown mode and a malformed person list", async () => {
  await assert.rejects(
    previewAdminAction(adminAccess, "task.assign", { task_id: "t1", mode: "append", person_ids: [] }, fakeServices(task).services),
    isValidationError,
  );
  await assert.rejects(
    previewAdminAction(adminAccess, "task.assign", { task_id: "t1", mode: "add", person_ids: [" "] }, fakeServices(task).services),
    isValidationError,
  );
});

test("move changes the parent and keeps the pre-action state", async () => {
  const subtask = { ...task, id: "t1", parent_task_id: "t0", project_id: "project-1" };
  const parent = { id: "t2", title: "Parent", parent_task_id: null, project_id: "project-1" };
  const otherProject = { id: "t3", title: "Elsewhere", parent_task_id: null, project_id: "project-2" };
  const nested = { id: "t4", title: "Nested", parent_task_id: "t2", project_id: "project-1" };

  const moved = await previewAdminAction(
    adminAccess,
    "task.move",
    { task_id: "t1", parent_task_id: "t2" },
    fakeServices(subtask, { tasks: { t1: subtask, t2: parent } }).services,
  );
  assert.deepEqual(moved.changes, [{ field: "parent", from: "t0", to: "t2" }]);
  assert.equal((moved.state as Json).parentId, "t0");
  assert.deepEqual(moved.request.parent_task_id, "t2");
  assert.deepEqual(moved.warnings, []);

  const differentProject = await previewAdminAction(
    adminAccess,
    "task.move",
    { task_id: "t1", parent_task_id: "t3" },
    fakeServices(subtask, { tasks: { t1: subtask, t3: otherProject } }).services,
  );
  assert.ok(differentProject.warnings.some((warning) => /another project/i.test(warning)));

  const nestedTarget = await previewAdminAction(
    adminAccess,
    "task.move",
    { task_id: "t1", parent_task_id: "t4" },
    fakeServices(subtask, { tasks: { t1: subtask, t4: nested } }).services,
  );
  assert.ok(nestedTarget.warnings.some((warning) => /top-level/i.test(warning)));

  const topLevel = await previewAdminAction(
    adminAccess,
    "task.move",
    { task_id: "t1", parent_task_id: "t2" },
    fakeServices({ ...task, id: "t1", parent_task_id: null, project_id: "project-1" }, {
      tasks: { t1: { ...task, id: "t1", parent_task_id: null, project_id: "project-1" }, t2: parent },
    }).services,
  );
  assert.ok(topLevel.warnings.some((warning) => /subtasks can be moved/i.test(warning)));
});

test("a stale preview does not apply", async () => {
  const current: Json = { ...task, assignee_person_ids: [personA] };
  const { services, calls } = fakeServices(current);
  const preview = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "add", person_ids: [personB] },
    services,
  );
  const stored = previewFingerprint(preview.state);

  // The target moved on after the preview was described: a fresh projection
  // fingerprints differently, and apply refuses the stored state.
  current.updated_at = "2026-11-02T01:00:00Z";
  assert.notEqual(previewFingerprint(adminTaskPreviewState(current)), stored);
  await assert.rejects(
    applyAdminAction(adminAccess, "task.assign", preview.request, services, token, preview.state),
    (error: unknown) => (error as Error)?.name === "WorkOsConflictError"
      && (error as { reason?: string }).reason === "preview_stale"
      && /stale/i.test((error as Error).message),
  );
  assert.deepEqual(calls.updateTask, []);
  assert.deepEqual(calls.createTask, []);
  assert.deepEqual(calls.moveTask, []);
});

test("create names the owners from the requested people and rejects an unknown id", async () => {
  const { services } = fakeServices(task, { people: [ada, grace] });
  const preview = await previewAdminAction(
    adminAccess,
    "task.create",
    { name: "Ship", assignee_person_ids: [personB], project_id: "project-1", due_date: "2026-11-15" },
    services,
  );
  assert.equal(preview.summary, "Create Ship for Grace Hopper");
  assert.deepEqual(preview.state, {});
  assert.deepEqual(preview.targetId, null);
  assert.deepEqual(preview.changes, [
    { field: "name", from: null, to: "Ship" },
    { field: "owners", from: [], to: [personB] },
    { field: "project", from: null, to: "project-1" },
    { field: "due_date", from: null, to: "2026-11-15" },
  ]);
  assert.deepEqual(preview.request.assignee_person_ids, [personB]);
  assert.deepEqual(preview.request.resolved_owner_person_ids, [personB]);

  const unowned = await previewAdminAction(
    adminAccess,
    "task.create",
    { name: "Ship" },
    services,
  );
  assert.equal(unowned.summary, "Create Ship for unassigned");
  assert.deepEqual((unowned.changes[1] as { to: unknown }).to, []);
  assert.deepEqual(unowned.request.assignee_person_ids, []);

  await assert.rejects(
    previewAdminAction(
      adminAccess,
      "task.create",
      { name: "Ship", assignee_person_ids: ["90000000-0000-4000-8000-000000000099"] },
      services,
    ),
    (error: unknown) => isValidationError(error) && /active Work OS organization members/.test((error as Error).message),
  );
});

test("a mapped admin creating a subtask never inherits the caller as owner", async () => {
  const { services, calls } = fakeServices(task, { people: [ada, grace] });
  const preview = await previewAdminAction(
    mappedAdminAccess,
    "task.create",
    { name: "Sub", parent_task_id: "t0" },
    services,
  );
  assert.equal(mappedAdminAccess.personId, personA);
  assert.equal(preview.summary, "Create Sub for unassigned");
  assert.deepEqual(preview.changes[1], { field: "owners", from: [], to: [] });
  assert.deepEqual(preview.request.assignee_person_ids, []);

  await applyAdminAction(mappedAdminAccess, "task.create", preview.request, services, token);
  // The explicit empty list is what stops the delegated create service from
  // defaulting a subtask to the mapped caller.
  assert.deepEqual((calls.createTask[0].payload as Json).assignee_person_ids, []);
});

test("an unmapped admin previews an assignment without inventing a person", async () => {
  assert.equal(adminAccess.personId, null);
  const preview = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "add", person_ids: [personB] },
    fakeServices(task).services,
  );
  assert.equal((preview.changes[0].to as string[]).includes(personB), true);
  assert.equal(adminAccess.personId, null);
});

test("update describes each supplied field against the task state", async () => {
  const current = {
    ...task,
    title: "Ship",
    description: "Old",
    due_date: "2026-11-10",
    labels: ["release"],
  };
  const preview = await previewAdminAction(
    adminAccess,
    "task.update",
    { task_id: "t1", name: "Ship it", due_date: "2026-11-20", labels: ["release", "launch"] },
    fakeServices(current).services,
  );
  assert.equal(preview.summary, "Update Ship");
  assert.deepEqual(preview.changes, [
    { field: "name", from: "Ship", to: "Ship it" },
    { field: "due_date", from: "2026-11-10", to: "2026-11-20" },
    { field: "labels", from: ["release"], to: ["release", "launch"] },
  ]);
  assert.deepEqual(preview.state, adminTaskPreviewState(current));
  assert.equal((preview.request as Json).task_id, "t1");
});

test("validateAdminTaskCreate normalizes the employee create fields", () => {
  const validated = validateAdminTaskCreate({
    name: "  Ship  ",
    description: "  Release work  ",
    due_date: "2026-11-15",
    start_date: null,
    priority: "high",
    labels: ["release", "release"],
    story_points: 3,
    expected_outcome: "Shipped",
    definition_of_done: "Tests pass",
    estimated_effort_minutes: 90,
    effort_unit: "minutes",
    task_group_id: "group-1",
    parent_task_id: null,
    project_id: "project-1",
    assignee_person_ids: [personA, personA],
  }, [personA, personB]);
  assert.equal(validated.name, "Ship");
  assert.equal(validated.description, "Release work");
  assert.deepEqual(validated.labels, ["release"]);
  assert.deepEqual(validated.assignee_person_ids, [personA]);
  assert.equal(validated.due_date, "2026-11-15");
});

test("validateAdminTaskCreate always emits an assignee list", () => {
  assert.deepEqual(validateAdminTaskCreate({ name: "Ship" }).assignee_person_ids, []);
  assert.deepEqual(validateAdminTaskCreate({ name: "Ship" }, [personA]).assignee_person_ids, []);
});

test("validateAdminTaskCreate rejects unknown fields, a blank title, and bad dates", () => {
  for (const payload of [
    { name: "Ship", completed: true },
    { name: "   " },
    { name: "Ship", due_date: "2026-02-30" },
    { name: "Ship", labels: "release" },
    { name: "Ship", assignee_person_ids: [personA] },
  ]) {
    assert.throws(
      () => validateAdminTaskCreate(payload, [personB]),
      isValidationError,
      JSON.stringify(payload),
    );
  }
});

test("a null or non-object payload is a validation error, not a crash", async () => {
  const { services } = fakeServices(task);
  for (const action of ["task.update", "task.assign", "task.move"] as AdminPreviewAction[]) {
    await assert.rejects(
      previewAdminAction(adminAccess, action, null as unknown as Json, services),
      isValidationError,
      action,
    );
  }
});

test("previews never execute a consequential write", async () => {
  const subtask = { ...task, parent_task_id: "t0", project_id: "project-1" };
  const parent = { id: "t2", title: "Parent", parent_task_id: null, project_id: "project-1" };
  const { services, calls } = fakeServices(subtask, { people: [ada, grace], tasks: { t1: subtask, t2: parent } });

  await previewAdminAction(adminAccess, "task.create", { name: "New" }, services);
  await previewAdminAction(adminAccess, "task.update", { task_id: "t1", name: "Renamed" }, services);
  await previewAdminAction(adminAccess, "task.assign", { task_id: "t1", mode: "add", person_ids: [personB] }, services);
  await previewAdminAction(adminAccess, "task.move", { task_id: "t1", parent_task_id: "t2" }, services);

  assert.deepEqual(calls.createTask, []);
  assert.deepEqual(calls.updateTask, []);
  assert.deepEqual(calls.moveTask, []);
  assert.deepEqual(calls.completeTask, []);
  assert.deepEqual(calls.archiveTask, []);
  assert.deepEqual(calls.reviewEod, []);
});

test("apply assign uses the stored resolved request and audits the admin actor", async () => {
  const { services, calls } = fakeServices(task);
  const preview = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "add", person_ids: [personB] },
    services,
  );
  const result = await applyAdminAction(adminAccess, "task.assign", preview.request, services, token, preview.state);
  assert.equal(result.status, 200);
  assert.deepEqual(calls.updateTask, [
    { taskId: "t1", payload: { assignee_person_ids: [personA, personB] } },
  ]);
  const auditRow = await lastAudit("admin.task.assign");
  assert.equal(auditRow.target_type, "work_os_task");
  assert.equal(auditRow.target_id, "t1");
  assert.equal(auditRow.actor_user_id, adminUser);
  assert.equal(auditRow.metadata.tokenId, token.tokenId);
  assert.equal(auditRow.metadata.tokenName, token.tokenName);
  assert.equal(auditRow.metadata.action, "task.assign");
  assert.deepEqual(auditRow.metadata.changes, [
    { field: "assignees", from: [personA], to: [personA, personB] },
  ]);
});

test("apply replace sends the previewed final list", async () => {
  const shared = { ...task, assignee_person_ids: [personA, personB] };
  const { services, calls } = fakeServices(shared, { people: [ada, grace, { ...linus, active: true }] });
  const preview = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "replace", person_ids: [personC] },
    services,
  );
  await applyAdminAction(adminAccess, "task.assign", preview.request, services, token, preview.state);
  assert.deepEqual(calls.updateTask, [
    { taskId: "t1", payload: { assignee_person_ids: [personC] } },
  ]);
});

test("apply uses the resolved list, not a delta against newer state", async () => {
  const shared: Json = { ...task, assignee_person_ids: [personA, personB] };
  const { services, calls } = fakeServices(shared);
  const preview = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "remove", person_ids: [personA] },
    services,
  );
  // A concurrent writer adds a third person after the preview. The stored
  // request still names the list the admin approved.
  shared.assignee_person_ids = [personA, personB, personC];
  await applyAdminAction(adminAccess, "task.assign", preview.request, services, token);
  assert.deepEqual(calls.updateTask, [
    { taskId: "t1", payload: { assignee_person_ids: [personB] } },
  ]);
});

test("apply create returns 201, keys the create, and audits the provider id", async () => {
  const created = {
    ...task,
    id: "t9",
    title: "Ship",
    provider: "local",
    provider_task_id: "pt-t9",
    assignee_person_ids: [personB],
  };
  const { services, calls } = fakeServices(task, { people: [ada, grace], created });
  const preview = await previewAdminAction(
    adminAccess,
    "task.create",
    { name: "Ship", assignee_person_ids: [personB] },
    services,
  );
  const result = await applyAdminAction(adminAccess, "task.create", preview.request, services, token);
  assert.equal(result.status, 201);
  assert.deepEqual(calls.createTask[0].payload, { name: "Ship", assignee_person_ids: [personB] });
  assert.equal(calls.createTask[0].options?.idempotencyKey, token.previewId);
  assert.deepEqual(calls.createTask[0].options?.actor, {
    tokenId: token.tokenId,
    tokenName: token.tokenName,
  });
  assert.deepEqual((result.body as Json).task, created);
  const auditRow = await lastAudit("admin.task.create");
  assert.equal(auditRow.target_type, "work_os_task");
  assert.equal(auditRow.target_id, "pt-t9");
  assert.equal(auditRow.actor_user_id, adminUser);
  assert.equal(auditRow.metadata.action, "task.create");
});

test("a create whose audit fails does not duplicate the task on retry", async () => {
  const { services, calls, createdByIdempotencyKey } = fakeServices(task, { people: [ada, grace] });
  const payload = { name: "Ship" };

  await f.db.query("alter table work_audit_log rename to work_audit_log_hidden");
  try {
    await assert.rejects(
      applyAdminAction(adminAccess, "task.create", payload, services, token),
      /audit log/,
    );
  } finally {
    await f.db.query("alter table work_audit_log_hidden rename to work_audit_log");
  }
  assert.equal(calls.createTask.length, 1);
  assert.equal(createdByIdempotencyKey.size, 1);

  const retried = await applyAdminAction(adminAccess, "task.create", payload, services, token);
  assert.equal(retried.status, 201);
  assert.equal(calls.createTask.length, 2);
  assert.equal(createdByIdempotencyKey.size, 1);
  assert.equal(calls.createTask[0].options?.idempotencyKey, calls.createTask[1].options?.idempotencyKey);
  assert.equal(calls.createTask[1].options?.idempotencyKey, token.previewId);
});

test("apply update and move use the stored payload and audit their target", async () => {
  const { services, calls } = fakeServices(task);
  const updatePreview = await previewAdminAction(
    adminAccess,
    "task.update",
    { task_id: "t1", name: "Ship it" },
    services,
  );
  const updated = await applyAdminAction(adminAccess, "task.update", updatePreview.request, services, token, updatePreview.state);
  assert.equal(updated.status, 200);
  assert.deepEqual(calls.updateTask, [{ taskId: "t1", payload: { name: "Ship it" } }]);
  const updateAudit = await lastAudit("admin.task.update");
  assert.equal(updateAudit.target_type, "work_os_task");
  assert.equal(updateAudit.target_id, "t1");
  assert.equal(updateAudit.actor_user_id, adminUser);

  const movePreview = await previewAdminAction(
    adminAccess,
    "task.move",
    { task_id: "t1", parent_task_id: "t2" },
    services,
  );
  const moved = await applyAdminAction(adminAccess, "task.move", movePreview.request, services, token, movePreview.state);
  assert.equal(moved.status, 200);
  assert.deepEqual(calls.moveTask, [{ taskId: "t1", parentTaskId: "t2" }]);
  const moveAudit = await lastAudit("admin.task.move");
  assert.equal(moveAudit.target_type, "work_os_task");
  assert.equal(moveAudit.target_id, "t1");
  assert.equal(moveAudit.actor_user_id, adminUser);
});

test("apply refuses an action it does not recognize", async () => {
  const { services } = fakeServices(task);
  await assert.rejects(
    applyAdminAction(adminAccess, "task.explode" as AdminPreviewAction, { task_id: "t1" }, services, token),
    isValidationError,
  );
});

// ---------------------------------------------------------------------------
// Task lifecycle: complete, reopen, archive, delete
// ---------------------------------------------------------------------------

test("complete blocks a task with an expected outcome until evidence exists", async () => {
  const outcome = { ...task, expected_outcome: "Ship" };
  const preview = await previewAdminAction(
    adminAccess,
    "task.complete",
    { task_id: "t1" },
    fakeServices(outcome).services,
  );
  assert.ok(preview.warnings.some((warning) => /evidence/i.test(warning)));
  assert.deepEqual(preview.changes, [{ field: "completed", from: false, to: true }]);
  assert.equal((preview.state as Json).completed, false);
  assert.deepEqual(preview.request, { task_id: "t1" });

  // Evidence already attached: the completion is ready to apply.
  const evidenced = await previewAdminAction(
    adminAccess,
    "task.complete",
    { task_id: "t1" },
    fakeServices({ ...outcome, completion_evidence: [{ id: "e1" }] }).services,
  );
  assert.deepEqual(evidenced.warnings, []);

  // A plain task records no outcome, so it never asks for evidence.
  const plain = await previewAdminAction(
    adminAccess,
    "task.complete",
    { task_id: "t1" },
    fakeServices(task).services,
  );
  assert.deepEqual(plain.warnings, []);
});

test("reopen reports the current completion and warns when already open", async () => {
  const done = { ...task, completed: true, status: "completed" };
  const preview = await previewAdminAction(
    adminAccess,
    "task.reopen",
    { task_id: "t1" },
    fakeServices(done).services,
  );
  assert.equal(preview.summary, "Reopen Ship");
  assert.deepEqual(preview.changes, [{ field: "completed", from: true, to: false }]);
  assert.equal((preview.state as Json).completed, true);

  const alreadyOpen = await previewAdminAction(
    adminAccess,
    "task.reopen",
    { task_id: "t1" },
    fakeServices(task).services,
  );
  assert.ok(alreadyOpen.warnings.some((warning) => /already open/i.test(warning)));

  const alreadyDone = await previewAdminAction(
    adminAccess,
    "task.complete",
    { task_id: "t1" },
    fakeServices(done).services,
  );
  assert.ok(alreadyDone.warnings.some((warning) => /already complete/i.test(warning)));
});

test("complete and reopen warn instead of previewing a clean write on an archived target", async () => {
  // The write service answers not-found for archived/deleted rows even though
  // the admin detail reader can still load them.
  for (const status of ["archived", "deleted"]) {
    const target = { ...task, status };
    const complete = await previewAdminAction(
      adminAccess,
      "task.complete",
      { task_id: "t1" },
      fakeServices(target).services,
    );
    assert.ok(
      complete.warnings.some((warning) => new RegExp(status).test(warning)),
      `task.complete ${status}`,
    );
    assert.ok(complete.warnings.some((warning) => /restore it/i.test(warning)));

    const reopen = await previewAdminAction(
      adminAccess,
      "task.reopen",
      { task_id: "t1" },
      fakeServices(target).services,
    );
    assert.ok(
      reopen.warnings.some((warning) => new RegExp(status).test(warning)),
      `task.reopen ${status}`,
    );
  }
});

test("apply complete and reopen call the completion service with the action's flag", async () => {
  const done = { ...task, completed: true, status: "completed" };
  const completeServices = fakeServices(task);
  const completePreview = await previewAdminAction(
    adminAccess,
    "task.complete",
    { task_id: "t1" },
    completeServices.services,
  );
  const completed = await applyAdminAction(
    adminAccess,
    "task.complete",
    completePreview.request,
    completeServices.services,
    token,
    completePreview.state,
  );
  assert.equal(completed.status, 200);
  assert.deepEqual(completeServices.calls.completeTask, [{ taskId: "t1", completed: true }]);
  const completeAudit = await lastAudit("admin.task.complete");
  assert.equal(completeAudit.target_type, "work_os_task");
  assert.equal(completeAudit.target_id, "t1");
  assert.equal(completeAudit.actor_user_id, adminUser);
  assert.equal(completeAudit.metadata.tokenId, token.tokenId);
  assert.equal(completeAudit.metadata.tokenName, token.tokenName);
  assert.equal(completeAudit.metadata.action, "task.complete");
  assert.deepEqual(completeAudit.metadata.changes, [{ field: "completed", from: false, to: true }]);

  const reopenServices = fakeServices(done);
  const reopenPreview = await previewAdminAction(
    adminAccess,
    "task.reopen",
    { task_id: "t1" },
    reopenServices.services,
  );
  const reopened = await applyAdminAction(
    adminAccess,
    "task.reopen",
    reopenPreview.request,
    reopenServices.services,
    token,
    reopenPreview.state,
  );
  assert.equal(reopened.status, 200);
  assert.deepEqual(reopenServices.calls.completeTask, [{ taskId: "t1", completed: false }]);
  const reopenAudit = await lastAudit("admin.task.reopen");
  assert.equal(reopenAudit.target_type, "work_os_task");
  assert.equal(reopenAudit.actor_user_id, adminUser);
});

test("archive and delete are distinct previews", async () => {
  assert.equal(
    (await previewAdminAction(adminAccess, "task.archive", { task_id: "t1" }, fakeServices(task).services)).summary,
    "Archive Ship",
  );
  assert.equal(
    (await previewAdminAction(adminAccess, "task.delete", { task_id: "t1" }, fakeServices(task).services)).summary,
    "Delete Ship",
  );

  const archive = await previewAdminAction(adminAccess, "task.archive", { task_id: "t1" }, fakeServices(task).services);
  assert.deepEqual(archive.changes, [{ field: "status", from: "open", to: "archived" }]);
  assert.equal(archive.targetType, "task");
  assert.equal(archive.targetId, "t1");
  assert.deepEqual(archive.request, { task_id: "t1" });

  const remove = await previewAdminAction(adminAccess, "task.delete", { task_id: "t1" }, fakeServices(task).services);
  assert.deepEqual(remove.changes, [{ field: "status", from: "open", to: "deleted" }]);
});

test("archive and delete previews warn about the children they cascade to", async () => {
  const parent = { ...task, subtasks: [{ id: "s1" }, { id: "s2" }] };
  const archive = await previewAdminAction(adminAccess, "task.archive", { task_id: "t1" }, fakeServices(parent).services);
  assert.ok(archive.warnings.some((warning) => /2 subtasks/i.test(warning)));

  const remove = await previewAdminAction(adminAccess, "task.delete", { task_id: "t1" }, fakeServices(parent).services);
  assert.ok(remove.warnings.some((warning) => /2 subtasks/i.test(warning)));

  const alreadyArchived = await previewAdminAction(
    adminAccess,
    "task.archive",
    { task_id: "t1" },
    fakeServices({ ...task, status: "archived" }).services,
  );
  assert.ok(alreadyArchived.warnings.some((warning) => /already archived/i.test(warning)));
});

test("apply archive and delete call the removal service with the right mode", async () => {
  const archiveServices = fakeServices(task);
  const archivePreview = await previewAdminAction(adminAccess, "task.archive", { task_id: "t1" }, archiveServices.services);
  const archived = await applyAdminAction(
    adminAccess,
    "task.archive",
    archivePreview.request,
    archiveServices.services,
    token,
    archivePreview.state,
  );
  assert.equal(archived.status, 200);
  assert.deepEqual(archiveServices.calls.archiveTask, [{ taskId: "t1", mode: "archive" }]);
  const archiveAudit = await lastAudit("admin.task.archive");
  assert.equal(archiveAudit.target_type, "work_os_task");
  assert.equal(archiveAudit.target_id, "t1");
  assert.equal(archiveAudit.actor_user_id, adminUser);
  assert.equal(archiveAudit.metadata.action, "task.archive");

  const deleteServices = fakeServices(task);
  const deletePreview = await previewAdminAction(adminAccess, "task.delete", { task_id: "t1" }, deleteServices.services);
  const deleted = await applyAdminAction(
    adminAccess,
    "task.delete",
    deletePreview.request,
    deleteServices.services,
    token,
    deletePreview.state,
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleteServices.calls.archiveTask, [{ taskId: "t1", mode: "delete" }]);
  const deleteAudit = await lastAudit("admin.task.delete");
  assert.equal(deleteAudit.target_type, "work_os_task");
  assert.equal(deleteAudit.actor_user_id, adminUser);
});

// ---------------------------------------------------------------------------
// EOD review
// ---------------------------------------------------------------------------

/** The production reader (`getAdminAgentEod` → `toEodDetail`) returns this
 * camelCase shape: `person.id`/`person.displayName`, `managerNotes`,
 * `updatedAt`. Tests use it verbatim so the branches production actually takes
 * are the branches under test. */
function eodReport(overrides: Partial<AdminAgentEodDetail> = {}): AdminAgentEodDetail {
  return {
    id: "r1",
    person: { id: personB, displayName: "Grace Hopper" },
    reportDate: "2026-11-02",
    status: "pending_review",
    title: "Checkout ship log",
    excerpt: "Shipped the checkout flow",
    submittedAt: "2026-11-02T10:00:00.000Z",
    reviewedAt: null,
    createdAt: "2026-11-02T09:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00Z",
    markdown: "# Checkout",
    submittedMarkdown: "# Checkout",
    managerNotes: null,
    reviewedBy: null,
    metrics: {},
    missingEvidence: [] as unknown as AdminAgentEodDetail["missingEvidence"],
    ...overrides,
  };
}

const pendingReport = eodReport();

test("EOD review preview names the decision and preserves self-review refusal", async () => {
  const preview = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved", manager_notes: "Looks good" },
    fakeServices(task, { report: pendingReport }).services,
    { reviewerPersonId: personA },
  );
  assert.match(preview.summary, /Approve EOD for Grace Hopper/);
  assert.deepEqual(preview.state, { status: "pending_review", updatedAt: "2026-11-02T00:00:00Z" });
  assert.deepEqual(preview.state, adminEodPreviewState(pendingReport));
  assert.deepEqual(preview.changes, [
    { field: "status", from: "pending_review", to: "approved" },
    { field: "manager_notes", from: null, to: "Looks good" },
  ]);
  assert.equal(preview.targetType, "eod");
  assert.equal(preview.targetId, "r1");
  assert.deepEqual(preview.request, {
    report_id: "r1",
    status: "approved",
    manager_notes: "Looks good",
  });
  assert.deepEqual(preview.warnings, []);

  // The camelCase `managerNotes` the detail read returns is the change source.
  const existingNotes = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved", manager_notes: "Second look" },
    fakeServices(task, { report: eodReport({ managerNotes: "Earlier note" }) }).services,
    { reviewerPersonId: personA },
  );
  assert.deepEqual(existingNotes.changes[1], {
    field: "manager_notes",
    from: "Earlier note",
    to: "Second look",
  });

  const own = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved" },
    fakeServices(task, { report: eodReport({ person: { id: personA, displayName: "Ada Lovelace" } }) }).services,
    { reviewerPersonId: personA },
  );
  assert.ok(own.warnings.some((warning) => /own report/i.test(warning)));

  const rejected = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "rejected" },
    fakeServices(task, { report: pendingReport }).services,
    { reviewerPersonId: personA },
  );
  assert.match(rejected.summary, /Reject EOD for Grace Hopper/);
  assert.deepEqual(rejected.changes, [{ field: "status", from: "pending_review", to: "rejected" }]);
});

test("the reviewer person option is explicit and falls back to the access person", async () => {
  // Omitted option: a bare unmapped access has nobody to compare against.
  const unmapped = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved" },
    fakeServices(task, { report: eodReport({ person: { id: personA, displayName: "Ada Lovelace" } }) }).services,
  );
  assert.equal(adminAccess.personId, null);
  assert.deepEqual(unmapped.warnings, []);

  // The fallback uses the access's own mapping, so a mapped admin still sees
  // the refusal for their own report without any extra option.
  const mapped = await previewAdminAction(
    mappedAdminAccess,
    "eod.review",
    { report_id: "r1", status: "approved" },
    fakeServices(task, { report: eodReport({ person: { id: personA, displayName: "Ada Lovelace" } }) }).services,
  );
  assert.equal(mappedAdminAccess.personId, personA);
  assert.ok(mapped.warnings.some((warning) => /own report/i.test(warning)));
});

test("EOD review warns for a non-pending report and a manager edit", async () => {
  const decided = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved" },
    fakeServices(task, { report: eodReport({ status: "approved" }) }).services,
    { reviewerPersonId: personA },
  );
  assert.ok(decided.warnings.some((warning) => /already approved|pending report/i.test(warning)));

  const edited = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved", markdown: "Rewritten summary" },
    fakeServices(task, { report: pendingReport }).services,
    { reviewerPersonId: personA },
  );
  assert.ok(edited.warnings.some((warning) => /replaces the employee/i.test(warning)));
  assert.equal(edited.request.markdown, "Rewritten summary");
});

test("apply EOD review passes the reviewer person even for an unmapped token", async () => {
  assert.equal(adminAccess.personId, null);
  const { services, calls } = fakeServices(task, { report: pendingReport });
  const preview = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved", manager_notes: "Looks good" },
    services,
    { reviewerPersonId: personA },
  );
  const result = await applyAdminAction(adminAccess, "eod.review", preview.request, services, reviewerToken, preview.state);
  assert.equal(result.status, 200);
  assert.deepEqual(calls.reviewEod, [{
    reportId: "r1",
    body: { status: "approved", manager_notes: "Looks good" },
    reviewerPersonId: personA,
  }]);
  assert.equal(adminAccess.personId, null);

  const auditRow = await lastAudit("admin.eod.review");
  assert.equal(auditRow.target_type, "work_report");
  assert.equal(auditRow.target_id, "r1");
  assert.equal(auditRow.actor_user_id, adminUser);
  assert.equal(auditRow.metadata.tokenId, reviewerToken.tokenId);
  assert.equal(auditRow.metadata.tokenName, reviewerToken.tokenName);
  assert.equal(auditRow.metadata.action, "eod.review");
  assert.deepEqual(auditRow.metadata.changes, preview.changes);
});

test("an EOD review preview goes stale when the production report moved on", async () => {
  const report = eodReport();
  const { services, calls } = fakeServices(task, { report });
  const preview = await previewAdminAction(
    adminAccess,
    "eod.review",
    { report_id: "r1", status: "approved" },
    services,
    { reviewerPersonId: personA },
  );
  // `updatedAt` is the camelCase field the detail reader returns.
  report.updatedAt = "2026-11-02T01:00:00Z";
  await assert.rejects(
    applyAdminAction(adminAccess, "eod.review", preview.request, services, reviewerToken, preview.state),
    (error: unknown) => (error as Error)?.name === "WorkOsConflictError"
      && (error as { reason?: string }).reason === "preview_stale",
  );
  assert.deepEqual(calls.reviewEod, []);
});

test("lifecycle and EOD review reject malformed or unknown input", async () => {
  const { services } = fakeServices(task);
  for (const [action, payload] of [
    ["task.complete", { task_id: "t1", completed: true }],
    ["task.reopen", { task_id: "t1", completed: false }],
    ["task.complete", {}],
    ["task.archive", { task_id: "t1", mode: "delete" }],
    ["eod.review", { report_id: "r1" }],
    ["eod.review", { report_id: "r1", status: "pending_review" }],
    ["eod.review", { status: "approved" }],
    ["eod.review", { report_id: "r1", status: "approved", person_id: personA }],
  ] as Array<[AdminPreviewAction, Json]>) {
    await assert.rejects(
      previewAdminAction(adminAccess, action, payload, services),
      isValidationError,
      `${action} ${JSON.stringify(payload)}`,
    );
  }

  await assert.rejects(
    previewAdminAction(adminAccess, "eod.review", { report_id: "missing", status: "approved" }, services),
    (error: unknown) => (error as Error)?.name === "WorkOsNotFoundError",
  );
});

test("lifecycle previews never execute a consequential write", async () => {
  const { services, calls } = fakeServices(task, { report: pendingReport });
  await previewAdminAction(adminAccess, "task.complete", { task_id: "t1" }, services);
  await previewAdminAction(adminAccess, "task.reopen", { task_id: "t1" }, services);
  await previewAdminAction(adminAccess, "task.archive", { task_id: "t1" }, services);
  await previewAdminAction(adminAccess, "task.delete", { task_id: "t1" }, services);
  await previewAdminAction(adminAccess, "eod.review", { report_id: "r1", status: "approved" }, services);
  assert.deepEqual(calls.completeTask, []);
  assert.deepEqual(calls.archiveTask, []);
  assert.deepEqual(calls.reviewEod, []);
});
