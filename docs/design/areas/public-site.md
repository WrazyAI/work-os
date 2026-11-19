# Public site, downloads, and tutorials

**Use when:** Editing the public landing page, download flow, installation guidance, or tutorials.

**Owns:** The approved Good company marketing treatment and public route boundaries.

**Requires:** [Shared foundations](../foundations.md) (read each once per task).

**Read next only if:**

- Changing the transition into the authenticated workspace: [Web employee workspace](web-workspace.md).
- Changing shared otto artwork: [Floating companion, Otto, and assets](floating-companion.md).

**Implementation starting points:** [marketing](../../../src/modules/work-os/marketing), [tutorial-film](../../../scripts/tutorial-film).

The product landing alone uses the approved aubergine `#272331`, warm white
`#efeee9`, sage stage `#d6e5cb` and pale green action `#d4e8be`. Its large
two-line statement and real app/Otto stage respond to screen height as well as
width: at1366×768 the whole stage is visible before scrolling. GSAP supplies
one coordinated entrance and restrained one-shot section transitions, never a
scroll hijack or a loading gate. Static content stays visible if JS fails.
Otto's click uses the canonical success face, including statically under Pause
or reduced motion; idle work suspends offscreen/in hidden tabs.

The downloads, installation guides and tutorials stay light, with dark-purple
ink and restrained lilac grounds; buttons and icon controls use pale green
`#d4e8be` with dark-green ink and text-safe green focus/selected treatments.
Red install warnings keep their semantic
danger treatment. This marketing-only palette does not recolor the workspace or
companion. Tutorial videos, player/chapters and download behavior are unchanged.

`/work-os` is the public, standalone product landing page, not a console
destination. Its downloads and tutorials live at `/work-os/downloads` and
`/work-os/tutorials`; these pages never inherit the dashboard sidebar or header.
The public site's workspace action enters through `/work-os/workspace`, which
keeps the authoritative session, membership and role checks. Legacy
`/work-os/welcome` links redirect to the canonical public routes.

Public downloads offer Windows and macOS only: one detected-platform download
with an adjacent alternate-platform disclosure. The thank-you guide leads with
a red warning triangle, explicit security heading, and visible antivirus/IT
escalation guidance before three short install steps. Unknown-publisher prompts
never imply that malware alerts are safe to bypass. Extra prompt help and checksum
commands are disclosures, not a wall of text. The public header uses the same
Work OS artwork as the companion, never a typed-letter imitation.
