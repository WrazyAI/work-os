-- 0007: user self-service profile — avatar image + display name.
-- Adds an avatar_url column to profiles and a PUBLIC `avatars` Storage bucket so
-- the browser can render a user's picture with a plain <img> (no signed URLs).
-- Idempotent so it can be re-applied safely.

-- Where the profile picture URL lives (points at the public avatars bucket).
alter table profiles add column if not exists avatar_url text;

-- Public bucket: profile pictures are non-sensitive and rendered directly in the
-- UI. Small images only — capped at 5MB regardless of the project global limit.
insert into storage.buckets (id, name, public, file_size_limit)
values ('avatars', 'avatars', true, 5242880)
on conflict (id) do update set public = true, file_size_limit = 5242880;

-- Per-user writes: objects live at <user_id>/<filename>; a user may only write to
-- their own prefix. Reads are public (the bucket is public), so no select policy
-- is needed for viewing. The service role bypasses all of these.
drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
