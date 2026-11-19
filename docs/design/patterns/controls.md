# Actions, forms, menus, and keyboard behavior

**Use when:** Changing a button, search/filter control, menu, detached surface, tab, or shortcut.

**Owns:** Common interaction, keyboard, and focus contracts.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing focus colors or control geometry: [Color, type, and surface tokens](../tokens.md).
- Changing preference radio groups: [Appearance and first-login theme choice](../areas/appearance.md).

**Implementation starting points:** [GlideMenu.tsx](../../../desktop/work-os-companion/src/chat/GlideMenu.tsx), [settingsHotkey.ts](../../../desktop/work-os-companion/src/settingsHotkey.ts), [ui.tsx](../../../src/modules/work-os/employee/ui.tsx), [ui.tsx](../../../src/modules/work-os/admin/ui.tsx).

## Actions

Use one primary action per local decision area. Primary actions use signal lime
or ink according to the surface, not both in competition. Secondary actions use
paper/white with a neutral border. Tertiary actions are quiet but retain a
visible hover/focus target.

Button labels name the result: Add task, Clock in, Save focus, Review change,
Archive task. Every icon-only button has a plain-language aria-label and title.

## Inputs, search, and filters

Inputs have persistent labels where the field is not self-evident, visible
focus, inline validation, and deliberate disabled/loading states. Placeholder
text is not the only label.

The task record's header owns the name and its one-line detail on the left and
the primary Add task action at the trailing edge. Beneath it, one compact
controls row carries the views, the always-visible search, and the
person/project selects in reading order; search leads into the record filters,
and Add task never sits in that row. Below the compact desktop class the views
take the first row and search plus filters follow; at the small class the name
and Add task share the first line, the summary drops to the next, and the
action keeps a 40px target (`.admin-controls`, grouped by
`.admin-controls-group`). Date range stays a peer control or popover, with
clear/reset behavior and a result count when active. Filtered empty says No
tasks match these filters, never No tasks.

## Menus and detached surfaces

Menus open near their trigger, float above content, and never change row height.
They close on Escape/outside click and remain within the viewport. Use a
detached card for contextual details rather than inserting a panel into the
page and shifting the user's scroll position. The outside-click boundary is the
trigger plus the menu itself, including when the menu renders through a portal
at the document body; a press inside the menu never dismisses it before the
item's action runs.

The task status control behaves as one menu wherever it appears: in the drawer
it is a trigger that states the current status, and in a row or administration
menu it is the same item list inside that row's action menu. Opening it focuses
the first enabled item, and Escape, an outside press, or running an item closes
it and returns focus to the trigger. Its items are Pending and In progress;
whichever matches the status the row displays is marked and disabled, because
choosing it would write the value the task already holds. An overdue task's
options are all disabled with the due-date note. It is never a segmented
control, a native select, or an inline panel, and it never changes the row's
height.

## Keyboard and focus

Shortcut inventory:

| Shortcut | Action | Scope |
|---|---|---|
| `Ctrl + ,` (`Cmd + ,` on macOS) | Open Settings — the administration workspace's own Settings section while that workspace is on screen | Either companion window while it is focused; never system-wide |
| `Ctrl + Q` (`Cmd + Q` on macOS) | Quit Work OS completely | Companion main window while focused; the app menu exposes the same action |
| `Ctrl + B` (`Cmd + B` on macOS) | Toggle the sidebar rail | Companion main window while focused, except text fields |
| Hold `Ctrl + M` | Hold-to-talk | System-wide in the companion; in the browser while the page has focus ([voice input](../areas/voice.md)) |
| `Escape` | Dismiss the topmost menu, drawer, sheet, or modal and return focus to its trigger | Every detached surface ([menus and detached surfaces](controls.md#menus-and-detached-surfaces)) |

Peer views (tabs and the memory modal's tabs) share one contract. The tablist is
reachable through its selected tab. ←/→ move and activate, Home and End jump to
the ends, and each tab's accessible name includes its count when it has one.
The debugger's category rail is a vertical navigation list: ↑/↓ move and
activate, Home/End jump to the ends, and the active destination carries
`aria-current="page"`. Lists of rows use ↑/↓ and Home/End to move focus
between rows, and Enter expands. Radio groups use ←/→ with roving tabindex ([appearance preferences](../areas/appearance.md)).

Focus is visible on every interactive element. A focus outline must reach 3:1
against its surroundings; the current signal-lime outline does not ([color tokens](../tokens.md#color)).
Dismissal never leaves focus on removed content.
