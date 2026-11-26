import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { adminPersonTaskPageSql } from "../src/lib/work-os-admin-task-pagination";

const taskId = (id: number) => "10000000-0000-4000-8000-" + String(id).padStart(12, "0");

test("admin person task pages extend past 1,000 without duplicate or cross-organization rows", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(String.raw`
      CREATE TABLE work_people (id uuid PRIMARY KEY, organization_id uuid, user_id text, nifty_member_id text);
      CREATE TABLE work_tasks (
        id uuid PRIMARY KEY, organization_id uuid, user_id text, status text, completed boolean, title text,
        project_id uuid, assigned_by_person_id uuid, assignee_person_ids uuid[], assignee_provider_ids text[],
        raw jsonb, created_at timestamptz
      );
      CREATE TABLE work_projects (id uuid PRIMARY KEY, organization_id uuid, user_id text, name text);
      CREATE TABLE work_evidence (
        id integer PRIMARY KEY, task_id uuid, organization_id uuid, user_id text,
        source text, title text, evidence_date date, raw jsonb
      );
      INSERT INTO work_projects VALUES
        ('00000000-0000-0000-0000-000000000030', '00000000-0000-0000-0000-000000000010', 'owner', 'Project');
      INSERT INTO work_evidence VALUES
        (1, '${taskId(4)}', '00000000-0000-0000-0000-000000000010', 'owner', 'manual', 'Evidence', '2026-01-01', '{}'),
        (2, '${taskId(4)}', '00000000-0000-0000-0000-000000000020', 'owner', 'manual', 'Other organization', '2026-01-01', '{}'),
        (3, '${taskId(4)}', '00000000-0000-0000-0000-000000000010', 'other', 'manual', 'Other owner', '2026-01-01', '{}');
      INSERT INTO work_people VALUES
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'owner', U&'\0009\00A0legacy-id\000A\FEFF');
      INSERT INTO work_tasks
        SELECT ('10000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
          (CASE WHEN i = 1006 THEN '00000000-0000-0000-0000-000000000020' ELSE '00000000-0000-0000-0000-000000000010' END)::uuid,
          CASE WHEN i = 1007 THEN 'other' ELSE 'owner' END,
          CASE WHEN i = 1008 THEN 'archived' ELSE 'open' END,
          i = 1009, 'Task ' || i, '00000000-0000-0000-0000-000000000030',
          CASE WHEN i % 5 = 1 THEN '00000000-0000-0000-0000-000000000001'::uuid END,
          CASE WHEN i % 5 = 0 THEN ARRAY['00000000-0000-0000-0000-000000000001'::uuid] ELSE '{}'::uuid[] END,
          CASE WHEN i % 5 = 2 THEN ARRAY['legacy-id'] ELSE '{}'::text[] END,
          CASE WHEN i % 5 = 3 THEN '{"created_by":"legacy-id"}'::jsonb
            WHEN i % 5 IN (0, 4) THEN '{"subscribers":["legacy-id"]}'::jsonb ELSE '{}'::jsonb END,
          '2026-01-01T00:00Z'::timestamptz + (i / 2) * interval '1 second'
        FROM generate_series(1, 1009) AS i;
    `);
    const args = ["00000000-0000-0000-0000-000000000010", "owner", "00000000-0000-0000-0000-000000000001", false, "00000000-0000-0000-0000-000000000030"];
    const first = await pg.query<{ id: string }>(adminPersonTaskPageSql, [...args, 0, 1000, null]);
    const last = await pg.query<{ id: string; delegated_only: boolean; title: string; project: unknown; evidence: unknown }>(adminPersonTaskPageSql, [...args, 1000, 100, null]);
    assert.equal(first.rows.length, 1000);
    assert.deepEqual(last.rows.map(({ id, delegated_only }) => ({ id, delegated_only })), [
      { id: taskId(4), delegated_only: false },
      { id: taskId(5), delegated_only: false },
      { id: taskId(2), delegated_only: false },
      { id: taskId(3), delegated_only: false },
      { id: taskId(1), delegated_only: true },
    ]);
    // The same snapshot that selects page members must return their details;
    // a second status-filtered task read can truncate the page after selection.
    assert.equal(last.rows[0].title, "Task 4");
    assert.equal((last.rows[0].project as { name: string }).name, "Project");
    assert.deepEqual(last.rows[0].evidence, [
      { id: 1, source: "manual", title: "Evidence", evidence_date: "2026-01-01" },
    ]);
    assert.deepEqual(last.rows[1].evidence, []);
    assert.equal(new Set([...first.rows, ...last.rows].map((row) => row.id)).size, 1005);
    assert.deepEqual((await pg.query<{ id: string; delegated_only: boolean }>(adminPersonTaskPageSql, [...args.slice(0, 3), true, args[4], 0, 100, null])).rows.map(({ id, delegated_only }) => ({ id, delegated_only })),
      [{ id: taskId(1009), delegated_only: false }]);
    assert.deepEqual((await pg.query(adminPersonTaskPageSql, [...args.slice(0, 4), "00000000-0000-0000-0000-000000000999", 0, 100, null])).rows, []);
    const selectedIds = [1007, 5, 3, 2, 4, 1, 1006].map(taskId);
    // Filter before offset and order same-time tasks by ID, not by input order.
    const filtered = await pg.query<{ id: string }>(adminPersonTaskPageSql, [...args, 1, 3, selectedIds]);
    assert.deepEqual(filtered.rows.map(({ id }) => id), [5, 2, 3].map(taskId));
    const longSelection = [...first.rows.slice(1), ...last.rows].map(({ id }) => id);
    const filteredTail = await pg.query<{ id: string }>(adminPersonTaskPageSql, [...args, 1000, 100, longSelection]);
    assert.deepEqual(filteredTail.rows.map(({ id }) => id), [5, 2, 3, 1].map(taskId));
    assert.deepEqual((await pg.query(adminPersonTaskPageSql, [...args, 0, 100, []])).rows, []);
  } finally {
    await pg.close();
  }
});
