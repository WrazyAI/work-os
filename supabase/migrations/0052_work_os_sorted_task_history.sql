-- 0052: page the Tasks workspace from one attributed, database-sorted query.
-- This keeps global sorting truthful without reloading every matching task for
-- every page request. Apply during a planned maintenance window: the transactional
-- index builds block writes to work_tasks, so this runner cannot use CONCURRENTLY.

create index if not exists work_tasks_person_assignees_idx
  on public.work_tasks using gin (assignee_person_ids);

create index if not exists work_tasks_created_by_idx
  on public.work_tasks (user_id, ((raw ->> 'created_by')));

create index if not exists work_tasks_subscribers_idx
  on public.work_tasks using gin ((raw -> 'subscribers'));

create or replace function public.work_list_person_tasks_sorted(
  p_user_id uuid,
  p_person_id uuid,
  p_nifty_member_id text default null,
  p_completed boolean default null,
  p_project_id text default null,
  p_order text default 'due_desc',
  p_sort_date date default current_date,
  p_offset integer default 0,
  p_limit integer default 100
)
returns setof public.work_tasks
language sql
stable
set search_path = public
as $$
  select t.*
  from public.work_tasks t
  where t.user_id = p_user_id
    and t.status not in ('archived', 'deleted')
    and (p_completed is null or t.completed = p_completed)
    and (p_project_id is null or t.project_id::text = p_project_id)
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
  order by
    case when p_order = 'title_asc' then lower(t.title) end asc,
    case when p_order = 'title_desc' then lower(t.title) end desc,
    case when p_order in ('due_asc', 'due_desc') then t.completed end asc,
    case
      when p_order = 'status_asc' then
        case
          when t.completed then 2
          when t.due_date < coalesce(p_sort_date, current_date) then 0
          else 1
        end
    end asc,
    case
      when p_order = 'status_desc' then
        case
          when t.completed then 2
          when t.due_date < coalesce(p_sort_date, current_date) then 0
          else 1
        end
    end desc,
    case when p_order in ('due_asc', 'status_asc', 'status_desc') then t.due_date end asc nulls last,
    case when p_order = 'due_desc' then t.due_date end desc nulls last,
    coalesce(t.provider_updated_at, t.provider_created_at, t.created_at, t.updated_at) desc nulls last,
    lower(t.title) asc,
    t.id asc
  limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
