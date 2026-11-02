import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const sql = () => read("supabase/migrations/0069_work_admin_agent_access.sql");

test("admin tokens are a kind, and only admins may omit a person", async () => {
  const body = await sql();
  assert.match(body, /add column if not exists kind text not null default 'employee'/);
  assert.match(body, /alter column person_id drop not null/);
  assert.match(body, /kind in \('employee', 'admin'\)/);
  assert.match(body, /kind = 'admin' or person_id is not null/);
});

test("the preview table stores the request, state, result, and expiry", async () => {
  const body = await sql();
  for (const column of ["organization_id", "user_id", "token_id", "source", "action", "target_type", "request", "preview", "state_fingerprint", "result_status", "result_body", "idempotency_key", "expires_at", "confirmed_at"]) {
    assert.match(body, new RegExp(`\\b${column}\\b`), `missing ${column}`);
  }
  assert.match(body, /create index if not exists work_admin_action_previews_token_idx/);
  assert.match(body, /enable row level security/);
});

test("the migration is additive and repeatable", async () => {
  const body = await sql();
  assert.match(body, /create table if not exists work_admin_action_previews/);
  assert.doesNotMatch(body, /drop table|truncate|delete from/i);

  const db = new PGlite();
  await db.exec(`
    create table work_organizations (id uuid primary key);
    create table work_agent_tokens (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null,
      person_id uuid not null, user_id uuid not null, name text not null,
      token_hash text not null unique, token_prefix text not null,
      scopes text[] not null default '{}', created_by uuid,
      expires_at timestamptz not null, last_used_at timestamptz,
      revoked_at timestamptz, created_at timestamptz not null default now()
    );
  `);
  await db.exec(await sql());
  await db.exec(await sql());
  const columns = await db.query<{ column_name: string; is_nullable: string }>(
    `select column_name, is_nullable from information_schema.columns where table_name = 'work_agent_tokens' and column_name in ('kind','person_id') order by column_name`,
  );
  assert.deepEqual(columns.rows, [
    { column_name: "kind", is_nullable: "NO" },
    { column_name: "person_id", is_nullable: "YES" },
  ]);
  await db.close();
});
