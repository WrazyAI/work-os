import { NextResponse } from "next/server";
import { reviewWorkOsProposal } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ proposalId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const { proposalId } = await params;
    const body = await req.json();
    body.decision_idempotency_key = req.headers.get("idempotency-key") || body.decision_idempotency_key;
    return NextResponse.json({ proposal: await reviewWorkOsProposal(auth.access, proposalId, body) });
  } catch (error) {
    return jsonError(error);
  }
}
