import { NextResponse } from "next/server";
import { getGhlEmailForViewer } from "@/lib/work-os-ghl-email";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
    });
    if (auth.response) return auth.response;
    const { eventId } = await params;
    const email = await getGhlEmailForViewer(auth.access, eventId);
    return NextResponse.json(email, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
