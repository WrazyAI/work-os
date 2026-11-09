# Work OS Good company Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the approved purple landing, height-aware hero and animated success-face Otto, with lighter coordinated public pages.

**Architecture:** Keep server-rendered landing content inside a landing-only dark material. A small client motion boundary owns GSAP lifecycle and pause; ProductTheater owns screenshot selection; Companion keeps the existing canonical rig and success glyph.

**Tech Stack:** Next16.2.6, React19.2.4, CSS Modules, locally bundled GSAP3.14.2, node:test, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-work-os-good-company-design.md`

## Global Constraints

- Landing only: aubergine `#272331`, warm text `#efeee9`, muted `#cbc6d4`, sage stage `#d6e5cb`, pale green action `#d4e8be`, purple raised `#3b3347`.
- At1366×768 the whole stage, at least240px tall, is visible before scrolling; at1366×650 at least220px is visible.
- Light public pages retain white/paper grounds and red danger panels.
- Tutorial video files, public/protected routes, installer resolution and desktop releases do not change.
- Reduced-motion and Pause still permit the static success face on click.

## Review Focus

- Short desktop screens and 200% zoom: stage remains useful and actions never clip.
- Pause/reduced-motion toggled during celebration: success face stays valid and no stale gesture/timer survives.
- Delayed/failed art or GSAP import: static content and controls remain useful.
- Rapid screenshot selection/unmount: no stale decoded image or animation changes the selected view.
- Public route changes: landing-only dark styling does not bleed into tutorials/downloads/workspace or mask red alerts.

---

### Task 1: Approved composition and light sibling styling

**Files:** modify `LandingPage.tsx`, `landing.module.css`, `ProductTheater.tsx`, `SiteChrome.tsx`, `site.module.css`, `tutorials.module.css`, `downloads.module.css` in `src/modules/work-os/marketing/`; tests `test/work-os-welcome-page.test.mts`, `test/work-os-good-company.test.mts`, `test/work-os-good-company.browser.mjs`.

**Interfaces:** `SiteHeader({ current, tone?: "light" | "dark" })`, `SiteFooter({ tone?: "light" | "dark" })`; ProductTheater stays a default no-prop client component with pressed-state screenshot controls. Landing exposes `data-landing`, `data-hero-stage`, `data-motion-reveal` for scoped behavior/acceptance.

- [ ] Add failing server/source contracts for headline, scoped palette and height-aware CSS; browser assertions require whole stage at1366×768,220px at650, no overflow, light sibling grounds and red warning semantics.
- [ ] Run focused tests and record failures against the previous landing.
- [ ] Recreate approved B2 composition with server HTML, stage/capture controls and shared light/dark chrome. Keep sibling UI light; add purple focus/selected/lilac ground treatments without altering videos/player.
- [ ] Run focused tests and browser geometry/link/media preservation checks.
- [ ] Commit bounded composition once its tests pass.

### Task 2: Scoped GSAP and click success face

**Files:** create `LandingMotion.tsx`, `landing-motion.ts` under marketing; modify `Companion.tsx`, `companion.module.css`, `ProductTheater.tsx`, `package.json`, `package-lock.json`; extend mascot/browser tests.

**Interfaces:** `LandingMotion({ children: ReactNode })` wraps server children and owns pause state/context; `startLandingMotion(root: HTMLElement): () => void` owns GSAP context and teardown. Companion receives optional `{ compact?: boolean; paused?: boolean }`, keeps local reduced-motion handling, static canonical face and bounded celebration. No app/server data calls.

- [ ] Write failing tests for canonical success glyph, static reduced-motion/paused celebration, local GSAP dependency, scoped cleanup and fail-open static markup. Browser covers repeated click, pause/resume, keyboard, art failure and import failure.
- [ ] Run the failures; add exact dependency and isolated local linked package without installing over a running server.
- [ ] Implement dynamic GSAP loading with cancellation, matchMedia/cleanup and one coordinated entrance plus one-shot reveals. Use existing Companion success face; remove the reduced-motion click early-return, stop idle work offscreen/hidden, keep bounded reset/cleanup.
- [ ] Run focused, browser motion/responsive/reduced/no-JS/failure checks and changed-file lint.
- [ ] Commit the motion/success outcome after passing.

### Task 3: Verify, reconcile and publish the website batch

**Files:** update `design.md`, spec/plan evidence; content-port only touched marketing/tests/dependency into a fresh Agent OS worktree, leaving platform configs intact.

**Interfaces:** existing public download/browser flows and `npm run redeploy`; no new API or database contract.

- [ ] Run focused tests, typecheck, site suite, full Work OS suite, production build; render wide/short/narrow, focus, reduced-motion and failure states.
- [ ] Run one CodeRabbit review against implementation base, address valid findings; run approved existing TestSprite journey and inspect real evidence.
- [ ] Compare and port bounded content changes to Agent OS; verify its tests/typecheck/build. Rebase/fetch before merging to preserve concurrent work.
- [ ] Commit/push reviewed batch, use atomic VPS redeploy, and verify deployed commit/assets/live representative flows.
- [ ] Record real results/limitations in ledger and docs; stop temporary verification servers. No installer/version/release queue changes.

Execution: inline main-agent work per repository instructions and user's explicit go-ahead; no further aesthetic approval round requested. Checkpoint each task here and in the ledger.
