-- Expand the immutable review queue to cover the companion's explicit task tools.
alter table work_task_proposals drop constraint if exists work_task_proposals_operation_check;
alter table work_task_proposals add constraint work_task_proposals_operation_check
  check(operation in ('create_task','update_task','log_progress','add_blocker','resolve_blocker','link_evidence','complete_task','reopen_task','archive_task','delete_task','add_subtask','display_tasks','remove_from_plan'));
