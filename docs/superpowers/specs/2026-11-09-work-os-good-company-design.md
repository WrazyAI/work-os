# Work OS — Good company

Ledger: `900dc4cd-e4f1-4944-bd79-0c09f04934bc`

## Approved intent

Replace the generic public landing with the user's selected Good company
direction: aubergine, oversized type, sage product stage, real desktop captures,
and Otto. The user approved the revised preview and asked to proceed, keeping
the 1366×768 composition fix, clean GSAP motion, and an animated Otto whose
click uses the existing celebration/success face, not just a wave.

Continue purple accents on the public downloads and tutorials, but retain
white/paper backgrounds there. Tutorial video files and player behavior stay
unchanged. This is a website change, not a companion release or workspace redesign.

## Visual contract

- Landing only: aubergine `#272331`, warm text `#efeee9`, muted `#cbc6d4`,
  sage stage `#d6e5cb`, pale green action `#d4e8be`, purple raised `#3b3347`.
- Light public pages: white/paper base, dark purple ink, violet focus/selected
  accents, pale lilac grounds where appropriate. Danger panels remain red.
- Keep the actual desktop logo and existing self-hosted font.
- Hero: `Good work.` / `Good company.` as two desktop lines. Intro and action
  row follow; the mint stage contains actual app screenshots and the mascot.
- Type, vertical gaps, header and stage respond to height as well as width.
  At1366×768 the whole stage, at least240px tall, is visible before scrolling;
  at1366×650 at least220px is visible. No scrolling tricks or text clipping.
- Responsive at1920/1440/1366/1024/720/390/320px, including short viewports and
  text zoom. CTA remains reachable without animation.
- Below hero: quiet benefit band, editorial workday statement, three real
  workflow descriptions, existing tutorial thumbnail/link, final CTA/footer.

## Motion and mascot

Use GSAP3.14.2 bundled locally, scoped to the landing rather than external CDN
scripts. One coordinated entrance; restrained one-shot section reveals and
user-triggered screenshot transitions. Never hide essential content in CSS
while waiting for JavaScript, and never gate clicks on the animation.

The existing web mascot rig/art remains canonical. Pointer gaze and natural
idle movement can continue. On click/Enter/Space show the canonical happy eyes
and check-mark mouth used by the companion's `celebrate` pose; a bounded body
gesture may accompany it. Return to idle after the bounded moment. Repeated
clicks restart that moment without accumulating timers. Under reduced motion
or Pause the success face still appears statically; it is not suppressed.

Provide Pause/Resume motion, visible keyboard focus, and reduced-motion
support. Suspend idle work offscreen/in hidden tabs. Clean up GSAP contexts,
listeners, observers and timers on unmount; no transforms fight over one node.
Failed/slow library or art loading leaves a useful static page.

## Boundaries and builder calls

- Keep Next server content and small client interaction boundaries.
- Extend shared SiteHeader/SiteFooter with an optional dark variant only on
  the landing; do not recolor every route or the platform shell.
- Preserve canonical links, protected workspace entry, download OS dropdown,
  immediate guide navigation, latest-published installer resolution, tutorial
  chapters and named Previous/Next links.
- No model calls, account writes, schema changes, generated claims/testimonials,
  new video assets, desktop version changes, or companion release-queue entries.
- Reuse `Companion` for mascot rendering; its existing web success glyph
  matches the canonical celebrate glyph. Do not change installed mascot identity.
- Add GSAP to package/lock; use linked existing dependencies without npm install
  over any running server. Do not overwrite Agent OS package or platform files.
- Port only reviewed changed marketing files and the added dependency by
  content into Agent OS; deploy atomically only after required checks pass.

## Acceptance

Focused render/source contracts plus real browser checks are required: hero
geometry at1366×768 and650, all responsive classes/no horizontal overflow,
pointer/click/keyboard success face, repeated clicks, pause/resume, live reduced
motion, view switching, slow/failed art, no-JS static rendering, light sibling
pages with red danger panel, real downloads/checksums and tutorial navigation.
Verify tutorial media assets are untouched. Then typecheck, site suite, full
Work OS suite, lint, production build and one CodeRabbit batch review. Run the
reusable TestSprite public-site journey and inspect artifacts; a false/incomplete
provider pass is not acceptance. Verify actual deployed flow after atomic release.

Prototype references (local only): `.superpowers/brainstorm/45397-1794239771/`;
1366×768 revised stage measured471–732px including the preview toolbar.
