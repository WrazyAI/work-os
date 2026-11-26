import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { payrollError, requirePayrollAdmin } from "@/lib/work-os-payroll-api";
import { cancelPayrollRun, drainPayrollRun, payrollRunDeps } from "@/lib/work-os-payroll-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function runScope(organizationId: string, runId: string) {
  const { rows } = await getPool().query(`SELECT person_id FROM work_payroll_runs WHERE organization_id=$1 AND id=$2`, [organizationId, runId]);
  return rows[0]?.person_id ? { organizationId, personId: String(rows[0].person_id) } : null;
}

export async function GET(req: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { runId } = await context.params;
    const { rows } = await getPool().query(`SELECT * FROM work_payroll_runs WHERE organization_id=$1 AND id=$2`, [auth.access.organizationId, runId]);
    if (!rows.length) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    return NextResponse.json({ id: rows[0].id, status: rows[0].status, phase: rows[0].phase, progress: rows[0].progress, error: rows[0].error });
  } catch (error) { return payrollError(error); }
}

export async function POST(req: Request, context: { params: Promise<{ runId: string }> }) {
  const auth = await requirePayrollAdmin(req);
  if ("response" in auth) return auth.response;
  try {
    const { runId } = await context.params;
    const scope = await runScope(auth.access.organizationId, runId);
    if (!scope) return NextResponse.json({ error: "Payroll run not found" }, { status: 404 });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === "cancel") {
      const command = { rowVersion: String(body.rowVersion ?? "") };
      return NextResponse.json(await cancelPayrollRun(auth.access, runId, command));
    }
    return NextResponse.json(await drainPayrollRun(scope, runId, payrollRunDeps(scope), { budgetMs: 45_000 }));
  } catch (error) { return payrollError(error); }
}
