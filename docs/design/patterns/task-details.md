# Task drawers and completion evidence

**Use when:** Changing task details, lifecycle controls, completion attachments, preview, or download.

**Owns:** Drawer behavior and employee-attached evidence, distinct from captured provider screenshots.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing task status or completion cascades: [Task rows, status, and selection](task-rows.md).
- Changing menus or focus restoration: [Actions, forms, menus, and keyboard behavior](controls.md).
- Changing captured screenshot access: [Administration evidence and integrations](../admin/evidence.md).

**Implementation starting points:** [EmployeeTaskDrawer.tsx](../../../src/modules/work-os/employee/EmployeeTaskDrawer.tsx), [TaskAttachmentIndicator.tsx](../../../desktop/work-os-companion/src/admin/TaskAttachmentIndicator.tsx).

## Task drawer

Desktop task details open as a right-side drawer, up to 540px wide, with a
stable header, scrollable body, and footer actions. The underlying list stays
in place and does not reflow. The drawer includes full title, description,
source/provenance, dates, assignees, subtasks, and lifecycle actions.

The drawer's action block carries the task's status control, the assignee
control, and its lifecycle actions — Edit task, Archive task (reversible), and
Delete task (which always asks for confirmation) — and every control renders
only when the task's capability payload allows it. A cached payload without
capabilities shows no controls rather than advertising an action the server
would refuse, and a completed task has no status path until it is reopened.

The status control states the task's current status and opens the detached
menu of [menus and detached surfaces](controls.md#menus-and-detached-surfaces), listing Pending and In progress with the current option marked
and inert. An overdue task keeps it disabled with the note "Update the due date
first". For an open employee task, moving the recorded due date to today or
later, or clearing it, removes the overdue lock; the actor still needs permission
to change status. Administration uses its own
[effective-date rule](../admin/tasks.md#task-dates-and-overdue-counts), so clearing
its recorded date does not necessarily remove the lock. Reopening a completed
task restores the status it held before completion (reading Overdue again if
its applicable due date has since passed). The assignee control lists only the people this actor may
assign; when a current assignee sits outside that scope the control locks and
states why, so a client never submits a set the server would reject. Replacing
the assignees records the actor as the task's assigner.

At narrow widths it becomes a bottom sheet with a safe viewport inset and an
internal scroll region. Menus and drawers must collide with the viewport, close
on Escape/outside click where appropriate, and restore focus to their trigger.
Destructive archive/delete actions are explicit and separate. A confirmed
completion of the task the drawer is showing closes the drawer; completing a
subtask or reopening the task leaves it in place.

**Completion evidence previews.** The drawer's employee-attached evidence rows
show the file before download: an image uses its real bytes as the thumbnail,
and every other supported type carries one type tile with a readable extension
badge (PDF, Word, Markdown, text, CSV, ZIP, 7Z). The row's download action stays
separate from the row itself; activating the row opens the preview dialog.

The preview matrix is explicit and never guesses:

- Images render at full size in the dialog.
- PDFs render in an embedded viewer (a blob URL in an iframe) with a persistent
  download fallback for webviews that cannot display PDF.
- Plain text, Markdown, and CSV render as readable text, capped at 200 KB with a
  truncation notice. Markdown uses the safe renderer, so raw HTML stays inert
  text; it is never injected.
- Word (`.doc`, `.docx`) and ZIP/7Z keep a metadata preview — name, type, size,
  attachment time, provenance, and note — with a primary Download action. The
  companion does not extract Word or archive contents, and `.docx` is not given
  a partial text preview.
- HTML and SVG are not supported types and are never inlined.

Both thumbnails and previews read through the authenticated bearer fetch and
hand a short-lived object URL to the renderer; a token never appears in an
`<img>`, `<iframe>`, or other URL. Object URLs are revoked when the row closes,
the dialog closes, or the selection changes. A thumbnail reserves its geometry
while loading, and a corrupt or missing file falls back to a clearly unavailable
type tile; the dialog states Preview unavailable and keeps Download available.

The dialog is labelled by the file name, described by the provenance sentence,
opens with focus on its close control, traps Tab within the dialog, closes on
Escape or a backdrop press, and restores focus to the evidence row. At 720px
and below it takes the full viewport with a single internal scroll region; the
footer action becomes full-width at 560px. Evidence remains employee-attached
output evidence: the preview and its provenance line never call the file a
provider confirmation or proof of completion.

## Completion evidence

A completion may carry one explicit employee upload: one file plus an optional
short note. The task row's completion control and the drawer's `Mark complete`
mark a simple task done immediately; neither interrupts the check-off with a
form. Confirmation arrives as one transient receipt naming the task, with a
single `Attach evidence` action that opens the same completion step in its
attach-only mode, so evidence stays one deliberate press away without costing
every completion a modal.

A task that records an expected outcome cannot be completed without a file —
the server refuses that write — so its completion control opens the completion
step instead. That step states the requirement and never offers the no-evidence
path; every other task keeps evidence optional and after the fact. The step
moves only through persisted states: idle, saving the file, saved but not
complete with `Retry completion`, and confirmed completion. A failed upload
keeps the selected file and note for retry and never marks the task done. A
completion failure keeps the saved evidence and says the task is not complete
yet. The same step can attach evidence to an already completed task without
changing its state.

The record is `manual`, employee-attached output evidence with the employee,
task, timestamp, file name, size, and note. It is never provider confirmation,
never a Worktivity screenshot, and never a completion claim by itself. The
drawer lists it under `Completion evidence` with `Employee-attached` provenance
and a download action. Administration and EOD reads receive the same row as
output evidence. The raw-screenshot restriction ([captured screenshot access](../admin/evidence.md#evidence-record)) does not apply because
these are explicit employee uploads, while the file is served only from an
authenticated, person-scoped route and raw storage paths never reach a client.

One file: PNG, JPEG, WebP, PDF, text, Markdown, or CSV up to 8 MB; the note is
1,000 characters or fewer.

## Keep upload and preview capabilities separate

The upload allowlist above governs new attachments. The preview matrix also
describes how existing files are presented; support for a metadata preview
does not expand the upload allowlist or permit inline HTML/SVG execution.
