import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { requireWorkOsAdmin, type WorkOsAccess } from "@/lib/work-os-api";

export async function requirePayrollAdmin(req: Request): Promise<{ access: WorkOsAccess } | { response: Response }> {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth;
  const { rows } = await getPool().query(`SELECT enabled FROM work_payroll_settings WHERE organization_id=$1`, [auth.access.organizationId]);
  if (!rows[0]?.enabled) {
    return { response: NextResponse.json({ error: "Payroll review is not enabled for this workspace." }, { status: 503, headers: { "Cache-Control": "no-store" } }) };
  }
  return { access: auth.access };
}

export function payrollLimit(url: URL, fallback = 50): number {
  const value = Number(url.searchParams.get("limit") ?? fallback);
  return Number.isSafeInteger(value) && value >= 1 ? Math.min(100, value) : fallback;
}

export function payrollCursor(url: URL): string | null {
  const value = url.searchParams.get("cursor");
  return value && value.length <= 512 ? value : null;
}

export function payrollError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : "Payroll request failed.";
  const status = /not found/i.test(message) ? 404 : /forbidden|admin-only|not enabled/i.test(message) ? 403 : /expired/i.test(message) ? 410 : 400;
  return NextResponse.json({ error: message.slice(0, 300) }, { status, headers: { "Cache-Control": "no-store" } });
}
