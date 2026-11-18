import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { resolvePayrollPeriod } from "@/lib/work-os-payroll-period";
export { loadPayrollReview } from "@/lib/work-os-payroll-decisions";
import type {
  Page, PayrollDayResult, PayrollFinding, PayrollRosterPage, PayrollTotals,
} from "@/modules/work-os/payroll/contracts";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const totals = (value: unknown): PayrollTotals => {
  const row = object(value);
  return { recorded: Number(row.recorded ?? 0), eligibleTracked: Number(row.eligibleTracked ?? 0), outside: Number(row.outside ?? 0),
    break: Number(row.break ?? 0), inactivity: Number(row.inactivity ?? 0), held: Number(row.held ?? 0),
    manualExcluded: Number(row.manualExcluded ?? 0), recommended: Number(row.recommended ?? 0), approved: Number(row.approved ?? 0) };
};
function encodeCursor(value: unknown): string { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function decodeCursor(value: string | null): { name?: string; id?: string; date?: string } | null {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>; return { name: typeof parsed.name === "string" ? parsed.name : undefined, id: typeof parsed.id === "string" ? parsed.id : undefined, date: typeof parsed.date === "string" ? parsed.date : undefined }; }
  catch { return null; }
}
async function assertLiveReview(access: WorkOsAccess, reviewId: string): Promise<Row> {
  const { rows } = await getPool().query(`SELECT * FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2`, [access.organizationId, reviewId]);
  if (!rows.length) throw new WorkOsValidationError("Payroll review not found");
  const review = rows[0] as Row;
  const expires = review.retention_expires_at instanceof Date ? review.retention_expires_at.getTime() : Date.parse(String(review.retention_expires_at ?? ""));
  if (Number.isFinite(expires) && expires <= Date.now()) throw new WorkOsConflictError("Payroll records for this period expired.", "payroll_expired");
  return review;
}

export async function listPayrollRoster(access: WorkOsAccess, filters: { payDate: string; cursor: string | null; limit: number }): Promise<PayrollRosterPage> {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll roster is admin-only.");
  const scope = { organizationId: access.organizationId };
  const person = await getPool().query(`SELECT coalesce((SELECT max(o.timezone) FROM work_employee_onboarding o WHERE o.organization_id=p.organization_id AND o.person_id=p.id),p.timezone,'UTC') AS timezone FROM work_people p WHERE p.organization_id=$1 LIMIT 1`, [scope.organizationId]);
  const period = resolvePayrollPeriod(filters.payDate, String(person.rows[0]?.timezone ?? "UTC"));
  const limit = Math.max(1, Math.min(100, filters.limit || 50));
  const cursor = decodeCursor(filters.cursor);
  const values: unknown[] = [scope.organizationId, filters.payDate];
  let after = "";
  if (cursor?.name && cursor.id) { values.push(cursor.name, cursor.id); after = "AND (p.display_name,p.id) > ($3,$4::uuid)"; }
  values.push(limit + 1);
  const { rows } = await getPool().query(`SELECT r.id AS review_id,r.status,r.totals,r.retention_expires_at,p.id AS person_id,p.display_name,p.active
    FROM work_people p LEFT JOIN work_payroll_reviews r
      ON r.organization_id=p.organization_id AND r.person_id=p.id AND r.pay_date=$2::date
    WHERE p.organization_id=$1 AND (r.id IS NOT NULL OR (p.active AND p.worktivity_employee_id IS NOT NULL))
      ${after}
    ORDER BY p.display_name,p.id LIMIT $${values.length}`, values);
  const pageRows = rows.slice(0, limit) as Row[];
  const totalQuery = await getPool().query(`SELECT count(*)::int AS n FROM work_people p LEFT JOIN work_payroll_reviews r
    ON r.organization_id=p.organization_id AND r.person_id=p.id AND r.pay_date=$2::date
    WHERE p.organization_id=$1 AND (r.id IS NOT NULL OR (p.active AND p.worktivity_employee_id IS NOT NULL))`,
  [scope.organizationId, filters.payDate]);
  const counts = await getPool().query(`SELECT status,count(*)::int AS n FROM work_payroll_reviews WHERE organization_id=$1 AND pay_date=$2::date GROUP BY status`, [scope.organizationId, filters.payDate]);
  return {
    items: pageRows.map((row) => ({
      personId: String(row.person_id), displayName: String(row.display_name ?? "Employee"), active: row.active === true,
      mapped: row.review_id !== null, reviewId: row.review_id ? String(row.review_id) : null,
      status: row.review_id ? String(row.status) : "not_started", totals: totals(row.totals),
      workdays: 0,
    })),
    total: Number(totalQuery.rows[0]?.n ?? 0),
    nextCursor: rows.length > limit && pageRows.length ? encodeCursor({ name: pageRows[pageRows.length - 1].display_name, id: pageRows[pageRows.length - 1].person_id }) : null,
    period, counts: Object.fromEntries((counts.rows as Row[]).map((row) => [String(row.status), Number(row.n)])),
  };
}

export async function listPayrollDays(access: WorkOsAccess, reviewId: string, filters: { cursor: string | null; limit: number }): Promise<Page<PayrollDayResult>> {
  const review = await assertLiveReview(access, reviewId);
  const limit = Math.max(1, Math.min(100, filters.limit || 50));
  const cursor = decodeCursor(filters.cursor);
  const values: unknown[] = [access.organizationId, reviewId, review.analysis_revision];
  let after = "";
  if (cursor?.date) { values.push(cursor.date); after = "AND local_date > $4::date"; }
  values.push(limit + 1);
  const { rows } = await getPool().query(`SELECT * FROM work_payroll_days WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ${after} ORDER BY local_date LIMIT $${values.length}`, values);
  const page = rows.slice(0, limit) as Row[];
  const total = await getPool().query(`SELECT count(*)::int AS n FROM work_payroll_days WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3`, [access.organizationId, reviewId, review.analysis_revision]);
  return {
    items: page.map((row) => ({ ...(object(row.result) as unknown as PayrollDayResult), id: String(row.id) })),
    total: Number(total.rows[0]?.n ?? 0), nextCursor: rows.length > limit && page.length ? encodeCursor({ date: page[page.length - 1].local_date }) : null,
  };
}

export async function listPayrollFindings(access: WorkOsAccess, reviewId: string, filters: { status: string | null; cursor: string | null; limit: number }): Promise<Page<PayrollFinding>> {
  const review = await assertLiveReview(access, reviewId);
  const limit = Math.max(1, Math.min(100, filters.limit || 50));
  const values: unknown[] = [access.organizationId, reviewId, review.analysis_revision];
  let status = "";
  if (filters.status) { values.push(filters.status); status = `AND f.status=$4`; }
  values.push(limit + 1);
  const { rows } = await getPool().query(`SELECT f.*, d.local_date FROM work_payroll_findings f JOIN work_payroll_days d
    ON d.organization_id=f.organization_id AND d.id=f.day_id
    WHERE f.organization_id=$1 AND f.review_id=$2 AND f.analysis_revision=$3 ${status}
    ORDER BY f.created_at,f.finding_key LIMIT $${values.length}`, values);
  const page = rows.slice(0, limit) as Row[];
  const total = await getPool().query(`SELECT count(*)::int AS n FROM work_payroll_findings WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ${filters.status ? "AND status=$4" : ""}`,
    filters.status ? [access.organizationId, reviewId, review.analysis_revision, filters.status] : [access.organizationId, reviewId, review.analysis_revision]);
  return {
    items: page.map((row) => ({
      id: String(row.id), key: String(row.finding_key), scope: { organizationId: access.organizationId, personId: String(review.person_id) }, dayId: String(row.day_id),
      date: String(row.local_date), kind: row.kind as PayrollFinding["kind"], status: row.status as PayrollFinding["status"],
      effect: row.effect as PayrollFinding["effect"], span: row.start_at ? { startMs: Date.parse(String(row.start_at)), endMs: Date.parse(String(row.end_at)) } : null,
      durationMs: Number(row.duration_ms), minutes: Number(row.minutes), sourceHash: String(row.source_hash),
      blocksApproval: row.blocks_approval === true, requiredAction: row.required_action as PayrollFinding["requiredAction"],
      reason: String(row.reason), citations: Array.isArray(row.citations) ? row.citations as PayrollFinding["citations"] : [],
    })),
    total: Number(total.rows[0]?.n ?? 0), nextCursor: null,
  };
}

export async function loadPayrollDay(access: WorkOsAccess, reviewId: string, dayId: string): Promise<PayrollDayResult> {
  const review = await assertLiveReview(access, reviewId);
  const { rows } = await getPool().query(`SELECT * FROM work_payroll_days WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 AND id=$4`, [access.organizationId, reviewId, review.analysis_revision, dayId]);
  if (!rows.length) throw new WorkOsValidationError("Payroll day not found");
  return { ...(object(rows[0].result) as unknown as PayrollDayResult), id: String(rows[0].id) };
}
