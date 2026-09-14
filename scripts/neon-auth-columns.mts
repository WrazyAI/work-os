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
    if (error.code !== "ENOENT") throw error;
  }
}
const uid = "7b371568-0801-4286-a43d-7ffb76235f48";
const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pg.connect();
const tables = (await pg.query(
  "select table_name from information_schema.tables where table_schema='neon_auth' order by 1",
)).rows.map((row) => row.table_name);
const summary = {};
for (const table of tables) {
  const columns = (await pg.query(
    "select column_name from information_schema.columns where table_schema='neon_auth' and table_name=$1 order by ordinal_position",
    [table],
  )).rows.map((row) => row.column_name);
  summary[table] = columns;
}
console.log(JSON.stringify(summary, null, 2));
await pg.end();
