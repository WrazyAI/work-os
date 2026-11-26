import { after, NextResponse } from "next/server";
import { payrollCursor, payrollError, payrollLimit, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { listPayrollRoster } from "@/lib/work-os-payroll-reads";
import { drainPayrollRun, payrollRunDeps, startPayrollRun } from "@/lib/work-os-payroll-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

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
    const windowed = typeof body.from === "string" && typeof body.through === "string";
    if (typeof body.personId !== "string" || typeof body.requestKey !== "string"
      || (!windowed && typeof body.payDate !== "string")) {
      return NextResponse.json({ error: "personId, requestKey, and either payDate or from/through are required" }, { status: 400 });
    }
    const run = await startPayrollRun(auth.access, {
      personId: body.personId,
      payDate: typeof body.payDate === "string" ? body.payDate : undefined,
      from: windowed ? String(body.from) : undefined,
      through: windowed ? String(body.through) : undefined,
      requestKey: body.requestKey,
    });
    after(async () => {
      try {
        await drainPayrollRun(run.scope, run.id, payrollRunDeps(run.scope), { budgetMs: 90_000 });
      } catch {
        // The run stays resumable for the next poll or cron pass.
      }
    });
    return NextResponse.json(run, { status: 202 });
  } catch (error) { return payrollError(error); }
}
