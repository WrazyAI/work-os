-- Profile fact review state for Work Memory. Episodic items default to
-- confirmed (they are recorded facts); extracted profile facts start as
-- candidates until the employee confirms them.

alter table work_memory_items
  add column if not exists review_status text not null default 'confirmed',
  add column if not exists fact_key text;

alter table work_memory_items drop constraint if exists work_memory_items_review_status_check;
alter table work_memory_items
  add constraint work_memory_items_review_status_check check (review_status in ('candidate', 'confirmed', 'rejected'));

create index if not exists work_memory_items_facts_idx
  on work_memory_items (organization_id, person_id, kind, review_status, occurred_at desc);
