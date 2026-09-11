-- 0038: one EOD report per person per day.
-- Repeated "Draft EOD" taps used to insert a new work_reports row every time,
-- so the day view surfaced whichever draft happened to be newest. Reconcile the
-- historical duplicates first (keep the newest draft; never delete a submitted,
-- pending, or approved report), then enforce uniqueness going forward.

with ranked as (
  select id,
         row_number() over (
           partition by organization_id, person_id, report_date
           order by
             case when submitted_at is not null or status in ('pending_review', 'approved') then 0 else 1 end,
             created_at desc,
             id desc
         ) as rn
    from work_reports
   where kind = 'eod' and person_id is not null
)
delete from work_reports r
 using ranked
 where r.id = ranked.id
   and ranked.rn > 1
   and r.status in ('draft', 'rejected');

create unique index if not exists work_reports_daily_eod_uidx
  on work_reports (organization_id, person_id, report_date)
  where kind = 'eod' and person_id is not null;

analyze work_reports;
