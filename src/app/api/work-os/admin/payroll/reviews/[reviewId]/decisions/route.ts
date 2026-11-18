import { NextResponse } from "next/server";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { resolvePayrollFindings } from "@/lib/work-os-payroll-decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const findingIds = Array.isArray(body.findingIds) ? body.findingIds.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
    const action = body.action === "payable" || body.action === "excluded" || body.action === "acknowledged" ? body.action : null;
    if (!action) return NextResponse.json({ error: "action must be payable, excluded or acknowledged" }, { status: 400 });
    return NextResponse.json(await resolvePayrollFindings(auth.access, reviewId, {
      rowVersion: String(body.rowVersion ?? ""), analysisRevision: Number(body.analysisRevision),
      sourceHash: String(body.sourceHash ?? ""), requestKey: String(body.requestKey ?? ""),
      findingIds, action, note: String(body.note ?? ""),
    }));
  } catch (error) { return payrollError(error); }
}
