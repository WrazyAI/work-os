import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import {
  createDefaultMemberPasswordResetDeps,
  sendMemberPasswordReset,
} from "@/lib/work-os-member-password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ membershipId: string }> },
) {
  try {
    const auth = await requireWorkOsAccess({
      roles: ["admin"],
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
    });
    if (auth.response) return auth.response;

    const { membershipId } = await context.params;
    const deps = await createDefaultMemberPasswordResetDeps();
    const result = await sendMemberPasswordReset(
      {
        organizationId: auth.access.organizationId,
        actorUserId: auth.access.ctx.user.id,
        membershipId: String(membershipId || ""),
      },
      deps,
    );

    const headers =
      !result.ok && result.status === 429 && result.body.retryAfterSeconds
        ? { "Retry-After": String(result.body.retryAfterSeconds) }
        : undefined;
    return NextResponse.json(result.body, { status: result.status, headers });
  } catch (error) {
    return jsonError(error);
  }
}
