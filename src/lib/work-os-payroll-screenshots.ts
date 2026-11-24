import { getPool } from "@/lib/db/pool";
import { WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import { retainedScreenshotImage } from "@/lib/work-os-screenshots";

type Row = Record<string, unknown>;
type Deps = {
  audit?: (input: { organizationId: string; summaryId: string; actorUserId: string; reason: string }) => Promise<void>;
  loadImage?: (summaryId: string) => Promise<{ bytes: Uint8Array; contentType: string } | null>;
};

export class PayrollScreenshotError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; this.name = "PayrollScreenshotError"; }
}

function object(value: unknown): Row { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {}; }

async function auditAccess(input: { organizationId: string; summaryId: string; actorUserId: string; reason: string }): Promise<void> {
  try {
    await getPool().query(`INSERT INTO work_screenshot_access_log
      (organization_id,screenshot_summary_id,accessed_by,reason) VALUES ($1,$2,$3,$4)`,
    [input.organizationId, input.summaryId, input.actorUserId, input.reason]);
  } catch (error) {
    throw new Error(`record payroll screenshot access: ${error instanceof Error ? error.message : "audit failed"}`);
  }
}

async function summaryRow(organizationId: string, personId: string, summaryId: string): Promise<Row | null> {
  const { rows } = await getPool().query(`SELECT * FROM work_screenshot_summaries
    WHERE id=$1 AND organization_id=$2 AND person_id=$3`, [summaryId, organizationId, personId]);
  return rows[0] ?? null;
}

function summaryAvailable(row: Row | null, now: Date): row is Row {
  if (!row || row.deleted_at) return false;
  if (String(row.processing_status) !== "processed") return false;
  const expires = row.expires_at instanceof Date ? row.expires_at.getTime() : Date.parse(String(row.expires_at ?? ""));
  return Number.isFinite(expires) && expires > now.getTime();
}
function sensitive(row: Row): boolean {
  const visible = object(row.visible_context);
  if (visible.contains_sensitive_content === true || visible.containsSensitiveContent === true) return true;
  return typeof visible.sensitive_reason === "string" && visible.sensitive_reason.trim().length > 0;
}

/** Admin-only, finding-scoped image access. The audit row commits before any
 * bytes are read; ownership, expiry, policy and consent are checked twice. */
export async function previewPayrollScreenshot(access: WorkOsAccess, input: {
  reviewId: string; findingId: string; summaryId: string; reason: string; requestKey: string;
}, at: Date, deps: Deps = {}): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (access.role !== "admin") throw new PayrollScreenshotError(403, "forbidden", "Payroll image review is admin-only.");
  const reason = input.reason.replace(/\s+/g, " ").trim();
  if (!reason) throw new WorkOsValidationError("A reason is required to view a payroll screenshot.");
  if (reason.length > 500) throw new WorkOsValidationError("A screenshot reason must be 500 characters or fewer.");
  const { rows } = await getPool().query(`SELECT r.person_id, f.day_id, f.status, f.kind
    FROM work_payroll_reviews r JOIN work_payroll_findings f
      ON f.organization_id=r.organization_id AND f.review_id=r.id AND f.person_id=r.person_id
    WHERE r.organization_id=$1 AND r.id=$2 AND f.finding_key=$3 AND f.analysis_revision=r.analysis_revision`,
  [access.organizationId, input.reviewId, input.findingId]);
  const finding = rows[0];
  if (!finding) throw new PayrollScreenshotError(404, "not_found", "Payroll finding not found.");
  const reviewable = ["needs_review", "needs_correction"].includes(String(finding.status))
    || (String(finding.status) === "auto_excluded" && String(finding.kind) === "inactivity");
  if (!reviewable) {
    throw new PayrollScreenshotError(403, "resolved_finding", "Only an unresolved or disputed payroll finding, or an excluded inactivity run, can open a screenshot.");
  }
  const personId = String(finding.person_id);
  const link = await getPool().query(`SELECT 1 FROM work_payroll_frame_findings
    WHERE organization_id=$1 AND review_id=$2 AND person_id=$3 AND analysis_revision=(SELECT analysis_revision FROM work_payroll_reviews WHERE organization_id=$1 AND id=$2)
      AND day_id=$4 AND screenshot_summary_id=$5 LIMIT 1`,
  [access.organizationId, input.reviewId, personId, finding.day_id, input.summaryId]);
  if (!link.rows.length) throw new PayrollScreenshotError(403, "not_linked", "That screenshot is not attached to this payroll finding.");
  const first = await summaryRow(access.organizationId, personId, input.summaryId);
  if (!first) throw new PayrollScreenshotError(404, "not_found", "Screenshot not found.");
  if (!summaryAvailable(first, at)) throw new PayrollScreenshotError(410, "expired", "Screenshot is expired or unavailable.");
  if (sensitive(first)) throw new PayrollScreenshotError(403, "policy_excluded", "Screenshot is excluded by sensitive-content policy.");
  const consent = await employeeTrackingConsent(access.organizationId, personId);
  if (!consent.tracking || !consent.screenshotAnalysis) throw new PayrollScreenshotError(403, "consent", "Current tracking and screenshot consent are required.");
  await (deps.audit ?? auditAccess)({ organizationId: access.organizationId, summaryId: input.summaryId, actorUserId: access.ctx.user.id, reason });
  const image = await (deps.loadImage ?? retainedScreenshotImage)(input.summaryId);
  if (!image) throw new PayrollScreenshotError(410, "expired", "Screenshot bytes are unavailable.");
  const second = await summaryRow(access.organizationId, personId, input.summaryId);
  if (!summaryAvailable(second, at) || sensitive(second)) throw new PayrollScreenshotError(410, "expired", "Screenshot expired while it was being read.");
  return { bytes: image.bytes, contentType: image.contentType };
}
