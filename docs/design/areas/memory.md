# Work Memory

**Use when:** Changing What Otto remembers, memory review, retained facts, or memory pagination.

**Owns:** Memory management presentation and explicit keep/remove decisions.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing the settings entry point: [Settings categories and layout](settings.md).
- Changing review reminders: [Notifications and review reminders](notifications.md).
- Changing use of memory as additional context: [Activity interval reviews](recaps.md).

**Implementation starting points:** [MemorySettings.tsx](../../../desktop/work-os-companion/src/MemorySettings.tsx), [EmployeeMemory.tsx](../../../src/modules/work-os/employee/EmployeeMemory.tsx).

Work memory stays off the settings table. Settings renders one flat split band
on the page surface — never a card and never the settings row grid: on the
left, the configured mascot mark in a quiet framed tile, the heading
`What Otto remembers`, and the one-line model statement; on the right, the
counts (`Remembered`, `Need review`, the latter amber only while candidates
exist) and one dark `View` action. The band never lists facts.

`View` opens a centered management modal (`role="dialog"`, `aria-modal`) that
owns the facts. It carries the same title and model statement, one close
control, and two peer tabs:

- **Needs review** — proposed facts newest first, each a bordered card with
  `Keep` and `Discard`, and an honest empty state. The chosen action stays
  pending until the server confirms it; a confirmed row exits and the remaining
  rows move into place. Reduced motion removes the movement, and errors leave
  the proposal available to retry.
- **Remembered** — kept facts as flat rows on hairlines, each with the verified
  glyph, `Kept <month day>`, and `Forget`; beneath a divider, the Recent
  activity feed with its kind label, summary, calendar day, `Forget`, the
  eight-row cap with `Show all N`, and the provenance line.

Tab switching follows the shared peer-view contract (click or ←/→/Home/End,
with roving tabindex and the count as part of each tab's accessible name).
The modal body is the only scroll region and uses the shared edge dissolve;
Escape, backdrop press, and the close control all dismiss it, and focus returns
to `View`. Below 720px the summary stacks with its counts and action in one row
beneath the copy, and below 560px the modal takes the viewport inset. Keep,
reject, and forget keep their exact existing behavior and states; nothing is
remembered without a keep.

Saved facts and proposals have independent server-side pages and complete
counts. A new proposal can never displace a kept fact from its collection.
Each tab appends 50 facts through its own explicit `Load more` control with
`Showing N of M`; loaded rows stay in place and errors keep them available.
Summary and tab counts describe the complete collection, not only loaded rows.
Durable recall ranks relevant confirmed facts across the full saved set before
filling its bounded context with recent facts; proposals remain a separate,
explicitly unconfirmed lane.
