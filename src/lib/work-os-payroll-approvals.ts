import { createHash } from "node:crypto";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { verifyPayrollSourceToken } from "@/lib/work-os-payroll-freshness";
import {
  approvalFromRow, loadPayrollReview, loadPayrollReviewRow, payrollObject, reviewScope,
  payrollTransaction, totalsFromJson, verifyCommand, payrollDateKey,
} from "@/lib/work-os-payroll-decisions";
import type {
  PayrollApproval, PayrollCommand, PayrollReview, PayrollTotals,
} from "@/modules/work-os/payroll/contracts";

type Row = Record<string, unknown>;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
function requireAdmin(access: WorkOsAccess): void {
  if (access.role !== "admin") throw new WorkOsValidationError("Payroll approval is admin-only.");
}
function totalsOfDays(days: Row[]): PayrollTotals {
  const totals = { recorded: 0, eligibleTracked: 0, outside: 0, break: 0, inactivity: 0, held: 0, manualExcluded: 0, recommended: 0, approved: 0 };
  for (const day of days) {
    const minutes = payrollObject(payrollObject(day.result).minutes);
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(minutes[key] ?? 0);
  }
  return totals;
}

export async function approvePayrollReview(access: WorkOsAccess, reviewId: string, input: PayrollCommand & { note?: string }): Promise<PayrollApproval> {
  requireAdmin(access);
  if (!input.requestKey.trim()) throw new WorkOsValidationError("An approval request key is required.");
  const scope = await reviewScope(access, reviewId);
  const result = await payrollTransaction(scope, async (client) => {
    const review = await loadPayrollReviewRow(client, scope, reviewId);
    const existing = await client.query(`SELECT * FROM work_payroll_approvals WHERE organization_id=$1 AND review_id=$2 AND request_key=$3`, [scope.organizationId, reviewId, input.requestKey]);
    if (existing.rows.length) return approvalFromRow(existing.rows[0], scope, await periodOf(client, review));
    verifyCommand(review, input);
    if (String(review.status) === "approved") throw new WorkOsConflictError("This payroll review is already approved.", "payroll_already_approved");
    if (String(review.status) !== "ready") throw new WorkOsConflictError("Re-analyze this payroll review before approval.", "payroll_not_ready");
    const locked = await client.query(`SELECT row_version,status FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [scope.organizationId, reviewId]);
    if (!locked.rows.length || String(locked.rows[0].status) !== "ready") throw new WorkOsConflictError("Re-analyze this payroll review before approval.", "payroll_not_ready");
    review.row_version = locked.rows[0].row_version;
    const expires = review.retention_expires_at instanceof Date ? review.retention_expires_at.getTime() : Date.parse(String(review.retention_expires_at ?? ""));
    if (Number.isFinite(expires) && expires <= Date.now()) throw new WorkOsConflictError("Payroll records for this period expired.", "payroll_expired");
    const priorRow = review.current_approval_id
      ? await client.query(`SELECT id FROM work_payroll_approvals WHERE organization_id=$1 AND review_id=$2 AND id=$3`, [scope.organizationId, reviewId, review.current_approval_id])
      : await client.query(`SELECT id FROM work_payroll_approvals WHERE organization_id=$1 AND review_id=$2 ORDER BY revision DESC LIMIT 1`, [scope.organizationId, reviewId]);
    const active = await client.query(`SELECT 1 FROM work_payroll_runs WHERE organization_id=$1 AND review_id=$2 AND status IN ('queued','running') LIMIT 1`, [scope.organizationId, reviewId]);
    if (active.rows.length) throw new WorkOsConflictError("Payroll analysis is still running and blocks approval.", "payroll_run_active");
    const pendingRecaps = await client.query(`SELECT 1 FROM work_activity_intervals
      WHERE organization_id=$1 AND person_id=$2 AND generation_status='ready' AND review_status='inferred'
        AND local_date::date BETWEEN $3::date AND $4::date LIMIT 1`,
    [scope.organizationId, scope.personId, review.period_start, review.period_end]);
    if (pendingRecaps.rows.length) throw new WorkOsConflictError("Pending employee recaps must be settled before payroll approval.", "payroll_recaps_pending");
    const blocking = await client.query(`SELECT finding_key FROM work_payroll_findings
      WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3
        AND blocks_approval AND status IN ('needs_review','needs_correction') LIMIT 1`,
    [scope.organizationId, reviewId, review.analysis_revision]);
    if (blocking.rows.length) throw new WorkOsConflictError("A held or correction-required payroll finding blocks approval.", "payroll_findings_unresolved");
    const revision = (await client.query(`SELECT source_token,policy_version,as_of FROM work_payroll_analysis_revisions
      WHERE organization_id=$1 AND review_id=$2 AND person_id=$3 AND analysis_revision=$4`,
    [scope.organizationId, reviewId, scope.personId, review.analysis_revision])).rows[0];
    if (!revision || !revision.source_token) throw new WorkOsConflictError("Payroll source evidence is not frozen.", "payroll_sources_missing");
    await verifyPayrollSourceToken(client, scope, String(revision.source_token));
    const days = (await client.query(`SELECT * FROM work_payroll_days
      WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ORDER BY local_date`,
    [scope.organizationId, reviewId, review.analysis_revision])).rows as Row[];
    if (!days.length) throw new WorkOsConflictError("Payroll analysis has no daily record.", "payroll_days_missing");
    const totals = totalsOfDays(days);
    if (totals.held !== 0) throw new WorkOsConflictError("Held payroll minutes must be resolved before approval.", "payroll_held_minutes");
    const approvedTotals = { ...totals, approved: totals.recommended };
    const briefs = (await client.query(`SELECT week,status,title,summary_markdown,summary_citations,themes,open_items,gaps,source_hash
      FROM work_payroll_week_briefs WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ORDER BY week`,
    [scope.organizationId, reviewId, review.analysis_revision])).rows as Row[];
    const findings = (await client.query(`SELECT finding_key,kind,status,effect,start_at,end_at,minutes,reason,source_hash
      FROM work_payroll_findings WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ORDER BY finding_key`,
    [scope.organizationId, reviewId, review.analysis_revision])).rows as Row[];
    const decisions = (await client.query(`SELECT finding_key,decision,reason,actor_user_id,created_at,prior_decision_id
      FROM work_payroll_decisions WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3 ORDER BY created_at`,
    [scope.organizationId, reviewId, review.analysis_revision])).rows as Row[];
    const person = (await client.query(`SELECT display_name FROM work_people WHERE organization_id=$1 AND id=$2`, [scope.organizationId, scope.personId])).rows[0];
    const period = await periodOf(client, review);
    const snapshot = {
      schemaVersion: "payroll-approval-v1",
      period,
      identity: { displayName: String(person?.display_name ?? "Employee") },
      totals: { ...totals, approved: totals.recommended },      exact: days.map((day) => ({ date: payrollDateKey(day.local_date), exactMs: day.exact_ms })),
      days: days.map((day) => ({ date: payrollDateKey(day.local_date), minutes: { ...object(day.result).minutes as unknown as PayrollTotals, approved: Number(object(object(day.result).minutes).recommended ?? 0) }, status: day.status })),
      briefs: briefs.map((brief) => ({
        week: brief.week, status: brief.status, title: brief.title, summary: brief.summary_markdown,
        summaryCitations: brief.summary_citations ?? [], themes: brief.themes ?? [], openItems: brief.open_items ?? [],
        gaps: brief.gaps ?? [], sourceHash: brief.source_hash,
      })),
      findings: findings.map((finding) => ({
        key: finding.finding_key, kind: finding.kind, status: finding.status, effect: finding.effect,
        startAt: finding.start_at, endAt: finding.end_at, minutes: finding.minutes, reason: finding.reason, sourceHash: finding.source_hash,
      })),
      decisions: decisions.map((decision) => ({
        findingKey: decision.finding_key, decision: decision.decision, reason: decision.reason,
        actorUserId: decision.actor_user_id, at: decision.created_at, priorDecisionId: decision.prior_decision_id,
      })),
      sourceExplanation: {
        sourceHash: review.source_hash, sourceToken: revision.source_token,
        policyVersion: revision.policy_version, asOf: revision.as_of,
      },
      approvedBy: access.ctx.user.id, approvedAt: new Date().toISOString(),
    };
    const snapshotHash = hash(snapshot);
    const prior = priorRow.rows[0]?.id ? String(priorRow.rows[0].id) : null;
    const nextRevision = Number((await client.query(`SELECT coalesce(max(revision),0)+1 AS revision FROM work_payroll_approvals WHERE organization_id=$1 AND review_id=$2`, [scope.organizationId, reviewId])).rows[0].revision);
    const inserted = await client.query(`INSERT INTO work_payroll_approvals
      (organization_id,review_id,person_id,analysis_revision,revision,snapshot,approved_minutes,approved_by,note,
       prior_approval_id,snapshot_hash,export_schema_version,request_key)
      VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,'payroll-approval-v1',$12) RETURNING *`,
    [scope.organizationId, reviewId, scope.personId, review.analysis_revision, nextRevision, JSON.stringify(snapshot),
      totals.recommended, access.ctx.user.id, input.note?.trim() || null, prior, snapshotHash, input.requestKey]);
    const approval = inserted.rows[0];
    await client.query(`UPDATE work_payroll_days SET approved_minutes=recommended_minutes, updated_at=now()
      WHERE organization_id=$1 AND review_id=$2 AND analysis_revision=$3`,
    [scope.organizationId, reviewId, review.analysis_revision]);
    const published = await client.query(`UPDATE work_payroll_reviews SET status='approved', current_approval_id=$3,
      approved_minutes=$4, approved_by=$5, approved_at=now(), approval_note=$6, totals=$7::jsonb,
      retention_expires_at=greatest(retention_expires_at, now()+interval '30 days', pay_date + interval '30 days'),
      evidence_changed_since_approval=false, row_version=row_version+1, updated_at=now()
      WHERE organization_id=$1 AND id=$2`, [scope.organizationId, reviewId, approval.id, totals.recommended, access.ctx.user.id, input.note?.trim() || null, JSON.stringify(approvedTotals)]);
    const after = await client.query(`SELECT row_version,status FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2`, [scope.organizationId, reviewId]);
    if (!after.rows.length || String(after.rows[0].status) !== "approved" || Number(after.rows[0].row_version) !== Number(review.row_version) + 1) {
      throw new WorkOsConflictError("The payroll review changed before approval could be recorded.", "review_version_conflict");
    }
    await client.query(`INSERT INTO work_audit_log (organization_id,actor_user_id,action,target_type,target_id,metadata)
      VALUES ($1,$2,'payroll.approved','payroll_review',$3,$4::jsonb)`,
    [scope.organizationId, access.ctx.user.id, reviewId, JSON.stringify({ approvalId: approval.id, revision: nextRevision, snapshotHash, approvedMinutes: totals.recommended })]);
    return approvalFromRow(approval, scope, period);
  });
  return result;
}

async function periodOf(client: import("pg").PoolClient, review: Row): Promise<PayrollReview["period"]> {
  const { resolvePayrollPeriod } = await import("@/lib/work-os-payroll-period");
  return resolvePayrollPeriod(payrollDateKey(review.pay_date)!, String(review.timezone));
}

export async function reopenPayrollReview(access: WorkOsAccess, reviewId: string, input: PayrollCommand & { reason: string }): Promise<PayrollReview> {
  requireAdmin(access);
  if (!input.reason.trim()) throw new WorkOsValidationError("A reopen reason is required.");
  const scope = await reviewScope(access, reviewId);
  await payrollTransaction(scope, async (client) => {
    const review = await loadPayrollReviewRow(client, scope, reviewId);
    verifyCommand(review, input);
    if (String(review.status) !== "approved") throw new WorkOsConflictError("Only an approved payroll review can be reopened.", "payroll_not_approved");
    const expires = review.retention_expires_at instanceof Date ? review.retention_expires_at.getTime() : Date.parse(String(review.retention_expires_at ?? ""));
    if (Number.isFinite(expires) && expires <= Date.now()) throw new WorkOsConflictError("Payroll records for this period expired.", "payroll_expired");
    await client.query(`UPDATE work_payroll_reviews SET status='reopened', current_approval_id=NULL,
      approved_minutes=NULL, approved_by=NULL, approved_at=NULL, approval_note=NULL,
      retention_expires_at=greatest(retention_expires_at, pay_date + interval '30 days'),
      row_version=row_version+1, updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [scope.organizationId, reviewId]);
    await client.query(`INSERT INTO work_audit_log (organization_id,actor_user_id,action,target_type,target_id,metadata)
      VALUES ($1,$2,'payroll.reopened','payroll_review',$3,$4::jsonb)`,
    [scope.organizationId, access.ctx.user.id, reviewId, JSON.stringify({ reason: input.reason.trim(), priorApprovalId: review.current_approval_id })]);
  });
  return loadPayrollReview(access, reviewId);
}

export { totalsFromJson, hash as payrollSnapshotHash };
