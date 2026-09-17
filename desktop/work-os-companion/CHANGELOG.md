# Work OS Companion changelog

Every release adds one `## <canonical-version>` section below with a short,
human bullet list of what changed. Versions stay in canonical SemVer here
(`0.3.9`, never the padded display form `0.3.09`); the UI pads the patch
segment for display. The release workflow fails when the released version has
no matching section with at least one bullet, so no build ships without
employee-facing notes.

While work is in flight, collect entries under `## Unreleased`. When cutting a
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
