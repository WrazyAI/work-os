-- Agentic OS → WrazyAI Web Platform
-- Migration 0001: initial schema, RLS, signup trigger, realtime publication.
-- See WEB-PLATFORM-SPEC.md §5/§6. All user-owned tables enforce per-user
-- isolation via RLS (`user_id = auth.uid()`). The agent-runner connects with the
-- service_role key, which bypasses RLS, so it can read all queued jobs and write
-- any user's run_events.

-- ─────────────────────────────────────────────────────────────────────────────
-- Enums
-- ─────────────────────────────────────────────────────────────────────────────
create type agent_name as enum (
  'claude', 'codex', 'hermes', 'openclaw', 'gemini', 'antigravity', 'fcc'
);

create type job_status as enum (
  'queued', 'running', 'done', 'failed', 'canceled'
);

create type run_status as enum (
  'running', 'completed', 'failed', 'stopped'
);

create type user_role as enum ('owner', 'member');

-- ─────────────────────────────────────────────────────────────────────────────
-- Identity: profiles (1:1 with auth.users)
-- ─────────────────────────────────────────────────────────────────────────────
create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  display_name text,
  role        user_role not null default 'member',
  created_at  timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: read own" on profiles
  for select using (id = auth.uid());
create policy "profiles: update own" on profiles
  for update using (id = auth.uid());

-- Auto-create a profile row when a new auth user is created (invite-only: the
-- owner provisions users via Supabase Auth admin, this trigger fills profiles).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Helper: reusable "owns the row" predicate is just `user_id = auth.uid()`.

-- ─────────────────────────────────────────────────────────────────────────────
-- Conversations: threads + messages  (replaces vault Memories / chat history)
-- ─────────────────────────────────────────────────────────────────────────────
create table threads (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  agent       agent_name not null,
  title       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index threads_user_idx on threads (user_id, updated_at desc);

create table messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references threads (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null check (role in ('user', 'assistant', 'system')),
  text        text not null default '',
  meta        jsonb,
  created_at  timestamptz not null default now()
);
create index messages_thread_idx on messages (thread_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- Goals + journal  (replaces Goals.md / Journal/<date>.md)
-- ─────────────────────────────────────────────────────────────────────────────
create table goals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  text        text not null,
  done        boolean not null default false,
  category    text,
  created_at  timestamptz not null default now()
);
create index goals_user_idx on goals (user_id, done, created_at);

create table journal_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entry_date  date not null,
  time        text,
  text        text not null,
  created_at  timestamptz not null default now()
);
create index journal_user_date_idx on journal_entries (user_id, entry_date);

-- ─────────────────────────────────────────────────────────────────────────────
-- Kanban (MIRROR model — Hermes SQLite stays authoritative; the runner syncs
-- read-model snapshots into these tables for display. Writes still go through
-- the `hermes kanban` CLI. See spec §5 / §11 decision 1.)
-- ─────────────────────────────────────────────────────────────────────────────
create table boards (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  slug        text not null,
  name        text not null,
  is_current  boolean not null default false,
  synced_at   timestamptz not null default now(),
  unique (user_id, slug)
);

create table tasks (
  id              text not null,                     -- Hermes task id (t_…)
  board_id        uuid not null references boards (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  title           text not null default '',
  body            text,
  assignee        text,
  status          text not null default 'todo',
  priority        integer not null default 0,
  workspace_kind  text,
  workspace_path  text,
  result          text,
  skills          jsonb not null default '[]'::jsonb,
  created_at      timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  synced_at       timestamptz not null default now(),
  primary key (board_id, id)
);
create index tasks_user_idx on tasks (user_id, status, priority desc);

create table task_events (
  id          bigint generated always as identity primary key,
  board_id    uuid not null references boards (id) on delete cascade,
  task_id     text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null,
  payload     jsonb,
  created_at  timestamptz
);

create table task_comments (
  id          bigint generated always as identity primary key,
  board_id    uuid not null references boards (id) on delete cascade,
  task_id     text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  author      text,
  body        text not null,
  created_at  timestamptz
);

create table task_runs (
  id          bigint generated always as identity primary key,
  board_id    uuid not null references boards (id) on delete cascade,
  task_id     text not null,
  user_id     uuid not null references auth.users (id) on delete cascade,
  profile     text,
  status      text,
  outcome     text,
  summary     text,
  error       text,
  metadata    jsonb,
  started_at  timestamptz,
  ended_at    timestamptz
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Runs  (replaces ~/.agentic-os/ultracode-runs/*.json — UltracodeRun shape)
-- ─────────────────────────────────────────────────────────────────────────────
create table runs (
  id            text primary key,                    -- e.g. uc-… run id
  user_id       uuid not null references auth.users (id) on delete cascade,
  prompt        text not null,
  project       text,
  model         text,
  ultracode     boolean not null default false,
  session_id    text,
  status        run_status not null default 'running',
  headline      text,
  result_text   text,
  live_text     text,
  cost_usd      numeric,
  num_turns     integer,
  duration_ms   bigint,
  tokens_total  bigint,
  subagents     jsonb not null default '[]'::jsonb,
  verdicts      jsonb not null default '[]'::jsonb,
  turns         jsonb not null default '[]'::jsonb,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index runs_user_idx on runs (user_id, started_at desc);

-- The streaming backbone: one row per NDJSON line/delta the runner forwards.
-- The browser subscribes to (run_id) via Realtime to render the live stream.
create table run_events (
  id          bigint generated always as identity primary key,
  run_id      text not null references runs (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  seq         integer not null,
  chunk       text not null,
  created_at  timestamptz not null default now(),
  unique (run_id, seq)
);
create index run_events_run_idx on run_events (run_id, seq);

-- ─────────────────────────────────────────────────────────────────────────────
-- Jobs  (the cloud → machine bridge)
-- ─────────────────────────────────────────────────────────────────────────────
create table jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  agent       agent_name not null,
  kind        text not null default 'chat',          -- chat | ultracode | seo | …
  args        jsonb not null default '[]'::jsonb,
  prompt      text,
  cwd         text,
  project     text,                                  -- scratch-project hint; runner resolves to a real cwd
  status      job_status not null default 'queued',
  run_id      text references runs (id) on delete set null,
  claimed_by  text,
  claimed_at  timestamptz,
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_queue_idx on jobs (status, created_at);
create index jobs_user_idx on jobs (user_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: every user-owned table — own rows only. service_role bypasses all of this.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'threads','messages','goals','journal_entries',
    'boards','tasks','task_events','task_comments','task_runs',
    'runs','run_events','jobs'
  ]
  loop
    execute format('alter table %I enable row level security;', t);
    execute format($f$
      create policy "%1$s: select own" on %1$I
        for select using (user_id = auth.uid());
    $f$, t);
    execute format($f$
      create policy "%1$s: insert own" on %1$I
        for insert with check (user_id = auth.uid());
    $f$, t);
    execute format($f$
      create policy "%1$s: update own" on %1$I
        for update using (user_id = auth.uid());
    $f$, t);
    execute format($f$
      create policy "%1$s: delete own" on %1$I
        for delete using (user_id = auth.uid());
    $f$, t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: publish the bridge tables so the runner sees jobs and the browser
-- sees run_events live. (Supabase ships a `supabase_realtime` publication.)
-- ─────────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table run_events;
alter publication supabase_realtime add table runs;
