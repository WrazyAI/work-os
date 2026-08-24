-- Phase 1 ledger closure: canonicalize exact Nifty completion identities and
-- remove duplicates created when SQL and JavaScript serialized the same
-- timestamptz differently. The exact provider instant is preserved.

with ranked as (
  select id,
    row_number() over (
      partition by organization_id, task_id, event_type, exact_at
      order by
        case provenance when 'nifty_exact' then 0 when 'migration_exact' then 1 else 2 end,
        case when person_id is not null then 0 else 1 end,
        created_at,
        id
    ) as duplicate_rank
  from work_task_day_events
  where event_type='completed' and exact_at is not null
)
delete from work_task_day_events event
using ranked
where event.id=ranked.id and ranked.duplicate_rank > 1;

update work_task_day_events
set idempotency_key = 'nifty:completed:' || provider_task_id || ':' ||
  to_char(exact_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
where event_type='completed'
  and exact_at is not null
  and idempotency_key is distinct from 'nifty:completed:' || provider_task_id || ':' ||
    to_char(exact_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

create unique index if not exists work_task_day_events_exact_completion_uidx
  on work_task_day_events(organization_id, task_id, event_type, exact_at)
  where event_type='completed' and exact_at is not null;
