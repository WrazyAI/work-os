-- Say "no activity" when nothing arrives, and "activity" when it resumes.
--
-- Worktivity exposes idle (Status 3) separately from clock-out (Status 4), so
-- idle is never treated as inactivity. What it does not expose is a disconnected
-- state: when the connection drops, the machine sleeps, or the tracker is
-- force-closed, the API keeps returning the last status (usually `working`) and
-- simply stops producing ActivityLogs samples. The only signal is the age of the
-- newest sample, which Work OS already stores as `activity_observed_at`.
--
-- This migration teaches the queue two synthetic events written when that age
-- crosses the threshold, and when fresh activity returns:
--   no_activity       -> "HH:mm Name — no activity"
--   activity_resumed  -> "HH:mm Name — activity (7m)"
--
-- Neither event changes the session state: attendance stays whatever the
-- provider says. They exist only to describe the gap.

alter table work_notification_outbox drop constraint if exists work_notification_outbox_event_type_check;
alter table work_notification_outbox add constraint work_notification_outbox_event_type_check
  check (event_type in ('clock_in','pause','resume','clock_out','no_activity','activity_resumed'));

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
  if new.event_type not in ('clock_in','pause','resume','clock_out','no_activity','activity_resumed') then
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

create or replace function work_timebot_outbox_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_session_id uuid;
  v_shift_date date;
  v_previous timestamptz;
begin
  if new.from_state is null then
    select e.from_state into new.from_state
      from public.work_session_events e
     where e.id = new.session_event_id;
  end if;

  if new.previous_observed_at is null and new.event_type in ('clock_in','resume','activity_resumed') then
    select e.session_id into v_session_id
      from public.work_session_events e
     where e.id = new.session_event_id;

    if new.event_type = 'resume' then
      -- The break this return ends, within the same session.
      select max(e.observed_at) into v_previous
        from public.work_session_events e
       where e.session_id = v_session_id
         and e.event_type = 'pause'
         and e.observed_at <= new.observed_at;
    elsif new.event_type = 'activity_resumed' then
      -- The quiet gap this return ends.
      select max(e.observed_at) into v_previous
        from public.work_session_events e
       where e.session_id = v_session_id
         and e.event_type = 'no_activity'
         and e.observed_at <= new.observed_at;
    else
      -- The clock-out this clock-in resumes, within the same shift date. A
      -- next-morning clock-in is a fresh `in`, not a `back`.
      select s.shift_date into v_shift_date
        from public.work_sessions s
       where s.id = v_session_id;
      select max(e.observed_at) into v_previous
        from public.work_session_events e
        join public.work_sessions s on s.id = e.session_id
       where e.organization_id = new.organization_id
         and e.person_id = new.person_id
         and e.event_type = 'clock_out'
         and e.observed_at <= new.observed_at
         and s.shift_date = v_shift_date;
    end if;

    new.previous_observed_at := v_previous;
  end if;

  return new;
exception when others then
  -- Never fail an enqueue because context gathering failed; the row is still
  -- deliverable and simply renders with the terse word.
  raise warning 'timebot context skipped for outbox row: %', sqlerrm;
  return new;
end;
$$;

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
     where e.event_type in ('clock_in','pause','resume','clock_out','no_activity','activity_resumed')
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

-- The replaced functions keep the same signatures, so the existing grants still
-- apply. Re-state them so a fresh database and an upgraded one end up identical.
do $$
begin
  revoke all on function public.work_enqueue_timebot_notification() from public;
  revoke all on function public.work_timebot_outbox_context() from public;
  revoke all on function public.work_reconcile_timebot_outbox(timestamptz, integer) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.work_enqueue_timebot_notification() from anon;
    revoke all on function public.work_timebot_outbox_context() from anon;
    revoke all on function public.work_reconcile_timebot_outbox(timestamptz, integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.work_enqueue_timebot_notification() from authenticated;
    revoke all on function public.work_timebot_outbox_context() from authenticated;
    revoke all on function public.work_reconcile_timebot_outbox(timestamptz, integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.work_enqueue_timebot_notification() to service_role;
    grant execute on function public.work_timebot_outbox_context() to service_role;
    grant execute on function public.work_reconcile_timebot_outbox(timestamptz, integer) to service_role;
  end if;
end $$;
