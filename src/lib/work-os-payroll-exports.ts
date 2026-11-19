import { createHash } from "node:crypto";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { approvalFromRow, payrollDateKey } from "@/lib/work-os-payroll-decisions";
import type { PayrollApproval, PayrollTotals } from "@/modules/work-os/payroll/contracts";

const SCHEMA = "payroll-export-v1";
const BOM = "\uFEFF";
type Row = Record<string, unknown>;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const hours = (minutes: number) => (minutes / 60).toFixed(4);

function text(value: unknown): string {
  const last = String(value ?? "");
  return /^[\s=+\-@]/.test(last) ? `'${last}` : last;
}
function csvField(value: string | number, isText: boolean): string {
  const raw = isText ? text(value) : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replaceAll('"', '""')}"` : raw;
}
function csv(rows: Array<Array<string | number>>, textColumns: Set<number>): string {
  return BOM + rows.map((row) => row.map((value, index) => csvField(value, textColumns.has(index))).join(",")).join("\r\n") + "\r\n";
}

function totalsOf(approval: PayrollApproval): PayrollTotals {
  const totals = approval.totals;
  return {
    recorded: Number(totals.recorded ?? 0), eligibleTracked: Number(totals.eligibleTracked ?? 0),
    outside: Number(totals.outside ?? 0), break: Number(totals.break ?? 0),
    inactivity: Number(totals.inactivity ?? 0), held: Number(totals.held ?? 0),
    manualExcluded: Number(totals.manualExcluded ?? 0), recommended: Number(totals.recommended ?? 0),
    approved: Number(totals.approved ?? totals.recommended ?? 0),
  };
}

function summaryRows(approval: PayrollApproval, historical: boolean): Array<Array<string | number>> {
  const totals = totalsOf(approval);
  return [[
    approval.id, approval.revision, approval.scope.personId, approval.identity.displayName,
    approval.period.from, approval.period.through, approval.period.payDate,
    totals.recorded, totals.eligibleTracked, totals.outside, totals.break, totals.inactivity,
    totals.manualExcluded, totals.held, totals.recommended, totals.approved, hours(totals.approved),
    historical ? "historical" : "approved", approval.approvedAt, approval.approvedAt, SCHEMA,
  ]];
}
const SUMMARY_COLUMNS = [
  "approval_id", "approval_revision", "person_id", "employee_name", "period_start", "period_end", "pay_date",
  "recorded_minutes", "eligible_tracked_minutes", "outside_minutes", "break_minutes", "inactivity_minutes",
  "manual_excluded_minutes", "held_minutes", "recommended_minutes", "approved_minutes", "approved_hours",
  "status", "approved_at", "snapshot_at", "schema_version",
] as const;
const SUMMARY_TEXT = new Set([0, 2, 3, 4, 5, 6, 17, 18, 19, 20]);
const DAILY_COLUMNS = [
  "approval_id", "approval_revision", "person_id", "employee_name", "period_start", "period_end", "pay_date",
  "shift_date", "schedule", "session_count",
  "recorded_minutes", "eligible_tracked_minutes", "outside_minutes", "break_minutes", "inactivity_minutes",
  "manual_excluded_minutes", "held_minutes", "recommended_minutes", "approved_minutes", "approved_hours",
  "finding_count", "reason_summary", "status", "approved_at", "snapshot_at", "schema_version",
] as const;
const DAILY_TEXT = new Set([0, 2, 3, 4, 5, 6, 7, 8, 21, 22, 23, 24, 25]);

function dayMinutes(day: PayrollApproval["days"][number]): PayrollTotals {
  const saved = (day.minutes ?? {}) as Partial<PayrollTotals>;
  const approved = Number(saved.approved ?? saved.recommended ?? 0);
  return {
    recorded: Number(saved.recorded ?? 0), eligibleTracked: Number(saved.eligibleTracked ?? 0),
    outside: Number(saved.outside ?? 0), break: Number(saved.break ?? 0),
    inactivity: Number(saved.inactivity ?? 0), held: Number(saved.held ?? 0),
    manualExcluded: Number(saved.manualExcluded ?? 0), recommended: Number(saved.recommended ?? 0),
    approved,
  };
}

function dailyRows(approval: PayrollApproval, historical: boolean): Array<Array<string | number>> {
  const base = summaryRows(approval, historical)[0];
  const prefix = base.slice(0, 7) as Array<string | number>;
  const suffix = [base[17], base[18], base[19], base[20]] as Array<string | number>;
  if (!approval.days.length) {
    const zeroMinutes = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    return [[...prefix, approval.period.from, "", 0, ...zeroMinutes, "0.0000", 0, "No work recorded", ...suffix]];
  }
  return approval.days.map((day) => {
    const minutes = dayMinutes(day);
    const findings = approval.findings.filter((finding) => String((finding as unknown as Record<string, unknown>).startAt ?? "").slice(0, 10) === String(day.date).slice(0, 10));
    const reason = findings.map((finding) => finding.reason).join("; ").replace(/\s+/g, " ").trim().slice(0, 400);
    return [
      ...prefix, day.date, day.schedule ?? "", Number(day.sessionCount ?? 0),
      minutes.recorded, minutes.eligibleTracked, minutes.outside, minutes.break, minutes.inactivity,
      minutes.manualExcluded, minutes.held, minutes.recommended, minutes.approved, hours(minutes.approved),
      findings.length, reason, ...suffix,
    ];
  });
}

export async function createPayrollExport(access: WorkOsAccess, input: {
  approvalIds: string[]; kind: "summary" | "daily"; requestKey: string;
}, at: Date): Promise<{ bytes: Uint8Array; filename: string; hash: string }> {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll export is admin-only.");
  const ids = [...new Set(input.approvalIds)].sort();
  if (!ids.length) throw new WorkOsValidationError("At least one approval is required.");
  if (ids.length > 100) throw new WorkOsValidationError("At most 100 approvals may be exported at once.");
  if (!input.requestKey.trim()) throw new WorkOsValidationError("An export request key is required.");
  const rows = (await getPool().query(`SELECT a.*, r.person_id AS review_person_id, r.pay_date AS review_pay_date,
      r.current_approval_id, r.timezone, r.retention_expires_at
    FROM work_payroll_approvals a JOIN work_payroll_reviews r
      ON r.organization_id=a.organization_id AND r.id=a.review_id AND r.person_id=a.person_id
    WHERE a.organization_id=$1 AND a.id=ANY($2::uuid[]) ORDER BY a.id`, [access.organizationId, ids])).rows as Row[];
  if (rows.length !== ids.length) throw new WorkOsValidationError("One or more payroll approvals were not found.");
  for (const row of rows) {
    const expiry = row.retention_expires_at instanceof Date ? row.retention_expires_at.getTime() : Date.parse(String(row.retention_expires_at ?? ""));
    if (Number.isFinite(expiry) && expiry <= at.getTime()) throw new WorkOsConflictError("Payroll records for this period expired.", "payroll_expired");
  }
  const payDates = new Set(rows.map((row) => String(payrollDateKey(row.review_pay_date))));
  if (payDates.size !== 1) throw new WorkOsConflictError("Bulk payroll export requires one pay date.", "payroll_mixed_pay_dates");
  const approvals = rows.map((row) => approvalFromRow(row, { organizationId: access.organizationId, personId: String(row.person_id) }, periodOf(row)));
  const historical = approvals.some((approval, index) => String(rows[index].current_approval_id ?? "") !== approval.id);
  const table = input.kind === "daily" ? DAILY_COLUMNS : SUMMARY_COLUMNS;
  const body = approvals.flatMap((approval) => input.kind === "daily" ? dailyRows(approval, historical) : summaryRows(approval, historical));
  const bytes = Buffer.from(csv([[...table], ...body], input.kind === "daily" ? DAILY_TEXT : SUMMARY_TEXT), "utf8");
  const digest = hash(bytes);
  // Store each approval's own canonical file so a later single export cannot
  // return a different approval's batch rows.
  const individual = new Map(approvals.map((approval) => {
    const rowsForApproval = input.kind === "daily" ? dailyRows(approval, historical) : summaryRows(approval, historical);
    const payload = Buffer.from(csv([[...table], ...rowsForApproval], input.kind === "daily" ? DAILY_TEXT : SUMMARY_TEXT), "utf8");
    return [approval.id, { payload, hash: hash(payload) }] as const;
  }));
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const approval of approvals) {
      const file = individual.get(approval.id)!;
      await client.query(`INSERT INTO work_payroll_exports
        (organization_id,review_id,person_id,approval_id,kind,schema_version,snapshot_hash,payload,payload_hash,actor_user_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (organization_id,approval_id,kind,schema_version) DO NOTHING`,
      [access.organizationId, approval.reviewId, approval.scope.personId, approval.id, input.kind, SCHEMA,
        approval.snapshotHash, file.payload, file.hash, access.ctx.user.id]);
      await client.query(`UPDATE work_payroll_reviews SET
        first_export_at=coalesce(first_export_at,$3), last_exported_at=$3,
        retention_expires_at=greatest(retention_expires_at, pay_date + interval '30 days', coalesce(first_export_at,$3::timestamptz) + interval '30 days'),
        updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [access.organizationId, approval.reviewId, at.toISOString()]);
      await client.query(`INSERT INTO work_audit_log (organization_id,actor_user_id,action,target_type,target_id,metadata)
        VALUES ($1,$2,'payroll.exported','payroll_approval',$3,$4::jsonb)`,
      [access.organizationId, access.ctx.user.id, approval.id, JSON.stringify({ kind: input.kind, hash: digest, requestKey: input.requestKey, approvalCount: ids.length })]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
  const stored = await getPool().query<{ payload: Buffer; payload_hash: string }>(`SELECT payload,payload_hash FROM work_payroll_exports
    WHERE organization_id=$1 AND approval_id=$2 AND kind=$3 AND schema_version=$4`, [access.organizationId, approvals[0].id, input.kind, SCHEMA]);
  if (approvals.length > 1) {
    return { bytes, filename: `payroll-${payDates.values().next().value}-${input.kind}-${digest.slice(0, 12)}.csv`, hash: digest };
  }
  const storedBytes = stored.rows[0]?.payload ? new Uint8Array(stored.rows[0].payload) : bytes;
  const storedHash = String(stored.rows[0]?.payload_hash ?? digest);
  return {
    bytes: storedBytes,
    filename: `payroll-${payDates.values().next().value}-${input.kind}-${storedHash.slice(0, 12)}.csv`,
    hash: storedHash,
  };
}

function periodOf(row: Row): PayrollApproval["period"] {
  const snapshot = object(row.snapshot);
  const period = object(snapshot.period);
  return {
    payDate: String(period.payDate ?? payrollDateKey(row.review_pay_date)), from: String(period.from ?? ""), through: String(period.through ?? ""),
    timezone: String(period.timezone ?? row.timezone ?? "UTC"),
    weeks: (Array.isArray(period.weeks) ? period.weeks : []) as PayrollApproval["period"]["weeks"],
  };
}

export async function loadPayrollPrint(access: WorkOsAccess, approvalId: string): Promise<PayrollApproval> {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll print is admin-only.");
  const { rows } = await getPool().query(`SELECT a.*, r.current_approval_id, r.timezone, r.pay_date AS review_pay_date
    FROM work_payroll_approvals a JOIN work_payroll_reviews r
      ON r.organization_id=a.organization_id AND r.id=a.review_id AND r.person_id=a.person_id
    WHERE a.organization_id=$1 AND a.id=$2`, [access.organizationId, approvalId]);
  if (!rows.length) throw new WorkOsValidationError("Payroll approval not found.");
  const row = rows[0] as Row;
  return approvalFromRow(row, { organizationId: access.organizationId, personId: String(row.person_id) }, periodOf(row));
}
