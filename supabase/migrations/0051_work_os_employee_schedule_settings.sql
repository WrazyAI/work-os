-- Make the employee schedule in Profile settings the same schedule used by
-- Work OS clock-in resolution, and refresh PostgREST after direct DDL.

create or replace function work_save_employee_account_settings(
  p_organization_id uuid,
  p_person_id uuid,
  p_expected_revision integer,
  p_mutation_key text,
  p_onboarding_patch jsonb,
  p_person_patch jsonb
) returns work_employee_onboarding
language plpgsql security definer set search_path = public
as $$
declare
  v_existing work_employee_onboarding;
  v_row work_employee_onboarding;
  v_now timestamptz := now();
  v_revision integer;
  v_schedule jsonb;
  v_schedule_id uuid;
  v_person_user_id uuid;
begin
  if coalesce(nullif(p_mutation_key, ''), '') = '' then
    raise exception 'account settings mutation key is required';
  end if;
  if jsonb_typeof(p_onboarding_patch) <> 'object' or jsonb_typeof(p_person_patch) <> 'object' then
    raise exception 'account settings patches must be objects';
  end if;

  select * into v_existing from work_employee_onboarding
    where organization_id = p_organization_id and person_id = p_person_id for update;
  if found and v_existing.draft_client_mutation_key = p_mutation_key then
    return v_existing;
  end if;
  if found and v_existing.draft_revision <> p_expected_revision then
    raise exception 'account settings changed on another device' using errcode = '40001';
  end if;
  if not found and p_expected_revision <> 0 then
    raise exception 'account settings changed on another device' using errcode = '40001';
  end if;
  v_revision := coalesce(v_existing.draft_revision, 0) + 1;

  if not found then
    insert into work_employee_onboarding (
      organization_id, person_id, status, timezone, language, schedule_proposal,
      notification_preferences, privacy_preferences, work_preferences, draft_step,
      draft_updated_at, draft_revision, draft_client_mutation_key, updated_at
    ) values (
      p_organization_id, p_person_id, 'not_started',
      p_onboarding_patch->>'timezone', p_onboarding_patch->>'language',
      coalesce(p_onboarding_patch->'schedule_proposal', '{}'::jsonb),
      coalesce(p_onboarding_patch->'notification_preferences', '{}'::jsonb),
      coalesce(p_onboarding_patch->'privacy_preferences', '{}'::jsonb),
      coalesce(p_onboarding_patch->'work_preferences', '{}'::jsonb),
      coalesce(p_onboarding_patch->>'draft_step', 'profile'),
      coalesce((p_onboarding_patch->>'draft_updated_at')::timestamptz, v_now),
      v_revision, p_mutation_key, v_now
    ) on conflict (organization_id, person_id) do nothing returning * into v_row;
    if not found then
      raise exception 'account settings changed on another device' using errcode = '40001';
    end if;
  else
    update work_employee_onboarding set
      timezone = case when p_onboarding_patch ? 'timezone' then p_onboarding_patch->>'timezone' else timezone end,
      language = case when p_onboarding_patch ? 'language' then p_onboarding_patch->>'language' else language end,
      schedule_proposal = case when p_onboarding_patch ? 'schedule_proposal' then p_onboarding_patch->'schedule_proposal' else schedule_proposal end,
      notification_preferences = case when p_onboarding_patch ? 'notification_preferences' then p_onboarding_patch->'notification_preferences' else notification_preferences end,
      privacy_preferences = case when p_onboarding_patch ? 'privacy_preferences' then p_onboarding_patch->'privacy_preferences' else privacy_preferences end,
      work_preferences = case when p_onboarding_patch ? 'work_preferences' then p_onboarding_patch->'work_preferences' else work_preferences end,
      draft_step = coalesce(p_onboarding_patch->>'draft_step', draft_step),
      draft_updated_at = coalesce((p_onboarding_patch->>'draft_updated_at')::timestamptz, draft_updated_at, v_now),
      draft_revision = v_revision,
      draft_client_mutation_key = p_mutation_key,
      updated_at = v_now
    where organization_id = p_organization_id and person_id = p_person_id and draft_revision = p_expected_revision
    returning * into v_row;
    if not found then
      raise exception 'account settings changed on another device' using errcode = '40001';
    end if;
  end if;

  v_schedule := p_onboarding_patch->'schedule_proposal';
  if v_schedule is not null then
    if jsonb_typeof(v_schedule) <> 'object'
      or jsonb_typeof(v_schedule->'daysOfWeek') <> 'array'
      or jsonb_array_length(v_schedule->'daysOfWeek') = 0
      or coalesce(nullif(v_schedule->>'shiftStart', ''), '') = ''
      or coalesce(nullif(v_schedule->>'shiftEnd', ''), '') = ''
      or (v_schedule ? 'breaks' and jsonb_typeof(v_schedule->'breaks') <> 'array') then
      raise exception 'invalid employee schedule';
    end if;

    select user_id into v_person_user_id from work_people
      where organization_id = p_organization_id and id = p_person_id;
    if not found then
      raise exception 'account settings person not found';
    end if;

    select id into v_schedule_id from work_schedules
      where organization_id = p_organization_id and person_id = p_person_id
        and active = true and effective_from <= current_date
      order by effective_from desc, created_at desc
      limit 1 for update;

    if v_schedule_id is null then
      insert into work_schedules (
        organization_id, person_id, timezone, shift_start, shift_end, break_windows,
        days_of_week, effective_from, active, created_by, updated_at
      ) values (
        p_organization_id, p_person_id,
        coalesce(nullif(p_onboarding_patch->>'timezone', ''), v_existing.timezone, 'UTC'),
        (v_schedule->>'shiftStart')::time,
        (v_schedule->>'shiftEnd')::time,
        coalesce(v_schedule->'breaks', '[]'::jsonb),
        ARRAY(
          select value::smallint
          from jsonb_array_elements_text(v_schedule->'daysOfWeek') as day(value)
        ),
        current_date, true, v_person_user_id, v_now
      );
    else
      update work_schedules set
        timezone = coalesce(nullif(p_onboarding_patch->>'timezone', ''), timezone),
        shift_start = (v_schedule->>'shiftStart')::time,
        shift_end = (v_schedule->>'shiftEnd')::time,
        break_windows = coalesce(v_schedule->'breaks', '[]'::jsonb),
        days_of_week = ARRAY(
          select value::smallint
          from jsonb_array_elements_text(v_schedule->'daysOfWeek') as day(value)
        ),
        updated_at = v_now
      where id = v_schedule_id;
    end if;
  end if;

  if p_person_patch ? 'raw' or p_person_patch ? 'github_username' then
    update work_people set
      raw = case when p_person_patch ? 'raw' then p_person_patch->'raw' else raw end,
      github_username = case when p_person_patch ? 'github_username' then p_person_patch->>'github_username' else github_username end,
      updated_at = v_now
    where organization_id = p_organization_id and id = p_person_id;
    if not found then
      raise exception 'account settings person not found';
    end if;
  end if;

  return v_row;
end;
$$;

notify pgrst, 'reload schema';
