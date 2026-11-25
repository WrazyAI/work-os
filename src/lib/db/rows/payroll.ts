/**
 * Database row contracts for Work OS Payroll tables (`supabase/migrations/0078`–`0081`).
 *
 * Numeric/date columns that `pg` may return as `string | number` or `string | Date`
 * reflect the runtime driver shape so callers normalize explicitly instead of
 * relying on implicit `any`.
 */

export type PgTimestamp = string | Date;
export type PgDate = string | Date;

export interface CountRow {
  n: number;
}

export interface IdRow {
  id: string;
}

export interface WorkPayrollSettingsRow {
  organization_id: string;
  enabled: boolean;
  auto_approve_enabled: boolean;
  cutoff_hour: number;
  revision: number;
  provider_ready: boolean;
  models_ready: boolean;
  auto_approve_activated_at: PgTimestamp | null;
  updated_at: PgTimestamp;
}

export type PayrollReviewStatus =
  | "draft"
  | "analyzing"
  | "ready"
  | "needs_review"
  | "approved"
  | "reopened"
  | "failed"
  | "stale";

export interface WorkPayrollReviewRow {
  id: string;
  organization_id: string;
  person_id: string;
  period_start: PgDate;
  period_end: PgDate;
  pay_date: PgDate;
  timezone: string;
  status: PayrollReviewStatus;
  analysis_revision: number;
  row_version: string | number;
  source_hash: string;
  model: string | null;
  prompt_version: string | null;
  totals: Record<string, unknown>;
  current_approval_id: string | null;
  approved_minutes: number | null;
  approved_by: string | null;
  approved_at: PgTimestamp | null;
  approval_note: string | null;
  evidence_changed_since_approval: boolean;
  retention_expires_at: PgTimestamp;
  first_export_at: PgTimestamp | null;
  last_exported_at: PgTimestamp | null;
  last_analyzed_at: PgTimestamp | null;
  created_at: PgTimestamp;
  updated_at: PgTimestamp;
}

export interface WorkPayrollAnalysisRevisionRow {
  organization_id: string;
  review_id: string;
  person_id: string;
  analysis_revision: number;
  source_hash: string;
  policy_version: string;
  as_of: PgTimestamp;
  source_token: string;
  input_manifest: Record<string, unknown>;
  citation_snapshot: Record<string, unknown>;
  provider_watermark: string | null;
  provider_verified_at: PgTimestamp | null;
  resolved_policy: Record<string, unknown>;
  rounding_version: string;
  created_at: PgTimestamp;
}

export interface WorkPayrollDayRow {
  id: string;
  organization_id: string;
  review_id: string;
  person_id: string;
  analysis_revision: number;
  local_date: PgDate;
  week: 1 | 2;
  session_ids: unknown[];
  schedule_snapshot: Record<string, unknown>;
  status: "calculated" | "needs_review" | "resolved" | "no_schedule" | "no_session" | "no_work" | "leave";
  recorded_ms: string | number;
  eligible_ms: string | number;
  exact_ms: Record<string, unknown>;
  partition: unknown[];
  rounding_version: string;
  tracked_minutes: number;
  break_minutes: number;
  inactivity_minutes: number;
  outside_minutes: number;
  held_minutes: number;
  recommended_minutes: number;
  manual_excluded_minutes: number;
  approved_minutes: number;
  activity_summary: Record<string, unknown>;
  findings_summary: Record<string, unknown>;
  source_hash: string;
  original_result: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: PgTimestamp;
  updated_at: PgTimestamp;
}

export interface WorkPayrollFindingRow {
  id: string;
  organization_id: string;
  review_id: string;
  person_id: string;
  analysis_revision: number;
  day_id: string;
  finding_key: string;
  kind: string;
  status: string;
  effect: string;
  blocks_approval: boolean;
  required_action: string;
  start_at: PgTimestamp | null;
  end_at: PgTimestamp | null;
  duration_ms: string | number;
  minutes: number;
  reason: string;
  evidence: Record<string, unknown>;
  citations: unknown[];
  source_hash: string;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: PgTimestamp | null;
  created_at: PgTimestamp;
  updated_at: PgTimestamp;
}

export interface WorkPayrollDecisionRow {
  id: string;
  organization_id: string;
  review_id: string;
  person_id: string;
  analysis_revision: number;
  finding_key: string;
  source_hash: string;
  decision: "payable" | "excluded" | "acknowledged" | "corrected" | "adjusted";
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  reason: string;
  actor_user_id: string;
  expected_row_version: string | number;
  prior_decision_id: string | null;
  idempotency_key: string;
  created_at: PgTimestamp;
}

export interface WorkPayrollApprovalRow {
  id: string;
  organization_id: string;
  review_id: string;
  person_id: string;
  analysis_revision: number;
  revision: number;
  snapshot: Record<string, unknown>;
  approved_minutes: number;
  approved_by: string;
  approved_at: PgTimestamp;
  note: string | null;
  prior_approval_id: string | null;
  snapshot_hash: string;
  export_schema_version: string;
  request_key: string;
  created_at: PgTimestamp;
}

export interface WorkPayrollWeekBriefRow {
  id: string;
  organization_id: string;
  review_id: string;
  person_id: string;
  analysis_revision: number;
  week: 1 | 2;
  period_start: PgDate;
  period_end: PgDate;
  status: "missing" | "generating" | "ready" | "failed" | "stale";
  title: string;
  summary_markdown: string;
  summary_citations: unknown[];
  themes: unknown[];
  open_items: unknown[];
  gaps: unknown[];
  source_interval_ids: unknown[];
  sources: Record<string, unknown>;
  source_hash: string;
  model: string | null;
  prompt_version: string | null;
  error: string | null;
  generated_at: PgTimestamp | null;
  created_at: PgTimestamp;
  updated_at: PgTimestamp;
}

export interface WorkPayrollExportRow {
  id: string;
  organization_id: string;
  review_id: string;
  person_id: string;
  approval_id: string;
  kind: "summary" | "daily" | "csv" | "print";
  schema_version: string;
  snapshot_hash: string;
  payload: Buffer;
  payload_hash: string;
  actor_user_id: string;
  created_at: PgTimestamp;
}

/* Query projections shared across payroll read/approval/export modules */

export interface PayrollRosterQueryRow {
  review_id: string | null;
  status: PayrollReviewStatus | null;
  totals: Record<string, unknown> | null;
  person_id: string;
  display_name: string | null;
  active: boolean;
  audit_status: string | null;
  mapped: boolean;
}

export interface PayrollStatusCountRow {
  status: PayrollReviewStatus;
  n: number;
}

export interface PayrollDayProjectionRow {
  id: string;
  result: Record<string, unknown>;
  local_date: string;
  schedule_snapshot: Record<string, unknown>;
  sampled_frames: number;
}

export interface PayrollFindingWithDateRow extends WorkPayrollFindingRow {
  local_date: string;
}

export interface PayrollApprovalExportJoinRow extends WorkPayrollApprovalRow {
  review_person_id?: string;
  review_pay_date: PgDate;
  current_approval_id: string | null;
  timezone: string;
  retention_expires_at?: PgTimestamp;
}
