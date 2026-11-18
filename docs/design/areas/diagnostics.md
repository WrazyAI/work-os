# Developer diagnostics

**Use when:** Changing Scenarios, Live trace, Export, or debugger window lifetime.

**Owns:** The opt-in dense diagnostics surface and its bounded history.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing subscriptions, delivery, or performance limits: [Shared seams and performance budgets](../implementation.md).
- Changing trace pagination: [Data truth, async states, and pagination](../patterns/data-and-state.md).
- Changing keyboard or peer-tab behavior: [Actions, forms, menus, and keyboard behavior](../patterns/controls.md).

**Implementation starting points:** [DebugWindow.tsx](../../../desktop/work-os-companion/src/DebugWindow.tsx).

The companion debugger (Scenarios, Live trace, Export) is an opt-in developer
window. It is destroyed when closed and recreated on demand, so it holds no
history and no subscriptions while closed. The Live trace tab releases its rows
and listener when another tab is selected. Its tabs follow the peer-view contract
in [keyboard and focus](../patterns/controls.md#keyboard-and-focus).

Rows are intentionally dense at 34px. This desktop-only developer surface is an
exception to touch-sized controls; every action remains keyboard accessible and
has a visible focus state.

The live trace reads the host's diagnostics history: 1,000 events in memory,
newest first, read in pages of 50 with at most 100 rows loaded at once ([paged and streaming lists](../patterns/data-and-state.md#paged-and-streaming-lists)).
Method and path appear inline on request spans, and duration appears inline on
completed and failed spans. The category is the row's title, and the message
appears only when it adds something the category does not. The source value and
full JSON appear only in the expanded row. Spans at or above one second are
marked slow. Search, level, and source filters apply to the whole history, not
just the loaded rows. Pause freezes the view and resumes with a refresh. Clear
view sets a sequence floor for the lifetime of that debugger window: later events
remain visible, earlier events do not reappear, and disk logs remain untouched
and available to Export.

This is the one place where a dense diagnostic list is intended. The [rejected treatments](../foundations.md#explicitly-rejected-treatments) rule
against a permanently visible diagnostic wall applies to product surfaces, not to
this opt-in developer window.
