# Floating Otto Employee / Admin view switch — verification

Date: 2026-11-05.
Branch: `codex/mascot-view-switch` from `origin/main` `831c7ee8`.
Design: `docs/superpowers/specs/2026-11-05-mascot-view-switch-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-mascot-view-switch.md`.
Ledger: `bce4a29c-049e-4bc2-aaef-2e1e64ce20c3`.

## What changed

- The mascot at the left of the floating Otto header and the in-app Admin Otto
  header opens one accessible Employee / Admin view menu. The menu states the
  current view, explains unavailable destinations, handles pending and retry
  states, and restores focus without closing a parent surface.
- Main owns the effective workspace, presentation snapshots, and admin
  conversation identity. Floating Otto adopts the full snapshot through its
  existing context controller and sends scoped switch requests back. A stale
  request or result cannot rewind a newer account, epoch, or conversation.
- The floating Administration view reuses `AdminOttoChat` with a floating
  presentation variant; it is not a second admin chat. The in-app sheet and
  floating window share the same conversation identity and New chat fence.
- View switches retain the admin conversation id, draft, and retry request id.
  Only New chat, sign-out, or an account change clears them.
- Administration Otto wears a charcoal blazer, signal pocket square, brass pin,
  and brass spectacles across every pose and crop. The collapsed pet plays a
  one-shot dress/undress transition; static marks do not animate, and reduced
  motion renders the final state.
- Employee work begun before a view switch is fenced at its existing
  interpretation, approval, and retry continuations. Audit/status writes already
  accepted by the server are preserved for rehydrate/status; cancellation never
  claims a server write was rolled back.

## Automated evidence

- `cd desktop/work-os-companion && npx vitest run`:
  **198 files / 1,794 tests passed**, including the new view-state, conversation
  coordination, switch, lifecycle, fixture, full-view, and mascot attire suites.
- `cd desktop/work-os-companion && npx tsc --noEmit`: passed.
- `cd desktop/work-os-companion && npm run build`: passed (Vite production
  bundle; only the existing large-chunk warning).
- `npm run work-os:typecheck`: passed.
- `npm run work-os:test`: **1,280 tests, 1,269 passed, 0 failed, 11 skipped**
  (the 11 opt-in PostgreSQL tests were not configured).
- Root production build with webpack: `npx next build --webpack` passed.
  The default Turbopack build in this shared worktree fails on the
  worktree-level `node_modules`/optional-dependency layout, not on this change;
  the gated webpack build passed.
- Mascot and ACL guards:
  `node --import tsx --test test/work-os-companion-mascot.test.mts test/work-os-companion-acl.test.mts`
  passed (21 registered commands / 19 invoked, windows avatar/debug/main).
- TestSprite project **Work OS Companion**
  `e8fa6d35-586c-47a7-a69c-13e6b8552a0b`, test
  `3295ed40-b4be-408b-b354-7d3b81b8932a`:
  run `48e5a480-fae6-468d-a1a7-d47fafeb5be3` **passed** the real Avatar
  Employee/Admin switch, Admin cards/New chat flow through a local tunnel.
- CodeRabbit review over `831c7ee8...HEAD`: completed. Findings fixed:
  - live main now forwards `OTTO_CONVERSATION_REQUEST_EVENT` to the owner and
    emits the correlated result;
  - main no longer rewrites the owner conversation id from stale local state;
  - `toggleExpanded` sees the current workspace;
  - the switch menu's `aria-controls` targets the menu, not the trigger;
  - New chat always clears host state after a committed reset;
  - stale Escape handlers cannot close the current surface.
  The mascot transition replay concern was verified by the controller's
  clearing signal and a new no-replay test; no code change needed.

## Rendered evidence

Real `AvatarApp` DEV fixture, `?window=avatar&avatar-view=admin` (no token, no
`/api` requests, no console errors):

- `/tmp/opencode/mascot-view-switch/admin-400-v2.png` — 400×620 Admin view.
- `/tmp/opencode/mascot-view-switch/admin-420.png` — 420px acceptance.
- `/tmp/opencode/mascot-view-switch/admin-390.png` — 390px acceptance.
- `/tmp/opencode/mascot-view-switch/admin-400-menu.png` and
  `admin-menu-v2.png` — open Employee/Admin menu, current state, opaque
  portal layer.
- `/tmp/opencode/mascot-view-switch/admin-400-collapsed-v2.png` — collapsed
  Admin orb, Admin label, outfit.
- `/tmp/opencode/mascot-view-switch/failed-400.png` — failed context with a
  bounded Administration unavailable shell and Retry.
- `/tmp/opencode/mascot-view-switch/admin-unmapped-menu.png` — Employee disabled
  with the mapping explanation.
- `/tmp/opencode/mascot-view-switch/inapp-480.png` and
  `inapp-390-v2.png` — in-app Admin Otto header with the same switch and chip.
- `/tmp/opencode/mascot-view-switch/avatar-employee-400.png` — Employee header
  and menu switch.

Interaction checks: menu open/close, ArrowDown, Escape (menu closes without
collapsing the sheet), outside dismissal, Employee→Admin round trip, New chat,
admin draft retention across the round trip, failed/loading/unmapped states,
390/400/420 overflow checks, and no `/api` calls or console errors. Employee
fixture content remains intact.

Mascot attire evidence from the delegated animation task remains under
`/tmp/opencode/mascot-view-switch/studio-validation-*.png`, `lab-1440.png`,
`lab-390.png`, `dress-midpoint.png`, `undress-midpoint.png`,
`reduced-admin.png`, and `admin-final.png`. The lab covers all poses, both
crops, both modes, light/dark, 16/24/36/64 marks, both transition directions,
and reduced motion.

## Release state and gaps

- Companion outcome `floating-otto-view-switch` is appended to
  `desktop/work-os-companion/release-queue.json`; Unreleased changelog note
  added. Current branch version is `0.5.23`; no version bump, tag, packaging,
  merge, or deployment was performed.
- `npm run companion:release:status` is currently blocked by the published
  `0.5.24` snapshot from another release: its `shift-progress-pill` verification
  is 527 characters, above the gate's 500-character limit. That published entry
  is immutable; this branch does not rewrite it. The local queue entry is
  253 characters and valid. Eligibility cannot be evaluated until the published
  snapshot/tooling is reconciled by its owner. This feature is not being
  released below the five-outcome threshold.
- Native Tauri two-window acceptance with a live admin session was not run in
  this environment. The browser/TestSprite fixture proves the actual rendered
  Avatar branch and no-API fixture path; the runtime suite proves the ids-only
  event transport and owner/client races. Real-window drag, ACL routing,
  provider audio, and live cross-window hydration remain unverified native
  gaps and are not claimed.
- No live deployment was performed from this branch.
