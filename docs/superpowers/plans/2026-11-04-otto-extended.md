# Otto extended walkthrough Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the approved chaptered employee Otto showcase and correct the short lesson title.

**Architecture:** Preserve the accepted film pipeline and ten existing assets. Add a dedicated eight-part shot list/runner, using isolated real-app fixture adapters only where existing fixtures cannot perform the approved interaction. Publish one MP4 and its caption/poster/chapter metadata through the existing public lesson/player.

**Tech Stack:** TypeScript, React, Next.js16, Vite filming build, Playwright, FFmpeg, Python/numpy soundtrack.

**Spec:** `docs/superpowers/specs/2026-11-04-otto-extended-design.md`

## Global Constraints

- Floating first, then in-app for shared actions; one film with eight numbered interstitials, no Chapter title.
- Approximately4minutes, genuine60fps1440×900H.264/AAC, audible matching recap voice and ducked music.
- Actual controls and review handlers; no DOM-forged outcomes, backend contact or employee sessions.
- Never imply historical EOD-status lookup through chat; show actual report state instead.
- No installer/version/release changes; render in isolated VPS scratch.

## Review Focus

- Repeated alternate decisions: distinct/reset labelled takes, never confirmed→pending without explanation.
- Voice fixture: captured audible bytes and displayed text match; music must not mask speech.
- Two-surface parity: in-app Focus versus floating Tasks and real native handoff must be represented truthfully.
- Offline capture: unknown prompts fail closed rather than return generic flattering answers.
- Publication integrity: absent media/chapters or stale durations must fail tests; no premature published entry.

### Task 1: Capture contract and real-app demonstration adapters

**Files:** `scripts/tutorial-film/otto-story.mjs`, `scripts/tutorial-film/otto-shoot.mjs`, optional isolated `desktop/work-os-companion/src/ottoFilmFixture.ts`, existing DEV boot seams in `App.tsx`/`AvatarApp.tsx`; test `test/work-os-otto-film.test.mts`.

**Interfaces:** Shot list exports eight ordered parts with floating/in-app scenes and explicit assertions. Runner accepts `--preflight`, `--part <id>`, `FILM_APP`, `FILM_OUT`; produces per-part evidence/actions/stills/silent video and voice-event offsets. DEV fixtures return actual application wire types and local mutation receipts, never production API responses.

- [ ] Add failing tests for eight parts, floating→in-app coverage, required actual decisions, fail-closed demo inputs and no historical-EOD claim.
- [ ] Run focused test and observe RED.
- [ ] Inventory existing interactive fixtures and in-app handlers; implement minimal local-only adapters and runner with separate preflight/capture directories and source build fingerprint.
- [ ] Preflight all parts with real clicks and visible assertions; fix failures at source, never remove promised actions.
- [ ] Run focused tests/typecheck and commit the capture contract/adapters.

### Task 2: Film, finish, and verify one continuous showcase

**Files:** `scripts/tutorial-film/otto-finish.mjs`, new `public/site/work-os/tutorials/otto-extended.{mp4,jpg,vtt}`, chapter timing artifact; tests in `test/work-os-otto-film.test.mts` and existing media test.

**Interfaces:** Finisher consumes accepted per-part evidence/video plus actual recap audio, produces one MP4/VTT/poster and ordered chapter starts; reject preflight evidence, missing surface coverage or voice evidence.

- [ ] Add failing tests for finalizer rejecting preflight/missing audio/incomplete part pairs and non-monotonic chapter offsets.
- [ ] Implement numbered transitions, continuous original music, voice ducking, consistent encoding and caption offsetting on VPS scratch.
- [ ] Capture eight accepted parts; inspect per-part start/action/outcome stills and listen to spoken segment.
- [ ] Assemble/inspect final film; ffprobe60fps/audio/duration; native decode/seek/VTT playback.
- [ ] Commit only accepted deliverable assets and necessary pipeline changes.

### Task 3: Public lesson and regression-safe integration

**Files:** `src/modules/work-os/tutorials.ts`, `marketing/TutorialPlayer.tsx`, `marketing/tutorials.module.css`, `test/work-os-tutorial-library.test.mts`, media tests; bounded equivalents in Agent OS.

**Interfaces:** Optional `Tutorial.chapters: readonly {title:string;start:number}[]` drives accessible explicit seek links; title comes from shared manifest. New lesson published only with verified assets and actual timings.

- [ ] Test exact corrected short title,11unique lessons, eight ordered chapter offsets inside duration and no autoplay; observe RED.
- [ ] Add metadata/written steps and chapter navigation with real keyboard buttons seeking the existing video without forcing play.
- [ ] Render1440/390, keyboard/focus/reduced-motion; TestSprite execute chapter seek/playback and title journey.
- [ ] Focused tests→typecheck→full suite→build; one CodeRabbit batch review, handle valid findings.
- [ ] Commit/push; port website/media-only diff by content into fresh Agent OS worktree, run integration gates and atomic redeploy.
- [ ] Verify live title/card,11lessons, exact MP4/poster/VTT hashes,206ranges, seek/audio/playback, and update ledger/acceptance evidence.

## Execution decision

User explicitly said “Go ahead with the implementation.” Repository instructions
prefer one main implementer for coupled work. Execute inline without another
method-selection round. This document is the recoverable checklist; record
precise evidence and blockers here rather than restarting exploration.
