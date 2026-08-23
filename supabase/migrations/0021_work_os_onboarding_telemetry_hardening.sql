-- Harden resumable onboarding, provider-derived breaks, and consent-gated screenshots.
-- All changes are additive so established installations retain their history.

alter table work_employee_onboarding add column if not exists draft_revision integer not null default 0 check (draft_revision >= 0);
alter table work_employee_onboarding add column if not exists draft_client_mutation_key text;
alter table work_sessions add column if not exists provider_break_seconds integer not null default 0 check (provider_break_seconds >= 0);
alter table work_sessions add column if not exists provider_break_observed_at timestamptz;
alter table work_sessions add column if not exists provider_break_provenance jsonb not null default '{}'::jsonb;

-- Configuration, not source code, enables Worktivity-authoritative breaks for the
-- pilot organization. Other organizations retain their existing manual behavior.
update work_organizations
set feature_flags = coalesce(feature_flags, '{}'::jsonb) || jsonb_build_object('worktivity_authoritative_breaks', true)
where slug = 'legacy-43dd7685c0d9453ca92bbbb998915862';

create or replace function work_submit_employee_onboarding(
  p_organization_id uuid,
  p_person_id uuid,
  p_actor_user_id uuid,
  p_expected_revision integer,
  p_mutation_key text,
  p_payload jsonb
) returns work_employee_onboarding
language plpgsql security definer set search_path = public
as $$
declare
  v_existing work_employee_onboarding;
  v_now timestamptz := now();
  v_row work_employee_onboarding;
  v_person_email text;
begin
  if coalesce(nullif(p_mutation_key, ''), '') = '' then
    raise exception 'onboarding mutation key is required';
  end if;
  if jsonb_typeof(p_payload) <> 'object'
    or coalesce(nullif(p_payload->>'preferredName', ''), '') = ''
    or coalesce(nullif(p_payload->>'email', ''), '') = ''
    or coalesce(nullif(p_payload->>'timezone', ''), '') = ''
    or jsonb_typeof(p_payload->'schedule') <> 'object'
    or jsonb_typeof(p_payload->'notifications') <> 'object'
    or jsonb_typeof(p_payload->'privacy') <> 'object'
    or jsonb_typeof(p_payload->'workPreferences') <> 'object'
    or jsonb_typeof(p_payload #> '{workPreferences,items}') <> 'array'
    or jsonb_array_length(p_payload #> '{workPreferences,items}') = 0
    or jsonb_typeof(p_payload->'notifications'->'desktopEnabled') <> 'boolean'
    or p_payload->>'policyVersion' <> 'work-tracking-v1'
    or p_payload->>'trackingPurpose' <> 'Employee work planning, task coordination, evidence collection, and manager-reviewable reporting within Work OS.'
    or p_payload->>'screenshotPurpose' <> 'Neutral screenshot summaries for approved Work OS activity context only.' then
    raise exception 'invalid final onboarding payload';
  end if;
  if not exists (select 1 from pg_timezone_names where name = p_payload->>'timezone') then
    raise exception 'timezone must be a canonical IANA timezone';
  end if;
  select email into v_person_email from work_people
    where organization_id = p_organization_id and id = p_person_id;
  if not found or lower(trim(v_person_email)) <> lower(trim(p_payload->>'email')) then
    raise exception 'onboarding identity does not match the mapped work person';
  end if;
  -- Legacy break windows remain stored for history elsewhere, but this policy
  -- makes Worktivity Status=2 the only break source for new onboarding input.
  if coalesce((select (feature_flags->>'worktivity_authoritative_breaks')::boolean
    from work_organizations where id = p_organization_id), false) then
    p_payload := jsonb_set(p_payload, '{schedule,breaks}', '[]'::jsonb, true);
  end if;
  select * into v_existing from work_employee_onboarding
    where organization_id = p_organization_id and person_id = p_person_id for update;
  if found and v_existing.draft_client_mutation_key = p_mutation_key and v_existing.status = 'submitted' then
    return v_existing;
  end if;
  if found and v_existing.draft_revision <> p_expected_revision then
    raise exception 'onboarding draft changed on another device' using errcode = '40001';
  end if;
  if not found and p_expected_revision <> 0 then
    raise exception 'onboarding draft changed on another device' using errcode = '40001';
  end if;

  insert into work_employee_onboarding (
    organization_id, person_id, preferred_name, confirmed_email, timezone, language,
    schedule_proposal, notification_preferences, privacy_preferences, work_preferences,
    catalog_version, draft_step, draft_updated_at, draft_revision, draft_client_mutation_key,
    profile_confirmed_at, employee_submitted_at, status, updated_at
  ) values (
    p_organization_id, p_person_id, p_payload->>'preferredName', p_payload->>'email',
    p_payload->>'timezone', p_payload->>'language', p_payload->'schedule',
    p_payload->'notifications', p_payload->'privacy', p_payload->'workPreferences',
    p_payload->>'catalogVersion', 'connected', v_now, coalesce(v_existing.draft_revision, 0) + 1,
    p_mutation_key, v_now, v_now, 'submitted', v_now
  ) on conflict (organization_id, person_id) do update set
    preferred_name = excluded.preferred_name, confirmed_email = excluded.confirmed_email,
    timezone = excluded.timezone, language = excluded.language, schedule_proposal = excluded.schedule_proposal,
    notification_preferences = excluded.notification_preferences, privacy_preferences = excluded.privacy_preferences,
    work_preferences = excluded.work_preferences, catalog_version = excluded.catalog_version,
    draft_step = excluded.draft_step, draft_updated_at = excluded.draft_updated_at,
    draft_revision = excluded.draft_revision, draft_client_mutation_key = excluded.draft_client_mutation_key,
    profile_confirmed_at = excluded.profile_confirmed_at, employee_submitted_at = excluded.employee_submitted_at,
    status = excluded.status, updated_at = excluded.updated_at
  returning * into v_row;

  update work_people set github_username = nullif(p_payload #>> '{workPreferences,githubUsername}', ''), updated_at = v_now
    where organization_id = p_organization_id and id = p_person_id;
  insert into work_consent_records (organization_id, person_id, policy_version, purpose, data_categories, decision, created_by, occurred_at, metadata)
    values
      (p_organization_id, p_person_id, p_payload->>'policyVersion', p_payload->>'trackingPurpose',
       array['identity_profile','work_schedule','task_project_data','activity_evidence','output_evidence','check_ins_reports'], 'accepted', p_actor_user_id, v_now, jsonb_build_object('source', p_payload->>'source')),
      (p_organization_id, p_person_id, p_payload->>'policyVersion', p_payload->>'screenshotPurpose',
       array['approved_screenshot_summaries'], 'accepted', p_actor_user_id, v_now, jsonb_build_object('source', p_payload->>'source'));
  insert into work_audit_log (organization_id, actor_user_id, action, target_type, target_id, metadata)
    values (p_organization_id, p_actor_user_id, 'onboarding.employee_submitted', 'person', p_person_id,
      jsonb_build_object('policyVersion', p_payload->>'policyVersion', 'mutationKey', p_mutation_key));
  return v_row;
end;
$$;

revoke all on function work_submit_employee_onboarding(uuid, uuid, uuid, integer, text, jsonb) from public;
