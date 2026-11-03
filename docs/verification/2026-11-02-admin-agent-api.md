# Admin agent API — verification

Date: 2026-11-03 (plan dated 2026-11-02).
Work OS: `84d2b8c2` (PR #143 merged)
Agent OS: `6187b097` (converged and deployed)
Ledger: `451d4159-e201-4d22-b347-a4f1b7bd9a9f`

## Status

Implemented, reviewed, merged, deployed, and live-verified against the David
Yeboah workspace. Migration `0069` is applied to Neon; the `admin_agent_api`
flag is enabled; live REST and MCP probes passed; all verification tokens were
revoked.

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

## Live deployment verification (2026-11-03)

- Work OS `main`: `84d2b8c2` (PR #143 merged).
- Agent OS `main`: `6187b097` (converged and manually reconciled).
- Migration `0069_work_admin_agent_access.sql`: applied to Neon
  `ep-delicate-firefly-b21oupgo.c-6.eu-central-1.aws.neon.tech`.
- Deployed through `npm run redeploy`; `.deployed-commit` is `6187b097`;
  `/api/agent/admin/v1/openapi.yaml` answers `200`.
- `admin_agent_api` enabled for the David Yeboah workspace
  (`b094c847-1332-4cab-9588-bdd7f8e99e7d`).

A 20-minute admin token was minted with all seven scopes and used live:

| Check | Result |
| --- | --- |
| `GET /me` | 200, admin role, nullable person, seven scopes |
| `GET /people?q=David` | 200, David Z / Engineering |
| `GET /tasks?person_ids=<id>` | 200, 684 tasks |
| `GET /eods?person_ids=<id>&from=2026-10-27&to=2026-11-03` | 200, 1 submitted EOD |
| `GET /records?person_ids=<id>&from=2026-10-27&to=2026-11-03` | 200, 50-row first page |
| `GET /overview` | 200, 10 people, 352 open / 224 overdue tasks |
| `POST /previews` + confirm (`task.create`) | 202 preview → 201 task `ec62fcc1…` |
| Task assign preview + confirm | 202 → 200, final assignee list applied |
| Task delete preview + confirm | 202 → 200, task tombstoned |
| `POST /api/agent/admin/mcp` `tools/list` | 200, exactly 13 tools |
| `work_audit_log` | `admin.task.create`, `admin.task.assign`, `admin.task.archive` rows |
| `GET /me` after revocation | 401 `token_revoked` |

The disposable task was removed, all live verification tokens were revoked, and
the temporary token file/scripts were deleted from the VPS.

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
