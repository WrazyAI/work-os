#!/usr/bin/env node
// Apply supabase/migrations/*.sql directly over Postgres (no CLI link / no
// access token needed — just a DB connection). Runs each migration file in a
// single transaction, in filename order.
//
// Provide the connection one of two ways (in .env.local or the environment):
//   SUPABASE_DB_URL=postgresql://postgres.<ref>:<pw>@<host>:5432/postgres
//     (copy from Supabase dashboard → Project Settings → Database → Connection
//      string → "Session pooler" or "Direct", fill in the password)
//   — or —
//   SUPABASE_DB_PASSWORD=<pw>   (uses the direct host db.<ref>.supabase.co,
//                                deriving <ref> from NEXT_PUBLIC_SUPABASE_URL)
//
// Usage: node scripts/apply-migration.mjs [validated-migration-filename.sql]
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

function connString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const pw = process.env.SUPABASE_DB_PASSWORD;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (pw && url) {
    const ref = new URL(url).hostname.split(".")[0];
    return `postgresql://postgres:${encodeURIComponent(pw)}@db.${ref}.supabase.co:5432/postgres`;
  }
  return null;
}

const conn = connString();
if (!conn) {
  console.error("Set SUPABASE_DB_URL (preferred) or SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });

const availableFiles = (await readdir(MIGRATIONS))
  .filter((f) => f.endsWith(".sql"))
  .sort();
const requested = process.argv[2];
if (requested && (path.basename(requested) !== requested || !availableFiles.includes(requested))) {
  console.error(`Unknown migration filename: ${requested}`);
  process.exit(1);
}
const files = requested ? [requested] : availableFiles;

if (files.length === 0) {
  console.error(`No .sql files in ${MIGRATIONS}`);
  process.exit(1);
}

try {
  await client.connect();
  console.log(`Connected. Applying ${files.length} migration(s):`);
  for (const f of files) {
    const sql = await readFile(path.join(MIGRATIONS, f), "utf8");
    process.stdout.write(`  • ${f} … `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      console.log("ok");
    } catch (e) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(`\n${f} error:\n${e.message}\n`);
      process.exit(1);
    }
  }
  console.log("✓ all migrations applied");
} catch (e) {
  console.error("connection failed:", e.message);
  console.error("(new Supabase projects make the direct host IPv6-only — if this");
  console.error(" fails, use SUPABASE_DB_URL with the Session pooler string instead.)");
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
