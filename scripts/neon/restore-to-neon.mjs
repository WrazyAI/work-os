/**
 * Full logical restore: Supabase Agent-OS dump -> Neon Postgres.
 *
 * Expects a dump directory produced by the dump phase (see
 * docs/NEON-MIGRATION-PLAN.md §2): per-table JSON files + schema.sql +
 * manifest.json, plus an "extras" dir with pg_catalog DDL extracted from the
 * live Supabase DB (types/functions/triggers/indexes/FKs).
 *
 * Idempotent: drops and recreates the `public` schema on every run.
 *
 * Usage:
 *   DATABASE_URL=postgres://... VECTOR_DIMS=1024 \
 *     node scripts/neon/restore-to-neon.mjs <dumpDir> <extrasDir>
 *
 * The working copy used for the 2026-08-28 restore also applies
 * scripts/neon/unique-constraints.sql after data import (63 UNIQUE
 * constraints) and sets `issuer = 'local:credential'` on neon_auth accounts
 * (required by Better Auth 1.7).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client } = require("pg");

const DUMP = process.argv[2] ?? "/home/zahemen/backups/agent-os-full-2026-08-28";
const EXTRAS = process.argv[3] ?? "/home/zahemen/backups/agent-os-extras";

const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: "require" });
await client.connect();

const run = async (sql, label) => {
  if (!sql.trim()) return;
  await client.query(sql);
  console.log(`applied: ${label}`);
};

// ── 0. Extensions + clean slate ──
await client.query("SET search_path = public, extensions;");
await client.query("DROP EXTENSION IF EXISTS vector CASCADE;");
await client.query("DROP SCHEMA IF EXISTS public CASCADE;");
await client.query("CREATE SCHEMA public;");
await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
console.log("public schema recreated");

// ── 1. Enum/composite types ──
const enumTypes = JSON.parse(fs.readFileSync(`${EXTRAS}/enum-types.json`, "utf8"));
await run(
  enumTypes
    .map(
      (t) =>
        `DO $$ BEGIN CREATE TYPE "public"."${t.typname}" AS ENUM (${t.labels
          .split(",")
          .map((l) => `'${l}'`)
          .join(", ")}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    )
    .join("\n"),
  "types",
);

// ── 2. Public tables (+ sequences referenced by defaults) ──
const schemaSql = fs.readFileSync(`${DUMP}/schema.sql`, "utf8");
const blocks = schemaSql.split("\n\n");
const pubTables = blocks
  .filter((b) => b.startsWith('CREATE TABLE IF NOT EXISTS "public".'))
  .map((b) => b.replace(/numeric\(\s*,\s*,?\s*\)/g, "numeric").replace(/varchar\(MAX\)/g, "varchar"));
const seqNames = [
  ...new Set(pubTables.flatMap((b) => [...b.matchAll(/nextval\('"public"\."([^"]+)"'/g)].map((m) => m[1]))),
];
await run(seqNames.map((s) => `CREATE SEQUENCE IF NOT EXISTS "public"."${s}";`).join("\n"), `sequences (${seqNames.length})`);
await run(pubTables.join("\n\n"), `public tables (${pubTables.length})`);

// ── 3. Functions (per-statement, retried until dependency order resolves) ──
await run(
  "CREATE SCHEMA IF NOT EXISTS auth; CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;",
  "auth.uid() compat shim",
);
const fnDefs = fs
  .readFileSync(`${EXTRAS}/20-functions.sql`, "utf8")
  .split(/\n\n(?=CREATE OR REPLACE FUNCTION)/)
  .map((d) => (d.trimEnd().endsWith(";") ? d.trimEnd() : d.trimEnd() + ";"));
let applied = 0;
const deferred = [];
for (let i = 0, retriesLeft = fnDefs.length; i < fnDefs.length; ) {
  try {
    await client.query(fnDefs[i]);
    applied++;
    i++;
  } catch (e) {
    deferred.push({ def: fnDefs[i], err: e.message });
    retriesLeft--;
    if (retriesLeft <= 0) break;
    i++;
  }
}
for (let pass = 0; pass < 3 && deferred.length && applied; pass++) {
  for (let i = 0; i < deferred.length; ) {
    try {
      await client.query(deferred[i].def);
      deferred.splice(i, 1);
      applied++;
    } catch (e) {
      deferred[i].err = e.message;
      i++;
    }
  }
}
console.log(`functions: ${applied} applied, ${deferred.length} failed`);
for (const d of deferred) console.error(`  FN FAIL: ${d.err}`);

// ── 4. Data import (truncate first for idempotency) ──
const manifest = JSON.parse(fs.readFileSync(`${DUMP}/manifest.json`, "utf8"));
const pubTablesInManifest = manifest.tables.filter((t) => t.schema === "public" && !t.error);
const existing = (await client.query(`SELECT relname FROM pg_stat_user_tables WHERE schemaname='public'`)).rows.map(
  (r) => `"public"."${r.relname}"`,
);
if (existing.length) {
  await client.query(`TRUNCATE TABLE ${existing.join(", ")}`);
  console.log(`truncated ${existing.length} tables for clean import`);
}
let totalRows = 0;
for (const t of pubTablesInManifest) {
  const file = `${DUMP}/public.${t.table}.json`;
  if (!fs.existsSync(file)) {
    console.error(`MISSING FILE public.${t.table}`);
    continue;
  }
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  const jsonCols = new Set(
    (
      await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema='public' AND table_name=$1 AND data_type IN ('json','jsonb')`,
        [t.table],
      )
    ).rows.map((r) => r.column_name),
  );
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const CHUNK = 200;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const params = [];
    const tuples = chunk.map((row) => {
      const vals = cols.map((c) => {
        let v = row[c] === undefined ? null : row[c];
        if (jsonCols.has(c) && v !== null && (typeof v === "string" || typeof v === "object")) {
          v = JSON.stringify(v);
        }
        params.push(v);
        return `$${params.length}`;
      });
      return `(${vals.join(", ")})`;
    });
    await client.query(`INSERT INTO "public"."${t.table}" (${colList}) VALUES ${tuples.join(", ")}`, params);
  }
  totalRows += rows.length;
  console.log(`data: public.${t.table} (${rows.length} rows)`);
}
console.log(`TOTAL data rows: ${totalRows}`);

// ── 5. Triggers, vector dims, indexes ──
await run(
  fs
    .readFileSync(`${EXTRAS}/40-triggers.sql`, "utf8")
    .split(/\n\n(?=CREATE TRIGGER)/)
    .map((d) => (d.trimEnd().endsWith(";") ? d.trimEnd() : d.trimEnd() + ";"))
    .join("\n\n"),
  "triggers",
);

const vectorCols = (
  await client.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public' AND udt_name='vector'`,
  )
).rows;
for (const v of vectorCols) {
  const rows = JSON.parse(fs.readFileSync(`${DUMP}/public.${v.table_name}.json`, "utf8"));
  const sample = rows.map((r) => r[v.column_name]).find((x) => x != null);
  let dims = Array.isArray(sample) ? sample.length : null;
  if (!dims && process.env.VECTOR_DIMS) dims = parseInt(process.env.VECTOR_DIMS, 10);
  if (!dims) {
    console.error(`vector col ${v.table_name}.${v.column_name}: could not infer dims`);
    continue;
  }
  await client.query(
    `ALTER TABLE "public"."${v.table_name}" ALTER COLUMN "${v.column_name}" TYPE vector(${dims}) USING "${v.column_name}"::text::vector(${dims})`,
  );
  console.log(`vector: ${v.table_name}.${v.column_name} -> vector(${dims})`);
}

await run(fs.readFileSync(`${EXTRAS}/50-indexes.sql`, "utf8"), "indexes");

// ── 6. Foreign keys (skip Supabase-specific auth/storage refs) ──
const fkDefs = fs
  .readFileSync(`${EXTRAS}/60-fks.sql`, "utf8")
  .split(/\n(?=ALTER TABLE)/)
  .map((d) => d.trim())
  .filter(Boolean);
let fkOk = 0;
let fkSkip = 0;
for (const d of fkDefs) {
  if (/REFERENCES\s+"?(auth|storage)"?\./i.test(d)) {
    fkSkip++;
    continue;
  }
  try {
    await client.query(d);
    fkOk++;
  } catch (e) {
    console.error(`FK FAIL: ${d.slice(0, 120)} -> ${e.message}`);
  }
}
console.log(`foreign keys: ${fkOk} applied, ${fkSkip} skipped (auth/storage refs)`);

// ── 6b. UNIQUE constraints (required for ON CONFLICT upserts) ──
const uniqueSql = path.join(EXTRAS, "unique-constraints.sql");
if (fs.existsSync(uniqueSql)) {
  await run(fs.readFileSync(uniqueSql, "utf8"), "unique constraints");
} else {
  console.error("unique-constraints.sql not found in extras dir — upserts with onConflict will fail");
}

// ── 7. Identity columns + sequence positions ──
const identityTables = {
  run_events: 4376,
  work_audit_log: 165,
  seo_approval_events: 126,
  task_comments: 0,
  task_events: 0,
  task_runs: 0,
};
for (const [tbl, srcLast] of Object.entries(identityTables)) {
  const idCol = await client.query(
    `SELECT attidentity FROM pg_attribute WHERE attrelid = 'public.${tbl}'::regclass AND attname = 'id'`,
  );
  if (!idCol.rows.length) {
    console.error(`identity: table public.${tbl} not found`);
    continue;
  }
  if (idCol.rows[0].attidentity !== "a") {
    await client.query(`ALTER TABLE "public"."${tbl}" ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY;`);
  }
  const mx = (await client.query(`SELECT coalesce(max(id), 0) AS m FROM "public"."${tbl}"`)).rows[0].m;
  const target = Math.max(mx, srcLast, 1);
  const called = target > 1 || mx > 0 || srcLast > 0;
  await client.query(`SELECT setval(pg_get_serial_sequence('public.${tbl}', 'id'), $1, $2)`, [target, called]);
  console.log(`identity: public.${tbl}.id next=${target + 1}`);
}

// ── 8. Auth users → neon_auth (bcrypt password carry-over) ──
await client.query('DELETE FROM neon_auth."account"');
await client.query('DELETE FROM neon_auth."user"');
const authUsers = JSON.parse(fs.readFileSync(`${DUMP}/auth.users.json`, "utf8"));
const { randomUUID } = await import("node:crypto");
for (const u of authUsers) {
  const meta = u.raw_user_meta_data ?? {};
  const name = meta.full_name ?? meta.display_name ?? meta.name ?? (u.email ?? "").split("@")[0];
  const verified = u.email_confirmed_at != null || u.confirmed_at != null;
  await client.query(
    `INSERT INTO neon_auth."user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [u.id, name, u.email, verified, u.created_at, u.updated_at ?? u.created_at],
  );
  if (u.encrypted_password) {
    await client.query(
      `INSERT INTO neon_auth."account" (id, "accountId", "providerId", "userId", password, "issuer", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [randomUUID(), u.id, "credential", u.id, u.encrypted_password, "local:credential", u.created_at, u.updated_at ?? u.created_at],
    );
  }
  console.log(`neon_auth user: ${u.email}`);
}

// ── 9. Verification ──
const manifestPublic = Object.fromEntries(pubTablesInManifest.map((t) => [t.table, t.rows]));
const src = await client.query(`SELECT relname FROM pg_stat_user_tables WHERE schemaname='public'`);
let mismatch = 0;
let checked = 0;
for (const r of src.rows) {
  const c = await client.query(`SELECT count(*)::int AS n FROM "public"."${r.relname}"`);
  const expected = manifestPublic[r.relname];
  if (expected !== undefined) {
    checked++;
    if (expected !== c.rows[0].n) {
      console.error(`MISMATCH public.${r.relname}: expected ${expected}, got ${c.rows[0].n}`);
      mismatch++;
    }
  }
}
console.log(`\nVERIFY: ${checked} tables compared against manifest, ${mismatch} mismatches`);
console.log(`neon_auth users: ${(await client.query('SELECT count(*) FROM neon_auth."user"')).rows[0].count}`);
console.log(`neon_auth accounts: ${(await client.query('SELECT count(*) FROM neon_auth."account"')).rows[0].count}`);

await client.end();
console.log("RESTORE DONE");
