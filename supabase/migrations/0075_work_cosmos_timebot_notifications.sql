-- Cosmos #timebot notifications.
--
-- The team keeps a manual punch clock: everyone types `in`, `break`, `out`
-- into a Cosmos channel. This table lets Work OS post those transitions
-- instead, from work_session_events, without ever putting Cosmos on the clock
-- path.
--
-- The enqueue happens in a trigger so every writer is covered: clockIn,
-- syncWorktivitySession, transitionSession and any future path. The trigger
-- swallows its own errors so a broken queue can never fail a clock transition.
--
-- The dispatcher in src/lib/work-os-cosmos-timebot.ts drains this table. Rows
-- are ordered per organization: a stuck row blocks later rows until it is sent
-- or dead, so the channel reads as a timeline.

create table if not exists work_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  session_event_id uuid not null references work_session_events(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  -- Snapshot at enqueue: the message must describe the moment, not the
  -- person's current name or timezone months later.
  person_name text not null,
  timezone text not null default 'UTC',
  event_type text not null check (event_type in ('clock_in','pause','resume','clock_out')),
  observed_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','dead')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  attempted_at timestamptz,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- Insertion order as a total order. created_at alone cannot order two events
  -- written in one transaction (now() is the transaction time) and uuid order is
  -- random, so a break could be claimed before the clock-in that precedes it.
  enqueue_seq bigint generated always as identity,
  -- One post per session event. A retry adopts this row instead of creating a
  -- second message in the channel.
  unique (session_event_id)
);

create index if not exists work_notification_outbox_due_idx
  on work_notification_outbox (organization_id, status, next_attempt_at, created_at);

alter table work_notification_outbox enable row level security;
-- Service-role only. Admin reads go through the server, never the browser.

-- When the integration first became active for an organization. The reconciler
-- must cover everything recorded since this moment, and nothing before it:
-- a rolling window would silently expire a swallowed enqueue, while no boundary
-- at all would replay the manual punch-clock history from before rollout.
create table if not exists work_notification_state (
  organization_id uuid primary key references work_organizations(id) on delete cascade,
  timebot_activated_at timestamptz not null default now()
);
alter table work_notification_state enable row level security;

-- The cutover is the migration, not the first dispatch: seed every existing
-- organization now so an enqueue swallowed between deploy and the first send is
-- still recoverable, and pre-rollout events stay out of scope.
insert into work_notification_state (organization_id, timebot_activated_at)
select o.id, now() from work_organizations o
on conflict (organization_id) do nothing;

create or replace function work_enqueue_timebot_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_name text;
  v_timezone text;
begin
  if new.event_type not in ('clock_in','pause','resume','clock_out') then
    return new;
  end if;

  -- This runs inside the clock transaction. Bound any wait on the outbox unique
  -- index so a competing writer can delay the insert by milliseconds, not until
  -- the statement timeout. A lock failure falls through to the reconciler.
  perform set_config('lock_timeout', '250ms', true);

  select p.display_name, coalesce(s.timezone, 'UTC')
    into v_name, v_timezone
    from public.work_people p
    left join public.work_sessions s on s.id = new.session_id
   where p.id = new.person_id;

  if v_name is null or btrim(v_name) = '' then
    return new;
  end if;

  -- A new organization gets its cutover at its first transition. Existing ones
  -- were seeded by the migration, so there is no window where an event can be
  -- recorded but never recoverable.
  insert into public.work_notification_state (organization_id)
  values (new.organization_id)
  on conflict (organization_id) do nothing;

  -- Age never decides whether a transition exists. A late event is still
  -- posted; the dispatcher measures lateness at delivery and marks the line,
  -- so a provider recovery at 18:00 cannot silently erase a 09:00 clock-in.
  insert into public.work_notification_outbox (
    organization_id, session_event_id, person_id, person_name, timezone,
    event_type, observed_at, status
  ) values (
    new.organization_id, new.id, new.person_id, v_name, v_timezone,
    new.event_type, new.observed_at, 'pending'
  )
  on conflict (session_event_id) do nothing;

  return new;
exception when others then
  -- Never fail a clock transition because the notification queue is unhappy.
  raise warning 'timebot enqueue skipped for session event %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists work_session_events_timebot on work_session_events;
create trigger work_session_events_timebot
  after insert on work_session_events
  for each row execute function work_enqueue_timebot_notification();

-- Claim a bounded batch with row locks so two dispatchers cannot send the same
-- row. Head-of-line: only the oldest eligible row per organization is claimed,
-- which keeps in/break/back/out in order even when one send keeps failing.
-- The order key is the event's own time plus its insertion sequence: created_at
-- is the transaction time (two events in one transaction tie) and uuid order is
-- random, so neither can tell a clock-in from the break that follows it.
create or replace function work_claim_notification_outbox(p_limit integer default 20)
returns setof work_notification_outbox
language sql
security definer
set search_path = pg_catalog, public
as $$
  with due as (
    select o.id
      from public.work_notification_outbox o
     where o.status in ('pending','failed')
       and o.next_attempt_at <= now()
       and not exists (
         select 1
           from public.work_notification_outbox earlier
          where earlier.organization_id = o.organization_id
            and (earlier.observed_at, earlier.enqueue_seq) < (o.observed_at, o.enqueue_seq)
            and earlier.status in ('pending','sending','failed')
       )
     order by o.observed_at, o.enqueue_seq
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.work_notification_outbox o
     set status = 'sending',
         attempts = o.attempts + 1,
         attempted_at = now()
    from due
   where o.id = due.id
  returning o.*;
$$;

-- Recovery for an enqueue the trigger swallowed. A session event that never got
-- a row would otherwise be silent forever. `p_since` is the activation moment:
-- everything recorded after it is in scope, however old, and nothing before it
-- is drawn in. Age is not a reason to drop a transition; the dispatcher marks
-- late deliveries instead.
drop function if exists work_reconcile_timebot_outbox(integer);
create or replace function work_reconcile_timebot_outbox(p_since timestamptz, p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inserted integer;
begin
  with missing as (
    select e.id, e.organization_id, e.person_id, e.event_type, e.observed_at, e.session_id, e.recorded_at
      from public.work_session_events e
     where e.event_type in ('clock_in','pause','resume','clock_out')
       -- work_session_events has no created_at; recorded_at is when the row
       -- was written, and observed_at is when the transition happened.
       and e.recorded_at >= p_since
       and not exists (
         select 1 from public.work_notification_outbox o where o.session_event_id = e.id
       )
     order by e.observed_at, e.recorded_at, e.id
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  ),
  inserted as (
    insert into public.work_notification_outbox (
      organization_id, session_event_id, person_id, person_name, timezone,
      event_type, observed_at, status
    )
    select m.organization_id, m.id, m.person_id,
           p.display_name,
           coalesce(s.timezone, 'UTC'),
           m.event_type, m.observed_at, 'pending'
      from missing m
      join public.work_people p on p.id = m.person_id
      left join public.work_sessions s on s.id = m.session_id
     where btrim(p.display_name) <> ''
    on conflict (session_event_id) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;
  return v_inserted;
end;
$$;

-- Both functions are service-role only. PostgreSQL grants EXECUTE to PUBLIC by
-- default, which would expose other organizations' rows through PostgREST.
-- The trigger function is revoked too: it is SECURITY DEFINER and an ordinary
-- role could otherwise attach it to a table it owns and forge an outbox row.
-- Trigger firing does not check EXECUTE, so revoking does not affect the trigger.
-- Legacy Supabase databases carry anon/authenticated/service_role; Neon carries
-- none of them, so each role-specific statement is applied only where it exists.
do $$
begin
  revoke all on function public.work_claim_notification_outbox(integer) from public;
  revoke all on function public.work_reconcile_timebot_outbox(timestamptz, integer) from public;
  revoke all on function public.work_enqueue_timebot_notification() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.work_claim_notification_outbox(integer) from anon;
    revoke all on function public.work_reconcile_timebot_outbox(timestamptz, integer) from anon;
    revoke all on function public.work_enqueue_timebot_notification() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.work_claim_notification_outbox(integer) from authenticated;
    revoke all on function public.work_reconcile_timebot_outbox(timestamptz, integer) from authenticated;
    revoke all on function public.work_enqueue_timebot_notification() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.work_claim_notification_outbox(integer) to service_role;
    grant execute on function public.work_reconcile_timebot_outbox(timestamptz, integer) to service_role;
    grant execute on function public.work_enqueue_timebot_notification() to service_role;
  end if;
end $$;
