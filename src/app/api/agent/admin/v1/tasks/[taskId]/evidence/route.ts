import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { attachAdminAgentEvidence } from "@/lib/work-admin-agent-evidence";
import { agentRequestHash, withAgentIdempotency } from "@/lib/work-agent-idempotency";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { COMPLETION_EVIDENCE_MAX_BYTES } from "@/modules/work-os/completion-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Attach one completion evidence file to any task in the organization. This is
 * additive and writes directly, exactly like progress: the file appears on the
 * task and satisfies the completion gate, but stays out of personal evidence.
 * The 8 MB multipart body is read here, so the request never enters the proxy's
 * JSON buffering path. */
export async function POST(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:write");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { taskId } = await context.params;

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return adminAgentError("validation_error", "A multipart form body is required", 400);
    }
    const files = form.getAll("file").filter((value): value is File => typeof value !== "string");
    if (files.length !== 1) {
      return adminAgentError("validation_error", "Attach exactly one completion evidence file", 400);
    }
    const file = files[0]!;
    if (file.size <= 0) {
      return adminAgentError("validation_error", "The evidence file must not be empty", 400);
    }
    if (file.size > COMPLETION_EVIDENCE_MAX_BYTES) {
      return adminAgentError("file_too_large", "The evidence file must be 8 MB or smaller", 413);
    }
    const formKey = form.get("idempotency_key");
    const key = ((typeof formKey === "string" ? formKey : "") || req.headers.get("idempotency-key") || "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    const note = form.get("note");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) {
      return adminAgentError("validation_error", "The evidence file could not be read completely", 400);
    }
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const result = await withAgentIdempotency({
      agent: auth.agent,
      key,
      requestHash: agentRequestHash("POST", `/api/agent/admin/v1/tasks/${taskId}/evidence`, {
        note: typeof note === "string" ? note : "",
        fileName: file.name,
        contentType: file.type,
        fileHash,
      }),
      handler: async () => ({
        status: 201,
        body: await attachAdminAgentEvidence(
          auth.agent.access,
          taskId,
          {
            fileName: file.name,
            contentType: file.type,
            bytes,
            note: typeof note === "string" ? note : "",
            idempotencyKey: key,
          },
          { tokenId: auth.agent.tokenId, tokenName: auth.agent.tokenName },
        ),
      }),
    });
    const response = NextResponse.json(result.body, { status: result.status });
    if (result.replayed) response.headers.set("Idempotent-Replay", "true");
    return response;
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
