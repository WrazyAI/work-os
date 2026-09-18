-- Group several task operations into one reviewable batch.
--
-- Neon lineage note: the platform's runtime data layer is Neon (DATABASE_URL),
-- while `npm run db:apply` targets the Supabase project. This file is identical
-- to supabase/migrations/0049_work_task_proposal_batches.sql so both lineages
-- carry the change; it was applied to the live Neon branch directly.
--
-- A multi_task_add / multi_task_edit interpretation expands into the existing
-- per-item proposals (create_task, add_subtask, update_task, complete_task, …)
-- so every item keeps the exactly-once provider machinery from 0042/0044/0047.
-- These columns are the grouping: which batch an item belongs to, its order, its
-- agent-assigned client id, and — for a subtask whose parent is created in the
-- same batch — the client id of that parent, resolved when the batch is filed.
--
-- decided_change records the employee's edits separately from the agent's
-- proposed_change, so the audit trail keeps both.

alter table work_task_proposals add column if not exists batch_id uuid;
alter table work_task_proposals add column if not exists batch_index integer;
alter table work_task_proposals add column if not exists client_id text;
alter table work_task_proposals add column if not exists parent_client_id text;
alter table work_task_proposals add column if not exists batch_kind text;
alter table work_task_proposals add column if not exists decided_change jsonb;

create index if not exists work_task_proposals_batch_idx
  on work_task_proposals (organization_id, batch_id)
  where batch_id is not null;
