import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Pool } from "pg";
import type { WorkOsAccess } from "../../src/lib/work-os-api";

/** Shared PGlite fixture for the admin agent API. It mirrors the prerequisite
 * tables the Otto reads fixture installed, adds the directory/project/token
 * tables the admin surface reads, and then applies the real admin migration so
 * the token kind and preview store are exercised as deployed. */

export const org = "10000000-0000-4000-8000-000000000001";
export const otherOrg = "10000000-0000-4000-8000-000000000002";
export const adminUser = "40000000-0000-4000-8000-000000000011";
export const otherAdminUser = "40000000-0000-4000-8000-000000000013";
export const adminMembership = "50000000-0000-4000-8000-000000000001";
export const otherAdminMembership = "50000000-0000-4000-8000-000000000003";
export const personA = "20000000-0000-4000-8000-000000000001";
export const personB = "20000000-0000-4000-8000-000000000002";
export const personC = "20000000-0000-4000-8000-000000000003";
export const otherPerson = "20000000-0000-4000-8000-000000000004";

export const engineerRole = "60000000-0000-4000-8000-000000000001";
export const designerRole = "60000000-0000-4000-8000-000000000002";
export const otherEngineerRole = "60000000-0000-4000-8000-000000000003";

export const teamAlpha = "70000000-0000-4000-8000-000000000001";
export const teamBeta = "70000000-0000-4000-8000-000000000002";
export const otherTeam = "70000000-0000-4000-8000-000000000003";

export const projectWebsite = "80000000-0000-4000-8000-000000000001";
export const projectApp = "80000000-0000-4000-8000-000000000002";
export const projectArchived = "80000000-0000-4000-8000-000000000003";
export const otherProject = "80000000-0000-4000-8000-000000000004";

export const taskCheckout = "a0000000-0000-4000-8000-000000000001";
export const taskCheckoutReview = "a0000000-0000-4000-8000-000000000002";
export const taskCheckoutDone = "a0000000-0000-4000-8000-000000000003";
export const taskPercent = "a0000000-0000-4000-8000-000000000004";
export const taskUnderscore = "a0000000-0000-4000-8000-000000000005";
export const taskArchived = "a0000000-0000-4000-8000-000000000006";
export const taskDeleted = "a0000000-0000-4000-8000-000000000007";
export const taskUnassigned = "a0000000-0000-4000-8000-000000000008";
export const taskDocumentation = "a0000000-0000-4000-8000-000000000009";
export const otherTask = "a0000000-0000-4000-8000-000000000010";
export const taskShared = "a0000000-0000-4000-8000-000000000011";

const access = (
  organizationId: string,
  membershipId: string,
  userId: string,
  personId: string | null,
  featureFlags: Record<string, boolean>,
) => ({
  organizationId,
  personId,
  membershipId,
  role: "admin",
  ctx: { user: { id: userId }, profile: { id: userId } },
  featureFlags,
  organizationOwnerId: userId,
  workspaces: [{ organizationId, name: "Workspace", role: "admin", personId }],
}) as unknown as WorkOsAccess;

export const adminAccess = access(org, adminMembership, adminUser, null, {
  employee_companion: true,
  admin_agent_api: true,
});
export const mappedAdminAccess = access(org, adminMembership, adminUser, personA, {
  employee_companion: true,
  admin_agent_api: true,
});
export const otherOrgAccess = access(otherOrg, otherAdminMembership, otherAdminUser, null, {
  employee_companion: true,
  admin_agent_api: true,
});

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
create table work_role_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id),
  user_id uuid,
  slug text not null default '',
  name text not null,
  description text not null default '',
  productivity_rules jsonb not null default '{}'::jsonb,
  evidence_requirements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_people (
  id uuid primary key,
  user_id uuid,
  organization_id uuid not null references work_organizations(id),
  display_name text not null,
  email text,
  role_profile_id uuid references work_role_profiles(id) on delete set null,
  active boolean not null default true,
  nifty_member_id text,
  worktivity_employee_id text,
  worktivity_user_id text,
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
create table work_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  timezone text not null,
  shift_start time not null,
  shift_end time not null,
  break_windows jsonb not null default '[]'::jsonb,
  days_of_week smallint[] not null default '{1,2,3,4,5}',
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);
create table work_team_members (
  team_id uuid not null references work_teams(id) on delete cascade,
  person_id uuid not null,
  is_manager boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, person_id)
);
create table work_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  organization_id uuid not null references work_organizations(id),
  provider text not null default 'nifty',
  provider_project_id text not null default '',
  name text not null,
  archived boolean,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
  workflow_status text not null default 'pending',
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
  agent_token_id uuid,
  agent_idempotency_key text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table work_task_blockers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  task_id uuid not null references work_tasks(id) on delete cascade,
  person_id uuid references work_people(id) on delete set null,
  description text not null,
  status text not null default 'active' check (status in ('active','resolved')),
  created_by uuid,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  agent_token_id uuid
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
create table work_report_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  report_id uuid not null references work_reports(id) on delete cascade,
  version_kind text not null check (version_kind in ('draft','employee_submission','manager_edit')),
  markdown text not null,
  metrics jsonb not null default '{}'::jsonb,
  missing_evidence jsonb not null default '[]'::jsonb,
  created_by uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create table work_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid references work_people(id) on delete set null,
  task_id uuid references work_tasks(id) on delete set null,
  evidence_date date not null default current_date,
  source text not null,
  title text not null,
  summary text not null default '',
  url text,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index work_evidence_idempotency_uidx
  on work_evidence (organization_id, idempotency_key)
  where idempotency_key is not null;
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
create table work_agent_tokens (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null,
  person_id uuid, user_id uuid not null, kind text not null default 'employee',
  name text not null, token_hash text not null unique, token_prefix text not null,
  scopes text[] not null default '{}', created_by uuid, expires_at timestamptz not null,
  last_used_at timestamptz, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table work_agent_idempotency (
  organization_id uuid not null references work_organizations(id) on delete cascade,
  token_id uuid not null references work_agent_tokens(id) on delete cascade,
  key text not null,
  request_hash text not null,
  status smallint not null default 0,
  body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (token_id, key)
);
insert into work_organizations (id) values ('${org}'), ('${otherOrg}');
insert into work_org_members (id, organization_id, user_id, role, feature_flags, active) values
  ('${adminMembership}', '${org}', '${adminUser}', 'admin', '{}', true),
  ('${otherAdminMembership}', '${otherOrg}', '${otherAdminUser}', 'admin', '{}', true);
`;

export const migration = () => readFile(new URL("../../supabase/migrations/0069_work_admin_agent_access.sql", import.meta.url), "utf8");

/** Directory seed: two active people in the organization (one with an
 * engineer role, one manager-of-a-shared-team), one inactive person, one
 * person in the other organization, three teams, and four projects. */
export async function seedDirectory(db: Pick<PGlite, "query">) {
  await db.query(`insert into work_role_profiles (id, organization_id, slug, name) values
    ($1,$2,'engineer','Engineer'), ($3,$2,'designer','Designer'), ($4,$5,'engineer','Engineer')`,
  [engineerRole, org, designerRole, otherEngineerRole, otherOrg]);
  await db.query(`insert into work_people
    (id, user_id, organization_id, display_name, email, role_profile_id, active) values
    ($1,$5,$6,'Ada Lovelace','ada@example.com',$7,true),
    ($2,$5,$6,'Grace Hopper','grace@example.com',$8,true),
    ($3,$5,$6,'Linus Torvalds','linus@example.com',null,false),
    ($4,$9,$10,'Hedy Lamarr','hedy@example.com',$11,true)`,
  [personA, personB, personC, otherPerson, adminUser, org, engineerRole, designerRole, otherAdminUser, otherOrg, otherEngineerRole]);
  await db.query(`insert into work_employee_onboarding (organization_id, person_id, timezone) values
    ($1,$2,'Europe/London'), ($1,$3,'America/New_York'), ($1,$4,'UTC'), ($5,$6,'UTC')`,
  [org, personA, personB, personC, otherOrg, otherPerson]);
  await db.query(`insert into work_teams (id, organization_id, name, active) values
    ($1,$4,'Alpha',true), ($2,$4,'Beta',true), ($3,$5,'Other',true)`,
  [teamAlpha, teamBeta, otherTeam, org, otherOrg]);
  await db.query(`insert into work_team_members (team_id, person_id, is_manager) values
    ($1,$3,false), ($2,$3,false), ($2,$4,true), ($5,$6,false)`,
  [teamAlpha, teamBeta, personA, personB, otherTeam, otherPerson]);
  await db.query(`insert into work_projects
    (id, user_id, organization_id, provider, provider_project_id, name, archived) values
    ($1,$5,$6,'nifty','pp-website','Website',false),
    ($2,$5,$6,'nifty','pp-app','App',false),
    ($3,$5,$6,'nifty','pp-legacy','Legacy',true),
    ($4,$7,$8,'nifty','pp-other','Other Site',false)`,
  [projectWebsite, projectApp, projectArchived, otherProject, adminUser, org, otherAdminUser, otherOrg]);
}

/** Task seed: active, completed, archived, deleted, unassigned, shared, and
 * other-organization rows so the list filters, cursor, and tenant boundary all
 * have real rows to answer against. Timestamps are fixed so ordering is clear. */
export async function seedTasks(db: Pick<PGlite, "query">) {
  await db.query(`insert into work_tasks
    (id, user_id, organization_id, provider, provider_task_id, project_id, title, description,
     status, workflow_status, completed, assignee_person_ids, due_date, updated_at) values
    ($1,$10,$11,'nifty','pt-checkout',$12,'Fix checkout','Checkout button drops the cart','open','in_progress',false,$13::uuid[],'2026-11-15','2026-11-02T10:00:00.123456Z'),
    ($2,$10,$11,'nifty','pt-checkout-review',$14,'Review checkout copy','Second pass on checkout copy','open','pending',false,$15::uuid[],'2026-12-05','2026-11-02T10:00:00.123789Z'),
    ($3,$10,$11,'nifty','pt-checkout-done',$12,'Checkout follow-up','Closed after checkout shipped','completed','pending',true,$15::uuid[],'2026-11-10','2026-11-02T08:00:00Z'),
    ($4,$10,$11,'nifty','pt-percent',$14,'Ship 100% coverage','Coverage gate for the next release','open','pending',false,$13::uuid[],'2026-11-18','2026-11-01T12:00:00Z'),
    ($5,$10,$11,'nifty','pt-underscore',null,'Under_score cleanup','Rename under_score fields','open','pending',false,$13::uuid[],'2026-11-19','2026-11-01T11:00:00Z'),
    ($6,$10,$11,'nifty','pt-archived',$12,'Old checkout archive','Finished last quarter','archived','pending',false,$13::uuid[],'2026-11-16','2026-10-30T10:00:00Z'),
    ($7,$10,$11,'nifty','pt-deleted',$12,'Deleted checkout','Removed by an admin','deleted','pending',false,$13::uuid[],'2026-11-17','2026-10-30T09:00:00Z'),
    ($8,$10,$11,'nifty','pt-unassigned',$12,'Unassigned backlog','Nobody owns this yet','open','pending',false,'{}'::uuid[],'2026-11-21','2026-10-29T10:00:00Z'),
    ($9,$10,$11,'nifty','pt-docs',$14,'Earlier documentation pass','Docs refresh','open','pending',false,$13::uuid[],null,'2026-10-20T10:00:00Z'),
    ($16,$17,$18,'nifty','pt-other',$19,'Other org secret','Must never leak','open','pending',false,$20::uuid[],'2026-11-15','2026-11-02T10:00:00Z'),
    ($21,$10,$11,'nifty','pt-shared',$12,'Shared launch checklist','Both owners track this','open','pending',false,$22::uuid[],'2026-11-25','2026-11-01T10:00:00Z')`,
  [
    taskCheckout, taskCheckoutReview, taskCheckoutDone, taskPercent, taskUnderscore,
    taskArchived, taskDeleted, taskUnassigned, taskDocumentation,
    adminUser, org, projectApp, [personA], projectWebsite, [personB], otherTask,
    otherAdminUser, otherOrg, otherProject, [otherPerson], taskShared, [personA, personB],
  ]);
}

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
    seedDirectory: () => seedDirectory(db),
    seedTasks: () => seedTasks(db),
    close: async () => {
      globalThis.__workOsPgPool = undefined;
      await db.close();
    },
  };
}
