-- Session-confirmed task creates have no bearer-token row. The preview UUID is
-- their deterministic creation key, so an interrupted confirmation can replay
-- without duplicating the task. API-token creation retains its existing index.
create unique index if not exists work_tasks_session_create_idempotency_idx
  on work_tasks (organization_id, agent_idempotency_key)
  where agent_token_id is null and agent_idempotency_key is not null;

-- Only explicit workflow keys deduplicate session previews. Older unkeyed
-- session previews retain their original independent-creation semantics.
create unique index if not exists work_admin_otto_preview_step_key
  on work_admin_action_previews (organization_id, user_id, idempotency_key)
  where token_id is null and source = 'otto' and idempotency_key like 'otto-workflow:%';
