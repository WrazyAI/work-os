# Companion Release Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce five meaningful companion updates per release before allocating packaging runners.

**Architecture:** Keep an append-only JSON queue; compare it to the latest successfully published internal release snapshot. A dependency-free Node CLI supplies local status and a Linux release preflight; the existing serialized Windows/macOS pipeline consumes that gate and rechecks before publication.

**Tech Stack:** Node.js ESM, node:test, Git/GitHub CLI, GitHub Actions YAML.

**Spec:** `docs/superpowers/specs/2026-10-30-companion-release-batching-design.md`

## Global Constraints

- Companion only; web deployments, ordinary CI, and scheduled macOS validation unchanged.
- Threshold five distinct verified features/fixes; commits and internal tooling do not count.
- Emergency requires pending fix ID, candidate version, broken behavior and restoration.
- Only published releases consume updates; preserve signing and installer/updater checks.
- Reuse native Linux Node and existing dependency directories; do not install dependencies.

## Review Focus

- Drafts/bare tags must not consume updates or hide a failed release's batch.
- Concurrent queued release attempts must not rebuild a version already published.
- Provider failures or a missing post-policy snapshot must fail closed.
- Queue edits, duplicate IDs and stale emergency records must not inflate eligibility.
- Non-main refs, mismatched versions or manual dispatch inputs must not bypass preflight.

### Task 1: Implement companion queue and preflight

**Files:**
- Create: `desktop/work-os-companion/release-queue.json`
- Create: `scripts/work-os-companion-release-gate.mjs`
- Create: `test/work-os-companion-release-gate.test.mjs`
- Modify: `.github/workflows/work-os-companion-windows.yml`, `AGENTS.md`, `package.json`
- Create: `docs/companion-release-policy.md`

**Interfaces:**
- Consumes: GitHub release pages, Git snapshots, synchronized companion metadata.
- Produces: `evaluateRelease({ queue, publishedQueue, version, publishedVersion })` returning `{ eligible, pending, emergency }` or throwing on invalid state; `latestPublishedRelease(pages)` returning the newest canonical internal published release; CLI `status` and `check`, with `eligible`/`version` GitHub outputs only after validation.

- [x] **Step 1:** Write behavioral tests for 0–4 blocked, 5/6 eligible, duplicate IDs, immutable consumed entries, emergency scope, draft exclusion, failed retry, repeat publication skip, next patch validation and malformed state. Assert literal pending counts and exit states.
- [x] **Step 2:** Run `node --test test/work-os-companion-release-gate.test.mjs`; expect missing gate assertions to fail.
- [x] **Step 3:** Implement the pure evaluator and published-release selector, plus the cumulative queue.
- [x] **Step 4:** Run the focused tests; expect all evaluator tests passing.
- [x] **Step 5:** Add subprocess CLI tests using real disposable Git histories and a fake provider transport for pagination/errors only; cover branch/tag/dispatch, metadata mismatch, missing snapshots, stale source and no mutation. Parse workflow YAML to verify paid jobs depend on preflight and finalize rechecks.
- [x] **Step 6:** Run focused tests; expect CLI/workflow tests to fail before wiring.
- [x] **Step 7:** Implement read-only CLI/provider integration and gate the existing workflow; document agent counting, release, emergency and retry instructions. Add focused tests to the root test command; do not bump the app version or trigger packaging.
- [ ] **Step 8:** Run focused gate/release tests, `npm run work-os:typecheck`, and `npm run work-os:test`; inspect every failure. Run live read-only `status` to prove the current queue is 4/5 and paid builds ineligible.
- [ ] **Step 9:** Commit the task, update the canonical ledger and plan checkpoint. Run one CodeRabbit pass and one bounded independent review; fix still-valid material findings with regression tests. Report exact verification and remaining deployment/integration work.

## Checkpoint

- Implementation: `b57109e5`; concurrent pre-policy release reconciliation: `f1a8284e`.
- Gate tests: 26 passing, including reviewer regression fixes and source-pinned pre-policy publication consumption. Existing release tests: 12 passing, one Windows-only skip. Companion suite: 176 files / 1619 tests passing. Typecheck passing.
- CodeRabbit: completed with zero findings; independent review's two Important findings reproduced and fixed with RED→GREEN tests (cached rerun eligibility and mismatched candidate tags).
- Current-main reconciliation: 0.5.17 was started by another agent under the old pipeline from `eb1784f5`; do not cancel or duplicate it. Its four outcomes count as consumed only once that exact source publishes.
- Full root suite completed: 966 passed, 11 skipped, zero failures (plus 25 gate and 14 migration/release tests in the npm lifecycle). Latest dedicated gate run: 26 passing. TestSprite is skipped for this release/build-only change: there is no changed UI/API target; paid packaging is deliberately not triggered for verification.
- The pre-policy 0.5.17 workflow was subsequently cancelled externally; the four outcomes remain pending. Preserve reserved 0.5.17, and dispatch it freshly only when the fifth outcome qualifies.
- Next: terminal root-suite result, rebase on latest main, final source/status readback and merge per repository instructions; no app version bump.
