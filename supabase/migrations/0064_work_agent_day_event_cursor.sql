-- Follow-up to 0063, applied after it shipped:
-- 1. Databases built from the historical set constrain day-event provenance to
--    the provider/employee values; agent events need the new value.
-- 2. The agent change feed's descending cursor compared with `>` in both
--    directions, so page two repeated page one instead of reaching older rows.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'work_task_day_events_provenance_check'
      and conrelid = 'public.work_task_day_events'::regclass
  ) then
    alter table public.work_task_day_events drop constraint work_task_day_events_provenance_check;
    alter table public.work_task_day_events add constraint work_task_day_events_provenance_check
      check (provenance in ('nifty_exact', 'provider_observed', 'employee_explicit', 'migration_exact', 'migration_observed', 'agent'));
  end if;
end $$;

create or replace function public.work_agent_list_tasks(
  p_user_id uuid,
  p_organization_id uuid,
  p_person_id uuid,
  p_nifty_member_id text default null,
  p_updated_since timestamptz default null,
  p_include_archived boolean default false,
  p_ascending boolean default false,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table(task jsonb)
language sql
stable
set search_path = public
as $$
  select to_jsonb(t) as task
  from public.work_tasks t
  where t.user_id = p_user_id
    and t.organization_id = p_organization_id
    and t.parent_task_id is null
    and t.parent_provider_task_id is null
    and (p_include_archived or t.status not in ('archived', 'deleted'))
    and (p_updated_since is null or t.updated_at > p_updated_since)
    and (
      t.assignee_person_ids @> array[p_person_id]
      or (
        p_nifty_member_id is not null
        and (
          t.assignee_provider_ids @> array[p_nifty_member_id]
          or t.raw ->> 'created_by' = p_nifty_member_id
          or (t.raw -> 'subscribers') ? p_nifty_member_id
        )
      )
    )
    and (
      p_after_updated_at is null
      or (p_ascending and (t.updated_at, t.id) > (p_after_updated_at, p_after_id))
      or (not p_ascending and (t.updated_at, t.id) < (p_after_updated_at, p_after_id))
    )
  order by
    case when p_ascending then t.updated_at end asc,
    case when p_ascending then t.id end asc,
    case when not p_ascending then t.updated_at end desc,
    case when not p_ascending then t.id end desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;
