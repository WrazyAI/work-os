#!/usr/bin/env node
// Functional dry-run: exercise the exact INSERT/UPDATE column shapes the data
// layer (goals.ts, journal.ts, jobs.ts) and the runner write back, against the
// real schema in PGlite. Catches code↔schema column drift without a live DB.
// (RLS is not enforced here — PGlite runs as superuser — this validates column
// names + types + defaults, not the policies; those were checked structurally.)
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

const u = (await db.query(`insert into auth.users (email) values ('t@wrazy.ai') returning id`)).rows[0].id;
const check = [];
async function step(name, fn) {
  try { await fn(); check.push(`  ✓ ${name}`); }
  catch (e) { check.push(`  ✗ ${name} — ${e.message}`); throw new Error(`step "${name}" failed`); }
}

try {
  // goals.ts: createGoal / updateGoal
  await step("goals insert (user_id,text,category)", async () => {
    await db.query(`insert into goals (user_id, text, category) values ($1,$2,$3)`, [u, "ship it", "Work"]);
  });
  await step("goals update (done,text,category)", async () => {
    await db.query(`update goals set done=$1, text=$2, category=$3 where user_id=$4`, [true, "shipped", "Work", u]);
  });

  // journal.ts: appendEntry
  await step("journal insert (user_id,entry_date,time,text)", async () => {
    await db.query(`insert into journal_entries (user_id, entry_date, time, text) values ($1,$2,$3,$4)`, [u, "2026-06-17", "09:30", "log"]);
  });

  // jobs.ts: enqueueJob → runs insert then jobs insert
  const runId = "uc-test-1";
  await step("runs insert (id,user_id,prompt,model,ultracode,status)", async () => {
    await db.query(`insert into runs (id,user_id,prompt,model,ultracode,status) values ($1,$2,$3,$4,$5,$6)`,
      [runId, u, "hello", "claude-opus-4-8", false, "running"]);
  });
  await step("jobs insert (user_id,agent,kind,args,prompt,cwd,project,run_id)", async () => {
    await db.query(`insert into jobs (user_id,agent,kind,args,prompt,cwd,project,run_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [u, "claude", "chat", JSON.stringify(["-p", "hi"]), "hi", null, "claude-default", runId]);
  });

  // runner: run_events append + runs finalize update
  await step("run_events insert (run_id,user_id,seq,chunk)", async () => {
    await db.query(`insert into run_events (run_id,user_id,seq,chunk) values ($1,$2,$3,$4)`, [runId, u, 0, "{\"type\":\"done\"}\n"]);
  });
  await step("runs finalize update (status,cost_usd,tokens_total,subagents,verdicts,turns,...)", async () => {
    await db.query(
      `update runs set status=$1, headline=$2, result_text=$3, live_text=$4, session_id=$5,
        cost_usd=$6, num_turns=$7, duration_ms=$8, tokens_total=$9,
        subagents=$10, verdicts=$11, turns=$12, finished_at=now() where id=$13`,
      ["completed", "done", "result", null, "sess_1", 0.12, 1, 4200, 1500,
       JSON.stringify([]), JSON.stringify([]), JSON.stringify([{ prompt: "hi", at: 0 }]), runId]);
  });

  // jobs cancel/finalize paths
  await step("jobs claim update (status,claimed_by,claimed_at)", async () => {
    await db.query(`update jobs set status='running', claimed_by=$1, claimed_at=now() where run_id=$2`, ["runner-1", runId]);
  });
  await step("jobs finalize update (status,finished_at,error)", async () => {
    await db.query(`update jobs set status='done', finished_at=now(), error=null where run_id=$1`, [runId]);
  });

  console.log(check.join("\n"));
  console.log("✓ all data-layer write shapes match the schema");
} catch (e) {
  console.log(check.join("\n"));
  console.error(`\nFAILED: ${e.message}`);
  process.exit(1);
} finally {
  await db.close();
}
