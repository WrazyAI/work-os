-- The direct-apply companion command receipt path was retired in 0031 when
-- interpretations moved to persisted, lease-fenced proposals. Nothing reads or
-- writes these tables since: the only accessor (work-os-approved-update.ts) had
-- no callers, the API route is a 410 tombstone, and the companion files through
-- /me/proposals. Drop the orphaned storage.

drop table if exists work_companion_command_operations;
drop table if exists work_companion_commands;
