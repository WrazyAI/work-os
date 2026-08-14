export type PromptKind = "plan" | "catch_up" | "optional" | "follow_up" | "hourly_fallback" | "eod" | null;

export interface WorkSession {
  id: string;
  state: "scheduled" | "clocked_in" | "active" | "paused" | "eod_due" | "clocked_out";
  scheduled_starts_at: string | null;
  scheduled_ends_at: string | null;
  clocked_in_at: string | null;
  clocked_out_at: string | null;
  paused_seconds: number;
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
}

export interface DailyPlan {
  id: string;
  status: "draft" | "confirmed" | "closed";
  freeform_intent: string | null;
  items: DailyPlanItem[];
}

export interface DayData {
  at: string;
  shiftDate: string;
  shift: { startsAt: string; endsAt: string; timezone: string; breaks: Array<{ startsAt: string; endsAt: string }> } | null;
  prompt: { kind: PromptKind; nextPromptAt: string | null; required: boolean; reason: string };
  niftySync?: { fresh: boolean; syncedAt: string | null; error?: string };
  tasks: Array<Record<string, any>>;
  evidence: Array<Record<string, any>>;
  proposals: Array<Record<string, any>>;
  report: Record<string, any> | null;
  session: WorkSession | null;
  plan: DailyPlan | null;
  attendance?: AttendanceProjection;
}

export interface AttendanceProjection {
  source: "worktivity" | "work_os_fallback" | "unknown";
  state: "active" | "paused" | "off_shift" | "unknown";
  status: "clock_in" | "working" | "break" | "idle" | "clock_out" | "yet_to_start" | "unknown";
  observedAt: string;
  clockedInAt: string | null;
  clockedOutAt: string | null;
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
  draft: { step: string; updatedAt: string | null };
  catalog: { version: string; archetypes: WorkArchetype[] };
}

export type DebugOnboardingDetail = OnboardingRequirement | "roleAssigned" | "teamAssigned" | "managerAssigned" | "officialScheduleConfigured";
export type DebugDayState = "real" | "no_shift" | "scheduled" | "shift_start" | "clocked_in" | "paused" | "eod_due" | "catch_up" | "optional" | "final_hour" | "eod" | "clocked_out";

export interface DebugScenario {
  enabled: boolean;
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
  method: "POST" | "PATCH";
  path: string;
  body: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
}
