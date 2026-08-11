import { NextResponse } from "next/server";
import { listWorkOsProposals } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const url = new URL(req.url);
    const personId = auth.access.role === "employee" ? auth.access.personId : url.searchParams.get("personId");
    if (!personId) return NextResponse.json({ error: "personId is required" }, { status: 400 });
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    return NextResponse.json({ proposals: await listWorkOsProposals(auth.access, personId, url.searchParams.get("status")) });
  } catch (error) {
    return jsonError(error);
  }
}
