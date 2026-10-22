import { NextResponse } from "next/server";
import { revokeAgentToken } from "@/lib/work-agent-tokens";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
}

/** Revocation is immediate and owner-only: a token that does not belong to the
 * caller is indistinguishable from a token that does not exist. */
export async function DELETE(req: Request, context: { params: Promise<{ tokenId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { tokenId } = await context.params;
    const revoked = await revokeAgentToken(auth.access, tokenId);
    if (!revoked) return NextResponse.json({ error: "Token not found" }, { status: 404 });
    return NextResponse.json({ revoked: true });
  } catch (error) {
    return jsonError(error);
  }
}
