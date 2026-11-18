import { NextResponse } from "next/server";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { loadPayrollReview } from "@/lib/work-os-payroll-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    return NextResponse.json(await loadPayrollReview(auth.access, reviewId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return payrollError(error); }
}
