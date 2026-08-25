#!/usr/bin/env node
// Validate supabase/migrations/*.sql against a real Postgres engine (PGlite,
// in-process WASM) WITHOUT a live database. Shims the Supabase-only objects the
// migration depends on (auth schema/users, auth.uid(), the supabase_realtime
// publication), then runs each migration to catch DDL/RLS/trigger errors before
// they hit the real project.
//
// Usage:  node scripts/dryrun-migration.mjs
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

// Minimal stand-ins for what Supabase provides at runtime.
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create schema if not exists storage;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  create table if not exists storage.buckets (
    id text primary key,
    name text not null,
    public boolean not null default false,
    file_size_limit bigint
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null
  );
  create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
    select string_to_array(name, '/')
  $$;
  alter table storage.objects enable row level security;
  create publication supabase_realtime;
`;

const db = new PGlite();
await db.exec(SUPABASE_SHIM);

const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql")).sort();
let ok = true;
for (const f of files) {
  let sql = await readFile(path.join(MIGRATIONS, f), "utf8");
  // PGlite does not bundle pgvector. Keep production migrations authoritative,
  // but replace only vector-specific DDL/operators in this syntax/RLS dry-run.
  // The live Supabase apply still executes CREATE EXTENSION, vector(1024), and
  // the HNSW index unchanged.
  if (sql.includes("create extension if not exists vector")) {
    sql = sql
      .replace(/create extension if not exists vector with schema extensions;\s*/i, "")
      .replace(
        /create index if not exists note_embedding_chunks_hnsw_idx\s+on note_embedding_chunks using hnsw \(embedding extensions\.vector_cosine_ops\);\s*/i,
        "",
      )
      .replaceAll("extensions.vector(1024)", "double precision[]")
      .replace(
        /1 - \(e\.embedding <=> query_embedding\) as similarity/i,
        "0::double precision as similarity",
      )
      .replace(/order by e\.embedding <=> query_embedding/i, "order by e.chunk_index");
  }
  process.stdout.write(`  • ${f} … `);
  try {
    await db.exec(sql);
    console.log("ok");
  } catch (e) {
    ok = false;
    console.log("FAILED");
    console.error(`\n${f}:\n${e.message}\n`);
    break;
  }
}

if (ok) {
  // Sanity: confirm key objects + RLS landed.
  const t = await db.query(
    `select count(*)::int n from information_schema.tables where table_schema='public'`,
  );
  const p = await db.query(`select count(*)::int n from pg_policies where schemaname='public'`);
  const pub = await db.query(
    `select count(*)::int n from pg_publication_tables where pubname='supabase_realtime'`,
  );
  console.log(`✓ migration valid — ${t.rows[0].n} tables, ${p.rows[0].n} RLS policies, ${pub.rows[0].n} realtime tables`);
}
await db.close();
process.exit(ok ? 0 : 1);
