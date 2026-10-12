-- 0059: return bounded, globally sorted task pages with exact filtered counts.
-- The cursor carries the last sort key, so inserts before it do not shift later pages.

create or replace function public.work_list_person_task_page(
  p_user_id uuid,
  p_organization_id uuid,
  p_person_id uuid,
  p_nifty_member_id text default null,
  p_completed boolean default null,
  p_project_id text default null,
  p_order text default 'due_desc',
  p_sort_date date default current_date,
  p_search text default null,
  p_from date default null,
  p_to date default null,
  p_excluded_task_ids uuid[] default null,
  p_after jsonb default null,
  p_limit integer default 50,
  p_overdue_first boolean default false
)
returns table(task jsonb, total_count bigint, total_all bigint, total_open bigint, total_completed bigint, total_overdue bigint, has_more boolean)
language sql
stable
set search_path = public
as $$
  with eligible as (
    select
      t.*,
      lower(t.title) as sort_title,
      coalesce(t.due_date, date '9999-12-31') as sort_due,
      (t.due_date is null) as sort_due_missing,
      date_trunc('milliseconds', coalesce(t.provider_updated_at, t.provider_created_at, t.created_at, t.updated_at, timestamptz 'epoch')) as sort_recency,
      case
        when t.completed then 2
        when t.due_date < coalesce(p_sort_date, current_date) then 0
        else 1
      end as sort_status,
      case
        when t.completed then 3
        when t.due_date < coalesce(p_sort_date, current_date) then 0
        else 1
      end as sort_overdue,
      case
        when t.completed
          and t.completed_at is not null
          and (t.completed_at at time zone 'UTC')::date <= coalesce(p_sort_date, current_date)
          then case
            when t.due_date is not null and (t.completed_at at time zone 'UTC')::date > t.due_date
              then (t.completed_at at time zone 'UTC')::date
            else coalesce(t.due_date, (t.completed_at at time zone 'UTC')::date)
          end
        when t.due_date is not null and t.due_date <= coalesce(p_sort_date, current_date) then t.due_date
        when t.provider_created_at is not null
          and (t.provider_created_at at time zone 'UTC')::date <= coalesce(p_sort_date, current_date)
          then (t.provider_created_at at time zone 'UTC')::date
        when t.created_at is not null
          and (t.created_at at time zone 'UTC')::date <= coalesce(p_sort_date, current_date)
          then (t.created_at at time zone 'UTC')::date
        else null
      end as attributed_date
    from public.work_tasks t
    left join public.work_projects p on p.id = t.project_id and p.user_id = t.user_id
    where t.user_id = p_user_id
      and t.organization_id = p_organization_id
      and t.status not in ('archived', 'deleted')
      and t.parent_task_id is null
      and t.parent_provider_task_id is null
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
      and (p_excluded_task_ids is null or not (t.id = any(p_excluded_task_ids)))
      and (
        nullif(btrim(p_search), '') is null
        or strpos(
          lower(concat_ws(' ', t.title, t.description, p.name, t.raw ->> 'milestone_name', t.raw -> 'milestone' ->> 'name')),
          lower(btrim(p_search))
        ) > 0
      )
  ), scoped as (
    select e.* from eligible e
    where (p_from is null or e.attributed_date >= p_from)
      and (p_to is null or e.attributed_date <= p_to)
  ), filtered as (
    select s.* from scoped s
    where (p_completed is null or s.completed = p_completed)
  ), totals as (
    select
      (select count(*) from filtered) as total_count,
      (select count(*) from scoped) as total_all,
      (select count(*) from scoped where completed = false) as total_open,
      (select count(*) from scoped where completed = true) as total_completed,
      (select count(*) from scoped where completed = false and due_date < coalesce(p_sort_date, current_date)) as total_overdue
  ), candidates as (
    select f.* from filtered f
    where p_after is null
      or case
        when coalesce(p_overdue_first, false) then
          f.sort_overdue > (p_after ->> 'overdueRank')::integer
          or (
            f.sort_overdue = (p_after ->> 'overdueRank')::integer
            and (
              (p_order = 'title_asc' and (
                f.sort_title > p_after ->> 'title'
                or (f.sort_title = p_after ->> 'title' and f.sort_recency < (p_after ->> 'recency')::timestamptz)
                or (f.sort_title = p_after ->> 'title' and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.id::text > p_after ->> 'id')
              ))
              or (p_order = 'title_desc' and (
                f.sort_title < p_after ->> 'title'
                or (f.sort_title = p_after ->> 'title' and f.sort_recency < (p_after ->> 'recency')::timestamptz)
                or (f.sort_title = p_after ->> 'title' and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.id::text > p_after ->> 'id')
              ))
              or (p_order in ('due_asc', 'due_desc') and (
                f.completed > (p_after ->> 'completed')::boolean
                or (f.completed = (p_after ->> 'completed')::boolean and f.sort_due_missing > (p_after ->> 'dueMissing')::boolean)
                or (f.completed = (p_after ->> 'completed')::boolean and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and (
                  (p_order = 'due_asc' and f.sort_due > (p_after ->> 'dueDate')::date)
                  or (p_order = 'due_desc' and f.sort_due < (p_after ->> 'dueDate')::date)
                  or (f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency < (p_after ->> 'recency')::timestamptz)
                  or (f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title > p_after ->> 'title')
                  or (f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title = p_after ->> 'title' and f.id::text > p_after ->> 'id')
                ))
              ))
              or (p_order in ('status_asc', 'status_desc') and (
                (p_order = 'status_asc' and f.sort_status > (p_after ->> 'statusRank')::integer)
                or (p_order = 'status_desc' and f.sort_status < (p_after ->> 'statusRank')::integer)
                or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing > (p_after ->> 'dueMissing')::boolean)
                or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due > (p_after ->> 'dueDate')::date)
                or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency < (p_after ->> 'recency')::timestamptz)
                or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title > p_after ->> 'title')
                or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title = p_after ->> 'title' and f.id::text > p_after ->> 'id')
              ))
              or (p_order = 'recency' and (
                f.sort_recency < (p_after ->> 'recency')::timestamptz
                or (f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title > p_after ->> 'title')
                or (f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title = p_after ->> 'title' and f.id::text > p_after ->> 'id')
              ))
            )
          )
        else (
          (p_order = 'title_asc' and (
            f.sort_title > p_after ->> 'title'
            or (f.sort_title = p_after ->> 'title' and f.sort_recency < (p_after ->> 'recency')::timestamptz)
            or (f.sort_title = p_after ->> 'title' and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.id::text > p_after ->> 'id')
          ))
          or (p_order = 'title_desc' and (
            f.sort_title < p_after ->> 'title'
            or (f.sort_title = p_after ->> 'title' and f.sort_recency < (p_after ->> 'recency')::timestamptz)
            or (f.sort_title = p_after ->> 'title' and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.id::text > p_after ->> 'id')
          ))
          or (p_order in ('due_asc', 'due_desc') and (
            f.completed > (p_after ->> 'completed')::boolean
            or (f.completed = (p_after ->> 'completed')::boolean and f.sort_due_missing > (p_after ->> 'dueMissing')::boolean)
            or (f.completed = (p_after ->> 'completed')::boolean and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and (
              (p_order = 'due_asc' and f.sort_due > (p_after ->> 'dueDate')::date)
              or (p_order = 'due_desc' and f.sort_due < (p_after ->> 'dueDate')::date)
              or (f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency < (p_after ->> 'recency')::timestamptz)
              or (f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title > p_after ->> 'title')
              or (f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title = p_after ->> 'title' and f.id::text > p_after ->> 'id')
            ))
          ))
          or (p_order in ('status_asc', 'status_desc') and (
            (p_order = 'status_asc' and f.sort_status > (p_after ->> 'statusRank')::integer)
            or (p_order = 'status_desc' and f.sort_status < (p_after ->> 'statusRank')::integer)
            or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing > (p_after ->> 'dueMissing')::boolean)
            or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due > (p_after ->> 'dueDate')::date)
            or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency < (p_after ->> 'recency')::timestamptz)
            or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title > p_after ->> 'title')
            or (f.sort_status = (p_after ->> 'statusRank')::integer and f.sort_due_missing = (p_after ->> 'dueMissing')::boolean and f.sort_due = (p_after ->> 'dueDate')::date and f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title = p_after ->> 'title' and f.id::text > p_after ->> 'id')
          ))
          or (p_order = 'recency' and (
            f.sort_recency < (p_after ->> 'recency')::timestamptz
            or (f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title > p_after ->> 'title')
            or (f.sort_recency = (p_after ->> 'recency')::timestamptz and f.sort_title = p_after ->> 'title' and f.id::text > p_after ->> 'id')
          ))
        )
      end
    order by
      case when coalesce(p_overdue_first, false) then f.sort_overdue end asc,
      case when p_order = 'title_asc' then f.sort_title end asc,
      case when p_order = 'title_desc' then f.sort_title end desc,
      case when p_order in ('due_asc', 'due_desc') then f.completed end asc,
      case when p_order = 'status_asc' then f.sort_status end asc,
      case when p_order = 'status_desc' then f.sort_status end desc,
      case when p_order in ('due_asc', 'due_desc', 'status_asc', 'status_desc') then f.sort_due_missing end asc,
      case when p_order in ('due_asc', 'status_asc', 'status_desc') then f.sort_due end asc,
      case when p_order = 'due_desc' then f.sort_due end desc,
      f.sort_recency desc,
      f.sort_title asc,
      f.id asc
    limit least(greatest(coalesce(p_limit, 50), 1), 50) + 1
  ), page as (
    select c.* from candidates c
    order by
      case when coalesce(p_overdue_first, false) then c.sort_overdue end asc,
      case when p_order = 'title_asc' then c.sort_title end asc,
      case when p_order = 'title_desc' then c.sort_title end desc,
      case when p_order in ('due_asc', 'due_desc') then c.completed end asc,
      case when p_order = 'status_asc' then c.sort_status end asc,
      case when p_order = 'status_desc' then c.sort_status end desc,
      case when p_order in ('due_asc', 'due_desc', 'status_asc', 'status_desc') then c.sort_due_missing end asc,
      case when p_order in ('due_asc', 'status_asc', 'status_desc') then c.sort_due end asc,
      case when p_order = 'due_desc' then c.sort_due end desc,
      c.sort_recency desc,
      c.sort_title asc,
      c.id asc
    limit least(greatest(coalesce(p_limit, 50), 1), 50)
  ), page_state as (
    select count(*) > least(greatest(coalesce(p_limit, 50), 1), 50) as has_more from candidates
  )
  select
    case when page.id is null then null else to_jsonb(page) - array['sort_title', 'sort_due', 'sort_due_missing', 'sort_recency', 'sort_status', 'sort_overdue', 'attributed_date'] end,
    totals.total_count,
    totals.total_all,
    totals.total_open,
    totals.total_completed,
    totals.total_overdue,
    page_state.has_more
  from totals cross join page_state left join page on true;
$$;

-- The server calls this function through the service-role client; keep it off
-- the public PostgREST surface for every client role. Legacy Supabase databases
-- carry anon/authenticated/service_role roles; Neon carries none of them, so
-- each role-specific statement is applied only where the role exists.
do $$
begin
  revoke all on function public.work_list_person_task_page(uuid, uuid, uuid, text, boolean, text, text, date, text, date, date, uuid[], jsonb, integer, boolean) from public;
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.work_list_person_task_page(uuid, uuid, uuid, text, boolean, text, text, date, text, date, date, uuid[], jsonb, integer, boolean) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.work_list_person_task_page(uuid, uuid, uuid, text, boolean, text, text, date, text, date, date, uuid[], jsonb, integer, boolean) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.work_list_person_task_page(uuid, uuid, uuid, text, boolean, text, text, date, text, date, date, uuid[], jsonb, integer, boolean) to service_role;
  end if;
end $$;
