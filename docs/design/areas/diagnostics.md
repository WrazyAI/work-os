# Developer diagnostics

**Use when:** Changing debugger categories, scenario controls, Live trace, Export, or window lifetime.

**Owns:** The opt-in debugger category workspace, platform header, and bounded diagnostics history.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing subscriptions, delivery, or performance limits: [Shared seams and performance budgets](../implementation.md).
- Changing trace pagination: [Data truth, async states, and pagination](../patterns/data-and-state.md).
- Changing category navigation or keyboard behavior: [Actions, forms, menus, and keyboard behavior](../patterns/controls.md).
- Changing the rail or caption controls: [Desktop shell](desktop-shell.md).

**Implementation starting points:** [DebugWindow.tsx](../../../desktop/work-os-companion/src/DebugWindow.tsx), [DebugSidebar.tsx](../../../desktop/work-os-companion/src/DebugSidebar.tsx), [debugSections.ts](../../../desktop/work-os-companion/src/debugSections.ts).

The companion debugger is an opt-in developer window and a category workspace,
not one scrolling page of controls. Its rail groups eight destinations —
Overview, Presets, Session, Workday, and Companion under Scenario; Backend &
writes under Safety; Live trace and Export under Diagnostics — and one category
owns the content stage at a time. Overview states the master switch, the active
preset, and a five-row summary (Preset, Session, Workday, Companion, Reach) that
opens the category owning each value. Presets are grouped by scenario kind, not
presented as one undifferentiated grid.

The window opens at about 1000×800 with a 620×520 minimum so the rail and the
content keep their own columns; below 760px the rail becomes one section picker
instead of a second column. The rail follows [desktop navigation](desktop-shell.md#navigation-states): one roving tab stop, a quiet
inset active destination, and ↑/↓ with Home/End. A fixed ink header carries the
window identity, the risky-state chips, and the window controls; it is
instrument chrome and does not follow the material. On Windows the header is
the caption bar: the native frame is removed, the header is the drag region, and
minimize, maximize/restore, and close sit at its trailing edge. macOS keeps its
native traffic lights over the content and reserves their track in the header.
Every field, panel, status, and button inside follows the selected material — a
hard-coded white field is never allowed in the dark variant. A persistent action
bar keeps Copy scenario JSON and Reset all overrides reachable from every
category and states whether the active scenario is a preset or custom overrides.

It is destroyed when closed and recreated on demand, so it holds no history and
no subscriptions while closed. Selecting another category releases the Live
trace rows and its listener. The tab strip's peer-view contract does not apply;
the rail is a navigation list ([keyboard and focus](../patterns/controls.md#keyboard-and-focus)).

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
