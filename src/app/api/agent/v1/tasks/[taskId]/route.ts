import { NextResponse } from "next/server";
import { agentError, agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { getAgentTask, updateAgentTask } from "@/lib/work-agent-tasks";
import { archiveWorkOsEmployeeTask, deleteWorkOsEmployeeTask } from "@/lib/work-os-employee-tasks";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { taskId } = await context.params;
    return NextResponse.json(await getAgentTask(auth.agent, taskId));
  } catch (error) {
    return agentRouteError(error);
  }
}

/** Content, assignment, board group, and subtask-parent updates. A project
 * move stays out of the flat patch because a subtask may not change project. */
export async function PATCH(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await req.json().catch(() => null) as Json | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return agentError("validation_error", "A JSON body is required", 400);
    }
    const key = req.headers.get("idempotency-key") ?? "";
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("PATCH", `/api/agent/v1/tasks/${taskId}`, body),
      handler: async () => ({ status: 200, body: { task: await updateAgentTask(auth.agent, taskId, body) } }),
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return agentRouteError(error);
  }
}

/** Remove a task. `mode=archive` (the default) keeps it recoverable; `delete`
 * tombstones it. Both use the employee record's own semantics, so a task still
 * visible in the archive can also be removed. */
export async function DELETE(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const mode = new URL(req.url).searchParams.get("mode") ?? "archive";
    if (mode !== "archive" && mode !== "delete") {
      return agentError("validation_error", "mode must be archive or delete", 400);
    }
    // Removal is a write, so a retried request replays instead of answering
    // 404 for a task its own first attempt already removed.
    const key = req.headers.get("idempotency-key") ?? "";
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("DELETE", `/api/agent/v1/tasks/${taskId}`, { taskId, mode }),
      handler: async () => ({
        status: 200,
        body: mode === "delete"
          ? await deleteWorkOsEmployeeTask(auth.agent.access, taskId)
          : await archiveWorkOsEmployeeTask(auth.agent.access, taskId),
      }),
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return agentRouteError(error);
  }
}
