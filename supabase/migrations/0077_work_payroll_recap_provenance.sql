-- Source-aware recap provenance. Existing reviewed rows stay readable as
-- employee decisions by derivation; no immutable payload or event is rewritten.
begin;
alter table work_activity_intervals add column if not exists review_source text;
alter table work_activity_intervals add column if not exists payroll_date date;
alter table work_recap_reviews add column if not exists review_source text not null default 'employee';
alter table work_recap_reviews add column if not exists payroll_date date;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'work_activity_intervals_review_source_check') then
    alter table work_activity_intervals add constraint work_activity_intervals_review_source_check
      check (review_source is null or review_source in ('employee','admin','payroll_auto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_activity_intervals_payroll_date_check') then
    alter table work_activity_intervals add constraint work_activity_intervals_payroll_date_check
      check ((review_source is distinct from 'payroll_auto') or payroll_date is not null);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_recap_reviews_review_source_check') then
    alter table work_recap_reviews add constraint work_recap_reviews_review_source_check
      check (review_source in ('employee','admin','payroll_auto'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'work_recap_reviews_payroll_date_check') then
    alter table work_recap_reviews add constraint work_recap_reviews_payroll_date_check
      check ((review_source = 'payroll_auto') = (payroll_date is not null));
  end if;
end $$;

create index if not exists work_activity_intervals_review_source_idx
  on work_activity_intervals (organization_id, review_source, reviewed_at desc)
  where review_source is not null;
create index if not exists work_recap_reviews_source_idx
  on work_recap_reviews (organization_id, review_source, reviewed_at desc);

comment on column work_activity_intervals.review_source is
  'employee|admin|payroll_auto for the current projection; null on legacy reviewed rows means employee.';
comment on column work_activity_intervals.payroll_date is
  'Pay date for a payroll_auto review; null for employee/admin decisions and legacy rows.';
comment on column work_recap_reviews.review_source is
  'Immutable approval actor for this recap version.';
comment on column work_recap_reviews.payroll_date is
  'Pay date fixed when a payroll_auto version was written.';
commit;
