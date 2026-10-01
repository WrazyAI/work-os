/** Shared client model for the employee workspace routes.
 *
 * The day/insights/outstanding payload shapes and the small formatting helpers
 * live here so Today, Tasks, Review, Insights, and Settings read the same
 * contract instead of re-declaring it per view. The insight types mirror the
 * server payload the companion reads, so both surfaces can render the same
 * deterministic record. */

export type AnyRow = Record<string, any>;

export interface EmployeeDayResponse {
  at: string;
  shiftDate: string;
  access?: { featureFlags?: Record<string, boolean>; capabilities?: { voice_input?: boolean } };
  shift: {
    startsAt: string;
    endsAt: string;
    timezone: string;
    breaks: Array<{ startsAt: string; endsAt: string }>;
  } | null;
  prompt: { kind: "plan" | "catch_up" | "optional" | "follow_up" | "hourly_fallback" | "eod" | null; nextPromptAt: string | null; required: boolean; reason: string };
  niftySync?: { fresh: boolean; syncing?: boolean; syncedAt: string | null; error?: string };
  signals?: {
    employeeUpdates: number;
    outputEvidence: number;
    activityContext: number;
    completedTasks: number;
    openTasks: number;
  };
  tasks: AnyRow[];
  evidence: AnyRow[];
  proposals: AnyRow[];
  report: AnyRow | null;
  session: AnyRow | null;
  plan: { id: string; status: "draft" | "confirmed" | "closed"; freeform_intent: string | null; focus_summary?: string | null; revision: number; items: AnyRow[]; interpretation_metadata?: AnyRow | null; clarification_answers?: AnyRow | null } | null;
  workspaceSummary?: {
    date: string; readOnly: boolean; completed: number; total: number; overdueCount: number;
    goal: { text: string | null; provenance: string | null; revision: number | null };
    carryOverGroups: Array<{ key: string; label: string; tasks: AnyRow[] }>;
    sessionQuality: { status: string; message: string | null; sessionId?: string | null; clockedInAt?: string | null };
  };
  attendance?: AnyRow;
  breakPolicy?: { worktivityAuthoritative: boolean };
}

export interface EmployeeTaskDayResponse {
  tasks: AnyRow[];
  workspace: NonNullable<EmployeeDayResponse["workspaceSummary"]> & { goal: { text: string | null; provenance: string | null; revision: number | null } };
  cursor: { next: string | null };
}

/* ── Insights payload (mirrors the companion's InsightsData) ────────────── */

export interface InsightUpdateKinds {
  progress?: number;
  starting?: number;
  completionClaim?: number;
  blocked?: number;
  priorityChange?: number;
  unplannedWork?: number;
  [key: string]: number | undefined;
}

export interface InsightPlanAdherence {
  planned?: number;
  completed?: number;
  deferred?: number;
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
  pauseRatio?: number;
  outputEvidence: number;
  activityContext: number;
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
  outcomesOnTime?: number;
  outcomesLate?: number;
  sessionCorrections?: number;
  planAdherence?: InsightPlanAdherence;
  breakFreshness?: "manual" | "observed" | "stale" | "unknown";
  sessionQuality?: { status: string; message: string | null; sessionId?: string | null; clockedInAt?: string | null };
  references: Array<{ type?: string; id: string; date?: string; label: string; target: string }>;
}

export interface InsightConsistency {
  dayCount: number;
  daysWithGoal: number;
  daysWithUpdate: number;
  daysWithCompletion: number;
  bestDay: { date: string; tasksCompleted: number } | null;
  currentStreak: number;
  commitmentRate: number | null;
}

export interface InsightComparison {
  from?: string;
  through?: string;
  totals?: Partial<InsightDay>;
  days?: InsightDay[];
}

export interface EmployeeInsightsResponse {
  range: "day" | "7d" | "30d";
  from: string;
  through: string;
  days: InsightDay[];
  totals: Omit<InsightDay, "date" | "planStatus" | "references">;
  updateKinds?: InsightUpdateKinds;
  consistency?: InsightConsistency;
  comparison?: InsightComparison;
  evidenceSources?: Array<{ provider: string; connected: boolean; enabled: boolean; verifiedForPerson: boolean; evidenceCount: number }>;
  brief: { generated?: boolean; summary: string; wins: string[]; attention: string[]; nextFocus: string[]; referenceIds?: string[] };
  freshness: { niftySyncedAt?: string | null; worktivityObservedAt?: string | null; stale?: boolean; staleAt?: string | null; error?: string | null };
}

/* ── Outstanding EODs ───────────────────────────────────────────────────── */

export interface OutstandingEodDay {
  date: string;
  status: "no_draft" | "draft_unsubmitted" | "changes_requested";
  reportId: string | null;
  observedMinutes: number;
  completedTasks: number;
  hasPlan: boolean;
}

export interface OutstandingEodsResponse {
  from: string;
  through: string;
  count: number;
  days: OutstandingEodDay[];
}

/* ── Activity interval reviews (recaps) ─────────────────────────────────── */

export interface ActivityIntervalEvidence {
  summaryId: string | null;
  capturedAt: string;
  visibleApp: string | null;
  frameSummary: string | null;
  usedInModel: boolean;
  rawImageShown: boolean;
  selectionReason: string | null;
  retained: boolean;
}

export interface ActivityInterval {
  id: string;
  windowStart: string;
  windowEnd: string;
  label: string;
  promptKind: "follow_up" | "hourly_fallback";
  generationStatus: "preparing" | "ready" | "unavailable" | "failed";
  reviewStatus: "inferred" | "confirmed" | "amended";
  headline: string | null;
  detail: string | null;
  activities?: string[];
  workflow?: string[];
  uncertainties?: string[];
  employeeFeedback: string | null;
  failureReason: string | null;
  generatedAt: string | null;
  reviewedAt: string | null;
  evidenceExpired: boolean;
  evidenceCount: number;
  evidence: ActivityIntervalEvidence[];
}

export interface ActivityIntervalsResponse {
  date: string;
  intervals: ActivityInterval[];
}

/* ── Work memory ────────────────────────────────────────────────────────── */

export interface MemoryFact {
  id: string;
  content: string;
  summary: string | null;
  review_status: "candidate" | "confirmed" | "rejected";
  fact_key: string | null;
  local_date: string | null;
  occurred_at: string | null;
  created_at: string | null;
}

export interface MemoryRecentItem {
  id: string;
  kind: string;
  content: string;
  summary: string | null;
  local_date: string | null;
  occurred_at: string | null;
  source_table: string | null;
  created_at: string | null;
}

export interface WorkMemoryResponse {
  facts: MemoryFact[];
  recent: MemoryRecentItem[];
}

/* ── EOD screenshot evidence ────────────────────────────────────────────── */

export interface EodScreenshotItem {
  summaryId: string;
  capturedAt: string;
  visibleApp: string | null;
  summary: string;
  confidence: number;
}

export interface EodScreenshotHour {
  hourStart: number;
  label: string;
  summary: string;
  frameCount: number;
  summaryId: string | null;
  visibleApp: string | null;
  synthesized: boolean;
}

export interface EodScreenshotGallery {
  processed: number;
  excludedPolicy: number;
  excludedSensitive: number;
  unavailable: number;
  pending: number;
  total: number;
  viewable: EodScreenshotItem[];
  hours?: EodScreenshotHour[];
}

/* ── Shared helpers ─────────────────────────────────────────────────────── */

/** A response error that preserves the HTTP status, so callers can handle
 * gated flows (409) differently from a plain failure. */
export class HttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpError(body?.error || `Request failed: ${response.status}`, response.status);
  return body as T;
}

export function requestId(): string {
  return globalThis.crypto.randomUUID();
}

export function formatTime(value?: string | null, timezone?: string) {
  if (!value) return "--:--";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

/** "Sep 30, 2:15 PM" — provider freshness timestamps. */
export function formatDateTimeShort(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
  } catch {
    return "—";
  }
}

export function durationLabel(seconds: number) {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  return `${Math.floor(safe / 3600)}h ${Math.round((safe % 3600) / 60)}m`;
}

export function operationLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** Calendar day label for a checked YYYY-MM-DD value, without timezone drift. */
export function calendarDateLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "—";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return value;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", month: "long", day: "numeric" }).format(parsed);
  } catch {
    return value;
  }
}

export function weekdayLabel(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long" }).format(parsed);
  } catch {
    return null;
  }
}

/** "Tuesday, September 30" for the masthead eyebrow. */
export function longDateLabel(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || "My day";
  const parsed = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(parsed);
  } catch {
    return value;
  }
}
