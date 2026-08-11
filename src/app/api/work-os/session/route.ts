import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
    });
    if (auth.response) return auth.response;
    return NextResponse.json({
      organizationId: auth.access.organizationId,
      role: auth.access.role,
      personId: auth.access.personId,
      userId: auth.access.ctx.user.id,
      featureFlags: auth.access.featureFlags,
    });
  } catch (error) {
    return jsonError(error);
  }
}
