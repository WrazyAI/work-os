# Color, type, and surface tokens

**Use when:** Changing colors, typography, geometry, elevation, or theme material.

**Owns:** Semantic reference values and approved light, dark, and chat scales.

**Requires:** [Shared foundations](foundations.md) (read each once per task).

**Read next only if:**

- Changing theme or size preferences: [Appearance and first-login theme choice](areas/appearance.md).
- Changing the host console material: [Web employee workspace](areas/web-workspace.md).
- Working on the marketing palette: [Public site, downloads, and tutorials](areas/public-site.md).

**Implementation starting points:** [styles.css](../../desktop/work-os-companion/src/styles.css), [theme.css](../../desktop/work-os-companion/src/theme.css), [conversation.css](../../desktop/work-os-companion/src/chat/conversation.css), [globals.css](../../src/app/globals.css).

The desktop and web implementations may use different CSS mechanisms, but they
must map to these semantic tokens. Values are references, not a reason to
scatter raw values through files.

## Color

| Token | Reference | Meaning |
|---|---|---|
| --color-ink | #182018 | headings, body text, dark primary controls |
| --color-ink-soft | #304033 | strong secondary text |
| --color-muted | #62685f | metadata, helper text |
| --color-faint | #939c90 | quiet labels and unavailable values |
| --color-canvas | #eef1eb | outer application background |
| --color-stage | #f5f6f1 | content stage |
| --color-paper | #fafaf6 | warm base surface |
| --color-raised | #ffffff | cards, fields, drawers, menus |
| --color-inset | #f0f3ed | grouped content and hover |
| --color-line | #d9ded5 | hairlines and default borders |
| --color-line-strong | #c5cec1 | selected/focused surface outline |
| --color-signal | #a8f15b | primary action and bounded progress |
| --color-signal-deep | #5e9d27 | signal icon, progress, current state |
| --color-danger | #b84035 | error, destructive, overdue attention |
| --color-danger-soft | #f9e5e1 | danger surface |
| --color-warning | #c88918 | aging work and recoverable warning |
| --color-warning-soft | #fff5dc | warning surface |
| --color-observed | #2e617d | Worktivity/provider observation |
| --color-observed-soft | #edf6fb | observation surface |

Do not use signal green to mean “good” in general. It means action, progress,
current state, or an explicitly confirmed result whose label says what was
confirmed. Observation remains blue/cool-neutral even when activity is present.

The desktop companion's dark variant is **Soft ash**: the same roles on a
lighter graphite ladder so every surface step stays legible without glow.
Reference values: canvas `#242527`, navigation `#292a2c`, paper `#303133`,
raised `#393a3d`, inset `#414246`, line `#505256`, line-strong `#686b70`,
ink `#f0f0ef`, ink-soft `#d2d3d6`, muted `#bfc0c3`, faint `#b0b3b8`, signal
`#a8f15b`, signal-deep `#8fd24a`, danger `#f09a93`, warning `#e3b15f`,
observed `#8fbdd8`, focus `#b8e794`. The ladder is
`navigation < paper < raised < inset`, with the canvas beneath it; a dialog is
one step above the surface it covers, and hover is the inset step or a 4–7%
white wash. Categorical chart hues are theme-aware (`--chart-ink`,
`--chart-1` … `--chart-8`) so a series keeps its meaning across themes without
a light-paper hue turning sandy on graphite. The web workspace keeps its own
dark scope ([web workspace material](areas/web-workspace.md#routes-and-material)); the two materials are reconciled by role, not by copying
hex values.

**Theme completeness.** Every surface, dialog, menu, and field follows the
selected material; a light-only panel never appears inside Soft ash. The tool
palette's paper is a paper, never an ink: `#fbfaf5` in the light material and
the paper step in the dark material, with ink-on-signal reserved for text on
signal green. Controls that render before a lazily loaded workspace chunk (the
employee masthead's Administration switch) carry their material in the
always-loaded sheet, so the first frame is styled before the admin bundle
arrives.

Known gaps: `--color-faint` (2.7:1 on paper) must not carry text in the light
material; the dark faint step is `#b0b3b8` and passes on paper and inset.
`--color-warning` (3.0:1 on white) still fails AA as text on light surfaces,
and the signal focus outline is 1.3:1 on paper. The muted and danger roles now
use text-safe steps: `--color-muted` passes on canvas and paper, and
`--color-danger` passes on paper, canvas, and `--color-danger-soft`, so status
and metadata text may use them directly. Warning remains for icons, borders,
and fills unless a darker text value is chosen. The conversation
surfaces resolve the focus gap with one chat focus color — `--conversation-focus`
(#4a7d22, 4.5:1 on paper), exposed to the chat Tailwind theme as `--color-focus` —
used for composer rings and every chat focus outline; the bright signal lime
stays for actions, progress, and confirmed states.

## Geometry and elevation

| Role | Value |
|---|---:|
| Compact control radius | 8px |
| Button/input radius | 10px |
| Internal notice radius | 12px |
| Standard card radius | 16px |
| Primary hero radius | 18px |
| Chip/pill radius | 999px |
| Compact control height | 34–36px |
| Standard input height | 42px |
| Row minimum height | 64px |
| Standard card shadow | 0 1px 2px rgba(20,30,18,.035), 0 10px 28px rgba(20,30,18,.045) |
| Raised shadow | 0 16px 48px rgba(20,30,18,.08) |
| Floating shadow | 0 18px 64px rgba(18,27,17,.16) |
| Product easing | cubic-bezier(.2,.8,.2,1) |

Use 1px borders for structure. A 2px edge may communicate a keyboard focus
state or danger state, but never use it as a decorative selection rail.

## Typography

Use the existing self-hosted/local font strategy:
Manrope, Inter, Segoe UI Variable Text, Segoe UI, sans-serif.

| Role | Size | Weight | Notes |
|---|---:|---:|---|
| Display outcome | 32–52px | 700–780 | one per hero, tight leading |
| Page title | 24–34px | 700–760 | short and specific |
| Surface title | 16–20px | 650–720 | one per panel |
| Task title | 12–14px | 650–730 | single-line in dense rows |
| Body | 13–15px | 400–560 | comfortable line height |
| Control label | 11–12px | 650–750 | sentence case |
| Metadata | 10–11px | 450–600 | never the only state cue |
| Eyebrow | 9–10px | 750–820 | uppercase, sparse |

Use tabular numerals for elapsed time, counts, due dates, and values that
change in place. Use negative tracking only for display/page statements.

The two chat surfaces (the in-app sheet and the floating companion) map onto
these roles with one five-step scale — 10 eyebrow, 11 metadata, 12 control,
13 body and card strong, 14 turn and pane title — and introduce no fractional
sizes; 800 weight belongs to the 10px eyebrow alone. The active chat tab is a
quiet inset surface ([navigation states](areas/desktop-shell.md#navigation-states)); ink fills are reserved for the real decisions.
