import { NextResponse } from "next/server";
import { listAdminActivityIntervals } from "@/lib/work-os-activity-intervals";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    roles: ["manager", "admin"],
  });
  if (auth.response) return auth.response;
  try {
    const params = new URL(req.url).searchParams;
    const personId = params.get("personId");
    if (personId) {
      const denied = await requireWorkOsPersonAccess(auth.access, personId);
      if (denied) return denied;
    }
    const limitParam = Number(params.get("limit"));
    const intervals = await listAdminActivityIntervals(auth.access, {
      from: params.get("from"),
      to: params.get("to"),
      personId,
      limit: Number.isFinite(limitParam) ? limitParam : undefined,
    });
    return NextResponse.json({ intervals });
  } catch (error) {
    return jsonError(error);
  }
}
