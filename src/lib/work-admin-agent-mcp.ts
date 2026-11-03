import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  adminAgentRouteError,
  hasAdminAgentScope,
  type AdminAgentAccess,
} from "@/lib/work-admin-agent-auth";
import {
  adminPreviewRecord,
  applyAdminAction,
  defaultAdminAgentActionServices,
  previewAdminAction,
  readAdminPreviewTargetState,
  type AdminAgentActionServices,
} from "@/lib/work-admin-agent-actions";
import { adminPreviewActionScope } from "@/lib/work-admin-agent-preview-routes";
import {
  ADMIN_PREVIEW_TTL_MS,
  confirmAdminPreview,
  createAdminPreview,
  getAdminPreviewRecord,
  WorkAdminPreviewError,
} from "@/lib/work-admin-action-previews";
import {
  getAdminAgentPerson,
  listAdminAgentPeople,
  parseAdminAgentPeopleFilters,
} from "@/lib/work-admin-agent-directory";
import {
  getAdminAgentTask,
  getAdminAgentTaskActivity,
  listAdminAgentTasks,
  parseAdminAgentTaskFilters,
} from "@/lib/work-admin-agent-tasks";
import {
  getAdminAgentEod,
  listAdminAgentEods,
  parseAdminAgentEodFilters,
} from "@/lib/work-admin-agent-eods";
import {
  listAdminAgentRecords,
  parseAdminAgentRecordFilters,
} from "@/lib/work-admin-agent-records";
import {
  getAdminAgentInsights,
  getAdminAgentOverview,
  parseAdminAgentInsightRange,
} from "@/lib/work-admin-agent-insights";
import { addAdminAgentProgress, attachAdminAgentEvidence } from "@/lib/work-admin-agent-evidence";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { AgentRateLimitError, assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import type { AdminAgentScope } from "@/lib/work-agent-tokens";
import { decodeEvidenceBase64, mcpToolError, mcpToolResult } from "@/lib/work-agent-mcp";
import type { Json } from "@/lib/work-os-internal";
import { WorkOsValidationError } from "@/lib/work-os-api";
import { CompletionEvidenceError } from "@/modules/work-os/completion-evidence";
import type { AdminPreviewAction } from "@/modules/work-os/admin-agent/contracts";

/** The admin MCP surface is a second transport over the admin REST services.
 * It adds no authorization path of its own: the token kind, the admin role,
 * the feature flags, the scope set, the write scope of each action, the rate
 * limit, the preview store, and the audit trail are the ones the HTTP routes
 * already enforce. The employee server stays at exactly seven tools; this
 * server is separate and has thirteen. */

export const ADMIN_AGENT_MCP_TOOL_NAMES = [
  "search_people",
  "get_person",
  "list_tasks",
  "get_task",
  "list_eods",
  "get_eod",
  "list_records",
  "get_overview",
  "get_insights",
  "preview_action",
  "confirm_action",
  "log_progress",
  "attach_evidence",
] as const;

export type AdminAgentMcpServices = {
  searchPeople: (agent: AdminAgentAccess, input: { query?: string; active?: boolean; teamId?: string; role?: string; limit?: number; cursor?: string }) => Promise<Json>;
  getPerson: (agent: AdminAgentAccess, personId: string) => Promise<Json | null>;
  listTasks: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getTask: (agent: AdminAgentAccess, taskId: string) => Promise<Json>;
  listEods: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getEod: (agent: AdminAgentAccess, reportId: string) => Promise<Json | null>;
  listRecords: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getOverview: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  getInsights: (agent: AdminAgentAccess, input: Json) => Promise<Json>;
  previewAction: (agent: AdminAgentAccess, action: AdminPreviewAction, payload: Json, idempotencyKey?: string) => Promise<Json>;
  confirmAction: (agent: AdminAgentAccess, previewId: string, idempotencyKey: string) => Promise<Json>;
  logProgress: (agent: AdminAgentAccess, taskId: string, body: Json, idempotencyKey: string) => Promise<Json>;
  attachEvidence: (agent: AdminAgentAccess, taskId: string, input: { fileName: string; contentType: string; bytes: Uint8Array; note: string }, idempotencyKey: string) => Promise<Json>;
};

export type AdminAgentMcpIdempotency = typeof withAgentIdempotency;

const PREVIEW_ID_MAX = 120;
const EVIDENCE_NOTE_MAX = 1_000;
const PROGRESS_SUMMARY_MAX = 2_000;
const ACTIVITY_ITEM_LIMIT = 20;

/** A preview is a write intent, so an identical retry must replay the stored
 * card instead of minting a second one. The key is bucketed by the preview TTL:
 * a retry inside the current window replays the stored card, while an attempt
 * after the window mints a fresh one. Without the bucket, an expired row would
 * replay forever and that action could never be previewed again — every later
 * confirm would answer `preview_expired` with no way out. */
export function adminPreviewIdempotencyKey(
  action: AdminPreviewAction,
  payload: Json,
  now: number = Date.now(),
): string {
  const bucket = Math.floor(now / ADMIN_PREVIEW_TTL_MS);
  return `mcp:preview:${agentRequestHash("MCP", "preview_action", { action, payload })}:${bucket}`;
}

/** The preview id is already the canonical one-time confirm key; the default
 * idempotency key only exists so every confirm carries the `Idempotency-Key`
 * contract the HTTP surface requires. */
export function adminConfirmIdempotencyKey(previewId: string): string {
  return `mcp:confirm:${previewId}`;
}

export function adminMcpIdempotencyKey(tool: string, input: unknown): string {
  return `mcp:${tool}:${agentRequestHash("MCP", tool, input)}`;
}

/** A confirm's required scope depends on the action stored in its preview, so
 * the tool cannot decide it before the row is read. The default service raises
 * this once it knows the action; the tool mapper turns it into the same
 * `insufficient_scope` tool error every other scope refusal produces. */
class AdminMcpScopeError extends Error {
  readonly code = "insufficient_scope";
  readonly status = 403;

  constructor(scope: AdminAgentScope) {
    super(`This token is missing the ${scope} scope`);
    this.name = "AdminMcpScopeError";
  }
}

function isNamed(error: unknown, name: string): error is Error {
  // Module identity can differ between an aliased import and a relative one;
  // the class name keeps the mapping stable across both.
  return error instanceof Error && error.name === name;
}

/** The admin route contract, in a tool result. Scope and rate-limit refusals
 * stay tool errors so a client can correct the call without reconnecting. */
export async function adminMcpToolErrorFrom(error: unknown): Promise<CallToolResult> {
  if (error instanceof AgentRateLimitError || isNamed(error, "AgentRateLimitError")) {
    const retryAfter = (error as { retryAfter?: unknown }).retryAfter;
    return mcpToolError("rate_limited", error.message, { retry_after: retryAfter ?? 1 });
  }
  if (error instanceof AdminMcpScopeError || isNamed(error, "AdminMcpScopeError")) {
    const code = String((error as { code?: unknown }).code ?? "insufficient_scope");
    return mcpToolError(code, error.message);
  }
  if (error instanceof CompletionEvidenceError || isNamed(error, "CompletionEvidenceError")) {
    const code = String((error as { code?: unknown }).code ?? "validation_error");
    return mcpToolError(code, error.message);
  }
  const response = adminAgentRouteError(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(await response.json()) }],
  };
}

/** The admin rate-limit buckets are the same read/write budgets the HTTP
 * routes spend. A stolen or runaway token cannot use MCP to bypass them. */
async function runTool(
  agent: AdminAgentAccess,
  scope: AdminAgentScope | null,
  write: boolean,
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  if (scope && !hasAdminAgentScope(agent.scopes, scope)) {
    return mcpToolError("insufficient_scope", `This token is missing the ${scope} scope`);
  }
  try {
    assertAgentRateLimit(agent.tokenId, write);
    return await action();
  } catch (error) {
    return adminMcpToolErrorFrom(error);
  }
}

/** Admin tool input is strict: a typo in an argument is an error, not a
 * silently dropped field. */
function strictShape<T extends Record<string, z.ZodType>>(shape: T) {
  return z.object(shape).strict();
}

const TASK_CREATE_PAYLOAD = z.object({
  name: z.string().trim().min(1).max(240),
  description: z.string().max(20_000).optional(),
  due_date: z.string().optional(),
  start_date: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string()).optional(),
  story_points: z.number().optional(),
  expected_outcome: z.string().optional(),
  definition_of_done: z.string().optional(),
  estimated_effort_minutes: z.number().int().min(0).optional(),
  effort_unit: z.string().optional(),
  task_group_id: z.string().optional(),
  parent_task_id: z.string().optional(),
  project_id: z.string().optional(),
  assignee_person_ids: z.array(z.string().min(1)).max(50).optional(),
}).strict();

/** Content edits plus blockers and assignment. Parent changes are `task.move`
 * and lifecycle changes are their own actions, so this payload can never
 * smuggle one in — the same split the admin REST surface enforces. */
const TASK_UPDATE_PAYLOAD = z.object({
  task_id: z.string().min(1),
  name: z.string().trim().min(1).max(240).optional(),
  description: z.string().max(20_000).optional(),
  due_date: z.string().optional(),
  start_date: z.string().optional(),
  priority: z.string().optional(),
  labels: z.array(z.string()).optional(),
  story_points: z.number().optional(),
  expected_outcome: z.string().optional(),
  definition_of_done: z.string().optional(),
  estimated_effort_minutes: z.number().int().min(0).optional(),
  effort_unit: z.string().optional(),
  task_group_id: z.string().optional(),
  assignee_person_ids: z.array(z.string().min(1)).max(50).optional(),
  blocked: z.boolean().optional(),
  blocked_reason: z.string().max(240).optional(),
}).strict();

const TASK_ID_PAYLOAD = z.object({ task_id: z.string().min(1) }).strict();

const ASSIGN_PAYLOAD = z.object({
  task_id: z.string().min(1),
  mode: z.enum(["add", "remove", "replace"]),
  person_ids: z.array(z.string().min(1)).max(50),
}).strict();

const MOVE_PAYLOAD = z.object({
  task_id: z.string().min(1),
  parent_task_id: z.string().min(1),
}).strict();

const EOD_REVIEW_PAYLOAD = z.object({
  report_id: z.string().min(1),
  status: z.enum(["approved", "rejected"]),
  manager_notes: z.string().max(20_000).optional(),
  markdown: z.string().max(20_000).optional(),
}).strict();

/** The nine documented actions, discriminated by name so a payload that
 * belongs to another action is a validation error rather than a surprise. */
const ADMIN_PREVIEW_ACTION_SCHEMA = z.discriminatedUnion("action", [
  z.object({ action: z.literal("task.create"), payload: TASK_CREATE_PAYLOAD }).strict(),
  z.object({ action: z.literal("task.update"), payload: TASK_UPDATE_PAYLOAD }).strict(),
  z.object({ action: z.literal("task.assign"), payload: ASSIGN_PAYLOAD }).strict(),
  z.object({ action: z.literal("task.move"), payload: MOVE_PAYLOAD }).strict(),
  z.object({ action: z.literal("task.complete"), payload: TASK_ID_PAYLOAD }).strict(),
  z.object({ action: z.literal("task.reopen"), payload: TASK_ID_PAYLOAD }).strict(),
  z.object({ action: z.literal("task.archive"), payload: TASK_ID_PAYLOAD }).strict(),
  z.object({ action: z.literal("task.delete"), payload: TASK_ID_PAYLOAD }).strict(),
  z.object({ action: z.literal("eod.review"), payload: EOD_REVIEW_PAYLOAD }).strict(),
]);

/** The advertised shape stays a plain object so a client can see the action
 * enum and the payload slot; the union above is applied on the same value
 * before the service runs, so an unknown field or a mismatched payload is
 * still refused with the field name. `idempotency_key` is optional: the
 * server derives a TTL-bucketed key when it is absent. */
const PREVIEW_INPUT_SHAPE = strictShape({
  action: z.enum([
    "task.create",
    "task.update",
    "task.assign",
    "task.move",
    "task.complete",
    "task.reopen",
    "task.archive",
    "task.delete",
    "eod.review",
  ]).describe("The consequential action to describe"),
  payload: z.record(z.string(), z.unknown()).describe("The action's own input, validated per action"),
  idempotency_key: z.string().min(1).max(160).optional()
    .describe("Optional explicit creation key; omit to let the server derive one per TTL window"),
});

/** Optional tool arguments reach the service as a clean object: an omitted
 * key is absent, not present with `undefined`. */
function defined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as T;
}

/** The REST readers parse a query contract; the MCP tools speak the same
 * snake_case names, so one small coercion keeps both surfaces on one parser
 * (including the "omitted = whole organization, empty = no rows" rule). */
function filterParams(input: Json): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    const name = key === "query" ? "q" : key;
    if (Array.isArray(value)) {
      params.set(name, value.map((item) => String(item)).join(","));
    } else if (typeof value === "boolean") {
      params.set(name, value ? "true" : "false");
    } else {
      params.set(name, String(value));
    }
  }
  return params;
}

function previewValidationError(error: z.ZodError): WorkOsValidationError {
  const issue = error.issues[0];
  if (!issue) return new WorkOsValidationError("The preview payload is invalid");
  const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
  return new WorkOsValidationError(`The preview payload is invalid — ${path}${issue.message}`);
}

/** The dependencies a test replaces to exercise the real action layer and the
 * real key derivation without Postgres. Production passes nothing, so every
 * seam below resolves to the shipped function. */
export type AdminAgentMcpDefaultDeps = {
  /** The action layer's read/write services. A spy here observes the only
   * services an apply can reach. */
  actions?: AdminAgentActionServices;
  /** `applyAdminAction` is the single writer a confirm reaches. Injecting it
   * lets a test prove `preview_action` never calls it. */
  applyAction?: typeof applyAdminAction;
  previews?: {
    create?: typeof createAdminPreview;
    record?: typeof getAdminPreviewRecord;
    confirm?: typeof confirmAdminPreview;
  };
};

/** The production wiring. Reads call the same admin readers (and therefore the
 * same validation) as `GET /api/agent/admin/v1/*`; writes call the same
 * additive services and the same preview store. */
export function createAdminAgentMcpServices(
  deps: AdminAgentMcpDefaultDeps = {},
): AdminAgentMcpServices {
  const actions = deps.actions ?? defaultAdminAgentActionServices;
  const applyAction = deps.applyAction ?? applyAdminAction;
  const createPreview = deps.previews?.create ?? createAdminPreview;
  const readPreviewRecord = deps.previews?.record ?? getAdminPreviewRecord;
  const confirmPreview = deps.previews?.confirm ?? confirmAdminPreview;

  return {
    searchPeople: async (agent, input) => {
      // The directory parser owns the defaults (active, limit) and the
      // team/role validation, so MCP cannot drift from the REST read.
      const params = new URLSearchParams();
      if (input.query) params.set("q", input.query);
      if (input.active !== undefined) params.set("active", input.active ? "true" : "false");
      if (input.teamId) params.set("team_id", input.teamId);
      if (input.role) params.set("role", input.role);
      if (input.limit !== undefined) params.set("limit", String(input.limit));
      if (input.cursor) params.set("cursor", input.cursor);
      const page = await listAdminAgentPeople(agent.access, parseAdminAgentPeopleFilters(params));
      return { people: page.people, total: page.total, cursor: { next: page.nextCursor } } as unknown as Json;
    },
    getPerson: async (agent, personId) => {
      const person = await getAdminAgentPerson(agent.access, personId);
      return person ? { person } as unknown as Json : null;
    },
    listTasks: async (agent, input) => {
      const filters = parseAdminAgentTaskFilters(filterParams(input));
      const page = await listAdminAgentTasks(agent.access, filters);
      return { tasks: page.tasks, total: page.total, cursor: { next: page.nextCursor } };
    },
    getTask: async (agent, taskId) => {
      const detail = await getAdminAgentTask(agent.access, taskId);
      // The design promises the timeline with the detail; the activity reader
      // already scopes to this organization and honours archived rows.
      const activity = await getAdminAgentTaskActivity(agent.access, taskId, { limit: ACTIVITY_ITEM_LIMIT });
      return {
        ...(detail as unknown as Json),
        activity: { items: activity.items as unknown as Json, cursor: { next: activity.nextCursor } },
      };
    },
    listEods: async (agent, input) => {
      const filters = parseAdminAgentEodFilters(filterParams(input));
      const page = await listAdminAgentEods(agent.access, filters);
      return { eods: page.eods, counts: page.counts, total: page.total, cursor: { next: page.nextCursor } } as unknown as Json;
    },
    getEod: async (agent, reportId) => {
      const found = await getAdminAgentEod(agent.access, reportId);
      return found ? { eod: found.eod, versions: found.versions } as unknown as Json : null;
    },
    listRecords: async (agent, input) => {
      const filters = parseAdminAgentRecordFilters(filterParams(input));
      const page = await listAdminAgentRecords(agent.access, filters);
      return {
        records: page.records as unknown as Json,
        total: page.total,
        cursor: { next: page.nextCursor },
        coverage: page.coverage,
      };
    },
    getOverview: async (agent, input) => {
      const date = typeof input.date === "string" && input.date.trim() ? input.date.trim() : undefined;
      return getAdminAgentOverview(agent.access, date) as unknown as Json;
    },
    getInsights: async (agent, input) => {
      const range = parseAdminAgentInsightRange(typeof input.range === "string" ? input.range : null);
      const insights = await getAdminAgentInsights(agent.access, range, {
        personId: typeof input.person_id === "string" ? input.person_id : null,
        through: typeof input.through === "string" ? input.through : null,
      });
      return insights as unknown as Json;
    },
    previewAction: async (agent, action, payload, idempotencyKey) => {
      // Describing an action never calls `applyAdminAction`: the `run` closure
      // the plan builds is unreachable from here.
      const preview = await previewAdminAction(
        agent.access,
        action,
        payload,
        actions,
        { reviewerPersonId: agent.reviewerPersonId },
      );
      const stored = await createPreview(
        adminPreviewRecord(
          agent,
          action,
          preview,
          idempotencyKey ?? adminPreviewIdempotencyKey(action, payload),
        ),
      );
      return stored as unknown as Json;
    },
    confirmAction: async (agent, previewId, idempotencyKey) => {
      const record = await readPreviewRecord(agent.access, previewId, agent.tokenId);
      if (!record) throw new WorkAdminPreviewError("preview_not_found");
      const required = adminPreviewActionScope(record.action);
      // An action this surface no longer recognizes cannot be confirmed.
      if (!required) throw new WorkAdminPreviewError("preview_not_found");
      if (!hasAdminAgentScope(agent.scopes, required)) throw new AdminMcpScopeError(required);

      let currentState: Json | undefined;
      const result = await confirmPreview(
        agent.access,
        previewId,
        idempotencyKey,
        {
          readState: async () => {
            currentState = await readAdminPreviewTargetState(agent.access, record, actions);
            return currentState;
          },
          apply: async () => applyAction(
            agent.access,
            record.action,
            record.request,
            actions,
            {
              tokenId: agent.tokenId,
              tokenName: agent.tokenName,
              previewId: record.preview.id,
              reviewerPersonId: agent.reviewerPersonId,
            },
            currentState,
          ),
        },
        agent.tokenId,
      );
      return { status: result.status, replayed: result.replayed, result: result.body };
    },
    logProgress: (agent, taskId, body, idempotencyKey) => addAdminAgentProgress(
      agent.access,
      taskId,
      body,
      idempotencyKey,
      { tokenId: agent.tokenId, tokenName: agent.tokenName },
    ),
    attachEvidence: (agent, taskId, input, idempotencyKey) => attachAdminAgentEvidence(
      agent.access,
      taskId,
      { ...input, idempotencyKey },
      { tokenId: agent.tokenId, tokenName: agent.tokenName },
    ),
  };
}

const defaultServices = createAdminAgentMcpServices();

export function createAdminAgentMcpServer(
  agent: AdminAgentAccess,
  services: AdminAgentMcpServices = defaultServices,
  idempotency: AdminAgentMcpIdempotency = withAgentIdempotency,
): McpServer {
  const server = new McpServer({ name: "work-os-admin-agent", version: "1.0.0" });

  server.registerTool("search_people", {
    title: "Search the organization directory",
    description: "Search people by name or email across the organization. Requires people:read. Active is the default; pass active=false for former members. Use team_id and role to narrow the list.",
    inputSchema: strictShape({
      query: z.string().max(200).optional().describe("Name or email fragment"),
      active: z.boolean().optional().describe("Filter by active membership; defaults to true"),
      team_id: z.string().optional(),
      role: z.string().optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "people:read", false, async () => (
    mcpToolResult(await services.searchPeople(agent, defined({
      query: args.query,
      active: args.active,
      teamId: args.team_id,
      role: args.role,
      limit: args.limit,
      cursor: args.cursor,
    })))
  )));

  server.registerTool("get_person", {
    title: "Get a person",
    description: "Read one person's profile, schedule timezone, role, manager, and teams. Requires people:read.",
    inputSchema: strictShape({ person_id: z.string().min(1) }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "people:read", false, async () => {
    const person = await services.getPerson(agent, args.person_id);
    if (!person) return mcpToolError("not_found", "Person not found");
    return mcpToolResult(person);
  }));

  server.registerTool("list_tasks", {
    title: "List organization tasks",
    description: "Cross-person task list with a text query and filters. Requires tasks:read. An omitted person_ids reads the whole organization; an empty list asks for no rows. Status defaults to active; updated_since switches to the ascending change feed.",
    inputSchema: strictShape({
      person_ids: z.array(z.string().min(1)).max(20).optional(),
      query: z.string().max(200).optional(),
      completed: z.boolean().optional(),
      overdue: z.boolean().optional(),
      status: z.enum(["active", "archived", "deleted"]).optional(),
      project_id: z.string().optional(),
      due_from: z.string().optional(),
      due_to: z.string().optional(),
      updated_since: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "tasks:read", false, async () => (
    mcpToolResult(await services.listTasks(agent, args as Json))
  )));

  server.registerTool("get_task", {
    title: "Get a task",
    description: "Read one task with its subtasks, completion evidence, and recent activity. Requires tasks:read. Archived work stays readable.",
    inputSchema: strictShape({ task_id: z.string().min(1) }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "tasks:read", false, async () => (
    mcpToolResult(await services.getTask(agent, args.task_id))
  )));

  server.registerTool("list_eods", {
    title: "List EOD reports",
    description: "Cross-person end-of-day reports with person, date, status, and text filters. Requires eods:read. An omitted person_ids reads the whole organization; an empty list asks for no rows.",
    inputSchema: strictShape({
      person_ids: z.array(z.string().min(1)).max(20).optional(),
      status: z.enum(["pending_review", "approved", "rejected"]).optional(),
      from: z.string().optional().describe("Inclusive calendar date (YYYY-MM-DD)"),
      to: z.string().optional().describe("Inclusive calendar date (YYYY-MM-DD)"),
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "eods:read", false, async () => (
    mcpToolResult(await services.listEods(agent, args as Json))
  )));

  server.registerTool("get_eod", {
    title: "Get an EOD report",
    description: "Read one end-of-day report with its version history. Requires eods:read. Deciding a report is eod.review through preview_action, which also needs eods:review.",
    inputSchema: strictShape({ report_id: z.string().min(1) }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "eods:read", false, async () => {
    const report = await services.getEod(agent, args.report_id);
    if (!report) return mcpToolError("not_found", "EOD report not found");
    return mcpToolResult(report);
  }));

  server.registerTool("list_records", {
    title: "List organization records",
    description: "Authored updates, submitted EODs, task events, reviewed recaps, and workday snapshots across the organization. Requires records:read. An omitted person_ids reads the whole organization; an empty list asks for no rows.",
    inputSchema: strictShape({
      person_ids: z.array(z.string().min(1)).max(20).optional(),
      sources: z.array(z.enum(["update", "submitted_eod", "task", "reviewed_recap", "workday"])).min(1).max(5).optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      query: z.string().max(200).optional(),
      cursor: z.string().optional(),
    }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "records:read", false, async () => (
    mcpToolResult(await services.listRecords(agent, args as Json))
  )));

  server.registerTool("get_overview", {
    title: "Get the administration overview",
    description: "Organization counts, the decision queue, outstanding EODs, and overdue work for one local day. Requires insights:read.",
    inputSchema: strictShape({ date: z.string().optional().describe("Calendar date (YYYY-MM-DD); today when omitted") }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "insights:read", false, async () => (
    mcpToolResult(await services.getOverview(agent, args as Json))
  )));

  server.registerTool("get_insights", {
    title: "Get deterministic insights",
    description: "Factual 7, 30, or 90-day figures for the organization, optionally for one active member. Requires insights:read.",
    inputSchema: strictShape({
      range: z.enum(["7d", "30d", "90d"]).optional().describe("Defaults to 7d"),
      person_id: z.string().optional(),
      through: z.string().optional().describe("Inclusive end date (YYYY-MM-DD)"),
    }),
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "insights:read", false, async () => (
    mcpToolResult(await services.getInsights(agent, args as Json))
  )));

  server.registerTool("preview_action", {
    title: "Preview a consequential admin action",
    description: "Describe and store one consequential action without executing it. Requires the write scope of that action (tasks:write, or eods:review for eod.review). Show the returned summary, changes, and warnings to the user; call confirm_action only after they agree. This never changes anything.",
    inputSchema: PREVIEW_INPUT_SHAPE,
  }, async (args) => {
    const required = adminPreviewActionScope(args.action);
    // A recognized action always has a scope; the null branch fails closed if
    // the action list and the scope map ever drift.
    if (!required) {
      return mcpToolError("insufficient_scope", "This action is not available on this token");
    }
    return runTool(agent, required, true, async () => {
      // The union validates the action and its payload only; the envelope's
      // optional idempotency_key is not part of any action's payload.
      const parsed = ADMIN_PREVIEW_ACTION_SCHEMA.safeParse({
        action: args.action,
        payload: args.payload,
      });
      if (!parsed.success) throw previewValidationError(parsed.error);
      return mcpToolResult(await services.previewAction(
        agent,
        parsed.data.action,
        parsed.data.payload as Json,
        args.idempotency_key,
      ));
    });
  });

  server.registerTool("confirm_action", {
    title: "Confirm a stored admin preview",
    description: "Execute an unexpired preview exactly once and return the applied result. Requires the write scope of the preview's action. Only call this after the user saw and approved the preview; the preview id is the one-time replay key.",
    inputSchema: strictShape({
      preview_id: z.string().min(1).max(PREVIEW_ID_MAX),
      idempotency_key: z.string().min(1).max(160).optional(),
    }),
    annotations: { idempotentHint: true },
  }, async (args) => (
    // The action stored in the preview decides the scope; the service reads the
    // row and refuses with the same `insufficient_scope` code.
    runTool(agent, null, true, async () => (
      mcpToolResult(await services.confirmAction(
        agent,
        args.preview_id,
        args.idempotency_key ?? adminConfirmIdempotencyKey(args.preview_id),
      ))
    ))
  ));

  server.registerTool("log_progress", {
    title: "Log progress on a task",
    description: "Append a progress note to any task in the organization. Requires tasks:write. This is an additive, audited write, not a completion proof, so it needs no preview.",
    inputSchema: strictShape({
      task_id: z.string().min(1),
      summary: z.string().trim().min(1).max(PROGRESS_SUMMARY_MAX),
      title: z.string().max(240).optional(),
      idempotency_key: z.string().min(1).max(160).optional(),
    }),
  }, async (args) => runTool(agent, "tasks:write", true, async () => {
    const { task_id, idempotency_key, ...body } = args;
    const key = idempotency_key ?? adminMcpIdempotencyKey("log_progress", { task_id, ...body });
    const outcome = await idempotency({
      agent,
      key,
      requestHash: agentRequestHash("MCP", "log_progress", { task_id, ...body }),
      handler: async () => ({
        status: 201,
        body: { evidence: await services.logProgress(agent, task_id, body as Json, key) },
      }),
    });
    const evidence = (outcome.body as { evidence?: Json }).evidence ?? {};
    return mcpToolResult({ evidence });
  }));

  server.registerTool("attach_evidence", {
    title: "Attach completion evidence",
    description: "Attach one completion file (base64) to any task in the organization. Requires tasks:write. Max 8 MB; images, PDF, Word, text, Markdown, CSV, ZIP, and 7Z. This is an additive, audited write; completing the task still needs a preview.",
    inputSchema: strictShape({
      task_id: z.string().min(1),
      file_name: z.string().min(1).max(180),
      content_type: z.string().min(1),
      content_base64: z.string().min(1),
      note: z.string().max(EVIDENCE_NOTE_MAX).optional(),
      idempotency_key: z.string().min(1).max(160).optional(),
    }),
    annotations: { idempotentHint: true },
  }, async (args) => runTool(agent, "tasks:write", true, async () => {
    // Decode and bound before the service sees a byte: a malformed or oversize
    // payload never reaches storage.
    const bytes = decodeEvidenceBase64(args.content_base64);
    const { task_id, file_name, content_type, content_base64, note, idempotency_key } = args;
    const request = {
      task_id,
      file_name,
      content_type,
      content_base64,
      note: note ?? "",
    };
    const key = idempotency_key ?? adminMcpIdempotencyKey("attach_evidence", request);
    const outcome = await idempotency({
      agent,
      key,
      requestHash: agentRequestHash("MCP", "attach_evidence", request),
      handler: async () => ({
        status: 201,
        body: await services.attachEvidence(agent, task_id, {
          fileName: file_name,
          contentType: content_type,
          bytes,
          note: note ?? "",
        }, key),
      }),
    });
    return mcpToolResult(outcome.body);
  }));

  return server;
}
