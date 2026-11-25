/** Browser-safe documentation shared by the administrator guide and llms.txt. */
import {
  ADMIN_AGENT_API_BASE_URL,
  ADMIN_AGENT_API_TOKEN_PREFIX,
  AGENT_API_EVIDENCE_TYPE_LABELS,
  AGENT_API_RATE_LIMIT_REQUESTS,
  AGENT_API_RATE_LIMIT_WRITES,
} from "./agent-api-docs";
import {
  COMPLETION_EVIDENCE_MAX_BYTES,
  COMPLETION_EVIDENCE_MAX_FILE_NAME,
  COMPLETION_EVIDENCE_MAX_NOTE,
} from "./completion-evidence";

export const ADMIN_AGENT_API_SCOPES = [
  { id: "people:read", default: true, purpose: "Read the organization directory and projects." },
  { id: "tasks:read", default: true, purpose: "Read tasks, timelines, and evidence files." },
  { id: "eods:read", default: true, purpose: "Read submitted end-of-day reports and their version history." },
  { id: "records:read", default: true, purpose: "Read work records across people and sources." },
  { id: "insights:read", default: true, purpose: "Read the organization overview and deterministic insights." },
  { id: "tasks:write", default: false, purpose: "Preview and confirm task changes; append progress notes and evidence directly." },
  { id: "eods:review", default: false, purpose: "Preview and confirm decisions on pending end-of-day reports." },
] as const;

type Scope = (typeof ADMIN_AGENT_API_SCOPES)[number]["id"];
export const ADMIN_AGENT_API_GROUPS = {
  read: "Read paths",
  task: "Task actions",
  preview: "EOD and preview actions",
  contract: "Contract",
};

type Endpoint = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  group: keyof typeof ADMIN_AGENT_API_GROUPS;
  requiredScope: Scope | "none" | "public";
  requiredScopeAny?: readonly Scope[];
  purpose: string;
};

const actionScopes = ["tasks:write", "eods:review"] as const;
const actionScopeLabel = "Tasks: tasks:write; EOD reviews: eods:review";

export const ADMIN_AGENT_API_ENDPOINTS: readonly Endpoint[] = [
  { group: "read", method: "GET", path: "/me", requiredScope: "none", purpose: "Verify the token, organization, administrator identity, and scopes." },
  { group: "read", method: "GET", path: "/people", requiredScope: "people:read", purpose: "Search or filter the organization directory." },
  { group: "read", method: "GET", path: "/people/{personId}", requiredScope: "people:read", purpose: "Read a member's profile, schedule, manager, and teams." },
  { group: "read", method: "GET", path: "/projects", requiredScope: "people:read", purpose: "List organization projects and their board groups." },
  { group: "read", method: "GET", path: "/tasks", requiredScope: "tasks:read", purpose: "Filter tasks across people. Use updated_since for the change feed." },
  { group: "read", method: "GET", path: "/tasks/{taskId}", requiredScope: "tasks:read", purpose: "Read task detail, subtasks, and completion evidence. Archived tasks remain readable." },
  { group: "read", method: "GET", path: "/tasks/{taskId}/activity", requiredScope: "tasks:read", purpose: "Read the task's activity timeline." },
  { group: "read", method: "GET", path: "/evidence/{evidenceId}/file", requiredScope: "tasks:read", purpose: "Download authorized evidence through the API, not from storage directly." },
  { group: "read", method: "GET", path: "/eods", requiredScope: "eods:read", purpose: "List submitted end-of-day reports across people." },
  { group: "read", method: "GET", path: "/eods/{reportId}", requiredScope: "eods:read", purpose: "Read one report and its version history." },
  { group: "read", method: "GET", path: "/records", requiredScope: "records:read", purpose: "Read updates, submitted EODs, task events, reviewed recaps, and workday snapshots." },
  { group: "read", method: "GET", path: "/overview", requiredScope: "insights:read", purpose: "Read organization counts and decision queues for one local day." },
  { group: "read", method: "GET", path: "/insights", requiredScope: "insights:read", purpose: "Read factual figures for 7, 30, or 90 days." },
  { group: "task", method: "POST", path: "/tasks", requiredScope: "tasks:write", purpose: "Preview task creation for named active organization members." },
  { group: "task", method: "PATCH", path: "/tasks/{taskId}", requiredScope: "tasks:write", purpose: "Preview edits to content, dates, blockers, labels, or assignees." },
  { group: "task", method: "DELETE", path: "/tasks/{taskId}", requiredScope: "tasks:write", purpose: "Preview archiving (default) or tombstoning (mode=delete), including subtasks." },
  { group: "task", method: "POST", path: "/tasks/{taskId}/assign", requiredScope: "tasks:write", purpose: "Preview an assignee change." },
  { group: "task", method: "POST", path: "/tasks/{taskId}/move", requiredScope: "tasks:write", purpose: "Preview moving a subtask under another top-level task." },
  { group: "task", method: "POST", path: "/tasks/{taskId}/complete", requiredScope: "tasks:write", purpose: "Preview completion and surface any missing evidence." },
  { group: "task", method: "POST", path: "/tasks/{taskId}/reopen", requiredScope: "tasks:write", purpose: "Preview reopening completed work." },
  { group: "task", method: "POST", path: "/tasks/{taskId}/progress", requiredScope: "tasks:write", purpose: "Append an audited progress note directly (201), not completion evidence." },
  { group: "task", method: "POST", path: "/tasks/{taskId}/evidence", requiredScope: "tasks:write", purpose: "Attach one audited completion file directly (201), without completing the task." },
  { group: "preview", method: "POST", path: "/eods/{reportId}/review", requiredScope: "eods:review", purpose: "Preview approving or rejecting a pending report." },
  { group: "preview", method: "POST", path: "/previews", requiredScope: "tasks:write", requiredScopeAny: actionScopes, purpose: "Preview a named action by sending its action and payload." },
  { group: "preview", method: "GET", path: "/previews/{previewId}", requiredScope: "tasks:write", requiredScopeAny: actionScopes, purpose: "Read a preview using the same token that created it." },
  { group: "preview", method: "POST", path: "/previews/{previewId}/confirm", requiredScope: "tasks:write", requiredScopeAny: actionScopes, purpose: "Apply the approved preview exactly once. Confirm with the same token." },
  { group: "contract", method: "GET", path: "/openapi.yaml", requiredScope: "public", purpose: "Download the public OpenAPI 3.1 schema." },
];

export function adminEndpointScopeLabel(endpoint: Endpoint) {
  if (endpoint.requiredScopeAny) return actionScopeLabel;
  if (endpoint.requiredScope === "none") return "Any valid admin token";
  if (endpoint.requiredScope === "public") return "Public";
  return endpoint.requiredScope;
}

export const ADMIN_AGENT_API_AUTH = [
  "The organization must have the admin_agent_api and employee_companion features enabled. Every authenticated call rechecks the minting user's administrator role, feature flags, and token scopes.",
  `Send Authorization: Bearer ${ADMIN_AGENT_API_TOKEN_PREFIX}… to the admin API. Employee tokens are rejected with 401.`,
  "An administrator can issue, list, or revoke only their own tokens. A token is bound to the administrator who minted it and to one organization; it never impersonates a member. Reads can span the organization when the token holds the required scope.",
];

export const ADMIN_AGENT_API_TOKEN_STEPS = [
  "On the web, open the admin console and go to Administration → Settings → Agent access. In the desktop companion, go to Settings → Session and look for administrator agent access.",
  "Name the token, set its expiry, and choose the scopes the integration needs. Read scopes are selected by default; task writes and EOD reviews are opt-in.",
  "Copy the secret when it appears. It's shown only once. Store it outside source code and chat logs, and revoke it in Agent access when it is no longer needed.",
];

export const ADMIN_AGENT_API_FIRST_CALL = `curl -H "Authorization: Bearer $WORK_OS_ADMIN_API_TOKEN" \\\n  ${ADMIN_AGENT_API_BASE_URL}/me`;
export const ADMIN_AGENT_API_ERROR_ENVELOPE = '{ "error": "Task not found", "code": "not_found", "request_id": "<uuid>" }';

export const ADMIN_AGENT_API_RULES = [
  {
    title: "Preview before changing records",
    text: "Consequential task and EOD writes return a 202 preview; only POST /previews/{previewId}/confirm applies it, exactly once. Show the summary, changes, and warnings to the administrator. Never confirm implicitly or before explicit approval.",
  },
  {
    title: "Keep previews bound to their token and target",
    text: "Use the same token and the stored action's write scope. A preview expires within 15 minutes. If the target changed, confirm returns 409 preview_stale with current_state and writes nothing. Create a fresh preview and get approval again.",
  },
  {
    title: "Make retries safe",
    text: "Send an Idempotency-Key (up to 160 characters) on every REST write, including preview creation and confirmation. Retry the same request with the same key: the stored response replays for 24 hours with Idempotent-Replay: true. A different request under the same key conflicts. Confirm needs its own key; the preview ID is the canonical one-time execution key.",
  },
  {
    title: "Respect the token's rate limits",
    text: `Each token can make ${AGENT_API_RATE_LIMIT_REQUESTS} total requests per minute, including at most ${AGENT_API_RATE_LIMIT_WRITES} writes. On 429, wait for Retry-After before resuming.`,
  },
  {
    title: "Attach evidence without marking a task complete",
    text: `Progress notes and evidence are additive writes; neither needs a preview. Send one non-empty multipart file in the file field, up to ${COMPLETION_EVIDENCE_MAX_BYTES / 1024 / 1024} MiB, with an optional note up to ${COMPLETION_EVIDENCE_MAX_NOTE} characters and a file name up to ${COMPLETION_EVIDENCE_MAX_FILE_NAME} characters. An evidence upload accepts the Idempotency-Key header or the idempotency_key form field. Accepted: ${AGENT_API_EVIDENCE_TYPE_LABELS.join(", ")}. The size limit on MCP is measured before base64 encoding. Evidence can satisfy a completion gate; a progress note cannot.`,
  },
  {
    title: "Treat 404 as a boundary, not a discovery signal",
    text: "Missing, out-of-scope, and cross-organization identifiers are indistinguishable. Previews from other tokens also return 404, even within the same organization.",
  },
];

export const ADMIN_AGENT_API_ERRORS = [
  { status: 400, code: "validation_error", action: "Check the request body, headers, or parameters against the schema." },
  { status: 401, code: "unauthorized", action: "Use a valid administrator bearer token, not an employee token." },
  { status: 401, code: "token_expired", action: "Issue a replacement token." },
  { status: 401, code: "token_revoked", action: "Use a current token issued by the administrator." },
  { status: 403, code: "forbidden", action: "Check that the user still has the administrator role and can perform the operation." },
  { status: 403, code: "feature_disabled", action: "Check the administrator agent API and employee companion features." },
  { status: 403, code: "insufficient_scope", action: "Use a token with the scope required by the operation or stored action." },
  { status: 404, code: "not_found", action: "Check the ID via an authorized list or read." },
  { status: 404, code: "preview_not_found", action: "Check the preview ID and use the token that created it." },
  { status: 409, code: "conflict", action: "Re-read the record before trying a new action." },
  { status: 409, code: "preview_stale", action: "Inspect current_state, create a fresh preview, and get approval again." },
  { status: 409, code: "preview_in_flight", action: "Wait for Retry-After; do not start another action." },
  { status: 409, code: "idempotency_conflict", action: "Do not reuse a key for a different request." },
  { status: 409, code: "idempotency_in_flight", action: "Wait for Retry-After, then retry with the same key." },
  { status: 409, code: "evidence_required", action: "Attach completion evidence before creating a new completion preview." },
  { status: 409, code: "evidence_conflict", action: "Re-read the task and its evidence before retrying." },
  { status: 409, code: "report_not_pending", action: "Refresh the report; only pending reports can be reviewed." },
  { status: 409, code: "task_completed", action: "Refresh the task and check its completion state." },
  { status: 409, code: "due_date_passed", action: "Refresh the task and check the due date." },
  { status: 410, code: "preview_expired", action: "Create a new preview and get approval again." },
  { status: 413, code: "file_too_large", action: "Send a smaller file." },
  { status: 415, code: "unsupported_file_type", action: "Send a supported file type." },
  { status: 422, code: "invalid_cursor", action: "Restart pagination with the intended filters." },
  { status: 429, code: "rate_limited", action: "Wait for Retry-After." },
  { status: 500, code: "internal_error", action: "Keep request_id for support. Retry writes only with the original key." },
  { status: 503, code: "migration_required", action: "Ask the operator to verify the admin agent API migration." },
] as const;

export const ADMIN_AGENT_API_MCP_TOOLS = [
  { name: "search_people", scope: "people:read", purpose: "Find people in the organization." },
  { name: "get_person", scope: "people:read", purpose: "Read one member's profile and team context." },
  { name: "list_tasks", scope: "tasks:read", purpose: "List or search tasks across members." },
  { name: "get_task", scope: "tasks:read", purpose: "Read one task with subtasks, evidence, and recent activity." },
  { name: "list_eods", scope: "eods:read", purpose: "List submitted end-of-day reports." },
  { name: "get_eod", scope: "eods:read", purpose: "Read a report and its version history." },
  { name: "list_records", scope: "records:read", purpose: "Read organization work records." },
  { name: "get_overview", scope: "insights:read", purpose: "Read the daily administration overview." },
  { name: "get_insights", scope: "insights:read", purpose: "Read deterministic 7-, 30-, or 90-day figures." },
  { name: "preview_action", scope: "Action write scope", purpose: "Describe one consequential action without applying it." },
  { name: "confirm_action", scope: "Action write scope", purpose: "Apply a stored preview only after explicit approval." },
  { name: "log_progress", scope: "tasks:write", purpose: "Append an audited progress note without a preview." },
  { name: "attach_evidence", scope: "tasks:write", purpose: "Attach one base64-encoded completion file without a preview." },
] as const;

export const ADMIN_AGENT_API_MCP_RULE = `Use Streamable HTTP with the administrator bearer token. For preview_action and confirm_action, use the stored action's scope (${actionScopeLabel}). Show the preview and get explicit approval before calling confirm_action.`;
