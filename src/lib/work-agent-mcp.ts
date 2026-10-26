import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  agentRouteError,
  hasAgentScope,
  type AgentAccess,
} from "@/lib/work-agent-auth";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { AgentRateLimitError, assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import type { AgentScope } from "@/lib/work-agent-tokens";
import { addAgentProgress, completeAgentTask, createAgentTask, getAgentTask, listAgentTasks, updateAgentTask } from "@/lib/work-agent-tasks";
import { attachWorkOsTaskCompletionEvidence } from "@/lib/work-os-employee-tasks";
import type { Json } from "@/lib/work-os-internal";
import { WorkOsValidationError } from "@/lib/work-os-api";
import { COMPLETION_EVIDENCE_MAX_BYTES, CompletionEvidenceError } from "@/modules/work-os/completion-evidence";

/** The MCP surface is a thin transport over the live REST services. It adds no
 * second authorization path: the token, scope, person, evidence gate, rate
 * limit, and provenance are the ones Phase A already enforces. */

export const AGENT_MCP_TOOL_NAMES = [
  "list_tasks",
  "get_task",
  "create_task",
  "update_task",
  "complete_task",
  "log_progress",
  "attach_evidence",
] as const;

export type AgentMcpServices = {
  listTasks: (agent: AgentAccess, params: { updatedSince?: string | null; includeArchived?: boolean; limit?: number; cursor?: string | null }) => Promise<{ tasks: Json[]; nextCursor: string | null }>;
  getTask: (agent: AgentAccess, taskId: string) => Promise<Json>;
  createTask: (agent: AgentAccess, body: Json, idempotencyKey: string) => Promise<Json>;
  updateTask: (agent: AgentAccess, taskId: string, body: Json) => Promise<Json>;
  completeTask: (agent: AgentAccess, taskId: string) => Promise<{ task: Json; providerStatus?: string }>;
  addProgress: (agent: AgentAccess, taskId: string, body: Json, idempotencyKey: string) => Promise<Json>;
  attachEvidence: (agent: AgentAccess, taskId: string, input: { fileName: string; contentType: string; bytes: Uint8Array; note: string }, idempotencyKey: string) => Promise<{ evidence: Json }>;
};

const defaultServices: AgentMcpServices = {
  listTasks: listAgentTasks,
  getTask: getAgentTask,
  createTask: createAgentTask,
  updateTask: updateAgentTask,
  completeTask: (agent, taskId) => completeAgentTask(agent, taskId, true),
  addProgress: addAgentProgress,
  attachEvidence: async (agent, taskId, input, idempotencyKey) => {
    const attached = await attachWorkOsTaskCompletionEvidence(agent.access, taskId, {
      ...input,
      idempotencyKey,
    }, { tokenId: agent.tokenId, tokenName: agent.tokenName });
    return { evidence: attached.evidence as unknown as Json };
  },
};

export type AgentMcpIdempotency = typeof withAgentIdempotency;

export function agentMcpIdempotencyKey(tool: string, input: unknown): string {
  return `mcp:${tool}:${agentRequestHash("MCP", tool, input)}`;
}

/** Base64 is the transport for one evidence file. The canonical alphabet check
 * keeps malformed input from being silently decoded to a shorter file. */
export function decodeEvidenceBase64(value: string): Uint8Array {
  // Standard library encoders wrap base64 at 76 columns; whitespace is not
  // payload. Normalize before the alphabet check and bound the encoded length
  // before allocating the decoded buffer.
  const normalized = typeof value === "string" ? value.replace(/\s+/g, "") : "";
  if (!normalized) throw new WorkOsValidationError("content_base64 is required");
  if (normalized.length > 4 * Math.ceil(COMPLETION_EVIDENCE_MAX_BYTES / 3)) {
    throw new CompletionEvidenceError("The evidence file must be 8 MB or smaller");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new WorkOsValidationError("content_base64 must be valid base64");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (!bytes.length) throw new WorkOsValidationError("The evidence file must not be empty");
  if (bytes.length > COMPLETION_EVIDENCE_MAX_BYTES) {
    throw new CompletionEvidenceError("The evidence file must be 8 MB or smaller");
  }
  return new Uint8Array(bytes);
}

export function mcpToolResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

export function mcpToolError(code: string, message: string, extra: Json = {}): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: message, code, ...extra }) }],
  };
}

/** The same codes the REST surface returns, in a tool result. A 5xx-style
 * failure stays a tool error so an MCP client can retry without reconnecting. */
export async function mcpToolErrorFrom(error: unknown): Promise<CallToolResult> {
  if (error instanceof AgentRateLimitError) {
    return mcpToolError("rate_limited", error.message, { retry_after: error.retryAfter });
  }
  // Module identity can differ between an aliased import and a relative one;
  // the class name keeps the code mapping stable across both.
  if (error instanceof CompletionEvidenceError || (error instanceof Error && error.name === "CompletionEvidenceError")) {
    const code = String((error as { code?: unknown }).code ?? "validation_error");
    return mcpToolError(code, error.message);
  }
  const response = agentRouteError(error);
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(await response.json()) }],
  };
}

async function runTool(
  agent: AgentAccess,
  scope: AgentScope,
  write: boolean,
  action: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  if (!hasAgentScope(agent.scopes, scope)) {
    return mcpToolError("insufficient_scope", `This token is missing the ${scope} scope`);
  }
  try {
    assertAgentRateLimit(agent.tokenId, write);
    return await action();
  } catch (error) {
    return mcpToolErrorFrom(error);
  }
}

/** Agent tool input is strict: a typo in an argument is an error, not a
 * silently dropped field. */
function strictShape<T extends Record<string, z.ZodType>>(shape: T) {
  return z.object(shape).strict();
}

export function createAgentMcpServer(agent: AgentAccess, services: AgentMcpServices = defaultServices, idempotency: AgentMcpIdempotency = withAgentIdempotency): McpServer {
  const server = new McpServer({ name: "work-os-agent", version: "1.0.0" });

  server.registerTool("list_tasks", {
    title: "List tasks",
    description: "List the tasks assigned to the token's person. Requires tasks:read. Use updated_since for the change feed and include_archived for tombstones.",
    inputSchema: {
      updated_since: z.string().optional().describe("ISO timestamp; switches to ascending row-change order"),
      include_archived: z.boolean().optional().describe("Include archived and deleted tasks"),
      limit: z.number().int().min(1).max(100).optional(),
      cursor: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "tasks:read", false, async () => {
    if (args.updated_since && Number.isNaN(new Date(args.updated_since).getTime())) {
      throw new WorkOsValidationError("updated_since must be an ISO timestamp");
    }
    const page = await services.listTasks(agent, {
      updatedSince: args.updated_since ?? null,
      includeArchived: args.include_archived === true,
      limit: args.limit,
      cursor: args.cursor ?? null,
    });
    return mcpToolResult({ tasks: page.tasks, cursor: { next: page.nextCursor } });
  }));

  server.registerTool("get_task", {
    title: "Get a task",
    description: "Read one task with its subtasks, completion evidence, and blockers. Requires tasks:read.",
    inputSchema: { task_id: z.string().min(1) },
    annotations: { readOnlyHint: true },
  }, async (args) => runTool(agent, "tasks:read", false, async () => (
    mcpToolResult(await services.getTask(agent, args.task_id))
  )));

  server.registerTool("create_task", {
    title: "Create a task",
    description: "Create a task for the token's person. Requires tasks:write. Identical arguments reuse one idempotency key; pass idempotency_key to control retries explicitly.",
    inputSchema: strictShape({
      name: z.string().min(1).max(240),
      description: z.string().max(20_000).optional(),
      due_date: z.string().optional(),
      start_date: z.string().optional(),
      priority: z.string().optional(),
      labels: z.array(z.string()).optional(),
      expected_outcome: z.string().optional(),
      definition_of_done: z.string().optional(),
      parent_task_id: z.string().optional(),
      project_id: z.string().optional(),
      idempotency_key: z.string().min(1).max(160).optional(),
    }),
  }, async (args) => runTool(agent, "tasks:write", true, async () => {
    const { idempotency_key, ...body } = args;
    const key = idempotency_key ?? agentMcpIdempotencyKey("create_task", body);
    const outcome = await idempotency({
      agent,
      key,
      requestHash: agentRequestHash("MCP", "create_task", body),
      handler: async () => ({ status: 200, body: { task: await services.createTask(agent, body as Json, key) } }),
    });
    return mcpToolResult(outcome.body);
  }));

  server.registerTool("update_task", {
    title: "Update a task",
    description: "Update task content, labels, or blockers. Requires tasks:write. Project and parent moves are not supported.",
    inputSchema: strictShape({
      task_id: z.string().min(1),
      name: z.string().min(1).max(240).optional(),
      description: z.string().max(20_000).optional(),
      due_date: z.string().optional(),
      start_date: z.string().optional(),
      priority: z.string().optional(),
      labels: z.array(z.string()).optional(),
      story_points: z.number().optional(),
      expected_outcome: z.string().optional(),
      definition_of_done: z.string().optional(),
      blocked: z.boolean().optional(),
      blocked_reason: z.string().optional(),
    }),
  }, async (args) => runTool(agent, "tasks:write", true, async () => {
    const { task_id, ...body } = args;
    return mcpToolResult({ task: await services.updateTask(agent, task_id, body as Json) });
  }));

  server.registerTool("complete_task", {
    title: "Complete a task",
    description: "Complete a task. Requires tasks:write. Tasks with an expected outcome or definition of done still need completion evidence.",
    inputSchema: { task_id: z.string().min(1) },
    annotations: { idempotentHint: true },
  }, async (args) => runTool(agent, "tasks:write", true, async () => (
    mcpToolResult(await services.completeTask(agent, args.task_id))
  )));

  server.registerTool("log_progress", {
    title: "Log progress",
    description: "Append a progress note as employee-authored evidence on a task. Requires progress:write. A note is context, never completion proof.",
    inputSchema: strictShape({
      task_id: z.string().min(1),
      summary: z.string().trim().min(1).max(2_000),
      title: z.string().max(240).optional(),
      url: z.string().optional(),
      idempotency_key: z.string().min(1).max(160).optional(),
    }),
  }, async (args) => runTool(agent, "progress:write", true, async () => {
    const { task_id, idempotency_key, ...body } = args;
    const key = idempotency_key ?? agentMcpIdempotencyKey("log_progress", { task_id, ...body });
    const outcome = await idempotency({
      agent,
      key,
      requestHash: agentRequestHash("MCP", "log_progress", { task_id, ...body }),
      handler: async () => ({ status: 200, body: { evidence: await services.addProgress(agent, task_id, body as Json, key) } }),
    });
    const evidence = (outcome.body as { evidence?: Json }).evidence ?? {};
    return mcpToolResult({
      evidence: {
        id: evidence.id,
        title: evidence.title,
        summary: evidence.summary,
        source: evidence.source,
        createdAt: evidence.created_at,
      },
    });
  }));

  server.registerTool("attach_evidence", {
    title: "Attach completion evidence",
    description: "Attach one completion file (base64) to a task. Requires evidence:write. Max 8 MB; images, PDF, Word, text, Markdown, CSV, ZIP, and 7Z. Set complete=true to complete after saving.",
    inputSchema: strictShape({
      task_id: z.string().min(1),
      file_name: z.string().min(1).max(180),
      content_type: z.string().min(1),
      content_base64: z.string().min(1),
      note: z.string().max(1_000).optional(),
      complete: z.boolean().optional(),
      idempotency_key: z.string().min(1).max(160).optional(),
    }),
  }, async (args) => {
    if (args.complete === true && !hasAgentScope(agent.scopes, "tasks:write")) {
      return mcpToolError("insufficient_scope", "Completing a task also requires the tasks:write scope");
    }
    return runTool(agent, "evidence:write", true, async () => {
      const bytes = decodeEvidenceBase64(args.content_base64);
      const { task_id, file_name, content_type, content_base64, note, complete, idempotency_key } = args;
      const key = idempotency_key ?? agentMcpIdempotencyKey("attach_evidence", {
        task_id,
        file_name,
        content_type,
        content_base64,
        note: note ?? "",
      });
      const outcome = await idempotency({
        agent,
        key,
        requestHash: agentRequestHash("MCP", "attach_evidence", {
          task_id,
          file_name,
          content_type,
          content_base64,
          note: note ?? "",
        }),
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
      const attached = outcome.body as { evidence: Json };
      if (!complete) return mcpToolResult({ evidence: attached.evidence, task: null });
      assertAgentRateLimit(agent.tokenId, true);
      try {
        const completed = await services.completeTask(agent, task_id);
        return mcpToolResult({ ...completed, evidence: attached.evidence });
      } catch (error) {
        const message = error instanceof Error ? error.message : "The task could not be marked complete";
        return mcpToolError("internal_error", `Evidence saved. ${message}`, { evidence: attached.evidence });
      }
    });
  });

  return server;
}
