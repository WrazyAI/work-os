import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { getPersonalInsights, type InsightRange } from "@/lib/work-os-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const params = new URL(req.url).searchParams;
    const range = params.get("range") ?? "day";
    if (!(["day", "7d", "30d"] as string[]).includes(range)) return NextResponse.json({ error: "range must be day, 7d, or 30d" }, { status: 400 });
    return NextResponse.json(await getPersonalInsights(auth.access, range as InsightRange, params.get("through")));
  } catch (error) {
    return jsonError(error);
  }
}
