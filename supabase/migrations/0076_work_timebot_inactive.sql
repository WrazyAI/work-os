-- Distinguish "went inactive" from "clocked out".
--
-- Worktivity reports an exact ClockOut when the connection drops, which is
-- indistinguishable from a deliberate end-of-day clock-out at the moment it
-- arrives. The channel therefore posted `out` and then `in` on reconnect, even
-- though the person never left. The return is only visible in hindsight, so the
-- honest rendering at the time of the event is `inactive`, and the return is
-- `back` with the gap.
--
-- The facts needed for that decision are captured on the outbox row rather than
-- baked into the message: `from_state` says whether the session was already
-- eod_due (a real end of day), and `previous_observed_at` gives the event this
-- one resumes from, so the gap can be rendered without another query.
--
-- Classification lives in src/lib/work-os-cosmos-timebot.ts. This migration only
-- records the inputs, for both the enqueue trigger and the reconciler, through a
-- BEFORE INSERT trigger on the outbox itself.

alter table work_notification_outbox add column if not exists from_state text;
alter table work_notification_outbox add column if not exists previous_observed_at timestamptz;

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

  if new.previous_observed_at is null and new.event_type in ('clock_in','resume') then
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

drop trigger if exists work_notification_outbox_context on work_notification_outbox;
create trigger work_notification_outbox_context
  before insert on work_notification_outbox
  for each row execute function work_timebot_outbox_context();

-- Service-role only, matching the enqueue function.
do $$
begin
  revoke all on function public.work_timebot_outbox_context() from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.work_timebot_outbox_context() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.work_timebot_outbox_context() from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.work_timebot_outbox_context() to service_role;
  end if;
end $$;
