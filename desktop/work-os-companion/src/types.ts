export type PromptKind = "plan" | "catch_up" | "optional" | "follow_up" | "hourly_fallback" | "eod" | null;

export interface WorkSession {
  id: string;
  state: "scheduled" | "clocked_in" | "active" | "paused" | "eod_due" | "clocked_out";
  scheduled_starts_at: string | null;
  scheduled_ends_at: string | null;
  clocked_in_at: string | null;
  clocked_out_at: string | null;
  paused_seconds: number;
  late_acknowledged_at?: string | null;
  late_reason?: string | null;
  late_reason_provided_at?: string | null;
  provider_break_seconds?: number;
  provider_break_observed_at?: string | null;
  provider_break_provenance?: Record<string, unknown> | null;
  attendance_status?: string | null;
  attendance_observed_at?: string | null;
  first_follow_up_at?: string | null;
  next_fallback_at?: string | null;
  last_prompt_kind?: "follow_up" | "hourly_fallback" | "eod" | null;
  last_prompt_at?: string | null;
}

export interface DailyPlanItem {
  id: string;
  task_id: string | null;
  source: "carry_over" | "overdue" | "due_today" | "existing" | "unplanned";
  disposition: "selected" | "deferred" | "removal_proposed" | "removed";
  rank: number;
  title_snapshot: string;
  blocker: string | null;
  item_kind: "nifty_task" | "outcome" | "local_task";
  completion_state: "open" | "completed";
  completed_at?: string | null;
  objective?: string | null;
  success_criteria?: string[];
  estimate_minutes?: number | null;
  source_refs?: Array<{ provider: string; type: string; id: string; label?: string }>;
  clarification_state?: "none" | "needs_clarification" | "resolved" | null;
}

export interface DailyPlan {
  id: string;
  status: "draft" | "confirmed" | "closed";
  freeform_intent: string | null;
  focus_summary?: string | null;
  interpretation_metadata?: Record<string, unknown>;
  clarification_answers?: Record<string, string>;
  goal_provenance?: "employee" | "suggested" | "accepted_suggestion" | "ai_draft" | null;
  suggestion_task_ids?: string[];
  shift_date: string;
  revision: number;
  confirmed_at?: string | null;
  updated_at?: string | null;
  items: DailyPlanItem[];
}

export interface InsightUpdateKinds {
  progress: number;
  starting: number;
  completionClaim: number;
  blocked: number;
  priorityChange: number;
  unplannedWork: number;
}

export interface InsightPlanAdherence {
  selected: number;
  selectedCompleted: number;
  deferred: number;
  removalProposed: number;
}

export interface InsightConsistency {
  dayCount: number;
  daysWithGoal: number;
  daysWithUpdate: number;
  daysWithCompletion: number;
  currentStreak: number;
  commitmentRate: number | null;
  bestDay: { date: string; tasksCompleted: number } | null;
}

export interface InsightComparison {
  range: "day" | "7d" | "30d";
  from: string;
  through: string;
  days: InsightDay[];
  totals: Omit<InsightDay, "date" | "planStatus" | "references">;
}

export interface InsightDay {
  date: string;
  observedSeconds: number;
  pausedSeconds: number;
  planStatus: "none" | "draft" | "confirmed" | "closed";
  planned: number;
  plannedCompleted: number;
  carryOver: number;
  overdue: number;
  updates: number;
  updatesByKind?: InsightUpdateKinds;
  /** Observed pause share of observed+paused time (0–1); never a productivity measure. */
  pauseRatio?: number;
  outputEvidence: number;
  activityContext: number;
  /** Worktivity app/site summary minutes for the day (neutral activity context). */
  trackedMinutes?: number;
  topApps?: Array<{ name: string; minutes: number }>;
  tasksCompleted: number;
  tasksOpen: number;
  goal?: { text: string | null; provenance: string | null };
  goalSet?: boolean;
  completed?: number;
  progressed?: number;
  deferred?: number;
  carried?: number;
  unplanned?: number;
  /** Outcomes completed on or before their due date; undated work is unclassified. */
  outcomesOnTime?: number;
  outcomesLate?: number;
  sessionCorrections?: number;
  planAdherence?: InsightPlanAdherence;
  breakFreshness?: "manual" | "observed" | "stale" | "unknown";
  sessionQuality?: { status: string; message: string | null; sessionId?: string | null; clockedInAt?: string | null };
  references: Array<{ type: "plan" | "task" | "check_in" | "evidence"; id: string; date: string; label: string; target: string }>;
}

export interface InsightsData {
  range: "day" | "7d" | "30d";
  from: string;
  through: string;
  days: InsightDay[];
  totals: Omit<InsightDay, "date" | "planStatus" | "references">;
  /** Range-level update mix; blocked/priority/unplanned stay visible. */
  updateKinds?: InsightUpdateKinds;
  /** Deterministic rhythm stats; absent on older cached payloads. */
  consistency?: InsightConsistency;
  /** The equal-length window immediately before this one, when the server provides it. */
  comparison?: InsightComparison;
  brief: { generated: boolean; summary: string; wins: string[]; attention: string[]; nextFocus: string[]; referenceIds: string[] };
  freshness: { niftySyncedAt: string | null; worktivityObservedAt: string | null; stale?: boolean; staleAt?: string | null; error?: string | null };
}

export interface DayData {
  at: string;
  shiftDate: string;
  shift: { startsAt: string; endsAt: string; timezone: string; breaks: Array<{ startsAt: string; endsAt: string }> } | null;
  prompt: { kind: PromptKind; nextPromptAt: string | null; required: boolean; reason: string };
  niftySync?: { fresh: boolean; syncing?: boolean; syncedAt: string | null; error?: string };
  signals?: {
    employeeUpdates: number;
    outputEvidence: number;
    activityContext: number;
    completedTasks: number;
    openTasks: number;
  };
  workspaceSummary?: {
    date: string;
    currentDate: string;
    readOnly: boolean;
    goal: { text: string | null; provenance: string | null; suggestionTaskIds: string[]; revision: number | null };
    completed: number;
    total: number;
    overdueCount: number;
    carryOverGroups: Array<{ key: string; label: string; tasks: Array<Record<string, any>> }>;
    sessionQuality: { status: string; message: string | null; sessionId?: string | null; clockedInAt?: string | null };
    cursor: { next: string | null };
  };
  tasks: Array<Record<string, any>>;
  taskHistory?: Array<Record<string, any>>;
  evidence: Array<Record<string, any>>;
  proposals: Array<Record<string, any>>;
  report: Record<string, any> | null;
  session: WorkSession | null;
  plan: DailyPlan | null;
  attendance?: AttendanceProjection;
  breakPolicy?: { worktivityAuthoritative: boolean };
  access?: { organizationId: string; role: string; personId: string; displayName?: string | null; featureFlags?: Record<string, boolean> };
}

export interface AttendanceProjection {
  source: "worktivity" | "work_os_fallback" | "unknown";
  state: "active" | "paused" | "off_shift" | "unknown";
  status: "clock_in" | "working" | "break" | "idle" | "clock_out" | "yet_to_start" | "unknown";
  observedAt: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
  activityObservedAt?: string | null;
  providerBreakSeconds?: number;
  stale: boolean;
  fallbackAllowed: boolean;
  message: string;
}

export type ProfileItemKind = "responsibility" | "deliverable" | "evidence";
export type ProfileItemSource = "imported" | "suggested" | "user";
export interface WorkProfileItem { id: string; kind: ProfileItemKind; label: string; source: ProfileItemSource }
export interface WorkArchetype {
  id: string; name: string; description: string; keywords: string[];
  specialties: Array<{ id: string; name: string }>;
  items: WorkProfileItem[];
}

export interface DesktopSession {
  token: string;
  expiresAt: string;
  organizationId: string;
  apiBase: string;
}

export type OnboardingRequirement =
  | "consentProvided"
  | "screenshotConsentProvided"
  | "profileConfirmed"
  | "timezoneProvided"
  | "scheduleProvided"
  | "notificationsConfigured"
  | "privacyAcknowledged";

export interface OnboardingSchedule {
  daysOfWeek: number[];
  shiftStart: string;
  shiftEnd: string;
  breaks: Array<{ start: string; end: string }>;
}

export interface OnboardingData {
  policy: { version: string; purpose: string; assurance: string; dataCategories: readonly string[] };
  onboardingRequired: boolean;
  employeeComplete: boolean;
  employeeRequirements: Record<OnboardingRequirement, boolean>;
  managerRequirements: {
    roleAssigned: boolean;
    teamAssigned: boolean;
    managerAssigned: boolean;
    officialScheduleConfigured: boolean;
  };
  profile: {
    displayName: string;
    email: string;
    avatarUrl: string | null;
    timezone: string;
    language: string;
    weekStart: number;
    timeFormat: string | null;
    schedule: OnboardingSchedule;
    notifications: { desktopEnabled: boolean };
    privacy: { screenshotAnalysisConsent: boolean; sensitiveAppExclusions: string[] };
    workPreferences: {
      archetypeId: string | null;
      inferredArchetypeId: string | null;
      customRoleTitle: string;
      specialtyIds: string[];
      items: WorkProfileItem[];
      responsibilities: string[];
      outputTypes: string[];
      evidenceSources: string[];
      voiceUpdatesEnabled: boolean;
      githubUsername: string;
    };
  };
  providerPrefill: {
    nifty: { mapped: boolean; timezone: string | null; language: string | null; team: string | null; role: string | null };
    worktivity: { mapped: boolean; screenshotsConfigured: boolean | null; screenshotsBlurred: boolean | null };
  };
  organizationSetup: {
    roleProfile: { id: string; slug: string; name: string } | null;
    teams: Array<{ id: string; name: string; active: boolean }>;
    managers: Array<{ id: string; display_name: string }>;
    officialSchedule: OnboardingSchedule | null;
  };
  status: string;
  submittedAt: string | null;
  draft: { step: string; updatedAt: string | null; revision: number };
  breakPolicy: { worktivityAuthoritative: boolean };
  screenshotPolicy: { retention: string; limitation: string; sensitiveCapture: string };
  catalog: { version: string; archetypes: WorkArchetype[] };
}

export type DebugOnboardingDetail = OnboardingRequirement | "roleAssigned" | "teamAssigned" | "managerAssigned" | "officialScheduleConfigured";
export type DebugDayState = "real" | "no_shift" | "scheduled" | "shift_start" | "clocked_in" | "paused" | "eod_due" | "catch_up" | "optional" | "final_hour" | "eod" | "clocked_out";

export interface DebugScenario {
  enabled: boolean;
  liveWrites?: boolean;
  syncBypass: boolean;
  companionForce?: string | null;
  planningState?: "required" | "ai_unavailable" | "conflict" | "offline" | null;
  authState: "real" | "unauthenticated";
  onboardingState: "real" | "complete" | "missing";
  invalidateOnboardingData: boolean;
  missingDetails: DebugOnboardingDetail[];
  dayState: DebugDayState;
  niftyFailure: boolean;
  emptyTasks: boolean;
  emptyEvidence: boolean;
  emptyProposals: boolean;
  queuedUpdates: number;
}

export interface OfflineAction {
  id: string;
  method: "POST" | "PUT" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: string;
  /** Interpretation responses are preserved locally until the employee reviews them. */
  status?: "pending" | "ready_for_review" | "needs_attention";
  result?: unknown;
  failureKind?: "conflict" | "permanent" | "retry_exhausted";
  statusCode?: number;
}

export type OutstandingEodStatus = "no_draft" | "draft_unsubmitted" | "changes_requested";

export interface OutstandingEodDay {
  date: string;
  status: OutstandingEodStatus;
  reportId: string | null;
  observedMinutes: number;
  completedTasks: number;
  hasPlan: boolean;
}

export interface OutstandingEodsData {
  from: string;
  through: string;
  count: number;
  days: OutstandingEodDay[];
}

export interface EodScreenshotItem {
  summaryId: string;
  capturedAt: string;
  visibleApp: string | null;
  summary: string;
  confidence: number;
}

export interface EodScreenshotGallery {
  processed: number;
  excludedPolicy: number;
  excludedSensitive: number;
  unavailable: number;
  /** Recorded frames still awaiting analysis (failed frames retry). */
  pending: number;
  /** Frames recorded for the day so far. */
  total: number;
  viewable: EodScreenshotItem[];
  /** One synthesized activity line per local hour. */
  hours?: EodScreenshotHour[];
}

/** One synthesized activity line per local hour; `synthesized: false` marks a
 * truthful counts-only fallback when the summarizer was unavailable. */
export interface EodScreenshotHour {
  hourStart: number;
  label: string;
  summary: string;
  frameCount: number;
  summaryId: string | null;
  visibleApp: string | null;
  synthesized: boolean;
}

/** One bounded on-demand Worktivity preparation batch for an EOD day. */
export interface EodScreenshotPreparation {
  date: string;
  analyzed: number;
  failed: number;
  pending: number;
  total: number;
  sampled: number;
  /** The provider serves no retrievable frames for this day; stop waiting. */
  unavailable: boolean;
}
