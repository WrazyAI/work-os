import { NextResponse } from "next/server";
import { payrollCursor, payrollError, payrollLimit, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { listPayrollRoster } from "@/lib/work-os-payroll-reads";
import { startPayrollRun } from "@/lib/work-os-payroll-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const url = new URL(req.url);
    const payDate = url.searchParams.get("payDate") ?? "";
    return NextResponse.json(await listPayrollRoster(auth.access, { payDate, cursor: payrollCursor(url), limit: payrollLimit(url), recordsOnly: url.searchParams.get("view") === "records" }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return payrollError(error); }
}

export async function POST(req: Request) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.personId !== "string" || typeof body.payDate !== "string" || typeof body.requestKey !== "string") {
      return NextResponse.json({ error: "personId, payDate and requestKey are required" }, { status: 400 });
    }
    return NextResponse.json(await startPayrollRun(auth.access, { personId: body.personId, payDate: body.payDate, requestKey: body.requestKey }), { status: 202 });
  } catch (error) { return payrollError(error); }
}
