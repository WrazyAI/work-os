import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { recordWorkMemory, drainWorkMemoryJobs, recallWorkMemory } from "../src/lib/work-memory";

for (const path of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
    }
  } catch {}
}

const cases: Array<{ sourceId: string; kind: "check_in" | "eod" | "plan"; content: string; query: string; label: string }> = [
  {
    sourceId: "eval-cache",
    kind: "check_in",
    label: "caching regression",
    content: "Tracked down a caching regression in the reporting pipeline where stale aggregates delayed the analytics dashboard for two minutes.",
    query: "latency problems in analytics views",
  },
  {
    sourceId: "eval-client",
    kind: "eod",
    label: "client kickoff",
    content: "Ran the onboarding kickoff with the new Northwind client and agreed on weekly delivery checkpoints and access requirements.",
    query: "when did we meet the new customer",
  },
  {
    sourceId: "eval-blocker",
    kind: "plan",
    label: "vendor blocker",
    content: "Blocked on the payments vendor sandbox credentials; planned to escalate to procurement before continuing checkout work.",
    query: "what is stuck waiting on an external party",
  },
];

const person = process.argv[2];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const row = await pool.query("select id, organization_id from work_people where email = $1 limit 1", [person]);
  if (!row.rows.length) {
    console.error("person not found");
    process.exit(1);
  }
  const scope = { organizationId: row.rows[0].organization_id as string, personId: row.rows[0].id as string };
  const stamp = Date.now();
  const sourceIds = new Map(cases.map((entry) => [entry.sourceId, `${entry.sourceId}-${stamp}`]));

  for (const entry of cases) {
    await recordWorkMemory(scope, {
      kind: entry.kind,
      sourceTable: "eval_memory",
      sourceId: sourceIds.get(entry.sourceId)!,
      content: entry.content,
      summary: entry.label,
      localDate: new Date().toISOString().slice(0, 10),
    });
  }
  const drained = await drainWorkMemoryJobs(6);
  console.log("drain:", JSON.stringify(drained));

  let hits = 0;
  for (const entry of cases) {
    const recall = await recallWorkMemory(scope, entry.query, { limit: 5 });
    const found = recall.items.some((item) => item.source_id === sourceIds.get(entry.sourceId));
    if (found) hits += 1;
    console.log(`${found ? "HIT " : "MISS"} | vector=${recall.vectorUsed} | ${entry.label} | "${entry.query}"`);
  }
  console.log(`eval: ${hits}/${cases.length} expected memories retrieved`);

  await pool.query("delete from work_memory_jobs where source_table = $1", ["eval_memory"]);
  await pool.query("delete from work_memory_items where source_table = $1", ["eval_memory"]);
  console.log("cleaned eval rows");
  await pool.end();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
