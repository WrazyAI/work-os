-- Allow a review to cover any bounded analysis window, not only one fixed
-- semimonthly period. The pay date remains the anchor used by pay runs,
-- retention and exports; the stored period is authoritative for the analysis.
begin;

alter table work_payroll_reviews add column if not exists window_key text;
update work_payroll_reviews
  set window_key = to_char(period_start,'YYYY-MM-DD') || '_' || to_char(period_end,'YYYY-MM-DD')
  where window_key is null;
alter table work_payroll_reviews alter column window_key set not null;

alter table work_payroll_reviews drop constraint if exists work_payroll_reviews_organization_id_person_id_pay_date_key;
alter table work_payroll_reviews drop constraint if exists work_payroll_reviews_check;
alter table work_payroll_reviews drop constraint if exists work_payroll_reviews_check1;

create unique index if not exists work_payroll_reviews_window_key
  on work_payroll_reviews(organization_id, person_id, window_key);
create index if not exists work_payroll_reviews_person_window_idx
  on work_payroll_reviews(organization_id, person_id, period_end desc, updated_at desc);

alter table work_payroll_reviews drop constraint if exists work_payroll_reviews_period_order_check;
alter table work_payroll_reviews add constraint work_payroll_reviews_period_order_check
  check (period_end >= period_start and period_end < pay_date);
alter table work_payroll_reviews drop constraint if exists work_payroll_reviews_period_length_check;
alter table work_payroll_reviews add constraint work_payroll_reviews_period_length_check
  check (period_end - period_start <= 30);
alter table work_payroll_reviews drop constraint if exists work_payroll_reviews_window_key_check;
alter table work_payroll_reviews add constraint work_payroll_reviews_window_key_check
  check (window_key = to_char(period_start,'YYYY-MM-DD') || '_' || to_char(period_end,'YYYY-MM-DD'));

create or replace function work_payroll_review_window_sync()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  -- The key is derived, never independently writable. Recomputing it on every
  -- write keeps a period correction from leaving a stale identity behind.
  NEW.window_key := to_char(NEW.period_start,'YYYY-MM-DD') || '_' || to_char(NEW.period_end,'YYYY-MM-DD');
  return NEW;
end $$;

drop trigger if exists work_payroll_review_window_sync on work_payroll_reviews;
create trigger work_payroll_review_window_sync
  before insert or update of period_start, period_end, window_key
  on work_payroll_reviews
  for each row execute function work_payroll_review_window_sync();

revoke all on function work_payroll_review_window_sync() from public;
do $$ begin
  execute format('grant execute on function work_payroll_review_window_sync() to %I', current_user);
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function work_payroll_review_window_sync() to service_role;
  end if;
end $$;

commit;
