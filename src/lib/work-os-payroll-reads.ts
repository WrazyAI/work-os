import { getPool } from "@/lib/db/pool";
import { queryOne, queryRows } from "@/lib/db/typed";
import type {
  CountRow,
  PayrollDayProjectionRow,
  PayrollFindingWithDateRow,
  PayrollRosterQueryRow,
  PayrollStatusCountRow,
  WorkPayrollReviewRow,
} from "@/lib/db/rows/payroll";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { resolvePayrollPeriod } from "@/lib/work-os-payroll-period";
export { loadPayrollReview } from "@/lib/work-os-payroll-decisions";
import type {
  Page, PayrollDayResult, PayrollFinding, PayrollRosterPage, PayrollRunStatus, PayrollTotals, Span,
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
function decodeCursor(value: string | null): { name?: string; id?: string; date?: string; key?: string } | null {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>; return { name: typeof parsed.name === "string" ? parsed.name : undefined, id: typeof parsed.id === "string" ? parsed.id : undefined, date: typeof parsed.date === "string" ? parsed.date : undefined, key: typeof parsed.key === "string" ? parsed.key : undefined }; }
  catch { return null; }
}
async function assertLiveReview(access: WorkOsAccess, reviewId: string): Promise<WorkPayrollReviewRow> {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll records are admin-only.");
  const review = await queryOne<WorkPayrollReviewRow>(
    getPool(),
    `SELECT * FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2`,
    [access.organizationId, reviewId],
  );
  if (!review) throw new WorkOsValidationError("Payroll review not found");
  const expires = review.retention_expires_at instanceof Date ? review.retention_expires_at.getTime() : Date.parse(String(review.retention_expires_at ?? ""));
  if (Number.isFinite(expires) && expires <= Date.now()) throw new WorkOsConflictError("Payroll records for this period expired.", "payroll_expired");
  return review;
}

export async function listPayrollRoster(access: WorkOsAccess, filters: { payDate: string; cursor: string | null; limit: number; recordsOnly?: boolean }): Promise<PayrollRosterPage> {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll roster is admin-only.");
  const scope = { organizationId: access.organizationId };
  const person = await queryOne<{ timezone: string | null }>(
    getPool(),
    `SELECT coalesce((SELECT max(o.timezone) FROM work_employee_onboarding o WHERE o.organization_id=p.organization_id AND o.person_id=p.id),to_jsonb(p)->>'timezone','UTC') AS timezone FROM work_people p WHERE p.organization_id=$1 LIMIT 1`,
    [scope.organizationId],
  );
  const period = resolvePayrollPeriod(filters.payDate, String(person?.timezone ?? "UTC"));
  const limit = Math.max(1, Math.min(100, filters.limit || 50));
  const cursor = decodeCursor(filters.cursor);
  const rosterFilter = filters.recordsOnly ? "r.id IS NOT NULL" : "(r.id IS NOT NULL OR (p.active AND p.worktivity_employee_id IS NOT NULL))";
  const values: unknown[] = [scope.organizationId, filters.payDate];
  let after = "";
  if (cursor?.name && cursor.id) { values.push(cursor.name, cursor.id); after = "AND (p.display_name,p.id) > ($3,$4::uuid)"; }
  values.push(limit + 1);
  const rows = await queryRows<PayrollRosterQueryRow>(
    getPool(),
    `SELECT r.id AS review_id,r.status,r.totals,p.id AS person_id,p.display_name,p.active,
    (SELECT u.status FROM work_payroll_runs u
      WHERE u.organization_id=p.organization_id AND u.review_id=r.id AND u.person_id=p.id
      ORDER BY u.target_revision DESC LIMIT 1) AS audit_status,
    EXISTS (SELECT 1 FROM work_source_accounts a
      WHERE a.organization_id=p.organization_id AND a.person_id=p.id AND a.provider='worktivity'
        AND a.external_account_id=btrim(p.worktivity_employee_id) AND a.verified) AS mapped
    FROM work_people p LEFT JOIN work_payroll_reviews r
      ON r.organization_id=p.organization_id AND r.person_id=p.id AND r.pay_date=$2::date AND r.retention_expires_at > now()
    WHERE p.organization_id=$1 AND ${rosterFilter}
      ${after}
    ORDER BY p.display_name,p.id LIMIT $${values.length}`,
    values,
  );
  const pageRows = rows.slice(0, limit);
  const totalQuery = await queryOne<CountRow>(
    getPool(),
    `SELECT count(*)::int AS n FROM work_people p LEFT JOIN work_payroll_reviews r
    ON r.organization_id=p.organization_id AND r.person_id=p.id AND r.pay_date=$2::date AND r.retention_expires_at > now()
    WHERE p.organization_id=$1 AND ${rosterFilter}`,
    [scope.organizationId, filters.payDate],
  );
  const counts = await queryRows<PayrollStatusCountRow>(
    getPool(),
    `SELECT status,count(*)::int AS n FROM work_payroll_reviews WHERE organization_id=$1 AND pay_date=$2::date AND retention_expires_at > now() GROUP BY status`,
    [scope.organizationId, filters.payDate],
  );
  return {
    items: pageRows.map((row) => ({
      personId: String(row.person_id), displayName: String(row.display_name ?? "Employee"), active: row.active === true,
      mapped: row.mapped === true, reviewId: row.review_id ? String(row.review_id) : null,
      status: row.review_id ? String(row.status) : "not_started", totals: totals(row.totals),
      auditStatus: row.audit_status as PayrollRunStatus | null,
      workdays: 0,
    })),
    total: Number(totalQuery?.n ?? 0),
    nextCursor: rows.length > limit && pageRows.length ? encodeCursor({ name: pageRows[pageRows.length - 1].display_name, id: pageRows[pageRows.length - 1].person_id }) : null,
    period, counts: Object.fromEntries(counts.map((row) => [String(row.status), Number(row.n)])),
  };
}

const dayColumns = `d.id,d.result,d.local_date::text,d.schedule_snapshot,
  (SELECT count(*)::int FROM work_payroll_frame_findings f WHERE f.organization_id=d.organization_id
    AND f.review_id=d.review_id AND f.person_id=d.person_id AND f.analysis_revision=d.analysis_revision
    AND f.day_id=d.id) AS sampled_frames`;

function dayFromRow(row: PayrollDayProjectionRow): PayrollDayResult {
  const schedule = object(row.schedule_snapshot);
  const span = (value: unknown): Span | null => {
    const { startMs, endMs } = object(value);
    return typeof startMs === "number" && typeof endMs === "number" && Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? { startMs, endMs } : null;
  };
  return {
    ...(object(row.result) as unknown as PayrollDayResult), id: String(row.id),
    evidence: {
      sessions: (Array.isArray(schedule.sessions) ? schedule.sessions : []).map((value) => {
        const session = object(value);
        return { recorded: span(session.recorded), eligible: span(session.eligible) };
      }),
      scheduleSource: typeof schedule.scheduleSource === "string" ? schedule.scheduleSource : null,
      sampledFrames: Number(row.sampled_frames ?? 0),
    },
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
  const rows = await queryRows<PayrollDayProjectionRow>(
    getPool(),
    `SELECT ${dayColumns} FROM work_payroll_days d WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ${after} ORDER BY d.local_date LIMIT $${values.length}`,
    values,
  );
  const page = rows.slice(0, limit);
  const total = await queryOne<CountRow>(
    getPool(),
    `SELECT count(*)::int AS n FROM work_payroll_days WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3`,
    [access.organizationId, reviewId, review.analysis_revision],
  );
  return {
    items: page.map(dayFromRow),
    total: Number(total?.n ?? 0), nextCursor: rows.length > limit && page.length ? encodeCursor({ date: page[page.length - 1].local_date }) : null,
  };
}

export async function listPayrollFindings(access: WorkOsAccess, reviewId: string, filters: { status: string | null; cursor: string | null; limit: number }): Promise<Page<PayrollFinding>> {
  const review = await assertLiveReview(access, reviewId);
  const limit = Math.max(1, Math.min(100, filters.limit || 50));
  const values: unknown[] = [access.organizationId, reviewId, review.analysis_revision];
  let status = "";
  if (filters.status) { values.push(filters.status); status = `AND f.status=$4`; }
  const cursor = decodeCursor(filters.cursor);
  let after = "";
  if (cursor?.date && /^\d{4}-\d{2}-\d{2}$/.test(cursor.date) && cursor.key) {
    values.push(cursor.date, cursor.key);
    after = `AND (d.local_date,f.finding_key) > ($${values.length - 1}::date,$${values.length})`;
  }
  values.push(limit + 1);
  const rows = await queryRows<PayrollFindingWithDateRow>(
    getPool(),
    `SELECT f.*, d.local_date::text AS local_date FROM work_payroll_findings f JOIN work_payroll_days d
    ON d.organization_id=f.organization_id AND d.id=f.day_id
    WHERE f.organization_id=$1 AND f.review_id=$2 AND f.analysis_revision=$3 ${status} ${after}
    ORDER BY d.local_date,f.finding_key LIMIT $${values.length}`,
    values,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const frames = await queryRows<{ day_id: string; screenshot_summary_id: string }>(
    getPool(),
    `SELECT day_id, screenshot_summary_id
    FROM work_payroll_frame_findings
    WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3
    ORDER BY captured_at LIMIT 500`,
    [access.organizationId, reviewId, review.analysis_revision],
  );
  const framesByDay = new Map<string, string[]>();
  for (const frame of frames) {
    const day = String(frame.day_id);
    const list = framesByDay.get(day) ?? [];
    if (list.length < 3) list.push(String(frame.screenshot_summary_id));
    framesByDay.set(day, list);
  }
  const total = await queryOne<CountRow>(
    getPool(),
    `SELECT count(*)::int AS n FROM work_payroll_findings WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ${filters.status ? "AND status=$4" : ""}`,
    filters.status ? [access.organizationId, reviewId, review.analysis_revision, filters.status] : [access.organizationId, reviewId, review.analysis_revision],
  );
  return {
    items: page.map((row) => ({
      id: String(row.id), key: String(row.finding_key), scope: { organizationId: access.organizationId, personId: String(review.person_id) }, dayId: String(row.day_id),
      date: String(row.local_date), kind: row.kind as PayrollFinding["kind"], status: row.status as PayrollFinding["status"],
      effect: row.effect as PayrollFinding["effect"], span: row.start_at ? { startMs: Date.parse(String(row.start_at)), endMs: Date.parse(String(row.end_at)) } : null,
      durationMs: Number(row.duration_ms), minutes: Number(row.minutes), sourceHash: String(row.source_hash),
      blocksApproval: row.blocks_approval === true, requiredAction: row.required_action as PayrollFinding["requiredAction"],
      reason: String(row.reason), citations: Array.isArray(row.citations) ? row.citations as PayrollFinding["citations"] : [],
      frameSummaryIds: row.kind === "break" ? [] : framesByDay.get(String(row.day_id)) ?? [],
    })),
    total: Number(total?.n ?? 0),
    nextCursor: rows.length > limit && last ? encodeCursor({ date: last.local_date, key: last.finding_key }) : null,
  };
}

export async function loadPayrollDay(access: WorkOsAccess, reviewId: string, dayId: string): Promise<PayrollDayResult> {
  const review = await assertLiveReview(access, reviewId);
  const row = await queryOne<PayrollDayProjectionRow>(
    getPool(),
    `SELECT ${dayColumns} FROM work_payroll_days d WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 AND id=$4`,
    [access.organizationId, reviewId, review.analysis_revision, dayId],
  );
  if (!row) throw new WorkOsValidationError("Payroll day not found");
  return dayFromRow(row);
}
