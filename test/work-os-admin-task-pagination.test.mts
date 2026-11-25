import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { adminPersonTaskPageSql } from "../src/lib/work-os-admin-task-pagination";

test("admin person task pages extend past 1,000 without duplicate or cross-organization rows", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      CREATE TABLE work_people (id uuid PRIMARY KEY, organization_id uuid, user_id text, nifty_member_id text);
      CREATE TABLE work_tasks (
        id integer PRIMARY KEY, organization_id uuid, user_id text, status text, completed boolean,
        project_id uuid, assigned_by_person_id uuid, assignee_person_ids uuid[], assignee_provider_ids text[],
        raw jsonb, created_at timestamptz
      );
      INSERT INTO work_people VALUES
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'owner', ' legacy-id ');
      INSERT INTO work_tasks
        SELECT i,
          (CASE WHEN i = 1006 THEN '00000000-0000-0000-0000-000000000020' ELSE '00000000-0000-0000-0000-000000000010' END)::uuid,
          CASE WHEN i = 1007 THEN 'other' ELSE 'owner' END,
          CASE WHEN i = 1008 THEN 'archived' ELSE 'open' END,
          i = 1009, '00000000-0000-0000-0000-000000000030',
          CASE WHEN i % 5 = 1 THEN '00000000-0000-0000-0000-000000000001'::uuid END,
          CASE WHEN i % 5 = 0 THEN ARRAY['00000000-0000-0000-0000-000000000001'::uuid] ELSE '{}'::uuid[] END,
          CASE WHEN i % 5 = 2 THEN ARRAY['legacy-id'] ELSE '{}'::text[] END,
          CASE WHEN i % 5 = 3 THEN '{"created_by":"legacy-id"}'::jsonb
            WHEN i % 5 IN (0, 4) THEN '{"subscribers":["legacy-id"]}'::jsonb ELSE '{}'::jsonb END,
          '2026-01-01T00:00Z'::timestamptz + (i / 2) * interval '1 second'
        FROM generate_series(1, 1009) AS i;
    `);
    const args = ["00000000-0000-0000-0000-000000000010", "owner", "00000000-0000-0000-0000-000000000001", false, "00000000-0000-0000-0000-000000000030"];
    const first = await pg.query<{ id: number }>(adminPersonTaskPageSql, [...args, 0, 1000]);
    const last = await pg.query<{ id: number; delegated_only: boolean }>(adminPersonTaskPageSql, [...args, 1000, 100]);
    assert.equal(first.rows.length, 1000);
    assert.deepEqual(last.rows, [
      { id: 4, delegated_only: false },
      { id: 5, delegated_only: false },
      { id: 2, delegated_only: false },
      { id: 3, delegated_only: false },
      { id: 1, delegated_only: true },
    ]);
    assert.equal(new Set([...first.rows, ...last.rows].map((row) => row.id)).size, 1005);
    assert.deepEqual((await pg.query(adminPersonTaskPageSql, [...args.slice(0, 3), true, args[4], 0, 100])).rows,
      [{ id: 1009, delegated_only: false }]);
    assert.deepEqual((await pg.query(adminPersonTaskPageSql, [...args.slice(0, 4), "00000000-0000-0000-0000-000000000999", 0, 100])).rows, []);
  } finally {
    await pg.close();
  }
});
