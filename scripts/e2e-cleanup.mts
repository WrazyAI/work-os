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
await pg.query("delete from work_org_members where user_id=$1", [uid]);
await pg.query('delete from neon_auth."session" where "userId"=$1', [uid]);
await pg.query('delete from neon_auth."account" where "userId"=$1', [uid]);
await pg.query('delete from neon_auth."user" where id=$1', [uid]);
await pg.query("delete from public.profiles where id=$1", [uid]);
const left = (await pg.query(
  `select (select count(*)::int from neon_auth."user" where id=$1) auth_user,
          (select count(*)::int from neon_auth."account" where "userId"=$1) auth_account,
          (select count(*)::int from neon_auth."session" where "userId"=$1) auth_session,
          (select count(*)::int from public.profiles where id=$1) profile,
          (select count(*)::int from work_org_members where user_id=$1) membership`,
  [uid],
)).rows[0];
console.log(JSON.stringify(left));
await pg.end();
