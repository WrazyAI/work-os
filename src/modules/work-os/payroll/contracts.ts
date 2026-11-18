/** Type-only payroll boundaries. No storage paths, provider credentials or raw
 * image material may appear in a public payroll projection. Input manifests are
 * private server records, even though their types have no runtime imports. */
export type PayrollScope = { organizationId: string; personId: string };
export type PayrollWeek = { week: 1 | 2; from: string; through: string };
export type PayrollPeriod = {
  payDate: string; from: string; through: string; timezone: string;
  weeks: [PayrollWeek & { week: 1 }, PayrollWeek & { week: 2 }];
};
export type Span = { startMs: number; endMs: number };
export type Category = "payable" | "break" | "inactivity" | "held" | "manual" | "outside";
export type CaptureSemantics = {
  version: string; verified: boolean; direction: "start" | "end" | "unknown"; durationMs: number;
};
export type RevisionToken = { rowVersion: string; analysisRevision: number; sourceHash: string };
export type PayrollCommand = RevisionToken & { requestKey: string };
export type PayrollCitation = {
  type: "interval" | "task" | "output" | "day" | "finding" | "brief" | "approval";
  id: string; revision: number;
};
export type ReviewSource = "employee" | "admin" | "payroll_auto";
export type PayrollFeatureState = { enabled: boolean; autoApprove: boolean; providerReady: boolean; modelsReady: boolean };
export type Page<T> = { items: T[]; total: number; nextCursor: string | null };

/** Server-internal normalized samples, never serialize as a roster or day DTO. */
export type NormalizedActivity = {
  id: string; employeeId: string; capturedAt: string; span: Span | null;
  activity: number | null; zeroEligible: boolean; status: number | null;
  app: string | null; title: string | null; domain: string | null; productivityCode: number | null;
};
export type PayrollAppContext = {
  items: { name: string; durationMs: number; productivityCode: number | null }[];
  complete: boolean; coverage: string[]; enumLabels: Record<string, string>;
};
export type PayrollProviderInput = {
  scope: PayrollScope; connectionId: string; bounds: Span; logs: NormalizedActivity[];
  complete: boolean; watermark: string; verifiedAt: string; semantics: CaptureSemantics; apps: PayrollAppContext;
};
export type PayrollTotals = {
  recorded: number; eligibleTracked: number; outside: number; break: number;
  inactivity: number; held: number; manualExcluded: number; recommended: number; approved: number;
};
export type PayrollFindingKind = "inactivity" | "break" | "outside_window" | "unverified_gap" | "low_evidence"
  | "activity_during_break" | "break_mismatch" | "possible_work" | "manual_adjustment" | "no_work"
  | "no_schedule" | "no_session" | "timezone_changed" | "source_conflict";
export type PayrollFindingStatus = "auto_payable" | "auto_excluded" | "needs_review" | "needs_correction"
  | "acknowledged" | "resolved_payable" | "resolved_excluded";
export type PayrollFindingEffect = "exclude" | "payable" | "hold" | "acknowledge" | "include_adjustment" | "exclude_adjustment";
export type PayrollFinding = {
  id: string; key: string; scope: PayrollScope; dayId: string; date: string;
  kind: PayrollFindingKind; status: PayrollFindingStatus; effect: PayrollFindingEffect;
  span: Span | null; durationMs: number; minutes: number; sourceHash: string;
  blocksApproval: boolean; requiredAction: "decide" | "acknowledge" | "correct" | "none";
  reason: string; citations: PayrollCitation[];
};
export type PayrollFrameContext = {
  scope: PayrollScope; summaryId: string; evidenceEventId: string; capturedAt: string;
  sourceHash: string; summary: string; app: string | null; findingKey: string; policyVersion: string;
};
export type PayrollFrameResult = {
  category: "work" | "meeting" | "training" | "reading" | "idle" | "nonwork" | "unclear";
  confidence: number; reason: string; app: string | null;
  sourceHash: string; model: string; promptVersion: string; classificationKey: string;
};
export type PayrollFrameSignal = {
  span: Span; category: PayrollFrameResult["category"]; confidence: number;
  citations: PayrollCitation[]; findingKey?: string;
};
export type PayrollDayInput = {
  scope: PayrollScope; date: string; week: 1 | 2; timezone: string;
  sessions: { id: string; recorded: Span | null; eligible: Span | null; closed: boolean;
    scheduleSource: string; correctionStatus: string }[];
  breaks: { span: Span; source: string }[]; pauseResidualMs: number; captures: NormalizedActivity[];
  exceptions: { span: Span; kind: "meeting" | "training" | "reading" | "work"; citations: PayrollCitation[] }[];
  frameSignals?: PayrollFrameSignal[];
  frameCandidates: PayrollFrameContext[]; blockers: string[]; sourceHash: string;
};
export type PayrollPartition = { span: Span; category: Category; findingKey: string | null }[];
export type FindingDecision = {
  requestKey: string; findingKey: string; sourceHash: string;
  action: "payable" | "excluded" | "acknowledged"; note: string;
};
export type PayrollDayResult = {
  id: string | null; scope: PayrollScope; date: string; week: 1 | 2;
  partition: PayrollPartition; exactMs: Record<Category, number>; minutes: PayrollTotals;
  findings: PayrollFinding[]; blockers: string[]; sourceHash: string; decisionKeys: string[];
  decisionState?: Record<string, "payable" | "excluded" | "acknowledged">;
  decisionAmounts?: Record<string, number>;
};
export type PayrollWeekSources = {
  scope: PayrollScope; week: 1 | 2; from: string; through: string; sourceHash: string;
  recaps: { id: string; revision: number; reviewVersion: number; reviewSource: ReviewSource | null;
    headline: string; detail: string; citations: PayrollCitation[]; date?: string }[];
  outcomes: { citation: PayrollCitation; text: string }[]; gaps: string[];
};
export type PayrollSourceManifest = {
  scope: PayrollScope; period: PayrollPeriod; asOf: string; sourceToken: string; policyVersion: string;
  days: PayrollDayInput[]; weekSources: [PayrollWeekSources, PayrollWeekSources]; hash: string;
  /** Expiry snapshots are shown to the operator but excluded from the
   * calculation hash: an expired raw image never rewrites source evidence. */
  rawImageExpiry?: Record<string, string | null>;
};
export type PayrollWeekBrief = {
  week: 1 | 2; status: "missing" | "generating" | "ready" | "failed" | "stale";
  title: string; summary: string; summaryCitations: PayrollCitation[];
  themes: { heading: string; detail: string; citations: PayrollCitation[] }[];
  openItems: { text: string; citations: PayrollCitation[] }[]; gaps: string[]; sourceHash: string;
};
export type PayrollRunStatus = "queued" | "running" | "done" | "failed" | "canceled";
export type PayrollProgress = {
  phase: "recaps" | "activity" | "evidence" | "classify" | "days" | "briefs" | "done";
  message: string; daysDone: number; days: number; framesClassified: number;
  framesReused: number; findings: number; remaining: number; status: PayrollRunStatus; nextAttemptAt: string | null;
};
export type PayrollRun = {
  id: string; reviewId: string; scope: PayrollScope; targetRevision: number;
  asOf: string; progress: PayrollProgress; rowVersion: string;
};
export type PayrollReviewStatus = "draft" | "analyzing" | "ready" | "needs_review" | "approved" | "reopened" | "failed" | "stale";
export type PayrollApproval = {
  id: string; reviewId: string; scope: PayrollScope; revision: number; period: PayrollPeriod;
  approvedAt: string; approvedBy: string; note: string | null; totals: PayrollTotals;
  days: { date: string; minutes: PayrollTotals; status: string }[]; briefs: PayrollWeekBrief[];
  snapshotHash: string; schemaVersion: string; identity: { displayName: string }; findings: PayrollFinding[];
};
export type PayrollReview = {
  id: string; scope: PayrollScope; period: PayrollPeriod; token: RevisionToken;
  status: PayrollReviewStatus; totals: PayrollTotals; briefs: PayrollWeekBrief[]; blockers: string[];
  run: PayrollRun | null; approval: PayrollApproval | null; retentionExpiresAt: string;
  firstExportAt: string | null; evidenceChangedSinceApproval: boolean; providerVerifiedAt: string | null;
};
export type PayrollRosterPage = Page<{
  personId: string; displayName: string; active: boolean; mapped: boolean; reviewId: string | null;
  status: string; totals: PayrollTotals; workdays: number;
}> & { period: PayrollPeriod; counts: Record<string, number> };
export type PayrollQuestionInput = {
  threadId: string; token: RevisionToken; approvalId: string | null; question: string;
};
export type PayrollQuestionTurn = {
  id: string; threadId: string; analysisRevision: number; approvalId: string | null; question: string;
  blocks: { text: string; citations: PayrollCitation[] }[]; status: "pending" | "ready" | "failed";
  limitations: string[]; createdAt: string;
};
export type PayrollPurgeResult = { reviews: number; artifacts: number; auditEntries: number; remaining: number };
