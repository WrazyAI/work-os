-- Work OS Employee Companion: organization tenancy, employee workflow,
-- neutral evidence, immutable report review, and desktop authorization.

create table if not exists work_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  legacy_owner_id uuid unique references auth.users(id) on delete set null,
  feature_flags jsonb not null default '{"employee_companion":false,"github_evidence":false,"ghl_evidence":false,"screenshot_summaries":false,"desktop_companion":false}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table work_organizations add column if not exists nifty_synced_at timestamptz;
alter table work_organizations add column if not exists nifty_sync_error text;

create table if not exists work_org_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  person_id uuid,
  role text not null check (role in ('employee','manager','admin')),
  feature_flags jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index if not exists work_org_members_user_idx on work_org_members(user_id, active);

create table if not exists work_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists work_team_members (
  team_id uuid not null references work_teams(id) on delete cascade,
  person_id uuid not null,
  is_manager boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (team_id, person_id)
);

insert into work_organizations(name, slug, legacy_owner_id, created_by, feature_flags)
select coalesce(nullif(trim(p.display_name),''), nullif(trim(p.email),''), 'Work OS') || ' Workspace',
       'legacy-' || replace(owner_id::text, '-', ''), owner_id, owner_id,
       '{"employee_companion":true,"github_evidence":false,"ghl_evidence":false,"screenshot_summaries":false,"desktop_companion":false}'::jsonb
from (
  select user_id owner_id from work_role_profiles union select user_id from work_people
  union select user_id from work_projects union select user_id from work_tasks
  union select user_id from work_evidence union select user_id from work_blueprints
  union select user_id from work_reports
) owners left join profiles p on p.id = owner_id
on conflict (legacy_owner_id) do nothing;

insert into work_org_members(organization_id, user_id, role)
select id, legacy_owner_id, 'admin' from work_organizations where legacy_owner_id is not null
on conflict (organization_id,user_id) do update set role='admin', active=true, updated_at=now();

alter table work_role_profiles add column if not exists organization_id uuid references work_organizations(id) on delete cascade;
alter table work_people add column if not exists organization_id uuid references work_organizations(id) on delete cascade;
alter table work_projects add column if not exists organization_id uuid references work_organizations(id) on delete cascade;
alter table work_tasks add column if not exists organization_id uuid references work_organizations(id) on delete cascade;
alter table work_evidence add column if not exists organization_id uuid references work_organizations(id) on delete cascade;
alter table work_blueprints add column if not exists organization_id uuid references work_organizations(id) on delete cascade;
alter table work_reports add column if not exists organization_id uuid references work_organizations(id) on delete cascade;
alter table work_reports add column if not exists draft_idempotency_key text;
alter table work_reports add column if not exists submission_idempotency_key text;

update work_role_profiles x set organization_id=o.id from work_organizations o where x.organization_id is null and o.legacy_owner_id=x.user_id;
update work_people x set organization_id=o.id from work_organizations o where x.organization_id is null and o.legacy_owner_id=x.user_id;
update work_projects x set organization_id=o.id from work_organizations o where x.organization_id is null and o.legacy_owner_id=x.user_id;
update work_tasks x set organization_id=o.id from work_organizations o where x.organization_id is null and o.legacy_owner_id=x.user_id;
update work_evidence x set organization_id=o.id from work_organizations o where x.organization_id is null and o.legacy_owner_id=x.user_id;
update work_blueprints x set organization_id=o.id from work_organizations o where x.organization_id is null and o.legacy_owner_id=x.user_id;
update work_reports x set organization_id=o.id from work_organizations o where x.organization_id is null and o.legacy_owner_id=x.user_id;

alter table work_role_profiles alter column organization_id set not null;
alter table work_people alter column organization_id set not null;
alter table work_projects alter column organization_id set not null;
alter table work_tasks alter column organization_id set not null;
alter table work_evidence alter column organization_id set not null;
alter table work_blueprints alter column organization_id set not null;
alter table work_reports alter column organization_id set not null;

create index if not exists work_people_org_idx on work_people(organization_id, display_name);
create index if not exists work_projects_org_idx on work_projects(organization_id, name);
create index if not exists work_tasks_org_due_idx on work_tasks(organization_id, due_date, completed);
create index if not exists work_evidence_org_date_idx on work_evidence(organization_id, evidence_date desc);
create index if not exists work_reports_org_date_idx on work_reports(organization_id, report_date desc);
create unique index if not exists work_reports_draft_idempotency_uidx on work_reports(organization_id,draft_idempotency_key) where draft_idempotency_key is not null;

alter table work_people add column if not exists auth_user_id uuid references auth.users(id) on delete set null;
create unique index if not exists work_people_org_auth_user_uidx on work_people(organization_id,auth_user_id) where auth_user_id is not null;
create unique index if not exists work_people_org_email_uidx on work_people(organization_id,lower(trim(email))) where email is not null and trim(email) <> '';
update work_people wp set auth_user_id=p.id, updated_at=now() from profiles p
where wp.auth_user_id is null and wp.email is not null and p.email is not null
  and lower(trim(wp.email))=lower(trim(p.email));

alter table work_org_members drop constraint if exists work_org_members_person_id_fkey;
alter table work_org_members add constraint work_org_members_person_id_fkey foreign key(person_id) references work_people(id) on delete set null;
alter table work_team_members drop constraint if exists work_team_members_person_id_fkey;
alter table work_team_members add constraint work_team_members_person_id_fkey foreign key(person_id) references work_people(id) on delete cascade;
update work_org_members m set person_id=p.id from work_people p where m.person_id is null and p.organization_id=m.organization_id and p.auth_user_id=m.user_id;

alter table work_tasks add column if not exists priority text;
alter table work_tasks add column if not exists task_group_id text;
alter table work_tasks add column if not exists labels text[] not null default '{}'::text[];
alter table work_tasks add column if not exists story_points numeric;
alter table work_tasks add column if not exists dependency_provider_ids text[] not null default '{}'::text[];
alter table work_tasks add column if not exists estimated_effort numeric;
alter table work_tasks add column if not exists estimated_effort_minutes integer;
alter table work_tasks add column if not exists effort_unit text default 'hours';
alter table work_tasks add column if not exists expected_outcome text;
alter table work_tasks add column if not exists definition_of_done text;
alter table work_tasks add column if not exists dependency_task_ids uuid[] not null default '{}'::uuid[];
alter table work_tasks add column if not exists blocked boolean not null default false;
alter table work_tasks add column if not exists blocked_reason text;

create table if not exists work_provider_field_mappings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null, semantic_field text not null, provider_field_id text not null, config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,provider,semantic_field)
);

create table if not exists work_task_blockers (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  task_id uuid not null references work_tasks(id) on delete cascade, person_id uuid references work_people(id) on delete set null,
  description text not null,
  status text not null default 'active' check(status in ('active','resolved')),
  created_by uuid references auth.users(id) on delete set null, resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), resolved_at timestamptz, updated_at timestamptz not null default now()
);

create table if not exists work_schedules (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade, timezone text not null,
  shift_start time not null, shift_end time not null, break_windows jsonb not null default '[]'::jsonb,
  days_of_week smallint[] not null default '{1,2,3,4,5}', effective_from date not null default current_date, effective_to date,
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists work_schedules_person_idx on work_schedules(organization_id,person_id,effective_from);

create table if not exists work_schedule_exceptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  schedule_id uuid references work_schedules(id) on delete cascade, person_id uuid not null references work_people(id) on delete cascade, exception_date date not null,
  kind text not null check(kind in ('leave','changed_shift','working_day')),
  shift_start time, shift_end time, break_windows jsonb not null default '[]'::jsonb, note text,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,person_id,exception_date)
);

create table if not exists work_check_ins (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade, schedule_id uuid references work_schedules(id) on delete set null, shift_date date not null,
  kind text not null check(kind in ('plan','catch_up','optional','eod')),
  input_text text not null default '', confirmed_existing_tasks boolean not null default false,
  substantive boolean not null default false, source text not null default 'web' check(source in ('web','desktop','agent')),
  snoozed_until timestamptz, client_request_id text, created_by uuid references auth.users(id) on delete set null, occurred_at timestamptz not null default now(), created_at timestamptz not null default now(),
  unique(organization_id,person_id,client_request_id)
);
create index if not exists work_check_ins_person_idx on work_check_ins(organization_id,person_id,created_at desc);

create table if not exists work_task_proposals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade, check_in_id uuid references work_check_ins(id) on delete set null,
  task_id uuid references work_tasks(id) on delete set null, operation text not null check(operation in ('create_task','update_task','log_progress','add_blocker','resolve_blocker','link_evidence','complete_task')),
  input_text text not null, before_state jsonb not null default '{}'::jsonb, proposed_change jsonb not null default '{}'::jsonb,
  model text, prompt_version text,
  status text not null default 'pending' check(status in ('pending','accepted','rejected','applying','applied','failed','needs_review','stale')),
  idempotency_key text, decision_idempotency_key text, provider_result jsonb not null default '{}'::jsonb, failure_reason text,
  created_by uuid references auth.users(id) on delete set null, decided_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), decided_at timestamptz, applied_at timestamptz, updated_at timestamptz not null default now(),
  unique(organization_id,idempotency_key)
);
create index if not exists work_task_proposals_person_idx on work_task_proposals(organization_id,person_id,created_at desc);

create table if not exists work_provider_connections (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null, external_workspace_id text not null, config jsonb not null default '{}'::jsonb,
  active boolean not null default true, created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(provider,external_workspace_id)
);

create table if not exists work_provider_credentials (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null, access_token_cipher text not null, refresh_token_cipher text, expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,provider)
);

create table if not exists work_provider_oauth_states (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null, state_hash text not null unique, redirect_uri text not null, expires_at timestamptz not null,
  used_at timestamptz, created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

create table if not exists work_source_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null, external_account_id text not null, external_email text, person_id uuid references work_people(id) on delete set null,
  verified boolean not null default false, verified_by uuid references auth.users(id) on delete set null, verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(organization_id,provider,external_account_id)
);

create table if not exists work_evidence_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  provider text not null, external_event_id text not null, event_type text,
  evidence_class text not null check(evidence_class in ('activity_observation','output_evidence','work_claim')),
  person_id uuid references work_people(id) on delete set null, task_id uuid references work_tasks(id) on delete set null,
  attribution_method text not null default 'unattributed', attribution_confidence numeric not null default 0 check(attribution_confidence between 0 and 1),
  occurred_at timestamptz not null, ingested_at timestamptz not null default now(), artifact_url text,
  title text not null, summary text not null default '', metadata jsonb not null default '{}'::jsonb, raw jsonb not null default '{}'::jsonb,
  correction_status text not null default 'original' check(correction_status in ('original','corrected','disputed','retracted')),
  corrected_by uuid references auth.users(id) on delete set null, corrected_at timestamptz, updated_at timestamptz not null default now(),
  unique(organization_id,provider,external_event_id)
);
create index if not exists work_evidence_events_person_idx on work_evidence_events(organization_id,person_id,occurred_at desc);
alter table work_evidence add column if not exists evidence_event_id uuid references work_evidence_events(id) on delete set null;
alter table work_evidence add column if not exists idempotency_key text;
alter table work_evidence drop constraint if exists work_evidence_source_check;
create unique index if not exists work_evidence_event_uidx on work_evidence(evidence_event_id) where evidence_event_id is not null;
create unique index if not exists work_evidence_idempotency_uidx on work_evidence(organization_id,idempotency_key) where idempotency_key is not null;

create table if not exists work_screenshot_summaries (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid references work_people(id) on delete cascade, evidence_event_id uuid not null references work_evidence_events(id) on delete cascade,
  source_reference text, storage_path text, expires_at timestamptz,
  summary text not null default '', visible_context jsonb not null default '{}'::jsonb,
  encryption_metadata jsonb not null default '{}'::jsonb,
  confidence numeric not null default 0 check(confidence between 0 and 1),
  processing_status text not null default 'pending' check(processing_status in ('pending','processed','excluded','failed','deleted')),
  model text, prompt_version text, failure_reason text, deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(evidence_event_id)
);

create table if not exists work_screenshot_access_log (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  screenshot_summary_id uuid not null references work_screenshot_summaries(id) on delete cascade,
  accessed_by uuid not null references auth.users(id) on delete cascade, reason text not null, accessed_at timestamptz not null default now()
);

alter table work_reports add column if not exists submitted_markdown text;
alter table work_reports add column if not exists submitted_by uuid references auth.users(id) on delete set null;
alter table work_reports add column if not exists submitted_at timestamptz;
create table if not exists work_report_versions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  report_id uuid not null references work_reports(id) on delete cascade,
  version_kind text not null check(version_kind in ('draft','employee_submission','manager_edit')),
  markdown text not null, metrics jsonb not null default '{}'::jsonb, missing_evidence jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);
alter table work_report_versions add column if not exists idempotency_key text;
create unique index if not exists work_report_versions_idempotency_uidx on work_report_versions(organization_id,idempotency_key);

create table if not exists work_desktop_auth_codes (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, code_hash text not null unique, pkce_challenge text not null,
  state text not null, redirect_uri text not null, expires_at timestamptz not null, used_at timestamptz, created_at timestamptz not null default now()
);
create table if not exists work_desktop_sessions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references work_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, token_hash text not null unique,
  device_name text not null default 'Work OS Companion', expires_at timestamptz not null, last_used_at timestamptz, revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists work_audit_log (
  id bigint generated always as identity primary key, organization_id uuid not null references work_organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null, action text not null, target_type text not null,
  target_id text, reason text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists work_audit_log_org_idx on work_audit_log(organization_id,created_at desc);

create or replace function work_has_org_role(org_id uuid, allowed_roles text[]) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from work_org_members m where m.organization_id=org_id and m.user_id=auth.uid() and m.active and m.role=any(allowed_roles));
$$;
create or replace function work_can_access_person(org_id uuid, target_person uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from work_org_members m where m.organization_id=org_id and m.user_id=auth.uid() and m.active and
    (m.role='admin' or m.person_id=target_person or (m.role='manager' and exists(
      select 1 from work_team_members mgr join work_team_members member on member.team_id=mgr.team_id
      where mgr.person_id=m.person_id and mgr.is_manager and member.person_id=target_person))));
$$;

-- Replace legacy owner-only access with organization/person/team-aware reads.
do $$ declare t text; p text; begin
 foreach t in array array['work_role_profiles','work_people','work_projects','work_tasks','work_evidence','work_blueprints','work_reports'] loop
  foreach p in array array['select own','insert own','update own','org read','person read','admin manage'] loop
   execute format('drop policy if exists %I on %I','work_'||replace(t,'work_','')||' '||p,t);
  end loop;
 end loop;
end $$;
create policy "work_role_profiles org read" on work_role_profiles for select using(work_has_org_role(organization_id,array['employee','manager','admin']));
create policy "work_role_profiles admin manage" on work_role_profiles for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));
create policy "work_people person read" on work_people for select using(work_can_access_person(organization_id,id));
create policy "work_people admin manage" on work_people for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));
create policy "work_projects org read" on work_projects for select using(work_has_org_role(organization_id,array['employee','manager','admin']));
create policy "work_projects admin manage" on work_projects for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));
create policy "work_tasks person read" on work_tasks for select using(
  work_has_org_role(organization_id,array['admin']) or exists(select 1 from unnest(assignee_person_ids) p where work_can_access_person(organization_id,p))
);
create policy "work_tasks admin manage" on work_tasks for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));
create policy "work_evidence person read" on work_evidence for select using(person_id is not null and work_can_access_person(organization_id,person_id));
create policy "work_evidence admin manage" on work_evidence for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));
create policy "work_blueprints org read" on work_blueprints for select using(work_has_org_role(organization_id,array['employee','manager','admin']));
create policy "work_blueprints admin manage" on work_blueprints for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));
create policy "work_reports person read" on work_reports for select using(person_id is not null and work_can_access_person(organization_id,person_id));
create policy "work_reports admin manage" on work_reports for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));

alter table work_organizations enable row level security;
alter table work_org_members enable row level security;
alter table work_teams enable row level security;
alter table work_team_members enable row level security;
drop policy if exists "work organizations member read" on work_organizations;
create policy "work organizations member read" on work_organizations for select using(work_has_org_role(id,array['employee','manager','admin']));
drop policy if exists "work organizations admin manage" on work_organizations;
create policy "work organizations admin manage" on work_organizations for update using(work_has_org_role(id,array['admin']));
drop policy if exists "work org members authorized read" on work_org_members;
create policy "work org members authorized read" on work_org_members for select using(user_id=auth.uid() or work_has_org_role(organization_id,array['manager','admin']));
drop policy if exists "work org members admin manage" on work_org_members;
create policy "work org members admin manage" on work_org_members for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));

do $$ declare t text; begin foreach t in array array[
 'work_provider_field_mappings','work_task_blockers','work_schedules','work_schedule_exceptions','work_check_ins','work_task_proposals',
 'work_provider_connections','work_source_accounts','work_evidence_events','work_screenshot_summaries','work_screenshot_access_log',
 'work_report_versions','work_desktop_auth_codes','work_desktop_sessions','work_audit_log'
] loop execute format('alter table %I enable row level security',t);
 execute format('drop policy if exists %I on %I',t||' org read',t);
 execute format('create policy %I on %I for select using(work_has_org_role(organization_id,array[''employee'',''manager'',''admin'']))',t||' org read',t);
 execute format('drop policy if exists %I on %I',t||' admin manage',t);
 execute format('create policy %I on %I for all using(work_has_org_role(organization_id,array[''admin''])) with check(work_has_org_role(organization_id,array[''admin'']))',t||' admin manage',t);
end loop; end $$;

alter table work_provider_credentials enable row level security;
alter table work_provider_oauth_states enable row level security;
drop policy if exists "provider credentials admin only" on work_provider_credentials;
create policy "provider credentials admin only" on work_provider_credentials for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));
drop policy if exists "provider oauth states admin only" on work_provider_oauth_states;
create policy "provider oauth states admin only" on work_provider_oauth_states for all using(work_has_org_role(organization_id,array['admin'])) with check(work_has_org_role(organization_id,array['admin']));

-- Replace broad organization reads with person/team-aware policies for employee data.
do $$ declare t text; begin foreach t in array array['work_schedules','work_schedule_exceptions','work_check_ins','work_task_proposals','work_evidence_events'] loop
 execute format('drop policy if exists %I on %I',t||' org read',t);
 execute format('drop policy if exists %I on %I',t||' person read',t);
 execute format('create policy %I on %I for select using(person_id is not null and work_can_access_person(organization_id,person_id))',t||' person read',t);
end loop; end $$;

drop policy if exists "work_screenshot_summaries org read" on work_screenshot_summaries;
drop policy if exists "work screenshot summaries person read" on work_screenshot_summaries;
create policy "work screenshot summaries person read" on work_screenshot_summaries for select using(
  exists(select 1 from work_evidence_events e where e.id=evidence_event_id and e.person_id is not null and work_can_access_person(organization_id,e.person_id))
);
drop policy if exists "work_report_versions org read" on work_report_versions;
drop policy if exists "work report versions person read" on work_report_versions;
create policy "work report versions person read" on work_report_versions for select using(
  exists(select 1 from work_reports r where r.id=report_id and r.person_id is not null and work_can_access_person(organization_id,r.person_id))
);
drop policy if exists "work_task_blockers org read" on work_task_blockers;
drop policy if exists "work task blockers person read" on work_task_blockers;
create policy "work task blockers person read" on work_task_blockers for select using(
  exists(select 1 from work_tasks t, unnest(t.assignee_person_ids) p where t.id=task_id and work_can_access_person(organization_id,p))
);

do $$ declare t text; begin foreach t in array array['work_provider_field_mappings','work_provider_connections','work_source_accounts','work_screenshot_access_log','work_audit_log'] loop
 execute format('drop policy if exists %I on %I',t||' org read',t);
 execute format('drop policy if exists %I on %I',t||' admin read',t);
 execute format('create policy %I on %I for select using(work_has_org_role(organization_id,array[''admin'']))',t||' admin read',t);
end loop; end $$;

alter table work_desktop_auth_codes enable row level security;
alter table work_desktop_sessions enable row level security;
drop policy if exists "work_desktop_auth_codes org read" on work_desktop_auth_codes;
drop policy if exists "work_desktop_sessions org read" on work_desktop_sessions;
drop policy if exists "desktop auth codes own read" on work_desktop_auth_codes;
drop policy if exists "desktop sessions own read" on work_desktop_sessions;
create policy "desktop auth codes own read" on work_desktop_auth_codes for select using(user_id=auth.uid() or work_has_org_role(organization_id,array['admin']));
create policy "desktop sessions own read" on work_desktop_sessions for select using(user_id=auth.uid() or work_has_org_role(organization_id,array['admin']));

create or replace function work_assign_legacy_organization() returns trigger language plpgsql security definer set search_path=public as $$
begin if new.organization_id is null and new.user_id is not null then select id into new.organization_id from work_organizations where legacy_owner_id=new.user_id; end if; return new; end $$;
do $$ declare t text; begin foreach t in array array['work_role_profiles','work_people','work_projects','work_tasks','work_evidence','work_blueprints','work_reports'] loop
 execute format('drop trigger if exists work_assign_organization on %I',t);
 execute format('create trigger work_assign_organization before insert or update on %I for each row execute function work_assign_legacy_organization()',t);
end loop; end $$;

create or replace function work_link_profile_person() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update work_people set auth_user_id=new.id,updated_at=now() where auth_user_id is null and email is not null and new.email is not null and lower(trim(email))=lower(trim(new.email));
 insert into work_org_members(organization_id,user_id,person_id,role)
 select organization_id,new.id,id,'employee' from work_people where auth_user_id=new.id and organization_id is not null
 on conflict(organization_id,user_id) do update set person_id=excluded.person_id,active=true,updated_at=now();
 return new;
end $$;
drop trigger if exists work_link_profile_person_trigger on profiles;
create trigger work_link_profile_person_trigger after insert or update of email on profiles for each row execute function work_link_profile_person();

create or replace function work_link_person_login() returns trigger language plpgsql security definer set search_path=public as $$
declare matched_user uuid;
begin
  if new.organization_id is null or new.email is null then return new; end if;
  matched_user := new.auth_user_id;
  if matched_user is null then select id into matched_user from profiles where email is not null and lower(trim(email))=lower(trim(new.email)) limit 1; end if;
  if matched_user is not null then
    if new.auth_user_id is null then update work_people set auth_user_id=matched_user,updated_at=now() where id=new.id; end if;
    insert into work_org_members(organization_id,user_id,person_id,role)
    values(new.organization_id,matched_user,new.id,'employee')
    on conflict(organization_id,user_id) do update set person_id=excluded.person_id,active=true,updated_at=now();
  end if;
  return new;
end $$;
drop trigger if exists work_link_person_login_trigger on work_people;
create trigger work_link_person_login_trigger after insert or update of email,organization_id on work_people for each row execute function work_link_person_login();
