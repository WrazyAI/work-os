import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { WorkOsAccess } from "../src/lib/work-os-api";
import { resolveDailyWorkspace } from "../src/lib/work-os-daily-workspace";
import { getPersonalInsightSummary, getPersonalInsights } from "../src/lib/work-os-insights";

const org = "10000000-0000-4000-8000-000000000001";
const person = "20000000-0000-4000-8000-000000000001";
const other = "20000000-0000-4000-8000-000000000002";
const owner = "30000000-0000-4000-8000-000000000001";
const access = { organizationId: org, personId: person, organizationOwnerId: owner, role: "employee", ctx: { user: { id: owner } }, featureFlags: {} } as WorkOsAccess;
const now = new Date("2026-11-04T12:00:00Z");
const id = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function fixture() {
  const database = new PGlite();
  await database.exec(`
    create table work_organizations(id uuid primary key, feature_flags jsonb default '{}');
    create table work_people(id uuid primary key, organization_id uuid, nifty_member_id text, display_name text, email text);
    create table work_employee_onboarding(organization_id uuid, person_id uuid, timezone text);
    create table work_projects(id uuid primary key, name text, provider_project_id text);
    create table work_tasks(id uuid primary key, user_id uuid, organization_id uuid, provider text default 'local', provider_task_id text,
      title text, description text, completed boolean default false, status text default 'open', due_date date,
      provider_created_at timestamptz, created_at timestamptz default '2026-10-01', updated_at timestamptz default '2026-11-04',
      provider_updated_at timestamptz, completed_at timestamptz, assignee_person_ids uuid[] default '{}', assignee_provider_ids text[] default '{}',
      assigned_by_person_id uuid, raw jsonb default '{}', parent_task_id uuid, parent_provider_task_id text, project_id uuid references work_projects(id));
    create table work_task_day_events(id uuid primary key, organization_id uuid, person_id uuid, task_id uuid, local_date date, event_type text,
      observed_at timestamptz, exact_at timestamptz, task_snapshot jsonb);
    create table work_daily_plans(id uuid primary key, organization_id uuid, person_id uuid, shift_date date, status text, freeform_intent text,
      focus_summary text, goal_provenance text, suggestion_task_ids uuid[], revision int);
    create table work_daily_plan_items(id uuid primary key, plan_id uuid references work_daily_plans(id), task_id uuid references work_tasks(id),
      item_kind text, completion_state text, completed_at timestamptz, source text, disposition text, title_snapshot text);
    create table work_sessions(id uuid primary key, organization_id uuid, person_id uuid, shift_date date, state text, clocked_in_at timestamptz,
      clocked_out_at timestamptz, created_at timestamptz, correction_status text, correction_reason text, paused_seconds int,
      provider_break_seconds int, provider_break_observed_at timestamptz, provider_break_provenance text, attendance_observed_at timestamptz);
    create table work_check_ins(id uuid primary key, organization_id uuid, person_id uuid, shift_date date, substantive boolean, input_text text, update_kind text);
    create table work_evidence(id uuid primary key, user_id uuid, person_id uuid, evidence_date date, source text, title text, metrics jsonb);
    create table work_provider_connections(organization_id uuid, provider text, active boolean);
    create table work_source_accounts(organization_id uuid, person_id uuid, provider text, verified boolean);
    insert into work_organizations(id) values ('${org}');
    insert into work_people values ('${person}', '${org}', 'member-a', 'Ada', 'ada@example.test'), ('${other}', '${org}', null, 'Other', 'other@example.test');
    insert into work_employee_onboarding values ('${org}', '${person}', 'UTC');
  `);
  const trace: Array<{ sql: string; rows: number; bytes: number }> = [];
  const previousPool = globalThis.__workOsPgPool;
  globalThis.__workOsPgPool = { query: async (sql: string, values?: unknown[]) => {
    assert.match(sql, /^\s*(select|with)\b/i, "production helper must not write in the fixture");
    const result = await database.query(sql, values);
    trace.push({ sql, rows: result.rows.length, bytes: Buffer.byteLength(JSON.stringify(result.rows)) });
    return result;
  } } as unknown as Pool;
  return { database, trace, close: async () => { globalThis.__workOsPgPool = previousPool; await database.close(); } };
}

async function seedTasks(f: Awaited<ReturnType<typeof fixture>>, count: number, assignedTo: string, due = "2026-11-04") {
  await f.database.query(`insert into work_tasks(id,user_id,organization_id,provider_task_id,title,description,due_date,provider_created_at,assignee_person_ids)
    select ('40000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1,$2,'task-' || n,'Task ' || lpad(n::text,5,'0'),repeat('x',1024),$4::date,'2026-10-01'::timestamptz + n * interval '1 second',array[$3::uuid]
    from generate_series(1,$5::int) n`, [owner, org, assignedTo, due, count]);
}

test("eligible newer tasks survive more than 2500 unrelated rows before hydration", async () => {
  const f = await fixture();
  try {
    await seedTasks(f, 2600, other);
    await f.database.query(`insert into work_tasks(id,user_id,organization_id,provider_task_id,title,due_date,provider_created_at,assignee_person_ids)
      values ($1,$2,$3,'new-mine','Newest eligible','2026-11-04','2026-11-04',array[$4::uuid])`, [id(3000), owner, org, person]);
    const day = await resolveDailyWorkspace(access, "2026-11-04", { now, limit: 24 });
    assert.deepEqual(day.tasks.map((task) => task.id), [id(3000)]);
    const fullRows = f.trace.filter((entry) => /^SELECT \* FROM "work_tasks"/.test(entry.sql)).reduce((n, entry) => n + entry.rows, 0);
    assert.equal(fullRows, 1, "only eligible task rows reach full hydration");
    f.trace.length = 0;
    const insights = await getPersonalInsights(access, "7d", "2026-11-04", now);
    assert.equal(insights.days.at(-1)?.tasksOpen, 1);
    assert.ok(f.trace.filter((entry) => /^SELECT \* FROM "work_tasks"/.test(entry.sql)).every((entry) => entry.rows <= 1));
  } finally { await f.close(); }
});

test("compact carry-over and nested collections are bounded with exact counts; full pages remain complete", async (t) => {
  const f = await fixture();
  try {
    await seedTasks(f, 2500, person, "2026-10-01");
    const full = await resolveDailyWorkspace(access, "2026-11-04", { now, limit: 24 });
    const fullQueries = f.trace.length;
    f.trace.length = 0;
    const compact = await resolveDailyWorkspace(access, "2026-11-04", { now, limit: 24, compact: true } as any);
    const tasks = compact.carryOverGroups.flatMap((group) => group.tasks);
    t.diagnostic(JSON.stringify({ fullBytes: Buffer.byteLength(JSON.stringify(full)), compactBytes: Buffer.byteLength(JSON.stringify(compact)), carryOverRows: tasks.length, fullQueries, compactQueries: f.trace.length }));
    assert.equal(compact.overdueCount, 2500);
    assert.equal(compact.carryOverGroups.reduce((n, group: any) => n + group.count, 0), 2500);
    assert.ok(tasks.length <= 24);
    assert.ok(tasks.every((task) => !("description" in task) && !("raw" in task)));
    assert.ok(Buffer.byteLength(JSON.stringify(compact)) < 30_000);
    await f.database.exec("update work_tasks set due_date = '2026-11-04'");
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const page = await resolveDailyWorkspace(access, "2026-11-04", { now, limit: 50, cursor, order: "title_asc" });
      assert.equal(page.totalCount, 2500);
      for (const task of page.tasks) { assert.ok(!seen.has(task.id)); seen.add(task.id); }
      cursor = page.cursor.next;
    } while (cursor);
    assert.equal(seen.size, 2500);
  } finally { await f.close(); }
});

test("dashboard summary reads bounded person event aggregates, never task projections", async (t) => {
  const f = await fixture();
  try {
    await seedTasks(f, 2600, other);
    await f.database.query(`update work_tasks set assignee_person_ids = array[$1::uuid] where provider_task_id like 'task-%'`, [person]);
    await f.database.query(`insert into work_tasks(id,user_id,organization_id,provider_task_id,title,due_date,completed,completed_at,provider_created_at,assignee_person_ids)
      select ('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1,$2,'done-' || n,'Done ' || n,'2026-11-04',true,'2026-11-04T12:00Z','2026-11-01',array[$3::uuid]
      from generate_series(1,8) n`, [owner, org, person]);
    await f.database.query(`insert into work_task_day_events(id,organization_id,person_id,task_id,local_date,event_type,observed_at)
      select ('51000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1,$2,('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,'2026-11-03','completed','2026-11-03T12:00Z'
      from generate_series(1,8) n`, [org, person]);
    await f.database.query(`insert into work_check_ins(id,organization_id,person_id,shift_date,substantive,input_text) values
      ('60000000-0000-4000-8000-000000000001',$1,$2,'2026-11-04',true,'update')`, [org, person]);
    const full = await getPersonalInsights(access, "7d", "2026-11-04", now);
    const fullQueries = f.trace.length;
    const fullRows = f.trace.reduce((sum, entry) => sum + entry.rows, 0);
    f.trace.length = 0;
    const summary = await getPersonalInsightSummary(access, "2026-11-04", now);
    t.diagnostic(JSON.stringify({ fullQueries, fullRows, summaryQueries: f.trace.length, summaryRows: f.trace.reduce((sum, entry) => sum + entry.rows, 0), summaryBytes: Buffer.byteLength(JSON.stringify(summary)) }));
    assert.equal(summary.totals.tasksCompleted, full.totals.tasksCompleted);
    assert.equal(summary.totals.updates, full.totals.updates);
    assert.equal(summary.consistency?.daysWithUpdate, full.consistency?.daysWithUpdate);
    assert.deepEqual(summary.days.map((day) => [day.date, day.tasksCompleted]), full.days.map((day) => [day.date, day.tasksCompleted]));
    assert.ok(fullRows > 1_000, "full seven-day report reads the open backlog");
    assert.ok(f.trace.filter((entry) => /^SELECT \* FROM "work_tasks"/.test(entry.sql)).every((entry) => entry.rows <= 16), "summary hydrates only completed families");
    assert.ok(f.trace.every((entry) => entry.rows < 100), "summary never transfers an organization-wide task set");
    assert.ok(f.trace.reduce((sum, entry) => sum + entry.rows, 0) * 20 < fullRows, "summary stays an order of magnitude smaller");
  } finally { await f.close(); }
});

test("historical reassignment keeps employee event and plan attribution, never assigner-only credit", async () => {
  const f = await fixture();
  try {
    await seedTasks(f, 4, other, "2026-10-01");
    await f.database.query("update work_tasks set assigned_by_person_id=$1 where id=$2", [person, id(3)]);
    await f.database.query(`insert into work_task_day_events values ($1,$2,$3,$4,'2026-11-03','completed','2026-11-03T10:00Z','2026-11-03T10:00Z','{"completed":true}')`, [id(9001), org, person, id(1)]);
    await f.database.query(`insert into work_task_day_events values ($1,$2,$3,$4,'2026-11-03','completed','2026-11-03T10:00Z','2026-11-03T10:00Z','{"completed":true}')`, [id(9002), org, other, id(3)]);
    await f.database.query(`insert into work_daily_plans(id,organization_id,person_id,shift_date) values ($1,$2,$3,'2026-11-03')`, [id(8000), org, person]);
    await f.database.query(`insert into work_daily_plan_items(id,plan_id,task_id,disposition,completion_state) values ($1,$2,$3,'selected','completed')`, [id(8001), id(8000), id(2)]);
    const day = await resolveDailyWorkspace(access, "2026-11-03", { now });
    assert.deepEqual(day.tasks.map((task) => task.id).sort(), [id(1), id(2)]);
    assert.equal(day.completed, 2);
    const today = await resolveDailyWorkspace(access, "2026-11-04", { now });
    assert.equal(today.total, 0);
    const insights = await getPersonalInsights(access, "7d", "2026-11-04", now);
    assert.equal(insights.days.find((day) => day.date === "2026-11-03")?.tasksCompleted, 2);
    assert.equal(insights.days.at(-1)?.tasksOpen, 0);
  } finally { await f.close(); }
});
