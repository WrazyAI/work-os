/** Response contracts for the desktop administration workspace.
 *
 * These mirror the web admin module's API shapes so both surfaces describe the
 * same record; the desktop keeps its own copy so the Vite bundle never imports
 * Next.js modules. Rows whose database shape is wide stay loose on purpose. */

import type { EvidenceKind } from "@wrazy/work-os-shared/evidence-kinds";

export type AdminSection = "overview" | "people" | "tasks" | "review" | "payroll" | "insights" | "evidence" | "settings";

/** Deep-link focus carried when navigating between administration sections:
 * a person, report, or task opens its drawer, and the evidence section can
 * land on its activity-recap tab. */
export interface AdminSectionFocus {
  personId?: string;
  reportId?: string;
  taskId?: string;
  /** The task view a person measure opens. Completed is the Outcomes target. */
  taskView?: "open" | "completed" | "all";
  evidenceTab?: "evidence" | "recaps";
  /** The source a deep link should preselect on the Evidence page. */
  evidenceSource?: string;
  /** A reviewed recap opened from an administration record link. This is a
   * real recap target, deliberately distinct from an EOD `reportId`. */
  recapId?: string;
  workdayId?: string;
  updateId?: string;
  /** The settings page an administration entry should open, e.g. profile. */
  settingsPage?: string;
}

export type WorkOsOrgRole = "employee" | "manager" | "admin";

export interface SessionResponse {
  organizationId: string;
  organizationName?: string | null;
  role: WorkOsOrgRole;
  personId: string | null;
  userId: string;
  featureFlags: Record<string, boolean>;
}

export type AttendanceState = "active" | "paused" | "off_shift" | "unknown";
export type AttendanceFreshness = "fresh" | "stale" | "unknown";

export interface AdminOverviewPerson {
  personId: string;
  displayName: string;
  email: string | null;
  roleProfile: string | null;
  timezone: string | null;
  schedule: { arrangement?: "scheduled" | "flexible"; start: string; end: string; daysOfWeek: number[]; timezone: string } | null;
  attendance: {
    state: AttendanceState;
    source: "worktivity" | "none";
    observedAt: string | null;
    freshness: AttendanceFreshness;
    clockedInAt: string | null;
    clockedOutAt: string | null;
  };
  session: { state: string; clockedInAt: string | null; pausedSeconds: number; observedSeconds: number; correctionStatus: string | null } | null;
  updatesToday: number;
  substantiveUpdatesToday: number;
  /** Recaps the workspace generated for this person today, reviewed or not. */
  recapsToday: number;
  recapsReviewedToday: number;
  lastRecapAt: string | null;
  evidenceToday: number;
  tasksCompletedToday: number;
  lastUpdateAt: string | null;
  lastUpdateKind: string | null;
  eodToday: string | null;
  eodOutstanding: { days: number; latest: unknown } | null;
}

export interface AdminOverviewActivity {
  id: string;
  kind: "update" | "recap" | "task_completed" | "evidence" | "eod_submitted";
  at: string;
  personId: string | null;
  personName: string | null;
  title: string;
  detail: string | null;
  provenance: string | null;
}

export interface AdminOverviewAttention {
  code: string;
  severity: "info" | "warn" | "error";
  count: number;
  message: string;
  href: string | null;
}

export interface AdminTimeSeriesPoint {
  date: string;
  totalMinutes: number;
  people: Array<{ personId: string; name: string; minutes: number }>;
}

export interface AdminOverview {
  date: string;
  generatedAt: string;
  counts: {
    people: number;
    onShift: number;
    paused: number;
    offShift: number;
    unknown: number;
    updatesToday: number;
    substantiveUpdatesToday: number;
    /** Ready interval recaps generated today, including not-yet-reviewed ones. */
    recapsToday: number;
    recapsReviewedToday: number;
    tasksCompletedToday: number;
    tasksOpen: number;
    tasksOverdue: number;
    evidenceToday: number;
    evidenceActivityToday: number;
    evidenceOutputToday: number;
    reportsDraftedToday: number;
    reportsSubmittedToday: number;
    reportsPendingReview: number;
    pendingReviewOldestAt: string | null;
    eodOutstandingPeople: number;
    eodOutstandingDays: number;
    disputedEvidence: number;
  };
  people: AdminOverviewPerson[];
  recentActivity: AdminOverviewActivity[];
  attention: AdminOverviewAttention[];
  series: Array<{ date: string; completed: number; updates: number; recaps: number; evidence: number }>;
  timeSeries: AdminTimeSeriesPoint[];
  freshness: {
    niftySyncedAt: string | null;
    niftyTasksToday: number;
    worktivityObservedAt: string | null;
    githubLastEventAt: string | null;
    githubEventsToday: number;
    lastPlanAt: string | null;
    lastReportSubmittedAt: string | null;
  };
  readiness?: unknown;
}

export type AdminInsightRange = "7d" | "30d" | "90d";

export interface AdminInsightPersonRow {
  personId: string;
  displayName: string;
  roleProfile: string | null;
  outcomesCompleted: number;
  outcomesLate: number;
  updates: number;
  substantiveUpdates: number;
  eodSubmitted: number;
  eodApproved: number;
  eodRejected: number;
  planned: number;
  plannedCompleted: number;
  commitmentRate: number | null;
  trackedMinutes: number;
  evidenceOutput: number;
  evidenceActivity: number;
  sessionsNeedingCorrection: number;
  lastActivityAt: string | null;
}

export interface AdminInsightPersonDay {
  date: string;
  outcomesCompleted: number;
  updates: number;
  substantiveUpdates: number;
  eodSubmitted: number;
  observedMinutes: number;
  evidenceOutput: number;
  evidenceActivity: number;
}

export interface AdminInsightPersonSeries {
  personId: string;
  days: AdminInsightPersonDay[];
}

export interface AdminInsightTotals {
  outcomesCompleted: number;
  outcomesLate: number;
  updates: number;
  substantiveUpdates: number;
  eodSubmitted: number;
  eodApproved: number;
  eodRejected: number;
  planned: number;
  plannedCompleted: number;
  trackedMinutes: number;
  evidenceOutput: number;
  evidenceActivity: number;
  sessionsNeedingCorrection: number;
  activePeople: number;
}

export interface AdminInsightNotes {
  summary: string;
  wins: string[];
  attention: string[];
  nextFocus: string[];
}

export interface AdminInsights {
  range: AdminInsightRange;
  from: string;
  through: string;
  totals: AdminInsightTotals;
  previous: AdminInsightTotals;
  people: AdminInsightPersonRow[];
  series: Array<{ date: string; outcomesCompleted: number; updates: number; eodSubmitted: number; trackedMinutes: number }>;
  timeSeries: AdminTimeSeriesPoint[];
  peopleSeries: AdminInsightPersonSeries[];
  updateKinds: Array<{ kind: string; count: number }>;
  topApps: Array<{ name: string; minutes: number }>;
  overdueOpen: number | null;
  notes: AdminInsightNotes;
  freshness: { generatedAt: string };
}

export interface WorkOsReportRow {
  id: string;
  person_id: string | null;
  report_date: string;
  status: "draft" | "pending_review" | "approved" | "rejected";
  title: string;
  markdown: string;
  submitted_markdown: string | null;
  metrics: Record<string, unknown> | null;
  manager_notes: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  created_at: string;
  person?: { id: string; display_name: string; email: string | null } | null;
  versions?: Array<{ id: string; version_kind: string; created_at: string }>;
}

export interface ReportsResponse {
  reports: WorkOsReportRow[];
  counts: { draft: number; pending_review: number; approved: number; rejected: number; total: number };
  series?: Array<{ date: string; submitted: number; drafted: number; people?: Array<{ personId: string; name: string; submitted: number }> }>;
}

/** Verified performed GHL occurrences for one assignee in the last seven days.
 * It is context for the task drawer, never task completion evidence. */
export interface AdminTaskAssigneeGhl {
  personId: string;
  displayName: string;
  performed: number;
  lastAt: string | null;
}

export interface EvidenceRow {
  id: string;
  person_id: string | null;
  task_id: string | null;
  evidence_date: string;
  source: string;
  title: string;
  summary: string;
  url: string | null;
  metrics: Record<string, unknown> | null;
  created_at: string;
  /** Provider occurrence time when available, else the mirror write time. */
  recorded_at?: string | null;
  person?: { id: string; display_name: string } | null;
  task?: { id: string; title: string } | null;
  /** Provider-recorded GHL classification. `actorLabel` states who the record
   * says performed the action (or that it was automation / unknown), so the
   * row never implies a missing person mapping it does not have. */
  ghl?: {
    eventId?: string;
    relation?: string;
    actorLabel?: string | null;
    assigneeLabels?: string[];
    contentAvailability?: string;
    coverage?: string;
  } | null;
  event?: {
    correction_status?: string;
    evidence_class?: string;
    metadata?: Record<string, unknown>;
    screenshot?: unknown;
  } | null;
}

export interface EvidenceCoverageDay {
  date: string;
  count: number;
  emails: number;
}

export interface EvidenceCoveragePerson {
  /** null is the uncredited class: actor unknown, assigned-only, or automation. */
  personId: string | null;
  days: EvidenceCoverageDay[];
}

export interface EvidenceCoverage {
  people: EvidenceCoveragePerson[];
}

export interface EvidenceSummary {
  sources: Array<{ source: string; count: number }>;
  days: Array<{ date: string; count: number }>;
  kinds?: Array<{ kind: EvidenceKind; count: number }>;
  peopleCount?: number;
  peopleByBucket?: Partial<Record<"calls" | "emails" | "texts" | "work" | "context", number>>;
  /** The summary read hit its server bound; counts are disclosed as capped. */
  capped?: boolean;
  coverage?: EvidenceCoverage;
}

export interface EvidenceResponse {
  evidence: EvidenceRow[];
  summary?: EvidenceSummary;
}

export type ActivityIntervalView = {
  id: string;
  windowStart: string;
  windowEnd: string;
  label: string;
  promptKind: "follow_up" | "hourly_fallback";
  generationStatus: string;
  reviewStatus: "inferred" | "confirmed" | "amended";
  reviewSource?: "employee" | "admin" | "payroll_auto" | null;
  payrollDate?: string | null;
  headline: string | null;
  detail: string | null;
  recordedActivity?: Array<{ description: string; relation: "performed" | "triggered"; url: string | null; source?: "github" | "ghl"; eventId?: string }>;
  employeeFeedback: string | null;
  failureReason: string | null;
  generatedAt: string | null;
  reviewedAt: string | null;
  evidenceExpired: boolean;
  evidenceCount: number;
  evidence: Array<{ id: string; kind: string; summary: string | null; capturedAt: string | null }>;
};

export interface PersonDetailResponse {
  arrangementProposal?: import("@wrazy/work-os-shared/ui/ArrangementReview").ArrangementReviewData | null;
  person: {
    id: string;
    display_name: string;
    email: string | null;
    role_profile_id: string | null;
    nifty_member_id: string | null;
    worktivity_employee_id: string | null;
    active: boolean;
    role_profile?: { id: string; name: string } | null;
  };
  teams: Array<{ team_id: string; is_manager: boolean; team?: { id: string; name: string; active: boolean } | null }>;
  schedules: Array<Record<string, unknown>>;
  exceptions: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  /** The live row is wide and may omit fields; the drawer reads it loosely. */
  reports: Array<Record<string, any>>;
  updates: Array<Record<string, unknown>>;
  intervals: Array<Record<string, unknown>>;
  /** Exact ready-recap counts for the drawer's fourteen-day workday rows. */
  recapDays: Array<{ date: string; total: number; reviewed: number }>;
  evidenceSummary: { total: number; activity: number; output: number; ghl: number; disputed: number };
}

export interface PeopleResponse {
  people: Array<Record<string, any>>;
  roleProfiles: Array<{ id: string; name: string }>;
}

export interface GithubIntegrationActor {
  key: string;
  id: string | null;
  login: string | null;
  events: number;
  firstSeen: string | null;
  lastSeen: string | null;
  titles: string[];
  suggestion: { personId: string; displayName: string; githubUsername: string } | null;
}

export interface GithubIntegrationActorsResponse {
  actors: GithubIntegrationActor[];
  people: Array<{ id: string; displayName: string; githubUsername: string | null }>;
  totals: { unattributedEvents: number; lastEventAt: string | null };
  configuration: { webhookReceiverReady: boolean; repositoryManagementReady: boolean };
}

export interface GithubIntegrationReposResponse {
  connection: { id: string; workspace: string } | null;
  organization: string | null;
  repos: Array<{ full_name: string; private: boolean; default_branch: string; pushed_at: string | null }>;
  connectedRepos: Array<{ full_name: string; hook_id: string | null; created_at: string }>;
  webhookUrl: string;
  configuration: { repositoryManagementReady: boolean; webhookReceiverReady: boolean; orgWebhook?: boolean; reason?: string | null };
}

export interface OrganizationMembershipRow {
  id: string;
  user_id: string;
  person_id: string | null;
  email?: string | null;
  role: string;
  active: boolean;
  feature_flags?: Record<string, boolean> | null;
  person?: { id: string; display_name: string | null; email: string | null } | null;
}

export interface MemberPasswordResetResponse {
  sent: true;
  membershipId: string;
  email: string;
  sentAt: string;
  expiresAt: string;
  emailId: string | null;
}

export interface OrganizationResponse {
  organization: { id: string; name: string; slug: string; feature_flags: Record<string, boolean> | null; created_at: string };
  memberships: OrganizationMembershipRow[];
  teams: Array<{ id: string; name: string; active?: boolean; [key: string]: unknown }>;
  teamMembers: Array<{ team_id: string; person_id: string; is_manager: boolean; person?: { id: string; display_name: string | null; email: string | null } | null }>;
}

export interface ConnectionsResponse {
  connections: Array<Record<string, any>>;
  accounts: Array<Record<string, any>>;
}

export interface SystemStatusResponse {
  schema: { ready: boolean; migration: string; error?: string };
}

/** One embedded relation that may arrive as a row, an array of rows, or null. */
export function one<T extends Record<string, any>>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value && typeof value === "object" ? (value as T) : null;
}
