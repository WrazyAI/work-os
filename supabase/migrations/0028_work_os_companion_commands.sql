-- Durable command receipts prevent offline retries from duplicating approved AI work.
create table if not exists work_companion_commands (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  idempotency_key text not null,
  payload_hash text not null,
  status text not null check (status in ('processing', 'succeeded', 'needs_attention')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, person_id, idempotency_key)
);

create table if not exists work_companion_command_operations (
  id uuid primary key default gen_random_uuid(),
  command_id uuid not null references work_companion_commands(id) on delete cascade,
  operation_index integer not null,
  status text not null check (status in ('processing', 'succeeded', 'needs_attention')),
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (command_id, operation_index)
);

alter table work_companion_commands enable row level security;
alter table work_companion_command_operations enable row level security;

create index if not exists work_companion_commands_person_idx
  on work_companion_commands(organization_id, person_id, created_at desc);
