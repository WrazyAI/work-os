# Admin Otto action rewiring — verification

Date: 2026-11-03.
Work OS: `a71f48cb` (PR #144 merged).
Agent OS: `200c5e1b` (converged and deployed).
Ledger: `451d4159-e201-4d22-b347-a4f1b7bd9a9f` / subtask `e85dc50e-0c37-4461-a9d7-71ff8be709e3`.

## What changed

Admin Otto now has one `operation` intent beside the existing typed reads:

- assign, delegate, add/remove co-assignee, create, complete, and reopen;
- the model never executes. The server resolves the unique task and people,
  calls the same `previewAdminAction` service as the admin REST API, and stores
  a 15-minute preview;
- `POST /api/work-os/admin/otto/actions/{previewId}/confirm` is the only
  execution path. It is session-authenticated, re-checks state, applies with
  `applyAdminAction`, and audits the admin actor;
- the desktop chat renders a confirmation card with the summary, before/after
  changes, warnings, and expiry. The model cannot confirm;
- reads keep the existing task/EOD/records/recap path.

## Local verification

| Check | Result |
| --- | --- |
| `npm run work-os:typecheck` | clean |
| `npm run work-os:test` | 1,253 tests, 1,242 pass, 0 fail, 11 PostgreSQL opt-in skips |
| Desktop admin Otto vitest | 31 passed, including the pending-action card |
| Intent tests | operation parsing, create title, task query, read+action rejection |
| Chat runner test | operation returns `pendingAction`, no read result |

## Live verification

Deployed Agent OS `200c5e1b`; `admin_agent_api` already enabled.

1. Created a disposable task through the admin REST preview/confirm:
   `202` preview → `201` task.
2. Asked Admin Otto: `Assign the task "<title>" to Aden Badon`.
3. Otto returned `200` with `pendingAction` and a preview id.
4. Confirmed through the session route: `200`, `replayed: false`.
5. Read the task: assignees contained Aden's person id.
6. Deleted the disposable task through the admin REST preview/confirm.

All temporary admin tokens and the desktop verification session were revoked.

## Release note

The server route and intent contract are live. The confirmation card lives in
the desktop companion, so installed apps receive the card with the next
companion release. The server response is backward-compatible: older clients
ignore `pendingAction`.

The mascot-motion browser workflow is currently failing at its
`shift-progress` fixture independently of these files; `verify`, `companion`,
`Windows release policy`, and CodeQL passed.
