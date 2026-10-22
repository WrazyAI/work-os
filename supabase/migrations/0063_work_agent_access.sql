-- Work OS agent access: scoped, self-minted credentials for external agents.
--
-- A token is bound to one organization, one person, and one user. Secrets are
-- stored as SHA-256 hex only; the raw value is shown once at creation. The
-- idempotency table is a response cache: status 0 means in-flight, a positive
-- status is a completed response. Task-level agent markers make creates
-- crash-safe under the partial unique index.

create table if not exists work_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists work_agent_tokens_person_idx on work_agent_tokens(organization_id, person_id);
create index if not exists work_agent_tokens_user_idx on work_agent_tokens(user_id);

create table if not exists work_agent_idempotency (
  organization_id uuid not null references work_organizations(id) on delete cascade,
  token_id uuid not null references work_agent_tokens(id) on delete cascade,
  key text not null,
  request_hash text not null,
  status smallint not null default 0,
  body jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (token_id, key)
);
create index if not exists work_agent_idempotency_expiry_idx on work_agent_idempotency(expires_at);

alter table work_tasks add column if not exists agent_token_id uuid references work_agent_tokens(id) on delete set null;
alter table work_tasks add column if not exists agent_idempotency_key text;
create unique index if not exists work_tasks_agent_idempotency_uidx
  on work_tasks(organization_id, agent_token_id, agent_idempotency_key)
  where agent_idempotency_key is not null;
alter table work_task_blockers add column if not exists agent_token_id uuid references work_agent_tokens(id) on delete set null;

-- The agent change feed: top-level tasks attributed to one person, including
-- archived and deleted tombstones when asked, ordered by row update time.
create or replace function public.work_agent_list_tasks(
  p_user_id uuid,
  p_organization_id uuid,
  p_person_id uuid,
  p_nifty_member_id text default null,
  p_updated_since timestamptz default null,
  p_include_archived boolean default false,
  p_ascending boolean default false,
  p_after_updated_at timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns table(task jsonb)
language sql
stable
set search_path = public
as $$
  select to_jsonb(t) as task
  from public.work_tasks t
  where t.user_id = p_user_id
    and t.organization_id = p_organization_id
    and t.parent_task_id is null
    and t.parent_provider_task_id is null
    and (p_include_archived or t.status not in ('archived', 'deleted'))
    and (p_updated_since is null or t.updated_at > p_updated_since)
    and (
      t.assignee_person_ids @> array[p_person_id]
      or (
        p_nifty_member_id is not null
        and (
          t.assignee_provider_ids @> array[p_nifty_member_id]
          or t.raw ->> 'created_by' = p_nifty_member_id
          or (t.raw -> 'subscribers') ? p_nifty_member_id
        )
      )
    )
    and (
      p_after_updated_at is null
      or (t.updated_at, t.id) > (p_after_updated_at, p_after_id)
    )
  order by
    case when p_ascending then t.updated_at end asc,
    case when p_ascending then t.id end asc,
    case when not p_ascending then t.updated_at end desc,
    case when not p_ascending then t.id end desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
$$;
