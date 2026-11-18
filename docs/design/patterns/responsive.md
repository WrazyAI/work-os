# Responsive layouts and viewport matrix

**Use when:** Changing layout, breakpoints, density, overlays, or zoom behavior.

**Owns:** The shared viewport matrix and content-clearance requirements.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing rail collapse or bottom navigation: [Desktop shell and navigation](../areas/desktop-shell.md).
- Changing narrow task rows: [Task rows, status, and selection](task-rows.md).
- Recording rendered acceptance: [Design verification and handoff](../verification.md).

Every changed surface is reviewed at these classes:

| Class | Reference | Required behavior |
|---|---|---|
| Wide desktop | 1440×900 | full work stage, intentional side-by-side regions, complete metadata |
| Compact desktop | 1024×768 | compact rail, usable table, contained overlays |
| Narrow/tablet | 720×900 | intentional stack, wrapped controls, no collisions |
| Small | 390×844 | one column, touch targets ≥40px, no horizontal scroll |

Rules:

- Collapse rail labels before compressing task titles.
- At 900px, stack dashboard columns and search/filter controls deliberately.
- At 720px, hide redundant task metadata before title/completion.
- At 560px, use a bottom-sheet drawer, full-width local actions, and compact
  tab controls.
- Reserve content clearance for the floating launcher/sheet and composer; never
  rely on translucency to make covered work usable.
- Test at 200% zoom or equivalent narrow content width.
