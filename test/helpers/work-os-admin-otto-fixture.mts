import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { WorkOsAccess } from "../../src/lib/work-os-api";

export const org = "10000000-0000-4000-8000-000000000001";
export const otherOrg = "10000000-0000-4000-8000-000000000002";
export const person = "20000000-0000-4000-8000-000000000001";
export const otherPerson = "20000000-0000-4000-8000-000000000002";
export const newPerson = "20000000-0000-4000-8000-000000000003";
export const interval = "30000000-0000-4000-8000-000000000001";
export const user = "40000000-0000-4000-8000-000000000001";
export const adminUser = "40000000-0000-4000-8000-000000000011";
export const admin2User = "40000000-0000-4000-8000-000000000012";
export const otherAdminUser = "40000000-0000-4000-8000-000000000013";
export const adminMembership = "50000000-0000-4000-8000-000000000001";
export const admin2Membership = "50000000-0000-4000-8000-000000000002";
export const otherAdminMembership = "50000000-0000-4000-8000-000000000003";
export const access = {
  organizationId: org, personId: person, membershipId: "membership", role: "employee",
  ctx: { user: { id: user }, profile: { id: user } }, featureFlags: {}, organizationOwnerId: null,
} as WorkOsAccess;
const admin = (organizationId: string, membershipId: string, userId: string) => ({
  organizationId, personId: null, membershipId, role: "admin",
  ctx: { user: { id: userId }, profile: { id: userId } },
  featureFlags: { employee_companion: true }, organizationOwnerId: null,
}) as unknown as WorkOsAccess;
export const adminAccess = admin(org, adminMembership, adminUser);
export const admin2Access = admin(org, admin2Membership, admin2User);
export const otherOrgAdminAccess = admin(otherOrg, otherAdminMembership, otherAdminUser);

// Standalone prerequisite schema: the columns used by the real service and the
// existing tables referenced by the actual additive migration. No live DB/env.
export const prerequisites = `
create table work_organizations (id uuid primary key, feature_flags jsonb not null default '{"employee_companion":true}'::jsonb);
create table work_people (id uuid primary key, organization_id uuid not null references work_organizations(id), display_name text, active boolean not null default true, timezone text default 'UTC');
create table work_org_members (
  id uuid primary key, organization_id uuid not null references work_organizations(id), user_id uuid not null,
  person_id uuid, role text not null check (role in ('employee','manager','admin')),
  feature_flags jsonb not null default '{}'::jsonb, active boolean not null default true,
  ui_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create table work_employee_onboarding (organization_id uuid not null, person_id uuid not null, timezone text);
create table work_activity_intervals (
 id uuid primary key, organization_id uuid not null references work_organizations(id), person_id uuid not null references work_people(id),
 generation_status text default 'ready', review_status text default 'inferred',
 headline text, ai_detail text, final_detail text, employee_feedback text,
 structured_summary jsonb default '{}', coverage jsonb default '{}', source_hash text, revision int default 1,
 local_date text default '2026-10-21', prompt_kind text default 'hourly_fallback',
 failure_reason text, evidence_expired_at timestamptz,
 window_start timestamptz, window_end timestamptz, timezone text default 'UTC',
 generated_at timestamptz, reviewed_at timestamptz, updated_at timestamptz, next_steps_status text default 'not_requested');
create table work_audit_log (id bigint generated always as identity primary key, organization_id uuid not null references work_organizations(id), actor_user_id uuid, action text not null, target_type text not null, target_id text, metadata jsonb default '{}');
create table work_check_ins (id int primary key);
create table work_sessions (id int primary key, last_substantive_update_at timestamptz);
create table work_tasks (id int primary key, title text);
create table work_activity_interval_evidence (
  interval_id uuid not null, screenshot_summary_id uuid, captured_at timestamptz, ordinal int,
  used_in_model boolean, raw_image_shown boolean, selection_reason text,
  visible_app_snapshot text, frame_summary_snapshot text
);
create table work_screenshot_summaries (id uuid primary key, storage_path text, expires_at timestamptz, deleted_at timestamptz);
insert into work_check_ins values (1);
insert into work_sessions values (1, '2026-10-21T08:00:00Z');
insert into work_tasks values (1, 'Unchanged');
insert into work_organizations values ('${org}'), ('${otherOrg}');
insert into work_org_members (id, organization_id, user_id, role, feature_flags, active) values
  ('${adminMembership}', '${org}', '${adminUser}', 'admin', '{}', true),
  ('${admin2Membership}', '${org}', '${admin2User}', 'admin', '{}', true),
  ('${otherAdminMembership}', '${otherOrg}', '${otherAdminUser}', 'admin', '{}', true);
insert into work_people (id, organization_id, display_name) values ('${person}', '${org}', 'Ada'), ('${otherPerson}', '${otherOrg}', 'Other');
insert into work_activity_intervals (id, organization_id, person_id, headline, ai_detail, final_detail, structured_summary, source_hash, window_start, window_end, generated_at)
values ('${interval}', '${org}', '${person}', 'Review work', 'Reviewed the queue.', 'Reviewed the queue.', '{"activities":[{"description":"9:20 AM — Read the queue"}]}', 'source-a', '2026-10-21T09:00:00Z', '2026-10-21T10:00:00Z', '2026-10-21T10:01:00Z');
`;

export const migration = () => readFile(new URL("../../supabase/migrations/0065_work_admin_otto.sql", import.meta.url), "utf8");

export async function fixture() {
  const db = new PGlite();
  await db.exec(prerequisites);
  await db.exec(await migration());
  let released = 0;
  // Only adapts the pg wire boundary: all service SQL executes in PGlite.
  // This is NOT a concurrent-connection or row-lock fixture.
  globalThis.__workOsPgPool = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    connect: async () => ({ query: (sql: string, values?: unknown[]) => db.query(sql, values), release: () => { released++; } }),
  } as unknown as Pool;
  return { db, releases: () => released, close: async () => { globalThis.__workOsPgPool = undefined; await db.close(); } };
}

export async function untouched(db: PGlite) {
  return (await db.query(`select
    (select jsonb_agg(c) from work_check_ins c) as check_ins,
    (select jsonb_agg(s) from work_sessions s) as sessions,
    (select jsonb_agg(t) from work_tasks t) as tasks,
    (select jsonb_build_object('ai_detail', ai_detail, 'headline', headline, 'structured_summary', structured_summary, 'source_hash', source_hash, 'revision', revision) from work_activity_intervals where id = '${interval}') as inference`)).rows;
}
