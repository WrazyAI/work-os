import { NextResponse } from "next/server";
import { payrollCursor, payrollError, payrollLimit, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { listPayrollFindings } from "@/lib/work-os-payroll-reads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const url = new URL(req.url);
    const revision = url.searchParams.get("revision");
    const analysisRevision = revision === null ? undefined : Number(revision);
    if (analysisRevision !== undefined && (!Number.isSafeInteger(analysisRevision) || analysisRevision < 1)) {
      return NextResponse.json({ error: "A valid analysis revision is required." }, { status: 400 });
    }
    return NextResponse.json(await listPayrollFindings(auth.access, reviewId, {
      status: url.searchParams.get("status"), cursor: payrollCursor(url), limit: payrollLimit(url), analysisRevision,
    }));
  } catch (error) { return payrollError(error); }
}
