-- Correct the pilot schedule after the employee confirmed the intended
-- onboarding hours as 15:00-20:00 Atlantic/Reykjavik on 2026-08-25.
-- The correction is scoped, audited, and idempotent.

do $$
declare
  pilot_org uuid := 'b094c847-1332-4cab-9588-bdd7f8e99e7d';
  pilot_person uuid := '8772f360-f816-4914-9b99-849bdc573cb5';
  pilot_schedule uuid := '014158b2-488d-44a1-984b-de6895d53ec4';
  actor uuid;
begin
  if exists(select 1 from work_organizations where id=pilot_org and name='David Yeboah Workspace') then
    select user_id into actor from work_org_members
    where organization_id=pilot_org and person_id=pilot_person and role='admin' and active=true
    order by created_at limit 1;
    if actor is null then raise exception 'Expected active pilot admin membership was not found'; end if;
    if not exists(select 1 from work_schedules where id=pilot_schedule and organization_id=pilot_org and person_id=pilot_person and active=true) then
      raise exception 'Expected active pilot schedule was not found';
    end if;

    update work_schedules set
      timezone='Atlantic/Reykjavik', shift_start='15:00', shift_end='20:00', updated_at=now()
    where id=pilot_schedule and organization_id=pilot_org and person_id=pilot_person
      and (timezone,shift_start,shift_end) is distinct from ('Atlantic/Reykjavik','15:00'::time,'20:00'::time);

    update work_employee_onboarding set
      timezone='Atlantic/Reykjavik',
      schedule_proposal=jsonb_set(jsonb_set(schedule_proposal,'{shiftStart}','"15:00"'::jsonb,true),'{shiftEnd}','"20:00"'::jsonb,true),
      updated_at=now()
    where organization_id=pilot_org and person_id=pilot_person
      and (timezone is distinct from 'Atlantic/Reykjavik'
        or schedule_proposal->>'shiftStart' is distinct from '15:00'
        or schedule_proposal->>'shiftEnd' is distinct from '20:00');

    if not exists(
      select 1 from work_audit_log where organization_id=pilot_org
        and action='schedule.corrected_from_employee_confirmation' and target_id=pilot_schedule::text
    ) then
      insert into work_audit_log(organization_id,actor_user_id,action,target_type,target_id,metadata)
      values(pilot_org,actor,'schedule.corrected_from_employee_confirmation','schedule',pilot_schedule,
        jsonb_build_object('personId',pilot_person,'timezone','Atlantic/Reykjavik','shiftStart','15:00','shiftEnd','20:00','confirmedOn','2026-08-25'));
    end if;
  end if;
end $$;
