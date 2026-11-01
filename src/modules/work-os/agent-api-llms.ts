import {
  AGENT_API_AGENT_PROMPT,
  AGENT_API_BASE_URL,
  AGENT_API_CURL_SAMPLE,
  AGENT_API_ENDPOINTS,
  AGENT_API_ERRORS,
  AGENT_API_EVIDENCE_MAX_BYTES,
  AGENT_API_EVIDENCE_TYPE_LABELS,
  AGENT_API_GUIDE_URL,
  AGENT_API_MCP_TOOLS,
  AGENT_API_MCP_URL,
  AGENT_API_OPENAPI_URL,
  AGENT_API_RATE_LIMIT_REQUESTS,
  AGENT_API_RATE_LIMIT_WRITES,
  AGENT_API_SCOPES,
  AGENT_API_TYPESCRIPT_SAMPLE,
} from "./agent-api-docs";

/**
 * The agent-readable version of the public guide. Keep this generated from the
 * same documentation model so the prose and the web page cannot drift apart.
 */
export function buildAgentInstructions(): string {
  const endpoints = AGENT_API_ENDPOINTS.map((endpoint) => (
    `| ${endpoint.method} | \`${endpoint.path}\` | ${endpoint.scopeLabel} | ${endpoint.purpose}${endpoint.note ? ` ${endpoint.note}` : ""} |`
  )).join("\n");
  const scopes = AGENT_API_SCOPES.map((scope) => `- \`${scope.id}\`: ${scope.grants} ${scope.limit}`).join("\n");
  const errors = AGENT_API_ERRORS.map((error) => `- \`${error.code}\` (${error.status}): ${error.action}`).join("\n");
  const tools = AGENT_API_MCP_TOOLS.map((tool) => `- \`${tool.name}\` (\`${tool.scope}\`): ${tool.behavior}`).join("\n");

  return `# Work OS Agent API v1

${AGENT_API_AGENT_PROMPT}

Read this before making calls. The token acts as exactly one person. It can see and change that person's work only. Work outside that person's scope, and deleted work, answers 404, never 403.

Canonical guide: ${AGENT_API_GUIDE_URL}
OpenAPI schema: ${AGENT_API_OPENAPI_URL}
Base URL: ${AGENT_API_BASE_URL}

## 1. Get a token

Create a token in the Work OS employee workspace at Settings -> Agent access:
https://app.wrazyos.com/work-os/agent-access

Token creation requires sign-in. The secret is shown once and stored only as a SHA-256 hash. Choose scopes at creation; scopes cannot be edited later. Revoke a token from the same panel. Tokens expire after 90 days by default and at most 365 days.

The secret starts with \`wos_agent_\`. Store it as \`WORK_OS_API_TOKEN\`; \`WORK_OS_AGENT_TOKEN\` is a legacy alias.

## 2. First call

${AGENT_API_CURL_SAMPLE}

${AGENT_API_TYPESCRIPT_SAMPLE}

Start with \`GET /me\` to verify the token, workspace, person, scopes, and expiry. Use \`GET /options\` to find the projects available to this token and its own person. Use \`GET /tasks\` to read assigned work.

## 3. Access model

- A token is bound to one organization, one person, and one user.
- Every read is limited to that person's work. Other people, other organizations, and deleted tasks return 404.
- Assignment through a token is self-only. Omitted \`assignee_person_ids\` defaults to the token's own person. An explicit list may name only that person; any other id returns 400. An empty list creates unassigned work, which leaves the assignee-scoped list but stays addressable by id because the token's person becomes its assigner.
- Hand work to a coworker in the employee workspace, not through a token.
- Completing a parent completes its open subtasks first. A subtask that cannot close leaves the parent open. Reopening a parent does not reopen its subtasks.
- Content fields require edit control. The assignee can record or clear a blocker without edit control. A person who neither holds nor manages the task receives 403.

## 4. Scopes

${scopes}

A scope never implies another scope. A read-only token connects normally. REST writes return 403 \`insufficient_scope\`; MCP tool calls return \`isError: true\` with code \`insufficient_scope\` while the connection stays open.

## 5. Endpoints

${endpoints}

Notes:

- Every write requires \`Idempotency-Key\` (1-160 characters).
- \`DELETE /tasks/{taskId}?mode=archive\` is the default; \`mode=delete\` tombstones the task.
- \`GET /tasks?updated_since=<ISO timestamp>\` replays row changes in ascending order. Add \`include_archived=true\` for archived and deleted tombstones.
- \`GET /tasks\` and \`GET /tasks/{taskId}/activity\` accept \`limit\` (1-100, default 50) and \`cursor\`.
- \`POST /batch\` applies up to 20 operations (create_task, update_task, complete_task, reopen_task, log_progress) under one request key. Each item reports applied or failed; a failed item does not roll back its siblings. Task operations need \`tasks:write\`; \`log_progress\` needs \`progress:write\`.
- \`POST /tasks/{taskId}/evidence\` accepts one multipart file, an optional note up to 1,000 characters, and \`complete\`. REST defaults \`complete\` to true; MCP defaults it to false. Completing after attaching also requires \`tasks:write\`.

## 6. Idempotency and limits

Every write requires \`Idempotency-Key\`. The response is cached for 24 hours. The same key and body replays the stored response with \`Idempotent-Replay: true\`; the same key with a different body returns 409 \`idempotency_conflict\`. A request still applying returns 409 \`idempotency_in_flight\` with \`Retry-After: 1\`. A retried create reconciles at the row level.

Rate limit: ${AGENT_API_RATE_LIMIT_REQUESTS} requests and ${AGENT_API_RATE_LIMIT_WRITES} writes per minute per token. A batch counts as one request and one write. Over the limit returns 429 \`rate_limited\` with \`Retry-After\`.

## 7. Completion evidence

A task with \`expected_outcome\` or \`definition_of_done\` answers 409 \`evidence_required\` until a file is attached. Attach first with \`POST /tasks/{taskId}/evidence\`, optionally passing \`complete=true\`. If attachment succeeds but completion fails, the 502 carries the saved evidence; retry the completion with the same key.

One file, up to ${AGENT_API_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB. Supported types: ${AGENT_API_EVIDENCE_TYPE_LABELS.join(", ")}. MCP sends the same file as padded base64.

## 8. Errors

Every REST error returns an error message, a stable code, and a request id:

\`\`\`json
{ "error": "Task not found", "code": "not_found", "request_id": "..." }
\`\`\`

${errors}

Use the code to decide what to do. Cross-person and removed work is 404. A 403 means the token's person has a scope or permission boundary on visible work. Include the request id when reporting a 5xx.

## 9. MCP

Endpoint: ${AGENT_API_MCP_URL}

The MCP surface uses the same token, scopes, person, evidence gate, rate limits, and provenance as REST. It is stateless Streamable HTTP with JSON responses. Send POST only with \`Accept: application/json, text/event-stream\` and \`Content-Type: application/json\`. GET and DELETE return 405. Tool failures are \`isError: true\` results with the same codes; the connection stays open. A revoked or expired token fails the connection with 401.

Tools:
${tools}

Write tools accept an optional \`idempotency_key\`. When omitted, the server derives a stable key from the tool and its arguments.

## 10. Safe operation

1. Call \`GET /me\` before the first task call.
2. Read the task before mutating it.
3. Send a unique idempotency key for every write.
4. Never invent a task id, project id, or person id; use the record or \`GET /options\`.
5. Never claim task completion from observed activity. Use the evidence gate.
6. Treat 404 as outside this token's person or removed; do not retry it unchanged.
7. On a 5xx write, retry with the same key and body. If it persists, report the request id.

## 11. Setup prompt

Ask your coding agent:

\`\`\`text
${AGENT_API_AGENT_PROMPT}
\`\`\`
`;
}
