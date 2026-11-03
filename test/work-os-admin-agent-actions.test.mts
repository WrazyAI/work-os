import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import {
  applyAdminAction,
  previewAdminAction,
  validateAdminTaskCreate,
  type AdminAgentActionServices,
} from "../src/lib/work-admin-agent-actions";
import { previewFingerprint } from "../src/lib/work-admin-action-previews";
import { WorkOsValidationError } from "../src/lib/work-os-api";
import type { AdminPreviewAction } from "../src/modules/work-os/admin-agent/contracts";
import { adminAccess, fixture, personA, personB, personC } from "./helpers/work-os-admin-agent-fixture.mts";

/** The preview layer is deliberately service-shaped: these tests hand it fakes
 * and assert what it would describe and send, while the audit write (the one
 * side effect apply owns) runs against the PGlite fixture. Nothing here needs
 * a real task table, which is the point of the dependency boundary. */

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
  /** The report reviewEod returns. */
  report?: Json;
  /** Directory used to name and validate assignees. */
  people?: Array<{ id: string; displayName: string; active?: boolean }>;
};

function fakeServices(taskRow: Json, extras: FakeExtras = {}) {
  const calls = {
    getTask: [] as string[],
    createTask: [] as Json[],
    updateTask: [] as Array<{ taskId: string; payload: Json }>,
    moveTask: [] as Array<{ taskId: string; parentTaskId: string }>,
    completeTask: [] as Array<{ taskId: string; completed: boolean }>,
    archiveTask: [] as Array<{ taskId: string; mode: "archive" | "delete" }>,
    reviewEod: [] as Array<{ reportId: string; body: Json }>,
  };
  const services: AdminAgentActionServices = {
    getTask: async (_access, taskId) => {
      calls.getTask.push(taskId);
      return extras.tasks?.[taskId] ?? taskRow;
    },
    createTask: async (_access, payload) => {
      calls.createTask.push(payload);
      return extras.created ?? { ...taskRow, ...payload };
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
    reviewEod: async (_access, reportId, body) => {
      calls.reviewEod.push({ reportId, body });
      return extras.report ?? taskRow;
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
  return { services, calls };
}

const token = { tokenId: "90000000-0000-4000-8000-000000000011", tokenName: "Admin laptop" };

let f: Awaited<ReturnType<typeof fixture>>;
before(async () => { f = await fixture(); });
after(async () => { await f.close(); });

async function lastAudit(action: string) {
  const { rows } = await f.db.query<{
    action: string;
    target_type: string;
    target_id: string | null;
    metadata: Json;
  }>("select action, target_type, target_id, metadata from work_audit_log where action = $1 order by id desc limit 1", [action]);
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
  assert.deepEqual(preview.state, {
    updatedAt: task.updated_at,
    status: "open",
    completed: false,
    assignees: [personA, personB].sort(),
    parentId: null,
  });
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

  const replace = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "replace", person_ids: [personC, personC] },
    fakeServices(shared).services,
  );
  assert.deepEqual(replace.changes, [{ field: "assignees", from: [personA, personB], to: [personC] }]);
  assert.deepEqual((replace.state as Json).assignees, [personC]);

  const empty = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "replace", person_ids: [] },
    fakeServices(shared, { people: [ada, grace] }).services,
  );
  assert.ok(empty.warnings.some((warning) => /no assignees/i.test(warning)));
});

test("assign warns when the final list keeps an inactive person", async () => {
  const preview = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "add", person_ids: [personC] },
    fakeServices(task, { people: [ada, grace, linus] }).services,
  );
  assert.ok(preview.warnings.some((warning) => /not an active organization member/i.test(warning)));
});

test("assign rejects an unknown mode and a malformed person list", async () => {
  await assert.rejects(
    previewAdminAction(adminAccess, "task.assign", { task_id: "t1", mode: "append", person_ids: [] }, fakeServices(task).services),
    WorkOsValidationError,
  );
  await assert.rejects(
    previewAdminAction(adminAccess, "task.assign", { task_id: "t1", mode: "add", person_ids: [" "] }, fakeServices(task).services),
    WorkOsValidationError,
  );
});

test("move changes the parent and warns about the target shape", async () => {
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
  assert.equal((moved.state as Json).parentId, "t2");
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

  // The target moved on after the preview was described: the confirm path
  // re-reads this state, so the fingerprint no longer matches and nothing is
  // applied. A preview itself never writes.
  current.updated_at = "2026-11-02T01:00:00Z";
  const fresh = await previewAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "add", person_ids: [personB] },
    services,
  );
  assert.notEqual(previewFingerprint(fresh.state), stored);
  // Confirm compares this fingerprint before calling apply; describing the
  // action again never touches the write services itself.
  assert.deepEqual(calls.createTask, []);
  assert.deepEqual(calls.updateTask, []);
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

  const unowned = await previewAdminAction(
    adminAccess,
    "task.create",
    { name: "Ship" },
    services,
  );
  assert.equal(unowned.summary, "Create Ship for unassigned");
  assert.deepEqual((unowned.changes[1] as { to: unknown }).to, []);

  await assert.rejects(
    previewAdminAction(
      adminAccess,
      "task.create",
      { name: "Ship", assignee_person_ids: ["90000000-0000-4000-8000-000000000099"] },
      services,
    ),
    (error: unknown) => error instanceof WorkOsValidationError && /active Work OS organization members/.test(error.message),
  );
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
  assert.equal((preview.state as Json).updatedAt, task.updated_at);
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
      WorkOsValidationError,
      JSON.stringify(payload),
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

test("apply assign sends the exact final list and audits the admin actor", async () => {
  const { services, calls } = fakeServices(task);
  const result = await applyAdminAction(
    adminAccess,
    "task.assign",
    { task_id: "t1", mode: "add", person_ids: [personB] },
    services,
    token,
  );
  assert.equal(result.status, 200);
  assert.deepEqual(calls.updateTask, [
    { taskId: "t1", payload: { assignee_person_ids: [personA, personB] } },
  ]);
  const auditRow = await lastAudit("admin.task.assign");
  assert.equal(auditRow.target_type, "task");
  assert.equal(auditRow.target_id, "t1");
  assert.equal(auditRow.metadata.tokenId, token.tokenId);
  assert.equal(auditRow.metadata.tokenName, token.tokenName);
  assert.equal(auditRow.metadata.action, "task.assign");
  assert.deepEqual(auditRow.metadata.changes, [
    { field: "assignees", from: [personA], to: [personA, personB] },
  ]);
});

test("apply create validates, returns 201, and audits the new task id", async () => {
  const created = { ...task, id: "t9", title: "Ship", assignee_person_ids: [personB] };
  const { services, calls } = fakeServices(task, { people: [ada, grace], created });
  const result = await applyAdminAction(
    adminAccess,
    "task.create",
    { name: "Ship", assignee_person_ids: [personB] },
    services,
    token,
  );
  assert.equal(result.status, 201);
  assert.deepEqual(calls.createTask, [{ name: "Ship", assignee_person_ids: [personB] }]);
  assert.deepEqual((result.body as Json).task, created);
  const auditRow = await lastAudit("admin.task.create");
  assert.equal(auditRow.target_id, "t9");
  assert.equal(auditRow.metadata.action, "task.create");
});

test("apply update and move use the stored payload and audit their target", async () => {
  const { services, calls } = fakeServices(task);
  const updated = await applyAdminAction(
    adminAccess,
    "task.update",
    { task_id: "t1", name: "Ship it" },
    services,
    token,
  );
  assert.equal(updated.status, 200);
  assert.deepEqual(calls.updateTask, [{ taskId: "t1", payload: { name: "Ship it" } }]);
  const updateAudit = await lastAudit("admin.task.update");
  assert.equal(updateAudit.target_id, "t1");

  const moved = await applyAdminAction(
    adminAccess,
    "task.move",
    { task_id: "t1", parent_task_id: "t2" },
    services,
    token,
  );
  assert.equal(moved.status, 200);
  assert.deepEqual(calls.moveTask, [{ taskId: "t1", parentTaskId: "t2" }]);
  const moveAudit = await lastAudit("admin.task.move");
  assert.equal(moveAudit.target_type, "task");
  assert.equal(moveAudit.target_id, "t1");
});

test("apply refuses an action it does not recognize", async () => {
  const { services } = fakeServices(task);
  await assert.rejects(
    applyAdminAction(adminAccess, "task.explode" as AdminPreviewAction, { task_id: "t1" }, services, token),
    WorkOsValidationError,
  );
});
