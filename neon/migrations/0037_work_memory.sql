-- Work Memory: agent episodic memory + server-side conversation store.
--
-- Memory rows are organization + person scoped; access control is enforced at
-- the application layer (the service-role connection bypasses RLS, matching the
-- rest of the Work OS tables). Embeddings are Cohere embed-v4.0 at 1024 dims,
-- matching the existing note_embedding_chunks pgvector pattern.

create extension if not exists vector;

create table if not exists work_memory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  kind text not null,
  occurred_at timestamptz not null default now(),
  local_date date,
  source_table text not null,
  source_id text not null,
  content text not null,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null,
  embedding vector(1024),
  embedding_provider text not null default 'cohere',
  embedding_model text not null default 'embed-v4.0',
  visibility text not null default 'self',
  consent_purpose text,
  search tsvector generated always as (to_tsvector('english'::regconfig, coalesce(content, ''))) stored,
  created_at timestamptz not null default now(),
  constraint work_memory_items_kind_check check (
    kind in ('check_in', 'plan', 'task_event', 'evidence', 'screenshot', 'eod', 'conversation', 'digest', 'profile_fact')
  ),
  constraint work_memory_items_visibility_check check (visibility in ('self', 'manager'))
);

create unique index if not exists work_memory_items_source_dedupe_idx
  on work_memory_items (organization_id, source_table, source_id, content_hash);
create index if not exists work_memory_items_scope_idx
  on work_memory_items (organization_id, person_id, occurred_at desc);
create index if not exists work_memory_items_kind_idx
  on work_memory_items (organization_id, person_id, kind, occurred_at desc);
create index if not exists work_memory_items_search_idx
  on work_memory_items using gin (search);
create index if not exists work_memory_items_embedding_idx
  on work_memory_items using hnsw (embedding vector_cosine_ops)
  where embedding is not null;

create table if not exists work_memory_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  kind text not null,
  source_table text not null,
  source_id text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_memory_jobs_status_check check (status in ('pending', 'processing', 'done', 'failed')),
  constraint work_memory_jobs_source_key unique (organization_id, source_table, source_id)
);

create index if not exists work_memory_jobs_pending_idx
  on work_memory_jobs (created_at)
  where status = 'pending';

create table if not exists work_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  local_date date not null,
  scope_key text not null,
  summary text,
  summarized_through timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_conversations_scope_key unique (organization_id, person_id, scope_key)
);

create table if not exists work_conversation_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references work_conversations(id) on delete cascade,
  organization_id uuid not null,
  person_id uuid not null,
  role text not null,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  constraint work_conversation_turns_role_check check (role in ('user', 'assistant')),
  constraint work_conversation_turns_idempotency_key unique (conversation_id, idempotency_key)
);

create index if not exists work_conversation_turns_conversation_idx
  on work_conversation_turns (conversation_id, created_at);
