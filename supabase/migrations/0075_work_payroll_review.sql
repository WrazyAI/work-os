-- Additive, server-only payroll records. No employee recap or provider writes.
-- The migration principal needs CREATEROLE, solely to install the NOLOGIN
-- retention executor. It must NOT be a browser role. Runtime roles must never
-- be members of work_payroll_retention. All deployment remains opt-in.
begin;
create unique index if not exists work_people_org_id_key on work_people(organization_id,id);
create unique index if not exists work_payroll_screenshot_scope_key on work_screenshot_summaries(organization_id,person_id,id);
create unique index if not exists work_payroll_evidence_scope_key on work_evidence_events(organization_id,person_id,id);

create table if not exists work_payroll_settings (
  organization_id uuid primary key references work_organizations(id),
  enabled boolean not null default false,
  auto_approve_enabled boolean not null default false,
  cutoff_hour smallint not null default 6 check(cutoff_hour between 0 and 23),
  provider_ready boolean not null default false,
  models_ready boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists work_payroll_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id),
  person_id uuid not null,
  period_start date not null, period_end date not null, pay_date date not null,
  timezone text not null check(length(trim(timezone))>0),
  status text not null default 'draft' check(status in ('draft','analyzing','ready','needs_review','approved','reopened','failed','stale')),
  analysis_revision int not null default 0 check(analysis_revision>=0),
  row_version bigint not null default 0 check(row_version>=0),
  source_hash text not null default '', model text, prompt_version text,
  totals jsonb not null default '{}', current_approval_id uuid,
  approved_minutes int check(approved_minutes>=0), approved_by uuid, approved_at timestamptz, approval_note text,
  evidence_changed_since_approval boolean not null default false,
  retention_expires_at timestamptz not null,
  first_export_at timestamptz, last_exported_at timestamptz, last_analyzed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(organization_id,person_id) references work_people(organization_id,id),
  unique(organization_id,person_id,pay_date), unique(organization_id,id,person_id),
  check(extract(year from pay_date)>=1 and extract(day from pay_date) in (1,16)),
  check(period_start = case when extract(day from pay_date)=16 then date_trunc('month',pay_date)::date else (date_trunc('month',pay_date)-interval '1 month'+interval '15 days')::date end),
  check(period_end = pay_date-1)
);
create index if not exists work_payroll_reviews_roster_idx on work_payroll_reviews(organization_id,pay_date,status);
create index if not exists work_payroll_reviews_expiry_idx on work_payroll_reviews(retention_expires_at);

create table if not exists work_payroll_analysis_revisions (
  organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  analysis_revision int not null check(analysis_revision>=1),
  source_hash text not null, policy_version text not null, as_of timestamptz not null,
  source_token text not null default '', input_manifest jsonb not null, citation_snapshot jsonb not null,
  provider_watermark text, provider_verified_at timestamptz, resolved_policy jsonb not null default '{}',
  rounding_version text not null default 'largest-remainder-v1',
  created_at timestamptz not null default now(),
  primary key(organization_id,review_id,person_id,analysis_revision),
  foreign key(organization_id,review_id,person_id) references work_payroll_reviews(organization_id,id,person_id)
);
create table if not exists work_payroll_days (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  analysis_revision int not null, local_date date not null, week smallint not null check(week in (1,2)),
  session_ids jsonb not null default '[]', schedule_snapshot jsonb not null default '{}',
  status text not null default 'calculated' check(status in ('calculated','needs_review','resolved','no_schedule','no_session','no_work','leave')),
  recorded_ms bigint not null default 0 check(recorded_ms>=0), eligible_ms bigint not null default 0 check(eligible_ms>=0),
  exact_ms jsonb not null default '{}', partition jsonb not null default '[]', rounding_version text not null default 'largest-remainder-v1',
  tracked_minutes int not null default 0 check(tracked_minutes>=0), break_minutes int not null default 0 check(break_minutes>=0),
  inactivity_minutes int not null default 0 check(inactivity_minutes>=0), outside_minutes int not null default 0 check(outside_minutes>=0),
  held_minutes int not null default 0 check(held_minutes>=0), recommended_minutes int not null default 0 check(recommended_minutes>=0),
  manual_excluded_minutes int not null default 0 check(manual_excluded_minutes>=0), approved_minutes int not null default 0 check(approved_minutes>=0),
  activity_summary jsonb not null default '{}', findings_summary jsonb not null default '{}', source_hash text not null,
  original_result jsonb not null default '{}', result jsonb not null default '{}',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(eligible_ms<=recorded_ms),
  foreign key(organization_id,review_id,person_id,analysis_revision) references work_payroll_analysis_revisions,
  unique(organization_id,review_id,analysis_revision,local_date),
  unique(organization_id,review_id,person_id,analysis_revision,id)
);
create index if not exists work_payroll_days_person_idx on work_payroll_days(organization_id,person_id,local_date);
create table if not exists work_payroll_findings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  analysis_revision int not null, day_id uuid not null, finding_key text not null,
  kind text not null check(kind in ('inactivity','break','outside_window','unverified_gap','low_evidence','activity_during_break','break_mismatch','possible_work','manual_adjustment','no_work','no_schedule','no_session','timezone_changed','source_conflict')),
  status text not null check(status in ('auto_payable','auto_excluded','needs_review','needs_correction','acknowledged','resolved_payable','resolved_excluded')),
  effect text not null check(effect in ('exclude','payable','hold','acknowledge','include_adjustment','exclude_adjustment')),
  blocks_approval boolean not null default true,
  required_action text not null check(required_action in ('decide','acknowledge','correct','none')),
  start_at timestamptz, end_at timestamptz, duration_ms bigint not null default 0 check(duration_ms>=0),
  minutes int not null default 0 check(minutes>=0), reason text not null, evidence jsonb not null default '{}',
  citations jsonb not null default '[]', source_hash text not null,
  resolution_note text, resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((start_at is null and end_at is null) or (start_at is not null and end_at is not null and end_at>start_at)),
  foreign key(organization_id,review_id,person_id,analysis_revision,day_id) references work_payroll_days(organization_id,review_id,person_id,analysis_revision,id),
  unique(organization_id,review_id,person_id,analysis_revision,finding_key),
  unique(organization_id,review_id,person_id,analysis_revision,finding_key,source_hash)
);
create index if not exists work_payroll_findings_status_idx on work_payroll_findings(organization_id,review_id,status);
create index if not exists work_payroll_findings_day_idx on work_payroll_findings(day_id);
create table if not exists work_payroll_decisions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  analysis_revision int not null, finding_key text not null, source_hash text not null,
  decision text not null check(decision in ('payable','excluded','acknowledged','corrected','adjusted')),
  before_state jsonb not null default '{}', after_state jsonb not null default '{}',
  reason text not null check(length(trim(reason))>0), actor_user_id uuid not null,
  expected_row_version bigint not null check(expected_row_version>=0), prior_decision_id uuid,
  idempotency_key text not null, created_at timestamptz not null default now(),
  foreign key(organization_id,review_id,person_id,analysis_revision,finding_key,source_hash) references work_payroll_findings(organization_id,review_id,person_id,analysis_revision,finding_key,source_hash),
  unique(organization_id,idempotency_key), unique(organization_id,review_id,person_id,id),
  foreign key(organization_id,review_id,person_id,prior_decision_id) references work_payroll_decisions(organization_id,review_id,person_id,id)
);
create table if not exists work_payroll_approvals (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  analysis_revision int not null, revision int not null check(revision>=1), snapshot jsonb not null,
  approved_minutes int not null check(approved_minutes>=0), approved_by uuid not null, approved_at timestamptz not null default now(), note text,
  prior_approval_id uuid, snapshot_hash text not null, export_schema_version text not null, request_key text not null,
  created_at timestamptz not null default now(),
  foreign key(organization_id,review_id,person_id,analysis_revision) references work_payroll_analysis_revisions,
  unique(organization_id,review_id,revision), unique(organization_id,request_key), unique(organization_id,review_id,person_id,id),
  foreign key(organization_id,review_id,person_id,prior_approval_id) references work_payroll_approvals(organization_id,review_id,person_id,id)
);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='work_payroll_reviews_current_approval_fk') then
    alter table work_payroll_reviews add constraint work_payroll_reviews_current_approval_fk
      foreign key(organization_id,id,person_id,current_approval_id) references work_payroll_approvals(organization_id,review_id,person_id,id) deferrable initially deferred;
  end if;
end $$;
create table if not exists work_payroll_frame_findings (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  analysis_revision int not null, day_id uuid not null, screenshot_summary_id uuid not null, evidence_event_id uuid not null,
  captured_at timestamptz not null, app text, activity_level int,
  category text not null check(category in ('work','meeting','training','reading','idle','nonwork','unclear')),
  confidence numeric not null check(confidence between 0 and 1), reason text not null,
  model text not null, prompt_version text not null, rubric_hash text not null, classification_key text not null,
  source_hash text not null, policy_hash text not null, created_at timestamptz not null default now(),
  foreign key(organization_id,review_id,person_id,analysis_revision,day_id) references work_payroll_days(organization_id,review_id,person_id,analysis_revision,id),
  foreign key(organization_id,person_id,screenshot_summary_id) references work_screenshot_summaries(organization_id,person_id,id) on delete cascade,
  foreign key(organization_id,person_id,evidence_event_id) references work_evidence_events(organization_id,person_id,id) on delete cascade,
  unique(organization_id,person_id,screenshot_summary_id,classification_key)
);
create table if not exists work_payroll_week_briefs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  analysis_revision int not null, week smallint not null check(week in (1,2)), period_start date not null, period_end date not null check(period_end>=period_start),
  status text not null default 'missing' check(status in ('missing','generating','ready','failed','stale')),
  title text not null default '', summary_markdown text not null default '', summary_citations jsonb not null default '[]',
  themes jsonb not null default '[]', open_items jsonb not null default '[]', gaps jsonb not null default '[]',
  source_interval_ids jsonb not null default '[]', sources jsonb not null default '{}', source_hash text not null,
  model text, prompt_version text, error text, generated_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(organization_id,review_id,person_id,analysis_revision) references work_payroll_analysis_revisions,
  unique(organization_id,review_id,analysis_revision,week)
);
create table if not exists work_payroll_questions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  actor_user_id uuid not null, thread_id uuid not null, analysis_revision int not null, approval_id uuid,
  request_key text not null, status text not null default 'pending' check(status in ('pending','ready','failed')),
  source_hash text not null, question text not null, answer text, citations jsonb not null default '[]',
  blocks jsonb not null default '[]', limitations jsonb not null default '[]', model text, error text,
  created_at timestamptz not null default now(),
  foreign key(organization_id,review_id,person_id,analysis_revision) references work_payroll_analysis_revisions,
  foreign key(organization_id,review_id,person_id,approval_id) references work_payroll_approvals(organization_id,review_id,person_id,id),
  unique(organization_id,actor_user_id,request_key)
);
create table if not exists work_payroll_person_context (
  organization_id uuid not null, person_id uuid not null, context text not null default '', revision int not null default 1 check(revision>=1),
  retention_expires_at timestamptz not null, updated_by uuid not null, updated_at timestamptz not null default now(),
  primary key(organization_id,person_id), foreign key(organization_id,person_id) references work_people(organization_id,id)
);
create table if not exists work_payroll_runs (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  status text not null default 'queued' check(status in ('queued','running','done','failed','canceled')),
  phase text not null default 'recaps' check(phase in ('recaps','activity','evidence','classify','days','briefs','done')),
  cursor jsonb not null default '{}', progress jsonb not null default '{}', lease_token text, lease_until timestamptz,
  attempt int not null default 0 check(attempt>=0), error text, model text, prompt_version text, source_hash text not null default '',
  target_revision int not null check(target_revision>=1), as_of timestamptz not null default now(), input_manifest jsonb not null default '{}',
  input_artifact jsonb not null default '{}', fetch_cursor jsonb not null default '{}', next_attempt_at timestamptz,
  resolved_policy jsonb not null default '{}', request_key text not null, cancel_requested_at timestamptz,
  started_at timestamptz, finished_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check((lease_token is null)=(lease_until is null)),
  foreign key(organization_id,review_id,person_id) references work_payroll_reviews(organization_id,id,person_id),
  unique(organization_id,review_id,request_key)
);
create unique index if not exists work_payroll_runs_active_idx on work_payroll_runs(organization_id,review_id) where status in ('queued','running');
create index if not exists work_payroll_runs_due_idx on work_payroll_runs(status,next_attempt_at,lease_until);
create table if not exists work_payroll_exports (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  approval_id uuid not null, kind text not null check(kind in ('csv','print')), schema_version text not null,
  snapshot_hash text not null, payload bytea not null, payload_hash text not null, actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key(organization_id,review_id,person_id,approval_id) references work_payroll_approvals(organization_id,review_id,person_id,id),
  unique(organization_id,approval_id,kind,schema_version)
);
create table if not exists work_payroll_recap_settlements (
  organization_id uuid not null, person_id uuid not null, pay_date date not null check(extract(day from pay_date) in (1,16)),
  cutoff_at timestamptz not null, cursor jsonb not null default '{}', status text not null default 'pending' check(status in ('pending','running','done','failed')),
  lease_token text, lease_until timestamptz, retention_expires_at timestamptz not null,
  updated_at timestamptz not null default now(), primary key(organization_id,person_id,pay_date),
  foreign key(organization_id,person_id) references work_people(organization_id,id),
  check((lease_token is null)=(lease_until is null))
);
create unique index if not exists work_provider_connections_org_id_key on work_provider_connections(organization_id,id);
create table if not exists work_payroll_provider_budgets (
  organization_id uuid not null references work_organizations(id), connection_id uuid not null,
  next_available_at timestamptz not null default now(),
  minute_window timestamptz, minute_count int not null default 0 check(minute_count>=0),
  hour_window timestamptz, hour_count int not null default 0 check(hour_count>=0),
  updated_at timestamptz not null default now(),
  primary key(organization_id,connection_id),
  foreign key(organization_id,connection_id) references work_provider_connections(organization_id,id)
);
-- Conservative payroll sub-budget: provider allows 5/sec,100/min,1000/hour;
-- payroll reserves 4/sec spacing with 80/min and 800/hour so neighboring
-- attendance/screenshot reads retain headroom. All process instances serialize
-- on this row, which a per-run sleep cannot do.
create or replace function work_payroll_reserve_provider_slot(p_organization_id uuid,p_connection_id uuid)
returns integer language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare slot timestamptz; minute_start timestamptz; hour_start timestamptz;
  next_minute int; next_hour int; bucket public.work_payroll_provider_budgets%rowtype;
begin
  insert into public.work_payroll_provider_budgets(organization_id,connection_id,next_available_at)
    values(p_organization_id,p_connection_id,clock_timestamp()) on conflict do nothing;
  select * into bucket from public.work_payroll_provider_budgets
    where organization_id=p_organization_id and connection_id=p_connection_id for update;
  if not found then raise exception 'Provider budget not found'; end if;
  slot := greatest(clock_timestamp(),bucket.next_available_at);
  minute_start := date_trunc('minute',slot); hour_start := date_trunc('hour',slot);
  next_minute := case when bucket.minute_window is not distinct from minute_start then bucket.minute_count else 0 end;
  next_hour := case when bucket.hour_window is not distinct from hour_start then bucket.hour_count else 0 end;
  if next_minute>=80 then
    slot := greatest(slot,minute_start+interval '1 minute');
    minute_start:=date_trunc('minute',slot); hour_start:=date_trunc('hour',slot);
    next_minute:=0; next_hour:=case when bucket.hour_window is not distinct from hour_start then bucket.hour_count else 0 end;
  end if;
  if next_hour>=800 then
    slot := greatest(slot,hour_start+interval '1 hour');
    minute_start:=date_trunc('minute',slot); hour_start:=date_trunc('hour',slot); next_minute:=0; next_hour:=0;
  end if;
  update public.work_payroll_provider_budgets set next_available_at=slot+interval '250 milliseconds',
    minute_window=minute_start,minute_count=next_minute+1,hour_window=hour_start,hour_count=next_hour+1,
    updated_at=clock_timestamp()
    where organization_id=p_organization_id and connection_id=p_connection_id;
  return greatest(0,ceil(extract(epoch from slot-clock_timestamp())*1000))::int;
end $$;
revoke all on function work_payroll_reserve_provider_slot(uuid,uuid) from public;
create table if not exists work_payroll_audit_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  actor_user_id uuid, action text not null, request_key text not null, metadata jsonb not null default '{}', created_at timestamptz not null default now(),
  foreign key(organization_id,review_id,person_id) references work_payroll_reviews(organization_id,id,person_id),
  unique(organization_id,request_key)
);
-- Operator-only configuration: no API accepts this table's contents from a
-- browser. A documented hold must be explicitly released before normal purge.
create table if not exists work_payroll_operator_holds (
  organization_id uuid not null, review_id uuid not null, person_id uuid not null,
  reason text not null check(length(trim(reason))>0), operator_reference text not null check(length(trim(operator_reference))>0),
  created_at timestamptz not null default now(), released_at timestamptz,
  primary key(organization_id,review_id,person_id),
  foreign key(organization_id,review_id,person_id) references work_payroll_reviews(organization_id,id,person_id)
);

-- A NOLOGIN function owner, NOT an application-controlled override setting.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='work_payroll_retention') then
    create role work_payroll_retention nologin noinherit;
  end if;
  execute format('grant work_payroll_retention to %I',current_user);
end $$;
create or replace function work_payroll_immutable() returns trigger language plpgsql set search_path=pg_catalog,public,pg_temp as $$
begin
  if tg_op='DELETE' and current_user='work_payroll_retention' then return old; end if;
  raise exception 'Payroll records are immutable';
end $$;
create or replace function work_payroll_parent_delete_guard() returns trigger language plpgsql as $$
begin
  if current_user<>'work_payroll_retention' then raise exception 'Payroll deletion requires retention maintenance'; end if;
  return old;
end $$;
drop trigger if exists work_payroll_parent_delete_guard on work_payroll_reviews;
create trigger work_payroll_parent_delete_guard before delete on work_payroll_reviews for each row execute function work_payroll_parent_delete_guard();
do $$ declare t text; begin
  foreach t in array array['work_payroll_approvals','work_payroll_decisions','work_payroll_analysis_revisions','work_payroll_exports','work_payroll_audit_events'] loop
    execute format('drop trigger if exists work_payroll_immutable on %I',t);
    execute format('create trigger work_payroll_immutable before update or delete on %I for each row execute function work_payroll_immutable()',t);
  end loop;
  foreach t in array array['work_payroll_settings','work_payroll_reviews','work_payroll_analysis_revisions','work_payroll_days','work_payroll_findings','work_payroll_decisions','work_payroll_approvals','work_payroll_frame_findings','work_payroll_week_briefs','work_payroll_questions','work_payroll_person_context','work_payroll_runs','work_payroll_exports','work_payroll_recap_settlements','work_payroll_provider_budgets','work_payroll_audit_events','work_payroll_operator_holds'] loop
    execute format('alter table %I enable row level security',t);
    execute format('revoke all on %I from public',t);
    if exists(select 1 from pg_roles where rolname='anon') then execute format('revoke all on %I from anon',t); end if;
    if exists(select 1 from pg_roles where rolname='authenticated') then execute format('revoke all on %I from authenticated',t); end if;
    execute format('grant select,update,delete on %I to work_payroll_retention',t);
    execute format('drop policy if exists work_payroll_retention_policy on %I',t);
    execute format('create policy work_payroll_retention_policy on %I to work_payroll_retention using(true) with check(true)',t);
  end loop;
end $$;
create or replace function work_payroll_purge_expired(p_organization_id uuid,p_review_id uuid) returns void
language plpgsql security definer set search_path=pg_catalog,public,pg_temp as $$
declare r public.work_payroll_reviews%rowtype;
begin
  select * into r from public.work_payroll_reviews where organization_id=p_organization_id and id=p_review_id for update;
  if not found then raise exception 'Payroll review not found'; end if;
  if r.retention_expires_at>clock_timestamp() then raise exception 'Payroll review not expired'; end if;
  if exists(select 1 from public.work_payroll_operator_holds where organization_id=r.organization_id and review_id=r.id and released_at is null) then
    raise exception 'Payroll review has a documented legal hold';
  end if;
  -- Lock parent then fence all worker leases before deleting sensitive copies.
  update public.work_payroll_runs set status='canceled',lease_token=null,lease_until=null where organization_id=r.organization_id and review_id=r.id;
  update public.work_payroll_reviews set current_approval_id=null where id=r.id;
  delete from public.work_payroll_questions where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_exports where organization_id=r.organization_id and review_id=r.id;
  -- Self-referential histories are removed together, never one version at a time.
  delete from public.work_payroll_approvals where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_decisions where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_frame_findings where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_findings where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_days where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_week_briefs where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_analysis_revisions where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_runs where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_audit_events where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_operator_holds where organization_id=r.organization_id and review_id=r.id;
  delete from public.work_payroll_reviews where organization_id=r.organization_id and id=r.id;
end $$;
revoke all on function work_payroll_purge_expired(uuid,uuid) from public;
revoke all on function work_payroll_immutable(), work_payroll_parent_delete_guard() from public;
-- Temporary schema CREATE is needed to transfer function ownership, not left
-- available to the maintenance principal after installation.
grant usage,create on schema public to work_payroll_retention;
do $$ begin
  execute format('grant execute on function work_payroll_purge_expired(uuid,uuid) to %I',current_user);
end $$;
alter function work_payroll_purge_expired(uuid,uuid) owner to work_payroll_retention;
revoke create on schema public from work_payroll_retention;
do $$ begin execute format('revoke work_payroll_retention from %I',current_user); end $$;
commit;
