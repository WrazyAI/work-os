-- Activity Interval Reviews: an evidence-backed recap of one progress interval.
--
-- A row is the employee-facing record for one prompt slot (a due follow-up or
-- hourly fallback), not a clock hour: check-in cadence drifts with pauses,
-- manual updates, and configuration. `slot_key` is the deterministic identity
-- `work_session_id:prompt_due_at`, so a retried `ensure` returns the same row
-- and the same interval is never asked twice.
--
-- `generation_status` is operational (preparing/ready/unavailable/failed);
-- `review_status` is provenance (inferred/confirmed/amended). AI inference is
-- never an employee check-in: this table stays separate from work_check_ins and
-- never advances work_sessions.last_substantive_update_at.
--
-- Evidence is a normalized relation so the recap can always show the exact
-- frames that produced it. Snapshots survive the 30-day raw-image retention
-- (the summary text remains; the image columns go null/expired).

create table if not exists work_activity_intervals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  work_session_id uuid references work_sessions(id) on delete set null,
  local_date date not null,
  slot_key text not null,
  prompt_kind text not null check (prompt_kind in ('follow_up', 'hourly_fallback')),
  prompt_due_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  timezone text not null default 'UTC',
  generation_status text not null default 'preparing'
    check (generation_status in ('preparing', 'ready', 'unavailable', 'failed')),
  review_status text not null default 'inferred'
    check (review_status in ('inferred', 'confirmed', 'amended')),
  headline text,
  ai_detail text,
  final_detail text,
  employee_feedback text,
  structured_summary jsonb not null default '{}'::jsonb,
  coverage jsonb not null default '{}'::jsonb,
  source_hash text,
  model text,
  prompt_version text,
  revision integer not null default 1 check (revision >= 1),
  generated_at timestamptz,
  notified_at timestamptz,
  reviewed_at timestamptz,
  evidence_expired_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, person_id, slot_key)
);

create index if not exists work_activity_intervals_person_day_idx
  on work_activity_intervals (organization_id, person_id, local_date);
create index if not exists work_activity_intervals_person_recent_idx
  on work_activity_intervals (organization_id, person_id, window_end desc);

create table if not exists work_activity_interval_evidence (
  id uuid primary key default gen_random_uuid(),
  interval_id uuid not null references work_activity_intervals(id) on delete cascade,
  organization_id uuid not null references work_organizations(id) on delete cascade,
  screenshot_summary_id uuid references work_screenshot_summaries(id) on delete set null,
  evidence_event_id uuid references work_evidence_events(id) on delete set null,
  captured_at timestamptz not null,
  ordinal integer not null check (ordinal >= 0),
  used_in_model boolean not null default true,
  raw_image_shown boolean not null default false,
  selection_reason text,
  -- Sanitized snapshots already written by the neutral per-frame pipeline. They
  -- keep the recap's evidence list truthful after raw images expire and must
  -- never carry raw sensitive content.
  visible_app_snapshot text,
  frame_summary_snapshot text,
  created_at timestamptz not null default now(),
  unique (interval_id, ordinal)
);

create index if not exists work_activity_interval_evidence_interval_idx
  on work_activity_interval_evidence (interval_id);

alter table work_activity_intervals enable row level security;
drop policy if exists "work activity intervals read" on work_activity_intervals;
create policy "work activity intervals read" on work_activity_intervals
  for select using(work_can_access_person(organization_id, person_id));
drop policy if exists "work activity intervals admin manage" on work_activity_intervals;
create policy "work activity intervals admin manage" on work_activity_intervals
  for all using(work_has_org_role(organization_id, array['admin']))
  with check(work_has_org_role(organization_id, array['admin']));

alter table work_activity_interval_evidence enable row level security;
drop policy if exists "work activity interval evidence read" on work_activity_interval_evidence;
create policy "work activity interval evidence read" on work_activity_interval_evidence
  for select using(
    exists (
      select 1 from work_activity_intervals interval
      where interval.id = interval_id
        and work_can_access_person(interval.organization_id, interval.person_id)
    )
  );
drop policy if exists "work activity interval evidence admin manage" on work_activity_interval_evidence;
create policy "work activity interval evidence admin manage" on work_activity_interval_evidence
  for all using(work_has_org_role(organization_id, array['admin']))
  with check(work_has_org_role(organization_id, array['admin']));
