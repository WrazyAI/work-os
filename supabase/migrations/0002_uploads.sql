-- 0002: direct-to-Supabase-Storage resumable uploads (Option A).
-- Browser uploads straight to Storage (resumable/TUS — bypasses Cloudflare's
-- 100MB edge cap), then the agent-runner streams the object down to the box's
-- local disk for the CLI agents. Idempotent so it can be re-applied safely.
--
-- NOTE: on the FREE Supabase plan the per-file limit is 50MB (project setting).
-- Upgrading to Pro raises it; no code changes needed.

-- Private bucket. file_size_limit null = inherit the project global limit, so a
-- plan upgrade lifts it automatically.
insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', false, null)
on conflict (id) do update set public = false;

-- Per-user access: objects live at <user_id>/<filename>; users touch only their
-- own prefix. The runner uses the service role (bypasses these).
drop policy if exists "uploads insert own" on storage.objects;
create policy "uploads insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "uploads read own" on storage.objects;
create policy "uploads read own" on storage.objects
  for select to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "uploads update own" on storage.objects;
create policy "uploads update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "uploads delete own" on storage.objects;
create policy "uploads delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- Tracks each Storage upload + its sync down to the box's local disk.
create table if not exists upload_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  storage_path text not null,
  filename     text not null,
  size         bigint,
  status       text not null default 'pending' check (status in ('pending','syncing','ready','failed')),
  local_path   text,
  error        text,
  created_at   timestamptz not null default now(),
  ready_at     timestamptz
);
create index if not exists upload_jobs_user_idx on upload_jobs (user_id, created_at desc);
create index if not exists upload_jobs_status_idx on upload_jobs (status, created_at);

alter table upload_jobs enable row level security;
drop policy if exists "upload_jobs select own" on upload_jobs;
create policy "upload_jobs select own" on upload_jobs for select using (user_id = auth.uid());
drop policy if exists "upload_jobs insert own" on upload_jobs;
create policy "upload_jobs insert own" on upload_jobs for insert with check (user_id = auth.uid());
drop policy if exists "upload_jobs update own" on upload_jobs;
create policy "upload_jobs update own" on upload_jobs for update using (user_id = auth.uid());

-- Realtime so the client sees status flip to 'ready' and the runner sees inserts.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='upload_jobs') then
    alter publication supabase_realtime add table upload_jobs;
  end if;
end $$;
