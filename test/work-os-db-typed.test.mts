import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Pool, PoolClient } from "pg";
import { execSql, queryOne, queryRequired, queryRows, withTransaction, type Queryable } from "../src/lib/db/typed";

test("typed query helpers return rows, null, throw on missing required row, and report affected counts", async () => {
  const db = new PGlite();
  await db.exec(`create table sample_items (id int primary key, label text not null);`);

  const queryable = db as unknown as Queryable;
  const inserted = await execSql(queryable, `insert into sample_items (id, label) values ($1, $2), ($3, $4)`, [1, "alpha", 2, "beta"]);
  assert.equal(inserted, 2);

  const all = await queryRows<{ id: number; label: string }>(queryable, `select id, label from sample_items order by id`);
  assert.deepEqual(all, [{ id: 1, label: "alpha" }, { id: 2, label: "beta" }]);

  const found = await queryOne<{ id: number; label: string }>(queryable, `select id, label from sample_items where id = $1`, [2]);
  assert.deepEqual(found, { id: 2, label: "beta" });

  const missing = await queryOne<{ id: number }>(queryable, `select id from sample_items where id = $1`, [999]);
  assert.equal(missing, null);

  const required = await queryRequired<{ label: string }>(queryable, `select label from sample_items where id = $1`, [1]);
  assert.deepEqual(required, { label: "alpha" });

  await assert.rejects(
    () => queryRequired(queryable, `select id from sample_items where id = $1`, [999], "Item missing"),
    /Item missing/,
  );

  await db.close();
});

test("withTransaction commits on success, rolls back on error, and always releases the client", async () => {
  const events: string[] = [];
  let released = 0;

  const fakeClient = {
    async query(sql: string) {
      events.push(sql);
      return { rows: [{ ok: true }], rowCount: 1 };
    },
    release() {
      released += 1;
    },
  } as unknown as PoolClient;

  const fakePool = {
    async connect() {
      return fakeClient;
    },
  } as unknown as Pool;

  const committed = await withTransaction(async (client) => {
    const row = await queryOne<{ ok: boolean }>(client, "SELECT 1 AS ok");
    return row?.ok;
  }, fakePool);
  assert.equal(committed, true);
  assert.deepEqual(events, ["BEGIN", "SELECT 1 AS ok", "COMMIT"]);
  assert.equal(released, 1);

  events.length = 0;
  await assert.rejects(
    () =>
      withTransaction(async (client) => {
        await execSql(client, "INSERT INTO demo VALUES (1)");
        throw new Error("boom");
      }, fakePool),
    /boom/,
  );
  assert.deepEqual(events, ["BEGIN", "INSERT INTO demo VALUES (1)", "ROLLBACK"]);
  assert.equal(released, 2);
});

test("Payroll and Admin Otto row definitions match real migration DDL column names", async () => {
  const payrollDdl = await readFile("supabase/migrations/0078_work_payroll_review.sql", "utf8");
  const adminOttoDdl = await readFile("supabase/migrations/0065_work_admin_otto.sql", "utf8");
  const payrollRowsSrc = await readFile("src/lib/db/rows/payroll.ts", "utf8");
  const adminOttoRowsSrc = await readFile("src/lib/db/rows/admin-otto.ts", "utf8");

  for (const col of [
    "organization_id",
    "auto_approve_enabled",
    "cutoff_hour",
    "analysis_revision",
    "row_version",
    "retention_expires_at",
    "snapshot_hash",
    "payload_hash",
  ]) {
    assert.ok(payrollDdl.includes(col), `payroll DDL includes ${col}`);
    assert.ok(payrollRowsSrc.includes(col), `payroll row types include ${col}`);
  }

  for (const col of [
    "membership_id",
    "context_version",
    "resolved_person_ids",
    "pending_resolution",
    "source_refs",
    "request_hash",
    "materialized_through_sequence",
  ]) {
    assert.ok(adminOttoDdl.includes(col), `admin otto DDL includes ${col}`);
    assert.ok(adminOttoRowsSrc.includes(col), `admin otto row types include ${col}`);
  }
});
