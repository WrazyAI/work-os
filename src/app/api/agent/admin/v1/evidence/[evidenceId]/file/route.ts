import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { getAdminAgentEvidenceFile } from "@/lib/work-admin-agent-evidence";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import { completionEvidenceDisposition } from "@/modules/work-os/completion-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Download one task evidence file with an admin token. The row is loaded by
 * organization, so another tenant's evidence id answers 404 exactly like a
 * missing one. Storage bytes are served with the stored content type and a
 * safe disposition: containers download, readable media stays inline. */
export async function GET(req: Request, context: { params: Promise<{ evidenceId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "tasks:read");
    if (auth.response) return auth.response;
    assertAgentRateLimit(auth.agent.tokenId, false);
    const { evidenceId } = await context.params;
    const file = await getAdminAgentEvidenceFile(auth.agent.access, evidenceId);
    if (!file) return adminAgentError("not_found", "Evidence not found", 404);
    const disposition = completionEvidenceDisposition(file.contentType);
    const fileName = file.fileName.replaceAll('"', "_");
    const body = file.bytes.buffer.slice(
      file.bytes.byteOffset,
      file.bytes.byteOffset + file.bytes.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.byteLength),
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        ...(file.contentType.startsWith("text/")
          ? { "Content-Security-Policy": "default-src 'none'; sandbox" }
          : {}),
      },
    });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
