#!/usr/bin/env node
// Applies the complete Work OS migration sequence.
//
// This helper intentionally parses .env.local/.env itself instead of requiring
// `source .env`, because URL values with `&` can break shell sourcing.

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import pg from "pg";

const MIGRATIONS = [
  "0008_work_os.sql",
  "0009_work_os_people_email_merge.sql",
  "0010_work_os_employee_companion.sql",
  "0011_work_os_employee_onboarding.sql",
  "0014_work_tasks_milestone_id.sql",
  "0015_work_os_workday_foundation.sql",
  "0016_work_os_guided_onboarding.sql",
  "0017_work_os_phase1_closure.sql",
  "0018_work_os_nifty_history.sql",
  "0019_work_os_plans_insights.sql",
  "0020_work_os_unified_tasks_workspace.sql",
  "0021_work_os_onboarding_telemetry_hardening.sql",
].map((file) => path.join(process.cwd(), "supabase", "migrations", file));

function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    let value = raw.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function loadEnv() {
  loadEnvFile(path.join(process.cwd(), ".env.local"));
  loadEnvFile(path.join(process.cwd(), ".env"));
}

function projectRef() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return supabaseUrl ? new URL(supabaseUrl).hostname.split(".")[0] : null;
}

async function projectRegion(ref) {
  if (process.env.SUPABASE_PROJECT_REGION) return process.env.SUPABASE_PROJECT_REGION;
  if (!process.env.SUPABASE_ACCESS_TOKEN || !ref) return null;
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data.region === "string" ? data.region : null;
}

async function connectionCandidates() {
  if (process.env.SUPABASE_DB_URL) return [{ label: "SUPABASE_DB_URL", value: process.env.SUPABASE_DB_URL }];
  const password = process.env.SUPABASE_DB_PASSWORD;
  const ref = projectRef();
  if (!password || !ref) return [];

  const candidates = [
    {
      label: "direct",
      value: `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`,
    },
  ];

  if (process.env.SUPABASE_DB_POOLER_URL) {
    candidates.push({ label: "SUPABASE_DB_POOLER_URL", value: process.env.SUPABASE_DB_POOLER_URL });
    return candidates;
  }

  const region = await projectRegion(ref);
  if (region) {
    candidates.push({
      label: "pooler",
      value: `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-${region}.pooler.supabase.com:6543/postgres`,
    });
  }

  return candidates;
}

async function main() {
  loadEnv();

  if (process.env.SUPABASE_ACCESS_TOKEN && existsSync(path.join(process.cwd(), "supabase", ".temp", "project-ref"))) {
    let linkedOk = true;
    for (const migration of MIGRATIONS) {
      const linked = spawnSync("supabase", ["db", "query", "--linked", "--file", path.relative(process.cwd(), migration)], {
        cwd: process.cwd(),
        stdio: "inherit",
        env: process.env,
      });
      if (linked.status !== 0) {
        linkedOk = false;
        break;
      }
    }
    if (linkedOk) return;
    console.error("Linked Supabase query failed; falling back to direct/pooler Postgres connections.");
  }

  const candidates = await connectionCandidates();
  if (!candidates.length) {
    console.error("Missing SUPABASE_DB_URL or SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL.");
    process.exit(1);
  }

  const sql = (await Promise.all(MIGRATIONS.map((migration) => readFile(migration, "utf8")))).join("\n\n");
  const failures = [];

  for (const candidate of candidates) {
    const client = new pg.Client({
      connectionString: candidate.value,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10_000,
    });
    try {
      await client.connect();
      await client.query("begin");
      await client.query(sql);
      await client.query("commit");
      const { rows } = await client.query("select to_regclass('public.work_task_proposals') as table_name");
      if (rows[0]?.table_name !== "work_task_proposals") {
        throw new Error("Migration finished but Work OS Employee Companion tables were not found.");
      }
      console.log("Applied Work OS migrations:", MIGRATIONS.map((migration) => path.basename(migration)).join(", "));
      console.log("Connection:", candidate.label);
      return;
    } catch (err) {
      await client.query("rollback").catch(() => {});
      failures.push(`${candidate.label}: ${err instanceof Error ? err.message : err}`);
    } finally {
      await client.end().catch(() => {});
    }
  }

  console.error("FAILED: could not apply Work OS migration.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

await main();
