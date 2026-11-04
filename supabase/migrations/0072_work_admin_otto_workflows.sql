-- Bounded plans store references to authorized reads/previews, not team-wide
-- result snapshots. The same actor and organization own every resume.
create table if not exists work_admin_otto_workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  membership_id uuid not null references work_org_members(id) on delete cascade,
  user_id uuid not null,
  request_id uuid not null,
  request_hash text not null,
  thread_id uuid,
  plan jsonb not null,
  progress jsonb not null default '{}'::jsonb,
  abandoned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, membership_id, user_id, request_id)
);
create index if not exists work_admin_otto_workflows_thread_idx
  on work_admin_otto_workflows (organization_id, membership_id, thread_id);

-- New chat fences a pending first request even if its thread does not exist
-- yet. A send commit locks this same row; reset and commit have one ordering.
create table if not exists work_admin_otto_request_fences (
  organization_id uuid not null references work_organizations(id) on delete cascade,
  membership_id uuid not null references work_org_members(id) on delete cascade,
  user_id uuid not null,
  request_id uuid not null,
  abandoned boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, membership_id, user_id, request_id)
);
alter table work_admin_otto_workflows enable row level security;
alter table work_admin_otto_request_fences enable row level security;
revoke all on work_admin_otto_workflows, work_admin_otto_request_fences from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on work_admin_otto_workflows, work_admin_otto_request_fences from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on work_admin_otto_workflows, work_admin_otto_request_fences from authenticated;
  end if;
end $$;
create index if not exists work_admin_otto_workflows_retention_idx
  on work_admin_otto_workflows (created_at);
create index if not exists work_admin_otto_request_fences_retention_idx
  on work_admin_otto_request_fences (created_at);
-- The same 30-day window that bounds chat access also bounds this bookkeeping.
-- Workflows predate their thread FK (owned adds migration), so a discarded
-- thread does not cascade; this cleanup is the storage boundary.
create or replace function work_admin_otto_prune_workflow_bookkeeping() returns void
language sql security definer set search_path = public as $$
  delete from work_admin_otto_workflows where created_at < now() - interval '30 days';
  delete from work_admin_otto_request_fences where created_at < now() - interval '30 days';
$$;
revoke all on function work_admin_otto_prune_workflow_bookkeeping() from public;
