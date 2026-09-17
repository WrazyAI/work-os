# Work OS Companion changelog

Every release adds one `## <canonical-version>` section below with a short,
human bullet list of what changed. Versions stay in canonical SemVer here
(`0.3.9`, never the padded display form `0.3.09`); the UI pads the patch
segment for display. The release workflow fails when the released version has
no matching section with at least one bullet, so no build ships without
employee-facing notes.

While work is in flight, collect entries under `## 0.3.11

- The Tasks page shows its title once: the header is just the day context and
  the date navigator, so there is no second Tasks heading under the masthead.
- The agenda strip keeps the day's focus, all four view chips, and the
  unfinished-work link on one row, and only reflows into two tidy rows when the
  window is genuinely narrow.
- Task rows keep their On today tag at the end of the title line, the
  completion checkbox lines up with the title, assignee chips match the row's
  quiet text, and the list reads as one panel instead of a box inside a box.
- Compact windows drop the redundant status pill so each row stays a single
  line tall.

## Unreleased`. When cutting a
release, move them under the new `## <version>` heading. Keep entries to what
the employee will notice: new actions, fixes, changed copy or behavior. Omit
refactors, chores, and internal tooling unless they change what the employee
sees or does.

## Unreleased

- Post-update announcement: the first launch after an update shows a success
  flyout with a View changelog action that opens this history in a modal.

## 0.3.8

- Clear-and-retry recovery for uncertain Nifty creates: a create that may have
  reached Nifty no longer dead-ends, with a Nothing was created — retry action.
