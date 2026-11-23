import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { latestDuePayrollPeriod, payrollAutoApprovalDue, resolvePayrollPeriod } from "@/lib/work-os-payroll-period";
import { appendAutomaticReviewedRecap, withReviewedRecapSystem } from "@/lib/work-os-reviewed-recaps";
import { localDateForTimezone } from "@/modules/work-os/companion";
import type { PayrollPeriod, PayrollProgress, PayrollScope } from "@/modules/work-os/payroll/contracts";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function assertScope(scope: PayrollScope): void {
  if (!/^[0-9a-f-]{36}$/i.test(scope.organizationId) || !/^[0-9a-f-]{36}$/i.test(scope.personId)) {
    throw new Error("Payroll scope identifiers are invalid");
  }
}
function assertInstant(at: Date): void {
  if (!(at instanceof Date) || !Number.isFinite(at.getTime())) throw new Error("Payroll cutoff instant is invalid");
}
function boundedLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error(`Payroll recap limit must be 1–${MAX_LIMIT}`);
  return limit;
}
function dateOf(value: unknown): string | null {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
}
function safeTimezone(value: unknown): string {
  const timezone = String(value ?? "UTC");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); return timezone; } catch { return "UTC"; }
}

async function pendingCount(client: PoolClient, scope: PayrollScope, from: string, through: string): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM work_activity_intervals
    WHERE organization_id=$1 AND person_id=$2 AND generation_status='ready' AND review_status='inferred'
      AND local_date::date BETWEEN $3::date AND $4::date`, [scope.organizationId, scope.personId, from, through]);
  return Number(rows[0]?.n ?? 0);
}

/** Approve ready pending recaps for one person/period. The organization clock is
 * locked before interval and ledger rows; all writes are one transaction. */
export async function ensurePayrollRecapApproval(
  scope: PayrollScope, period: PayrollPeriod, at: Date, limit = DEFAULT_LIMIT,
): Promise<{ approved: number; pending: number; skipped: number; complete: boolean }> {
  assertScope(scope); assertInstant(at);
  const slice = boundedLimit(limit);
  return withReviewedRecapSystem(scope.organizationId, async (client) => {
    const settings = await client.query(`SELECT enabled, auto_approve_enabled, cutoff_hour, auto_approve_activated_at
      FROM work_payroll_settings WHERE organization_id=$1`, [scope.organizationId]);
    const row = settings.rows[0];
    const activated = row?.auto_approve_activated_at ? new Date(row.auto_approve_activated_at) : null;
    if (!row || !row.enabled || !row.auto_approve_enabled || !activated || !Number.isFinite(activated.getTime())) {
      return { approved: 0, pending: 0, skipped: 0, complete: false };
    }
    const cutoffHour = Number(row.cutoff_hour ?? 6);
    const from = period.from;
    if (!payrollAutoApprovalDue(period, at, cutoffHour)) {
      return { approved: 0, pending: await pendingCount(client, scope, from, period.through), skipped: 0, complete: false };
    }
    const activationDate = localDateForTimezone(activated, period.timezone);
    const lower = activationDate > from ? activationDate : from;
    if (lower > period.through) {
      return { approved: 0, pending: 0, skipped: 0, complete: true };
    }
    const reviewedAt = at.toISOString();
    const pending = await client.query(`SELECT * FROM work_activity_intervals
      WHERE organization_id=$1 AND person_id=$2 AND generation_status='ready' AND review_status='inferred'
        AND local_date::date BETWEEN $3::date AND $4::date
      ORDER BY local_date, id LIMIT $5 FOR UPDATE`,
    [scope.organizationId, scope.personId, lower, period.through, slice]);
    let approved = 0;
    let lastIntervalId: string | null = null;
    for (const interval of pending.rows as Array<Record<string, unknown>>) {
      const versionQuery = await client.query(`SELECT coalesce(max(version),0)::int AS version FROM work_recap_reviews
        WHERE organization_id=$1 AND interval_id=$2`, [scope.organizationId, interval.id]);
      const version = Number(versionQuery.rows[0]?.version ?? 0) + 1;
      const saved = await client.query(`UPDATE work_activity_intervals SET
        review_status='confirmed', review_source='payroll_auto', payroll_date=$3::date,
        employee_feedback=NULL, final_detail=ai_detail, reviewed_at=$4,
        next_steps_status='skipped', next_steps_error=NULL, updated_at=$4
        WHERE organization_id=$1 AND id=$2 AND review_status='inferred' RETURNING *`,
      [scope.organizationId, interval.id, period.payDate, reviewedAt]);
      if (!saved.rows.length) continue;
      await appendAutomaticReviewedRecap(client, saved.rows[0], { payDate: period.payDate, version });
      await client.query(`INSERT INTO work_audit_log
        (organization_id, actor_user_id, action, target_type, target_id, metadata)
        VALUES ($1,NULL,'activity_interval.payroll_auto_approved','activity_interval',$2,$3::jsonb)`,
      [scope.organizationId, interval.id, JSON.stringify({ reviewVersion: version, payDate: period.payDate, reviewSource: "payroll_auto" })]);
      approved += 1;
      lastIntervalId = String(interval.id);
    }
    const remaining = await pendingCount(client, scope, lower, period.through);
    const status = remaining === 0 ? "done" : "pending";
    await client.query(`INSERT INTO work_payroll_recap_settlements
      (organization_id,person_id,pay_date,cutoff_at,cursor,status,retention_expires_at)
      VALUES ($1,$2,$3::date,$4,$5::jsonb,$6,greatest($4::timestamptz + interval '30 days', ($3::date + interval '30 days')::timestamptz))
      ON CONFLICT (organization_id,person_id,pay_date) DO UPDATE SET
        cutoff_at=excluded.cutoff_at, cursor=excluded.cursor, status=excluded.status,
        retention_expires_at=excluded.retention_expires_at, updated_at=now()`,
    [scope.organizationId, scope.personId, period.payDate, reviewedAt, JSON.stringify({ lastApprovedIntervalId: lastIntervalId }), status]);
    return { approved, pending: remaining, skipped: 0, complete: remaining === 0 };
  });
}

/** Enumerate the semimonthly pay dates from activation through the latest due
 * date. This is the bounded catch-up path: never a historical sweep before the
 * operator enabled payroll auto-approval. */
export function payrollPayDatesBetween(activationDate: string, throughDate: string): string[] {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
  if (!valid(activationDate) || !valid(throughDate)) throw new Error("Payroll settlement dates must be YYYY-MM-DD");
  const [year, month, day] = activationDate.split("-").map(Number);
  let cursor = day <= 1 ? new Date(Date.UTC(year, month - 1, 1))
    : day <= 16 ? new Date(Date.UTC(year, month - 1, 16))
      : new Date(Date.UTC(year, month, 1));
  const through = Date.parse(`${throughDate}T00:00:00Z`);
  const dates: string[] = [];
  for (let guard = 0; guard < 240 && cursor.getTime() <= through; guard += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    const isFirst = cursor.getUTCDate() === 1;
    cursor = isFirst ? new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 16))
      : new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return dates;
}

export async function settleDuePayrollRecapApprovals(input: { at: Date; limit: number }): Promise<PayrollProgress> {
  assertInstant(input.at);
  const limit = boundedLimit(input.limit);
  const pool = getPool();
  const organizations = await pool.query(`SELECT organization_id, auto_approve_activated_at
    FROM work_payroll_settings WHERE enabled AND auto_approve_enabled AND auto_approve_activated_at IS NOT NULL`);
  let approved = 0;
  let pending = 0;
  let complete = true;
  for (const organization of organizations.rows as Array<Record<string, unknown>>) {
    const organizationId = String(organization.organization_id);
    const activation = new Date(organization.auto_approve_activated_at as string);
    if (!Number.isFinite(activation.getTime())) continue;
    const people = await pool.query(`SELECT p.id,
        coalesce((SELECT max(o.timezone) FROM work_employee_onboarding o
          WHERE o.organization_id=p.organization_id AND o.person_id=p.id), to_jsonb(p)->>'timezone', 'UTC') AS timezone
      FROM work_people p WHERE p.organization_id=$1`, [organizationId]);
    for (const person of people.rows as Array<Record<string, unknown>>) {
      const timezone = safeTimezone(person.timezone);
      const activationDate = localDateForTimezone(activation, timezone);
      const due = latestDuePayrollPeriod(input.at, timezone);
      for (const payDate of payrollPayDatesBetween(activationDate, due.payDate)) {
        const period = resolvePayrollPeriod(payDate, timezone);
        const result = await ensurePayrollRecapApproval({ organizationId, personId: String(person.id) }, period, input.at, limit);
        approved += result.approved;
        pending += result.pending;
        complete = complete && result.complete;
      }
    }
  }
  return {
    phase: "recaps",
    message: `Approved ${approved} payroll recap${approved === 1 ? "" : "s"}; ${pending} still pending.`,
    daysDone: 0, days: 0, framesClassified: 0, framesReused: 0, findings: 0,
    remaining: pending, status: complete ? "done" : "running", nextAttemptAt: null,
  };
}

/** Constant-time bearer check for the service-only cron route. */
export function payrollCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const received = Buffer.from(req.headers.get("authorization") ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export { dateOf as payrollSettlementDate };