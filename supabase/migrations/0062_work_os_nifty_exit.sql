-- Work OS owns task creation and the task record now. Nifty stays a read-only
-- backup: the mirrored rows keep their provider ids in `raw` and in
-- `provider_task_id`, but they become first-class local tasks so every
-- lifecycle write (edit, complete, archive, delete) stays inside Work OS.
--
-- Projects stay where they are: the provider projects were mirrored into each
-- organization as its own rows, and history keeps its project. New work
-- defaults to TASKS at the application layer.
update public.work_tasks t
set provider = 'local',
    raw = coalesce(t.raw, '{}'::jsonb) || jsonb_build_object(
      'legacyProvider', 'nifty',
      'legacyProviderTaskId', t.provider_task_id
    ),
    updated_at = now()
where t.provider = 'nifty'
  and not exists (
    select 1 from public.work_tasks l
    where l.user_id = t.user_id
      and l.provider = 'local'
      and l.provider_task_id = t.provider_task_id
  );

-- Projects are local records too; keep the provider id as provenance.
update public.work_projects
set provider = 'local',
    raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object('legacyProvider', 'nifty')
where provider = 'nifty';
