import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { execSql, queryOne, withTransaction } from "@/lib/db/typed";
import type { WorkPayrollSettingsRow } from "@/lib/db/rows/payroll";
import { WorkOsConflictError, requireWorkOsAdmin, type WorkOsAccess } from "@/lib/work-os-api";

export async function requirePayrollAdmin(req: Request): Promise<{ access: WorkOsAccess } | { response: Response }> {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth;
  const settings = await queryOne<Pick<WorkPayrollSettingsRow, "enabled">>(
    getPool(),
    `SELECT enabled FROM work_payroll_settings WHERE organization_id=$1`,
    [auth.access.organizationId],
  );
  if (!settings?.enabled) {
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
  const status = /not found/i.test(message) ? 404 : /expired/i.test(message) ? 410
    : /conflict|changed|stale|revision|already|running|pending|held/i.test(message) ? 409
      : /refresh|unavailable|offline/i.test(message) ? 503
        : /forbidden|admin-only|not enabled/i.test(message) ? 403 : 400;
  return NextResponse.json({ error: "The payroll request could not be completed." }, { status, headers: { "Cache-Control": "no-store" } });
}

/** Explicit operator activation. It is not a browser endpoint and cannot be
 * called by a view; the CLI/runbook must pass the current settings revision. */
export async function activatePayrollPilot(organizationId: string, input: {
  expectedRevision: number; autoApprove: boolean; cutoffHour: number; activatedAt: Date;
}) {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) throw new Error("A valid organization id is required.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("A valid settings revision is required.");
  if (!Number.isInteger(input.cutoffHour) || input.cutoffHour < 0 || input.cutoffHour > 23) throw new Error("Cutoff hour must be 0–23.");
  if (!Number.isFinite(input.activatedAt.getTime())) throw new Error("Activation instant is invalid.");
  return withTransaction(async (client) => {
    await execSql(
      client,
      `INSERT INTO work_payroll_settings(organization_id,enabled,auto_approve_enabled,cutoff_hour,revision)
      VALUES($1,false,false,$2,0) ON CONFLICT (organization_id) DO NOTHING`,
      [organizationId, input.cutoffHour],
    );
    const updated = await queryOne<WorkPayrollSettingsRow>(
      client,
      `UPDATE work_payroll_settings SET enabled=true,
      auto_approve_enabled=$3, cutoff_hour=$4, revision=revision+1,
      auto_approve_activated_at=CASE WHEN $3 THEN $5 ELSE auto_approve_activated_at END,
      updated_at=now()
      WHERE organization_id=$1 AND revision=$2 RETURNING *`,
      [organizationId, input.expectedRevision, input.autoApprove, input.cutoffHour, input.activatedAt.toISOString()],
    );
    if (!updated) throw new WorkOsConflictError("Payroll settings changed. Reload before activating.", "settings_revision_conflict");
    return updated;
  });
}
