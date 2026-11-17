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
            and earlier.created_at < o.created_at
            and earlier.status in ('pending','sending','failed')
       )
     order by o.created_at
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
