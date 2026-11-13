import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { reviewWorkArrangement } from "../src/lib/work-os-arrangement-review";
import type { WorkOsAccess } from "../src/lib/work-os-api";

const org = "11111111-1111-4111-8111-111111111111";
const person = "22222222-2222-4222-8222-222222222222";
const actor = "33333333-3333-4333-8333-333333333333";
const access = { role: "admin", organizationId: org, ctx: { user: { id: actor } } } as WorkOsAccess;
const input = { action: "approve", revision: 2, submittedAt: "2026-11-13T10:00:00Z" };

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create table work_people (id uuid primary key, organization_id uuid);
    create table work_org_members (id uuid default gen_random_uuid(), organization_id uuid, user_id uuid, role text, active boolean);
    create table work_employee_onboarding (organization_id uuid,person_id uuid,status text check(status in ('not_started','in_progress','submitted','confirmed','changes_requested')),draft_revision integer,employee_submitted_at timestamptz,schedule_proposal jsonb,timezone text,reviewed_by uuid,reviewed_at timestamptz,review_note text,updated_at timestamptz);
    create function work_save_employee_account_settings(uuid,uuid,integer,text,jsonb,jsonb) returns work_employee_onboarding language sql as $$update work_employee_onboarding set draft_revision=draft_revision+1 where organization_id=$1 and person_id=$2 returning *$$;
    create table work_schedules (id uuid default gen_random_uuid(),organization_id uuid,person_id uuid,timezone text,days_of_week integer[],shift_start time not null,shift_end time not null,break_windows jsonb default '[]',effective_from date,effective_to date,active boolean,created_by uuid,updated_at timestamptz);
    create table work_sessions (id uuid default gen_random_uuid(),organization_id uuid,person_id uuid,state text);
    create table work_audit_log (organization_id uuid,actor_user_id uuid,action text,target_type text,target_id uuid,metadata jsonb);
  `);
  await db.exec(readFileSync(new URL("../supabase/migrations/0074_work_os_flexible_arrangements.sql", import.meta.url), "utf8"));
  await db.query("insert into work_people values ($1,$2)", [person, org]);
  await db.query("insert into work_org_members(organization_id,user_id,role,active) values($1,$2,'admin',true)", [org, actor]);
  await db.query(`insert into work_employee_onboarding(organization_id,person_id,status,draft_revision,employee_submitted_at,schedule_proposal,timezone) values($1,$2,'submitted',2,$3,$4::jsonb,'UTC')`, [org, person, input.submittedAt, JSON.stringify({ arrangement: "flexible", daysOfWeek: [1, 5] })]);
  const pool = { connect: async () => ({ query: db.query.bind(db), release() {} }) } as unknown as Parameters<typeof reviewWorkArrangement>[3];
  return { db, pool };
}

test("approval persists flexible days without times and atomically records review/audit", async () => {
  const { db, pool } = await fixture();
  try {
    const result = await reviewWorkArrangement(access, person, input, pool);
    assert.equal(result.status, "confirmed");
    const rows = await db.query<any>("select * from work_schedules");
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].arrangement, "flexible");
    assert.equal(rows.rows[0].shift_start, null);
    assert.deepEqual(rows.rows[0].days_of_week, [1, 5]);
    assert.equal((await db.query<any>("select status from work_employee_onboarding")).rows[0].status, "confirmed");
    assert.equal((await db.query("select * from work_audit_log")).rows.length, 1);
    await assert.rejects(reviewWorkArrangement(access, person, input, pool), /changed|reviewed/i);
  } finally { await db.close(); }
});
test("stale, unauthorized, cross-tenant and open-session approvals write nothing", async () => {
  const { db, pool } = await fixture();
  try {
    await assert.rejects(reviewWorkArrangement({ ...access, role: "employee" }, person, input, pool), /admin/i);
    await assert.rejects(reviewWorkArrangement({ ...access, organizationId: "44444444-4444-4444-8444-444444444444" }, person, input, pool));
    await assert.rejects(reviewWorkArrangement(access, person, { ...input, revision: 1 }, pool), /changed|refresh/i);
    await db.query("insert into work_sessions(organization_id,person_id,state) values($1,$2,'active')", [org, person]);
    await assert.rejects(reviewWorkArrangement(access, person, input, pool), /session|clock/i);
    assert.equal((await db.query("select * from work_schedules")).rows.length, 0);
    assert.equal((await db.query<any>("select status from work_employee_onboarding")).rows[0].status, "submitted");
  } finally { await db.close(); }
});
test("requesting changes preserves official schedules and requires a reason", async () => {
  const { db, pool } = await fixture();
  try {
    await db.query("insert into work_schedules(organization_id,person_id,shift_start,shift_end,arrangement,active,effective_from) values($1,$2,'09:00','17:00','scheduled',true,'2026-01-01')", [org, person]);
    await assert.rejects(reviewWorkArrangement(access, person, { ...input, action: "request_changes" }, pool), /explain|note|reason/i);
    await reviewWorkArrangement(access, person, { ...input, action: "request_changes", note: "Please confirm your workdays." }, pool);
    assert.equal((await db.query<any>("select shift_start from work_schedules")).rows[0].shift_start, "09:00:00");
    assert.equal((await db.query<any>("select status from work_employee_onboarding")).rows[0].status, "changes_requested");
  } finally { await db.close(); }
});
test("replacement approval preserves old schedule history and starts on the next local day", async () => {
  const { db, pool } = await fixture();
  try {
    await db.query("insert into work_schedules(organization_id,person_id,shift_start,shift_end,arrangement,active,effective_from,timezone,days_of_week) values($1,$2,'09:00','17:00','scheduled',true,'2026-01-01','UTC',array[1,2,3,4,5])", [org, person]);
    const result = await reviewWorkArrangement(access, person, { ...input, schedule: { arrangement: "flexible", daysOfWeek: [2, 4] }, timezone: "Pacific/Auckland" }, pool);
    const rows = (await db.query<any>("select arrangement,effective_from::text,effective_to::text,shift_start,active from work_schedules order by effective_from")).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows[0].shift_start, "09:00:00");
    assert.equal(rows[0].active, true);
    assert.ok(rows[0].effective_to < result.effectiveFrom!);
    assert.equal(rows[1].effective_from, result.effectiveFrom);
    assert.equal(rows[1].arrangement, "flexible");
  } finally { await db.close(); }
});
test("schedule constraints reject mixed flexible/timed records", async () => {
  const { db } = await fixture();
  try {
    await assert.rejects(db.exec("insert into work_schedules(arrangement,shift_start,shift_end) values('flexible','09:00','17:00')"), /constraint/i);
    await assert.rejects(db.exec("insert into work_schedules(arrangement) values('scheduled')"), /constraint/i);
  } finally { await db.close(); }
});
test("account settings stores a flexible proposal without applying it as an official schedule", async () => {
  const { db } = await fixture();
  try {
    await db.query("update work_employee_onboarding set status='confirmed'");
    const schedule = { arrangement: "flexible", daysOfWeek: [2, 4], shiftStart: null, shiftEnd: null, breaks: [] };
    await db.query("select work_save_employee_account_settings($1,$2,2,'settings-change',$3::jsonb,'{}'::jsonb)", [org, person, JSON.stringify({ schedule_proposal: schedule, timezone: "UTC" })]);
    const row = (await db.query<any>("select status,schedule_proposal from work_employee_onboarding")).rows[0];
    assert.equal(row.status, "submitted");
    assert.deepEqual(row.schedule_proposal.daysOfWeek, [2, 4]);
    assert.equal((await db.query("select * from work_schedules")).rows.length, 0);
  } finally { await db.close(); }
});
