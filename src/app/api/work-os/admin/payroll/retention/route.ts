import { NextResponse } from "next/server";
import { payrollCronAuthorized } from "@/lib/work-os-payroll-recap-approval";
import { purgeExpiredPayroll } from "@/lib/work-os-payroll-retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Service-only payroll retention. It cannot be invoked by a browser session or
 * a client-supplied organization id. */
export async function POST(req: Request) {
  if (!payrollCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
    return NextResponse.json(await purgeExpiredPayroll({ at: new Date(), limit }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "payroll retention failed" }, { status: 500 });
  }
}
