# Floating Otto Employee / Admin view switch — verification

Date: 2026-11-05.
Branch: `codex/mascot-view-switch` from `origin/main` `831c7ee8`.
Design: `docs/superpowers/specs/2026-11-05-mascot-view-switch-design.md`.
Plan: `docs/superpowers/plans/2026-11-05-mascot-view-switch.md`.
Ledger: `bce4a29c-049e-4bc2-aaef-2e1e64ce20c3`; follow-up
`337e8e67-abb4-4ac1-9a5a-d371b932f488`.

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
  **198 files / 1,796 tests passed**, including the new view-state, conversation
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
  A final local Playwright pass after the live-coordination fixes confirmed
  the same switch/Employee/Admin/New chat path with no `/api` calls or console
  errors.
- Independent whole-branch review over `831c7ee8...HEAD` was run and its
  live-coordination findings were addressed before the final gate:
  - the Tauri event envelope is unwrapped by the floating conversation
    transport;
  - Main forwards conversation requests to the owner and publishes correlated
    results;
  - Sidebar New chat always fences an unresolved first send;
  - concurrent New chat cannot report success after a failed discard;
  - conversation generation/revision scopes reset the hosts and recovery;
  - a retained request can reacquire a current-epoch ticket;
  - switching settles employee busy/thinking state and fences agenda, recap,
    next-step, approval, retry, and settle continuations;
  - context loss/session replacement advances the epoch and owner boundary;
  - known-admin boot and unavailable-state heartbeats no longer fall back to
    Employee;
  - non-admin snapshots are identity- and epoch-validated;
  - an authoritative null person mapping is preserved;
  - view ordering includes conversation generation/revision;
  - the menu remains visible through pending/refusal and retry;
  - Main Administration hold-to-talk routes to the admin recorder;
  - record navigation reveals Main;
  - thread refresh defers across pending/confirmation work and drains later.

  CodeRabbit review over `831c7ee8...HEAD`: completed twice. Findings fixed:
  - live main now forwards `OTTO_CONVERSATION_REQUEST_EVENT` to the owner and
    emits the correlated result;
  - main no longer rewrites the owner conversation id from stale local state;
  - `toggleExpanded` sees the current workspace;
  - the switch menu's `aria-controls` targets the menu, not the trigger;
  - New chat always clears host state after a committed reset;
  - stale Escape handlers cannot close the current surface.
  The mascot transition replay concern was verified by the controller's
  clearing signal and a new no-replay test; no code change needed.
  The earlier admin-timestamp gap was closed on 2026-11-06; see the follow-up
  section below.

### 2026-11-06 follow-up: Admin timestamps and reopen retention

- Admin turns now carry the recorded `createdAt` from
  `/api/work-os/admin/otto/chat` into the entry controller. The shared
  `ChatTimeDivider` marks the first user message and any pause longer than
  twenty minutes; assistant turns reveal their local clock in the hover row,
  including result-card turns that own the visible content. Turns sent in the
  current window are stamped when received and replaced by the server's
  recorded time on reload.
- The masthead **Ask Otto** control now resumes the retained server
  conversation. Previously it reused the sidebar New chat callback and
  durably discarded the thread on every reopen. **New chat** remains the only
  durable discard.
- A fresh `AdminOttoChat` mount adopts the host's post-New-chat props; an older
  `resetToken` is no longer replayed on mount, so reopening cannot wipe a
  retained draft or thread.
- The DEV fixture adapter now stores synthetic turns in memory, so the actual
  Avatar and Admin Preview branches rehydrate history across
  collapse/expand and sheet close/reopen without contacting `/api`.
- Focused tests: `chatEntry`, `conversationSync.runtime`, `fixtures`,
  `integration`, `AdminWorkspace.render`, `AdminPreview`, `AdminOttoChat.render`,
  and `chatComponents.render` passed (80 tests). Full companion suite after the
  header/animation follow-up: **199 files / 1,805 tests passed**. Companion
  typecheck and production build passed; root `work-os:typecheck` passed.
- Rendered Playwright checks:
  - `?preview-admin`: send a message, close the in-app sheet with X, click
    **Ask Otto**, and the same conversation, divider (`Today 4:41 PM`), and
    assistant clock rehydrate. This is the reported reopen path.
  - `?preview-admin` after an explicit **New chat**: type a draft, close, and
    reopen with **Ask Otto**; the draft remains while the discarded thread
    stays empty. This verifies a stale reset token is not replayed.
  - `?window=avatar&avatar-view=admin`: send a message, collapse to the orb,
    expand, and the same turns rehydrate with the divider and assistant clock.
  - Screenshots: `/tmp/opencode/inapp-after-reopen.png` and
    `/tmp/opencode/admin-history-after-reopen.png`.

### 2026-11-06 follow-up: one-row admin header and symmetric entrance

- The floating Administration header now keeps the mascot switch, title,
  Chat/Recaps tabs, New chat, and close on one top row, matching the employee
  companion header. The in-app header keeps the same single row at desktop
  widths and retains its existing safe wrap below 440px.
- **New chat** is icon-only at both widths. It keeps the accessible label
  (`New chat` / `Clearing chat`) and tooltip, swaps to the shared `FadeArc`
  while clearing, and keeps a 40px touch target under 700px.
- Entering Administration now animates the sheet the same way the employee
  chat does: the floating sheet uses the companion `panelIn` spring and the
  in-app sheet uses the shared `conversation-panel-in` slide. Previously the
  Employee direction animated but the Admin direction appeared instantly.
- Browser measurements at 400×620: one 58px header row, tabs at y=15,
  New chat 40×40, no horizontal overflow. The same header stayed one row with
  zero overflow at 390, 380, and 360px. In-app desktop: one 68px row,
  New chat 34×34, no overflow, with `conversation-panel-in` active.
- Screenshots/GIFs: `/tmp/opencode/admin-one-row.png`,
  `/tmp/opencode/inapp-one-row.png`,
  `/tmp/opencode/view-transition/to-admin.gif`,
  `/tmp/opencode/view-transition/to-employee.gif`, and
  `/tmp/opencode/otto-transition/dress-and-undress-close.gif`.

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
  232 characters and valid. Comparing ids against the published 0.5.24
  snapshot leaves one pending outcome (this one); the gate itself cannot run
  until the published snapshot/tooling is reconciled by its owner. This feature
  is not being released below the five-outcome threshold.
- Native Tauri two-window acceptance with a live admin session was not run in
  this environment. The browser/TestSprite fixture proves the actual rendered
  Avatar branch and no-API fixture path; the runtime suite proves the ids-only
  event transport and owner/client races. Real-window drag, ACL routing,
  provider audio, and live cross-window hydration remain unverified native
  gaps and are not claimed.
- No live deployment was performed from this branch.
