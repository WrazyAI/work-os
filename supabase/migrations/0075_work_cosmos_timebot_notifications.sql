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
  -- One post per session event. A retry adopts this row instead of creating a
  -- second message in the channel.
  unique (session_event_id)
);

create index if not exists work_notification_outbox_due_idx
  on work_notification_outbox (organization_id, status, next_attempt_at, created_at);

alter table work_notification_outbox enable row level security;
-- Service-role only. Admin reads go through the server, never the browser.

create or replace function work_enqueue_timebot_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_timezone text;
  v_stale boolean;
begin
  if new.event_type not in ('clock_in','pause','resume','clock_out') then
    return new;
  end if;

  select p.display_name, coalesce(s.timezone, 'UTC')
    into v_name, v_timezone
    from work_people p
    left join work_sessions s on s.id = new.session_id
   where p.id = new.person_id;

  if v_name is null or btrim(v_name) = '' then
    return new;
  end if;

  -- A provider recovery at 18:00 must not post a 09:00 clock-in. Keep the row
  -- so reconciliation can see it was deliberately skipped, but never send it.
  v_stale := new.observed_at < now() - interval '15 minutes';

  insert into work_notification_outbox (
    organization_id, session_event_id, person_id, person_name, timezone,
    event_type, observed_at, status, last_error
  ) values (
    new.organization_id, new.id, new.person_id, v_name, v_timezone,
    new.event_type, new.observed_at,
    case when v_stale then 'dead' else 'pending' end,
    case when v_stale then 'stale' else null end
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
-- `now()` is the transaction time, so two events written in one transaction
-- share created_at; the id tie-breaker makes the order total and prevents a
-- break from overtaking the clock-in it belongs to.
create or replace function work_claim_notification_outbox(p_limit integer default 20)
returns setof work_notification_outbox
language sql
security definer
set search_path = public
as $$
  with due as (
    select o.id
      from work_notification_outbox o
     where o.status in ('pending','failed')
       and o.next_attempt_at <= now()
       and not exists (
         select 1
           from work_notification_outbox earlier
          where earlier.organization_id = o.organization_id
            and (earlier.created_at, earlier.id) < (o.created_at, o.id)
            and earlier.status in ('pending','sending','failed')
       )
     order by o.created_at, o.id
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update work_notification_outbox o
     set status = 'sending',
         attempts = o.attempts + 1,
         attempted_at = now()
    from due
   where o.id = due.id
  returning o.*;
$$;

-- Recovery for an enqueue the trigger swallowed. A session event that never got
-- a row would otherwise be silent forever. Newest seven days only, and anything
-- already stale is stored dead/stale rather than posted late.
create or replace function work_reconcile_timebot_outbox(p_limit integer default 50)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer;
begin
  with missing as (
    select e.id, e.organization_id, e.person_id, e.event_type, e.observed_at, e.session_id
      from work_session_events e
     where e.event_type in ('clock_in','pause','resume','clock_out')
       and e.created_at > now() - interval '7 days'
       and not exists (
         select 1 from work_notification_outbox o where o.session_event_id = e.id
       )
     order by e.created_at, e.id
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  ),
  inserted as (
    insert into work_notification_outbox (
      organization_id, session_event_id, person_id, person_name, timezone,
      event_type, observed_at, status, last_error
    )
    select m.organization_id, m.id, m.person_id,
           p.display_name,
           coalesce(s.timezone, 'UTC'),
           m.event_type, m.observed_at,
           case when m.observed_at < now() - interval '15 minutes' then 'dead' else 'pending' end,
           case when m.observed_at < now() - interval '15 minutes' then 'stale' else null end
      from missing m
      join work_people p on p.id = m.person_id
      left join work_sessions s on s.id = m.session_id
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
-- Legacy Supabase databases carry anon/authenticated/service_role; Neon carries
-- none of them, so each role-specific statement is applied only where it exists.
do $$
begin
  revoke all on function public.work_claim_notification_outbox(integer) from public;
  revoke all on function public.work_reconcile_timebot_outbox(integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.work_claim_notification_outbox(integer) from anon;
    revoke all on function public.work_reconcile_timebot_outbox(integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.work_claim_notification_outbox(integer) from authenticated;
    revoke all on function public.work_reconcile_timebot_outbox(integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.work_claim_notification_outbox(integer) to service_role;
    grant execute on function public.work_reconcile_timebot_outbox(integer) to service_role;
  end if;
end $$;
