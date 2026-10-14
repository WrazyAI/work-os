/**
 * Live verification of Phase 1 proposal resolution against real data.
 *
 * Proves in one run, on a real employee:
 *   1. a pending task that the old capped person-page window would have
 *      hidden (null due date, late rank) now resolves and files a proposal;
 *   2. a stale task id no longer rejects the whole batch — the valid
 *      operation files and the stale one returns actionable copy.
 *
 * Reads DATABASE_URL / SUPABASE keys from process.env, or from KEY=value
 * lines on stdin with --env-stdin (keeps secrets out of files and argv).
 * Everything it writes (proposal + audit rows) is deleted before it exits.
 *
 * Usage:
 *   ssh <vps> 'grep -E "^(DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL)=" /home/dev/agent-os/.env.local' \
 *     | node --import tsx scripts/verify-proposal-resolution.mts --env-stdin [--person-email you@example.com]
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { WorkOsAccess } from "../src/lib/work-os-api";

if (process.argv.includes("--env-stdin")) {
  for (const line of readFileSync(0, "utf8").split("\n")) {
    const match = line.match(/^([^=#]+)=(.*)$/);
    if (!match) continue;
    const value = match[2]!.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
    if (!process.env[match[1]!.trim()]) process.env[match[1]!.trim()] = value;
  }
} else {
  for (const path of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (!match) continue;
        const value = match[2]!.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, "");
        if (!process.env[match[1]!.trim()]) process.env[match[1]!.trim()] = value;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

const emailFlag = process.argv.indexOf("--person-email");
const email = emailFlag >= 0 ? process.argv[emailFlag + 1] : "employee@example.com";
if (!email) throw new Error("--person-email requires a value");

const { Client } = await import("pg");
const { proposeInterpretedWorkUpdate } = await import("../src/lib/work-os-proposals");

// Supabase's managed endpoint serves a valid chain, but every existing live
// script in this repository connects with certificate verification disabled
// (see scripts/verify-approval-roundtrip.mts and scripts/migrate-vault.ts);
// this internal-only tool keeps that established behavior.
const pg = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pg.connect();

const person = (await pg.query(
  `select p.id as person_id, p.organization_id, m.id as membership_id, o.legacy_owner_id, o.created_by
     from work_people p
     join work_org_members m on m.person_id = p.id and m.organization_id = p.organization_id
     join work_organizations o on o.id = p.organization_id
    where p.email = $1 and m.active = true
    order by p.created_at limit 1`,
  [email],
)).rows[0];
if (!person) throw new Error(`no active person/membership for ${email}`);
const organizationId = String(person.organization_id);
const ownerId = String(person.legacy_owner_id || person.created_by);
const personId = String(person.person_id);

// The most-hidden pending task under the OLD ordering: null due date first
// (nulls sort last), then by recency, ranked against every non-archived task.
const candidate = (await pg.query(
  `select w.id, w.title, r.rn
     from work_tasks w
     join (select id, row_number() over (order by due_date asc nulls last, coalesce(provider_created_at, created_at) desc) rn
             from work_tasks where organization_id = $1 and status not in ('archived','deleted')) r on r.id = w.id
    where w.organization_id = $1 and w.completed = false and w.status = 'open'
      and w.assignee_person_ids @> ARRAY[$2]::uuid[] and w.due_date is null
    order by r.rn desc limit 1`,
  [organizationId, personId],
)).rows[0];
if (!candidate) throw new Error(`no null-due pending task found for ${email}`);
const taskId = String(candidate.id);
const oldWindowRank = Number(candidate.rn);
const staleTaskId = randomUUID();
const idempotencyKey = randomUUID();

const access = {
  ctx: { user: { id: ownerId }, profile: {} },
  organizationId,
  organizationOwnerId: ownerId,
  role: "admin",
  personId,
  membershipId: String(person.membership_id),
  featureFlags: {},
} as unknown as WorkOsAccess;

const result = await proposeInterpretedWorkUpdate(access, {
  input_text: "Live verification: one completion plus one stale task id.",
  operations: [
    { op: "complete_task", statement: `Verification completion for ${candidate.title}`, task_id: taskId },
    { op: "complete_task", statement: "Verification completion for a removed task", task_id: staleTaskId },
  ],
}, idempotencyKey);

const filed = result.proposals.find((proposal) => proposal.client_operation_index === 0);
const staleFailure = result.failures.find((failure) => failure.client_operation_index === 1);
const checks = {
  realTaskFiled: Boolean(filed) && String(filed?.task_id ?? "") === taskId,
  staleRejectedAlone: !result.failures.some((failure) => failure.client_operation_index === 0),
  staleReasonActionable: /no longer in your task list/i.test(staleFailure?.error ?? ""),
  hiddenUnderOldWindow: oldWindowRank > 500,
};

const cleanup = await pg.query(
  `delete from work_task_proposals where organization_id = $1 and idempotency_key like $2 returning id`,
  [organizationId, `${idempotencyKey}:%`],
);
const removedProposalIds = cleanup.rows.map((row: Record<string, unknown>) => row.id);
if (removedProposalIds.length) {
  await pg.query(`delete from work_audit_log where target_id = any($1::text[]) and action = 'proposal.interpreted'`, [removedProposalIds]);
}

console.log(JSON.stringify({
  email,
  task: { id: taskId, title: candidate.title, oldWindowRank },
  filed: result.proposals.length,
  failures: result.failures.length,
  checks,
  cleanedUp: { proposals: removedProposalIds.length },
}, null, 2));

await pg.end();
if (!Object.values(checks).every(Boolean)) process.exit(1);
