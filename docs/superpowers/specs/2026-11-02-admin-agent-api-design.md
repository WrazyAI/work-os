# Admin agent API and MCP: design

Date: 2026-11-02. Status: approved by the user on 2026-11-02; implementation planned.
Baseline: Work OS `origin/main` at `017d9379`.
Ledger: `451d4159-e201-4d22-b347-a4f1b7bd9a9f` — Build the admin-scoped agent API and MCP.
Plan: `docs/superpowers/plans/2026-11-02-admin-agent-api.md` (API and MCP; Otto is a follow-up plan).

## Intent

Give administrators a first-class, token-scoped surface for working across
people: search the directory, read anyone's tasks and submitted EODs, read the
record of authored work, and perform the task actions an administrator already
holds in the dashboard — assign, delegate, add a co-assignee, complete, reopen,
archive, and review EODs.

The same surface becomes the tool layer for Otto in the admin view. Otto stops
being a fixed set of read-only intents and becomes a bounded tool-calling
assistant over the admin services, with one rule the server enforces: reads
answer immediately, consequential writes return a preview and execute only
after a confirmation.

This is not a second employee API with a role flag. It is its own token kind,
its own scopes, and its own namespace, sharing the existing services and audit
record underneath.

## The failure this fixes

An administrator can already read much of this in the dashboard. They cannot
reach it from a token or MCP client. Admin Otto is deliberately read-only:
`ADMIN_OTTO_INTENT_ACTIONS` contains only `unfinished`, `records`, `reports`,
`eods`, `recaps`, `read_recap`, and `workday`; the system prompt says
"Questions never authorize a mutation." Asking Otto to assign or delegate
therefore fails as an unsupported request.

The dashboard's own HTTP routes authenticate with a browser cookie or desktop
session. They are not an external contract, have no scopes, no idempotency, no
rate limit, and no OpenAPI document.

## Decisions made by the user

1. Admins get their own API surface and their own token kind and scopes.
2. The API must cover all needed functionality, not only the four example
   queries.
3. Reads answer immediately; writes show a preview and require a confirmation.
4. "Contributor" means co-assignee. It uses the existing
   `assignee_person_ids`, not a new watcher concept.
5. Admin Otto is moved onto this surface and re-implemented as its first
   consumer.

## Goals

- A `wos_admin_` token that is bound to one organization and one admin user,
  works without a person mapping, and carries explicit scopes.
- Cross-person reads for directory, tasks, EODs, records, overview, and
  insights, with text search and stable pagination.
- The full task lifecycle for any person in the organization: create, update,
  assign/replace/add/remove assignees, complete, reopen, progress, evidence,
  archive, delete.
- EOD read and review (approve/reject), with the existing review-integrity
  rules.
- A preview/confirm contract for consequential writes, recorded in the
  database and enforced by the server, not only by the UI.
- An admin MCP endpoint with read tools plus `preview_action` and
  `confirm_action`.
- Admin Otto using the same services, with a preview card and a session-bound
  confirm action.
- An OpenAPI document and a drift test.

## Non-goals

- People administration (create, deactivate, role change, team management).
  The directory is read-only in this release.
- Organization settings, billing, integrations, provider connections, or
  token administration for other users.
- Employee-private memory, private conversations, unsubmitted EOD drafts, raw
  screenshots, or storage paths.
- Cross-organization reads or writes.
- Manager-scoped tokens. This release is admin-only; the scope model leaves
  room for a manager kind later.
- An autonomous agent that confirms its own writes in the admin UI.
- Replacing the cookie-authenticated dashboard routes. They stay as they are;
  the token API is additive.

## What already exists

The data plane is largely built. The new work is access, search, confirmation,
and the MCP/Otto layer.

| Capability | Existing service |
| --- | --- |
| Directory page and name resolution | `listAdminOttoPeople`, `resolveAdminOttoPeople` |
| Cross-person open/overdue tasks | `listAdminOttoTasks`, `countAdminTaskRecord` |
| Authored records, submitted EODs, reviewed recaps, workday | `listAdminOttoRecords`, `adminOttoWindowsFromQuery` |
| Task detail, subtasks, evidence | `getWorkOsEmployeeTaskDetails` |
| Admin task update, assignment, archive/delete | `updateWorkOsAdminTask`, `removeWorkOsAdminTask` |
| Task create for named owners | `createLocalWorkOsTask` |
| EOD list | `src/app/api/work-os/reports/route.ts` (query logic to extract) |
| EOD review | `reviewWorkOsEod` |
| Overview | `getAdminOverview` |
| Deterministic insights | `getAdminInsights` |
| Audit | `audit(access, action, targetType, targetId, metadata)` |

Admin task update already audits `task.updated` and `task.assigned`, validates
active assignees, sets `assigned_by_person_id`, and enforces the overdue and
completion rules. EOD review already refuses to review one's own report and
preserves a manager edit as a report version.

## Token kind and scopes

### One table, two kinds

Extend `work_agent_tokens` rather than create a parallel credential store:

```sql
alter table work_agent_tokens
  add column if not exists kind text not null default 'employee';
alter table work_agent_tokens
  alter column person_id drop not null;
alter table work_agent_tokens
  add constraint work_agent_tokens_kind_check
  check (kind in ('employee', 'admin'));
alter table work_agent_tokens
  add constraint work_agent_tokens_person_kind_check
  check (kind = 'admin' or person_id is not null);
```

Reasons: one hash lookup, one revocation path, one idempotency cache, one
last-used throttle. The prefixes stay distinct (`wos_agent_` and
`wos_admin_`), and every resolver filters by `kind`.

An admin token belongs to one admin user. An unmapped admin is valid: the token
row has `person_id = null`, and the request is authorized by the membership
role, not by a fabricated employee record.

### Scopes

| Scope | Grants |
| --- | --- |
| `people:read` | Directory search, person detail, projects |
| `tasks:read` | Cross-person task list, detail, subtasks, activity, evidence read |
| `tasks:write` | Create, update, assign, complete, reopen, progress, evidence, archive, delete |
| `eods:read` | EOD list and detail with versions |
| `eods:review` | Approve or reject a pending EOD |
| `records:read` | Authored updates, submitted EODs, reviewed recaps, workday snapshots |
| `insights:read` | Overview, decision queue, deterministic insights |

Default for a new admin token: all five read scopes, no writes. Write scopes are
opt-in at creation. Expiry defaults to 90 days, maximum 365; same as employee
tokens. The panel lives in **Admin Settings → Agent access**, behind the
`admin_agent_api` flag. It is separate from the employee token panel in
Settings.

## Authentication and authorization

`src/lib/work-admin-agent-auth.ts` resolves a bearer token:

1. Accept only `Authorization: Bearer wos_admin_...`.
2. Hash with SHA-256 and load `work_agent_tokens` where `kind = 'admin'`.
3. Reject revoked or expired tokens with `token_revoked` / `token_expired`.
4. Load the user profile and the active membership for the token's
   organization. Reject a missing or inactive membership with `unauthorized`.
5. Re-read the membership role on every request. A demoted admin loses access
   on the next call; the role is never trusted from the token row.
6. Require the organization feature flags `admin_agent_api` and
   `employee_companion`. Return `feature_disabled` when either is off; the
   reused admin readers already enforce the companion flag.
7. Build `WorkOsAccess` with `role: "admin"`, `personId: token.person_id` (may
   be null), and the token's scopes.

The employee resolver (`requireAgentAccess`) adds `kind = 'employee'`. The
employee MCP endpoint rejects an admin token; the admin endpoint rejects an
employee token. Both answer `401 unauthorized`; neither reveals the other
surface.

`GET /me` returns organization, user, role, nullable person, and token metadata
including scopes. It never returns the secret.

## REST surface

Base path: `/api/agent/admin/v1`. This stays inside the existing public
`/api/agent` prefix in `src/proxy.ts`, so the proxy auth check needs no change
and the employee contract is untouched. The admin MCP route is added to the
proxy matcher exclusion, like `/api/mcp`, so a 12 MB evidence body is not
buffered and truncated at the proxy boundary.

| Method | Path | Scope | Behavior |
| --- | --- | --- | --- |
| GET | `/me` | any | Token identity and scopes |
| GET | `/people` | `people:read` | Search/filter directory: `q`, `active`, `team_id`, `role`, `limit`, `cursor` |
| GET | `/people/{personId}` | `people:read` | Person, schedule, manager, teams |
| GET | `/projects` | `people:read` | Active projects |
| GET | `/tasks` | `tasks:read` | Cross-person list: `person_ids`, `q`, `completed`, `overdue`, `project_id`, `due_from`, `due_to`, `updated_since`, `limit`, `cursor` |
| GET | `/tasks/{taskId}` | `tasks:read` | Task, subtasks, completion evidence, activity, blockers |
| GET | `/tasks/{taskId}/activity` | `tasks:read` | Merged task timeline |
| GET | `/evidence/{evidenceId}/file` | `tasks:read` | Download a task evidence file with the token |
| POST | `/tasks` | `tasks:write` | Create for named owner(s); returns a preview (`202`) |
| PATCH | `/tasks/{taskId}` | `tasks:write` | Content, status, due date; assignment only through `/assign`; returns a preview (`202`) |
| POST | `/tasks/{taskId}/assign` | `tasks:write` | `mode: replace / add / remove`; returns a preview (`202`) |
| POST | `/tasks/{taskId}/move` | `tasks:write` | Change the subtask's parent; returns a preview (`202`) |
| POST | `/tasks/{taskId}/complete` | `tasks:write` | Complete; returns a preview (`202`) |
| POST | `/tasks/{taskId}/reopen` | `tasks:write` | Reopen; returns a preview (`202`) |
| POST | `/tasks/{taskId}/progress` | `tasks:write` | Add an authored progress note; direct write, audited |
| POST | `/tasks/{taskId}/evidence` | `tasks:write` | Multipart completion evidence, 8 MB; direct write, audited |
| DELETE | `/tasks/{taskId}` | `tasks:write` | `mode=archive` default, `delete` tombstones; returns a preview (`202`) |
| GET | `/eods` | `eods:read` | `person_ids`, `status`, `from`, `to`, `q`, `limit`, `cursor` |
| GET | `/eods/{reportId}` | `eods:read` | Report, person, versions |
| POST | `/eods/{reportId}/review` | `eods:review` | Approve/reject with optional note and manager edit; returns a preview (`202`) |
| POST | `/previews` | write scope for the action | Generic preview creator for MCP and Otto |
| GET | `/previews/{previewId}` | write scope for the action | Rehydrate a pending card |
| POST | `/previews/{previewId}/confirm` | write scope for the action | Execute an open preview; the only execution path |
| GET | `/records` | `records:read` | `person_ids`, `sources`, `from`, `to`, `q`, `cursor` |
| GET | `/overview` | `insights:read` | Decision queue, counts, outstanding EODs, overdue work |
| GET | `/insights` | `insights:read` | Optional `person_id`, `range=7d/30d/90d`, `through`; org-wide when omitted |
| GET | `/openapi.yaml` | any | Served contract |

`person_ids` accepts at most 20 ids. Omitting it means the whole organization
for an admin; an explicit empty array means no rows. This keeps a URL builder
that always emits `person_ids=` from silently widening to the whole
organization. Unknown ids are ignored rather than treated as an authorization
error; cross-organization ids never appear in results.

### Pagination and ordering

Keyset cursors, base64-encoded, bound to the filter set. Default 50; maximum
200 for tasks, 100 for EODs and records. Changing filters invalidates the
cursor with `invalid_cursor`. Lists order by `updated_at desc` for tasks and
`report_date desc, created_at desc` for EODs. Records order by `occurred_at
desc, id desc`.

### Search

`q` is a case-insensitive substring search, maximum 200 characters, with `%`,
`_`, and `\` escaped. Fields:

- People: `display_name`, `email`.
- Tasks: `title`, `description`, project name.
- EODs: `title`, `submitted_markdown`, `markdown`.
- Records: the projected record text.

No ranking in v1; results stay in the collection's normal order. Add trigram
indexes if live volume makes substring scans slow. A unified ranked
`/search` endpoint is deliberately deferred; Otto can call the collections.

## Preview and confirm

Consequential writes are two calls. The server stores the preview, so a reload
keeps the card and a stale payload cannot execute.

```sql
create table if not exists work_admin_action_previews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  user_id uuid not null,
  token_id uuid references work_agent_tokens(id) on delete cascade,
  source text not null check (source in ('api', 'otto')),
  action text not null,
  target_type text not null,
  target_id text,
  request jsonb not null,
  preview jsonb not null,
  state_fingerprint jsonb not null default '{}'::jsonb,
  result_status smallint,
  result_body jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  confirmed_at timestamptz
);
create index if not exists work_admin_action_previews_token_idx
  on work_admin_action_previews(token_id, expires_at);
```

Flow:

1. `POST /previews` with `{ action, payload }`, or the matching action route
   (`POST /tasks`, `PATCH /tasks/{id}`, `POST /tasks/{id}/assign`, and so on).
   The action routes are preview creators, not execution paths.
2. The service resolves people, tasks, capabilities, and the current state,
   computes the exact changes, and inserts a preview with a 15-minute expiry.
   Every consequential write route answers `202 Accepted` with the preview.
   Nothing is written to the task or report.
3. The response is `{ id, action, summary, changes: [{ field, from, to }],
   warnings, state, expires_at }`. `state` is a bounded fingerprint of the
   targets the action depends on: task `updated_at`, status, completion,
   assignee list, and parent; report status and version. It is not the full
   row.
4. `POST /previews/{id}/confirm` loads the preview, verifies the same
   token/user/organization, verifies it is unexpired and unconfirmed,
   re-reads the targets, and compares the fingerprint. A changed target
   answers `409 preview_stale` with the current state; nothing is written.
5. On success the row stores `result_status`, `result_body`, `confirmed_at`,
   and `idempotency_key`. A second confirm of the same preview returns the
   stored result with `Idempotent-Replay: true`, even with a different
   `Idempotency-Key`. The preview id is the canonical one-time key; the header
   is still required on the API confirm and is derived from the preview id for
   the session-based Otto confirm.
6. An execution error leaves the preview unconfirmed and returns the mapped
   error, so a retry can re-read the state and try again. A deterministic
   failure such as "report is no longer pending review" maps to `409
   conflict` with a reason, never a 500.

Assignment previews resolve the **final** assignee list at preview time.
`mode=add` and `mode=remove` are computed once against the preview snapshot;
confirm applies that exact list as a replace. If the current assignees changed
in between, the fingerprint comparison answers `preview_stale` and the card
must be refreshed.

Actions requiring a preview: `task.create`, `task.update`, `task.assign`,
`task.move`, `task.complete`, `task.reopen`, `task.archive`, `task.delete`,
`eod.review`.
Additive writes (`task.progress`, `task.evidence`) write directly; they are
audited and cannot create, remove, reassign, or decide work.

The API cannot prove a human clicked in a generic MCP client. The preview is a
contract and an audit record, not a substitute for scopes. In the Work OS admin
UI, the confirm route is session-authenticated and the model never receives the
confirm capability.

## EOD review

Reuse `reviewWorkOsEod`, and translate its existing plain errors into the API
error contract:

- Only `pending_review` reports can be reviewed. A report that changed after
  the preview answers `409 conflict`, not a 500.
- An admin cannot review their own report, even if mapped. This answers `403
  forbidden` with a reason.
- A manager edit is stored as a `work_report_versions` row; the employee
  submission is preserved.
- The audit entry is `report.approved` or `report.rejected` with the person id
  and the preservation flag; the admin token id and name are added to the
  metadata.

`eods:read` does not imply `eods:review`. A read-only admin token can list and
open reports but cannot decide them.

## Admin MCP

Endpoint: `/api/agent/admin/mcp`. Stateless Streamable HTTP, POST only, same
transport and 12 MB body bound as `/api/mcp`. It is a separate server with its
own tool set; the employee server stays at exactly seven tools.

| Tool | Scope | Behavior |
| --- | --- | --- |
| `search_people` | `people:read` | Name/email search, active/team/role filters |
| `get_person` | `people:read` | Profile, schedule, manager, teams |
| `list_tasks` | `tasks:read` | Cross-person list with text query and filters |
| `get_task` | `tasks:read` | Detail, subtasks, evidence, activity |
| `list_eods` | `eods:read` | Person/date/status/query list |
| `get_eod` | `eods:read` | Report and versions |
| `list_records` | `records:read` | Authored updates, EODs, recaps, workday |
| `get_overview` | `insights:read` | Decision queue and org counts |
| `get_insights` | `insights:read` | Deterministic 7/30/90-day facts |
| `preview_action` | write scope for the action | Validates and stores a preview; never writes |
| `confirm_action` | write scope for the action | Executes an unexpired preview with idempotency |
| `log_progress` | `tasks:write` | Add a progress note directly; additive and audited |
| `attach_evidence` | `tasks:write` | Base64 completion file, 8 MB, one file; additive and audited |

`preview_action` is a discriminated union over the actions listed above. The
model is told to preview every consequential write and to describe the preview,
not to claim the change happened. `confirm_action` is the explicit second call;
the client UI must surface the preview before invoking it. MCP clients without
a confirmation UI still get the audit trail and the scope boundary.
`log_progress` and `attach_evidence` are additive by design: they cannot
create, remove, reassign, complete, or decide work, so they do not require a
preview. `attach_evidence` enforces the same 8 MB cap and supported file types
as the employee tool.

## Otto

Replace the fixed read-intent parser with a bounded tool loop over the admin
services:

- Maximum 4 tool calls per turn and a 30-second budget.
- Reads execute immediately through the same services as the REST API.
- Consequential writes call `preview_action` only. The chat response carries
  `pendingAction: { previewId, summary, changes, warnings }`.
- Progress and evidence are the two additive exceptions: Otto may call
  `log_progress` or `attach_evidence` directly, because neither can remove,
  reassign, complete, or decide work. Completion after evidence still goes
  through a preview.
- The new loop ships behind `admin_agent_api`. While the flag is off, the
  existing read-only intent parser stays live, so deploy order cannot break
  admin chat. Remove the old parser in a follow-up once the new path is
  verified in the workspace.
- The client renders one confirmation card per preview. The confirm button
  calls `POST /api/work-os/admin/otto/actions/{previewId}/confirm`, which
  authenticates the browser/desktop session, verifies the preview belongs to
  that user and organization, and executes with the session's admin access.
- A reload re-reads the pending preview from the turn record. An expired
  preview renders "This change expired; ask again" rather than a dead button.
- The model never receives a confirm tool in the admin UI, so it cannot
  self-confirm.
- Existing cards (task list, records, EODs, recaps) keep their shapes; they
  are fed by the same readers.
- Keep the existing conversation persistence, mode separation, and audio
  ownership. Do not send private memory, private chats, or unsubmitted drafts.

The confirmation card shows: action verb, target task or report, the person or
people affected, before → after for each changed field, and warnings such as
"this task has an expected outcome and needs completion evidence" or "this
report is no longer pending review." The card's primary button names the
action: Assign, Delegate, Add co-assignee, Complete, Reopen, Approve, Reject.

## Privacy, authorization, and audit

- Every query is scoped by `organization_id` from the token. A task or report
  from another organization answers `404`.
- Admin reach is explicit: the token kind and the `admin` membership role.
  There is no role pass-through from an employee token.
- Admin progress notes and completion evidence are task-scoped, not personal.
  `work_evidence.person_id` stays null; `metrics` records the admin user id,
  the admin token id, and the person the file was attached for. The file
  appears on the task timeline, satisfies the task-scoped completion gate, and
  is deliberately excluded from every person's evidence list, EOD context,
  authored records, and insights. An unmapped admin can attach evidence; no
  person mapping is required.
- The storage path for admin-attached evidence uses the task and evidence id,
  not a person path. The existing employee path stays unchanged.
- Assignment by an unmapped admin leaves `assigned_by_person_id` null and
  records the admin user and token in the audit metadata. The task drawer
  shows "Assigned by an administrator." A later change may add
  `assigned_by_user_id`; it is not required for v1.
- Every write audits the admin user, token id, token name, target person(s),
  and changed fields. Previews themselves are stored, so a proposed action is
  inspectable even when it is never confirmed.
- EOD review keeps the existing self-review prohibition.
- Evidence is capped at 8 MB, one file, supported types; the route
  authenticates itself and stays outside proxy body buffering.

## Errors, limits, and idempotency

| Status | Code | Meaning |
| --- | --- | --- |
| 401 | `unauthorized` | Missing, wrong-kind, or unknown token |
| 401 | `token_revoked` / `token_expired` | Credential no longer valid |
| 403 | `forbidden` | Authenticated but the membership is not an active admin |
| 403 | `feature_disabled` | `admin_agent_api` is off for the organization |
| 403 | `insufficient_scope` | Token lacks the scope for this action |
| 404 | `not_found` | Missing, removed, or another organization's record |
| 202 | `preview` | Consequential write accepted as a preview; nothing written |
| 409 | `preview_stale` | Target state changed since the preview; refresh the card |
| 409 | `conflict` | The action is no longer valid for the current state |
| 410 | `preview_expired` | Preview is past its 15-minute window |
| 409 | `evidence_required` | Task records an expected outcome and needs a file |
| 413 / 415 | `file_too_large` / `unsupported_file_type` | Evidence rejected |
| 422 | `invalid_cursor` | Cursor does not match the current filters |
| 400 | `validation_error` | Bad filter, date, scope, or body |
| 429 | `rate_limited` | Limit exceeded; `Retry-After` set |

Rate limits: 120 requests and 20 write-class requests per minute per token.
Preview creation and confirmation both count as writes. `GET` requests count
as reads. Every write requires `Idempotency-Key`; replay is 24 hours; a reused
key with a different body answers `409 idempotency_conflict`. The existing
`work_agent_idempotency` table is reused with the admin token id, so employee
and admin keys never collide.

## Rollout

1. Additive migration (token kind, nullable person, preview table, indexes).
2. Ship the token kind, scopes, auth module, and token panel behind the
   `admin_agent_api` organization feature flag. The same flag gates the admin
   MCP endpoint and the new Otto tool loop. Flag off means admin tokens cannot
   authenticate, the panel and MCP endpoint are hidden, and admin chat keeps
   the existing read-only intent parser.
3. Ship REST reads and search, then preview/confirm writes, then OpenAPI.
4. Ship the admin MCP endpoint.
5. Move Otto onto the tool loop and confirmation cards, still behind the flag.
   Remove the old parser only after the new path is verified.
6. Enable the flag for the David Yeboah workspace, mint a 15-minute token,
   verify live, revoke it.
7. Deploy through the Agent OS atomic redeploy; verify the deployed identity,
   assets, and a live read plus a preview/confirm cycle.

## Verification

- Unit: kind and scope validation, nullable person, token-kind isolation,
  preview binding/expiry/one-time consumption, search escaping, cursor
  invalidation, assignment mode semantics.
- Route: employee token on admin API, admin token on employee API, revoked,
  expired, demoted admin, feature off, insufficient scope, cross-organization
  `404`, unknown person id, preview replay, idempotency conflict, a stale
  preview after a concurrent assignment or EOD decision, and a second confirm
  returning the stored result.
- Service: create for multiple owners, assign/replace/add/remove, co-assignee
  visibility, complete/reopen, archive/delete cascade, progress, evidence,
  EOD review self-prohibition and manager edit preservation. Task-scoped admin
  evidence appears on the task and satisfies the completion gate, but does not
  appear in the assignee's personal evidence list, EOD context, or insights.
- MCP: exactly the declared admin tools; `preview_action` never writes;
  `confirm_action` executes once; scope errors are tool errors; 8 MB evidence.
- OpenAPI drift: every route file appears in the spec and every documented
  path exists; every scope is documented; the admin MCP tool list matches the
  server.
- Live: mint a short-lived admin token, search people, list David's tasks and
  last week's EODs, preview and confirm an assignment on a disposable task,
  read the audit rows, revoke the token, confirm `401`.
- UI: token panel and Otto confirmation card at 1440, 1024, and 390; keyboard
  focus; reduced motion; expired-preview state; no horizontal scroll.
- `npm run work-os:typecheck`, `npm run work-os:test`, and the affected
  desktop companion tests. One CodeRabbit pass per completed batch.

## Builder calls

These are deliberate choices, not user decisions:

1. One token table with `kind`, not a second credential store.
2. Base paths `/api/agent/admin/v1` and `/api/agent/admin/mcp`.
3. The seven scopes above; read-only default for new admin tokens.
4. Database-backed previews with a 15-minute window and a stored result, not
   signed payloads.
5. `q` on each collection, no unified ranked search endpoint in v1.
6. EOD review is in v1.
7. People administration is out of v1.
8. Progress and evidence write directly; everything that can remove, reassign,
   create, complete, or decide requires a preview.
9. Confirm re-reads the target and compares a bounded state fingerprint.
   Assignment previews resolve the final assignee list once; a later change
   invalidates the preview instead of applying a stale delta.
10. Admin progress and evidence are task-scoped: `person_id` stays null and
    `metrics` carries the uploader and the person it was attached for. They
    satisfy the task gate and never appear in personal records. This applies
    to REST and MCP.
11. No `assigned_by_user_id` column in v1; audit carries the admin identity.
12. Thirteen admin MCP tools: nine reads, two preview/confirm tools, and two
    additive write tools.
13. Otto's fixed intents are replaced by a bounded tool loop; existing result
    cards and conversation persistence stay.

## Later

- A ranked unified search endpoint with trigram or full-text indexes.
- People administration and team management through the API.
- Batch task actions with one preview covering the whole batch.
- Manager-scoped tokens with team-limited person access.
- An admin API documentation page beside the employee one.
- Cross-surface audit views that show proposed-but-unconfirmed actions.
