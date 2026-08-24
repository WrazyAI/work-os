-- Audited Phase 1 pilot corrections approved by the employee on 2026-08-24.
-- The migration is inert outside the named pilot organization and idempotent.

do $$
declare
  pilot_org uuid := 'b094c847-1332-4cab-9588-bdd7f8e99e7d';
  pilot_person uuid := '8772f360-f816-4914-9b99-849bdc573cb5';
  duplicate_person uuid := '7da461ce-83a5-40d5-8bf3-27e358f04351';
  target_session work_sessions%rowtype;
  actor uuid;
  corrected_at timestamptz := '2026-08-21T20:06:00.000Z';
begin
  if exists(select 1 from work_organizations where id=pilot_org and name='David Yeboah Workspace') then
    select * into target_session from work_sessions
    where organization_id=pilot_org and person_id=pilot_person and shift_date='2026-08-21'
    for update;
    if not found then raise exception 'Expected August 21 pilot session was not found'; end if;

    if target_session.clocked_out_at is null and target_session.correction_status='needs_correction' then
      if corrected_at <= target_session.clocked_in_at then raise exception 'Approved correction must be after clock-in'; end if;
      select user_id into actor from work_org_members
      where organization_id=pilot_org and person_id=pilot_person and active=true
      order by case role when 'admin' then 0 else 1 end limit 1;

      update work_sessions set
        state='clocked_out', clocked_out_at=corrected_at,
        clock_out_idempotency_key='phase1:missed-clockout:2026-08-21:20:06',
        correction_status='corrected',
        correction_reason='Employee confirmed the missed clock-out time as 8:06 PM Atlantic/Reykjavik',
        correction_timestamp=corrected_at, correction_provenance='employee_entered',
        corrected_at=now(), corrected_by=actor, paused_at=null, updated_at=now()
      where id=target_session.id;

      insert into work_session_events(
        organization_id,person_id,session_id,event_type,from_state,to_state,source,
        observed_at,actor_user_id,idempotency_key,metadata
      ) values (
        pilot_org,pilot_person,target_session.id,'resolve_missed_clock_out',target_session.state,'clocked_out','desktop',
        corrected_at,actor,'phase1:missed-clockout:2026-08-21:20:06',
        jsonb_build_object('provenance','employee_entered','approvedOn','2026-08-24','timezone','Atlantic/Reykjavik')
      ) on conflict (organization_id,idempotency_key) do nothing;

      update work_daily_plans set status='closed',updated_at=now()
      where organization_id=pilot_org and session_id=target_session.id;
    elsif target_session.clocked_out_at is distinct from corrected_at or target_session.correction_status <> 'corrected' then
      raise exception 'August 21 pilot session is in an unexpected correction state';
    end if;
  end if;

  if exists(select 1 from work_people where id=duplicate_person and organization_id='f07d1e2f-f213-4d81-9972-8e862d635334') then
    if exists(select 1 from work_org_members where person_id=duplicate_person)
      or exists(select 1 from work_team_members where person_id=duplicate_person)
      or exists(select 1 from work_schedules where person_id=duplicate_person)
      or exists(select 1 from work_employee_onboarding where person_id=duplicate_person)
      or exists(select 1 from work_sessions where person_id=duplicate_person) then
      raise exception 'Duplicate pilot identity has active configuration dependencies and cannot be deactivated safely';
    end if;
    update work_people set
      active=false, nifty_member_id=null, worktivity_employee_id=null, updated_at=now()
    where id=duplicate_person;
  end if;
end $$;
