-- Assistant interpretations are stored for review; reopens share the same
-- immutable proposal path as completion and other Nifty-backed changes.
alter table work_task_proposals drop constraint if exists work_task_proposals_operation_check;
alter table work_task_proposals add constraint work_task_proposals_operation_check
  check(operation in ('create_task','update_task','log_progress','add_blocker','resolve_blocker','link_evidence','complete_task','reopen_task','remove_from_plan'));
