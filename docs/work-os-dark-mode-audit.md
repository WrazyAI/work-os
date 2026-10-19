# Dark-mode material audit — agent-os console + Work OS routes

Ground truth: live `app.wrazyos.com` in dark mode, signed-in via the e2e fixture
(12 pages captured: 7 admin + 5 employee). Measured with pixel probes, not by eye.

## What the console shell uses in dark

`html[data-theme="dark"]` (agent-os's own tokens, unchanged by this task):

| role | value | warmth (R+B−2G) |
|---|---|---|
| `--bg-primary` | `#1b1c1f` | −1 (cool graphite) |
| `--bg-card` | `#232427` | −1 |
| `--text-primary` | `#e9eaed` | +2 (neutral white) |
| `--text-secondary` | `#9b9fa8` | +5 |

## What the Work OS scope uses in dark

`[data-theme="dark"] [data-work-os-workspace]` — the dark extension of the
§3.1 roles, in `src/app/globals.css`:

| role | value | warmth |
|---|---|---|
| `--color-canvas` | `#14170f` | −11 (olive) |
| `--color-raised` | `#1d221a` | −13 |
| `--color-ink` | `#eef1eb` | −9 (cream) |
| `--color-ink-soft` | `#c6cfbc` | −28 (cream) |
| `--color-muted` | `#8e9885` | −29 (olive) |

## The defect

The dark scope was built by **inverting the light stack while preserving its
hue**. The light stack is the blueprint's warm paper: canvas `#eef1eb`
("warm ivory canvas"), ink `#182018` ("near-black green ink"). Inverting that
hue gives a cream ink and olive surfaces.

At high luminance the difference is invisible: measured light-mode warmth of
the console shell is −2 and of the Work OS canvas −2 — a delta of 0 to −3, one
material. At dark luminance the same hue difference amplifies: measured dark
warmth is −1 for the shell and −13 to −15 for the Work OS canvas — a delta of
**−12 to −15**. Two materials, and the warm one reads as ivory/cream dropped
into a cold dashboard. This is the "mix of ivory".

The inversion also inverts a *near-invisible* difference into a loud one: the
light ink `#182018` (green-black) is imperceptibly different from neutral
`#15171c`, but its inverse `#eef1eb` (cream) is clearly different from neutral
`#e9eaed`.

A second, related leak: the categorical chart palette is hardcoded to
light-tuned hexes (`#a8833c` ochre, `#b06a4a` rust, `#6f8d7c` sage,
`#8d7fa8` mauve, `#5f7fa0` steel). On ivory paper they read as a calm
desaturated family; on graphite they read as sandy brown patches — the same
ivory cast, inside the charts.

## The fix

Keep every §3.1 role; rebuild the dark values as **one cool graphite
material** that shares the console's ink temperature, so the workspace reads
as a single surface inside the host app. Identity in dark comes from the
signal green and the layout, not from a warm cast. Light mode is untouched —
it measures coherent and the warm ivory stack is the blueprint.

Chart categorical colours become theme-aware so no light-tuned warm tone sits
in a dark chart.

## Verification bar

- Warmth delta between console shell and Work OS canvas collapses to ~0 in
  dark (currently −12 to −15), while light stays at ~0.
- Contrast of ink ramp, signal, and status colours against their dark
  surfaces stays at or above WCAG AA.
- Rendered dark screenshots of all 12 admin + employee pages.
- Live dark pages after deploy, measured with the same probes.
