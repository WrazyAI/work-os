-- Phase 1 reliability: one daily-workspace ledger, repairable sessions, and
-- exact Nifty chronology. The production migration runner wraps this file in a
-- transaction; every data correction below is therefore atomic.

alter table work_sessions
  add column if not exists correction_status text not null default 'valid',
  add column if not exists correction_reason text,
  add column if not exists correction_timestamp timestamptz,
  add column if not exists correction_provenance text,
  add column if not exists corrected_at timestamptz,
  add column if not exists corrected_by uuid references auth.users(id) on delete set null,
  add column if not exists exception_acknowledged_at timestamptz,
  add column if not exists exception_reason text;

alter table work_evidence add column if not exists idempotency_key text;
create unique index if not exists work_evidence_org_idempotency_uidx
  on work_evidence(organization_id,idempotency_key) where idempotency_key is not null;

alter table work_sessions drop constraint if exists work_sessions_correction_status_check;
alter table work_sessions add constraint work_sessions_correction_status_check
  check (correction_status in ('valid','needs_correction','corrected','invalid'));
alter table work_sessions drop constraint if exists work_sessions_correction_provenance_check;
alter table work_sessions add constraint work_sessions_correction_provenance_check
  check (correction_provenance is null or correction_provenance in ('employee_entered','provider_observed','admin_repair'));

create table if not exists work_task_day_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid references work_people(id) on delete set null,
  task_id uuid not null references work_tasks(id) on delete cascade,
  provider text not null default 'nifty',
  provider_task_id text not null,
  local_date date not null,
  event_type text not null,
  provenance text not null,
  exact_at timestamptz,
  observed_at timestamptz not null default now(),
  task_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
alter table work_task_day_events drop constraint if exists work_task_day_events_event_type_check;
alter table work_task_day_events add constraint work_task_day_events_event_type_check
  check (event_type in ('surfaced','deferred','carried','completed','reopened','creation_observed'));
alter table work_task_day_events drop constraint if exists work_task_day_events_provenance_check;
alter table work_task_day_events add constraint work_task_day_events_provenance_check
  check (provenance in ('nifty_exact','provider_observed','employee_explicit','migration_exact','migration_observed'));
create index if not exists work_task_day_events_person_date_idx
  on work_task_day_events(organization_id, person_id, local_date desc, observed_at desc, id desc);
create index if not exists work_task_day_events_task_idx
  on work_task_day_events(organization_id, task_id, observed_at desc);

alter table work_task_day_events enable row level security;
drop policy if exists "work_task_day_events person read" on work_task_day_events;
create policy "work_task_day_events person read" on work_task_day_events for select
  using (person_id is not null and work_can_access_person(organization_id, person_id));
drop policy if exists "work_task_day_events admin manage" on work_task_day_events;
create policy "work_task_day_events admin manage" on work_task_day_events for all
  using (work_has_org_role(organization_id,array['admin']))
  with check (work_has_org_role(organization_id,array['admin']));

-- Nifty's API calls the exact completion field completed_on. Preserve any
-- timestamp already recorded and backfill only valid provider timestamps.
update work_tasks
set completed_at = coalesce(completed_at, (raw->>'completed_on')::timestamptz),
    updated_at = now()
where completed = true
  and completed_at is null
  and coalesce(raw->>'completed_on','') ~ '^\d{4}-\d{2}-\d{2}T';

insert into work_task_day_events (
  organization_id, person_id, task_id, provider, provider_task_id, local_date,
  event_type, provenance, exact_at, observed_at, task_snapshot, metadata, idempotency_key
)
select task.organization_id,
  coalesce(
    task.assignee_person_ids[1],
    creator.id,
    subscriber.id
  ),
  task.id, task.provider, task.provider_task_id,
  (task.completed_at at time zone coalesce((
    select onboarding.timezone from work_employee_onboarding onboarding
    where onboarding.organization_id=task.organization_id
      and onboarding.person_id=coalesce(task.assignee_person_ids[1],creator.id,subscriber.id)
    limit 1
  ),'UTC'))::date,
  'completed', 'migration_exact', task.completed_at, task.completed_at,
  jsonb_build_object('title',task.title,'completed',true,'status',task.status,'dueDate',task.due_date),
  jsonb_build_object('sourceField','raw.completed_on'),
  'nifty:completed:' || task.provider_task_id || ':' || task.completed_at::text
from work_tasks task
left join lateral (
  select person.id from work_people person
  where person.organization_id=task.organization_id
    and person.nifty_member_id=task.raw->>'created_by'
  limit 1
) creator on true
left join lateral (
  select person.id from work_people person
  where person.organization_id=task.organization_id
    and person.nifty_member_id is not null
    and coalesce(task.raw->'subscribers','[]'::jsonb) ? person.nifty_member_id
  limit 1
) subscriber on true
where task.completed=true and task.completed_at is not null
on conflict (organization_id,idempotency_key) do nothing;

insert into work_task_day_events (
  organization_id, person_id, task_id, provider, provider_task_id, local_date,
  event_type, provenance, exact_at, observed_at, task_snapshot, metadata, idempotency_key
)
select task.organization_id,
  coalesce(task.assignee_person_ids[1], creator.id, subscriber.id),
  task.id, task.provider, task.provider_task_id,
  (task.provider_created_at at time zone coalesce((
    select onboarding.timezone from work_employee_onboarding onboarding
    where onboarding.organization_id=task.organization_id
      and onboarding.person_id=coalesce(task.assignee_person_ids[1],creator.id,subscriber.id)
    limit 1
  ),'UTC'))::date,
  'creation_observed', 'migration_observed', task.provider_created_at, task.provider_created_at,
  jsonb_build_object('title',task.title,'completed',task.completed,'status',task.status,'dueDate',task.due_date),
  jsonb_build_object('sourceField','provider_created_at'),
  'nifty:created:' || task.provider_task_id || ':' || task.provider_created_at::text
from work_tasks task
left join lateral (
  select person.id from work_people person
  where person.organization_id=task.organization_id and person.nifty_member_id=task.raw->>'created_by'
  limit 1
) creator on true
left join lateral (
  select person.id from work_people person
  where person.organization_id=task.organization_id and person.nifty_member_id is not null
    and coalesce(task.raw->'subscribers','[]'::jsonb) ? person.nifty_member_id
  limit 1
) subscriber on true
where task.provider_created_at is not null
on conflict (organization_id,idempotency_key) do nothing;

insert into work_task_day_events (
  organization_id, person_id, task_id, provider, provider_task_id, local_date,
  event_type, provenance, exact_at, observed_at, task_snapshot, metadata, idempotency_key
)
select item.organization_id, item.person_id, item.task_id, task.provider, task.provider_task_id,
  plan.shift_date,
  case when item.disposition='deferred' then 'deferred' else 'surfaced' end,
  'migration_observed', item.created_at, item.created_at,
  jsonb_build_object('title',item.title_snapshot,'completed',task.completed,'status',task.status,'dueDate',task.due_date),
  jsonb_build_object('planId',plan.id,'planItemId',item.id,'source',item.source),
  'plan-item:' || item.id::text || ':' || item.disposition
from work_daily_plan_items item
join work_daily_plans plan on plan.id=item.plan_id
join work_tasks task on task.id=item.task_id
where item.task_id is not null and item.disposition in ('selected','deferred')
on conflict (organization_id,idempotency_key) do nothing;

-- Correct the system-created session that began on Aug 20 but was attached to
-- Aug 21's future schedule. It remains an acknowledged exception session.
update work_daily_plans plan
set shift_date='2026-08-20', updated_at=now()
from work_sessions session
where plan.session_id=session.id
  and session.shift_date='2026-08-21'
  and (session.clocked_in_at at time zone session.timezone)::date='2026-08-20';

update work_sessions
set shift_date='2026-08-20', schedule_id=null, scheduled_starts_at=null,
    scheduled_ends_at=null, exception_acknowledged_at=coalesce(clocked_in_at,created_at),
    exception_reason='Migrated: work began outside the startable Aug 21 schedule window',
    correction_status='corrected', correction_reason='Future schedule was incorrectly attached to prior-day work',
    correction_timestamp=clocked_out_at, correction_provenance='admin_repair', corrected_at=now(), updated_at=now()
where shift_date='2026-08-21'
  and (clocked_in_at at time zone timezone)::date='2026-08-20';

update work_sessions
set correction_status='needs_correction',
    correction_reason='Past session has no explicit employee or provider clock-out timestamp',
    updated_at=now()
where shift_date < current_date and clocked_in_at is not null and clocked_out_at is null;

insert into work_audit_log (organization_id, actor_user_id, action, target_type, target_id, metadata)
select session.organization_id, session.corrected_by, 'session.phase1_reliability_repair', 'work_session', session.id,
  jsonb_build_object('shiftDate',session.shift_date,'correctionStatus',session.correction_status,'reason',session.correction_reason)
from work_sessions session
where session.corrected_at is not null and session.correction_provenance='admin_repair'
  and not exists (
    select 1 from work_audit_log audit where audit.organization_id=session.organization_id
      and audit.action='session.phase1_reliability_repair' and audit.target_id=session.id::text
  );

create unique index if not exists work_sessions_person_day_uidx
  on work_sessions(organization_id,person_id,shift_date);

-- Complete the pilot's organizational configuration without mutating its
-- official schedule or any consent/privacy record.
do $$
declare
  v_org uuid;
  v_david uuid;
  v_owner uuid;
  v_owner_user uuid;
  v_role uuid;
  v_team uuid;
begin
  select organization_id,id into v_org,v_david from work_people
    where lower(email)='david@maigreeks.com' order by active desc,created_at limit 1;
  if v_org is null then return; end if;
  select id into v_owner_user from auth.users where lower(email)='lsperry267@gmail.com' limit 1;
  if v_owner_user is not null then
    select id into v_owner from work_people where organization_id=v_org
      and (auth_user_id=v_owner_user or lower(email)='lsperry267@gmail.com') limit 1;
    if v_owner is null then
      insert into work_people(user_id,organization_id,auth_user_id,display_name,email,active,raw)
      values(v_owner_user,v_org,v_owner_user,'WrazyAI Owner','lsperry267@gmail.com',true,'{}'::jsonb)
      returning id into v_owner;
    end if;
    update work_org_members set person_id=v_owner,active=true,updated_at=now()
      where organization_id=v_org and user_id=v_owner_user;
  end if;
  select id into v_role from work_role_profiles where organization_id=v_org
    and (lower(slug) in ('engineer','engineering','software-engineer') or lower(name)='engineering')
    order by case when lower(slug)='engineer' then 0 else 1 end limit 1;
  if v_role is not null then update work_people set role_profile_id=v_role,updated_at=now() where id=v_david; end if;
  insert into work_teams(organization_id,name,active,created_by)
    values(v_org,'Engineering',true,v_owner_user)
    on conflict(organization_id,name) do update set active=true,updated_at=now()
    returning id into v_team;
  insert into work_team_members(team_id,person_id,is_manager) values(v_team,v_david,false)
    on conflict(team_id,person_id) do update set is_manager=false;
  if v_owner is not null then
    insert into work_team_members(team_id,person_id,is_manager) values(v_team,v_owner,true)
      on conflict(team_id,person_id) do update set is_manager=true;
  end if;
end $$;
