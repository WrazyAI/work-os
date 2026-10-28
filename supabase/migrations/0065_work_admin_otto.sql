-- Reviewed recap events only. Generation/inference never writes this ledger.
-- No backfill: old reviewed intervals are snapshotted on explicit read, with
-- arrival_eligible=false. Later inbox materializers MUST filter that column.
create unique index if not exists work_people_org_id_key
  on work_people (organization_id, id);
create unique index if not exists work_activity_intervals_org_person_id_key
  on work_activity_intervals (organization_id, person_id, id);

-- Every review/preferences/lifecycle writer must lock this row BEFORE other
-- rows, and hold it through COMMIT. A sequence/BIGSERIAL is not commit order.
create table if not exists work_admin_otto_clock (
  organization_id uuid primary key references work_organizations(id) on delete cascade,
  sequence bigint not null default 0 check (sequence >= 0)
);

create table if not exists work_recap_reviews (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id) on delete cascade,
  interval_id uuid not null,
  person_id uuid not null,
  version integer not null check (version >= 1),
  event_sequence bigint not null check (event_sequence >= 1),
  review_key text not null,
  source_revision integer not null check (source_revision >= 1),
  content_hash text not null,
  script_hash text not null,
  payload jsonb not null,
  reviewed_at timestamptz not null,
  arrival_eligible boolean not null,
  foreign key (organization_id, person_id) references work_people(organization_id, id) on delete cascade,
  foreign key (organization_id, person_id, interval_id) references work_activity_intervals(organization_id, person_id, id) on delete cascade,
  unique (organization_id, interval_id, version),
  unique (organization_id, event_sequence)
);
-- No content-hash uniqueness: A -> B -> A is three immutable versions.
create index if not exists work_recap_reviews_interval_version_idx
  on work_recap_reviews (organization_id, interval_id, version desc);
-- The unique organization/event_sequence index also serves ordered feed scans.
-- Composite target for organization-scoped delivery references.
create unique index if not exists work_recap_reviews_org_id_key
  on work_recap_reviews (organization_id, id);

create or replace function work_recap_reviews_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'Reviewed recap versions are immutable';
end;
$$;
drop trigger if exists work_recap_reviews_immutable on work_recap_reviews;
-- Versions are immutable by UPDATE. DELETE intentionally follows the
-- interval/person/organization cascades above so retention cleanup can remove
-- the owner; deleting a version directly stays an explicit operator action,
-- never a rewrite path.
create trigger work_recap_reviews_immutable before update on work_recap_reviews
  for each row execute function work_recap_reviews_immutable();

-- Server database role only. There are deliberately no client RLS policies.
alter table work_admin_otto_clock enable row level security;
alter table work_recap_reviews enable row level security;
revoke all on work_admin_otto_clock, work_recap_reviews from public;
revoke all on function work_recap_reviews_immutable() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on work_admin_otto_clock, work_recap_reviews from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on work_admin_otto_clock, work_recap_reviews from authenticated;
  end if;
end;
$$;

-- Per-admin following. `active` means this membership currently holds Otto
-- access and has completed an explicit POST-context activation. Losing admin
-- role, active membership or the effective employee_companion feature clears
-- it; restoring access waits for the next explicit POST context, which opens a
-- fresh access epoch without replaying the disabled period.
create unique index if not exists work_org_members_org_id_key
  on work_org_members (organization_id, id);

create table if not exists work_admin_otto_preferences (
  organization_id uuid not null references work_organizations(id) on delete cascade,
  membership_id uuid not null,
  mode text not null default 'all' check (mode in ('all', 'selected')),
  selected_person_ids uuid[] not null default '{}'::uuid[],
  revision integer not null default 0 check (revision >= 0),
  access_epoch integer not null default 0 check (access_epoch >= 0),
  activated_sequence bigint check (activated_sequence is null or activated_sequence >= 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, membership_id),
  constraint work_admin_otto_preferences_activation
    check (not active or (activated_sequence is not null and activated_sequence >= 1 and access_epoch >= 1)),
  foreign key (organization_id, membership_id)
    references work_org_members (organization_id, id) on delete cascade
);

-- One row per followed person per admin per access epoch. Rows are closed
-- (never deleted) so a later materializer can judge an event against the
-- window effective at that event's commit sequence.
create table if not exists work_admin_otto_follow_windows (
  organization_id uuid not null,
  membership_id uuid not null,
  person_id uuid not null,
  access_epoch integer not null check (access_epoch >= 1),
  start_sequence bigint not null check (start_sequence >= 1),
  end_sequence bigint check (end_sequence is null or end_sequence >= start_sequence),
  created_at timestamptz not null default now(),
  foreign key (organization_id, membership_id)
    references work_admin_otto_preferences (organization_id, membership_id) on delete cascade,
  foreign key (organization_id, person_id)
    references work_people (organization_id, id) on delete cascade
);
-- At most one open window per person/member; closed history stays.
create unique index if not exists work_admin_otto_follow_windows_open_idx
  on work_admin_otto_follow_windows (organization_id, membership_id, person_id)
  where end_sequence is null;
create index if not exists work_admin_otto_follow_windows_lookup_idx
  on work_admin_otto_follow_windows (organization_id, membership_id, person_id, start_sequence);
create index if not exists work_admin_otto_follow_windows_person_idx
  on work_admin_otto_follow_windows (organization_id, person_id)
  where end_sequence is null;

-- Per-admin durable arrivals and transient presentation leases. Rows are
-- created only by the inbox materializer from arrival_eligible reviewed events;
-- the employee review transaction never fans out recipients. Superseded_at
-- collapses an unpresented version when a correction arrives, while seen,
-- listened and dismissed remain personal to this admin.
create table if not exists work_admin_otto_deliveries (
  organization_id uuid not null,
  membership_id uuid not null,
  event_id uuid not null,
  seen_at timestamptz,
  listened_at timestamptz,
  dismissed_at timestamptz,
  presented_at timestamptz,
  superseded_at timestamptz,
  lease_token text,
  lease_until timestamptz,
  device_id text,
  window_id text,
  created_at timestamptz not null default now(),
  primary key (organization_id, membership_id, event_id),
  constraint work_admin_otto_deliveries_lease_fields
    check (
      (lease_token is null and lease_until is null and device_id is null and window_id is null)
      or (lease_token is not null and lease_until is not null and device_id is not null and window_id is not null)
    ),
  foreign key (organization_id, membership_id)
    references work_admin_otto_preferences (organization_id, membership_id) on delete cascade,
  foreign key (organization_id, event_id)
    references work_recap_reviews (organization_id, id) on delete cascade
);
-- The visible inbox and claim scans only touch still-pending entries.
create index if not exists work_admin_otto_deliveries_pending_idx
  on work_admin_otto_deliveries (organization_id, membership_id, event_id)
  where presented_at is null and dismissed_at is null and superseded_at is null;
create index if not exists work_admin_otto_deliveries_lease_idx
  on work_admin_otto_deliveries (organization_id, membership_id, lease_until)
  where lease_token is not null;
-- Serves the review-delete cascade; the pending partial index leads with
-- membership and cannot seek by event id alone.
create index if not exists work_admin_otto_deliveries_event_idx
  on work_admin_otto_deliveries (organization_id, event_id);

-- Bounded per-admin catch-up watermark over committed review event sequences.
-- It advances only after a processed ascending batch; an error rolls it back.
alter table work_admin_otto_preferences
  add column if not exists materialized_through_sequence bigint not null default 0
  check (materialized_through_sequence >= 0);

-- Effective capability uses the same merge as requireWorkOsAccess: a member
-- override wins; otherwise the organization flag decides. An override of
-- false must never look like an organization-wide disable for other members.
create or replace function work_admin_otto_effective_access(
  p_member_flags jsonb, p_org_flags jsonb, p_role text, p_active boolean
) returns boolean
language sql immutable as $$
  select coalesce(p_active, false)
    and p_role = 'admin'
    and coalesce(case
      when p_member_flags ? 'employee_companion'
        then p_member_flags->'employee_companion' = 'true'::jsonb
      else p_org_flags->'employee_companion' = 'true'::jsonb
    end, false);
$$;

-- Review/preference writers take this row before any other Otto row. Lifecycle
-- triggers take it after their own row change but before deciding anything, so
-- a review event and a follow-window boundary cannot disagree about commit
-- order. A bare sequence/BIGSERIAL is not commit order.
create or replace function work_admin_otto_lock_clock(p_organization_id uuid)
returns bigint
language plpgsql as $$
declare current_sequence bigint;
begin
  insert into work_admin_otto_clock (organization_id, sequence)
    values (p_organization_id, 0)
    on conflict (organization_id) do nothing;
  select sequence into current_sequence
    from work_admin_otto_clock
    where organization_id = p_organization_id
    for update;
  return current_sequence;
end;
$$;

create or replace function work_admin_otto_people_lifecycle()
returns trigger
language plpgsql as $$
declare
  current_sequence bigint;
  boundary bigint;
  closed integer := 0;
  opened integer := 0;
begin
  if tg_op = 'UPDATE' then
    if old.active is not distinct from new.active then
      return new;
    end if;
  end if;

  -- Serialize before inspecting follow state. The DML below rechecks from its
  -- own READ COMMITTED snapshot, so a concurrent activation/save cannot be
  -- missed by a pre-lock SELECT.
  current_sequence := work_admin_otto_lock_clock(new.organization_id);
  boundary := current_sequence + 1;

  if new.active is not true then
    update work_admin_otto_follow_windows
      set end_sequence = boundary
      where organization_id = new.organization_id
        and person_id = new.id
        and end_sequence is null;
    get diagnostics closed = row_count;
    if closed > 0 then
      update work_admin_otto_clock set sequence = boundary
        where organization_id = new.organization_id;
    end if;
    return new;
  end if;

  -- A reactivation starts a fresh window even if a stale open window survived
  -- an earlier interrupted lifecycle change; inactive-period events stay behind.
  update work_admin_otto_follow_windows
    set end_sequence = boundary
    where organization_id = new.organization_id
      and person_id = new.id
      and end_sequence is null;
  get diagnostics closed = row_count;

  insert into work_admin_otto_follow_windows
    (organization_id, membership_id, person_id, access_epoch, start_sequence)
  select p.organization_id, p.membership_id, new.id, p.access_epoch, boundary
  from work_admin_otto_preferences p
  join work_org_members m
    on m.organization_id = p.organization_id and m.id = p.membership_id
  join work_organizations o on o.id = p.organization_id
  where p.organization_id = new.organization_id
    and p.active
    and p.activated_sequence is not null
    and work_admin_otto_effective_access(m.feature_flags, o.feature_flags, m.role, m.active)
    and (p.mode = 'all' or new.id = any(p.selected_person_ids))
  on conflict (organization_id, membership_id, person_id)
    where end_sequence is null do nothing;
  get diagnostics opened = row_count;

  if closed > 0 or opened > 0 then
    update work_admin_otto_clock set sequence = boundary
      where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

-- Only role, active and member feature changes are relevant; ui_state writes
-- never reach this trigger. The post-lock DML rechecks effective flags from its
-- fresh snapshot. Restoration is a no-op here and waits for POST.
create or replace function work_admin_otto_member_lifecycle()
returns trigger
language plpgsql as $$
declare
  current_sequence bigint;
  boundary bigint;
  closed integer := 0;
  deactivated integer := 0;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.role is not distinct from new.role
     and old.active is not distinct from new.active
     and old.feature_flags is not distinct from new.feature_flags then
    return new;
  end if;

  current_sequence := work_admin_otto_lock_clock(new.organization_id);
  boundary := current_sequence + 1;

  update work_admin_otto_follow_windows
    set end_sequence = boundary
    where organization_id = new.organization_id
      and membership_id = new.id
      and end_sequence is null
      and not work_admin_otto_effective_access(
        new.feature_flags,
        (select o.feature_flags from work_organizations o where o.id = new.organization_id),
        new.role,
        new.active
      );
  get diagnostics closed = row_count;

  update work_admin_otto_preferences
    set active = false, activated_sequence = null, updated_at = now()
    where organization_id = new.organization_id
      and membership_id = new.id
      and (active or activated_sequence is not null)
      and not work_admin_otto_effective_access(
        new.feature_flags,
        (select o.feature_flags from work_organizations o where o.id = new.organization_id),
        new.role,
        new.active
      );
  get diagnostics deactivated = row_count;

  if closed > 0 or deactivated > 0 then
    update work_admin_otto_clock set sequence = boundary
      where organization_id = new.organization_id;
  end if;
  return new;
end;
$$;

-- Only the effective employee_companion flag change is relevant. Disabling
-- closes windows for members without a true override. Restoration is a no-op
-- and waits for each member's POST context.
create or replace function work_admin_otto_org_lifecycle()
returns trigger
language plpgsql as $$
declare
  current_sequence bigint;
  boundary bigint;
  closed integer := 0;
  deactivated integer := 0;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;
  if old.feature_flags->'employee_companion' is not distinct from
     new.feature_flags->'employee_companion' then
    return new;
  end if;
  if new.feature_flags->'employee_companion' = 'true'::jsonb then
    return new;
  end if;

  current_sequence := work_admin_otto_lock_clock(new.id);
  boundary := current_sequence + 1;

  update work_admin_otto_follow_windows w
    set end_sequence = boundary
    where w.organization_id = new.id
      and w.end_sequence is null
      and exists (
        select 1 from work_org_members m
        where m.organization_id = w.organization_id
          and m.id = w.membership_id
          and not work_admin_otto_effective_access(m.feature_flags, new.feature_flags, m.role, m.active)
      );
  get diagnostics closed = row_count;

  update work_admin_otto_preferences p
    set active = false, activated_sequence = null, updated_at = now()
    from work_org_members m
    where p.organization_id = new.id
      and m.organization_id = p.organization_id
      and m.id = p.membership_id
      and not work_admin_otto_effective_access(m.feature_flags, new.feature_flags, m.role, m.active)
      and (p.active or p.activated_sequence is not null);
  get diagnostics deactivated = row_count;

  if closed > 0 or deactivated > 0 then
    update work_admin_otto_clock set sequence = boundary
      where organization_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists work_admin_otto_people_lifecycle on work_people;
create trigger work_admin_otto_people_lifecycle
  after insert or update of active on work_people
  for each row execute function work_admin_otto_people_lifecycle();

drop trigger if exists work_admin_otto_member_lifecycle on work_org_members;
create trigger work_admin_otto_member_lifecycle
  after update of role, active, feature_flags on work_org_members
  for each row execute function work_admin_otto_member_lifecycle();

drop trigger if exists work_admin_otto_org_lifecycle on work_organizations;
create trigger work_admin_otto_org_lifecycle
  after update of feature_flags on work_organizations
  for each row execute function work_admin_otto_org_lifecycle();

-- Server database role only, like the review ledger. There are deliberately no
-- client RLS policies.
alter table work_admin_otto_preferences enable row level security;
alter table work_admin_otto_follow_windows enable row level security;
alter table work_admin_otto_deliveries enable row level security;
revoke all on work_admin_otto_preferences, work_admin_otto_follow_windows,
  work_admin_otto_deliveries from public;
-- This helper is a pure predicate over its arguments (no table access), so it
-- stays executable by whichever server role owns the lifecycle writes; every
-- data-bearing clock/window function remains revoked below.
revoke all on function work_admin_otto_lock_clock(uuid) from public;
revoke all on function work_admin_otto_people_lifecycle() from public;
revoke all on function work_admin_otto_member_lifecycle() from public;
revoke all on function work_admin_otto_org_lifecycle() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on work_admin_otto_preferences, work_admin_otto_follow_windows,
      work_admin_otto_deliveries from anon;
    revoke all on function work_admin_otto_lock_clock(uuid) from anon;
    revoke all on function work_admin_otto_people_lifecycle() from anon;
    revoke all on function work_admin_otto_member_lifecycle() from anon;
    revoke all on function work_admin_otto_org_lifecycle() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on work_admin_otto_preferences, work_admin_otto_follow_windows,
      work_admin_otto_deliveries from authenticated;
    revoke all on function work_admin_otto_lock_clock(uuid) from authenticated;
    revoke all on function work_admin_otto_people_lifecycle() from authenticated;
    revoke all on function work_admin_otto_member_lifecycle() from authenticated;
    revoke all on function work_admin_otto_org_lifecycle() from authenticated;
  end if;
end;
$$;

-- Admin Otto read-only conversations. Threads are owned by one actor's
-- organization membership; the client never supplies the organization or
-- membership. context_version is a compare-and-set fence: a reply prepared
-- against an older context is refused instead of overwriting a newer one.
create table if not exists work_admin_otto_threads (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id) on delete cascade,
  membership_id uuid not null,
  context_version integer not null default 1 check (context_version >= 1),
  last_intent jsonb,
  resolved_person_ids uuid[] not null default '{}'::uuid[],
  pending_resolution jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, membership_id)
    references work_org_members (organization_id, id) on delete cascade
);
create index if not exists work_admin_otto_threads_membership_idx
  on work_admin_otto_threads (organization_id, membership_id, updated_at desc);

-- Short text turns only. source_refs is a small server-owned pointer set used
-- to re-run the typed read on rehydration; complete team-result JSON is never
-- stored here. request_id is the per-thread idempotency key.
create table if not exists work_admin_otto_turns (
  id uuid primary key,
  thread_id uuid not null,
  organization_id uuid not null,
  membership_id uuid not null,
  request_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  text text not null check (char_length(text) between 1 and 8000),
  source_refs jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_refs) = 'object'),
  created_at timestamptz not null default now(),
  unique (organization_id, thread_id, request_id, role),
  foreign key (organization_id, thread_id)
    references work_admin_otto_threads (organization_id, id) on delete cascade,
  foreign key (organization_id, membership_id)
    references work_org_members (organization_id, id) on delete cascade
);
create index if not exists work_admin_otto_turns_thread_idx
  on work_admin_otto_turns (organization_id, thread_id, created_at desc);
create index if not exists work_admin_otto_turns_request_idx
  on work_admin_otto_turns (organization_id, thread_id, request_id);

-- First-turn retries have no thread id yet. Reserve request identity in the
-- SAME transaction as the thread/CAS and both turns: a competing insert waits
-- for commit/rollback and can only replay committed work. No model call holds
-- a transaction open. Fingerprints bind the normalized text/choice/continuation;
-- the original conversation and canonical result thread are checked separately.
create unique index if not exists work_org_members_chat_actor_key
  on work_org_members (organization_id, id, user_id);
create unique index if not exists work_admin_otto_threads_owner_key
  on work_admin_otto_threads (organization_id, membership_id, id);
create table if not exists work_admin_otto_chat_requests (
  organization_id uuid not null,
  membership_id uuid not null,
  user_id uuid not null,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  requested_conversation_id uuid,
  thread_id uuid not null,
  turn_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (organization_id, membership_id, user_id, request_id),
  foreign key (organization_id, membership_id, user_id)
    references work_org_members (organization_id, id, user_id) on delete cascade,
  foreign key (organization_id, membership_id, thread_id)
    references work_admin_otto_threads (organization_id, membership_id, id) on delete cascade
    deferrable initially deferred
);

-- Server database role only, like the review ledger.
alter table work_admin_otto_threads enable row level security;
alter table work_admin_otto_turns enable row level security;
alter table work_admin_otto_chat_requests enable row level security;
revoke all on work_admin_otto_threads, work_admin_otto_turns, work_admin_otto_chat_requests from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on work_admin_otto_threads, work_admin_otto_turns, work_admin_otto_chat_requests from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on work_admin_otto_threads, work_admin_otto_turns, work_admin_otto_chat_requests from authenticated;
  end if;
end;
$$;

-- Ephemeral per-admin narration quota, shared by every server process. A lease
-- covers one provider synthesis for at most 90 seconds; a process that dies is
-- recovered by expiry. Starts are pruned by the rolling minute on admission.
create table if not exists work_admin_otto_speech_leases (
  id uuid primary key,
  organization_id uuid not null,
  membership_id uuid not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, membership_id)
    references work_org_members (organization_id, id) on delete cascade
);
create index if not exists work_admin_otto_speech_leases_active_idx
  on work_admin_otto_speech_leases (organization_id, membership_id, expires_at)
  where released_at is null;

create table if not exists work_admin_otto_speech_starts (
  id uuid primary key,
  organization_id uuid not null,
  membership_id uuid not null,
  started_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, membership_id)
    references work_org_members (organization_id, id) on delete cascade
);
create index if not exists work_admin_otto_speech_starts_window_idx
  on work_admin_otto_speech_starts (organization_id, membership_id, started_at);

-- Server database role only, like the review ledger.
alter table work_admin_otto_speech_leases enable row level security;
alter table work_admin_otto_speech_starts enable row level security;
revoke all on work_admin_otto_speech_leases, work_admin_otto_speech_starts from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on work_admin_otto_speech_leases, work_admin_otto_speech_starts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on work_admin_otto_speech_leases, work_admin_otto_speech_starts from authenticated;
  end if;
end;
$$;
