-- Existing rows and old clients remain scheduled. Flexible workdays are not
-- midnight-to-midnight shifts and have no required duration.
alter table work_schedules add column if not exists arrangement text not null default 'scheduled';
alter table work_schedules alter column shift_start drop not null;
alter table work_schedules alter column shift_end drop not null;
alter table work_schedules drop constraint if exists work_schedules_arrangement_check;
alter table work_schedules add constraint work_schedules_arrangement_check check (
  (arrangement = 'scheduled' and shift_start is not null and shift_end is not null)
  or (arrangement = 'flexible' and shift_start is null and shift_end is null and break_windows = '[]'::jsonb)
);

-- Keep the legacy scheduled-settings behavior, but put flexible submissions
-- (and changes away from an official flexible arrangement) through review.
do $$ begin
  if to_regprocedure('work_save_employee_account_settings_scheduled(uuid,uuid,integer,text,jsonb,jsonb)') is null then
    alter function work_save_employee_account_settings(uuid,uuid,integer,text,jsonb,jsonb)
      rename to work_save_employee_account_settings_scheduled;
  end if;
end $$;

create or replace function work_save_employee_account_settings(
  p_organization_id uuid, p_person_id uuid, p_expected_revision integer,
  p_mutation_key text, p_onboarding_patch jsonb, p_person_patch jsonb
) returns work_employee_onboarding
language plpgsql security definer set search_path = public as $$
declare
  v_existing work_employee_onboarding;
  v_row work_employee_onboarding;
  v_schedule jsonb := p_onboarding_patch->'schedule_proposal';
  v_patch jsonb := p_onboarding_patch - 'schedule_proposal';
  v_flexible_official boolean;
  v_timezone_changed boolean;
  v_review boolean;
begin
  select * into v_existing from work_employee_onboarding
    where organization_id=p_organization_id and person_id=p_person_id for update;
  select exists(select 1 from work_schedules where organization_id=p_organization_id and person_id=p_person_id
    and active=true and arrangement='flexible' and (effective_to is null or effective_to >= current_date)) into v_flexible_official;
  v_timezone_changed := p_onboarding_patch ? 'timezone'
    and coalesce(p_onboarding_patch->>'timezone','') is distinct from coalesce(v_existing.timezone,'');
  if v_flexible_official then v_patch := v_patch - 'timezone'; end if;
  v_review := (v_schedule is not null and (
    v_schedule->>'arrangement' = 'flexible'
    or v_existing.schedule_proposal->>'arrangement' = 'flexible'
    or v_flexible_official
  )) or (v_flexible_official and v_timezone_changed);
  if coalesce(v_review,false) then
    select * into v_row from work_save_employee_account_settings_scheduled(
      p_organization_id,p_person_id,p_expected_revision,p_mutation_key,v_patch,p_person_patch);
    -- Idempotent replay or an unchanged profile save does not reopen review.
    if v_row.draft_revision > coalesce(v_existing.draft_revision,0)
      and (v_schedule is distinct from v_existing.schedule_proposal or v_timezone_changed) then
      update work_employee_onboarding set
        schedule_proposal=coalesce(v_schedule,schedule_proposal),
        timezone=case when v_timezone_changed then p_onboarding_patch->>'timezone' else timezone end,
        status='submitted',employee_submitted_at=now(),reviewed_by=null,reviewed_at=null,review_note=null
        where organization_id=p_organization_id and person_id=p_person_id returning * into v_row;
    end if;
    return v_row;
  end if;
  return work_save_employee_account_settings_scheduled(
    p_organization_id,p_person_id,p_expected_revision,p_mutation_key,p_onboarding_patch,p_person_patch);
end $$;

-- The wrapper is a new function object, so re-apply the service-only ACL the
-- original settings RPC carried. Without this, `security definer` would be
-- executable by anon/authenticated callers.
revoke all on function public.work_save_employee_account_settings(uuid,uuid,integer,text,jsonb,jsonb) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function public.work_save_employee_account_settings(uuid,uuid,integer,text,jsonb,jsonb) from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on function public.work_save_employee_account_settings(uuid,uuid,integer,text,jsonb,jsonb) from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.work_save_employee_account_settings(uuid,uuid,integer,text,jsonb,jsonb) to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
