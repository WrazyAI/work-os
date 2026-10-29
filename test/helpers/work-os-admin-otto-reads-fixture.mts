import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { WorkOsAccess } from "../../src/lib/work-os-api";

export const org = "10000000-0000-4000-8000-000000000001";
export const otherOrg = "10000000-0000-4000-8000-000000000002";
export const adminUser = "40000000-0000-4000-8000-000000000011";
export const adminMembership = "50000000-0000-4000-8000-000000000001";
export const otherAdminMembership = "50000000-0000-4000-8000-000000000003";
export const personA = "20000000-0000-4000-8000-000000000001";
export const personB = "20000000-0000-4000-8000-000000000002";
export const personC = "20000000-0000-4000-8000-000000000003";
export const otherPerson = "20000000-0000-4000-8000-000000000004";
export const intervalA = "30000000-0000-4000-8000-000000000001";
export const intervalB = "30000000-0000-4000-8000-000000000002";

const admin = (organizationId: string, membershipId: string, userId: string) => ({
  organizationId, personId: null, membershipId, role: "admin",
  ctx: { user: { id: userId }, profile: { id: userId } },
  featureFlags: { employee_companion: true }, organizationOwnerId: null,
}) as unknown as WorkOsAccess;

export const adminAccess = admin(org, adminMembership, adminUser);
export const otherOrgAdminAccess = admin(otherOrg, otherAdminMembership, "40000000-0000-4000-8000-000000000013");

export const prerequisites = `
create table work_organizations (
  id uuid primary key,
  feature_flags jsonb not null default '{"employee_companion":true}'::jsonb
);
create table work_org_members (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id),
  user_id uuid not null,
  person_id uuid,
  role text not null check (role in ('employee','manager','admin')),
  feature_flags jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  ui_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create table work_people (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id),
  display_name text not null,
  active boolean not null default true,
  nifty_member_id text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index work_people_org_id_key on work_people (organization_id, id);
create table work_employee_onboarding (
  organization_id uuid not null,
  person_id uuid not null,
  timezone text,
  primary key (organization_id, person_id)
);
create table work_tasks (
  id uuid primary key,
  user_id uuid not null,
  organization_id uuid not null references work_organizations(id),
  provider text not null default 'nifty',
  provider_task_id text not null default '',
  provider_project_id text,
  project_id uuid,
  title text not null,
  description text,
  status text not null default 'open',
  completed boolean not null default false,
  assignee_provider_ids text[] not null default '{}'::text[],
  assignee_person_ids uuid[] not null default '{}'::uuid[],
  due_date date,
  start_date date,
  completed_at timestamptz,
  assigned_by_person_id uuid,
  parent_task_id uuid,
  parent_provider_task_id text,
  provider_created_at timestamptz,
  provider_updated_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_check_ins (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id),
  person_id uuid not null,
  kind text not null default 'catch_up',
  input_text text not null default '',
  substantive boolean not null default false,
  occurred_at timestamptz,
  created_at timestamptz not null default now()
);
create table work_reports (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id),
  person_id uuid not null,
  report_date date not null,
  kind text not null default 'eod',
  status text not null default 'draft',
  title text not null default '',
  markdown text not null default '',
  submitted_markdown text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_sessions (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id),
  person_id uuid not null,
  shift_date date not null,
  state text not null default 'scheduled',
  timezone text not null default 'UTC',
  scheduled_starts_at timestamptz,
  scheduled_ends_at timestamptz,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  paused_seconds integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_task_day_events (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id),
  person_id uuid,
  task_id uuid not null,
  provider text not null default 'nifty',
  provider_task_id text not null default '',
  local_date date not null,
  event_type text not null,
  provenance text not null default 'employee_explicit',
  exact_at timestamptz,
  observed_at timestamptz not null default now(),
  task_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create table work_activity_intervals (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id),
  person_id uuid not null references work_people(id),
  generation_status text default 'ready',
  review_status text default 'inferred',
  headline text,
  ai_detail text,
  final_detail text,
  employee_feedback text,
  structured_summary jsonb default '{}'::jsonb,
  coverage jsonb default '{}'::jsonb,
  source_hash text,
  revision int default 1,
  local_date text default '2026-10-21',
  prompt_kind text default 'hourly_fallback',
  failure_reason text,
  evidence_expired_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  timezone text default 'UTC',
  generated_at timestamptz,
  reviewed_at timestamptz,
  updated_at timestamptz,
  next_steps_status text default 'not_requested'
);
create unique index work_activity_intervals_org_person_id_key
  on work_activity_intervals (organization_id, person_id, id);
create table work_audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references work_organizations(id),
  actor_user_id uuid,
  action text not null,
  target_type text not null,
  target_id text,
  metadata jsonb default '{}'
);
create table work_activity_interval_evidence (
  interval_id uuid not null,
  screenshot_summary_id uuid,
  captured_at timestamptz,
  ordinal int,
  used_in_model boolean,
  raw_image_shown boolean,
  selection_reason text,
  visible_app_snapshot text,
  frame_summary_snapshot text
);
create table work_screenshot_summaries (
  id uuid primary key,
  storage_path text,
  expires_at timestamptz,
  deleted_at timestamptz
);
insert into work_organizations (id) values ('${org}'), ('${otherOrg}');
insert into work_org_members (id, organization_id, user_id, role, feature_flags, active) values
  ('${adminMembership}', '${org}', '${adminUser}', 'admin', '{}', true),
  ('${otherAdminMembership}', '${otherOrg}', '40000000-0000-4000-8000-000000000013', 'admin', '{}', true);
`;

export const migration = () => readFile(new URL("../../supabase/migrations/0065_work_admin_otto.sql", import.meta.url), "utf8");

export async function fixture() {
  const db = new PGlite();
  await db.exec(prerequisites);
  await db.exec(await migration());
  globalThis.__workOsPgPool = {
    query: (sql: string, values?: unknown[]) => db.query(sql, values),
    connect: async () => ({ query: (sql: string, values?: unknown[]) => db.query(sql, values), release: () => undefined }),
  } as unknown as Pool;
  return {
    db,
    close: async () => {
      globalThis.__workOsPgPool = undefined;
      await db.close();
    },
  };
}
