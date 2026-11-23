-- Payroll's source token must fence the evidence the run actually reads, not
-- every organization-level event. Background evidence/report/provider writes
-- otherwise invalidate a multi-minute analysis for unrelated reasons. Keep the
-- person-scoped inputs and payroll settings; drop triggers for tables that are
-- not used by the payroll source manifest.
begin;

create or replace function public.work_payroll_source_touch() returns trigger
language plpgsql set search_path=pg_catalog,public,pg_temp as $$
declare new_row jsonb; old_row jsonb; org uuid; person uuid; cols text[]; col text;
  person_col text; org_col text; changed boolean := false;
begin
  new_row := case when tg_op='DELETE' then null else to_jsonb(NEW) end;
  old_row := case when tg_op='INSERT' then null else to_jsonb(OLD) end;
  org_col := coalesce(TG_ARGV[2],'organization_id');
  person_col := coalesce(TG_ARGV[1],'person_id');
  org := coalesce((new_row->>org_col)::uuid,(old_row->>org_col)::uuid);
  if org is null then return case when tg_op='DELETE' then OLD else NEW end; end if;
  if person_col <> 'none' then
    person := coalesce((new_row->>person_col)::uuid,(old_row->>person_col)::uuid);
    -- A source row with no person is not this person's payroll evidence. Do
    -- not collapse it into the organization policy token.
    if person is null then return case when tg_op='DELETE' then OLD else NEW end; end if;
  end if;
  if tg_op <> 'UPDATE' then changed := true;
  else
    cols := string_to_array(coalesce(TG_ARGV[0],''),',');
    if cols is null or cardinality(cols)=0 then changed := true;
    else
      foreach col in array cols loop
        if (new_row->col) is distinct from (old_row->col) then changed := true; exit; end if;
      end loop;
    end if;
  end if;
  if changed then
    insert into public.work_payroll_source_versions(organization_id,person_id,version)
      values(org,coalesce(person,'00000000-0000-0000-0000-000000000000'::uuid),1)
      on conflict (organization_id,person_id) do update
        set version=public.work_payroll_source_versions.version+1, updated_at=now();
  end if;
  return case when tg_op='DELETE' then OLD else NEW end;
end $$;

do $$ declare t text; begin
  foreach t in array array['work_evidence_events','work_reports','work_report_versions','work_task_day_events','work_provider_connections','work_organizations'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists work_payroll_source_touch on %I',t);
    end if;
  end loop;
end $$;

revoke all on function public.work_payroll_source_touch() from public;
do $$ begin
  execute format('grant execute on function public.work_payroll_source_touch() to %I', current_user);
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function public.work_payroll_source_touch() to service_role;
  end if;
end $$;

commit;
