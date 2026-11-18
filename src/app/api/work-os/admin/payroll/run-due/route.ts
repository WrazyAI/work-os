import { NextResponse } from "next/server";
import { payrollCronAuthorized } from "@/lib/work-os-payroll-recap-approval";
import { advanceDuePayrollRuns } from "@/lib/work-os-payroll-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Service-secret only. A mere admin cookie cannot advance payroll analysis. */
export async function POST(req: Request) {
  if (!payrollCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const limit = Math.min(10, Math.max(1, Number(body.limit) || 2));
    return NextResponse.json(await advanceDuePayrollRuns(new Date(), limit));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "payroll run advance failed" }, { status: 500 }); }
}
