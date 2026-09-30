import { NextResponse } from "next/server";
import { ADMIN_INSIGHT_RANGES, getAdminInsights, type AdminInsightRange } from "@/lib/work-os-admin-insights";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

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
    const rangeParam = params.get("range");
    const range: AdminInsightRange = ADMIN_INSIGHT_RANGES.includes(rangeParam as AdminInsightRange)
      ? (rangeParam as AdminInsightRange)
      : "7d";
    const through = params.get("through");
    const personId = params.get("personId");
    return NextResponse.json(await getAdminInsights(auth.access, range, { through, personId }));
  } catch (error) {
    return jsonError(error);
  }
}
