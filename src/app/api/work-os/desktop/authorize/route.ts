import { NextResponse } from "next/server";
import { authorizeDesktop } from "@/lib/work-os-desktop-auth";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { hasExpectedPublicOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    if (!hasExpectedPublicOrigin(req)) {
      return NextResponse.json({ error: "invalid origin" }, { status: 403 });
    }
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid authorization request" }, { status: 400 });
    }
    const organizationId = typeof body.organization_id === "string" ? body.organization_id : null;
    const auth = await requireWorkOsAccess({
      feature: "desktop_companion",
      organizationId,
    });
    if (auth.response) return auth.response;
    if (auth.access.role !== "admin" && !auth.access.personId) {
      return NextResponse.json({ error: "Work OS person mapping required." }, { status: 409 });
    }
    return NextResponse.json(await authorizeDesktop(auth.access, body));
  } catch (error) {
    return jsonError(error);
  }
}
