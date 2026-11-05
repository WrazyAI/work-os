# Admin Otto tools, multi-step actions, and New chat — verification

Date: 2026-11-04.
Branch: `codex/admin-otto-redesign` (base `7dbb8be4`).
Ledger: `1e70b015-5f62-4c6f-aca0-09834a93372e`.

## What changed

- Admin Otto can translate one message into up to eight ordered reads and task
  changes. Independent changes prepare together; a dependent change waits for
  its prerequisite to be recorded and is reviewed again before it can run.
- Every admin tool result has a dedicated card: tasks, work records and EODs,
  reviewed recaps, workdays, person resolution, and task changes. Cards show
  human names and meaningful changes only; raw IDs and unchanged fields are not
  rendered.
- Independent changes group into one approval card with per-item selection,
  per-item receipts, and retry only where the outcome is safe. An uncertain
  result must check its authoritative status before another approval.
- Confirmations now carry the versioned receipt the desktop adapter requires.
  Session task creation no longer writes a fabricated `"otto"` UUID into
  `work_tasks.agent_token_id`.
- `New chat` is visible in the admin chat header. It durably fences the thread,
  pending request, workflow, and unconfirmed previews before the client clears;
  recorded work is never reverted. The sidebar New chat uses the same durable
  discard path.
- Previews and recorded receipts reload from the server, so reopening a chat
  does not lose the approval card or turn a recorded write back into a pending
  one.

## Root causes found

1. The session confirm route passed `tokenId: "otto"` into services that write
   the UUID-backed `agent_token_id`. The create path failed after the preview
   was prepared.
2. The confirm response omitted `schemaVersion`, which the desktop adapter
   requires. A write could succeed and still look like a failure.
3. The intent contract and runner required exactly one read or operation, so a
   two-task request was refused by design.
4. Reloading a thread dropped action previews, and the visible New chat control
   reset only local state.

## Automated verification

| Check | Result |
|---|---|
| Admin action service suite | 37 passed; session-create regression failed first, then passed |
| Otto intent/plans suite | 8 passed, including two creates, dependency and rejection cases |
| Workflow suite | 5 passed against real PGlite previews: stable replay, recorded prerequisite, isolated failure, tenant isolation |
| Confirm route suite | 2 passed: versioned receipt and origin guard |
| New chat service/controller | server discard and late-first-response fencing pass |
| Companion admin tests | 319 passed across 42 files |
| Work OS typecheck | clean |
| Companion typecheck | clean |
| Production build | passed after `npm ci` (the external `node_modules` symlink is not valid for Turbopack) |
| Full `npm run work-os:test` | 1,274 tests: 1,263 passed, 0 failed, 11 opt-in PostgreSQL skips |

The first full-suite run exposed eleven `preview_expired` failures in the
preview-store tests because a non-expiry fixture used a 60-second window under
a loaded suite. That fixture now uses ten minutes; the dedicated expired-preview
test still proves rejection with a past timestamp.

## Rendered verification

Playwright against the dev-only `?preview-admin&section=overview&otto=cards`
fixture:

- 1440px and 449px: two requested creates render as one card with both names,
  selection updates the action to `Create 1 task`, confirming one shows a
  per-item `Task created` receipt, and New chat clears the old cards and returns
  the welcome state.
- No raw UUIDs, unchanged fields, or `none →` values appeared.
- No page errors or horizontal overflow at either width.
- A read result and the mixed read/action state were rendered separately.

Screenshots: `/tmp/opencode/admin-otto-cards-wide-v3.png`,
`/tmp/opencode/admin-otto-cards-narrow-v3.png`,
`/tmp/opencode/admin-otto-read-v3.png`.

## Release state

The queue outcome `admin-otto-multi-step-tool-cards` is pending. At the time of
writing, `0.5.22` is the latest published companion release and this outcome is
one of the five required for the next ordinary release. No version bump, tag,
or packaging was performed by this branch.

## Deferred

- TestSprite has no reusable web fixture for this desktop-only admin sheet; the
  rendered checks above use the token-free companion preview instead.
- CodeRabbit local review could not authenticate in this environment, so it
  produced no findings. The independent security/state review completed and its
  four Important findings were fixed.
- Workflow/request-fence bookkeeping has a 30-day cleanup function but no
  scheduled caller yet; access is already bounded to the same window.

