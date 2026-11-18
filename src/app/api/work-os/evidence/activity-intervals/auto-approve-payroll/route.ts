import { NextResponse } from "next/server";
import { payrollCronAuthorized, settleDuePayrollRecapApprovals } from "@/lib/work-os-payroll-recap-approval";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Service-only payroll recap settlement. No browser/session authority. */
export async function POST(req: Request) {
  if (!payrollCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(200, Math.max(1, Number(body.limit) || 100));
    return NextResponse.json(await settleDuePayrollRecapApprovals({ at: new Date(), limit }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "payroll recap settlement failed" }, { status: 500 });
  }
}
