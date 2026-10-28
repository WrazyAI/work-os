# Task overflow actions, assignment, and manual status — design

**Status:** agreed with the operator on 2026-10-27.

## Intent

Employees and administrators can act on a task without leaving the list or
the task side panel: edit, archive, permanently delete, assign, and change its
workflow status. Today the desktop dashboard queue, the employee task drawer,
and the administration task record offer only a subset, and nobody can record
that a task is actively in progress.

## Goals

- One ellipsis action menu on every desktop-companion task row: employee
  dashboard queues, the Tasks workspace, and the administration task record.
- The same lifecycle actions inside the task side panel, so opening a task
  never dead-ends.
- Assignment provenance: every task records who assigned it.
- Manual workflow status: Pending and In progress, alongside the derived
  Overdue and the completed state.
- Server-side authorization for every action; the UI renders only actions the
  caller may take.

## Non-goals

- The web dashboard (`app.wrazyos.com`) is out of scope for this change. Its
  employee task list already has an ellipsis and archive/delete; the new
  assignment and status controls land on the companion first.
- No new project, milestone, or subtask management surface.
- No bulk actions.
- No change to attendance, evidence, or EOD behavior.

## Actors

- **Administrator** — role `admin`. Overrides every task action in the
  organization.
- **Supervisor** — role `manager`. May assign only to people they supervise
  (members of a team they manage) and to themselves.
- **Employee** — role `employee`. May assign only to themselves.

A person's own mapping is `work_people.id`; admins without a person mapping
still override by role.

## Assignment provenance

`work_tasks.assigned_by_person_id` records the person who made the current
assignment. It is written when a task is created (the creator is the
assigner) and whenever an assigner changes the assignee list.

Legacy rows have no assigner. The 0065 migration backfills
`assigned_by_person_id` only when a legacy row records exactly one assignee, so
that person keeps the edit/archive/delete/assign control they have today. Every
other legacy row stays assigner-less, and a null assigner means the record is
admin-only for management: its assignees keep completion/reopen and workflow
status, never edit, archive, delete, or reassign. There is no runtime
null-assigner fallback; a missing assigner never grants an assignee management.

## Permission matrix

| Action | Administrator | Assigner | Assignee | Anyone else |
| --- | --- | --- | --- | --- |
| Edit task fields | yes | yes | no | no |
| Archive (reversible) | yes | yes | no | no |
| Delete permanently | yes | yes | no | no |
| Change assignees | yes, anyone | yes, within own scope | no | no |
| Mark complete / reopen | yes | no, unless also assignee | yes | no |
| Move pending ↔ in progress | yes | yes | yes, unless overdue | no |
| Move out of overdue | yes, after the due date is no longer past | yes, after the due date is no longer past | no | no |

A task with no assigner is administrator-only for management; its assignees
keep completion/reopen and workflow status. Management never falls back to an
assignee when the assigner is missing.

## Workflow status

- `work_tasks.workflow_status` is `pending` or `in_progress`; new tasks start
  `pending`.
- **Overdue is derived, never stored.** An open task whose due date is before
  the actor's workday is Overdue regardless of `workflow_status`.
- Display precedence: Done → Overdue → In progress → Pending.
- A status change is refused while the task is overdue. The assigner changes
  the due date first; once it is today or later, the task is no longer overdue
  and the status can change.
- Completing a task leaves `workflow_status` untouched, so reopening restores
  the status it had before completion. If the due date has since passed, the
  reopened task displays Overdue.

## Status vocabulary

Companion task pills read **Pending**, **In progress**, **Overdue**, **Done**.
"Open" remains the collective noun for incomplete work in counts and copy.

## Action placement

- Row: ellipsis at the trailing edge of the row's action column. Menu items:
  status actions, Edit task, Assign (only with permission), Archive
  (reversible), Delete permanently (destructive styling).
- Drawer: lifecycle actions in the drawer body/footer plus a status control;
  destructive archive/delete are explicit and separate, as design.md §6.5
  already requires.
- Permanent deletion always requires a confirmation step; archiving is
  reversible and says so.

## Edge cases

- A task assigned by a supervisor to an employee: the employee can start,
  complete, and reopen it, but cannot edit, archive, delete, or reassign it.
- An administrator who did not assign the task can still do everything.
- An unassigned task created by someone still records that person as the
  assigner, so they can manage it.
- A manager assigning to a non-supervisee is rejected server-side, even if a
  client sends the id.
- A status request for an unknown value is rejected.
- Subtasks inherit the parent's access for visibility; their actions follow
  the same capability matrix on their own row.
- Archived tasks are recoverable (server keeps them); permanent deletion is
  not.

## Verification

- Pure permission/state tests for every matrix row and precedence order.
- Route/source contract tests that the mutation endpoints enforce the
  capability checks.
- Companion render tests for the row menu, drawer actions, and admin task
  record.
- Rendered checks of `?preview-today`, `?preview-tasks`, and `?preview-admin`
  in the desktop companion dev server, at wide and narrow widths.
