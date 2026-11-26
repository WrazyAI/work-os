-- Scope screenshot summaries to the person who owns their evidence event.
-- Payroll reads, guarded frame access and retention all key on
-- (organization_id, person_id, summary_id); legacy rows were written before
-- that relationship was populated, so they could never be linked to a review.
begin;

update work_screenshot_summaries s
set person_id = e.person_id
from work_evidence_events e
where s.evidence_event_id = e.id
  and s.organization_id = e.organization_id
  and s.person_id is null
  and e.person_id is not null;

create or replace function work_screenshot_summary_person_sync()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
declare owner uuid;
declare owner_org uuid;
begin
  -- The production table requires an evidence event, but legacy fixtures and
  -- historical rows may not have one. Nothing can be inferred in that case.
  if NEW.evidence_event_id is null then
    return NEW;
  end if;
  select e.person_id, e.organization_id into owner, owner_org
    from public.work_evidence_events e
   where e.id = NEW.evidence_event_id;
  if not found then
    raise exception 'screenshot summary requires an evidence event';
  end if;
  if owner_org <> NEW.organization_id then
    raise exception 'screenshot summary organization does not match its evidence event';
  end if;
  if owner is not null then
    if NEW.person_id is not null and NEW.person_id <> owner then
      raise exception 'screenshot summary person does not match its evidence event';
    end if;
    NEW.person_id := owner;
  end if;
  return NEW;
end $$;

drop trigger if exists work_screenshot_summary_person_sync on work_screenshot_summaries;
create trigger work_screenshot_summary_person_sync
  before insert or update of evidence_event_id, person_id, organization_id
  on work_screenshot_summaries
  for each row execute function work_screenshot_summary_person_sync();

create index if not exists work_screenshot_summaries_person_idx
  on work_screenshot_summaries(organization_id, person_id, processing_status);

revoke all on function work_screenshot_summary_person_sync() from public;
do $$ begin
  execute format('grant execute on function work_screenshot_summary_person_sync() to %I', current_user);
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function work_screenshot_summary_person_sync() to service_role;
  end if;
end $$;

commit;
