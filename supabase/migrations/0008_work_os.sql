-- 0008: Work OS V1 - normalized Nifty task mirror, evidence, blueprints, reports.
-- Nifty remains the task/project source of truth. These tables store the
-- reporting, mapping, evidence, and manager-review layer inside WrazyOS.

create table if not exists work_role_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  productivity_rules jsonb not null default '{}'::jsonb,
  evidence_requirements jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);
create index if not exists work_role_profiles_user_idx on work_role_profiles (user_id, slug);

create table if not exists work_people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  email text,
  role_profile_id uuid references work_role_profiles (id) on delete set null,
  nifty_member_id text,
  worktivity_employee_id text,
  worktivity_user_id text,
  active boolean not null default true,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, nifty_member_id),
  unique (user_id, worktivity_employee_id)
);
create index if not exists work_people_user_idx on work_people (user_id, display_name);
create index if not exists work_people_role_idx on work_people (role_profile_id);

create table if not exists work_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'nifty',
  provider_project_id text not null,
  name text not null,
  archived boolean,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_project_id)
);
create index if not exists work_projects_user_idx on work_projects (user_id, name);

create table if not exists work_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null default 'nifty',
  provider_task_id text not null,
  provider_project_id text,
  project_id uuid references work_projects (id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open',
  completed boolean not null default false,
  assignee_provider_ids text[] not null default '{}'::text[],
  assignee_person_ids uuid[] not null default '{}'::uuid[],
  due_date date,
  start_date date,
  completed_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_task_id)
);
create index if not exists work_tasks_user_due_idx on work_tasks (user_id, due_date, completed);
create index if not exists work_tasks_provider_project_idx on work_tasks (user_id, provider_project_id);
create index if not exists work_tasks_assignees_idx on work_tasks using gin (assignee_provider_ids);

create table if not exists work_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid references work_people (id) on delete set null,
  task_id uuid references work_tasks (id) on delete set null,
  evidence_date date not null default current_date,
  source text not null check (source in ('manual','agent','nifty','worktivity','crm','media')),
  title text not null,
  summary text not null default '',
  url text,
  metrics jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_evidence_user_date_idx on work_evidence (user_id, evidence_date desc);
create index if not exists work_evidence_person_idx on work_evidence (person_id, evidence_date desc);
create index if not exists work_evidence_task_idx on work_evidence (task_id);

create table if not exists work_blueprints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  phases jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);
create index if not exists work_blueprints_user_idx on work_blueprints (user_id, active, name);

create table if not exists work_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  person_id uuid references work_people (id) on delete set null,
  report_date date not null default current_date,
  kind text not null default 'eod',
  status text not null default 'draft' check (status in ('draft','pending_review','approved','rejected')),
  title text not null,
  markdown text not null,
  metrics jsonb not null default '{}'::jsonb,
  missing_evidence jsonb not null default '[]'::jsonb,
  manager_notes text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_reports_user_date_idx on work_reports (user_id, report_date desc);
create index if not exists work_reports_person_idx on work_reports (person_id, report_date desc);

alter table work_role_profiles enable row level security;
alter table work_people enable row level security;
alter table work_projects enable row level security;
alter table work_tasks enable row level security;
alter table work_evidence enable row level security;
alter table work_blueprints enable row level security;
alter table work_reports enable row level security;

drop policy if exists "work_role_profiles select own" on work_role_profiles;
create policy "work_role_profiles select own" on work_role_profiles for select using (user_id = auth.uid());
drop policy if exists "work_role_profiles insert own" on work_role_profiles;
create policy "work_role_profiles insert own" on work_role_profiles for insert with check (user_id = auth.uid());
drop policy if exists "work_role_profiles update own" on work_role_profiles;
create policy "work_role_profiles update own" on work_role_profiles for update using (user_id = auth.uid());

drop policy if exists "work_people select own" on work_people;
create policy "work_people select own" on work_people for select using (user_id = auth.uid());
drop policy if exists "work_people insert own" on work_people;
create policy "work_people insert own" on work_people for insert with check (user_id = auth.uid());
drop policy if exists "work_people update own" on work_people;
create policy "work_people update own" on work_people for update using (user_id = auth.uid());

drop policy if exists "work_projects select own" on work_projects;
create policy "work_projects select own" on work_projects for select using (user_id = auth.uid());
drop policy if exists "work_projects insert own" on work_projects;
create policy "work_projects insert own" on work_projects for insert with check (user_id = auth.uid());
drop policy if exists "work_projects update own" on work_projects;
create policy "work_projects update own" on work_projects for update using (user_id = auth.uid());

drop policy if exists "work_tasks select own" on work_tasks;
create policy "work_tasks select own" on work_tasks for select using (user_id = auth.uid());
drop policy if exists "work_tasks insert own" on work_tasks;
create policy "work_tasks insert own" on work_tasks for insert with check (user_id = auth.uid());
drop policy if exists "work_tasks update own" on work_tasks;
create policy "work_tasks update own" on work_tasks for update using (user_id = auth.uid());

drop policy if exists "work_evidence select own" on work_evidence;
create policy "work_evidence select own" on work_evidence for select using (user_id = auth.uid());
drop policy if exists "work_evidence insert own" on work_evidence;
create policy "work_evidence insert own" on work_evidence for insert with check (user_id = auth.uid());
drop policy if exists "work_evidence update own" on work_evidence;
create policy "work_evidence update own" on work_evidence for update using (user_id = auth.uid());

drop policy if exists "work_blueprints select own" on work_blueprints;
create policy "work_blueprints select own" on work_blueprints for select using (user_id = auth.uid());
drop policy if exists "work_blueprints insert own" on work_blueprints;
create policy "work_blueprints insert own" on work_blueprints for insert with check (user_id = auth.uid());
drop policy if exists "work_blueprints update own" on work_blueprints;
create policy "work_blueprints update own" on work_blueprints for update using (user_id = auth.uid());

drop policy if exists "work_reports select own" on work_reports;
create policy "work_reports select own" on work_reports for select using (user_id = auth.uid());
drop policy if exists "work_reports insert own" on work_reports;
create policy "work_reports insert own" on work_reports for insert with check (user_id = auth.uid());
drop policy if exists "work_reports update own" on work_reports;
create policy "work_reports update own" on work_reports for update using (user_id = auth.uid());
