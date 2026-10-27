# Work OS Agent API (v1)

External agents — coding assistants, CI jobs, automation — can read and update
the work assigned to one person through a scoped, retry-safe REST surface. Work
OS is the source of truth; nothing here touches Nifty.

## Mint a token

1. Sign in to Work OS and open **Settings → Agent access**.
2. Create a token with a name, the scopes you need, and an expiry (default 90
   days, maximum 365).
3. Copy the secret immediately. It is shown once and stored only as a SHA-256
   hash. Revoke it at any time from the same panel.

Tokens are self-minted: every active member creates tokens for themselves, and
nobody can mint a token that acts as another person.

## Scopes

| Scope | Grants |
|---|---|
| `tasks:read` | identity, task list, task detail, activity |
| `tasks:write` | create, update, complete, reopen, blockers |
| `progress:write` | append progress notes |
| `evidence:write` | attach one completion evidence file |

## Endpoints

Base URL: `https://app.wrazyos.com/api/agent/v1`

| Method | Path | Scope |
|---|---|---|
| GET | `/me` | any valid token |
| GET | `/options` | `tasks:read` |
| GET | `/tasks` | `tasks:read` |
| POST | `/tasks` | `tasks:write` |
| GET | `/tasks/{taskId}` | `tasks:read` |
| PATCH | `/tasks/{taskId}` | `tasks:write` |
| DELETE | `/tasks/{taskId}` | `tasks:write` |
| POST | `/tasks/{taskId}/complete` | `tasks:write` |
| POST | `/tasks/{taskId}/reopen` | `tasks:write` |
| POST | `/tasks/{taskId}/progress` | `progress:write` |
| POST | `/tasks/{taskId}/evidence` | `evidence:write` |
| GET | `/tasks/{taskId}/activity` | `tasks:read` |
| POST | `/batch` | per operation |
| GET | `/openapi.yaml` | public |

The schema is the contract: `GET /openapi.yaml` or
`docs/openapi/work-os-agent-v1.yaml`.

`GET /options` returns the projects and people this token may attach to a task —
the same sets the employee's own composer offers. Use it instead of guessing a
`project_id` or `assignee_person_ids` value. A created task always keeps the
token's own person as an assignee, so the same token can read and complete what
it created; any co-assignees must appear in `/options`. Tasks default to the
TASKS project.

Reassignment keeps the token's own person on the task for the same reason:
removing itself would lock the token out of work it just changed. Handing a task
entirely to someone else is an employee-surface action.

`DELETE /tasks/{taskId}?mode=archive|delete` removes a task. `archive` (the
default) keeps it recoverable and `delete` tombstones it. Both are the employee
record's own semantics, so a task already archived can still be deleted. A task
that is gone — deleted, or outside this token's person — answers `404`.

## Authentication

```bash
curl -s https://app.wrazyos.com/api/agent/v1/me \
  -H "Authorization: Bearer wos_agent_…"
```

A token is bound to one organization, one person, and one user. A task outside
that person's work answers `404`, never `403`.

## Idempotency

Every write requires `Idempotency-Key` (1–160 characters). The response is
cached for 24 hours: the same key and body replays the stored response with
`Idempotent-Replay: true`; the same key with a different body answers
`409 idempotency_conflict`; a second request while the first is still applying
answers `409 idempotency_in_flight` with `Retry-After: 1`.

Create is also protected at the row level: a retried create returns the same
task even if the first response was lost.

## Rate limits

120 requests and 20 writes per minute per token. A batch counts as one request
and one write. Over the limit answers `429 rate_limited` with `Retry-After`.

## Errors

```json
{ "error": "Task not found", "code": "not_found", "request_id": "…" }
```

Codes: `unauthorized`, `token_revoked`, `token_expired`, `insufficient_scope`,
`not_found`, `validation_error`, `evidence_required`, `idempotency_conflict`,
`idempotency_in_flight`, `rate_limited`, `file_too_large`,
`unsupported_file_type`, `feature_disabled`, `migration_required`,
`internal_error`.

## Walkthrough

```bash
BASE=https://app.wrazyos.com/api/agent/v1
TOKEN=wos_agent_…

# 1. Create a task for yourself
curl -s -X POST "$BASE/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: create-1" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ship the release","due_date":"2026-10-30"}'

# 2. Log progress
curl -s -X POST "$BASE/tasks/<taskId>/progress" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: progress-1" \
  -H "Content-Type: application/json" \
  -d '{"summary":"Smoke suite is green"}'

# 3. Attach evidence and complete in one call
curl -s -X POST "$BASE/tasks/<taskId>/evidence" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: evidence-1" \
  -F "file=@release-check.png" \
  -F "note=Signed build verified" \
  -F "complete=true"

# 4. Read the timeline
curl -s "$BASE/tasks/<taskId>/activity" \
  -H "Authorization: Bearer $TOKEN"

# 5. Replay a lost response
curl -s -X POST "$BASE/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: create-1" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ship the release","due_date":"2026-10-30"}'
# → the same task id, with Idempotent-Replay: true
```

## Change feed

`GET /tasks?updated_since=<ISO>` replays task-row changes in ascending order
(create, update, complete, reopen, archive, delete). Add
`include_archived=true` to receive archived and deleted tombstones with their
status. Evidence and progress notes do not move the task row; read those through
`/tasks/{taskId}/activity`.

## Batch

`POST /batch` applies up to 20 operations (`create_task`, `update_task`,
`complete_task`, `reopen_task`, `log_progress`) under one request key. Each
operation reports `status: "applied" | "failed"`; a failed item does not roll
back its siblings, and a retry never duplicates an applied create or progress
note.

## Completion and evidence

A task with an `expected_outcome` or `definition_of_done` answers
`409 evidence_required` until a file is attached. Attach first (optionally with
`complete=true`); if completion fails after the upload, the `502` response
carries the saved evidence id, so a retry only re-runs the completion.

## MCP (Phase B)

The same token can drive an MCP client through
`https://app.wrazyos.com/api/mcp`. The endpoint uses **stateless Streamable
HTTP** with JSON responses. It accepts only `POST`; `GET` and `DELETE` answer
`405`. It is not a second auth path: the bearer token, scopes, person, evidence
gate, rate limits, and provenance are the ones the REST surface already uses.

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://app.wrazyos.com/api/mcp"),
  { requestInit: { headers: { Authorization: `Bearer ${process.env.WORK_OS_AGENT_TOKEN}` } } },
);
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const result = await client.callTool({ name: "list_tasks", arguments: {} });
```

| Tool | Scope | Behavior |
|---|---|---|
| `list_tasks` | `tasks:read` | Person-scoped list and change feed (`updated_since`, `include_archived`, `limit`, `cursor`). |
| `get_task` | `tasks:read` | Task, subtasks, completion evidence, blockers. |
| `create_task` | `tasks:write` | Create for the token's person; TASKS by default. |
| `update_task` | `tasks:write` | Content, labels, priority, blockers, assignees, board group, subtask parent. No project moves. |
| `complete_task` | `tasks:write` | Completion with the evidence gate. |
| `log_progress` | `progress:write` | Employee-authored progress note; never completion proof. |
| `attach_evidence` | `evidence:write` | One base64 file, 8 MB max. `complete` defaults to `false`. |

Write tools are idempotent. `create_task`, `log_progress`, and
`attach_evidence` accept an optional `idempotency_key`; when omitted, the
server derives a stable key from the tool and its arguments, so identical
create calls return the same task. Reusing an explicit key with different
arguments returns `idempotency_conflict`. Tool failures come back as
`isError: true` with `{ error, code }`; a rate-limited result includes
`retry_after`. A revoked or expired token fails the connection with `401`.

Rate limits are 120 requests and 20 writes per minute per token. POSTs must
send `Accept: application/json, text/event-stream` and
`Content-Type: application/json`. Evidence is standard padded base64;
`attach_evidence` returns `task: null` when `complete` is false. Passing
`complete=true` also requires the `tasks:write` scope.

`/api/mcp` is excluded from the cookie-session proxy's body buffer because a
base64 8 MB evidence file exceeds the 10 MB proxy limit; the route validates
its own bearer token.
