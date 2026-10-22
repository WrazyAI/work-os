import { NextResponse } from "next/server";
import { agentError, agentRouteError, hasAgentScope, requireAgentAccess } from "@/lib/work-agent-auth";
import { batchItemTaskId, validateAgentBatch } from "@/lib/work-agent-batch";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { addAgentProgress, completeAgentTask, createAgentTask, updateAgentTask } from "@/lib/work-agent-tasks";
import { WorkOsValidationError } from "@/lib/work-os-api";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One idempotent request, per-item results. A failed item never hides its
 * siblings; a retry never duplicates an applied create or progress note. */
export async function POST(req: Request) {
  try {
    const auth = await requireAgentAccess(req);
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const body = await req.json().catch(() => null) as Json | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return agentError("validation_error", "A JSON body is required", 400);
    }
    const items = validateAgentBatch(body);
    const key = req.headers.get("idempotency-key") ?? "";
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("POST", "/api/agent/v1/batch", body),
      handler: async () => {
        const results: Json[] = [];
        for (const item of items) {
          try {
            const required = item.operation === "log_progress" ? "progress:write" : "tasks:write";
            if (!hasAgentScope(auth.agent.scopes, required)) {
              throw new WorkOsValidationError(`This token is missing the ${required} scope`);
            }
            const derived = `${key}:${item.index}`;
            if (item.operation === "create_task") {
              const task = await createAgentTask(auth.agent, item.payload, derived);
              results.push({ index: item.index, operation: item.operation, status: "applied", id: String((task as Json).id) });
              continue;
            }
            const { taskId, rest } = batchItemTaskId(item.payload);
            if (item.operation === "update_task") {
              const task = await updateAgentTask(auth.agent, taskId, rest);
              results.push({ index: item.index, operation: item.operation, status: "applied", id: String((task as Json).id) });
              continue;
            }
            if (item.operation === "complete_task" || item.operation === "reopen_task") {
              const completed = await completeAgentTask(auth.agent, taskId, item.operation === "complete_task");
              results.push({ index: item.index, operation: item.operation, status: "applied", id: String((completed.task as Json).id ?? taskId) });
              continue;
            }
            const evidence = await addAgentProgress(auth.agent, taskId, rest, derived);
            results.push({ index: item.index, operation: item.operation, status: "applied", id: String((evidence as Json).id) });
          } catch (error) {
            results.push({
              index: item.index,
              operation: item.operation,
              status: "failed",
              error: error instanceof Error ? error.message : "Operation failed",
            });
          }
        }
        const applied = results.filter((entry) => entry.status === "applied").length;
        return { status: 200, body: { results, applied, failed: results.length - applied } };
      },
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return agentRouteError(error);
  }
}
