/** Shared client model for the employee workspace routes.
 *
 * The day/insights/outstanding payload shapes and the small formatting helpers
 * live here so Today, Tasks, Review, Insights, and Settings read the same
 * contract instead of re-declaring it per view. */

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
  niftySync?: { fresh: boolean; syncedAt: string | null; error?: string };
  tasks: AnyRow[];
  evidence: AnyRow[];
  proposals: AnyRow[];
  report: AnyRow | null;
  session: AnyRow | null;
  plan: { id: string; status: "draft" | "confirmed" | "closed"; freeform_intent: string | null; focus_summary?: string | null; items: AnyRow[] } | null;
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

export interface EmployeeInsightsResponse {
  range: "day" | "7d" | "30d";
  from: string;
  through: string;
  days: Array<{
    date: string;
    goal: { text: string | null; provenance: string | null };
    completed: number;
    progressed: number;
    deferred: number;
    carried: number;
    unplanned: number;
    breakFreshness: string;
    sessionQuality: { status: string; message: string | null };
    references: Array<{ id: string; label: string; target: string }>;
  }>;
  brief: { summary: string; wins: string[]; attention: string[]; nextFocus: string[] };
  freshness: { stale: boolean; staleAt: string | null; error: string | null };
}

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

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error || `Request failed: ${response.status}`);
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
