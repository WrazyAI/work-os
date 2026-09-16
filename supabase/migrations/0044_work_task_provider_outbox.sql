-- Exactly-once provider creation for create_task proposals.
--
-- applyProposal used to reconcile a retried filing only through a marker
-- inside the mirrored work_tasks row. A crash after the Nifty POST but before
-- the mirror write therefore made the next retry create a SECOND Nifty task:
-- the new task has a different provider id, so the mirror's unique key could
-- never catch it. The proposal row is the durable intent; record the provider
-- id on it as soon as the provider returns one (fenced by apply_attempt), and
-- every retry adopts that task instead of creating another. The description
-- marker remains the fallback for the narrow window between the POST and this
-- write.

alter table work_task_proposals add column if not exists provider_task_id text;

create index if not exists work_task_proposals_provider_task_idx
  on work_task_proposals (organization_id, provider_task_id)
  where provider_task_id is not null;
