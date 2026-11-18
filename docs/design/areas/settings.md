# Settings categories and layout

**Use when:** Changing personal Settings navigation, category pages, group layout, or shared admin personal settings.

**Owns:** The label/content layout and one-category-at-a-time Settings workspace.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing profile or workday: [Profile, connected accounts, and work arrangements](profile-and-schedule.md).
- Changing reading & display: [Appearance and first-login theme choice](appearance.md).
- Changing memory: [Work Memory](memory.md).
- Changing suggestions: [Notifications and review reminders](notifications.md).
- Changing page guides: [Page guides and workspace tour](page-guides.md).
- Changing workspace configuration or recap follows: [Administration settings and recap follows](../admin/settings.md).

**Implementation starting points:** [SettingsContent.tsx](../../../desktop/work-os-companion/src/SettingsContent.tsx), [SettingsSidebar.tsx](../../../desktop/work-os-companion/src/SettingsSidebar.tsx), [settingsSections.tsx](../../../desktop/work-os-companion/src/settingsSections.tsx).

## Settings groups: one label column, one content column

Every group on the Settings page is a two-column pair: a narrow label column
holding the group's name, and a wide content column holding everything that
group offers. The group is one grid, and a group's content is **one** child of
it — never two. A group that offered a note and its choices as separate
children would have the second child pushed into the label column and the
third stranded in an empty one, which is how Otto's voice came to list four
voices in a 164px rail.

- **The content column** holds the group's own controls in reading order: the
  group's note first, then its choices. A group with several controls keeps
  them in one wrapper, so they travel together and the label column stays a
  label column. The employee and administration surfaces render the same
  groups from the one shared component, so the rule holds on both.
- **Choices that belong together** read as peers across the content column,
  not stacked into a narrow rail: the four voices sit side by side, each one
  surface carrying its sample control and its name, with the chosen voice
  marked by the current-state outline the rest of the product uses for a
  selected row and the other three left quiet.
- **The guide films follow the page, not a pixel.** A guide that films this
  page aims its camera at the group it names by that group's own heading, so
  a group that moves, or a group that arrives, cannot leave the film showing
  the wrong band or filming empty canvas.

## Settings as a category workspace

Settings is a category workspace, not one long page. While Settings is on
screen, the Work OS sidebar becomes the Settings rail; **Back to app** returns
to the previous workspace and restores the app rail. The rail carries one
search field, the signed-in account's profile row, and grouped destinations:
Account (Profile, Workday, Session, and administration's Recap follows), App
(General, Appearance, Voice, Otto memory, Page guides), Workspace (Workspace
status, Features, Members, Teams), Integrations (Connections, Field mappings,
Blueprints), Data & privacy (Diagnostics, Reset), and About.

Choosing a destination reveals one page in the stage: one title, one purpose
line, and the existing label/detail/control group rows. Settings groups keep
their one-label/one-content shape inside the page; the page title replaces the
duplicated group heading. Search filters the destinations and offers matching
pages as results. Arrow keys move through the rail with roving focus, and at
narrow widths the rail becomes a top Back/search/section picker rather than a
second column.

The Profile page renders the profile form inline — Identity, Region & time,
Workday, Privacy, and Work profile — using the same two-column section layout
as the former modal. The masthead avatar opens Settings → Profile; the modal is
not the entry point. Administration's workspace configuration is split the
same way: Workspace status, Features, Members, Teams, Connections, Field
mappings, and Blueprints are separate destination pages, each rendering its
own card. Personal settings pages are shared by both workspaces.
