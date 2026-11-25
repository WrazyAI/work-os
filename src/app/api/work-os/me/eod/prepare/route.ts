import { NextResponse } from "next/server";
import { prepareWorkOsEod } from "@/lib/work-os-eod";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Silent preparation for the employee's own day. The scheduled job normally
 * creates this analysis first; this route is the bounded fallback for a fresh
 * deployment, a missed scheduler tick, or a historical day opened from the
 * outstanding list. It never submits a report. */
export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = await req.json().catch(() => ({})) as { date?: unknown };
    const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
      ? body.date
      : new Date().toISOString().slice(0, 10);
    const report = await prepareWorkOsEod(auth.access, auth.access.personId as string, date, "employee");
    return NextResponse.json({ report });
  } catch (error) {
    return jsonError(error);
  }
}
