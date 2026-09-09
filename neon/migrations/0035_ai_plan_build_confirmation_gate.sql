-- A successful AI build authorizes exactly one matching daily-plan confirmation.
-- Only the SHA-256 fingerprint is retained; employee intent remains on the plan.
create table if not exists work_daily_plan_builds (
  id uuid primary key,
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  shift_date date not null,
  intent_fingerprint text not null check (intent_fingerprint ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_idempotency_key text,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists work_daily_plan_builds_expiry_idx on work_daily_plan_builds (expires_at);
alter table work_daily_plan_builds enable row level security;

drop function if exists work_save_daily_plan_draft(
  uuid, uuid, uuid, integer, text, text, text, text[], text, jsonb, jsonb, jsonb, uuid[], boolean, uuid, timestamptz
);

create or replace function work_save_daily_plan_draft(
  p_organization_id uuid,
  p_person_id uuid,
  p_plan_id uuid,
  p_expected_revision integer,
  p_idempotency_key text,
  p_freeform_intent text,
  p_goal_provenance text,
  p_suggestion_task_ids text[],
  p_focus_summary text,
  p_interpretation_metadata jsonb,
  p_clarification_answers jsonb,
  p_items jsonb,
  p_remove_outcome_ids uuid[],
  p_confirm boolean,
  p_session_id uuid,
  p_first_follow_up_at timestamptz,
  p_build_id uuid,
  p_intent_fingerprint text
) returns table(revision integer, replayed boolean)
language plpgsql
as $$
declare
  v_revision integer;
  v_existing_count integer;
  v_changed_count integer;
  v_deleted_count integer;
  v_build_id uuid;
  v_now timestamptz := now();
begin
  select mutation.revision into v_revision
  from work_daily_plan_mutations mutation
  where mutation.organization_id = p_organization_id
    and mutation.plan_id = p_plan_id
    and mutation.idempotency_key = p_idempotency_key;
  if found then
    return query select v_revision, true;
    return;
  end if;

  if p_confirm then
    if p_build_id is null or p_intent_fingerprint is null then
      raise exception 'An AI build id and intent fingerprint are required for plan confirmation.';
    end if;
    select build.id into v_build_id
    from work_daily_plan_builds build
    join work_daily_plans plan on plan.id = p_plan_id
      and plan.organization_id = p_organization_id
      and plan.person_id = p_person_id
    where build.id = p_build_id
      and build.organization_id = p_organization_id
      and build.person_id = p_person_id
      and build.shift_date = plan.shift_date
      and build.intent_fingerprint = p_intent_fingerprint
      and build.expires_at > v_now
      and build.consumed_at is null
    for update of build;
    if not found then
      select mutation.revision into v_revision
      from work_daily_plan_mutations mutation
      where mutation.organization_id = p_organization_id
        and mutation.plan_id = p_plan_id
        and mutation.idempotency_key = p_idempotency_key;
      if found then
        return query select v_revision, true;
        return;
      end if;
      raise exception 'AI build confirmation is invalid, expired, already used, or does not match this plan intent.';
    end if;
  end if;

  update work_daily_plans plan
  set freeform_intent = p_freeform_intent,
      goal_provenance = p_goal_provenance,
      suggestion_task_ids = to_jsonb(coalesce(p_suggestion_task_ids, array[]::text[])),
      focus_summary = p_focus_summary,
      interpretation_metadata = coalesce(p_interpretation_metadata, '{}'::jsonb),
      clarification_answers = coalesce(p_clarification_answers, '{}'::jsonb),
      status = case when p_confirm then 'confirmed' else plan.status end,
      confirmation_idempotency_key = case when p_confirm then p_idempotency_key else plan.confirmation_idempotency_key end,
      confirmed_at = case when p_confirm then coalesce(plan.confirmed_at, v_now) else plan.confirmed_at end,
      revision = p_expected_revision + 1,
      updated_at = v_now
  where plan.organization_id = p_organization_id
    and plan.person_id = p_person_id
    and plan.id = p_plan_id
    and plan.revision = p_expected_revision
    and plan.status <> 'closed'
  returning plan.revision into v_revision;

  if not found then
    select mutation.revision into v_revision
    from work_daily_plan_mutations mutation
    where mutation.organization_id = p_organization_id
      and mutation.plan_id = p_plan_id
      and mutation.idempotency_key = p_idempotency_key;
    if found then
      return query select v_revision, true;
      return;
    end if;
    raise exception 'This plan changed on another device. Refresh before saving again.';
  end if;

  select count(*) into v_existing_count
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) item
  where item ? 'id';

  with changed as (
    update work_daily_plan_items item
    set rank = (payload.value->>'rank')::integer,
        disposition = payload.value->>'disposition',
        title_snapshot = payload.value->>'title_snapshot',
        completion_state = payload.value->>'completion_state',
        completed_at = case
          when payload.value->>'completion_state' = 'completed' then coalesce(item.completed_at, v_now)
          else null
        end,
        objective = nullif(payload.value->>'objective', ''),
        success_criteria = coalesce(payload.value->'success_criteria', '[]'::jsonb),
        estimate_minutes = nullif(payload.value->>'estimate_minutes', '')::integer,
        source_refs = coalesce(payload.value->'source_refs', '[]'::jsonb),
        clarification_state = nullif(payload.value->>'clarification_state', ''),
        updated_at = v_now
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) payload(value)
    where payload.value ? 'id'
      and item.organization_id = p_organization_id
      and item.plan_id = p_plan_id
      and item.person_id = p_person_id
      and item.id = (payload.value->>'id')::uuid
    returning item.id
  ) select count(*) into v_changed_count from changed;

  if v_changed_count <> v_existing_count then
    raise exception 'A daily plan item changed before the plan was saved.';
  end if;

  insert into work_daily_plan_items (
    organization_id, plan_id, person_id, task_id, source, disposition, rank,
    title_snapshot, item_kind, completion_state, completed_at, objective,
    success_criteria, estimate_minutes, source_refs, clarification_state, updated_at
  )
  select
    p_organization_id, p_plan_id, p_person_id, null, 'unplanned',
    payload.value->>'disposition', (payload.value->>'rank')::integer,
    payload.value->>'title_snapshot', 'outcome', payload.value->>'completion_state',
    case when payload.value->>'completion_state' = 'completed' then v_now else null end,
    nullif(payload.value->>'objective', ''),
    coalesce(payload.value->'success_criteria', '[]'::jsonb),
    nullif(payload.value->>'estimate_minutes', '')::integer,
    coalesce(payload.value->'source_refs', '[]'::jsonb),
    nullif(payload.value->>'clarification_state', ''), v_now
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) payload(value)
  where not payload.value ? 'id';

  with removed as (
    delete from work_daily_plan_items item
    where item.organization_id = p_organization_id
      and item.plan_id = p_plan_id
      and item.person_id = p_person_id
      and item.item_kind = 'outcome'
      and item.id = any(coalesce(p_remove_outcome_ids, array[]::uuid[]))
    returning item.id
  ) select count(*) into v_deleted_count from removed;

  if v_deleted_count <> cardinality(coalesce(p_remove_outcome_ids, array[]::uuid[])) then
    raise exception 'A daily plan outcome changed before the plan was saved.';
  end if;

  if p_confirm then
    update work_daily_plan_builds build
    set consumed_at = v_now,
        consumed_idempotency_key = p_idempotency_key
    where build.id = v_build_id
      and build.consumed_at is null;
    if not found then
      raise exception 'AI build confirmation is invalid, expired, already used, or does not match this plan intent.';
    end if;
  end if;

  if p_confirm and p_session_id is not null and p_first_follow_up_at is not null then
    update work_sessions session
    set first_follow_up_at = coalesce(session.first_follow_up_at, p_first_follow_up_at),
        next_fallback_at = null,
        last_prompt_kind = null,
        last_prompt_at = null,
        updated_at = v_now
    where session.organization_id = p_organization_id
      and session.person_id = p_person_id
      and session.id = p_session_id
      and session.first_follow_up_at is null;
  end if;

  insert into work_daily_plan_mutations (organization_id, plan_id, idempotency_key, revision)
  values (p_organization_id, p_plan_id, p_idempotency_key, v_revision);

  return query select v_revision, false;
end;
$$;
