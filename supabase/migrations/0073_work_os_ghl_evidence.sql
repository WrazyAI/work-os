-- GHL evidence: resumable sync checkpoints, encrypted content excerpts, and
-- machine-generated content references for retention redaction.
--
-- All three tables are server-only. They are read and written by the Work OS
-- backend role, never by a browser/member role, so RLS is enabled with no
-- policies and PUBLIC privileges are revoked.

create table if not exists work_ghl_sync_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  connection_id uuid not null references work_provider_connections(id) on delete cascade,
  kind text not null,
  partition_key text not null,
  state text not null default 'pending' check (state in ('pending','running','complete','partial','failed')),
  range_from timestamptz,
  range_through timestamptz,
  completed_through timestamptz,
  cursor_value text,
  scanned integer not null default 0,
  capped boolean not null default false,
  coverage jsonb not null default '{}'::jsonb,
  failure_reason text,
  mapping_revision text,
  lease_owner text,
  lease_expires_at timestamptz,
  revision bigint not null default 0,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, kind, partition_key)
);
create index if not exists work_ghl_sync_state_org_idx
  on work_ghl_sync_state (organization_id, kind, state, updated_at desc);
create index if not exists work_ghl_sync_state_lease_idx
  on work_ghl_sync_state (lease_expires_at)
  where lease_owner is not null;

create table if not exists work_ghl_email_content (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  connection_id uuid not null references work_provider_connections(id) on delete cascade,
  evidence_event_id uuid not null references work_evidence_events(id) on delete cascade,
  content_hash text not null,
  excerpt_cipher text,
  summary_cipher text,
  analysis_version text,
  source_occurred_at timestamptz,
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  content_purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evidence_event_id)
);
create index if not exists work_ghl_email_content_expiry_idx
  on work_ghl_email_content (organization_id, expires_at)
  where content_purged_at is null;

create table if not exists work_ghl_content_references (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  content_id uuid not null references work_ghl_email_content(id) on delete cascade,
  consumer_table text not null,
  consumer_id text not null,
  consumer_field text not null,
  created_at timestamptz not null default now(),
  unique (content_id, consumer_table, consumer_id, consumer_field)
);
create index if not exists work_ghl_content_references_consumer_idx
  on work_ghl_content_references (organization_id, consumer_table, consumer_id);

alter table work_ghl_sync_state enable row level security;
alter table work_ghl_email_content enable row level security;
alter table work_ghl_content_references enable row level security;

revoke all on table work_ghl_sync_state from public;
revoke all on table work_ghl_email_content from public;
revoke all on table work_ghl_content_references from public;
