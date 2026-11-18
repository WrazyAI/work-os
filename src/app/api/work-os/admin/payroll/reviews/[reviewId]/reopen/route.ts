import { NextResponse } from "next/server";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { reopenPayrollReview } from "@/lib/work-os-payroll-approvals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    return NextResponse.json(await reopenPayrollReview(auth.access, reviewId, {
      rowVersion: String(body.rowVersion ?? ""), analysisRevision: Number(body.analysisRevision),
      sourceHash: String(body.sourceHash ?? ""), requestKey: String(body.requestKey ?? ""),
      reason: String(body.reason ?? ""),
    }));
  } catch (error) { return payrollError(error); }
}
