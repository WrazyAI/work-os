# Administration settings and recap follows

**Use when:** Changing workspace settings, personal settings reuse, agent access summary, or recap-follow preferences.

**Owns:** Administration configuration groups and explicit recap-follow saves.

**Requires:** [Shared foundations](../foundations.md); [Administration shell and shared contracts](shell.md) (read each once per task).

**Read next only if:**

- Changing category navigation or personal-settings reuse: [Settings categories and layout](../areas/settings.md).
- Changing inbox invalidation or notifications: [Notifications and review reminders](../areas/notifications.md).

**Implementation starting points:** [SettingsPage.tsx](../../../desktop/work-os-companion/src/admin/SettingsPage.tsx), [AdminSettingsWorkspace.tsx](../../../desktop/work-os-companion/src/AdminSettingsWorkspace.tsx), [AdminOttoSettings.tsx](../../../desktop/work-os-companion/src/adminOtto/AdminOttoSettings.tsx).

## Settings groups

**Settings** leads with the account's own settings — the same groups the
employee Settings page carries (profile, this device, page guides, reading
& display, workday, sync & session, memory, suggestions, diagnostics, and
reset), rendered by the one shared component so the two surfaces can never
drift — then groups the workspace's system status, features, memberships,
teams, provider connections, field mappings, and blueprints into sections
with one action per decision area. Feature and membership states are switches,
not native checkboxes. Admin agent access is a summary band with Active and
Inactive counts that opens a token-management modal, the same pattern as the
employee surface. The record-dependent groups appear only
for accounts with a personal workday; the device, display, guides, and
diagnostics half always shows.

## Recap follows

**Recap follows.** The account's own settings include one shared two-column
Recap follows group even when no personal workday is mapped. All active
employees is the default and includes later hires; Selected saves exactly the
ticked ids, and an explicitly empty selection means no recap alerts and never
falls back to All. Saved inactive choices remain visible, named, checked, and
disabled because delivery excludes them; the active count, not the retained id
count, drives the no-alerts summary. The group saves only on Save with the
loaded revision, keeps a failed draft and a revision conflict visible until an
explicit successful reload, and disables choice controls while a save is in
flight. A successful save re-reads the authoritative settings, invalidates the
scoped inbox reads, and wakes the existing delivery/inbox feed in both windows
through an ids-and-context-only signal; it never shares a settings object or
narrows named on-demand queries. Following changes recap alerts, never record
access.
