import { NextResponse } from "next/server";
import { latestActivityInterval } from "@/lib/work-os-activity-intervals";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The newest ready recap for launch surfacing and the count of recaps still
 * waiting for review. Owner-scoped and never carries another person's row. */
export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      cadenceMinutes: req.headers.get("x-work-os-cadence-minutes"),
      firstFollowUpMinutes: req.headers.get("x-work-os-first-follow-up-minutes"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    return NextResponse.json(await latestActivityInterval(auth.access), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error);
  }
}
