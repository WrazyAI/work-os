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

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const uid = args.find((arg) => !arg.startsWith("--"));
if (!uid) {
  console.error("usage: tsx scripts/e2e-cleanup.mts <user-id> [--dry-run]");
  process.exit(1);
}

const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pg.connect();

const memberships = (
  await pg.query("select organization_id, person_id from work_org_members where user_id=$1", [uid])
).rows as { organization_id: string; person_id: string | null }[];
const personIds = [...new Set(memberships.map((row) => row.person_id).filter((id): id is string => Boolean(id)))];
const orgIds = [...new Set(memberships.map((row) => row.organization_id))];

// Only organizations auto-created for this user may be removed. A shared
// organization keeps its data and this cleanup only drops the membership.
const legacyOrgIds = orgIds.length
  ? (
      (
        await pg.query("select id from work_organizations where id = any($1::uuid[]) and legacy_owner_id=$2", [
          orgIds,
          uid,
        ])
      ).rows as { id: string }[]
    ).map((row) => row.id)
  : [];

const count = async (sql: string, params: unknown[]) =>
  Number(((await pg.query(sql, params)).rows[0] as { n: number }).n);

const plan = {
  memoryItems: personIds.length
    ? await count("select count(*)::int as n from work_memory_items where person_id = any($1::uuid[])", [personIds])
    : 0,
  people: await count("select count(*)::int as n from work_people where user_id=$1", [uid]),
  memberships: memberships.length,
  legacyOrganizations: legacyOrgIds,
  sharedOrganizations: orgIds.filter((id) => !legacyOrgIds.includes(id)),
};

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, plan }, null, 2));
  await pg.end();
  process.exit(0);
}

const remove = async (label: string, sql: string, params: unknown[]) => {
  const result = await pg.query(sql, params);
  console.log(`deleted ${label}: ${result.rowCount}`);
};

await pg.query("begin");
try {
  if (personIds.length) {
    await remove("memory items", "delete from work_memory_items where person_id = any($1::uuid[])", [personIds]);
  }
  if (legacyOrgIds.length) {
    await remove("audit log", "delete from work_audit_log where organization_id = any($1::uuid[])", [legacyOrgIds]);
  }
  await remove("memberships", "delete from work_org_members where user_id=$1", [uid]);
  await remove("people", "delete from work_people where user_id=$1", [uid]);
  if (legacyOrgIds.length) {
    const emptyOrgs = (
      (
        await pg.query(
          `select o.id from work_organizations o
            where o.id = any($1::uuid[])
              and not exists (select 1 from work_org_members m where m.organization_id = o.id)`,
          [legacyOrgIds],
        )
      ).rows as { id: string }[]
    ).map((row) => row.id);
    if (emptyOrgs.length) {
      await remove("legacy organizations", "delete from work_organizations where id = any($1::uuid[])", [emptyOrgs]);
    }
  }
  await remove("auth sessions", 'delete from neon_auth."session" where "userId"=$1', [uid]);
  await remove("auth account", 'delete from neon_auth."account" where "userId"=$1', [uid]);
  await remove("auth user", 'delete from neon_auth."user" where id=$1', [uid]);
  await remove("profile", "delete from public.profiles where id=$1", [uid]);
  await pg.query("commit");
} catch (error) {
  await pg.query("rollback").catch(() => {});
  throw error;
}

const left: Record<string, number> = {
  auth_user: await count('select count(*)::int as n from neon_auth."user" where id=$1', [uid]),
  auth_account: await count('select count(*)::int as n from neon_auth."account" where "userId"=$1', [uid]),
  auth_session: await count('select count(*)::int as n from neon_auth."session" where "userId"=$1', [uid]),
  profile: await count("select count(*)::int as n from public.profiles where id=$1", [uid]),
  membership: await count("select count(*)::int as n from work_org_members where user_id=$1", [uid]),
  people: await count("select count(*)::int as n from work_people where user_id=$1", [uid]),
  organizations: legacyOrgIds.length
    ? await count("select count(*)::int as n from work_organizations where id = any($1::uuid[])", [legacyOrgIds])
    : 0,
};
console.log(JSON.stringify(left));
if (Object.values(left).some((value) => value > 0)) process.exitCode = 1;
await pg.end();
