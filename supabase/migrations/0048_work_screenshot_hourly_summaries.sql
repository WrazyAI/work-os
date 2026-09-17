-- Hourly activity rollups: EOD drafts and the review panel show one
-- synthesized line per hour instead of one line per screenshot frame.
--
-- A row is derived state, never evidence: frame_count and source_hash let the
-- service detect that an hour's frames changed and re-summarize just that
-- hour. source_hash covers the frame ids and their summary text in the hour,
-- so edits, new frames, and removals all invalidate the cached line.

create table if not exists work_screenshot_hourly_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  local_date date not null,
  hour_start smallint not null check (hour_start between 0 and 23),
  summary text not null,
  frame_count integer not null default 0 check (frame_count >= 0),
  source_hash text not null,
  model text,
  prompt_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, person_id, local_date, hour_start)
);

create index if not exists work_screenshot_hourly_person_idx
  on work_screenshot_hourly_summaries (organization_id, person_id, local_date);

alter table work_screenshot_hourly_summaries enable row level security;
drop policy if exists "work screenshot hourly read" on work_screenshot_hourly_summaries;
create policy "work screenshot hourly read" on work_screenshot_hourly_summaries
  for select using(work_can_access_person(organization_id, person_id));
drop policy if exists "work screenshot hourly admin manage" on work_screenshot_hourly_summaries;
create policy "work screenshot hourly admin manage" on work_screenshot_hourly_summaries
  for all using(work_has_org_role(organization_id, array['admin']))
  with check(work_has_org_role(organization_id, array['admin']));
