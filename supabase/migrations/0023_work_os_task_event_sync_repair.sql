-- Repair exact provider completions observed after the Phase 1 backfill.
insert into work_task_day_events (organization_id,person_id,task_id,provider,provider_task_id,local_date,event_type,provenance,exact_at,observed_at,task_snapshot,metadata,idempotency_key)
select task.organization_id,coalesce(task.assignee_person_ids[1],creator.id,subscriber.id,prior.person_id),task.id,task.provider,task.provider_task_id,
  (task.completed_at at time zone coalesce((select onboarding.timezone from work_employee_onboarding onboarding where onboarding.organization_id=task.organization_id and onboarding.person_id=coalesce(task.assignee_person_ids[1],creator.id,subscriber.id,prior.person_id) limit 1),'UTC'))::date,
  'completed','migration_exact',task.completed_at,task.completed_at,
  jsonb_build_object('title',task.title,'completed',true,'status',task.status,'dueDate',task.due_date),
  jsonb_build_object('sourceField','raw.completed_on','repair','post-reliability-sync'),
  'nifty:completed:' || task.provider_task_id || ':' || task.completed_at::text
from work_tasks task
left join lateral (select person.id from work_people person where person.organization_id=task.organization_id and person.nifty_member_id=task.raw->>'created_by' limit 1) creator on true
left join lateral (select person.id from work_people person where person.organization_id=task.organization_id and person.nifty_member_id is not null and coalesce(task.raw->'subscribers','[]'::jsonb) ? person.nifty_member_id limit 1) subscriber on true
left join lateral (select event.person_id from work_task_day_events event where event.organization_id=task.organization_id and event.task_id=task.id order by event.observed_at limit 1) prior on true
where task.completed=true and task.completed_at is not null and coalesce(task.assignee_person_ids[1],creator.id,subscriber.id,prior.person_id) is not null
on conflict (organization_id,idempotency_key) do nothing;
