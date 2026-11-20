# Evidence hybrid — design

**Status:** Approved by the operator on 2026-11-20. This is the desktop Administration → Evidence page.

## Intent

The Evidence page must make provider actions readable before it makes setup visible. The operator's concrete failure was a sent email disappearing inside more than a hundred outbound calls. The page keeps one record surface and adds a second reading of the same record:

- **Record** — the day ledger: count shape, a 14-day pulse, kind filters, hour rollups, and the individual email row.
- **Coverage** — the team matrix: people × day density, email markers, and a `Not employee work` row.

A persistent `Record / Coverage` toggle at the top of the page switches between them. The Record filters survive the switch. Selecting a Coverage cell updates the drill-down ledger below and `Open in Record` applies that person and day to the Record filters.

## Record

- One large surface with a hairline-ruled index band, query bar, and ledger. No card grid.
- Index band: total records, calls, emails, people, range scope, and a 14-day all-source pulse. Selecting a pulse day sets the range to that day.
- Query bar: search, person (including Unattributed), source, kind chips (`All`, `Calls`, `Emails`, `Texts`, `Work`, `Context`), and a disputed toggle.
- Ledger grouped by day, then by hour for repeated calls. The group row states the exact status mix; expanding it shows every call.
- Email rows stay individual and visually distinct. They are never collapsed into a call group.
- The drawer separates `Actor`, `Assigned`, and `Automation`; `Occurred` and `Mirrored` are separate facts. Ownership is never presented as authorship.
- Activity recaps remain reachable as a secondary Record view, not a third top-level mode.
- GitHub connections and unmapped accounts move into a Connections drawer so the record leads.

## Coverage

- 14-day people × day matrix. Cool-blue density steps; a small mail marker on days with email.
- `Not employee work` row for actor-unknown, assigned-only, and automation events.
- Selecting a cell updates the drill-down ledger below using the same row, group, and drawer components.
- `Open in Record` switches to Record with the selected person/day and source `All`; `Not employee work` maps to the Unattributed person filter.
- Coverage is intentionally the whole team for its 14-day window; it is not a re-render of the Record filters.

## Material and responsive

Use the canonical Work OS tokens from `design.md` §3. The toggle is a quiet inset segmented control, not a signal-filled tab. The page must render honestly in light and dark at 1440, 1024, 720, and 390px; the toggle becomes full width below 860px.

## Data rules

- Order and label rows by provider occurrence time (`recorded_at`), not the mirror write time (`created_at`).
- Kind counts must cover the full filtered range, not just the loaded page.
- Coverage counts must include uncredited GHL events as well as linked evidence.
- Search is server-side and included in the summary counts.
- No invented contact names, subjects, or message bodies. The page shows what the provider record contains.
