# Unsigned install guides and tutorial lesson navigation — verification

Date: 2026-11-04
Work OS branch: `codex/work-os-download-guide`
Work OS commit: `2da161d3`
Agent OS deployment commit: `bafebf93`
Live site: `https://app.wrazyos.com`

## What shipped

### Download completion guides

- Every download action now starts the real installer and immediately opens a
  platform-specific install guide:
  - `/work-os/downloads/thank-you/windows`
  - `/work-os/downloads/thank-you/macos`
- The download button uses a temporary real anchor with `download`, then a
  client-side route change. The installer request and the guide navigation do
  not depend on each other, and a modified click still uses the browser's own
  download behaviour.
- The two guide routes are the only new public exceptions; unknown or deeper
  guide paths still require sign-in.
- Windows help covers browser “Keep”, SmartScreen “Windows protected your PC”
  → “More info” → “Run anyway”, UAC “Unknown publisher”, antivirus quarantine,
  and the case where “Run anyway” is unavailable.
- macOS help covers “Done” rather than “Move to Bin”, System Settings →
  Privacy & Security → “Open Anyway”, authentication, dragging the app to
  Applications, the first-launch prompt, a missing “Open Anyway”, and a damaged
  app. It explicitly says not to disable Gatekeeper or antivirus globally.
- Each guide includes the exact file name, a retry path when no file arrived,
  and an optional SHA-256 command for its platform.
- The guides are not linked before a download, so the “download has started”
  claim is only used on the post-download path.

### Tutorial previous/next navigation

- Every tutorial page now ends with a `More tutorials` navigation.
- The previous and next lessons come from the shared `TUTORIALS` order via
  `adjacentTutorials()`.
- The first lesson shows only Next; the last shows only Previous.
- Each link carries the adjacent lesson's title, an explicit accessible name
  (`Previous tutorial: …` / `Next tutorial: …`), visible keyboard focus, and a
  one-column layout at narrow widths.

## Verification

### Automated

- Work OS typecheck: clean.
- Work OS site/publication suite: **59/59 pass**.
- Work OS production build: green; both guide routes statically generated:
  `● /work-os/downloads/thank-you/[platform]` with `windows` and `macos`.
- Work OS full suite: **1,244 passed, 11 skipped, 0 failed** (run before the
  final site-only copy/link cleanup; the final site suite and build above were
  rerun afterward).
- Agent OS typecheck: clean.
- Agent OS tutorial library: **5/5 pass**.
- Agent OS full suite: **919/919 pass**.
- Agent OS production build: green, including the guide route.

### Live browser evidence

- A real Windows download from the live downloads page produced
  `Work-OS-Companion-Setup-UNSIGNED.exe`.
- Downloaded bytes: **14,204,156**. SHA-256:
  `fd729c552830470da43adb84a574c212b37b1ce11211ce022b0704f85d1ceda9`,
  matching the live `SHA256SUMS.txt`.
- A real macOS download, driven with a Mac user agent, produced
  `Work-OS-Companion-macOS-Universal-UNSIGNED.dmg` (**32,014,955 bytes**) and
  opened the macOS guide. The macOS checksum route includes that file name.
- The manual “Download” option for Windows was also exercised; it downloaded
  the same `.exe` and opened the Windows guide. All three download actions
  share the same component.
- The Windows click navigated to the Windows guide while the download
  continued.
- Live guide responses:
  - Windows guide: `200`, `text/html`.
  - macOS guide: `200`, `text/html`.
  - Unknown guide path: `307` to `/login`.
- Live installer response headers include
  `content-disposition: attachment; filename="Work-OS-Companion-Setup-UNSIGNED.exe"`,
  `x-work-os-authenticode: unsigned-internal`, and release
  `work-os-companion-internal-v0.5.18`.
- The live tutorial previous/next links resolved correctly on the first,
  middle, and last lessons:
  - first: Next → Plan your day;
  - middle: Previous → Get set up with your companion, Next → Add and complete
    work;
  - last: Previous → Use Otto, the floating companion.
- Narrow checks at 390×844 found no horizontal overflow on either guide or the
  tutorial page. Wide checks at 1440×900 were clean.
- After the guided download navigation, the skip link remained visually hidden
  (`top: -80px`); the change to `:focus-visible` prevents mouse-driven route
  changes from showing it while preserving keyboard access.
- A real keyboard pass on the tutorial navigation produced a 2px
  `rgb(94, 157, 39)` focus outline on the previous link.
- TestSprite’s stored chapter test (`d744b581-c319-4585-b506-e85acb041ed8`)
  was run against production and reported a failure: it said the video stayed
  at 0:00 after selecting parts 04 and 07. That failure did not reproduce in a
  direct Chromium check on the same live URL: part 04 sought to **73.4 s**,
  part 07 sought to **151.599999 s** of **200.683333 s**, and an explicit play
  advanced to **153.518045 s** at 1440×900 with no media error. The stored
  TestSprite run is therefore recorded as a harness failure, **not** a passing
  test.

## Review

- CodeRabbit CLI’s review endpoint rejected the session again with
  “could not be authenticated”. This is **not** a CodeRabbit pass.
- An independent review found no Critical issues and two Important issues:
  1. pre-download guide links made the “download started” claim false;
  2. tests did not protect the actual programmatic download click.
- Both were fixed: the pre-download guide links and cross-platform switcher
  were removed, a retry paragraph covers a missing download, and tests now
  assert the temporary anchor creation, `href`, `download`, and `click()`, plus
  a negative guard against disabling Gatekeeper or antivirus.
- A follow-up review confirmed both Important findings resolved and found no new
  Critical/Important defects.

## Residual risks

- Direct/bookmarked guide URLs still show “download started” even when no
  download occurred; the page is unlinked and carries a retry paragraph.
- Safari and Firefox were not driven; Chromium on the live site was. Synthetic
  anchor downloads are standard, but Safari's download permission handling was
  not exercised.
- If the installer route returns an error, the visible `download` attribute can
  save the JSON error as a file; the guide's retry paragraph is the recovery
  path. The live route returned the expected binary and published checksum.
- No companion installer release, version bump, AI, auth, attendance, database,
  or vault behavior changed.
