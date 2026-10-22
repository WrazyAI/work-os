import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/0063_work_agent_access.sql", import.meta.url), "utf8");
const followup = await readFile(new URL("../supabase/migrations/0064_work_agent_day_event_cursor.sql", import.meta.url), "utf8");

test("0063 creates agent tokens with hashed secrets and expiry", () => {
  assert.match(migration, /create table if not exists work_agent_tokens/i);
  for (const column of ["organization_id", "person_id", "user_id", "token_hash", "token_prefix", "scopes", "expires_at", "last_used_at", "revoked_at"]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`), `missing work_agent_tokens.${column}`);
  }
  assert.match(migration, /token_hash text not null unique/i);
});

test("0063 creates the idempotency response cache keyed by token and key", () => {
  assert.match(migration, /create table if not exists work_agent_idempotency/i);
  assert.match(migration, /request_hash text not null/i);
  assert.match(migration, /status smallint not null default 0/i);
  assert.match(migration, /body jsonb/i);
  assert.match(migration, /primary key \(token_id, key\)/i);
});

test("0063 adds agent markers to tasks and blockers additively", () => {
  assert.match(migration, /alter table work_tasks add column if not exists agent_token_id/i);
  assert.match(migration, /alter table work_tasks add column if not exists agent_idempotency_key/i);
  assert.match(migration, /create unique index if not exists work_tasks_agent_idempotency_uidx[\s\S]*?where agent_idempotency_key is not null/i);
  assert.match(migration, /alter table work_task_blockers add column if not exists agent_token_id/i);
});

test("0063 defines the person-scoped change feed function", () => {
  assert.match(migration, /create or replace function public\.work_agent_list_tasks\(/i);
  for (const parameter of ["p_user_id", "p_organization_id", "p_person_id", "p_nifty_member_id", "p_updated_since", "p_include_archived", "p_ascending", "p_after_updated_at", "p_after_id", "p_limit"]) {
    assert.match(migration, new RegExp(`\\b${parameter}\\b`), `missing ${parameter}`);
  }
  assert.match(migration, /returns table\(task jsonb\)/i);
  assert.match(migration, /language sql[\s\S]*?stable/i);
  assert.match(migration, /parent_task_id is null[\s\S]*?parent_provider_task_id is null/i);
});

test("0063 is additive only", () => {
  assert.doesNotMatch(migration, /\bdrop table\b|\btruncate\b|\bdelete from\b/i);
});

test("0064 allows agent day events and fixes the descending cursor", () => {
  assert.match(followup, /work_task_day_events_provenance_check/);
  assert.match(followup, /'agent'/);
  assert.match(followup, /p_ascending and \(t\.updated_at, t\.id\) >/);
  assert.match(followup, /not p_ascending and \(t\.updated_at, t\.id\) </);
  assert.match(followup, /create or replace function public\.work_agent_list_tasks/i);
  assert.doesNotMatch(followup, /\bdrop table\b|\btruncate\b|\bdelete from\b/i);
});
