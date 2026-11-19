import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { loadPayrollSourceToken, readPayrollSourceToken, verifyPayrollSourceToken } from "@/lib/work-os-payroll-freshness";
import { resolvePayrollPeriod } from "@/lib/work-os-payroll-period";
import { applyPayrollDecisions } from "@/lib/work-os-payroll-hours";
import type {
  FindingDecision, PayrollApproval, PayrollCommand, PayrollDayResult, PayrollFinding,
  PayrollReview, PayrollScope, PayrollTotals, Span,
} from "@/modules/work-os/payroll/contracts";

type Row = Record<string, unknown>;
type Action = "payable" | "excluded" | "acknowledged";

function requireAdmin(access: WorkOsAccess): void {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll review is admin-only.");
}
export async function reviewScope(access: WorkOsAccess, reviewId: string): Promise<PayrollScope> {
  const { rows } = await getPool().query(`SELECT person_id FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2`, [access.organizationId, reviewId]);
  if (!rows.length) throw new WorkOsValidationError("Payroll review not found");
  return { organizationId: access.organizationId, personId: String(rows[0].person_id) };
}
function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}
function iso(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value;
  }
  return null;
}
function dateKey(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  const match = typeof value === "string" ? value.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return match ? match[0] : null;
}
export async function payrollTransaction<T>(scope: PayrollScope, run: (client: PoolClient, token: string) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO work_admin_otto_clock (organization_id,sequence) VALUES ($1,0) ON CONFLICT (organization_id) DO NOTHING`, [scope.organizationId]);
    await client.query("SELECT sequence FROM work_admin_otto_clock WHERE organization_id=$1 FOR UPDATE", [scope.organizationId]);
    const token = await loadPayrollSourceToken(client, scope);
    const result = await run(client, token);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export async function loadPayrollReviewRow(client: PoolClient, scope: PayrollScope, reviewId: string): Promise<Row> {
  const { rows } = await client.query(`SELECT * FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2 AND person_id=$3`, [scope.organizationId, reviewId, scope.personId]);
  if (!rows.length) throw new WorkOsValidationError("Payroll review not found");
  return rows[0];
}

function totalsFromJson(value: unknown): PayrollTotals {
  const row = object(value);
  return {
    recorded: Number(row.recorded ?? 0), eligibleTracked: Number(row.eligibleTracked ?? 0), outside: Number(row.outside ?? 0),
    break: Number(row.break ?? 0), inactivity: Number(row.inactivity ?? 0), held: Number(row.held ?? 0),
    manualExcluded: Number(row.manualExcluded ?? 0), recommended: Number(row.recommended ?? 0), approved: Number(row.approved ?? 0),
  };
}

function approvalFromRow(row: Row, scope: PayrollScope, period: PayrollReview["period"]): PayrollApproval {
  const snapshot = object(row.snapshot);
  return {
    id: String(row.id), reviewId: String(row.review_id), scope, revision: Number(row.revision), period,
    approvedAt: iso(row.approved_at) ?? "", approvedBy: String(row.approved_by ?? ""), note: row.note ? String(row.note) : null,
    totals: totalsFromJson(object(snapshot).totals), days: Array.isArray(object(snapshot).days) ? object(snapshot).days as PayrollApproval["days"] : [],
    briefs: Array.isArray(object(snapshot).briefs) ? object(snapshot).briefs as PayrollApproval["briefs"] : [],
    snapshotHash: String(row.snapshot_hash), schemaVersion: String(row.export_schema_version),
    identity: object(object(snapshot).identity) as { displayName: string },
    findings: Array.isArray(object(snapshot).findings) ? object(snapshot).findings as PayrollFinding[] : [],
  };
}

export async function loadPayrollReview(access: WorkOsAccess, reviewId: string): Promise<PayrollReview> {
  requireAdmin(access);
  const scope = await reviewScope(access, reviewId);
  const client = await getPool().connect();
  try {
    const review = await loadPayrollReviewRow(client, scope, reviewId);
    const expiry = review.retention_expires_at instanceof Date ? review.retention_expires_at.getTime() : Date.parse(String(review.retention_expires_at ?? ""));
    if (Number.isFinite(expiry) && expiry <= Date.now()) throw new WorkOsConflictError("Payroll records for this period expired.", "payroll_expired");
    const approval = review.current_approval_id
      ? (await client.query(`SELECT * FROM work_payroll_approvals WHERE organization_id=$1 AND review_id=$2 AND id=$3`, [scope.organizationId, reviewId, review.current_approval_id])).rows[0]
      : null;
    const briefs = (await client.query(`SELECT * FROM work_payroll_week_briefs WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ORDER BY week`, [scope.organizationId, reviewId, review.analysis_revision])).rows;
    const revisionToken = (await client.query(`SELECT source_token,provider_verified_at FROM work_payroll_analysis_revisions WHERE organization_id=$1 AND review_id=$2 AND person_id=$3 AND analysis_revision=$4`, [scope.organizationId, reviewId, scope.personId, review.analysis_revision])).rows[0];
    const sourceChanged = Boolean(approval && revisionToken?.source_token && (await readPayrollSourceToken(scope)) !== String(revisionToken.source_token));
    const recapStatsRow = (await client.query(`SELECT
        count(*) FILTER (WHERE review_status IN ('confirmed','amended') AND coalesce(review_source,'employee')='employee')::int AS employee_reviewed,
        count(*) FILTER (WHERE review_status IN ('confirmed','amended') AND review_source='payroll_auto')::int AS auto_approved,
        count(*) FILTER (WHERE review_status='inferred' AND generation_status='ready')::int AS pending
      FROM work_activity_intervals WHERE organization_id=$1 AND person_id=$2 AND local_date::date BETWEEN $3::date AND $4::date`,
    [scope.organizationId, scope.personId, review.period_start, review.period_end])).rows[0] as Row | undefined;
    const period = resolvePayrollPeriod(dateKey(review.pay_date)!, String(review.timezone));
    return {
      id: String(review.id), scope, period,
      token: { rowVersion: String(review.row_version), analysisRevision: Number(review.analysis_revision), sourceHash: String(review.source_hash ?? "") },
      status: String(review.status) as PayrollReview["status"], totals: totalsFromJson(review.totals),
      briefs: briefs.map((brief: Row) => ({
        week: Number(brief.week) as 1 | 2, status: String(brief.status) as PayrollReview["briefs"][number]["status"],
        title: String(brief.title ?? ""), summary: String(brief.summary_markdown ?? ""),
        summaryCitations: Array.isArray(brief.summary_citations) ? brief.summary_citations as PayrollReview["briefs"][number]["summaryCitations"] : [],
        themes: Array.isArray(brief.themes) ? brief.themes as PayrollReview["briefs"][number]["themes"] : [],
        openItems: Array.isArray(brief.open_items) ? brief.open_items as PayrollReview["briefs"][number]["openItems"] : [],
        gaps: Array.isArray(brief.gaps) ? brief.gaps as string[] : [], sourceHash: String(brief.source_hash ?? ""),
      })),
      blockers: [], run: null,
      approval: approval ? approvalFromRow(approval, scope, period) : null,
      retentionExpiresAt: iso(review.retention_expires_at) ?? "",
      firstExportAt: iso(review.first_export_at), evidenceChangedSinceApproval: review.evidence_changed_since_approval === true || sourceChanged,
      providerVerifiedAt: iso(object(object(approval?.snapshot).sourceExplanation).providerVerifiedAt)
        ?? iso(revisionToken?.provider_verified_at),
      recapStats: {
        employeeReviewed: Number(recapStatsRow?.employee_reviewed ?? 0),
        autoApproved: Number(recapStatsRow?.auto_approved ?? 0),
        pending: Number(recapStatsRow?.pending ?? 0),
      },
    };
  } finally { client.release(); }
}

function verifyCommand(review: Row, command: PayrollCommand): void {
  if (String(review.row_version) !== command.rowVersion) throw new WorkOsConflictError("The payroll review changed. Reload it before continuing.", "review_version_conflict");
  if (Number(review.analysis_revision) !== command.analysisRevision) throw new WorkOsConflictError("The payroll analysis revision changed.", "analysis_revision_conflict");
  if (String(review.source_hash ?? "") !== command.sourceHash) throw new WorkOsConflictError("The payroll source evidence changed.", "source_hash_conflict");
}

async function applyCommand(client: PoolClient, scope: PayrollScope, review: Row, findingKeys: string[], action: Action, note: string, requestKey: string, actor: string, decisionKind: "payable" | "excluded" | "acknowledged" | "adjusted"): Promise<void> {
  const findings = (await client.query(`SELECT * FROM work_payroll_findings WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 AND finding_key=ANY($4::text[])`,
    [scope.organizationId, review.id, review.analysis_revision, findingKeys])).rows as Row[];
  if (findings.length !== findingKeys.length) throw new WorkOsValidationError("One or more payroll findings no longer exist.");
  const days = (await client.query(`SELECT * FROM work_payroll_days WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ORDER BY local_date`,
    [scope.organizationId, review.id, review.analysis_revision])).rows as Row[];
  const decisionsByDay = new Map<string, FindingDecision[]>();
  for (const finding of findings) {
    if (finding.kind === "break" || finding.kind === "outside_window") throw new WorkOsConflictError("Break and outside-window time require a manual adjustment, not a finding decision.");
    if (finding.required_action === "correct") throw new WorkOsConflictError("Structural payroll findings require source correction.");
    if (action === "acknowledged" && finding.effect !== "acknowledge") throw new WorkOsConflictError("A held interval cannot only be acknowledged.");
    if (action === "payable" && finding.kind === "break") throw new WorkOsConflictError("Break time is already excluded.");
    const decision: FindingDecision = {
      requestKey: `${requestKey}:${String(finding.finding_key)}`, findingKey: String(finding.finding_key),
      sourceHash: String(finding.source_hash), action, note,
    };
    const key = String(finding.day_id);
    decisionsByDay.set(key, [...(decisionsByDay.get(key) ?? []), decision]);
  }
  for (const day of days) {
    const decisions = decisionsByDay.get(String(day.id));
    if (!decisions) continue;
    const result = object(day.result) as unknown as PayrollDayResult;
    const next = applyPayrollDecisions(result, decisions);
    await client.query(`UPDATE work_payroll_days SET exact_ms=$3::jsonb, partition=$4::jsonb, status=$5,
        tracked_minutes=$6, break_minutes=$7, inactivity_minutes=$8, outside_minutes=$9, held_minutes=$10,
        recommended_minutes=$11, manual_excluded_minutes=$12, result=$13::jsonb, updated_at=now()
      WHERE organization_id=$1 AND id=$2`,
    [scope.organizationId, day.id, JSON.stringify(next.exactMs), JSON.stringify(next.partition), next.findings.some((finding) => finding.blocksApproval) ? "needs_review" : "resolved",
      next.minutes.eligibleTracked, next.minutes.break, next.minutes.inactivity, next.minutes.outside, next.minutes.held,
      next.minutes.recommended, next.minutes.manualExcluded, JSON.stringify(next)]);
    for (const finding of findings.filter((item) => item.day_id === day.id)) {
      const applied = next.findings.find((item) => item.key === finding.finding_key);
      await client.query(`UPDATE work_payroll_findings SET status=$4, resolution_note=$5, resolved_by=$6, resolved_at=now(), updated_at=now()
        WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 AND finding_key=$7`,
      [scope.organizationId, review.id, review.analysis_revision, applied?.status ?? "acknowledged", note, actor, finding.finding_key]);
      await client.query(`INSERT INTO work_payroll_decisions
        (organization_id,review_id,person_id,analysis_revision,finding_key,source_hash,decision,before_state,after_state,reason,
         actor_user_id,expected_row_version,idempotency_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13)
        ON CONFLICT (organization_id,idempotency_key) DO NOTHING`,
      [scope.organizationId, review.id, scope.personId, review.analysis_revision, finding.finding_key, finding.source_hash,
        decisionKind, JSON.stringify({ status: finding.status }), JSON.stringify({ status: applied?.status, action }),
        note, actor, review.row_version, `${requestKey}:${finding.finding_key}`]);
    }
  }
  const updatedDays = (await client.query(`SELECT result FROM work_payroll_days WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3`,
    [scope.organizationId, review.id, review.analysis_revision])).rows as Row[];
  const totals = { recorded: 0, eligibleTracked: 0, outside: 0, break: 0, inactivity: 0, held: 0, manualExcluded: 0, recommended: 0, approved: 0 };
  for (const row of updatedDays) {
    const minutes = (object(row.result).minutes ?? {}) as Row;
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(minutes[key] ?? 0);
  }
  const blocked = updatedDays.some((row) => {
    const result = object(row.result);
    const findings = Array.isArray(result.findings) ? result.findings as PayrollFinding[] : [];
    return (Array.isArray(result.blockers) && result.blockers.length > 0)
      || findings.some((finding) => finding.blocksApproval && !["acknowledged", "resolved_payable", "resolved_excluded"].includes(finding.status));
  });
  await client.query(`UPDATE work_payroll_reviews SET totals=$3::jsonb, status=$4, row_version=row_version+1, updated_at=now()
    WHERE organization_id=$1 AND id=$2`, [scope.organizationId, review.id, JSON.stringify(totals), blocked ? "needs_review" : "ready"]);
  await client.query(`INSERT INTO work_audit_log (organization_id,actor_user_id,action,target_type,target_id,metadata)
    VALUES ($1,$2,$3,'payroll_review',$4,$5::jsonb)`,
  [scope.organizationId, actor, `payroll.finding_${decisionKind}`, review.id, JSON.stringify({ findings: findingKeys, requestKey })]);
}

export async function resolvePayrollFindings(access: WorkOsAccess, reviewId: string, input: PayrollCommand & {
  findingIds: string[]; action: Action; note: string;
}): Promise<PayrollReview> {
  requireAdmin(access);
  const scope = await reviewScope(access, reviewId);
  if (!input.findingIds.length) throw new WorkOsValidationError("At least one finding is required.");
  if (!input.note.trim()) throw new WorkOsValidationError("A decision reason is required.");
  await payrollTransaction(scope, async (client) => {
    const review = await loadPayrollReviewRow(client, scope, reviewId);
    if (String(review.status) === "approved" || review.current_approval_id) {
      throw new WorkOsConflictError("Reopen the approved payroll review before changing findings.", "payroll_approved");
    }
    const existing = await client.query(`SELECT count(*)::int AS n FROM work_payroll_decisions WHERE organization_id=$1 AND idempotency_key=ANY($2::text[])`,
      [scope.organizationId, input.findingIds.map((id) => `${input.requestKey}:${id}`)]);
    if (Number(existing.rows[0].n) === input.findingIds.length) return;
    if (Number(existing.rows[0].n) > 0) throw new WorkOsConflictError("This payroll decision was partially recorded; reload it.", "payroll_decision_partial");
    verifyCommand(review, input);
    const revision = await client.query(`SELECT source_token FROM work_payroll_analysis_revisions
      WHERE organization_id=$1 AND review_id=$2 AND person_id=$3 AND analysis_revision=$4`,
    [scope.organizationId, reviewId, scope.personId, review.analysis_revision]);
    if (!revision.rows.length || !revision.rows[0].source_token) throw new WorkOsConflictError("Payroll sources are not frozen.", "payroll_sources_missing");
    await verifyPayrollSourceToken(client, scope, String(revision.rows[0].source_token));    await applyCommand(client, scope, review, input.findingIds, input.action, input.note.trim(), input.requestKey, access.ctx.user.id, input.action);
  });
  return loadPayrollReview(access, reviewId);
}

export async function addPayrollAdjustment(access: WorkOsAccess, reviewId: string, command: PayrollCommand & {
  findingId: string; action: "include" | "exclude" | "reverse"; span: Span | null; durationMs: number; priorDecisionId: string | null; reason: string;
}): Promise<PayrollReview> {
  requireAdmin(access);
  if (!command.reason.trim()) throw new WorkOsValidationError("A payroll adjustment reason is required.");
  if (!Number.isSafeInteger(command.durationMs) || command.durationMs <= 0) throw new WorkOsValidationError("A payroll adjustment duration must be positive.");
  if (command.span && (command.span.endMs <= command.span.startMs || command.durationMs !== command.span.endMs - command.span.startMs)) {
    throw new WorkOsValidationError("A payroll adjustment span must match its duration.");
  }
  const action: Action = command.action === "exclude" ? "excluded" : "payable";
  return resolvePayrollFindings(access, reviewId, { ...command, findingIds: [command.findingId], action, note: command.reason });
}

export { totalsFromJson, verifyCommand, approvalFromRow, object as payrollObject, iso as payrollIso, dateKey as payrollDateKey };
