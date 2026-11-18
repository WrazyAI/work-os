import { NextResponse } from "next/server";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { addPayrollAdjustment } from "@/lib/work-os-payroll-decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, context: { params: Promise<{ reviewId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { reviewId } = await context.params;
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === "include" || body.action === "exclude" || body.action === "reverse" ? body.action : null;
    if (!action || typeof body.findingId !== "string" || typeof body.reason !== "string") {
      return NextResponse.json({ error: "findingId, action and reason are required" }, { status: 400 });
    }
    const span = body.span && typeof body.span === "object" ? body.span as { startMs: number; endMs: number } : null;
    return NextResponse.json(await addPayrollAdjustment(auth.access, reviewId, {
      rowVersion: String(body.rowVersion ?? ""), analysisRevision: Number(body.analysisRevision), sourceHash: String(body.sourceHash ?? ""),
      requestKey: String(body.requestKey ?? ""), findingId: body.findingId, action, span,
      durationMs: Number(body.durationMs ?? 0), priorDecisionId: typeof body.priorDecisionId === "string" ? body.priorDecisionId : null,
      reason: body.reason,
    }));
  } catch (error) { return payrollError(error); }
}
