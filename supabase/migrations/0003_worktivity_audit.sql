-- 0003: Worktivity audit — Layer 1 (metadata summary).
-- Two tables, both per-user via RLS (the runner uses the service role to bypass):
--   audit_profiles : the one-time per-employee "Audit Profile" (the rubric). Captured
--                    via a structured form the first time a worker is audited, reused
--                    + editable after. Keyed by the Worktivity Employee.ID.
--   audit_runs     : one row per audit. Holds the finished summary + the metadata
--                    rollup (stats) and links to a `runs` row for the live stream.
-- Idempotent so it can be re-applied safely.

-- ── Audit profiles (the rubric) ──────────────────────────────────────────────
create table if not exists audit_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  employee_id   text not null,              -- Worktivity Employee.ID (== ActivityLogs[].EmployeeId)
  employee_name text,
  role          text,                       -- e.g. "Brand Designer"
  work_apps     text,                       -- apps/sites that count as real work
  legit_lookalikes text,                    -- looks like slacking but is legit for this role
  off_limits    text,                       -- explicitly not-work
  schedule      text,                       -- expected schedule / weekly hours
  context       text,                       -- free-text: anything unusual
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, employee_id)             -- one profile per worker per owner
);
create index if not exists audit_profiles_user_idx on audit_profiles (user_id, employee_id);

alter table audit_profiles enable row level security;
drop policy if exists "audit_profiles select own" on audit_profiles;
create policy "audit_profiles select own" on audit_profiles for select using (user_id = auth.uid());
drop policy if exists "audit_profiles insert own" on audit_profiles;
create policy "audit_profiles insert own" on audit_profiles for insert with check (user_id = auth.uid());
drop policy if exists "audit_profiles update own" on audit_profiles;
create policy "audit_profiles update own" on audit_profiles for update using (user_id = auth.uid());
drop policy if exists "audit_profiles delete own" on audit_profiles;
create policy "audit_profiles delete own" on audit_profiles for delete using (user_id = auth.uid());

-- ── Audit runs (one per report) ──────────────────────────────────────────────
create table if not exists audit_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  employee_id   text not null,
  employee_name text,
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'queued' check (status in ('queued','running','done','failed')),
  run_id        uuid,                        -- → runs.id, for the live event stream (useRunStream)
  model         text,                        -- e.g. gpt-5.4-mini
  summary       text,                        -- the final narrative (kept as the payroll record)
  stats         jsonb,                       -- the metadata rollup (WorktivityRollup)
  -- Layer 2 retention: cached screenshot evidence is purged after this instant.
  -- Null in Layer 1 (metadata-only keeps nothing to purge).
  screenshots_purge_after timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists audit_runs_user_idx on audit_runs (user_id, created_at desc);
create index if not exists audit_runs_employee_idx on audit_runs (user_id, employee_id, created_at desc);
create index if not exists audit_runs_purge_idx on audit_runs (screenshots_purge_after)
  where screenshots_purge_after is not null;

alter table audit_runs enable row level security;
drop policy if exists "audit_runs select own" on audit_runs;
create policy "audit_runs select own" on audit_runs for select using (user_id = auth.uid());
drop policy if exists "audit_runs insert own" on audit_runs;
create policy "audit_runs insert own" on audit_runs for insert with check (user_id = auth.uid());
drop policy if exists "audit_runs update own" on audit_runs;
create policy "audit_runs update own" on audit_runs for update using (user_id = auth.uid());

-- Realtime so the audit page sees status flip done/failed live.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='audit_runs') then
    alter publication supabase_realtime add table audit_runs;
  end if;
end $$;
