/**
 * Rebuilds the check-in memory rows that the timestamp bug dropped.
 *
 * Every check-in wrote `occurred_at` as a JavaScript date string, which
 * Postgres rejected, and the recorder only logged a warning — so recorded
 * check-ins have no memory row. This replays them through the same recorder
 * the live path uses, so content, summary, metadata and consent match.
 *
 * Idempotent: the insert is deduplicated on
 * (organization_id, source_table, source_id, content_hash), so a second run
 * adds nothing. Dry run unless --apply is passed.
 *
 *   node --import tsx scripts/backfill-check-in-memory.mts [--apply] [--limit N]
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { isoDate, isoTimestamp } from "@/lib/iso-timestamp";
import { recordWorkMemory } from "@/lib/work-memory";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const limitIndex = process.argv.indexOf("--limit");
const limit = limitIndex > -1 ? Number(process.argv[limitIndex + 1]) : null;

const client = createAdminClient();

type CheckIn = {
  id: string;
  organization_id: string;
  person_id: string;
  shift_date: unknown;
  kind: string | null;
  input_text: string | null;
  confirmed_existing_tasks: boolean | null;
  update_kind: string | null;
  created_at: unknown;
};

const { data: checkIns, error: checkInError } = await client
  .from("work_check_ins")
  .select("id,organization_id,person_id,shift_date,kind,input_text,confirmed_existing_tasks,update_kind,created_at")
  .order("created_at", { ascending: true });
if (checkInError) throw new Error(`load check-ins: ${checkInError.message}`);

const { data: existing, error: existingError } = await client
  .from("work_memory_items")
  .select("source_id")
  .eq("source_table", "work_check_ins");
if (existingError) throw new Error(`load existing memories: ${existingError.message}`);
const covered = new Set((existing ?? []).map((row) => String(row.source_id)));

// Proposal counts are part of the metadata the live path recorded.
const { data: proposals } = await client
  .from("work_task_proposals")
  .select("check_in_id")
  .not("check_in_id", "is", null);
const proposalCounts = new Map<string, number>();
for (const row of proposals ?? []) {
  const key = String(row.check_in_id);
  proposalCounts.set(key, (proposalCounts.get(key) ?? 0) + 1);
}

const rows = (checkIns ?? []) as CheckIn[];
const missing = rows.filter((row) => !covered.has(String(row.id)));
const batch = limit && Number.isFinite(limit) ? missing.slice(0, limit) : missing;

console.log(`check-ins: ${rows.length}`);
console.log(`already covered: ${covered.size}`);
console.log(`missing: ${missing.length}`);
console.log(`this run: ${batch.length}${apply ? "" : "  (dry run — pass --apply to write)"}`);

let inserted = 0;
let skipped = 0;
let failed = 0;

for (const row of batch) {
  const text = (row.input_text ?? "").trim();
  const occurredAt = isoTimestamp(row.created_at);
  const localDate = isoDate(row.shift_date);
  if (!occurredAt) {
    console.log(`  ! ${row.id}: unusable created_at — skipped`);
    failed += 1;
    continue;
  }
  const payload = {
    kind: "check_in" as const,
    sourceTable: "work_check_ins" as const,
    sourceId: String(row.id),
    content: text || (row.confirmed_existing_tasks
      ? "Confirmed existing Nifty tasks as the current plan."
      : "Check-in recorded without text."),
    summary: text ? text.slice(0, 160) : null,
    metadata: {
      checkInKind: row.kind,
      updateKind: row.update_kind,
      proposalCount: proposalCounts.get(String(row.id)) ?? 0,
      backfilled: true,
    },
    localDate,
    occurredAt,
  };
  if (!apply) {
    console.log(`  · ${row.id}  ${occurredAt}  ${row.kind ?? "-"}  "${payload.content.slice(0, 60)}"`);
    continue;
  }
  try {
    const recorded = await recordWorkMemory(
      { organizationId: String(row.organization_id), personId: String(row.person_id) },
      payload,
    );
    if (recorded?.id) {
      inserted += 1;
      console.log(`  + ${row.id}  ${occurredAt}`);
    } else {
      skipped += 1;
      console.log(`  = ${row.id}  already present`);
    }
  } catch (error) {
    failed += 1;
    console.log(`  ! ${row.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (apply) {
  console.log(`\ninserted: ${inserted}  skipped: ${skipped}  failed: ${failed}`);
} else {
  console.log("\ndry run only — nothing was written");
}
