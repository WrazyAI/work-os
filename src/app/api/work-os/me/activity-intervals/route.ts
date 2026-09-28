import { NextResponse } from "next/server";
import { listActivityIntervals } from "@/lib/work-os-activity-intervals";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent Activity Interval Reviews for the employee's own Tasks stream,
 * newest interval first, optionally bounded to a date range. */
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
    const date = params.get("date") ?? undefined;
    const days = params.get("days") ? Number(params.get("days")) : undefined;
    const result = await listActivityIntervals(auth.access, { date, days });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
