# Work OS Companion changelog

An employee reads this right after installing an update, so every entry is
one short, plain bullet: what changed for them, in their words. No jargon,
no file names, no implementation detail. One bullet per change, one line per
bullet, each under ~160 characters.

- Lead with the outcome: `Downloads now resume after a failed update.`
- Name the action the employee takes, not the system that changed.
- Longer notes are only for a complex change that cannot be understood in
  one line — a new workflow with steps or a behavior change with conditions.
  Even then, lead with the one-line version first.

Every release adds one `## <canonical-version>` section below. Versions stay
in canonical SemVer here (`0.3.9`, never the padded display form `0.3.09`);
the UI pads the patch segment for display. **Updating this file is a hard
release requirement: the release workflow fails when the released version
has no matching section with at least one bullet**, and the GitHub release
notes are built from that section. While work is in flight, collect entries
under `## Unreleased`; when cutting a release, move them under the new
`## <version>` heading. Omit refactors, chores, and internal tooling unless
they change what the employee sees or does.

## Unreleased

- First launch after an update announces itself, with a View changelog action.

## 0.3.8

- A new task that may already exist no longer gets stuck: confirm nothing was created, then file it once.
