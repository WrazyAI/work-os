# Download warning clarity

Ledger: `6e24e553-3a59-4cc2-b6f8-21bf042fe73a`
Branch: `codex/download-warning-clarity`

## Scope and design

- One detected Windows/macOS download plus adjacent alternate-platform dropdown.
  Unknown/unsupported devices explicitly default to Windows without claiming detection.
- Remove Linux from the public offering, not the server's unsupported-platform guards.
- Short thank-you heading, red warning panel first, three installation steps,
  collapsed troubleshooting/checksum instructions, one setup tutorial link.
- Retain the site's self-hosted type and paper/ink/lime palette. Semantic warning
  colors: red `#b42318`, light red `#fff1ef`, dark red text `#7a271a`.
  Red triangle + explicit heading carry urgency without animation or color alone.
- Left-aligned reading column; no decorative download details card or repeated copy.
- Security: distinguish unknown-publisher warnings from malware detection. Never
  globally disable protection or tell employees to restore quarantined malware.
- References: Anthropic frontend-design guidance and Elaya minimal conversion layout.
  Keep existing brand fonts/chrome; omit marketing sections/animation that would
  fight the user's explicit text-reduction requirement.
- User follow-up: shared public-site header uses the exact desktop
  `src/assets/work-os-mark.png` artwork, not a typed placeholder letter.

## Ordered checklist

- [x] Create ledger, inspect deployed implementation, references and blueprint.
- [x] Start dedicated worktree from latest main; merge the existing same-repository
  public-site branch for baseline (no Agent OS tree/history merge).
- [x] Add failing real-browser flow checks before changing behavior.
- [x] Simplify chooser and guides; update focused regression contracts.
- [x] Focused tests, typecheck, full suite, production build, rendered/keyboard checks.
- [x] CodeRabbit attempted; independent review completed. TestSprite run inspected
  and classified inconclusive rather than claiming its false pass as acceptance.
- [x] Port only changed public-page files to Agent OS, deploy and verify live.

## Baseline

The six public UI files match Agent OS `bafebf93` by content. Existing guide
warnings follow a large hero/details card and four install steps. New branch
merges the previously deployed site branch onto Work OS `b9169cc2` cleanly.
This task makes no installer version change. Concurrent main commit `392bca85`
prepared Companion 0.5.20 while verification ran; it is preserved by content and
the website change neither triggers nor overrides that separate release.

## Verification evidence

- Browser tests failed first on the missing dropdown, then separately on the
  placeholder logo lacking an actual image.
- Final direct Chromium flow passed: detected Windows and Mac defaults; alternate
  downloads; Enter/ArrowDown/Escape/outside dismissal and focus; actual EXE/DMG
  attachments and matching published hashes; guide navigation; red warning panel
  before install steps; disclosures; unknown-device fallback; original desktop
  logo bytes; 1440/1024/720/390/320px and reduced-motion checks.
- Focused suite: 17 passed. Public-site suite: 59 passed. Changed-file lint clean.
- Full Work OS suite: 1,244 passed, 11 opt-in PostgreSQL skipped, no failures.
  Agent OS full suite: 919 passed, no failures. Both typechecks passed.
- Work OS and Agent OS production webpack builds passed.
  Local webpack is used because Turbopack rejects
  the instructed shared node_modules symlink outside its inferred root.
- CodeRabbit 0.9.2 could not authenticate (not a successful review). Independent
  bounded review returned no actionable findings; it flagged native OS/Safari
  acceptance and pending suite evidence as limitations.
- WebKit could not launch because this machine lacks `libxslt.so.1`; no Safari
  pass is claimed. Native SmartScreen/Gatekeeper dialogs were not exercised.
- Approved TestSprite case `e2ed4fb0-96ed-4892-a053-8173e21afcb9`, run
  `258fea15-0dd5-4848-85d9-b3a84dffc281`: CLI reports passed but the pinned steps
  are empty and the 1.934-second recording shows only a 404. Treat as
  **inconclusive**, not acceptance. Tool latency: approximately 14 minutes.
  Failure-artifact endpoint refuses the request because it classified the run
  as passed; its recording was downloaded and inspected independently.
- Screenshots and logs: `/tmp/opencode/download-warning-clarity/` and
  `/tmp/opencode/download-warning-*.log` (local evidence, not committed).
- Lighthouse accessibility/best-practices scores were 100/100. Its experimental
  label-in-name audit exposed the existing header aria-label omitting the visible
  byline; the brand link now derives its accessible name from its visible text.
  The local robots.txt SEO issue is outside these noindex installation pages.

## Content convergence

Only the public downloads/guide components, their CSS, shared public header,
actual logo asset and focused acceptance files are ported to Agent OS based on
`bafebf93`. Platform layout, proxy, next config and operational surfaces stay
unchanged. Work OS main's previously deployed public-site branch was reconciled
inside the same repository, never merged from Agent OS history.

## Final live acceptance

- Work OS implementation: `6bca6b48`; concurrent main reconciliation `376dca30`;
  verification record `e47a92cb`.
- Agent OS implementation and deployed commit:
  `fd60b6cb965b61b7fa298c16b5345e5e755fd926`.
- Atomic VPS redeploy completed: staging build, swap, service restart and asset
  checks succeeded; web and runner services both reported active.
- Live `WORK_OS_SITE_URL=https://app.wrazyos.com node
  test/work-os-download-flow.browser.mjs` passed all Chromium flow assertions,
  including both real primary/alternate platform downloads, hashes, routing,
  original desktop logo bytes, warning-first geometry, keyboard and responsive
  checks. Live screenshots inspected at wide and narrow widths.
- Live evidence: `/tmp/opencode/download-warning-live/` and
  `/tmp/opencode/download-warning-live-browser.log`.
- Final local Lighthouse: accessibility 100, best practices 100, no remaining
  label-in-name issue; only unrelated local robots.txt SEO finding remains.
- No successful CodeRabbit, TestSprite, Safari or native-installer acceptance is
  claimed. Direct live browser checks and the recorded suites are the acceptance
  evidence for this website-only task.
