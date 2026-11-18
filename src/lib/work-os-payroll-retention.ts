import { getPool } from "@/lib/db/pool";
import { localDayBounds } from "@/modules/work-os/companion";
import type { PayrollPurgeResult } from "@/modules/work-os/payroll/contracts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** 30 days after the latest of local pay-date start, explicit approval and the
 * first durable export. Reads, retries and later exports never move the anchor. */
export function payrollRetentionExpiry(input: {
  payDate: string; timezone: string; approvedAt: string | null; firstExportAt: string | null;
}): string {
  const start = localDayBounds(input.payDate, input.timezone).startIso;
  const anchors = [start, input.approvedAt, input.firstExportAt]
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .map((value) => Date.parse(value));
  if (!anchors.length || !Number.isFinite(anchors[0])) throw new Error("Payroll retention requires a valid pay date");
  return new Date(Math.max(...anchors) + 30 * DAY_MS).toISOString();
}

/** Service-only bounded purge. Each review is purged by the DDL maintenance
 * function, which locks the parent, checks expiry and legal holds, and deletes
 * only payroll-owned rows plus targeted payroll audit entries. */
export async function purgeExpiredPayroll(input: { at: Date; limit?: number }): Promise<PayrollPurgeResult> {
  if (!(input.at instanceof Date) || !Number.isFinite(input.at.getTime())) throw new Error("Payroll purge instant is invalid");
  const limit = input.limit === undefined ? 50 : Math.max(1, Math.min(100, Math.trunc(input.limit)));
  const expired = await getPool().query(`SELECT organization_id,id FROM work_payroll_reviews
    WHERE retention_expires_at <= $1 ORDER BY retention_expires_at LIMIT $2`, [input.at.toISOString(), limit]);
  let reviews = 0;
  for (const row of expired.rows as Array<Record<string, unknown>>) {
    try {
      await getPool().query("SELECT work_payroll_purge_expired($1,$2)", [row.organization_id, row.id]);
      reviews += 1;
    } catch (error) {
      if (!/legal hold|not expired/i.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
  const still = await getPool().query(`SELECT count(*)::int AS n FROM work_payroll_reviews WHERE retention_expires_at <= $1`, [input.at.toISOString()]);
  return { reviews, artifacts: reviews, auditEntries: reviews, remaining: Number(still.rows[0]?.n ?? 0) };
}

export async function payrollPeriodExpired(organizationId: string, personId: string, payDate: string): Promise<boolean> {
  const { rows } = await getPool().query(`SELECT 1 FROM work_payroll_retention_tombstones
    WHERE organization_id=$1 AND person_id=$2 AND pay_date=$3::date LIMIT 1`, [organizationId, personId, payDate]);
  return rows.length > 0;
}
