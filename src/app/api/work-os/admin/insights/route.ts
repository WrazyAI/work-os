import { NextResponse } from "next/server";
import { ADMIN_INSIGHT_RANGES, getAdminInsights, type AdminInsightRange } from "@/lib/work-os-admin-insights";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({
    authorization: req.headers.get("authorization"),
    organizationId: req.headers.get("x-work-os-organization-id"),
    roles: ["manager", "admin"],
  });
  if (auth.response) return auth.response;
  try {
    const params = new URL(req.url).searchParams;
    const rangeParam = params.get("range");
    const range: AdminInsightRange = ADMIN_INSIGHT_RANGES.includes(rangeParam as AdminInsightRange)
      ? (rangeParam as AdminInsightRange)
      : "7d";
    const through = params.get("through");
    const personId = params.get("personId");
    if (personId) {
      const denied = await requireWorkOsPersonAccess(auth.access, personId);
      if (denied) return denied;
    }
    // Managers only ever see the people their teams cover; admins receive the
    // whole organization (null).
    const allowedPersonIds = await accessibleWorkOsPersonIds(auth.access);
    return NextResponse.json(await getAdminInsights(auth.access, range, { through, personId, allowedPersonIds }));
  } catch (error) {
    return jsonError(error);
  }
}
