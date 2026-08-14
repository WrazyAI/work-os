-- Phase 1: explicit attendance state, durable daily plans, and observed/inferred provenance.

alter table work_people add column if not exists github_username text;
alter table work_people add column if not exists work_profile jsonb not null default '{}'::jsonb;
alter table work_employee_onboarding add column if not exists work_preferences jsonb not null default '{}'::jsonb;

create table if not exists work_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  schedule_id uuid references work_schedules(id) on delete set null,
  shift_date date not null,
  state text not null default 'scheduled' check(state in ('scheduled','clocked_in','active','paused','eod_due','clocked_out')),
  timezone text not null,
  scheduled_starts_at timestamptz not null,
  scheduled_ends_at timestamptz not null,
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  paused_at timestamptz,
  paused_seconds integer not null default 0 check(paused_seconds >= 0),
  source text not null default 'desktop' check(source in ('web','desktop','agent','system')),
  clock_in_idempotency_key text,
  clock_out_idempotency_key text,
  late_acknowledged_at timestamptz,
  extended_acknowledged_at timestamptz,
  snoozed_until timestamptz,
  last_substantive_update_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(scheduled_ends_at > scheduled_starts_at),
  check(clocked_out_at is null or clocked_in_at is not null)
);
create index if not exists work_sessions_person_date_idx on work_sessions(organization_id,person_id,shift_date desc);
create unique index if not exists work_sessions_active_person_uidx on work_sessions(organization_id,person_id)
  where state in ('clocked_in','active','paused','eod_due');
create unique index if not exists work_sessions_clock_in_idempotency_uidx on work_sessions(organization_id,person_id,clock_in_idempotency_key)
  where clock_in_idempotency_key is not null;

create table if not exists work_daily_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  session_id uuid not null references work_sessions(id) on delete cascade,
  shift_date date not null,
  status text not null default 'draft' check(status in ('draft','confirmed','closed')),
  freeform_intent text,
  confirmation_idempotency_key text,
  confirmed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,session_id),
  unique(organization_id,person_id,confirmation_idempotency_key)
);
create index if not exists work_daily_plans_person_date_idx on work_daily_plans(organization_id,person_id,shift_date desc);

create table if not exists work_daily_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  plan_id uuid not null references work_daily_plans(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  task_id uuid references work_tasks(id) on delete set null,
  source text not null check(source in ('carry_over','overdue','due_today','existing','unplanned')),
  disposition text not null default 'selected' check(disposition in ('selected','deferred','removal_proposed')),
  rank integer not null default 0 check(rank >= 0),
  title_snapshot text not null,
  blocker text,
  dependency_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_daily_plan_items_plan_rank_idx on work_daily_plan_items(plan_id,rank);
create unique index if not exists work_daily_plan_items_task_uidx on work_daily_plan_items(plan_id,task_id) where task_id is not null;

create table if not exists work_session_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  session_id uuid not null references work_sessions(id) on delete cascade,
  event_type text not null,
  from_state text,
  to_state text,
  source text not null default 'desktop',
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_user_id uuid references auth.users(id) on delete set null,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  unique(organization_id,idempotency_key)
);
create index if not exists work_session_events_session_idx on work_session_events(session_id,observed_at);

alter table work_check_ins add column if not exists session_id uuid references work_sessions(id) on delete set null;
alter table work_check_ins add column if not exists update_kind text
  check(update_kind is null or update_kind in ('starting','continuing','material_progress','completion_claim','blocked','priority_change','unplanned_work'));
alter table work_check_ins add column if not exists structured_claims jsonb not null default '{}'::jsonb;
alter table work_check_ins add column if not exists inference_metadata jsonb not null default '{}'::jsonb;

alter table work_sessions enable row level security;
alter table work_daily_plans enable row level security;
alter table work_daily_plan_items enable row level security;
alter table work_session_events enable row level security;

do $$ declare t text; begin foreach t in array array['work_sessions','work_daily_plans','work_daily_plan_items','work_session_events'] loop
  execute format('drop policy if exists %I on %I',t||' person read',t);
  execute format('create policy %I on %I for select using(work_can_access_person(organization_id,person_id))',t||' person read',t);
  execute format('drop policy if exists %I on %I',t||' admin manage',t);
  execute format('create policy %I on %I for all using(work_has_org_role(organization_id,array[''admin''])) with check(work_has_org_role(organization_id,array[''admin'']))',t||' admin manage',t);
end loop; end $$;
