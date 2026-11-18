import { NextResponse } from "next/server";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { suggestPayrollQuestions } from "@/lib/work-os-payroll-questions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const url = new URL(req.url);
    return NextResponse.json(await suggestPayrollQuestions(auth.access, reviewId, {
      rowVersion: url.searchParams.get("rowVersion") ?? "", analysisRevision: Number(url.searchParams.get("analysisRevision") ?? 0),
      sourceHash: url.searchParams.get("sourceHash") ?? "",
    }));
  } catch (error) { return payrollError(error); }
}
