# Work OS employee site and tutorial library — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public “In good company” Work OS site, public installer downloads, and a tutorial library carrying the approved desktop films.

**Architecture:** A public Next.js route segment at `/work-os/welcome` renders a server-first marketing page with three small client islands (mascot, product theater, download chooser, player). Installer bytes come from a server-only release proxy with an explicit platform allowlist. Tutorials are metadata plus self-hosted MP4/poster/VTT files, rendered by one lesson page. No employee session or release token reaches the browser.

**Tech Stack:** Next.js 16 App Router, React 19, CSS Modules, existing `work-os-release-download.ts`, node:test, Playwright for rendered checks.

**Spec:** `docs/superpowers/specs/2026-11-03-work-os-employee-site-design.md`

## Global Constraints

- Public paths: `/work-os/welcome`, `/work-os/welcome/downloads`, `/work-os/welcome/tutorials`, `/work-os/welcome/tutorials/[slug]`, `/downloads/work-os/*`.
- No prefix-wide public exemption; exact paths only.
- Installers are public; the workspace stays authorized. No release token or GitHub URL reaches the client.
- Inter is self-hosted; no external font or tracker.
- Video never autoplays or loops; music starts only on play; captions and transcript always available.
- Reduced motion removes transforms and animation.
- Every film is labelled `Actual desktop app · Demonstration data`.
- Total committed media under 40 MB.
- `noindex` on all public routes until approved.
- No product-file changes to the desktop app.

---

### Task 1: Public route shell, tokens and proxy

**Files:**
- Create: `src/app/work-os/welcome/layout.tsx`
- Create: `src/app/work-os/welcome/page.tsx`
- Create: `src/modules/work-os/marketing/site.ts`
- Create: `src/modules/work-os/marketing/site.module.css`
- Modify: `src/proxy.ts` (exact public paths)
- Test: `test/work-os-welcome-routes.test.mts`

**Interfaces:**
- Produces: `WORK_OS_SITE` copy object, `WELCOME_PATHS` string array, `MarketingLayout` route shell.
- Consumes: existing root layout and `globals.css`.

- [ ] **Step 1: Write the failing proxy test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server.js";
import { proxy } from "../src/proxy.ts";

test("public Work OS site routes are reachable anonymously", async () => {
  for (const route of ["/work-os/welcome", "/work-os/welcome/downloads", "/work-os/welcome/tutorials", "/work-os/welcome/tutorials/eod-draft"]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 200, `${route} must be public`);
  }
});

test("the public site does not open the employee workspace", async () => {
  for (const route of ["/work-os/today", "/work-os/review", "/api/work-os/me/day", "/work-os/welcome/internal"]) {
    const response = await proxy(new NextRequest(`https://app.wrazyos.com${route}`));
    assert.equal(response.status, 307, `${route} must require sign-in`);
  }
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --import tsx --test test/work-os-welcome-routes.test.mts`
Expected: FAIL (routes redirect to `/login`).

- [ ] **Step 3: Add exact public paths and the route shell**

In `src/proxy.ts`, before the prefix checks:

```ts
const WORK_OS_WELCOME_PATHS = [
  "/work-os/welcome",
  "/work-os/welcome/downloads",
  "/work-os/welcome/tutorials",
] as const;
if (WORK_OS_WELCOME_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return true;
```

The tutorial prefix is safe only because the lesson page itself validates the slug against the server-side tutorial list.

Create `src/app/work-os/welcome/layout.tsx` as a server component that imports the module CSS and exports `metadata = { title: "Work OS — a clearer workday", robots: { index: false, follow: false } }`.

Create `src/app/work-os/welcome/page.tsx` returning the header and a placeholder `<main>` so the route compiles.

Create `site.ts` with the exact nav labels (`Overview`, `Tutorials`, `Downloads`), the WrazyOS back-link, and the recurring provenance string.

- [ ] **Step 4: Run the proxy test and typecheck**

Run: `node --import tsx --test test/work-os-welcome-routes.test.mts && npm run work-os:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/proxy.ts src/app/work-os/welcome src/modules/work-os/marketing test/work-os-welcome-routes.test.mts
git commit -m "feat(work-os): open the public employee site routes"
```

---

### Task 2: Landing page

**Files:**
- Create: `src/modules/work-os/marketing/LandingPage.tsx`
- Create: `src/modules/work-os/marketing/ProductTheater.tsx` (client)
- Create: `src/modules/work-os/marketing/landing.module.css`
- Modify: `src/app/work-os/welcome/page.tsx`
- Test: `test/work-os-welcome-routes.test.mts` (rendered copy)

**Interfaces:**
- Consumes: `WORK_OS_SITE`, `ProductTheater`.
- Produces: the landing sections listed in the spec; anchors `#how-it-works`, `#tutorials`.

- [ ] **Step 1: Write the failing render test**

Use the existing server-render harness pattern in `test/work-os-surface.test.mts` to render `<LandingPage />` and assert:

```ts
assert.match(html, /A little company\./);
assert.match(html, /A clearer workday\./);
assert.match(html, /Get Work OS/);
assert.match(html, /Actual desktop companion/);
assert.doesNotMatch(html, /autoplay/);
assert.doesNotMatch(html, /lorem ipsum/i);
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --import tsx --test test/work-os-welcome-routes.test.mts`
Expected: FAIL (component missing).

- [ ] **Step 3: Implement the page**

Sections, in order: header, welcome stage with mascot, product theater (My Day/Tasks/Insights screenshots with real alt text), three-step story, film feature (approved EOD pilot), closing statement, footer. Use semantic `<header>`, `<main>`, `<section>`, `<footer>` and one `<h1>`.

`ProductTheater` is a small client component with three buttons, `aria-pressed`, and images from `/work-os/workspace-*.webp`. It does not autoplay or animate continuously.

- [ ] **Step 4: Run the test and the route test**

Run: `node --import tsx --test test/work-os-welcome-routes.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/work-os/marketing src/app/work-os/welcome/page.tsx test/work-os-welcome-routes.test.mts
git commit -m "feat(work-os): build the In good company landing page"
```

---

### Task 3: Animated companion

**Files:**
- Create: `public/work-os/studio-otto.svg` (copy of the companion asset)
- Create: `src/modules/work-os/marketing/Companion.tsx` (client)
- Create: `src/modules/work-os/marketing/companion.module.css`
- Test: `test/work-os-companion-mascot.test.mts` (asset parity)
- Test: `test/work-os-welcome-routes.test.mts` (static fallback)

**Interfaces:**
- Produces: `Companion` with `aria-label="Play companion celebration"`, `data-state="idle" | "celebrate"`, `data-reduced`.
- Consumes: `public/work-os/studio-otto.svg`.

- [ ] **Step 1: Add the asset-parity test**

```ts
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const source = readFileSync("desktop/work-os-companion/public/studio-otto.svg");
const site = readFileSync("public/work-os/studio-otto.svg");
assert.equal(createHash("sha256").update(site).digest("hex"), createHash("sha256").update(source).digest("hex"));
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --import tsx --test test/work-os-companion-mascot.test.mts`
Expected: FAIL (site copy missing).

- [ ] **Step 3: Copy the asset and implement the component**

Copy the SVG unchanged. The client component loads the same rig, applies blink, pointer gaze, idle curiosity and a click-only celebration. It must:
- pause when `IntersectionObserver` says offscreen,
- stop on `document.hidden`,
- expose a pause/resume control,
- render a still, complete figure under reduced motion,
- never celebrate on a timer.

The static fallback is an `<img>` of the same asset so the page works without JS.

- [ ] **Step 4: Run the tests**

Run: `node --import tsx --test test/work-os-companion-mascot.test.mts test/work-os-welcome-routes.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add public/work-os/studio-otto.svg src/modules/work-os/marketing/Companion.tsx src/modules/work-os/marketing/companion.module.css test/work-os-companion-mascot.test.mts
git commit -m "feat(work-os): animate the configured companion on the site"
```

---

### Task 4: Public installer downloads

**Files:**
- Create: `src/lib/work-os-installers.ts`
- Create: `src/app/downloads/work-os/[platform]/route.ts`
- Create: `src/app/downloads/work-os/[platform]/checksums/route.ts`
- Create: `src/app/work-os/welcome/downloads/page.tsx`
- Create: `src/modules/work-os/marketing/DownloadChooser.tsx` (client)
- Modify: `src/proxy.ts` (public `/downloads/work-os`)
- Test: `test/work-os-installer-downloads.test.mts`

**Interfaces:**
- `publicInstallerPlatform(value: string): "windows-x86_64" | "darwin-universal" | null`
- `publicInstallerAsset(platform): typeof WINDOWS_INSTALLER_ASSET | typeof MACOS_INSTALLER_ASSET`
- `detectPlatform(input: { platform?: string; userAgent?: string }): "windows" | "macos" | "linux" | "unknown"`
- Consumes: `downloadInternalReleaseAsset`, `WINDOWS_INSTALLER_ASSET`, `MACOS_INSTALLER_ASSET`, `WINDOWS_CHECKSUM_ASSET`.

- [ ] **Step 1: Write the failing tests**

```ts
assert.equal(publicInstallerPlatform("windows"), "windows-x86_64");
assert.equal(publicInstallerPlatform("macos"), "darwin-universal");
assert.equal(publicInstallerPlatform("linux"), null);
assert.equal(detectPlatform({ platform: "Linux x86_64" }), "linux");
assert.equal(detectPlatform({ platform: "MacIntel" }), "macos");
assert.equal(detectPlatform({ platform: "Win32" }), "windows");
```

Also call the route handler with an invalid platform and assert `404`, and with `linux` and assert `404` (never a redirect).

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-installer-downloads.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement the allowlist and routes**

The route resolves the newest published internal release, selects the exact asset, and streams it with `Content-Disposition: attachment` and `Cache-Control: public, max-age=300`. It fails closed on drafts, ordinary releases, unexpected tags, missing assets and ambiguous assets. It never exposes the token or GitHub URL.

`/downloads/work-os/macos` serves the DMG. `/downloads/work-os/windows` serves the NSIS installer. `/checksums` serves `SHA256SUMS.txt` from the same release. `linux` is `404` with a JSON body naming the reason; the page never links it.

The downloads page detects the platform client-side, renders the primary action, manual Windows/macOS choices, and the Linux “coming later” state. It includes the unsigned warning, macOS Open Anyway steps, antivirus note, checksum link and support link.

- [ ] **Step 4: Run tests and typecheck**

Run: `node --import tsx --test test/work-os-installer-downloads.test.mts && npm run work-os:typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/work-os-installers.ts src/app/downloads src/app/work-os/welcome/downloads src/modules/work-os/marketing/DownloadChooser.tsx src/proxy.ts test/work-os-installer-downloads.test.mts
git commit -m "feat(work-os): publish OS-aware installer downloads"
```

---

### Task 5: Tutorial library and lesson pages

**Files:**
- Create: `src/modules/work-os/tutorials.ts`
- Create: `src/modules/work-os/marketing/TutorialLibrary.tsx`
- Create: `src/modules/work-os/marketing/TutorialPlayer.tsx` (client)
- Create: `src/app/work-os/welcome/tutorials/page.tsx`
- Create: `src/app/work-os/welcome/tutorials/[slug]/page.tsx`
- Test: `test/work-os-tutorial-library.test.mts`

**Interfaces:**
- `TUTORIALS: readonly Tutorial[]` with `{ slug, title, summary, status: "published" | "in-production", duration, poster, video, captions, steps, platformNote }`.
- `tutorialBySlug(slug: string): Tutorial | null`.
- `TutorialPlayer` props `{ tutorial }`.

- [ ] **Step 1: Write the failing manifest test**

```ts
assert(TUTORIALS.length >= 10);
assert.equal(new Set(TUTORIALS.map((t) => t.slug)).size, TUTORIALS.length);
for (const tutorial of TUTORIALS.filter((t) => t.status === "published")) {
  assert(existsSync(`public${tutorial.video}`), `${tutorial.slug} video`);
  assert(existsSync(`public${tutorial.poster}`), `${tutorial.slug} poster`);
  assert(existsSync(`public${tutorial.captions}`), `${tutorial.slug} captions`);
  assert(tutorial.steps.length >= 3);
}
assert.equal(tutorialBySlug("not-real"), null);
```

- [ ] **Step 2: Run and verify failure**

Run: `node --import tsx --test test/work-os-tutorial-library.test.mts`
Expected: FAIL.

- [ ] **Step 3: Implement metadata, library and player**

Ten entries in the spec's order. Only `eod-draft` is `published` until the next films verify; the rest are `in-production` and render a composed “In production” card, not a dead play button.

The player is a native `<video controls playsinline preload="none">` with a poster, a `<track kind="captions">`, a transcript `<details>`, and one sentence of provenance. It never autoplays or loops. Escape closes only the inline expanded player, not the page.

- [ ] **Step 4: Run the test**

Run: `node --import tsx --test test/work-os-tutorial-library.test.mts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/work-os/tutorials.ts src/modules/work-os/marketing/TutorialLibrary.tsx src/modules/work-os/marketing/TutorialPlayer.tsx src/app/work-os/welcome/tutorials test/work-os-tutorial-library.test.mts
git commit -m "feat(work-os): add the tutorial library"
```

---

### Task 6: Publish the approved film and brand assets

**Files:**
- Create: `public/work-os/tutorials/eod-draft.mp4`
- Create: `public/work-os/tutorials/eod-draft.jpg`
- Create: `public/work-os/tutorials/eod-draft.vtt`
- Create: `public/work-os/workspace-today.webp`, `workspace-tasks.webp`, `workspace-insights.webp`
- Modify: `src/modules/work-os/tutorials.ts` (`eod-draft` published)
- Test: `test/work-os-tutorial-library.test.mts`

- [ ] **Step 1: Copy the approved 60 fps film, poster, captions and current desktop stills**

Use the verified files from the pilot. Do not re-encode locally; the VPS already produced the final MP4.

- [ ] **Step 2: Mark the tutorial published and run the manifest test**

Run: `node --import tsx --test test/work-os-tutorial-library.test.mts`
Expected: PASS, including file existence and duration.

- [ ] **Step 3: Draw the rendered check**

Run the Next dev server, open `/work-os/welcome` and `/work-os/welcome/tutorials/eod-draft` at 1440 and 390, take screenshots, play the film, confirm captions and audio, and check reduced motion.

- [ ] **Step 4: Commit**

```bash
git add public/work-os src/modules/work-os/tutorials.ts
git commit -m "feat(work-os): publish the approved EOD tutorial"
```

---

### Task 7: WrazyOS link and deploy acceptance

**Files:**
- Modify (Agent OS checkout, separate commit): landing nav and footer
- Modify (Agent OS checkout): public proxy exceptions
- Test: live probes

- [ ] **Step 1: Add one nav link and one footer link in the Agent OS landing**

`Work OS` → `https://app.wrazyos.com/work-os/welcome`. Do not copy Work OS's layout or components.

- [ ] **Step 2: Apply the exact public proxy exceptions in Agent OS**

Mirror the Work OS paths. Keep `/work-os/today` and the release grant protected.

- [ ] **Step 3: Run the Work OS suite, typecheck, build and CodeRabbit**

Run: `npm run work-os:test && npm run work-os:typecheck && npm run build`.
Then one CodeRabbit pass on the batch.

- [ ] **Step 4: Deploy through the atomic path and probe**

Run: `npm run redeploy`.
Probe `/work-os/welcome`, the downloads page, a real installer `HEAD`, the tutorial MP4, and confirm `/work-os/today` still redirects to login.

- [ ] **Step 5: Commit the Agent OS link and record the live evidence**

Do not report completion until the live probes pass.
