#!/usr/bin/env node
// Apply supabase/migrations/*.sql directly over Postgres (no CLI link / no
// access token needed — just a DB connection). Runs each migration file in a
// single transaction, in filename order.
//
// The runtime data layer is Neon, so by default this targets DATABASE_URL and
// prints the resolved host before applying. Resolution order (see
// scripts/resolve-migration-db-url.mjs):
//   MIGRATION_DATABASE_URL → DATABASE_URL_UNPOOLED → DATABASE_URL →
//   SUPABASE_DB_URL → SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL
// Set MIGRATION_DATABASE_URL when a migration must deliberately land on the
// legacy Supabase project instead.
//
// Usage: node scripts/apply-migration.mjs [validated-migration-filename.sql]
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import nextEnv from "@next/env";
import { migrationTargetLabel, resolveMigrationDbUrl } from "./resolve-migration-db-url.mjs";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const MIGRATIONS = path.join(process.cwd(), "supabase", "migrations");

const conn = resolveMigrationDbUrl();
if (!conn) {
  console.error("No database connection found. Set DATABASE_URL (Neon runtime), or");
  console.error("MIGRATION_DATABASE_URL / SUPABASE_DB_URL for a legacy Supabase target.");
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
  console.log(`Connected to ${migrationTargetLabel(conn)}. Applying ${files.length} migration(s):`);
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
  console.error("(Neon needs its pooled or direct connection string; on the legacy");
  console.error(" Supabase project the direct host is IPv6-only — use the Session pooler.)");
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
