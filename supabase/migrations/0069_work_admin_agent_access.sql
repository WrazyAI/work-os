-- Admin-scoped agent access. Additive: existing employee tokens keep their
-- person binding; only the admin kind may omit it.

alter table work_agent_tokens
  add column if not exists kind text not null default 'employee';
alter table work_agent_tokens
  alter column person_id drop not null;

do $$ begin
  alter table work_agent_tokens
    add constraint work_agent_tokens_kind_check
    check (kind in ('employee', 'admin'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table work_agent_tokens
    add constraint work_agent_tokens_person_kind_check
    check (kind = 'admin' or person_id is not null);
exception when duplicate_object then null; end $$;

create index if not exists work_agent_tokens_kind_user_idx
  on work_agent_tokens(organization_id, kind, user_id);

create table if not exists work_admin_action_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  user_id uuid not null,
  token_id uuid references work_agent_tokens(id) on delete cascade,
  source text not null check (source in ('api', 'otto')),
  action text not null,
  target_type text not null,
  target_id text,
  request jsonb not null,
  preview jsonb not null,
  state_fingerprint jsonb not null default '{}'::jsonb,
  result_status smallint,
  result_body jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz
);
create index if not exists work_admin_action_previews_token_idx
  on work_admin_action_previews(token_id, expires_at);
create index if not exists work_admin_action_previews_user_idx
  on work_admin_action_previews(user_id, expires_at);

alter table work_admin_action_previews enable row level security;
revoke all on work_admin_action_previews from public;
