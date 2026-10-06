-- Work OS member UI state: per-user presentation flags that are not feature
-- entitlements or onboarding consent. Page-guide flags record which first-visit
-- guides an employee has seen so each page auto-opens at most once per account,
-- while staying replayable from the page header at any time.

alter table work_org_members
  add column if not exists ui_state jsonb not null default '{}'::jsonb;

create or replace function work_mark_guide_seen(p_membership_id uuid, p_guide text)
returns jsonb
language plpgsql
as $$
declare
  v_state jsonb;
begin
  if p_guide is null or p_guide !~ '^[a-z][a-z0-9_]{0,31}$' then
    raise exception 'a valid guide key is required';
  end if;
  update work_org_members
     set ui_state = jsonb_set(
           ui_state,
           '{guides}',
           case when jsonb_typeof(ui_state -> 'guides') = 'object' then ui_state -> 'guides' else '{}'::jsonb end
             || jsonb_build_object(p_guide, to_jsonb(now())),
           true
         ),
         updated_at = now()
   where id = p_membership_id
   returning ui_state into v_state;
  if v_state is null then
    raise exception 'work org member not found';
  end if;
  return v_state;
end;
$$;

create or replace function work_set_guide_auto_open(p_membership_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
as $$
declare
  v_state jsonb;
begin
  if p_enabled is null then
    raise exception 'a guide auto-open preference is required';
  end if;
  update work_org_members
     set ui_state = jsonb_set(ui_state, '{autoOpen}', to_jsonb(p_enabled), true),
         updated_at = now()
   where id = p_membership_id
   returning ui_state into v_state;
  if v_state is null then
    raise exception 'work org member not found';
  end if;
  return v_state;
end;
$$;

-- These helpers write another member's row state and are only ever invoked by
-- the authenticated Work OS API through the server client. Keep them off the
-- public PostgREST surface for every client role. The `authenticated` role
-- only exists on legacy Supabase databases, so its explicit grant is revoked
-- only where the role is present.
do $$
begin
  revoke execute on function work_mark_guide_seen(uuid, text) from public;
  revoke execute on function work_set_guide_auto_open(uuid, boolean) from public;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function work_mark_guide_seen(uuid, text) from authenticated;
    revoke execute on function work_set_guide_auto_open(uuid, boolean) from authenticated;
  end if;
end $$;
