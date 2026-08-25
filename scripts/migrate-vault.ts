/**
 * One-time data migration: local stores → Supabase Postgres (spec §8).
 * Migrates goals, journal entries, and ultracode runs to the given owner user.
 * Idempotent-ish: re-runs append goals/journal again, so run once per store.
 *
 * Usage:  node --import tsx scripts/migrate-vault.ts <ownerUserId>
 * Env:    NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readGoals, listJournalDays, readJournal } from "../src/lib/vaultWriter";
import { listRuns, getRun } from "../src/lib/ultracodeRuns";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.argv[2];

if (!URL || !KEY || !ownerId) {
  console.error("Usage: node --import tsx scripts/migrate-vault.ts <ownerUserId>");
  console.error("(NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required)");
  process.exit(1);
}

const admin = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function migrateGoals() {
  const goals = await readGoals();
  if (goals.length === 0) return console.log("goals: none");
  const rows = goals.map((g) => ({
    user_id: ownerId,
    text: g.text,
    done: g.done,
    category: g.category ?? null,
    created_at: g.createdAt,
  }));
  const { error } = await admin.from("goals").insert(rows);
  console.log(error ? `goals: FAILED ${error.message}` : `goals: ${rows.length} migrated`);
}

async function migrateJournal() {
  const days = await listJournalDays(3650);
  let count = 0;
  for (const day of days) {
    const entries = await readJournal(day);
    if (entries.length === 0) continue;
    const rows = entries.map((e) => ({
      user_id: ownerId,
      entry_date: day,
      time: e.time,
      text: e.text,
    }));
    const { error } = await admin.from("journal_entries").insert(rows);
    if (error) console.log(`journal ${day}: FAILED ${error.message}`);
    else count += rows.length;
  }
  console.log(`journal: ${count} entries migrated`);
}

async function migrateRuns() {
  const summaries = await listRuns(10_000);
  let count = 0;
  for (const s of summaries) {
    const run = await getRun(s.id);
    if (!run) continue;
    const { error } = await admin.from("runs").upsert({
      id: run.id,
      user_id: ownerId,
      prompt: run.prompt,
      project: run.project ?? null,
      model: run.model ?? null,
      ultracode: run.ultracode,
      session_id: run.sessionId ?? null,
      status: run.status,
      headline: run.headline ?? null,
      result_text: run.resultText ?? null,
      live_text: run.liveText ?? null,
      cost_usd: run.costUsd ?? null,
      num_turns: run.numTurns ?? null,
      duration_ms: run.durationMs ?? null,
      tokens_total: run.tokensTotal ?? null,
      subagents: run.subagents,
      verdicts: run.verdicts,
      turns: run.turns,
      started_at: new Date(run.startedAt).toISOString(),
      finished_at: run.finishedAt ? new Date(run.finishedAt).toISOString() : null,
    });
    if (error) console.log(`run ${run.id}: FAILED ${error.message}`);
    else count++;
  }
  console.log(`runs: ${count} migrated`);
}

async function main() {
  console.log(`Migrating local stores → owner ${ownerId}`);
  await migrateGoals();
  await migrateJournal();
  await migrateRuns();
  console.log("done. (memories/threads migration is a TODO — loose markdown format)");
}

main().catch((e) => {
  console.error("migration fatal:", e);
  process.exit(1);
});
