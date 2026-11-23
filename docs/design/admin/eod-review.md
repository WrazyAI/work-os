# Administration EOD review

**Use when:** Changing the administration EOD review queue, report decisions, date filter, or ordering.

**Owns:** The sourced report review record and its deliberate queue order.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing the underlying report document: [Employee EOD review](../areas/eod-review.md).
- Working on the manager-role console instead: [Manager Team review routing](../areas/web-workspace.md#manager-team-review).
- Changing the date popup or focus behavior: [Actions, forms, menus, and keyboard behavior](../patterns/controls.md).

**Implementation starting points:** [ReviewPage.tsx](../../../desktop/work-os-companion/src/admin/ReviewPage.tsx), [eod.ts](../../../desktop/work-os-companion/src/admin/eod.ts).

## Review document

**EOD Review** renders the report as a structured document — meta lines,
sections, and the activity-context disclaimer — beside its sourced evidence
and interval recaps. The decision record keeps manager notes and an optional
manager version, and the raw markdown stays available behind a disclosure.
The queue keeps one row per report: person, report date, one line of context,
submission time. Status earns ink only when it is not the view's default.
Drafting an EOD is a secondary action on the controls row, never the primary.

## Review order and range

**EOD Review order and range.** The review queue reads newest report day
first: a report describes a day, so its report date is the queue's clock. A
late submission for an older day stays below a report for a newer day. Reports
for the same day break by submission time, newest first, with drafts that were
never submitted after the submitted rows. Rows without a usable report date
stay last, and ties break by id. There are no click-to-sort headers here —
newest report day first is the queue's one deliberate order. The date range is one compact control: an
icon-only filter-cone button on the queue's controls row, beside the status
views and ahead of the person filter, that expands a small popup holding the
native From/To pickers and a Done action. The popup opens anchored under the
button, closes on Escape, an outside press, or Done, returns focus to the
button, and is clamped to the viewport. The button names the applied range to
assistive technology and keeps a quiet applied state — a small accent dot —
while a range other than the 30-day default is applied; because the range
text lives in the popup's inputs, the card's detail line carries the counts
only.
