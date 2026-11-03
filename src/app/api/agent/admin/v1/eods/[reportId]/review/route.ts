import { NextResponse } from "next/server";
import { createAdminPreview } from "@/lib/work-admin-action-previews";
import { adminPreviewRecord, defaultAdminAgentActionServices, previewAdminAction } from "@/lib/work-admin-agent-actions";
import { adminAgentError, adminAgentRouteError, requireAdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { adminAgentJsonBody } from "@/lib/work-admin-agent-preview-routes";
import { assertAgentRateLimit } from "@/lib/work-agent-rate-limit";
import type { Json } from "@/lib/work-os-internal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Approve or reject a submitted EOD, optionally with a manager note or a
 * manager edit. The preview names the decision, warns about self-review and a
 * non-pending report, and answers `202`; the confirm performs the review. The
 * reviewer person comes from the resolved admin identity, so an unmapped admin
 * token is still held to the self-review rule. */
export async function POST(req: Request, context: { params: Promise<{ reportId: string }> }) {
  try {
    const auth = await requireAdminAgentAccess(req, "eods:review");
    if (auth.response) return auth.response;
    const key = (req.headers.get("idempotency-key") ?? "").trim();
    if (!key) return adminAgentError("validation_error", "Idempotency-Key is required", 400);
    assertAgentRateLimit(auth.agent.tokenId, true);
    const { reportId } = await context.params;
    const body = await adminAgentJsonBody(req, "EOD review payload");
    const payload: Json = { ...body, report_id: reportId };
    const preview = await previewAdminAction(
      auth.agent.access,
      "eod.review",
      payload,
      defaultAdminAgentActionServices,
      { reviewerPersonId: auth.agent.reviewerPersonId },
    );
    const stored = await createAdminPreview(adminPreviewRecord(auth.agent, "eod.review", preview, key));
    return NextResponse.json(stored, { status: 202 });
  } catch (error) {
    return adminAgentRouteError(error);
  }
}
