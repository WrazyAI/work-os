# Notifications and review reminders

**Use when:** Changing the bell, notification panel, flyouts, persistent warnings, or suggestion-review entry.

**Owns:** Audience separation, destinations, receipts, reminders, and administration notification placement.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing memory review: [Work Memory](memory.md).
- Changing recap next-step decisions: [Next-step suggestions after recap approval](next-steps.md).
- Changing bubble dismissal: [Floating companion, Otto, and assets](floating-companion.md).
- Changing administration navigation: [Administration shell and shared contracts](../admin/shell.md).

**Implementation starting points:** [NotificationsBell.tsx](../../../desktop/work-os-companion/src/NotificationsBell.tsx), [NotificationFlyouts.tsx](../../../desktop/work-os-companion/src/NotificationFlyouts.tsx), [SuggestionReview.tsx](../../../desktop/work-os-companion/src/SuggestionReview.tsx).

The masthead bell is the notifications panel: one detached surface ([menus and detached surfaces](../patterns/controls.md#menus-and-detached-surfaces)) that
lists what needs the employee right now, and the badge counts all of it —
memories awaiting review, one recap slot, overdue tasks, and outstanding EOD
days — in the amber recoverable-attention tone.

- **Audiences** — an administrator's bell carries two tabs in the panel
  header, in the place the visible `Notifications` title used to occupy:
  Employee (the signed-in account's own reminders, unchanged) and Admin (the
  live workspace record). The visible title is removed and the rows are not
  restated in a subtitle; the dialog keeps `Notifications` as its accessible
  name. The tab that belongs to the current workspace is selected whenever the
  panel opens, so opening the bell in Administration never lands on a personal
  reminder first; closing and reopening resets the tab to the workspace even
  if the last visit ended on the other audience. Each tab names its own count,
  and the closed bell's badge names the audience its next open will show. The
  tablist is reachable through its selected tab; ←/→ move and activate,
  Home/End jump to the ends. A non-administrator sees the single Employee list
  and no tablist; its header holds only the close control.
- **Admin rows** — the Admin tab reads the same live overview as the Overview
  page. `Needs your decision` carries every attention record the record
  reports — EOD reports awaiting review, teammates with unsubmitted EOD days,
  overdue tasks, disputed evidence, and configuration blockers — with its real
  count, severity tile, and the action that resolves it. Each row opens the
  exact surface: Review, the filtered Tasks record, Evidence, or Settings. A
  clear queue states that no decisions are waiting instead of hiding the
  section. `Today across the workspace` is one quiet pulse line (on shift,
  recaps, outcomes, evidence), never a second KPI board. `Recent team
  activity` is the overview's own newest-first timeline of updates, recaps,
  completed tasks, evidence, and EOD submissions; a completion opens that
  person's Completed tasks, a report opens their EOD review, evidence opens
  their evidence, and an update or recap opens their People record. The footer
  opens the overview that owns the full record.
- **Rows** — agent-authored reminders wear the configured mascot mark, the
  same identity the chat window uses, never a generic tone glyph. The memory
  row reads `This is what Otto remembers about you so far` with its proposed
  fact count and opens the memory modal ([Work Memory](memory.md)) on its review tab; the recap row
  reads `Your recap is ready` with the interval label and opens the dock's
  Focus tab where the recap is confirmed or corrected. The outstanding EOD
  section keeps its day rows, observed-time meta, and status pills. An overdue
  row under `Needs attention` reads `N tasks are overdue` (`1 task is overdue`
  in the singular) with a danger-tinted alert tile, one line of unfinished-work
  meta, and a `Review` action that opens the Tasks workspace's Unfinished view
  with the current workday and filters restored, where the overdue section
  leads. The count covers exactly what that destination shows — work day-scoped
  to My day stays there and is what the check-in mention surfaces — so the row
  never counts work its action cannot show, and it disappears the moment the
  work is done.
- **Arrival** — a new memory candidate, a ready undecided recap, or a task that
  newly goes overdue announces itself exactly once per item: an in-app flyout
  carrying the mascot mark and one `Review` action, a standing panel row until
  it is resolved, and a system notification when the window is hidden. The
  floating companion keeps owning recap system delivery so one recap never
  fires two system toasts. An overdue announcement is keyed to the task and its
  due date, so moving a due date may announce again while the same overdue
  state never repeats. The seen registries are best-effort local memory: losing
  them may re-announce once, never lose a reminder, and the panel always
  reflects live data.
- **States** — loading reserves geometry with skeleton rows; an error keeps the
  last list and offers an inline retry; the empty state says the employee is
  caught up. Escape, outside press, and the close control dismiss the panel,
  focus lands on the first row (or the close control) on open and returns to
  the bell, and arrow keys move between rows.
- **Suggestions waiting for review** — a second settings band below What Otto
  remembers, with `Waiting` and `Need attention` counts and one `Review`
  action. It opens the decision modal: `Waiting for your decision` items offer
  `Approve` and `Reject`; `Couldn't be applied` items keep their failure reason
  and offer `Try again` and `Dismiss`; outdated items dismiss only because the
  task moved on. Approving or dismissing refreshes the task surfaces the change
  could touch. Recap-sourced next steps never appear here — they belong to the
  mascot chat moment ([next-step suggestions](next-steps.md)) or its compact bubble — and nothing is written back
  until an approval.

## Administration notifications

**Notifications.** The masthead carries the same notifications bell and panel
as the employee workspace ([notifications](notifications.md)). Its Employee tab reads the signed-in
administrator's own notifications: the memory row opens the memory modal in
place, while recap and outstanding EOD rows switch to the employee view first
and then open the exact surface they name. Its Admin tab reads the live
workspace overview — the decision queue, today's pulse, and recent team
activity — and opens the exact administration section each row names. The bell
defaults to Admin while Administration is the current workspace and to
Employee in the personal workday. While the panel is open it owns the layer
above the receipt stack, whose cards keep their position underneath.
Administration also uses the shared in-app flyouts: every confirmed write
leaves one transient receipt
naming the persisted outcome, failures keep the page's own inline notice and
offer retry there, and the fired-and-forgotten Nifty sync is the one write that
also raises a failure flyout. Nothing fires for a queued or uncertain write.
Two standing conditions hold persistent cards under stable keys: an overview
snapshot older than ten minutes, and a workspace status reporting a missing
migration or an unusable Nifty connection. Standing cards render in the shell's
notification region in the page's reading order below the masthead, so they
never cover the page identity or its actions; a shell-less surface falls back
to a fixed stack offset below its header. Transient receipts keep the shared
viewport position: a receipt lands in the window's top-right corner with the
same insets as the employee view, at every width.
