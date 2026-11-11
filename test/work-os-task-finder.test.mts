import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { validateTaskFinderFilters } from "../src/modules/work-os/task-finder.ts";
import { createWorkspaceTaskCursor, parseWorkspaceTaskCursor, taskPageScope } from "../src/lib/work-os-task-pagination.ts";

test("finder validates status, query length and calendar ranges before querying", () => {
  assert.deepEqual(validateTaskFinderFilters({}), { search: "", status: "all", from: "", to: "" });
  assert.equal(validateTaskFinderFilters({ search: "  needle  ", from: "2028-02-29", to: "2028-03-01", status: "in_progress" }).search, "needle");
  for (const value of [{ status: "open" }, { search: "x".repeat(201) }, { from: "2026-02-29" }, { from: "2026-11-20", to: "2026-11-01" }]) {
    assert.throws(() => validateTaskFinderFilters(value), /status|200|date|range/i);
  }
  const a = taskPageScope({ status: "pending" });
  const cursor = createWorkspaceTaskCursor({ id: "id", title: "title" }, { scope: a, order: "due_desc", sortDate: "2026-11-11", position: 50 });
  assert.throws(() => parseWorkspaceTaskCursor(cursor, taskPageScope({ status: "overdue" })), /must be valid/);
});

test("finder SQL intersects state/text/date before paging and keeps tenant and parent boundaries", async () => {
  const db = new PGlite();
  const user = "00000000-0000-4000-8000-000000000001";
  const org = "00000000-0000-4000-8000-000000000002";
  const person = "00000000-0000-4000-8000-000000000003";
  try {
    await db.exec(`create table work_projects(id uuid primary key,user_id uuid,name text);
      create table work_tasks(id uuid primary key,user_id uuid,organization_id uuid,project_id uuid,title text,description text,
        status text default 'open',workflow_status text default 'pending',completed boolean default false,
        parent_task_id uuid,parent_provider_task_id text,assigned_by_person_id uuid,
        assignee_person_ids uuid[] default '{}',assignee_provider_ids text[] default '{}',raw jsonb default '{}',
        due_date date,completed_at timestamptz,provider_created_at timestamptz,created_at timestamptz default now(),
        provider_updated_at timestamptz,updated_at timestamptz default now());`);
    await db.exec(await readFile(new URL("../supabase/migrations/0073_work_task_finder_status.sql", import.meta.url), "utf8"));
    for (let i = 1; i <= 61; i++) {
      await db.query(`insert into work_tasks(id,user_id,organization_id,title,due_date,assignee_person_ids,workflow_status,completed)
        values ($1,$2,$3,$4,$5,array[$6::uuid],$7,$8)`,
      [`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, user, org, i > 55 ? `Needle ${i}` : `Other ${i}`, i === 59 ? null : i > 55 ? "2026-11-10" : "2026-11-12", person, i % 2 ? "in_progress" : "pending", i === 60]);
    }
    await db.exec(`update work_tasks set parent_task_id=id where title='Needle 61';
      update work_tasks set organization_id='00000000-0000-4000-8000-999999999999' where title='Needle 58';`);
    const page = async (status: string, from: string | null = null, to: string | null = null, limit = 50) => (await db.query<{task: Record<string, unknown> | null;total_count: number;has_more: boolean}>(
      `select * from work_find_person_task_page(p_user_id=>$1::uuid,p_organization_id=>$2::uuid,p_person_id=>$3::uuid,
        p_sort_date=>'2026-11-11'::date,p_search=>'needle',p_status=>$4::text,p_from=>$5::date,p_to=>$6::date,p_limit=>$7::integer)`,
      [user,org,person,status,from,to,limit])).rows;
    assert.deepEqual((await page("overdue")).map(r => r.task?.title).sort(), ["Needle 56", "Needle 57"]);
    assert.equal(Number((await page("completed"))[0].total_count), 1);
    assert.equal((await page("completed"))[0].task?.title, "Needle 60");
    assert.equal(Number((await page("in_progress"))[0].total_count), 1); // undated 59, not overdue 57
    assert.equal(Number((await page("pending"))[0].total_count), 0);
    assert.equal(Number((await page("all", "2026-11-10", "2026-11-10"))[0].total_count), 3);
    assert.equal(Number((await page("all", null, null, 1))[0].total_count), 4);
    assert.equal((await page("all", null, null, 1))[0].has_more, true);
    // Visibility through delegation survives even when a state filter selects open work.
    await db.exec(`update work_tasks set assignee_person_ids='{}',assigned_by_person_id='${person}' where title='Needle 56';`);
    assert.equal(Number((await page("overdue"))[0].total_count), 2);
  } finally { await db.close(); }
});
