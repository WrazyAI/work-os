-- 0009: Work OS - merge same-email people mappings.
-- Same owner + same non-empty email is treated as one person. This merges Nifty
-- and Worktivity provider IDs, moves references, then deletes duplicate rows.

do $$
declare
  grp record;
  canonical uuid;
  dup uuid;
  keep_display_name text;
  keep_nifty_member_id text;
  keep_worktivity_employee_id text;
  keep_worktivity_user_id text;
  keep_active boolean;
  merged_raw jsonb;
begin
  for grp in
    select user_id, lower(trim(email)) as email_key
    from work_people
    where email is not null and trim(email) <> ''
    group by user_id, lower(trim(email))
    having count(*) > 1
  loop
    select id
      into canonical
    from work_people
    where user_id = grp.user_id
      and lower(trim(email)) = grp.email_key
    order by
      case when nifty_member_id is not null then 0 else 1 end,
      case when worktivity_employee_id is not null then 0 else 1 end,
      active desc,
      created_at asc
    limit 1;

    select
      coalesce(
        (
          select nullif(source.display_name, source.email)
          from work_people source
          where source.user_id = grp.user_id
            and lower(trim(source.email)) = grp.email_key
            and source.display_name is not null
          order by
            case when source.id = canonical then 0 else 1 end,
            source.active desc,
            source.created_at asc
          limit 1
        ),
        (
          select source.display_name
          from work_people source
          where source.user_id = grp.user_id
            and lower(trim(source.email)) = grp.email_key
          order by source.created_at asc
          limit 1
        )
      ),
      (
        select source.nifty_member_id
        from work_people source
        where source.user_id = grp.user_id
          and lower(trim(source.email)) = grp.email_key
          and source.nifty_member_id is not null
        order by source.created_at asc
        limit 1
      ),
      (
        select source.worktivity_employee_id
        from work_people source
        where source.user_id = grp.user_id
          and lower(trim(source.email)) = grp.email_key
          and source.worktivity_employee_id is not null
        order by source.created_at asc
        limit 1
      ),
      (
        select source.worktivity_user_id
        from work_people source
        where source.user_id = grp.user_id
          and lower(trim(source.email)) = grp.email_key
          and source.worktivity_user_id is not null
        order by source.created_at asc
        limit 1
      ),
      exists (
        select 1
        from work_people source
        where source.user_id = grp.user_id
          and lower(trim(source.email)) = grp.email_key
          and source.active = true
      ),
      (
        select coalesce(jsonb_object_agg(source.id::text, source.raw), '{}'::jsonb)
        from work_people source
        where source.user_id = grp.user_id
          and lower(trim(source.email)) = grp.email_key
          and source.id <> canonical
      )
    into
      keep_display_name,
      keep_nifty_member_id,
      keep_worktivity_employee_id,
      keep_worktivity_user_id,
      keep_active,
      merged_raw;

    for dup in
      select id
      from work_people
      where user_id = grp.user_id
        and lower(trim(email)) = grp.email_key
        and id <> canonical
    loop
      update work_evidence
      set person_id = canonical, updated_at = now()
      where person_id = dup;

      update work_reports
      set person_id = canonical, updated_at = now()
      where person_id = dup;

      update work_tasks
      set
        assignee_person_ids = (
          select coalesce(array_agg(distinct case when person_id = dup then canonical else person_id end), '{}'::uuid[])
          from unnest(work_tasks.assignee_person_ids) as person_id
        ),
        updated_at = now()
      where dup = any(assignee_person_ids);

      update work_people
      set nifty_member_id = null,
          worktivity_employee_id = null,
          worktivity_user_id = null,
          updated_at = now()
      where id = dup;
    end loop;

    update work_people
    set
      display_name = coalesce(keep_display_name, display_name),
      nifty_member_id = keep_nifty_member_id,
      worktivity_employee_id = keep_worktivity_employee_id,
      worktivity_user_id = keep_worktivity_user_id,
      active = keep_active,
      raw = coalesce(raw, '{}'::jsonb) || coalesce(merged_raw, '{}'::jsonb),
      updated_at = now()
    where id = canonical;

    delete from work_people
    where user_id = grp.user_id
      and lower(trim(email)) = grp.email_key
      and id <> canonical;
  end loop;
end $$;
