-- Provider attendance is a separately persisted observation. Employee-facing
-- reads consume this ledger and never wait for a Worktivity network request.
create table if not exists work_attendance_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  provider text not null check (provider in ('worktivity')),
  local_date date not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null,
  state text not null check (state in ('active', 'paused', 'off_shift', 'unknown')),
  clocked_in_at timestamptz,
  clocked_out_at timestamptz,
  activity_observed_at timestamptz,
  provider_break_seconds integer not null default 0 check (provider_break_seconds >= 0),
  raw jsonb not null default '{}'::jsonb,
  unique (organization_id, person_id, provider, observed_at)
);

create index if not exists work_attendance_observations_latest_idx
  on work_attendance_observations(organization_id, person_id, local_date, observed_at desc);

alter table work_attendance_observations enable row level security;
drop policy if exists "work attendance observations read" on work_attendance_observations;
create policy "work attendance observations read" on work_attendance_observations
  for select using(work_can_access_person(organization_id, person_id));
drop policy if exists "work attendance observations admin manage" on work_attendance_observations;
create policy "work attendance observations admin manage" on work_attendance_observations
  for all using(work_has_org_role(organization_id, array['admin']))
  with check(work_has_org_role(organization_id, array['admin']));
