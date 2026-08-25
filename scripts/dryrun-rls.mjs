#!/usr/bin/env node
// Prove RLS isolation — the core security promise of the platform (spec §3/§6).
// Emulates Supabase's runtime: a non-superuser `authenticated` role with the
// JWT `sub` claim driving auth.uid(). Confirms user B cannot see/modify user A's
// rows, and that a user cannot insert rows owned by someone else.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
  create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create publication supabase_realtime;
`);
await db.exec(await readFile(path.join(process.cwd(), "supabase/migrations/0001_init.sql"), "utf8"));

// Supabase auto-grants these to the authenticated role; replicate so RLS (not
// missing grants) is what governs visibility.
await db.exec(`
  create role authenticated nologin;
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant usage, select on all sequences in schema public to authenticated;
`);

const A = (await db.query(`insert into auth.users (email) values ('a@wrazy.ai') returning id`)).rows[0].id;
const B = (await db.query(`insert into auth.users (email) values ('b@wrazy.ai') returning id`)).rows[0].id;

async function as(userId, fn) {
  // session-level (false): PGlite autocommits each query, so a transaction-local
  // (true) GUC would vanish before the next statement runs.
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.exec("set role authenticated");
  try { return await fn(); }
  finally { await db.exec("reset role"); }
}

const results = [];
function expect(name, cond) {
  results.push(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) process.exitCode = 1;
}

// A inserts a goal as themselves.
await as(A, () => db.query(`insert into goals (user_id, text) values ($1, 'A secret')`, [A]));

// A sees their own row.
const aSees = await as(A, () => db.query(`select count(*)::int n from goals`));
expect("A sees own goal", aSees.rows[0].n === 1);

// B sees none of A's rows.
const bSees = await as(B, () => db.query(`select count(*)::int n from goals`));
expect("B sees 0 of A's goals (isolation)", bSees.rows[0].n === 0);

// B cannot update A's row (RLS update filter → 0 rows affected).
const bUpd = await as(B, () => db.query(`update goals set text='hacked' where text='A secret'`));
expect("B cannot update A's goal", bUpd.affectedRows === 0);

// B cannot insert a row owned by A (with-check violation → throws).
let blocked = false;
try {
  await as(B, () => db.query(`insert into goals (user_id, text) values ($1, 'forged')`, [A]));
} catch { blocked = true; }
expect("B cannot forge a row as A (with-check)", blocked);

// A's row survived untouched.
const survived = await as(A, () => db.query(`select text from goals`));
expect("A's data intact", survived.rows.length === 1 && survived.rows[0].text === "A secret");

console.log(results.join("\n"));
console.log(process.exitCode ? "\n✗ RLS isolation FAILED" : "\n✓ RLS isolation verified — per-user data is enforced by the database");
await db.close();
