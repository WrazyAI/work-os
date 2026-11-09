# Good company — public site redesign

Ledger: `900dc4cd-e4f1-4944-bd79-0c09f04934bc`.
Approved design/plan: `docs/superpowers/{specs,plans}/2026-11-09-work-os-good-company*.md`.

## Outcome

- Approved aubergine landing, oversized statement and sage app/mascot stage.
- Height-aware composition keeps the entire261px stage inside1366×768;
 1366×650 also fits its221px stage. Desktop/narrow screenshots inspected.
- Locally bundled GSAP3.14.2, coordinated entrance, quiet one-shot section
  transitions, interactive real-product captures; fail-open static server HTML.
- Click/Enter/Space gives Otto the existing canonical happy eyes/check smile,
  including statically under Pause and reduced motion. Pointer gaze/idle motion
  stops offscreen/in hidden tabs. Repeated clicks keep one bounded timer.
- Public downloads/tutorials remain light with purple/lilac accents. Installer
  warnings remain red; videos, player, chapters and adjacent lessons untouched.
- No desktop version, companion queue, data/auth or installer resolver changes.

## Verification

- Baseline5focused passed; missing approved headline and reduced-motion success
  were observed RED before implementation and GREEN afterward.
- Focused11passed; public-site59passed; full Work OS1273passed/11opt-inPGskips,
  no failures. Full suite repeated after independent-review CSS fix, same result.
- Agent OS931passed; both typechecks and production webpack builds passed.
- Changed-file ESLint:0errors,3`no-img-element` warnings for local SVG/real
  product and tutorial captures (same direct-asset strategy as existing site).
- Direct browser:1366×768/650,1440×900,1920×1080,1024×768,720×900,390×844,
 320×740; no overflow; short-screen whole stage; screenshot selection and rapid
  motion-enabled switching; click/keyboard/repeat/paused/reduced success;
  no-JS; blocked JS and failed art fetch retain static content; delayed motion
  import after Pause, delayed art after click and capture-transition unmount.
- Local Lighthouse accessibility100/best-practices100. Unrelated local
  robots.txt SEO warning remains; installation/public-site indexing unchanged.
- CodeRabbit0.9.3 completed against7ecbe216 with0findings. Independent bounded
  review found a low-contrast dark-landing skip link: measured failing browser
  contrast test first, explicit contrasting background added, test passed.
- Existing approved TestSprite download test `e2ed4fb0-96ed-4892-a053-8173e21afcb9`,
  run `eccbb219-443d-443a-a74d-7bfcda7516d9`: provider reports passed, but pinned
  steps are empty and3.934s video shows404. **Inconclusive**, not acceptance.
  Provider latency approximately63seconds. Direct browser checks are acceptance.
- No Safari/WebKit/native installer-dialog pass claimed.

## Content convergence and status

Work OS commits after rebasing onto the latest main: `c9612751` composition;
`18381ce5` scoped motion/success; `8403109f` contrast correction/evidence.
Only changed marketing components/styles, public layout attribute, tests,
design paragraph and GSAP dependency are ported onto Agent OS6abfee78. Platform
shell, proxy, Next config, scripts, APIs and media stay untouched. Agent OS's
unrelated dependency/script differences remain intact.

Agent OS prepared commit: `de26ee27`. User explicitly authorized production
deployment. Pending: exact-tree final check completion, remote convergence,
atomic deployment and live acceptance. No live server has changed yet.
Local evidence: `/tmp/opencode/good-company-*` (not committed).
