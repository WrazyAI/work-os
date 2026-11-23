-- A Worktivity employee mapping on the person is the roster authority. New or
-- changed mappings inherit a verified payroll source account without requiring
-- a second manual integration save. The account remains scoped to the person's
-- organization; unrelated provider rows are untouched.
begin;

create or replace function public.work_source_account_from_worktivity_mapping()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.worktivity_employee_id is null or btrim(new.worktivity_employee_id) = '' then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.worktivity_employee_id is distinct from new.worktivity_employee_id
     and old.worktivity_employee_id is not null
     and btrim(old.worktivity_employee_id) <> '' then
    update public.work_source_accounts
       set person_id = null, verified = false, updated_at = clock_timestamp()
     where organization_id = new.organization_id
       and provider = 'worktivity'
       and external_account_id = btrim(old.worktivity_employee_id)
       and person_id = new.id;
  end if;

  insert into public.work_source_accounts
    (organization_id, provider, external_account_id, person_id, verified, verified_at, metadata)
  values
    (new.organization_id, 'worktivity', btrim(new.worktivity_employee_id), new.id, true, clock_timestamp(),
     jsonb_build_object('source', 'worktivity_person_mapping'))
  on conflict (organization_id, provider, external_account_id) do update
    set person_id = excluded.person_id,
        verified = true,
        verified_at = coalesce(public.work_source_accounts.verified_at, excluded.verified_at),
        metadata = public.work_source_accounts.metadata || excluded.metadata,
        updated_at = clock_timestamp();

  return new;
end;
$$;

drop trigger if exists work_source_account_from_worktivity_mapping on public.work_people;
create trigger work_source_account_from_worktivity_mapping
  after insert or update of worktivity_employee_id on public.work_people
  for each row execute function public.work_source_account_from_worktivity_mapping();

revoke all on function public.work_source_account_from_worktivity_mapping() from public;
do $$ begin
  execute format('grant execute on function public.work_source_account_from_worktivity_mapping() to %I', current_user);
  if exists(select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.work_source_account_from_worktivity_mapping() to service_role;
  end if;
end $$;

commit;
