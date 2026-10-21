# Agent access layer: scoped credentials and a documented task API

Date: Oct 21, 2026. Status: draft for builder check.
Source baseline: Work OS `e4ac7fe3` (0.5.1).
Ledger: Nifty **Tasks** — “Design the external agent access layer”.
Related: `docs/NIFTY-EXIT-PLAN.md`, `design.md` §9 (data truth and provenance),
§16.3 (tenant isolation).

## Intent

External agents — coding assistants, CI jobs, and automation — should be able to
read the work assigned to a person, log progress, attach completion evidence, and
manage their own tasks through one stable, scoped, documented API.

Today they cannot. The task data and CRUD are already local and complete; what is
missing is the **access layer**: a credential that is not a browser cookie or a
device-bound desktop session, a contract they can discover, retry-safe writes, and
a way to ask what changed. This is the last Nifty-shaped gap in the task system,
and it is about access rather than data.

## Goals

- A scoped, revocable credential with an explicit permission set.
- One versioned, documented surface an agent can discover and code against.
- Retry-safe writes, including multipart evidence.
- Reads that answer “what changed since I last looked”.
- Every write attributed to the token and its owner.
- No new Nifty dependency and no new provider write path.

## Non-goals for this delivery

- No administration or manager operations: approvals, EOD review, people,
  settings, insights, billing.
- No cross-person access. A token is bound to exactly one person.
- No provider screenshots or raw Worktivity frames. Agents may attach evidence;
  they cannot download screenshot evidence.
- No task groups, milestones, dependencies, or arbitrary custom fields. Projects
  only, and new work defaults to TASKS.
- No webhooks. `updated_since` covers the first delivery.
- No new web UI beyond personal token management.

## Decisions made by the builder

These are calls, not user agreements. They are recorded here so they can be
rejected before implementation.

1. **Tokens are self-minted.** Any active member can create a token for
   themselves. Nobody can mint a token that acts as another person, including an
   administrator. A future “agent service account” for organization automation is
   a separate design.
2. **The surface is separate from the app’s internal API.** Agent endpoints live
   under `/api/agent/v1/*`; the internal `/api/work-os/*` routes keep their
   cookie/device-session contracts. Agent tokens are rejected by the internal
   guard, and app sessions are rejected by the agent guard.
3. **A token sees only work assigned to its person.** List, read, update,
   complete, progress, and activity all pass through the same person-scoped task
   lookup the employee API already uses.
4. **Agents may complete tasks.** Completion still passes the existing evidence
   gate: a task with an `expected_outcome` or `definition_of_done` needs an
   attached artifact. Attaching evidence and completing are separate operations,
   so a failed completion retries without re-uploading.
5. **Progress is evidence, not a new table.** A progress note is a
   `work_evidence` row (`source = manual`, `metrics.origin = "agent_progress"`,
   token id in metrics). It is employee-authored context, never completion proof.
6. **Tokens expire by default.** Default 90 days, maximum 365, revocable at any
   time. `last_used_at` is written at most once per minute per token.
7. **The OpenAPI file is the source of truth.** The schema lives in the repository
   and is served at `/api/agent/v1/openapi.yaml`. A test fails when a v1 route is
   missing from the spec or the spec names a route that does not exist.
8. **MCP ships as a second phase of the same project.** REST and OpenAPI first;
   the MCP shim reuses the same handlers and auth. This keeps the first release
   small enough to verify end to end.

## Credential model

New table, additive migration:

```sql
create table if not exists work_agent_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references work_organizations(id) on delete cascade,
  person_id uuid not null references work_people(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null,
  scopes text[] not null default '{}'::text[],
  created_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on work_agent_tokens (organization_id, person_id);
```

- Raw token: `wos_agent_` + 32 random bytes, base64url. Shown exactly once.
- Storage: SHA-256 only, the same pattern as `work_desktop_sessions`; lookup by
  hash, never by prefix.
- Display: the first 12 characters plus the name, created date, last used, scopes.
- Revocation is immediate: `revoked_at` is checked on every request.

### Scopes

| scope | grants |
|---|---|
| `tasks:read` | list, detail, activity, change feed |
| `tasks:write` | create, update, complete, reopen, blockers |
| `progress:write` | append progress notes |
| `evidence:write` | attach one completion file |

Defaults on mint: `tasks:read`, `tasks:write`, `progress:write`.
`evidence:write` is opt-in because it takes a file.

## Authentication

One guard, `requireAgentAccess(req, requiredScope)`:

1. Parse `Authorization: Bearer wos_agent_…`; anything else is `401`.
2. Hash and look up the token; reject missing, revoked, or expired with `401`
   (`token_revoked`, `token_expired`).
3. Load the person and the organization membership; both must be active, and the
   organization must have `employee_companion` enabled.
4. Check the scope; missing scope is `403` (`insufficient_scope`).
5. Update `last_used_at` at most once per minute.
6. Return `{ tokenId, organizationId, personId, userId, scopes }`.

No organization header is required: the token is already bound to one
organization and one person. A token presented to an internal route, or a desktop
session presented here, is `401` by shape and by guard.

## Surface

All paths are `/api/agent/v1`. Every write requires `Idempotency-Key`.

| method | path | scope | notes |
|---|---|---|---|
| GET | `/me` | `tasks:read` | identity, scopes, expiry |
| GET | `/tasks` | `tasks:read` | views, search, due filters, `updated_since`, cursor |
| POST | `/tasks` | `tasks:write` | create; defaults assignee = person, project = TASKS |
| GET | `/tasks/{id}` | `tasks:read` | task, subtasks, evidence, blockers |
| PATCH | `/tasks/{id}` | `tasks:write` | mutable fields only |
| POST | `/tasks/{id}/complete` | `tasks:write` | evidence gate applies |
| POST | `/tasks/{id}/reopen` | `tasks:write` | |
| POST | `/tasks/{id}/progress` | `progress:write` | note → `work_evidence` |
| POST | `/tasks/{id}/evidence` | `evidence:write` | multipart; optional `complete=true` |
| GET | `/tasks/{id}/activity` | `tasks:read` | merged timeline |
| POST | `/batch` | varies per item | up to 20 operations, one key |
| GET | `/openapi.yaml` | none | public schema |

### Creation and update

- Create accepts `name`, `description`, `due_date`, `start_date`, `priority`,
  `labels`, `expected_outcome`, `definition_of_done`, `parent_task_id`,
  `project_id`, and `assignee_person_ids`.
- Assignees default to the token’s person; a caller may assign another active
  member only if that person is a valid assignable member of the organization.
- `project_id` defaults to TASKS when omitted. Groups, milestones, and
  dependencies are not part of the contract.
- Update accepts the same mutable fields plus `blocked` and `blocked_reason`.
  Immutable: `provider`, `provider_task_id`, `id`, `organization_id`,
  `created_at`.

### Completion

- `POST /complete` runs the same evidence gate as the employee Completion
  dialog. If the task requires evidence and none exists, the response is
  `409 evidence_required` with the task’s expected outcome in the message.
- `POST /evidence` persists the file and the row first; `complete=true` then
  completes. On completion failure the response is `502` with the saved evidence
  id, and a retry of `/complete` does not re-upload.

### Progress and activity

- A progress note is a `work_evidence` row with `source = manual`,
  `metrics.origin = "agent_progress"`, and `metrics.agentTokenId`.
- `GET /tasks/{id}/activity` merges, newest first:
  `work_task_day_events` (created, completed, reopened), `work_evidence`
  (progress notes and evidence), and `work_task_blockers` (added, resolved).
  Each item states its kind, time, actor (`agent`, `employee`, `system`), and a
  short summary. Raw provider payloads and storage paths never appear.

## Idempotency

New table:

```sql
create table if not exists work_agent_idempotency (
  organization_id uuid not null references work_organizations(id) on delete cascade,
  token_id uuid not null references work_agent_tokens(id) on delete cascade,
  key text not null,
  request_hash text not null,
  status smallint not null,
  body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (token_id, key)
);
```

- The request hash covers method, path, and the canonical request body (file
  bytes included for multipart).
- Replay within 24 hours returns the stored status and body with
  `Idempotent-Replay: true`.
- Same key with a different hash is `409 idempotency_conflict`.
- A second request while the first is still applying is `409
  idempotency_in_flight` with `Retry-After: 1`.
- Expired rows are pruned by the existing retention job or a small daily sweep.

## Batch

`POST /batch` takes at most 20 operations: `create_task`, `update_task`,
`complete_task`, `reopen_task`, `log_progress`. One `Idempotency-Key` covers the
whole batch. Operations run in order; each result reports `status`, `id`, and
`error` when it failed, so a partial failure is visible rather than hidden. The
response is `200` when the batch was accepted, `400` for a malformed batch,
`409` for an idempotency conflict. Evidence upload stays out of the batch in v1
because it is multipart.

## Change feed

`GET /tasks?updated_since=<RFC3339>` returns tasks whose `updated_at` is after
the instant, ordered by `updated_at` then `id`, with an opaque cursor. This is the
agent’s “what changed since I last looked” read and the reason webhooks can wait.
The same `updated_since` and cursor apply to `/tasks/{id}/activity`.

## OpenAPI and MCP

- `docs/openapi/work-os-agent-v1.yaml` is the contract. It is served at
  `/api/agent/v1/openapi.yaml` without auth and with a public cache header. It
  includes request/response examples and the error codes below.
- A test asserts route coverage in both directions and that each documented scope
  matches the handler.
- MCP (phase 2) is a streamable HTTP endpoint at `/api/mcp` using the same bearer
  token and the same handlers. Tools: `list_tasks`, `get_task`, `create_task`,
  `update_task`, `complete_task`, `log_progress`, `attach_evidence`. No separate
  server package and no second auth path.

## Token management UI

- Web **Settings → Agent access** (personal settings): a flat list of tokens with
  name, prefix, scopes, created, last used, expiry, and `Revoke`. One
  `Create token` dialog asks for a name, scopes, and expiry, then shows the secret
  once with a copy action and an explicit “This is the only time you will see it”
  line.
- Only the owner sees their tokens. Administrators do not see other people’s
  tokens; the audit log records creation, use, and revocation without the secret.
- Companion parity is a follow-up; the web personal settings are the first
  surface because token creation is a rare, deliberate action.

## Audit, limits, and errors

- `work_audit_log` actions: `agent_token.created`, `agent_token.revoked`,
  `agent.task.created`, `agent.task.updated`, `agent.task.completed`,
  `agent.progress.logged`, `agent.evidence.attached`. `actor_user_id` is the
  token owner; metadata carries `token_id`, `token_name`, and the scopes used. The
  secret is never logged.
- Rate limit: 120 requests per minute and 20 writes per minute per token, `429`
  with `Retry-After`. The limiter is in memory because the deployment is a single
  web instance; a shared limiter is a follow-up if the app scales out.
- Error body: `{ error, code, request_id }` with codes `unauthorized`,
  `token_revoked`, `token_expired`, `insufficient_scope`, `not_found`,
  `validation_error`, `evidence_required`, `idempotency_conflict`,
  `idempotency_in_flight`, `rate_limited`, `file_too_large`,
  `unsupported_file_type`.
- Tenant isolation: every query is scoped by `organization_id` and the token’s
  `person_id`, and every task write reuses the existing employee authorization
  lookup. A task outside that scope answers `404`, never `403`, so ids do not
  leak.

## Rollout

1. Migration `0063_work_agent_access.sql`: tokens and idempotency tables.
2. Server: `requireAgentAccess`, the v1 routes, idempotency wrapper, audit,
   rate limit. Completion and evidence reuse the existing services.
3. Contract: OpenAPI file, served schema, coverage test, and a short
   `docs/AGENT-API.md` with curl examples.
4. Web Settings token management.
5. MCP shim and tool tests.
6. Live verification: mint a token, create a task, log progress, attach
   evidence, complete a gated task, read the activity and change feed, revoke the
   token and confirm `401`.

## Verification

- Unit: token hashing, expiry, revocation, scope checks, idempotent replay and
  conflict, batch partial results, activity merge, rate limit.
- Route: 401/403/404/409/413/429, cross-person denial, evidence gate, file type
  and size.
- Contract: OpenAPI covers exactly the v1 routes and scopes.
- Live: the end-to-end sequence above against the deployed app with a real token,
  including the failed-completion retry path and revocation.

## Open questions for the user

1. Should an agent be allowed to complete tasks, or only log progress? This design
   allows completion with the existing evidence gate.
2. Should tokens be self-minted only, or may an administrator mint a token bound
   to another person for automation? This design is self-only.
3. Should an agent see only tasks assigned to its person, or also unassigned work
   it created earlier? This design is assigned-work only, with new tasks assigned
   to the person by default.
4. Default token lifetime: 90 days (this design) or no expiry?
