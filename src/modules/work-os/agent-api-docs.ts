/**
 * Browser-safe Agent API documentation model.
 *
 * The endpoint set, required scopes, and error vocabulary are held here so the
 * rendered guide and its OpenAPI drift test read the same source. This module
 * must not import server-only modules.
 */

export const AGENT_API_BASE_URL = "https://app.wrazyos.com/api/agent/v1";
export const AGENT_API_OPENAPI_URL = `${AGENT_API_BASE_URL}/openapi.yaml`;
export const AGENT_API_GUIDE_URL = "https://app.wrazyos.com/docs/agent-api";
export const AGENT_API_LLMS_URL = `${AGENT_API_GUIDE_URL}/llms.txt`;
export const AGENT_API_AGENT_PROMPT = `Read the agent instructions at ${AGENT_API_LLMS_URL}`;
export const AGENT_API_MCP_URL = "https://app.wrazyos.com/api/mcp";
export const AGENT_API_TOKEN_PREFIX = "wos_agent_";

export type AgentApiScopeId =
  | "tasks:read"
  | "tasks:write"
  | "progress:write"
  | "evidence:write";

export type AgentApiRequiredScope = AgentApiScopeId | "none" | "public";

export type AgentApiEndpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  group: "read" | "write" | "schema";
  requiredScope: AgentApiRequiredScope;
  /** The display label is "Per operation" for batch, whose route checks each
   * operation's scope even though the OpenAPI operation also records
   * tasks:write. All other rows display requiredScope. */
  scopeLabel: string;
  purpose: string;
  note?: string;
};

export const AGENT_API_ENDPOINTS: AgentApiEndpoint[] = [
  {
    method: "GET",
    path: "/me",
    group: "read",
    requiredScope: "none",
    scopeLabel: "Any valid token",
    purpose: "Confirm the workspace, person, token name, prefix, scopes, and expiry.",
  },
  {
    method: "GET",
    path: "/options",
    group: "read",
    requiredScope: "tasks:read",
    scopeLabel: "tasks:read",
    purpose: "Read the projects available to the token and the token's own person.",
  },
  {
    method: "GET",
    path: "/tasks",
    group: "read",
    requiredScope: "tasks:read",
    scopeLabel: "tasks:read",
    purpose: "Read assigned work. Add updated_since to replay row changes as a change feed.",
  },
  {
    method: "GET",
    path: "/tasks/{taskId}",
    group: "read",
    requiredScope: "tasks:read",
    scopeLabel: "tasks:read",
    purpose: "Read one task with its subtasks, blockers, and completion evidence.",
  },
  {
    method: "GET",
    path: "/tasks/{taskId}/activity",
    group: "read",
    requiredScope: "tasks:read",
    scopeLabel: "tasks:read",
    purpose: "Read the merged, newest-first task timeline.",
  },
  {
    method: "POST",
    path: "/tasks",
    group: "write",
    requiredScope: "tasks:write",
    scopeLabel: "tasks:write",
    purpose: "Create a task for the token's own person. The TASKS project is the default.",
  },
  {
    method: "PATCH",
    path: "/tasks/{taskId}",
    group: "write",
    requiredScope: "tasks:write",
    scopeLabel: "tasks:write",
    purpose: "Update content, labels, blockers, assignment, board group, or subtask parent.",
  },
  {
    method: "DELETE",
    path: "/tasks/{taskId}",
    group: "write",
    requiredScope: "tasks:write",
    scopeLabel: "tasks:write",
    purpose: "Archive the task by default, or permanently delete it with mode=delete.",
  },
  {
    method: "POST",
    path: "/tasks/{taskId}/complete",
    group: "write",
    requiredScope: "tasks:write",
    scopeLabel: "tasks:write",
    purpose: "Complete the task. Open subtasks close first.",
  },
  {
    method: "POST",
    path: "/tasks/{taskId}/reopen",
    group: "write",
    requiredScope: "tasks:write",
    scopeLabel: "tasks:write",
    purpose: "Reopen a completed task.",
  },
  {
    method: "POST",
    path: "/tasks/{taskId}/progress",
    group: "write",
    requiredScope: "progress:write",
    scopeLabel: "progress:write",
    purpose: "Append a progress note. It records context, not completion proof.",
  },
  {
    method: "POST",
    path: "/tasks/{taskId}/evidence",
    group: "write",
    requiredScope: "evidence:write",
    scopeLabel: "evidence:write",
    purpose: "Attach one completion file, optionally completing the task in the same call.",
    note: "Completing after the attachment also requires tasks:write.",
  },
  {
    method: "POST",
    path: "/batch",
    group: "write",
    requiredScope: "tasks:write",
    scopeLabel: "Per operation",
    purpose: "Apply up to 20 create, update, complete, reopen, or progress operations with per-item results.",
    note: "Task operations require tasks:write; log_progress requires progress:write.",
  },
  {
    method: "GET",
    path: "/openapi.yaml",
    group: "schema",
    requiredScope: "public",
    scopeLabel: "Public",
    purpose: "Download the OpenAPI 3.1 schema served by this deployment.",
  },
];

export const AGENT_API_SCOPES: Array<{
  id: AgentApiScopeId;
  label: string;
  grants: string;
  limit: string;
}> = [
  {
    id: "tasks:read",
    label: "Read work",
    grants: "Identity, creation options, task lists, task detail, and task activity.",
    limit: "A tasks:write token still cannot read tasks without this scope.",
  },
  {
    id: "tasks:write",
    label: "Change work",
    grants: "Create, update, archive, delete, complete, and reopen tasks, plus record or clear blockers.",
    limit: "It does not grant task reads, progress notes, or evidence attachment.",
  },
  {
    id: "progress:write",
    label: "Log progress",
    grants: "Append employee-authored progress notes to a task.",
    limit: "A progress note is context. It never proves completion.",
  },
  {
    id: "evidence:write",
    label: "Attach evidence",
    grants: "Attach one completion file, up to 8 MB, to a task.",
    limit: "Setting complete=true on the attachment also requires tasks:write.",
  },
];

export const AGENT_API_EVIDENCE_TYPE_LABELS = [
  "PNG",
  "JPEG",
  "WebP",
  "PDF",
  "Word .doc",
  "Word .docx",
  "Text",
  "Markdown",
  "CSV",
  "ZIP",
  "7Z",
] as const;

export const AGENT_API_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
export const AGENT_API_RATE_LIMIT_REQUESTS = 120;
export const AGENT_API_RATE_LIMIT_WRITES = 20;

export type AgentApiErrorCode =
  | "unauthorized"
  | "token_revoked"
  | "token_expired"
  | "insufficient_scope"
  | "forbidden"
  | "not_found"
  | "validation_error"
  | "evidence_required"
  | "idempotency_conflict"
  | "idempotency_in_flight"
  | "rate_limited"
  | "file_too_large"
  | "unsupported_file_type"
  | "feature_disabled"
  | "migration_required"
  | "internal_error";

export const AGENT_API_ERRORS: Array<{
  code: AgentApiErrorCode;
  status: number;
  action: string;
}> = [
  { code: "unauthorized", status: 401, action: "Send Authorization: Bearer <token>. If the header is correct, mint a new token; this one is not recognized." },
  { code: "token_revoked", status: 401, action: "This token was revoked. Mint a new token in Settings → Agent access." },
  { code: "token_expired", status: 401, action: "This token reached its expiry. Mint a new token with a new expiry." },
  { code: "insufficient_scope", status: 403, action: "The token lacks this endpoint's scope. Create a new token with the scope; scopes cannot be edited on an existing token." },
  { code: "forbidden", status: 403, action: "The person does not hold or manage the task for this action. Use the employee workspace for work outside the token's control." },
  { code: "not_found", status: 404, action: "The task is outside this token's person or was deleted. Check the id. Do not retry this request unchanged." },
  { code: "validation_error", status: 400, action: "The request does not match the schema, or it names another person as an assignee. Check the message and the OpenAPI schema." },
  { code: "evidence_required", status: 409, action: "The task has an expected outcome or definition of done. Attach a file with POST /tasks/{taskId}/evidence, then complete it." },
  { code: "idempotency_conflict", status: 409, action: "This Idempotency-Key was used with a different body. Reuse the original body for a replay, or send a new key for a new write." },
  { code: "idempotency_in_flight", status: 409, action: "The same write is still applying. Wait for Retry-After, then repeat the same key and body." },
  { code: "rate_limited", status: 429, action: "Wait for Retry-After, then retry. The budget is 120 requests and 20 writes per minute per token." },
  { code: "file_too_large", status: 413, action: "Send a file of 8 MB or less. The limit applies before base64 encoding on MCP." },
  { code: "unsupported_file_type", status: 415, action: "Send PNG, JPEG, WebP, PDF, DOC, DOCX, TXT, Markdown, CSV, ZIP, or 7Z with a matching content type." },
  { code: "feature_disabled", status: 403, action: "Agent access is not enabled for this workspace. Ask a workspace administrator to enable it." },
  { code: "migration_required", status: 503, action: "The workspace database is not ready for agent access. Ask an administrator to complete the migration." },
  { code: "internal_error", status: 500, action: "Retry a write with the same key and body. If it keeps failing, report the request_id from the response." },
];

export const AGENT_API_MCP_TOOLS = [
  { name: "list_tasks", scope: "tasks:read", behavior: "List assigned tasks or replay the change feed." },
  { name: "get_task", scope: "tasks:read", behavior: "Read one task with subtasks, evidence, and blockers." },
  { name: "create_task", scope: "tasks:write", behavior: "Create work for the token's person." },
  { name: "update_task", scope: "tasks:write", behavior: "Update content, labels, blockers, assignment, board group, or parent." },
  { name: "complete_task", scope: "tasks:write", behavior: "Complete a task through the evidence gate." },
  { name: "log_progress", scope: "progress:write", behavior: "Append a progress note." },
  { name: "attach_evidence", scope: "evidence:write", behavior: "Attach one base64 file; complete only with tasks:write." },
] as const;

export const AGENT_API_SECTIONS = [
  { id: "get-token", label: "Get a token" },
  { id: "first-call", label: "First call" },
  { id: "agent-setup", label: "Agent setup" },
  { id: "endpoints", label: "Endpoints" },
  { id: "scopes", label: "Scopes" },
  { id: "limits", label: "Limits and evidence" },
  { id: "behavior", label: "Agent behavior" },
  { id: "errors", label: "Errors" },
  { id: "mcp", label: "MCP" },
] as const;

export const AGENT_API_CURL_SAMPLE = `export WORK_OS_API_TOKEN="wos_agent_..."
curl --fail-with-body \\
  -H "Authorization: Bearer $WORK_OS_API_TOKEN" \\
  "https://app.wrazyos.com/api/agent/v1/me"`;

export const AGENT_API_TYPESCRIPT_SAMPLE = `type AgentError = { error: string; code: string; request_id: string };
type Me = {
  organization_id: string;
  person_id: string;
  token: {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
    expires_at: string;
  };
};

async function main() {
  const base = "https://app.wrazyos.com/api/agent/v1";
  const token = process.env.WORK_OS_API_TOKEN;

  if (!token) {
    throw new Error("Set WORK_OS_API_TOKEN before running this script.");
  }

  const response = await fetch(\`\${base}/me\`, {
    headers: { Authorization: \`Bearer \${token}\` },
  });
  const body = await response.json() as Me | AgentError;

  if (!response.ok) {
    const failure = body as AgentError;
    throw new Error(\`\${response.status} \${failure.code}: \${failure.error}\`);
  }

  console.log(body);
}

void main();`;
