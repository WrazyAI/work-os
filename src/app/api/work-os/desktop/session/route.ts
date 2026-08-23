import { NextResponse } from "next/server";
import { revokeDesktopSession } from "@/lib/work-os-desktop-auth";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
      requirePerson: true,
      feature: "desktop_companion",
    });
    if (auth.response) return auth.response;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error, 401);
  }
}

export async function DELETE(req: Request) {
  try {
    const authorization = req.headers.get("authorization") || "";
    const auth = await requireWorkOsAccess({ authorization });
    if (auth.response) return auth.response;
    return NextResponse.json(await revokeDesktopSession(auth.access, authorization));
  } catch (error) {
    return jsonError(error);
  }
}
