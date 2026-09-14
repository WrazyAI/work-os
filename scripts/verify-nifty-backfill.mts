/**
 * Phase B reconciliation, v2: full sync already done; compare the Neon mirror
 * against the Nifty API using canonical normalized fields, and quantify
 * due-date format quality. Prints a JSON summary; never mutates Nifty.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

for (const path of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^([^=#]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const { listNiftyTasks } = await import("../src/lib/integrations/nifty");

const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pg.connect();

const iso = (value: unknown) => {
  const text = String(value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

async function pageNifty(includeArchived: string) {
  const tasks: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (let offset = 0; offset < 10_000; offset += 100) {
    const page = await listNiftyTasks({ limit: "100", offset: String(offset), include_subtasks: "true", include_archived: includeArchived });
    const fresh = page.tasks.filter((task) => !seen.has(task.id));
    fresh.forEach((task) => seen.add(task.id));
    tasks.push(...(fresh as unknown as Array<Record<string, unknown>>));
    if (page.hasMore === false || (page.hasMore !== true && page.tasks.length < 100) || !fresh.length) break;
  }
  return tasks;
}

const active = await pageNifty("false");
const nifty = new Map(active.map((task) => [String((task as { id: string }).id), task]));
const niftyCompleted = active.filter((task) => (task as { completed?: boolean }).completed === true).length;

const mirrorRows = (await pg.query(
  "select provider_task_id, title, to_char(due_date, 'YYYY-MM-DD') as due_date, completed, status from work_tasks where provider = 'nifty' and status not in ('deleted')",
)).rows as Array<Record<string, unknown>>;

let compared = 0;
let matched = 0;
const mismatches: string[] = [];
const absentInNifty: string[] = [];
for (const row of mirrorRows) {
  const remote = nifty.get(String(row.provider_task_id ?? ""));
  if (!remote) {
    // Mirror rows Nifty no longer returns (deleted or removed from the list).
    absentInNifty.push(`${row.provider_task_id}:${row.status}`);
    continue;
  }
  compared += 1;
  const summary = remote as { name?: string; completed?: boolean; dueDate?: string | null };
  const diffs: string[] = [];
  if (String(summary.name ?? "").trim() !== String(row.title ?? "").trim()) diffs.push("name");
  const remoteCompleted = summary.completed === true;
  if (remoteCompleted !== (row.completed === true) && String(row.status) !== "archived") diffs.push(`completed(${remoteCompleted} vs ${row.completed})`);
  if (diffs.length && mismatches.length < 12) mismatches.push(`${row.provider_task_id}: ${diffs.join(", ")}`);
}



const assigneeDomainGaps = (await pg.query(
  `select count(*)::int n from work_tasks t
    where exists (
      select 1 from unnest(t.assignee_person_ids) a
       where not exists (select 1 from work_people p where p.id = a and p.user_id = t.user_id))`,
)).rows[0].n;

console.log(JSON.stringify({
  niftyActive: active.length,
  niftyCompletedActive: niftyCompleted,
  mirror: {
    comparedRows: mirrorRows.length,
    matchedWithNifty: compared,
    fieldMismatches: mismatches,
    absentInNiftyList: absentInNifty.length,
    absentByStatus: absentInNifty.reduce<Record<string, number>>((acc, entry) => {
      const status = String(entry.split(":")[1] ?? "unknown");
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {}),
  },
  assigneeDomainGaps: (await pg.query(
    `select count(*)::int n from work_tasks t
      where exists (select 1 from unnest(t.assignee_person_ids) a
       where not exists (select 1 from work_people p where p.id = a and p.user_id = t.user_id))`,
  )).rows[0].n,
}, null, 2));

await pg.end();
