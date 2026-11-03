# Admin agent API — local verification

Date: 2026-11-03 (plan dated 2026-11-02).
Branch: `codex/admin-agent-api`
Head: `c7c98faf`
Base: `7f6a2146`
Ledger: `451d4159-e201-4d22-b347-a4f1b7bd9a9f`

## Status

Local implementation and review are complete. Production migration, feature
enablement, deployment, and live probes are deliberately **not** run: they are
external side effects that require the merge/deploy authorization and the
target environment. The branch is clean and ready for that step.

## Local checks

| Check | Result |
| --- | --- |
| `npm run work-os:typecheck` | clean |
| `npm run work-os:test` | 1,250 tests, 1,239 pass, 0 fail, 11 PostgreSQL opt-in skips |
| Focused admin-agent suites | 228+ pass across auth, tokens, directory, tasks, EODs, records, previews, actions, evidence, write routes, OpenAPI, MCP, MCP route, migration |
| Employee MCP contract | still exactly seven tools; kind isolation test green |
| `git diff --check` | clean |
| OpenAPI 3.1 `nullable:` occurrences | 0 (replaced with JSON Schema null unions) |

The full suite is the merge gate and now includes every
`test/work-os-admin-agent-*.test.mts` file plus
`work-os-admin-action-previews.test.mts`, `work-os-admin-agent-mcp-route.test.mts`,
and `work-os-agent-kind-isolation.test.mts`.

## Review evidence

- Every plan task received a task-scoped spec + quality review. Fix rounds
  closed the findings; the notable ones were token-kind isolation, member
  self-review for unmapped tokens, stale-preview handling, task-scoped
  evidence, resolved assignee lists, and the MCP preview TTL dead-end.
- CodeRabbit batch review completed with five minor findings:
  1. `Retry-After` on `preview_in_flight`;
  2. three test files missing from `work-os:test`;
  3. unbucketed default `log_progress` key;
  4. token-unscoped stored evidence keys;
  5. invalid `nullable` in the OpenAPI 3.1 document.
  All five are fixed in `c7c98faf`; the full suite above is the post-fix run.

## What ships

- `wos_admin_` token kind, seven scopes, nullable person, admin auth resolver.
- Admin Settings token panel behind `admin_agent_api`.
- REST at `/api/agent/admin/v1`: directory, projects, cross-person tasks
  (search, overdue, project/date filters), task detail/activity, task create /
  update / assign / move / complete / reopen / archive / delete, progress,
  evidence, evidence download, EOD list/detail/review, records, overview,
  insights, preview/confirm, `/me`, OpenAPI.
- MCP at `/api/agent/admin/mcp`, 13 tools, stateless POST, 12 MB declared-body
  bound, preview/confirm plus additive progress/evidence.
- Durable preview store with 15-minute expiry, state fingerprint, one-time
  confirm, replay, token ownership, and `current_state` on stale responses.
- Task-scoped admin evidence: `person_id` null, uploader/target in metrics,
  task-based storage path, openable by an authorized session.

## Remaining external steps

1. Merge the branch into `main` (or push the feature branch for review).
2. Apply `supabase/migrations/0069_work_admin_agent_access.sql` to the intended
   Neon database with `npm run db:apply:work-os` after verifying the resolved
   host. Never replay the historical migration set.
3. Deploy through the Agent OS atomic redeploy (`npm run redeploy`) and verify
   the deployed identity and `/api/agent/admin/v1/openapi.yaml`.
4. Enable `admin_agent_api` for the David Yeboah workspace in Admin → Settings
   → Workspace features.
5. Mint a 15-minute admin token with read scopes plus `tasks:write` and
   `eods:review`. Run `/me`, `/people?q=David`, David's tasks and last week's
   EODs, preview and confirm an assignment on a disposable task, read the audit
   rows, call the admin MCP `tools/list` (13 tools), and revoke the token.
6. Confirm the revoked token answers `401` and a cross-organization id answers
   `404`.

## Known limitations carried to follow-ups

- `/records` is capped at 100 active person windows per request; larger
  rosters must pass `person_ids`.
- Admin MCP inherits the `employee_companion` gate along with
  `admin_agent_api`.
- The employee `/api/mcp` route still uses the declared-content-length check;
  the admin route rejects missing/invalid lengths.
- Admin Otto is a separate follow-up plan; it is not changed by this branch.
- Concurrent progress writes can replay the first note for a shared key; the
  evidence path is content-hashed and token-scoped.
