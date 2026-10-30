import assert from "node:assert/strict";
import test from "node:test";

import { isNiftyTaskAttributableToMember, isTaskAssignedToPerson, isTaskAttributableToPerson } from "../src/lib/work-os";
import { isEmployeeTaskAccessible } from "../src/lib/work-os-employee-tasks";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("personal unfinished page excludes solely delegated rows", () => {
  const sql = readFileSync("supabase/migrations/0067_work_task_assigner_visibility.sql", "utf8");
  const page = sql.slice(sql.indexOf("create or replace function public.work_list_person_task_page"));
  assert.match(page, /or \(p_completed is distinct from false and t\.assigned_by_person_id = p_person_id\)/);
});

test("Nifty ledger tasks are attributable through creator metadata", () => {
  assert.equal(isNiftyTaskAttributableToMember({ raw: { created_by: "member-a" } }, "member-a"), true);
  assert.equal(isNiftyTaskAttributableToMember({ raw: { created_by: "member-b" } }, "member-a"), false);
});

test("Nifty ledger tasks are attributable through subscribers or assignees", () => {
  assert.equal(isNiftyTaskAttributableToMember({ raw: { subscribers: ["member-a"] } }, "member-a"), true);
  assert.equal(isNiftyTaskAttributableToMember({ assignee_provider_ids: ["member-a"], raw: {} }, "member-a"), true);
  assert.equal(isNiftyTaskAttributableToMember({ raw: { subscribers: ["member-b"] } }, "member-a"), false);
});

test("unmapped people cannot inherit unassigned ledger tasks", () => {
  assert.equal(isNiftyTaskAttributableToMember({ raw: { created_by: "member-a", subscribers: ["member-a"] } }, null), false);
});

test("task lookup routes provider IDs away from the UUID column", () => {
  const source = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  assert.match(source, /localId \? "id" : "provider_task_id"/);
  assert.doesNotMatch(source, /\.or\(`id\.eq\.\$\{taskId\}/);
});

test("subtask moves keep their safety checks now that work is native", () => {
  const workOsSource = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  assert.match(workOsSource, /Only subtasks can be moved to another task/);
  assert.match(workOsSource, /Subtasks can only be moved beneath a top-level task/);
  assert.match(workOsSource, /Subtasks can only be moved between tasks in the same project/);
  assert.doesNotMatch(workOsSource, /niftyForOwner|updateNiftyTask/);
});

test("the unified predicate covers local assignment and provider metadata", () => {
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-a"] }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"] }, "person-a", "member-a"), false);
  assert.equal(isTaskAttributableToPerson({ raw: { created_by: "member-a" } }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ raw: { subscribers: ["member-a"] } }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ assignee_provider_ids: ["member-a"], raw: {} }, "person-a", "member-a"), true);
  assert.equal(isTaskAttributableToPerson({ raw: { created_by: "member-b" } }, null, "member-a"), false);
});

test("an assigner also sees the work they delegated", () => {
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, "person-a", null), true);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, "person-b", null), true);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, "person-c", null), false);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: [], assigned_by_person_id: null }, "person-a", null), false);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a" }, null, null), false);
});

test("the narrow predicate excludes the assigner while the broad one keeps the row visible", () => {
  const delegated = { assignee_person_ids: ["person-e"], assigned_by_person_id: "person-p" };
  // P assigned the work to E: the day belongs to E, not to P.
  assert.equal(isTaskAssignedToPerson(delegated, "person-p", null), false);
  assert.equal(isTaskAssignedToPerson(delegated, "person-e", null), true);
  // P still sees the row and its management actions through the list predicate.
  assert.equal(isTaskAttributableToPerson(delegated, "person-p", null), true);
  assert.equal(isTaskAttributableToPerson(delegated, "person-e", null), true);
  assert.equal(isTaskAttributableToPerson({ assignee_person_ids: ["person-e"], assigned_by_person_id: "person-p" }, "person-x", null), false);
  // The provider creator/subscriber mapping still counts as ownership.
  assert.equal(isTaskAssignedToPerson({ raw: { created_by: "member-a" } }, "person-a", "member-a"), true);
});

test("day attribution never admits the assigner's delegated events", () => {
  const workspaceSource = readFileSync(new URL("../src/lib/work-os-daily-workspace.ts", import.meta.url), "utf8");
  const dayBlock = workspaceSource.slice(
    workspaceSource.indexOf("const attributable = allTasks.filter"),
    workspaceSource.indexOf("const events ="),
  );
  // The day set and the event-id set both come from the narrow predicate; the
  // broad predicate would credit P with E's completed/deferred events.
  assert.match(dayBlock, /isTaskAssignedToPerson\(task, access\.personId, context\.niftyMemberId\)/);
  assert.doesNotMatch(dayBlock, /isTaskAttributableToPerson/);
  assert.match(workspaceSource, /const attributableIds = new Set\(attributable/);
});

test("both task surfaces share the unified attribution predicate", () => {
  const tasksSource = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  assert.match(tasksSource, /export function isTaskAttributableToPerson/);
  assert.match(tasksSource, /export function isTaskAssignedToPerson/);
  assert.match(tasksSource, /return isTaskAssignedToPerson\(task, personId, niftyMemberId\)/);
  assert.match(tasksSource, /isTaskAttributableToPerson\(task, personId, niftyMemberId\)/);
  assert.match(tasksSource, /assignedByPersonId: personId/);
  assert.match(tasksSource, /eq\("assigned_by_person_id", opts\.assignedByPersonId\)/);
  const workspaceSource = readFileSync(new URL("../src/lib/work-os-daily-workspace.ts", import.meta.url), "utf8");
  assert.doesNotMatch(workspaceSource, /isNiftyTaskAttributableToMember/);
  assert.doesNotMatch(workspaceSource, /isTaskAttributableToPerson/);
  assert.match(tasksSource, /export async function listPersonOpenTasks/);
});

test("personal completion and planning reads exclude delegated rows", () => {
  // Delegation is management visibility, not the delegator's own work. Every
  // personal consumer opts out of the assigned-by rows so completion counts,
  // daily plans, check-ins, and AI summaries stay truthful; the Tasks workspace
  // keeps the default (includeAssignedBy true) for its management actions.
  const personalConsumers = [
    "src/lib/work-os-day-view.ts",
    "src/lib/work-os-workday.ts",
    "src/lib/work-os-checkins.ts",
    "src/lib/work-os-planning-context.ts",
    "src/lib/work-os-next-steps.ts",
    "src/lib/work-os-goal-suggestion.ts",
    "src/lib/work-os-employee-tasks.ts",
    "src/lib/aiInterpret.ts",
  ];
  for (const file of personalConsumers) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const calls = source.split("listPersonTasks(").slice(1);
    assert.ok(calls.length > 0, `${file} reads personal tasks`);
    for (const call of calls) {
      assert.match(call.slice(0, 400), /includeAssignedBy: false/, `${file} keeps delegated work out of personal reads`);
    }
  }
  const tasksSource = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  assert.match(tasksSource, /includeAssignedBy\?: boolean/);
  assert.match(tasksSource, /attribution: "assigned_by"/);
  assert.match(tasksSource, /opts\.includeAssignedBy === false\s*\?\s*Promise\.resolve\(\[\]\)/);
  assert.match(tasksSource, /assignedByPersonId: personId/);
});

test("unassigned child tasks inherit access from their active parent", () => {
  const parent = { id: "parent", assignee_person_ids: ["person-a"], status: "open" };
  assert.equal(isEmployeeTaskAccessible({ id: "child", parent_task_id: "parent", assignee_person_ids: [] }, parent, "person-a", null), true);
  assert.equal(isEmployeeTaskAccessible({ id: "child", parent_task_id: "parent", assignee_person_ids: [] }, parent, "person-b", null), false);
  assert.equal(isEmployeeTaskAccessible({ id: "child", parent_task_id: "parent", assignee_person_ids: [] }, { ...parent, status: "archived" }, "person-a", null), false);
});

/** Run the real personal backlog against a stubbed query builder so the
 *  predicate and its counts are exercised, not just its source text. */
function loadPersonOpenBacklog(rows: Record<string, any>[]) {
  const source = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  const start = source.indexOf("export async function listPersonOpenTasks(");
  assert.ok(start >= 0, "listPersonOpenTasks not found");
  const end = source.indexOf("/** A stored estimate is whole minutes.", start);
  const body = source.slice(start, end).replace("export async function", "async function");
  const javascript = ts.transpileModule(`${body}\nglobalThis.subject = listPersonOpenTasks;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const builder = (table: string) => {
    const query: Record<string, any> = {
      select: () => query,
      eq: () => query,
      not: () => query,
      order: () => query,
      range: (offset: number, limit: number) => ({ data: table === "work_tasks" ? rows.slice(offset, limit + 1) : [], error: null }),
      maybeSingle: () => ({ data: table === "work_people" ? { nifty_member_id: null } : null, error: null }),
    };
    return query;
  };
  const context: Record<string, unknown> = {
    db: () => ({ from: (table: string) => builder(table) }),
    ensureNoError: (result: { data: unknown }) => result.data,
    isTaskAssignedToPerson,
    isTaskAttributableToPerson,
  };
  vm.runInNewContext(javascript, context);
  return (context as {
    subject: (userId: string, personId: string) => Promise<{ tasks: Array<{ id: string }>; counts: Record<string, number> }>;
  }).subject;
}

test("the personal open backlog counts only work assigned to the person", async () => {
  const rows = [
    { id: "mine", assignee_person_ids: ["person-a"], assigned_by_person_id: "person-b", completed: false },
    // Delegation is management visibility, not the delegator's own backlog.
    { id: "delegated", assignee_person_ids: ["person-b"], assigned_by_person_id: "person-a", completed: false },
    { id: "done", assignee_person_ids: ["person-a"], assigned_by_person_id: "person-b", completed: true },
    { id: "unrelated", assignee_person_ids: ["person-c"], assigned_by_person_id: "person-b", completed: false },
  ];
  const backlog = await loadPersonOpenBacklog(rows)("owner", "person-a");
  // Copy out of the vm realm so strict deep equality compares host objects.
  assert.deepEqual([...backlog.tasks].map((task) => task.id), ["mine"]);
  assert.deepEqual({ ...backlog.counts }, { total: 2, open: 1, completed: 1 });
});

test("the personal backlog excludes delegated rows while management lists keep them", () => {
  const tasksSource = readFileSync(new URL("../src/lib/work-os-tasks.ts", import.meta.url), "utf8");
  const start = tasksSource.indexOf("export async function listPersonOpenTasks(");
  const block = tasksSource.slice(start, tasksSource.indexOf("/** A stored estimate is whole minutes.", start));
  assert.match(block, /isTaskAssignedToPerson\(task, personId, niftyMemberId\)/);
  assert.doesNotMatch(block, /isTaskAttributableToPerson/);
  // The Tasks workspace and history keep the assigner's delegated rows so a
  // manager can still reach the management actions the capability matrix grants.
  assert.match(tasksSource, /assignedByPersonId: personId/);
  assert.match(tasksSource, /attribution: "assigned_by"/);
});
