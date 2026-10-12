import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { compareWorkspaceTaskCursor, createWorkspaceTaskCursor, parseWorkspaceTaskCursor, taskPageScope } from "../src/lib/work-os-task-pagination.ts";
import { taskRangeAttributionDate } from "../src/lib/work-os-daily-workspace.ts";

const USER = "00000000-0000-4000-8000-000000000001";
const ORGANIZATION = "00000000-0000-4000-8000-000000000002";
const PERSON = "00000000-0000-4000-8000-000000000003";
const OTHER_ORGANIZATION = "00000000-0000-4000-8000-000000000004";

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create table public.work_projects (id uuid primary key, user_id uuid not null, name text not null);
    create table public.work_tasks (
      id uuid primary key,
      user_id uuid not null,
      organization_id uuid not null,
      provider text not null default 'nifty',
      provider_task_id text,
      provider_project_id text,
      project_id uuid,
      parent_task_id uuid,
      parent_provider_task_id text,
      title text not null,
      description text,
      status text not null default 'open',
      completed boolean not null default false,
      assignee_provider_ids text[] not null default '{}',
      assignee_person_ids uuid[] not null default '{}',
      due_date date,
      completed_at timestamptz,
      provider_created_at timestamptz,
      provider_updated_at timestamptz,
      raw jsonb not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  await db.exec(await readFile(new URL("../supabase/migrations/0059_work_os_task_cursor_pagination.sql", import.meta.url), "utf8"));
  return db;
}

async function insertTask(db: PGlite, task: {
  id: string;
  title: string;
  completed?: boolean;
  due?: string | null;
  created?: string | null;
  organization?: string;
  description?: string;
  project?: string | null;
  raw?: Record<string, unknown>;
}) {
  await db.query(
    `insert into work_tasks (id,user_id,organization_id,title,completed,due_date,provider_created_at,created_at,description,project_id,assignee_person_ids,raw)
     values ($1,$2,$3,$4,$5,$6,$7,coalesce($7::timestamptz,now()),$8,$9,array[$10::uuid],$11::jsonb)`,
    [task.id, USER, task.organization ?? ORGANIZATION, task.title, task.completed ?? false, task.due ?? null, task.created ?? null, task.description ?? null, task.project ?? null, PERSON, JSON.stringify(task.raw ?? {})],
  );
}

async function page(db: PGlite, options: {
  order?: string;
  completed?: boolean | null;
  search?: string | null;
  from?: string | null;
  to?: string | null;
  after?: Record<string, unknown> | null;
  excluded?: string[] | null;
  member?: string | null;
  overdueFirst?: boolean;
  limit?: number;
} = {}) {
  const result = await db.query<{ task: Record<string, any> | null; total_count: number; total_all: number; total_open: number; total_completed: number; total_overdue: number; has_more: boolean }>(
    `select * from public.work_list_person_task_page(
      $1::uuid,$2::uuid,$3::uuid,$4::text,$5::boolean,null,$6::text,$7::date,$8::text,$9::date,$10::date,$11::uuid[],$12::jsonb,$13::integer,$14::boolean
    )`,
    [USER, ORGANIZATION, PERSON, options.member ?? null, options.completed ?? null, options.order ?? "due_desc", "2026-10-09", options.search ?? null, options.from ?? null, options.to ?? null, options.excluded ?? null, options.after ? JSON.stringify(options.after) : null, options.limit ?? 50, options.overdueFirst === true],
  );
  return result.rows;
}

test("task cursors bind to filters and preserve stable sort-key ordering", () => {
  const scope = taskPageScope({ user: USER, search: "needle", order: "due_desc" });
  const cursor = createWorkspaceTaskCursor({
    id: "00000000-0000-4000-8000-000000000010",
    title: "Needle task",
    completed: false,
    due_date: "2026-10-05",
    provider_created_at: "2026-10-01T10:00:00.000Z",
  }, { scope, order: "due_desc", sortDate: "2026-10-09", position: 50 });
  const parsed = parseWorkspaceTaskCursor(cursor, scope);
  assert.equal(parsed?.position, 50);
  assert.equal(compareWorkspaceTaskCursor({ id: "00000000-0000-4000-8000-000000000011", title: "Later due", completed: false, due_date: "2026-10-03", provider_created_at: "2026-10-02T10:00:00.000Z" }, parsed!), 1);
  assert.throws(() => parseWorkspaceTaskCursor(cursor, taskPageScope({ user: USER, search: "different", order: "due_desc" })), /must be valid/);
  assert.throws(() => parseWorkspaceTaskCursor("not-a-cursor", scope), /must be valid/);
});

test("SQL pages only matching parents, keeps global order, and stays stable when a new task is inserted before the cursor", async () => {
  const db = await createDatabase();
  try {
    await db.query("insert into work_projects (id,user_id,name) values ($1,$2,$3)", ["00000000-0000-4000-8000-000000000020", USER, "Operations"]);
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000101", title: "Due latest", due: "2026-10-20", created: "2026-10-01T08:00:00Z", project: "00000000-0000-4000-8000-000000000020" });
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000102", title: "Due soon", due: "2026-10-15", created: "2026-10-02T08:00:00Z" });
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000103", title: "Undated", created: "2026-10-03T08:00:00Z" });
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000104", title: "Completed", completed: true, due: "2026-10-18", created: "2026-10-04T08:00:00Z" });
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000105", title: "Needle in the old record", due: "2026-10-01", description: "Search me", created: "2026-10-05T08:00:00Z" });
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000106", title: "Other tenant", due: "2026-10-30", organization: OTHER_ORGANIZATION });
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000107", title: "Child task", due: "2026-10-28" });
    await db.query("update work_tasks set parent_task_id = $1 where id = $2", ["00000000-0000-4000-8000-000000000101", "00000000-0000-4000-8000-000000000107"]);

    const first = await page(db, { limit: 2 });
    const firstTasks = first.flatMap((row) => row.task ? [row.task] : []);
    assert.deepEqual(firstTasks.map((task) => task.title), ["Due latest", "Due soon"]);
    assert.equal(Number(first[0]?.total_count), 5);
    assert.equal(first[0]?.has_more, true);

    const cursor = createWorkspaceTaskCursor(firstTasks[1]!, {
      scope: taskPageScope({
        userId: USER, organizationId: ORGANIZATION, personId: PERSON,
        completed: null, projectId: null, order: "due_desc", sortDate: "2026-10-09",
        search: null, fromDate: null, toDate: null,
      }),
      order: "due_desc",
      sortDate: "2026-10-09",
      position: 2,
    });
    await insertTask(db, { id: "00000000-0000-4000-8000-000000000108", title: "Inserted before cursor", due: "2026-10-25", created: "2026-10-06T08:00:00Z" });
    const second = await page(db, { limit: 2, after: JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) });
    const secondTasks = second.flatMap((row) => row.task ? [row.task] : []);
    assert.deepEqual(secondTasks.map((task) => task.title), ["Needle in the old record", "Undated"]);
    assert.equal(second[0]?.has_more, true);
    const third = await page(db, { limit: 2, after: JSON.parse(Buffer.from(createWorkspaceTaskCursor(secondTasks[1]!, {
      scope: taskPageScope({
        userId: USER, organizationId: ORGANIZATION, personId: PERSON,
        completed: null, projectId: null, order: "due_desc", sortDate: "2026-10-09",
        search: null, fromDate: null, toDate: null,
      }),
      order: "due_desc",
      sortDate: "2026-10-09",
      position: 4,
    }), "base64url").toString("utf8")) });
    assert.deepEqual(third.flatMap((row) => row.task ? [row.task.title] : []), ["Completed"]);
    assert.equal(third[0]?.has_more, false, "a new row before the cursor does not create an empty final page");

    const searched = await page(db, { search: "needle", limit: 1 });
    assert.equal(searched[0]?.task?.title, "Needle in the old record");
    assert.equal(Number(searched[0]?.total_count), 1);
    const dated = await page(db, { from: "2026-10-01", to: "2026-10-01", limit: 10 });
    assert.deepEqual(dated.flatMap((row) => row.task ? [row.task.title] : []), ["Due latest", "Needle in the old record"]);
    const openOnly = await page(db, { completed: false, limit: 10, excluded: ["00000000-0000-4000-8000-000000000101"] });
    assert.equal(Number(openOnly[0]?.total_count), 4);
    assert.equal(Number(openOnly[0]?.total_all), 5);
  } finally {
    await db.close();
  }
});

test("every supported sort cursor reproduces the complete SQL order across page boundaries", async () => {
  const db = await createDatabase();
  try {
    const fixtures = [
      { id: "00000000-0000-4000-8000-000000000201", title: "Zulu", due: "2026-10-12", created: "2026-10-01T08:00:00Z" },
      { id: "00000000-0000-4000-8000-000000000202", title: "Alpha", due: null, created: "2026-10-02T08:00:00Z" },
      { id: "00000000-0000-4000-8000-000000000203", title: "Alpha", due: "2026-10-15", created: "2026-10-03T08:00:00Z", completed: true },
      { id: "00000000-0000-4000-8000-000000000204", title: "Mike", due: "2026-10-10", created: "2026-10-04T08:00:00Z" },
      { id: "00000000-0000-4000-8000-000000000205", title: "Bravo", due: "2026-10-10", created: "2026-10-05T08:00:00Z" },
      { id: "00000000-0000-4000-8000-000000000206", title: "Bravo", due: "2026-10-10", created: "2026-10-05T08:00:00Z" },
      { id: "00000000-0000-4000-8000-000000000207", title: "Charlie", due: "2026-10-11", created: "2026-10-06T08:00:00Z", completed: true },
      { id: "00000000-0000-4000-8000-000000000208", title: "Echo", due: "2026-10-01", created: "2026-10-07T08:00:00Z" },
    ];
    for (const fixture of fixtures) await insertTask(db, fixture);

    for (const overdueFirst of [false, true]) {
      for (const order of ["title_asc", "title_desc", "due_asc", "due_desc", "status_asc", "status_desc", "recency"]) {
        const full = (await page(db, { order, limit: 50, overdueFirst })).flatMap((row) => row.task ? [row.task] : []).map((task) => task.id);
        const paged: string[] = [];
        let after: Record<string, unknown> | null = null;
        while (true) {
          const response = await page(db, { order, limit: 2, after, overdueFirst });
          const tasks = response.flatMap((row) => row.task ? [row.task] : []);
          paged.push(...tasks.map((task) => task.id));
          if (response[0]?.has_more !== true || !tasks.length) break;
          const scope = taskPageScope({
            userId: USER, organizationId: ORGANIZATION, personId: PERSON,
            completed: null, projectId: null, order, sortDate: "2026-10-09",
            search: null, fromDate: null, toDate: null, overdueFirst,
          });
          after = JSON.parse(Buffer.from(createWorkspaceTaskCursor(tasks.at(-1)!, {
            scope,
            order: order as "title_asc" | "title_desc" | "due_asc" | "due_desc" | "status_asc" | "status_desc" | "recency",
            sortDate: "2026-10-09",
            position: paged.length,
            overdueFirst,
          }), "base64url").toString("utf8"));
        }
        assert.deepEqual(paged, full, `${order} pagination should not skip, duplicate, or reorder records (overdueFirst=${overdueFirst})`);
      }
    }

    const overdueFirstPage = await page(db, { order: "due_desc", limit: 10, overdueFirst: true });
    const overdueFirstTitles = overdueFirstPage.flatMap((row) => row.task ? [row.task.title] : []);
    assert.equal(overdueFirstTitles[0], "Echo", "overdue-first puts the overdue open task ahead of future-dated work");
    const plainTitles = (await page(db, { order: "due_desc", limit: 10 })).flatMap((row) => row.task ? [row.task.title] : []);
    assert.equal(plainTitles[0], "Zulu");
    assert.ok(plainTitles.indexOf("Echo") > 0, "without the prefix the overdue task sorts behind future-dated work");
  } finally {
    await db.close();
  }
});

test("SQL keeps created-by and subscriber attribution alongside the assignee path", async () => {
  const db = await createDatabase();
  try {
    const assigned = "00000000-0000-4000-8000-000000000301";
    const createdBy = "00000000-0000-4000-8000-000000000302";
    const subscriber = "00000000-0000-4000-8000-000000000303";
    const otherMember = "00000000-0000-4000-8000-000000000304";
    await insertTask(db, { id: assigned, title: "Assigned directly", due: "2026-10-05" });
    await insertTask(db, { id: createdBy, title: "Created by member", raw: { created_by: "member-1" } });
    await insertTask(db, { id: subscriber, title: "Subscribed member", raw: { subscribers: ["member-1"] } });
    await insertTask(db, { id: otherMember, title: "Other member", raw: { created_by: "member-2", subscribers: ["member-2"] } });
    await db.query("update work_tasks set assignee_person_ids = '{}' where id in ($1,$2,$3)", [createdBy, subscriber, otherMember]);

    const rows = await page(db, { limit: 10, member: "member-1" });
    const titles = rows.flatMap((row) => row.task ? [row.task.title] : []).sort();
    assert.deepEqual(titles, ["Assigned directly", "Created by member", "Subscribed member"]);
    assert.equal(Number(rows[0]?.total_count), 3);
    assert.equal(Number(rows[0]?.total_open), 3);
  } finally {
    await db.close();
  }
});

test("day-view date ranges use the same per-task attributed date as the SQL pages", () => {
  const currentDate = "2026-10-09";
  assert.equal(taskRangeAttributionDate({ completed: false, due_date: "2026-10-01" }, currentDate), "2026-10-01");
  assert.equal(taskRangeAttributionDate({ completed: true, due_date: "2026-10-01", completed_at: "2026-10-05T12:00:00Z" }, currentDate), "2026-10-05");
  assert.equal(taskRangeAttributionDate({ completed: false, due_date: "2026-11-01", provider_created_at: "2026-10-02T08:00:00Z" }, currentDate), "2026-10-02");
  assert.equal(taskRangeAttributionDate({ completed: false, due_date: null, provider_created_at: null, created_at: "2026-10-03T08:00:00Z" }, currentDate), "2026-10-03");
  assert.equal(taskRangeAttributionDate({ completed: false }, currentDate), null);
});
