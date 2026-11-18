import { NextResponse } from "next/server";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { loadPayrollDay } from "@/lib/work-os-payroll-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ reviewId: string; dayId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId, dayId } = await context.params;
    return NextResponse.json(await loadPayrollDay(auth.access, reviewId, dayId));
  } catch (error) { return payrollError(error); }
}
