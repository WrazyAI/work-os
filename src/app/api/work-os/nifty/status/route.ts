import { NextResponse } from "next/server";
import { niftyOrganizationConfigStatus } from "@/lib/integrations/nifty";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
    if (auth.response) return auth.response;
    return NextResponse.json({ status: await niftyOrganizationConfigStatus(auth.access.organizationId), connectUrl: "/api/work-os/nifty/oauth/start" });
  } catch (error) { return jsonError(error); }
}
