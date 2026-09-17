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

## 0.3.16

- The Update and Focus switches in the chat header sit side by side again, with the one you are on clearly highlighted.
- The assistant's chat badge now shows Otto's face properly, filling its circle instead of spilling over your messages.
- A reply keeps its task card when the app restarts, and the same reply no longer shows up twice.
- Chat has more room to breathe: roomier message spacing, taller task rows, and slightly larger text.

## 0.3.15

- Paste a Loom link in an update and Otto can read the recording to suggest tasks — the recording never stands in for the update itself.
- Recordings are checked against the day they were recorded, so an older Loom can't be used as today's work.
- In the EOD composer, a Loom recording can shape the draft on its own without a second report.
- The transcript box on Loom cards stays tucked away until you want it.

## 0.3.14

- What Otto remembers is now three clear lists: what is waiting for your review, the facts you kept, and the recent activity behind them.
- Every memory shows a plain date, and you can forget a fact or a memory right from its row.
- Settings are grouped by what they affect, with a separate Reset section, and the on/off toggles show their state in words.

## 0.3.13

- Every chat message now has a Copy button that appears when you hover over it, including the short receipt lines.
- The assistant now shows Otto's mark in chat instead of a generic sparkle, and its art comes from one setting so a mascot change lands everywhere at once.
- Chat spacing is even throughout: the message list, task cards, and action results share one rhythm instead of three.
- The selected count and the collapse control sit together on one line again, and action results show their full label without being cut off.

## 0.3.12

- Checking off tasks no longer hides the rest of the list — keep selecting as many tasks and subtasks as you need before you confirm.
- Checking a task that has subtasks now opens them right away, so you can tick those off in the same pass.
- Action results collapse to a short "N actions recorded" line you can open, and they open on their own when something failed so the error and Retry stay visible.
- The same task list no longer appears twice when the assistant returns it twice.

## 0.3.11

- The Tasks page shows its title once, and the day's focus, view chips, and unfinished-work link sit together on one tidy row.
- Task rows keep their "On today" tag beside the title, and the checkbox lines up with the title where you expect it.
- The task list reads as one clean panel, and narrow windows keep every row a single line tall.

## Unreleased

- First launch after an update announces itself, with a View changelog action.
- Updates wait out antivirus scans instead of closing, and a failed install offers Retry.

## 0.3.8

- A new task that may already exist no longer gets stuck: confirm nothing was created, then file it once.
