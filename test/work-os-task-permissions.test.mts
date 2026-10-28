import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isCalendarDate,
  isWorkflowStatus,
  taskAssignerId,
  taskCapabilities,
  taskDisplayState,
  taskIsOverdue,
  type TaskActor,
} from "../src/lib/work-os-task-permissions";

const today = "2026-10-27";
const assigned = { assignee_person_ids: ["employee"], assigned_by_person_id: "manager", completed: false, due_date: "2026-10-27" };
const selfOwned = { ...assigned, assigned_by_person_id: "employee" };
const legacy = { ...assigned, assigned_by_person_id: null };
const admin: TaskActor = { role: "admin", personId: "admin" };
const manager: TaskActor = { role: "manager", personId: "manager" };
const employee: TaskActor = { role: "employee", personId: "employee" };

test("admins control open tasks but can only reopen completed tasks", () => {
  assert.deepEqual(taskCapabilities(assigned, admin, today), {
    canEdit: true, canArchive: true, canDelete: true, canAssign: true,
    canComplete: true, canReopen: false, canChangeStatus: true, canMove: true,
    statusLocked: false, overdue: false,
  });
  assert.deepEqual(taskCapabilities({ ...assigned, completed: true }, admin, today), {
    canEdit: true, canArchive: true, canDelete: true, canAssign: true,
    canComplete: false, canReopen: true, canChangeStatus: true, canMove: true,
    statusLocked: false, overdue: false,
  });
});

test("assigners can manage tasks without completing or reopening them", () => {
  for (const completed of [false, true]) {
    assert.deepEqual(taskCapabilities({ ...assigned, completed }, manager, today), {
      canEdit: true, canArchive: true, canDelete: true, canAssign: true,
      canComplete: false, canReopen: false, canChangeStatus: true, canMove: true,
      statusLocked: false, overdue: false,
    });
  }
});

test("assignees can change status and complete or reopen without managing assigned tasks", () => {
  for (const completed of [false, true]) {
    assert.deepEqual(taskCapabilities({ ...assigned, completed }, employee, today), {
      canEdit: false, canArchive: false, canDelete: false, canAssign: false,
      canComplete: !completed, canReopen: completed, canChangeStatus: true, canMove: false,
      statusLocked: false, overdue: false,
    });
  }
});

test("self-owned tasks retain assignee management for open and completed rows", () => {
  for (const completed of [false, true]) {
    assert.deepEqual(taskCapabilities({ ...selfOwned, completed }, employee, today), {
      canEdit: true, canArchive: true, canDelete: true, canAssign: true,
      canComplete: !completed, canReopen: completed, canChangeStatus: true, canMove: true,
      statusLocked: false, overdue: false,
    });
  }
});

test("tasks without an assigner are administrator-only for management", () => {
  // The 0065 backfill gives legacy single-assignee rows their assigner, so a
  // null assigner now means the record truly has none: its assignees keep
  // completion and status, never edit/archive/delete/assign.
  for (const task of [legacy, { ...legacy, assignee_person_ids: ["other", "employee"] }]) {
    for (const completed of [false, true]) {
      assert.deepEqual(taskCapabilities({ ...task, completed }, employee, today), {
        canEdit: false, canArchive: false, canDelete: false, canAssign: false,
        canComplete: !completed, canReopen: completed, canChangeStatus: true, canMove: false,
        statusLocked: false, overdue: false,
      });
    }
  }
  // An unrelated person gains nothing from the same row.
  for (const completed of [false, true]) {
    assert.deepEqual(taskCapabilities({ ...legacy, completed }, { role: "manager", personId: "manager" }, today), {
      canEdit: false, canArchive: false, canDelete: false, canAssign: false,
      canComplete: false, canReopen: false, canChangeStatus: false, canMove: false,
      statusLocked: false, overdue: false,
    });
  }
  // The administrator override is still by role, even without a person mapping.
  for (const completed of [false, true]) {
    assert.deepEqual(taskCapabilities({ ...legacy, completed }, { role: "admin", personId: null }, today), {
      canEdit: true, canArchive: true, canDelete: true, canAssign: true,
      canComplete: !completed, canReopen: completed, canChangeStatus: true, canMove: true,
      statusLocked: false, overdue: false,
    });
  }
});

test("unrelated actors and null identities gain no task permissions", () => {
  const none = {
    canEdit: false, canArchive: false, canDelete: false, canAssign: false,
    canComplete: false, canReopen: false, canChangeStatus: false, canMove: false,
    statusLocked: false, overdue: false,
  };
  for (const role of ["manager", "employee"] as const) {
    for (const personId of ["unrelated", null]) {
      assert.deepEqual(taskCapabilities(assigned, { role, personId }, today), none);
      assert.deepEqual(taskCapabilities({ ...legacy, assignee_person_ids: null }, { role, personId }, today), none);
    }
  }
});

test("overdue locks workflow changes for everyone without preventing assignee completion", () => {
  const overdue = { ...assigned, due_date: "2026-10-26" };
  for (const actor of [admin, manager, employee]) {
    const capabilities = taskCapabilities(overdue, actor, today);
    assert.equal(capabilities.overdue, true);
    assert.equal(capabilities.statusLocked, true);
    assert.equal(capabilities.canChangeStatus, false);
  }
  assert.equal(taskCapabilities(overdue, employee, today).canComplete, true);
  const complete = taskCapabilities({ ...overdue, completed: true }, employee, today);
  assert.equal(complete.overdue, false);
  assert.equal(complete.statusLocked, false);
  assert.equal(complete.canReopen, true);
  assert.equal(complete.canChangeStatus, true);
});

test("overdue uses date prefixes and ignores completed, missing, or malformed dates", () => {
  assert.equal(taskIsOverdue({ due_date: "2026-10-26T23:59:59Z" }, today), true);
  assert.equal(taskIsOverdue({ due_date: today }, today), false);
  assert.equal(taskIsOverdue({ due_date: "2026-10-28" }, today), false);
  assert.equal(taskIsOverdue({ completed: true, due_date: "2026-10-26" }, today), false);
  for (const due_date of [null, undefined, "", "yesterday", "2026-1-2", "x2026-10-26", 123]) {
    assert.equal(taskIsOverdue({ due_date }, today), false);
  }
});

test("overdue rejects impossible calendar dates and honors leap years", () => {
  for (const due_date of ["2026-00-01", "2026-02-30", "2026-13-01", "2026-04-31", "2026-01-00", "2026-02-29", "2100-02-29"]) {
    assert.equal(taskIsOverdue({ due_date }, "2101-01-01"), false, due_date);
  }
  assert.equal(taskIsOverdue({ due_date: "2028-02-29" }, "2028-03-01"), true);
  assert.equal(taskIsOverdue({ due_date: "2028-02-29" }, "2028-02-29"), false);
  assert.equal(taskIsOverdue({ due_date: "2028-02-29" }, "2028-02-28"), false);
  assert.equal(taskIsOverdue({ due_date: "2000-02-29T12:00:00Z" }, today), true);
});

test("display state prioritizes completion, overdue, workflow progress, then pending", () => {
  assert.equal(taskDisplayState({ completed: true, due_date: "2026-10-26", workflow_status: "in_progress" }, today), "complete");
  assert.equal(taskDisplayState({ due_date: "2026-10-26", workflow_status: "in_progress" }, today), "overdue");
  assert.equal(taskDisplayState({ due_date: today, workflow_status: "in_progress" }, today), "in_progress");
  for (const workflow_status of ["pending", "done", null, undefined]) {
    assert.equal(taskDisplayState({ workflow_status }, today), "pending");
  }
  assert.equal(taskDisplayState({ status: "in_progress" }, today), "pending");
});

test("workflow validation and assigner extraction accept only their documented values", () => {
  assert.equal(isWorkflowStatus("pending"), true);
  assert.equal(isWorkflowStatus("in_progress"), true);
  for (const value of ["done", "overdue", "complete", "IN_PROGRESS", "", null, undefined, 1, {}]) {
    assert.equal(isWorkflowStatus(value), false);
  }
  assert.equal(taskAssignerId({ assigned_by_person_id: "p1" }), "p1");
  for (const assigned_by_person_id of [null, undefined, 1, {}]) {
    assert.equal(taskAssignerId({ assigned_by_person_id }), null);
  }
});

test("calendar validation accepts real days and rejects malformed or impossible ones", () => {
  for (const value of ["2026-10-27", "2028-02-29", "2000-02-29"]) assert.equal(isCalendarDate(value), true, value);
  for (const value of ["soon", "2026-02-30", "2026-13-01", "2026-00-01", "2026-04-31", "2026-02-29", "2100-02-29", "2026-1-2", "2026-10-27T00:00:00Z", "", null, undefined, 20261027, {}]) {
    assert.equal(isCalendarDate(value), false, String(value));
  }
});

test("migration adds constrained workflow status and indexed assignment provenance", () => {
  const sql = readFileSync(new URL("../supabase/migrations/0065_work_task_assignment_and_status.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.work_tasks/);
  assert.match(sql, /add column if not exists workflow_status text not null default 'pending'/);
  assert.match(sql, /check \(workflow_status in \('pending',\s*'in_progress'\)\)/);
  assert.match(sql, /add column if not exists assigned_by_person_id uuid references public\.work_people \(id\) on delete set null/);
  assert.match(sql, /set assigned_by_person_id = t\.assignee_person_ids\[1\]/);
  assert.match(sql, /where t\.assigned_by_person_id is null\s+and coalesce\(array_length\(t\.assignee_person_ids, 1\), 0\) = 1/);
  assert.match(sql, /exists \(\s*select 1 from public\.work_people p\s+where p\.id = t\.assignee_person_ids\[1\]/);
  assert.match(sql, /create index if not exists work_tasks_assigned_by_idx\s+on public\.work_tasks \(organization_id, assigned_by_person_id\)/);
});
