# Work OS employee site and tutorial library — design

Date: 2026-11-03
Status: implemented; canonical routing and all ten interactive films corrected on 2026-11-04
Worktree: `codex/work-os-tutorial-recuts`
Current acceptance: `docs/work-os-employee-site-verification-2026-11-04.md`
Visual study: `.superpowers/brainstorm/26584-1793724040/content/work-os-desktop-pilot.html`
Approved pilot: `pilot-eod-desktop-60.mp4` (actual desktop app, 60 fps, Inter, music, captions)

## Intent

Give every Wrazy employee one public place to understand Work OS, install the
desktop companion on the right computer, and learn only the task they need in a
short, calm video. The page should feel like the product: warm paper, sage
surfaces, precise typography, a companion who is present but never noisy.

The page is an introduction for employees, not a general SaaS marketing site. It
must be honest about what the software observes, what it does not score, and who
can see what.

## Goals

- Explain Work OS in one scroll: plan the day, work in view, close with a
  reviewable record.
- Detect the visitor's operating system and offer the matching installer;
  Windows and macOS have builds, Linux says it is coming later.
- Host a library of separate short tutorials, one action each, with an opening
  card, real desktop footage, visible clicks, explanatory text and captions.
- Carry the approved "In good company" direction: companion-led welcome,
  animated mascot, restrained editorial motion.
- Link to the page from the WrazyOS landing at `app.wrazyos.com`.
- Make the page fast, accessible, and usable without motion or sound.

## Non-goals

- No productivity scores, ratings, surveillance claims, or invented testimonials.
- No public self-serve signup, pricing, free trial, or marketing analytics.
- No replacement of the WrazyOS root landing or its shell.
- No change to the desktop app's own typography or behavior.
- No live employee data in any screenshot or film.

## Anti-goals

A page that reads like a generic AI SaaS template: gradient hero, identical
rounded feature cards, fake social proof, autoplaying video, or a mascot that
performs constantly. A tutorial that is a silent screen recording with no
instruction. A download button that does nothing on Linux.

## Confirmed direction

- Direction B, "In good company", is approved.
- The mascot blinks, follows the pointer with its eyes, and has a richer idle
  sequence than the installed app. Celebration happens only on click, never on
  a timer.
- Film opening: sage title card, Work OS mark, short eyebrow, large statement,
  the configured mascot, and a provenance line. Then a calm transition into the
  actual desktop app.
- Every film starts at the dashboard and navigates to its task through real
  controls. EOD does not start halfway through the report.
- Inter (self-hosted) for the site and film overlays. Helvetica Neue follows in
  the stack. The app's own UI keeps its typography.
- 60 fps, 1440×900, H.264, faststart, stereo AAC music, on-screen text, VTT
  captions and a transcript.
- Music is original and clearly audible (about −16 LUFS), with a mute control.

## Page and routes

Public route: `/work-os/welcome` on `app.wrazyos.com`.

- `/work-os/welcome` — the landing page.
- `/work-os/welcome/downloads` — OS-aware downloads.
- `/work-os/welcome/tutorials` — the library.
- `/work-os/welcome/tutorials/[slug]` — one film and its written steps.

The existing `/work-os` dispatcher and employee routes are untouched. The proxy
gets exact public exceptions for these paths and their published media, never a
prefix-wide exemption. The WrazyOS landing adds one navigation link and one
footer link.

### Landing content

1. Header: Work OS mark, "by Wrazy", Overview / Tutorials / Downloads, WrazyOS
   back-link, and one `Get Work OS` action.
2. Welcome stage: "A little company. A clearer workday." with the animated
   companion and a short spoken-style line.
3. Product theater: the current desktop dashboard, with selectable My Day /
   Tasks / Insights views, labelled as demonstration data.
4. Three-step story: a clear plan, work in view, a reviewable close.
5. A short film feature plus the tutorial library preview.
6. Closing statement and download action.
7. Footer: privacy, terms, back to WrazyOS.

### Downloads content

- Detected platform line (`It looks like you're using Windows.`).
- One primary action for the matching installer.
- Manual choices for Windows and macOS.
- Linux: `A Linux version is coming later.` with no dead button.
- Build version, size, checksum link, and a support link.
- A short "what happens next" note: sign in, install, connect the workspace.
- **The install surface tells the truth about unsigned builds.** Windows shows
  the SmartScreen warning and how to continue; macOS shows Privacy & Security →
  Open Anyway. Neither build is called signed, trusted, or approved. Antivirus
  delays are named. A retry/support path is always visible.
- The page checks the `desktop_companion` entitlement after sign-in. When the
  organization has it disabled, the action becomes `Ask your admin` with the
  real reason, not a 403.
- `/downloads/work-os/windows` and its checksum sibling redirect to this page so
  the companion README's published contract never dead-ends.

## Access and download policy

The pages and the installer downloads are public. The application itself is
not: the companion cannot open a workspace without a Wrazy-authorized session,
and the browser workspace still requires sign-in. A downloaded installer is
therefore inert to anyone outside the organization.

Public delivery serves only the published installer files, by an explicit
platform allowlist, with checksums and cache headers. It does not expose the
release bucket, a directory listing, or the updater grant contract. Update
grants remain authenticated and unchanged.

- Signed out or signed in: the detected-platform action downloads the same
  published installer.
- Windows and macOS: real installers, with the unsigned-build warnings on the
  page.
- Linux: `A Linux version is coming later.` with no download attempt.
- After install: the companion's normal browser sign-in and workspace
  authorization decide whether it can be used.

This is a deliberate, low-risk choice: the binary is public, the workspace is
not.

## Tutorial roster

Each item is a separate film, not a chapter of one long video. Target 20–35
seconds, with a written transcript and captions.

| Slug | What it teaches | Starts at | Ends on |
|---|---|---|---|
| `getting-set-up` | Connect the workspace and finish onboarding | Connect screen / welcome | My Day |
| `plan-your-day` | Set focus and build a reviewable plan | My Day | Confirmed plan |
| `tasks` | Add, complete and find work | My Day | Task list |
| `activity-recaps` | Read an interval recap, confirm or correct it | My Day | Reviewed recap |
| `clock-in-out` | Clock in, pause/resume, clock out | Companion dashboard | Closed workday |
| `eod-draft` | Draft the report from the record | My Day | Edited draft |
| `eod-submit` | Review and submit the EOD | Draft | Submitted confirmation |
| `insights` | Choose a range and read the record | My Day | Insights detail |
| `settings` | Find profile, display and workday settings | My Day | Settings group |
| `companion-chat` | Send an update and review a recap with Otto | Floating orb | Confirmed recap |

`eod-draft` is the approved pilot. `eod-submit`, `clock-in-out` and
`companion-chat` are the next three, because they cover the highest-risk
actions.

Attendance copy must match the platform: the Windows companion performs
Worktivity clock actions; macOS uses Worktivity's Mac app; the browser is
status-only. A film that cannot show the right surface for a platform is
platform-labelled rather than implying parity.

## Film pipeline

1. **Capture locally.** The desktop companion's offline filming build runs at
   `127.0.0.1:1430` with demonstration data. A deterministic 60 fps shooter
   drives real controls and records settled frames. No backend, no writes.
2. **Package locally.** Silent video, original instrumental, storyboard timing,
   captions and poster.
3. **Finish on the VPS.** Upload the silent video, music and poster; encode
   H.264 60 fps, loudness-normalise, build the poster and contact sheet, probe
   the result, return assets, and delete the scratch directory. Credentials stay
   in the environment and are never committed.
4. **Verify locally.** Exact frame count and 60/1 rate, distinct motion frames,
   measured loudness, captions, poster, no backend calls, no submission.
5. **Publish.** Assets under `public/work-os/tutorials/`, metadata in one
   module, and a test that every listed film, poster and caption file exists.

The shooter and VPS helper are throwaway tooling until the page ships; they
must not expose a production session or accept a real employee token.

## Visual system

- Paper `#fafaf6`, stage `#f5f6f1`, sage `#e6ece1`, ink `#182018`, muted
  `#536052`, line `#d9ded5`, action lime `#a8f15b`, graphite `#1c1d21` for
  product imagery only.
- Inter 400/500/600 for the site; display statements at 550–600. No ultra-bold,
  no italics, no gradient text.
- Content axis 1240px, 24px gutters at narrow widths, 40px minimum touch targets.
- One large product image per band; borders only when they carry grouping.
- Motion: 500–700ms on the product easing; one entrance per section; no
  ambient loops except the mascot's bounded idle. Reduced motion removes all
  transforms and holds the still frame.

## Mascot

The site uses the configured identity and art, never a second mascot. The art is
copied from the companion's public assets and guarded by a test that the copy
and source match. A small client component owns gaze, blink, idle and click
celebration; it pauses offscreen, on hidden tabs, and when the visitor asks.
Click is the only path to celebration. The site must still look complete with
the mascot static.

## Media behavior

- Video never autoplays or loops.
- Play starts sound at a moderate level; volume and mute are visible.
- Captions are on by default when the browser supports them; a transcript is
  always available in text.
- Posters are real frames. A missing poster falls back to a still title card.
- Each film is lazy-loaded; a page downloads only its own film.
- No third-party player, tracker, or font CDN.

## Accessibility

- Semantic landmarks, one h1 per page, skip link.
- Keyboard reachable nav, tabs, player, disclosure and download choices.
- Visible focus at 3:1 or better; Escape closes the player and restores focus.
- Captions and transcripts; no meaning available only in sound.
- `prefers-reduced-motion` gives static sections and still posters.
- 390px layout with no horizontal overflow and the primary action above the fold.

## Performance

- LCP image is the dashboard capture, sized and preloaded.
- Films use `preload="none"` and a poster; total page JS stays within the app's
  existing budget.
- Self-hosted Inter with `font-display: swap`; no render-blocking external font.
- Target: landing LCP under 2.5s on the deployed host, no layout shift from
  media, and no more than one 60 fps film downloaded per visit.

## Security and truth

- Public exceptions are exact paths, not prefixes.
- Downloads stay authenticated; the release grant is untouched.
- No real names, emails, tasks, screenshots, or reports in footage.
- Every film says "Actual desktop app · Demonstration data".
- Activity footage never claims productivity, effort, or completion.
- The EOD film stops before submission unless the film is explicitly the
  submission lesson.

## Deliverables

- A public Work OS page, downloads page and tutorial library in the Work OS app.
- Ten films (one approved, nine to produce), each with poster, VTT and transcript.
- A WrazyOS landing link to the page.
- Tests for route exposure, media completeness, metadata, and the mascot copy.
- Rendered checks at 1440, 1024, 720 and 390, plus reduced motion and keyboard.

## Builder-check resolutions

Calls made after the independent builder review:

- **Install help is part of Downloads.** The page owns the unsigned-build
  warnings, macOS Open Anyway steps, antivirus delay, retry and support path.
  It is not a bare button.
- **The installer is public; the workspace is not.** The page serves only the
  published installer files by explicit platform, with checksums. No release
  listing, no updater grant, and no workspace access are exposed.
- **One primary platform per lesson.** Films are Windows-labelled where the
  action happens in the companion. macOS lessons carry written Worktivity Mac
  steps. A macOS clock film is a later variant, not invented parity.
- **Media stays in the repo for the first release, capped at 40 MB total.**
  Ten 1440×900 60 fps films at CRF 23 with posters and captions fit in roughly
  30–35 MB. If the set grows past the cap, move films to the existing R2 adapter
  and keep metadata in the repo. This avoids a new public storage surface now.
- **The public films supplement the in-app guides; they do not replace them.**
  The in-app guides are 30 short UI clips used during onboarding. The public
  films are a separate teaching set and keep their own manifest.
- **One original musical theme, arranged per lesson.** We own the recording and
  keep the project and a rights note in `docs/assets/`. No library track.
- **`noindex` on the public routes until marketing is approved.** The copy
  describes employee monitoring; it should not be indexed by accident.
- **Agent OS work is a bounded handoff.** This plan includes the exact nav and
  footer change, the exact proxy exceptions and the live probe, applied in the
  Agent OS checkout, not a copy of its shell.
- **Privacy and terms link to the existing public pages.** No new legal copy is
  invented here; the observation wording is reviewed by the product owner.

## Decisions

Confirmed by the user: direction B, animated companion, click-only celebration,
desktop footage, real navigation, music, Inter, 60 fps, public installers,
launch after the first four films, and one Windows clock film with written
macOS Worktivity steps.

My calls:

- Public marketing routes live under `/work-os/welcome`, not at `/`.
- Installers are public; the workspace remains authorized. Only published
  installer bytes are exposed.
- Ten separate tutorials, ordered by risk: EOD submit, clock actions and
  companion chat follow the approved EOD draft.
- Film finish runs on the VPS; live capture stays local.
- Inter is self-hosted; the app's typography is untouched.
- Media stays in the repo for the first release, capped at 40 MB.

Needs your answer:

1. Is the ten-film roster right, or should any scenario be added or dropped?

## Next step

After approval: write the implementation plan, build the page shell and
downloads first, then produce films in the approved order. Do not deploy or
publish any film until its own verification passes.
# November 4 correction

The canonical public landing is `/work-os`, with `/work-os/downloads` and
`/work-os/tutorials`. It must be independent of the console shell; `/work-os/workspace`
is the protected dispatcher. Earlier `/work-os/welcome` references below describe
the original implementation and now redirect to the canonical public routes.
All ten tutorial films have been replaced with interactive, scene-aware takes;
static overview clips do not satisfy the tutorial acceptance criteria.
