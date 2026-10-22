import { NextResponse } from "next/server";
import { agentError, agentRouteError, requireAgentAccess } from "@/lib/work-agent-auth";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { addAgentProgress } from "@/lib/work-agent-tasks";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAgentAccess(req, "progress:write");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;
    const body = await req.json().catch(() => null) as Json | null;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return agentError("validation_error", "A JSON body is required", 400);
    }
    const summary = typeof body.summary === "string" ? body.summary.trim() : "";
    if (!summary || summary.length > 2000) {
      return agentError("validation_error", "summary must be 1 to 2000 characters", 400);
    }
    const key = req.headers.get("idempotency-key") ?? "";
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("POST", `/api/agent/v1/tasks/${taskId}/progress`, body),
      handler: async () => ({
        status: 201,
        body: { evidence: await addAgentProgress(auth.agent, taskId, { ...body, summary }, key) },
      }),
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return agentRouteError(error);
  }
}
