# Desktop shell and navigation

**Use when:** Changing the companion rail, caption bar, platform menus, or destination layout.

**Owns:** Desktop shell geometry, navigation states, and platform differences.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing workspace choice or device connection: [Workspace identity and device connection](workspace-identity.md).
- Changing keyboard shortcuts or detached menus: [Actions, forms, menus, and keyboard behavior](../patterns/controls.md).
- Changing layout breakpoints: [Responsive layouts and viewport matrix](../patterns/responsive.md).

**Implementation starting points:** [SidebarNav.tsx](../../../desktop/work-os-companion/src/SidebarNav.tsx), [AppMenuBar.tsx](../../../desktop/work-os-companion/src/AppMenuBar.tsx), [windowChrome.ts](../../../desktop/work-os-companion/src/windowChrome.ts).

## Desktop shell

The companion opens with a collapsed 68px icon rail so the task stage gets the
room it needs. The employee can expand it to the 208px labeled reference rail
without leaving the shell; the workspace grid moves with the rail instead of
letting navigation cover the stage. The web shell may use the same 208px labeled
rail at wide widths, and both surfaces use the same content axis and destination
order.

At wide desktop, align the rail and stage as follows:

| Left rail | Main stage |
|---|---|
| Work OS mark | Context/date and compact utility actions |
| Primary destinations | One page title and aligned content axis |
| Quiet footer | Dashboard, table, detail, or review surface |

Reference geometry:

- Wide web rail: 208px.
- Companion rail: 68px collapsed, 208px expanded.
- Stage padding: 24–64px, responsive.
- Masthead: 78–104px depending on shell.
- Content maximum: 1200–1320px.
- Bottom breathing room: at least 56px plus any floating surface clearance.

The masthead is context, not a second hero. The title appears once. Utility
actions (sync, notifications, refresh, identity) stay compact and aligned to
the title baseline.

The Windows companion replaces the native title bar with one 34px caption bar.
Its leading edge is the Work OS menu; the current page and on/off-shift state
sit at the centre; minimize, maximize/restore, and close sit at the trailing
edge in the platform's order. The bar is the drag region and a double-click
maximizes. The menu carries Workspace, Go, View, and Help, then a separated
`Quit Work OS` (`Ctrl + Q`; `Cmd + Q` on macOS). Close hides the window to the
tray; Quit exits the app. The bar stays above modal surfaces, and every
overlay that portals to the document body — drawers, sheets, and dialogs —
starts below it, so its header and close control never sit under the caption.
The webview's browser context menu is suppressed outside text fields.

macOS uses the same 34px bar with its native traffic lights at the leading
edge, so the bar reserves that track and drops its own window buttons; the
trailing edge carries the shift state instead. The administration workspace
replaces that state with `Admin mode`, because attendance is not the
administrator's current context. macOS also gets the same Work OS menu in the
system menu bar, in the same Workspace, Go, View, Help order, with the standard
app and Edit menus around it; `Quit Work OS` lives at the bottom of the app
menu. The system menu is a mirror, not a second source of navigation: both it
and the caption menu run the same actions.

## Navigation states

Navigation is a stable noun: My Day, Tasks, EOD Review, Insights, Evidence, Settings.
Administration mode replaces these with Overview, People, Tasks, EOD Review,
Payroll, Insights, Evidence, and Settings.
The active destination uses a quiet inset surface, ink/signal icon treatment,
and a visible focus ring. A narrow marker is allowed only for the primary
navigation rail itself; it is not allowed beside content rows, task rows, cards,
or selected records. The Settings destination names its shortcut in its tooltip;
[keyboard and focus](../patterns/controls.md#keyboard-and-focus) defines the shortcut inventory.

The companion sidebar intentionally does not render a persistent Chats section
or an empty recent-chat placeholder. Chat remains available through New chat and
the shared launcher; a future history surface must use real conversation data
and earn its space without weakening the work-navigation hierarchy.

Icon-only destinations require an accessible name and tooltip. The companion
also owns a workspace identity control, New chat, and a chat-entry affordance;
any production chat rows must be backed by real conversation history rather than
invented threads or workspace actions. Settings lives in a quiet footer
separated by a rule; connection/session status is intentionally not repeated in
the sidebar. Evidence remains a routed view but its sidebar destination is
hidden until that surface is ready for daily use.

When the companion sidebar is collapsed, the workspace mark is the expand
control. Hovering the mark or any non-navigation surface reveals the expand
affordance, and clicking empty sidebar space expands it; navigation rows remain
clickable without expanding the rail. The icon column uses one shared slot so
the mark, rows, and footer remain aligned in both states.

At the 560px small class the companion rail becomes a fixed bottom bar instead
of an icon-only strip: the destinations keep their icons and names (`EOD
Review` shortens to `EOD`, with the full name as its accessible name), `More`
opens the workspace menu, and New chat keeps a named action in the bar. The bar
uses 44px targets, safe-area padding, and one active marker; page content and
the composer reserve its height, and detached menus open above it.

## Evidence visibility

The companion's dedicated employee Evidence destination follows the live
[design exception](../../design-exceptions.md). Its hidden state does not
authorize deleting its route or exposing it before its acceptance gate.
