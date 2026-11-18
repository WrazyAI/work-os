import { NextResponse } from "next/server";
import { payrollCursor, payrollError, payrollLimit, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { listPayrollDays } from "@/lib/work-os-payroll-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const url = new URL(req.url);
    return NextResponse.json(await listPayrollDays(auth.access, reviewId, { cursor: payrollCursor(url), limit: payrollLimit(url) }));
  } catch (error) { return payrollError(error); }
}
