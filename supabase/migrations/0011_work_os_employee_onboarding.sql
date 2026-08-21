-- 0011: Employee onboarding confirmation and purpose-limited tracking consent.

create table if not exists work_employee_onboarding (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  preferred_name text,
  confirmed_email text,
  timezone text,
  language text,
  schedule_proposal jsonb not null default '{}'::jsonb,
  notification_preferences jsonb not null default '{}'::jsonb,
  privacy_preferences jsonb not null default '{}'::jsonb,
  profile_confirmed_at timestamptz,
  employee_submitted_at timestamptz,
  status text not null default 'not_started' check(status in ('not_started','in_progress','submitted','confirmed','changes_requested')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,person_id)
);
create index if not exists work_employee_onboarding_person_idx on work_employee_onboarding(organization_id,person_id);

create table if not exists work_consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  policy_version text not null,
  purpose text not null,
  data_categories text[] not null default '{}'::text[],
  decision text not null check(decision in ('accepted','withdrawn')),
  created_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists work_consent_records_person_idx on work_consent_records(organization_id,person_id,occurred_at desc);

alter table work_employee_onboarding enable row level security;
alter table work_consent_records enable row level security;

drop policy if exists "work employee onboarding person read" on work_employee_onboarding;
create policy "work employee onboarding person read" on work_employee_onboarding for select using(
  work_can_access_person(organization_id,person_id)
);
drop policy if exists "work employee onboarding admin manage" on work_employee_onboarding;
create policy "work employee onboarding admin manage" on work_employee_onboarding for all using(
  work_has_org_role(organization_id,array['admin'])
) with check(work_has_org_role(organization_id,array['admin']));

drop policy if exists "work consent records person read" on work_consent_records;
create policy "work consent records person read" on work_consent_records for select using(
  work_can_access_person(organization_id,person_id)
);
drop policy if exists "work consent records admin manage" on work_consent_records;
create policy "work consent records admin manage" on work_consent_records for all using(
  work_has_org_role(organization_id,array['admin'])
) with check(work_has_org_role(organization_id,array['admin']));
