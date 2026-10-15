import { apiRequest } from "../api";
import type {
  AdminInsights,
  AdminInsightRange,
  AdminInsightTotals,
  AdminOverview,
  AdminOverviewPerson,
  AdminTimeSeriesPoint,
  ActivityIntervalView,
  ConnectionsResponse,
  EvidenceResponse,
  EvidenceRow,
  GithubIntegrationActorsResponse,
  GithubIntegrationReposResponse,
  OrganizationResponse,
  PeopleResponse,
  PersonDetailResponse,
  ReportsResponse,
  SessionResponse,
  SystemStatusResponse,
  WorkOsReportRow,
} from "./types";

/** Response contracts the desktop shares with the web admin module. */
export type {
  AdminInsights,
  AdminInsightRange,
  AdminInsightTotals,
  AdminOverview,
  AdminOverviewPerson,
  AdminTimeSeriesPoint,
  ActivityIntervalView,
  ConnectionsResponse,
  EvidenceResponse,
  EvidenceRow,
  GithubIntegrationActorsResponse,
  GithubIntegrationReposResponse,
  OrganizationResponse,
  PeopleResponse,
  PersonDetailResponse,
  ReportsResponse,
  SessionResponse,
  SystemStatusResponse,
  WorkOsReportRow,
};export interface BlueprintsResponse {
  blueprints: Array<Record<string, any>>;
}
export interface FieldMappingsResponse {
  mappings: Array<Record<string, any>>;
}

/** A `work_tasks` row as the admin task APIs return it. The database column is
 * `title`; `name` survives only on provider-shaped payloads, so the pages keep
 * a title-first fallback. Project and assignee embeds are attached by the API. */
export interface AdminTaskRow {
  id?: string;
  title?: string | null;
  name?: string | null;
  completed?: boolean | null;
  due_date?: string | null;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  labels?: string[] | null;
  updated_at?: string | null;
  project?: { id?: string; name?: string | null } | null;
  assignees?: Array<Record<string, any>> | null;
  [key: string]: any;
}

/** Administration reads are revalidated on a short cadence; the roster and the
 * record can move while the operator watches them. */
export const ADMIN_STALE_MS = 45_000;
export const ADMIN_DETAIL_STALE_MS = 60_000;

export const adminKeys = {
  session: () => ["work-os", "session"] as const,
  overview: (date: string) => ["work-os", "admin", "overview", date] as const,
  insights: (range: AdminInsightRange, personId: string) => ["work-os", "admin", "insights", range, personId] as const,
  people: () => ["work-os", "admin", "people"] as const,
  projects: () => ["work-os", "admin", "projects"] as const,
  person: (personId: string) => ["work-os", "admin", "person", personId] as const,
  tasks: (filters: Record<string, string>) => ["work-os", "admin", "tasks", filters] as const,
  taskDetails: (taskId: string) => ["work-os", "admin", "task", taskId] as const,
  reports: (filters: Record<string, string>) => ["work-os", "admin", "reports", filters] as const,
  reportEvidence: (personId: string, date: string) => ["work-os", "admin", "report-evidence", personId, date] as const,
  reportIntervals: (personId: string, date: string) => ["work-os", "admin", "report-intervals", personId, date] as const,
  evidence: (filters: Record<string, string>) => ["work-os", "admin", "evidence", filters] as const,
  intervals: (filters: Record<string, string>) => ["work-os", "admin", "intervals", filters] as const,
  screenshots: (summaryId: string) => ["work-os", "admin", "screenshot", summaryId] as const,
  githubActors: () => ["work-os", "admin", "github", "actors"] as const,
  githubRepos: () => ["work-os", "admin", "github", "repos"] as const,
  organization: () => ["work-os", "admin", "organization"] as const,
  connections: () => ["work-os", "admin", "connections"] as const,
  fieldMappings: () => ["work-os", "admin", "field-mappings"] as const,
  blueprints: () => ["work-os", "admin", "blueprints"] as const,
  schedules: (personId: string) => ["work-os", "admin", "schedules", personId] as const,
  status: () => ["work-os", "admin", "status"] as const,
};

export function buildQuery(params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
}

async function get<T>(path: string): Promise<T> {
  return apiRequest<T>(path);
}

async function send<T>(path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  return apiRequest<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Every administration read is normalized before it reaches a page: the same
 * seam the employee `normalizeDay` uses. A fetcher returns the normalized
 * shape, so the pages and the persisted query cache only ever hold complete
 * records. */
async function getNormalized<T>(path: string, normalize: (raw: unknown) => T): Promise<T> {
  return normalize(await get<unknown>(path));
}

export const fetchSession = () => get<SessionResponse>("/api/work-os/session");
export const fetchAdminOverview = (date?: string) => getNormalized(`/api/work-os/admin/overview${buildQuery({ date })}`, normalizeAdminOverview);
export const fetchAdminInsights = (range: AdminInsightRange, personId: string, through?: string) =>
  getNormalized(`/api/work-os/admin/insights${buildQuery({ range, personId, through })}`, normalizeAdminInsights);
export const fetchPeople = () => getNormalized("/api/work-os/people", normalizePeople);
export const fetchProjects = () => getNormalized("/api/work-os/projects", normalizeProjects);
export const fetchPersonDetail = (personId: string) => getNormalized(`/api/work-os/admin/people/${encodeURIComponent(personId)}`, normalizePersonDetail);
export const fetchAdminTasks = (filters: Record<string, string>) => getNormalized(`/api/work-os/tasks${buildQuery(filters)}`, normalizeAdminTaskList);
export const fetchAdminTaskDetails = (taskId: string) => getNormalized(`/api/work-os/tasks/${encodeURIComponent(taskId)}`, normalizeAdminTaskDetails);
export const fetchAdminReports = (filters: Record<string, string>) => getNormalized(`/api/work-os/reports${buildQuery({ ...filters, limit: filters.limit ?? "200" })}`, normalizeReports);
export const fetchReportEvidence = (personId: string, date: string) => getNormalized(`/api/work-os/evidence${buildQuery({ personId, date, limit: "100" })}`, normalizeEvidence);
export const fetchReportIntervals = (personId: string, date: string) =>
  getNormalized(`/api/work-os/admin/activity-intervals${buildQuery({ personId, from: date, to: date, limit: "40" })}`, normalizeIntervals);
export const fetchAdminEvidence = (filters: Record<string, string>) => getNormalized(`/api/work-os/evidence${buildQuery(filters)}`, normalizeEvidence);
export const fetchAdminIntervals = (filters: Record<string, string>) =>
  getNormalized(`/api/work-os/admin/activity-intervals${buildQuery(filters)}`, normalizeIntervals);
export const fetchGithubActors = () => getNormalized("/api/work-os/admin/integrations/github/actors", normalizeGithubActors);
export const fetchGithubRepos = () => getNormalized("/api/work-os/admin/integrations/github/repos", normalizeGithubRepos);
export const fetchOrganization = () => getNormalized("/api/work-os/organization", normalizeOrganization);
export const fetchConnections = () => getNormalized("/api/work-os/integrations/connections", normalizeConnections);
export const fetchFieldMappings = () => getNormalized("/api/work-os/field-mappings", normalizeFieldMappings);
export const fetchBlueprints = () => getNormalized("/api/work-os/blueprints", normalizeBlueprints);
export const fetchSystemStatus = () => getNormalized("/api/work-os/status", normalizeSystemStatus);

export const completeAdminTask = (taskId: string, completed: boolean) =>
  send<{ task: Record<string, any>; providerStatus?: string }>(`/api/work-os/tasks/${encodeURIComponent(taskId)}/complete`, "POST", { completed });
export const createAdminTask = (body: Record<string, unknown>) => send<{ task: Record<string, any> }>("/api/work-os/tasks", "POST", body);
export const updateAdminPerson = (body: Record<string, unknown>) => send<{ person: Record<string, any> }>("/api/work-os/people", "PATCH", body);
export const reviewAdminReport = (reportId: string, body: { status: "approved" | "rejected"; markdown?: string; manager_notes?: string }) =>
  send<{ report: WorkOsReportRow }>(`/api/work-os/reports/${encodeURIComponent(reportId)}/review`, "PATCH", body);
export const draftAdminReport = (personId: string, date: string) => send<{ report: WorkOsReportRow }>("/api/work-os/reports/eod", "POST", { person_id: personId, date });
export const mapGithubActor = (input: { workspace: string; externalAccountId: string; personId: string; login: string | null }) =>
  send<{ attributed?: number }>("/api/work-os/integrations/connections", "PUT", {
    provider: "github",
    external_workspace_id: input.workspace,
    accounts: [{ external_account_id: input.externalAccountId, person_id: input.personId, verified: true, metadata: { login: input.login } }],
  });
export const connectGithubRepo = (repo: string) => send<Record<string, unknown>>("/api/work-os/admin/integrations/github/repos", "POST", { repo });
export const disconnectGithubRepo = (repo: string) =>
  send<Record<string, unknown>>(`/api/work-os/admin/integrations/github/repos${buildQuery({ repo })}`, "DELETE");
export const saveOrganizationFeatures = (featureFlags: Record<string, boolean>) => send<Record<string, unknown>>("/api/work-os/organization", "PATCH", { feature_flags: featureFlags });
export const organizationAction = (body: Record<string, unknown>) => send<Record<string, unknown>>("/api/work-os/organization", "POST", body);
export const organizationMembershipPatch = (body: Record<string, unknown>) => send<Record<string, unknown>>("/api/work-os/organization", "PATCH", body);
export const requestScreenshotAccess = (summaryId: string, reason: string) =>
  send<{ url: string }>(`/api/work-os/evidence/screenshots/${encodeURIComponent(summaryId)}/access`, "POST", { reason });
export const syncNiftyTasks = () => send<Record<string, unknown>>("/api/work-os/nifty/sync", "POST");

/* --- Response normalizers ------------------------------------------------
 *
 * The administration workspace reads a live record, so a 200 response can
 * still be partial: an embed that is absent, a null column, a collection the
 * caller's scope filtered out entirely, or a persisted cache entry written by
 * an older build. Every fetcher passes its response through one of these
 * normalizers (mirroring the employee `normalizeDay` seam) and each admin
 * query selects the same normalizer over whatever the cache holds. A missing
 * collection becomes the honest empty state the page already renders, never
 * an unguarded `.length`/`.map` and never "undefined"/"NaN"/"Invalid Date". */

type Loose = Record<string, any>;

function asRecord(value: unknown): Loose {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : {};
}

function asRows(value: unknown): Loose[] {
  return Array.isArray(value) ? (value as unknown[]).map(asRecord) : [];
}

function asText(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

function asTextOrNull(value: unknown): string | null {
  const text = asText(value).trim();
  return text ? text : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/** The stored instant only when it parses; an unreadable date stays "not
 * recorded" instead of becoming an "Invalid Date" render downstream. */
function asIsoOrNull(value: unknown): string | null {
  const text = asText(value).trim();
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

/** Absence is not a negative claim: only an explicit `false` reads as off. */
function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asTextArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => asText(entry)).filter((entry) => entry.length > 0) : [];
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  const text = asText(value);
  return (options as readonly string[]).includes(text) ? (text as T) : fallback;
}

const ATTENDANCE_STATES = ["active", "paused", "off_shift", "unknown"] as const;
const ATTENDANCE_FRESHNESS = ["fresh", "stale", "unknown"] as const;
const OVERVIEW_ACTIVITY_KINDS = ["update", "recap", "task_completed", "evidence", "eod_submitted"] as const;
const ATTENTION_SEVERITIES = ["info", "warn", "error"] as const;
const INSIGHT_RANGES = ["7d", "30d", "90d"] as const;
const REPORT_STATUSES = ["draft", "pending_review", "approved", "rejected"] as const;
const INTERVAL_REVIEW_STATUSES = ["inferred", "confirmed", "amended"] as const;

function normalizeTimeSeries(value: unknown): AdminTimeSeriesPoint[] {
  return asRows(value).map((point) => ({
    date: asText(point.date),
    totalMinutes: asNumber(point.totalMinutes),
    people: asRows(point.people).map((person) => ({
      personId: asText(person.personId),
      name: asText(person.name, "Unmapped person"),
      minutes: asNumber(person.minutes),
    })),
  }));
}

function normalizeOverviewPerson(row: Loose): AdminOverviewPerson {
  const attendance = asRecord(row.attendance);
  const session = row.session && typeof row.session === "object" ? asRecord(row.session) : null;
  const schedule = row.schedule && typeof row.schedule === "object" ? asRecord(row.schedule) : null;
  const outstanding = row.eodOutstanding && typeof row.eodOutstanding === "object" ? asRecord(row.eodOutstanding) : null;
  return {
    personId: asText(row.personId),
    displayName: asText(row.displayName, "Unknown"),
    email: asTextOrNull(row.email),
    roleProfile: asTextOrNull(row.roleProfile),
    timezone: asTextOrNull(row.timezone),
    // A present schedule means the workspace has one; the defaults are the
    // same ones the overview builder applies when a column is unset.
    schedule: schedule
      ? {
          start: asText(schedule.start, "09:00"),
          end: asText(schedule.end, "17:00"),
          daysOfWeek: Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek.map((day) => asNumber(day)).filter((day) => Number.isInteger(day)) : [1, 2, 3, 4, 5],
          timezone: asText(schedule.timezone, "UTC"),
        }
      : null,
    attendance: {
      state: oneOf(attendance.state, ATTENDANCE_STATES, "unknown"),
      source: asText(attendance.source) === "worktivity" ? "worktivity" : "none",
      observedAt: asIsoOrNull(attendance.observedAt),
      freshness: oneOf(attendance.freshness, ATTENDANCE_FRESHNESS, "unknown"),
      clockedInAt: asIsoOrNull(attendance.clockedInAt),
      clockedOutAt: asIsoOrNull(attendance.clockedOutAt),
    },
    session: session
      ? {
          state: asText(session.state, "scheduled"),
          clockedInAt: asIsoOrNull(session.clockedInAt),
          pausedSeconds: asNumber(session.pausedSeconds),
          observedSeconds: asNumber(session.observedSeconds),
          correctionStatus: asTextOrNull(session.correctionStatus),
        }
      : null,
    updatesToday: asNumber(row.updatesToday),
    substantiveUpdatesToday: asNumber(row.substantiveUpdatesToday),
    evidenceToday: asNumber(row.evidenceToday),
    tasksCompletedToday: asNumber(row.tasksCompletedToday),
    lastUpdateAt: asIsoOrNull(row.lastUpdateAt),
    lastUpdateKind: asTextOrNull(row.lastUpdateKind),
    eodToday: asTextOrNull(row.eodToday),
    eodOutstanding: outstanding ? { days: asNumber(outstanding.days), latest: outstanding.latest ?? null } : null,
  };
}

export function normalizeAdminOverview(raw: unknown): AdminOverview {
  const source = asRecord(raw);
  const counts = asRecord(source.counts);
  const freshness = asRecord(source.freshness);
  return {
    date: asText(source.date),
    generatedAt: asText(source.generatedAt),
    counts: {
      people: asNumber(counts.people),
      onShift: asNumber(counts.onShift),
      paused: asNumber(counts.paused),
      offShift: asNumber(counts.offShift),
      unknown: asNumber(counts.unknown),
      updatesToday: asNumber(counts.updatesToday),
      substantiveUpdatesToday: asNumber(counts.substantiveUpdatesToday),
      tasksCompletedToday: asNumber(counts.tasksCompletedToday),
      tasksOpen: asNumber(counts.tasksOpen),
      tasksOverdue: asNumber(counts.tasksOverdue),
      evidenceToday: asNumber(counts.evidenceToday),
      evidenceActivityToday: asNumber(counts.evidenceActivityToday),
      evidenceOutputToday: asNumber(counts.evidenceOutputToday),
      reportsDraftedToday: asNumber(counts.reportsDraftedToday),
      reportsSubmittedToday: asNumber(counts.reportsSubmittedToday),
      reportsPendingReview: asNumber(counts.reportsPendingReview),
      pendingReviewOldestAt: asIsoOrNull(counts.pendingReviewOldestAt),
      eodOutstandingPeople: asNumber(counts.eodOutstandingPeople),
      eodOutstandingDays: asNumber(counts.eodOutstandingDays),
      disputedEvidence: asNumber(counts.disputedEvidence),
    },
    people: asRows(source.people).map(normalizeOverviewPerson),
    recentActivity: asRows(source.recentActivity).map((item) => ({
      id: asText(item.id),
      kind: oneOf(item.kind, OVERVIEW_ACTIVITY_KINDS, "update"),
      at: asText(item.at),
      personId: asTextOrNull(item.personId),
      personName: asTextOrNull(item.personName),
      title: asText(item.title, "Activity"),
      detail: asTextOrNull(item.detail),
      provenance: asTextOrNull(item.provenance),
    })),
    attention: asRows(source.attention).map((item) => ({
      code: asText(item.code, "attention"),
      severity: oneOf(item.severity, ATTENTION_SEVERITIES, "info"),
      count: asNumber(item.count),
      // A row without copy still names what its code records instead of
      // rendering an empty line.
      message: asText(item.message) || statusLabel(asText(item.code)),
      href: asTextOrNull(item.href),
    })),
    series: asRows(source.series).map((point) => ({
      date: asText(point.date),
      completed: asNumber(point.completed),
      updates: asNumber(point.updates),
      evidence: asNumber(point.evidence),
    })),
    timeSeries: normalizeTimeSeries(source.timeSeries),
    freshness: {
      niftySyncedAt: asIsoOrNull(freshness.niftySyncedAt),
      niftyTasksToday: asNumber(freshness.niftyTasksToday),
      worktivityObservedAt: asIsoOrNull(freshness.worktivityObservedAt),
      githubLastEventAt: asIsoOrNull(freshness.githubLastEventAt),
      githubEventsToday: asNumber(freshness.githubEventsToday),
      lastPlanAt: asIsoOrNull(freshness.lastPlanAt),
      lastReportSubmittedAt: asIsoOrNull(freshness.lastReportSubmittedAt),
    },
    readiness: source.readiness ?? null,
  };
}

function normalizeInsightTotals(row: Loose): AdminInsightTotals {
  return {
    outcomesCompleted: asNumber(row.outcomesCompleted),
    outcomesLate: asNumber(row.outcomesLate),
    updates: asNumber(row.updates),
    substantiveUpdates: asNumber(row.substantiveUpdates),
    eodSubmitted: asNumber(row.eodSubmitted),
    eodApproved: asNumber(row.eodApproved),
    eodRejected: asNumber(row.eodRejected),
    planned: asNumber(row.planned),
    plannedCompleted: asNumber(row.plannedCompleted),
    trackedMinutes: asNumber(row.trackedMinutes),
    evidenceOutput: asNumber(row.evidenceOutput),
    evidenceActivity: asNumber(row.evidenceActivity),
    sessionsNeedingCorrection: asNumber(row.sessionsNeedingCorrection),
    activePeople: asNumber(row.activePeople),
  };
}

export function normalizeAdminInsights(raw: unknown): AdminInsights {
  const source = asRecord(raw);
  const notes = asRecord(source.notes);
  return {
    range: oneOf(source.range, INSIGHT_RANGES, "7d"),
    from: asText(source.from),
    through: asText(source.through),
    totals: normalizeInsightTotals(asRecord(source.totals)),
    previous: normalizeInsightTotals(asRecord(source.previous)),
    people: asRows(source.people).map((row) => ({
      personId: asText(row.personId),
      displayName: asText(row.displayName, "Unmapped person"),
      roleProfile: asTextOrNull(row.roleProfile),
      outcomesCompleted: asNumber(row.outcomesCompleted),
      outcomesLate: asNumber(row.outcomesLate),
      updates: asNumber(row.updates),
      substantiveUpdates: asNumber(row.substantiveUpdates),
      eodSubmitted: asNumber(row.eodSubmitted),
      eodApproved: asNumber(row.eodApproved),
      eodRejected: asNumber(row.eodRejected),
      planned: asNumber(row.planned),
      plannedCompleted: asNumber(row.plannedCompleted),
      // A rate is stated only when the payload recorded one; otherwise the
      // page renders its "—" and never a fabricated percentage.
      commitmentRate: typeof row.commitmentRate === "number" && Number.isFinite(row.commitmentRate) ? row.commitmentRate : null,
      trackedMinutes: asNumber(row.trackedMinutes),
      evidenceOutput: asNumber(row.evidenceOutput),
      evidenceActivity: asNumber(row.evidenceActivity),
      sessionsNeedingCorrection: asNumber(row.sessionsNeedingCorrection),
      lastActivityAt: asIsoOrNull(row.lastActivityAt),
    })),
    series: asRows(source.series).map((point) => ({
      date: asText(point.date),
      outcomesCompleted: asNumber(point.outcomesCompleted),
      updates: asNumber(point.updates),
      eodSubmitted: asNumber(point.eodSubmitted),
      trackedMinutes: asNumber(point.trackedMinutes),
    })),
    timeSeries: normalizeTimeSeries(source.timeSeries),
    updateKinds: asRows(source.updateKinds).map((entry) => ({ kind: asText(entry.kind, "unclassified"), count: asNumber(entry.count) })),
    topApps: asRows(source.topApps).map((entry) => ({ name: asText(entry.name, "Unknown"), minutes: asNumber(entry.minutes) })),
    overdueOpen: source.overdueOpen == null ? null : asNumber(source.overdueOpen),
    notes: {
      summary: asText(notes.summary) || "No summary was recorded for this range.",
      wins: asTextArray(notes.wins),
      attention: asTextArray(notes.attention),
      nextFocus: asTextArray(notes.nextFocus),
    },
    freshness: { generatedAt: asText(asRecord(source.freshness).generatedAt) },
  };
}

export function normalizePeople(raw: unknown): PeopleResponse {
  const source = asRecord(raw);
  return {
    people: asRows(source.people).map((person) => ({
      ...person,
      id: asText(person.id),
      display_name: asText(person.display_name, "Unknown"),
      email: asTextOrNull(person.email),
    })),
    roleProfiles: asRows(source.roleProfiles).map((profile) => ({
      id: asText(profile.id),
      name: asText(profile.name, "Role"),
    })),
  };
}

export function normalizePersonDetail(raw: unknown): PersonDetailResponse {
  const source = asRecord(raw);
  const person = asRecord(source.person);
  const roleProfile = person.role_profile && typeof person.role_profile === "object" ? asRecord(person.role_profile) : null;
  const evidenceSummary = asRecord(source.evidenceSummary);
  return {
    person: {
      id: asText(person.id),
      display_name: asText(person.display_name, "Unknown"),
      email: asTextOrNull(person.email),
      role_profile_id: asTextOrNull(person.role_profile_id),
      nifty_member_id: asTextOrNull(person.nifty_member_id),
      worktivity_employee_id: asTextOrNull(person.worktivity_employee_id),
      // An absent flag never silently deactivates a person.
      active: asBoolean(person.active, true),
      role_profile: roleProfile ? { id: asText(roleProfile.id), name: asText(roleProfile.name, "Unmapped") } : null,
    },
    teams: asRows(source.teams).map((membership) => {
      const team = membership.team && typeof membership.team === "object" ? asRecord(membership.team) : null;
      return {
        team_id: asText(membership.team_id),
        is_manager: asBoolean(membership.is_manager),
        team: team ? { id: asText(team.id), name: asText(team.name, "Team"), active: asBoolean(team.active, true) } : null,
      };
    }),
    schedules: asRows(source.schedules),
    exceptions: asRows(source.exceptions),
    sessions: asRows(source.sessions),
    reports: asRows(source.reports),
    updates: asRows(source.updates),
    intervals: asRows(source.intervals),
    evidenceSummary: {
      total: asNumber(evidenceSummary.total),
      activity: asNumber(evidenceSummary.activity),
      output: asNumber(evidenceSummary.output),
      disputed: asNumber(evidenceSummary.disputed),
    },
  };
}

function normalizeReportRow(row: Loose): WorkOsReportRow {
  const person = row.person && typeof row.person === "object" ? asRecord(row.person) : null;
  return {
    ...row,
    id: asText(row.id),
    person_id: asTextOrNull(row.person_id),
    report_date: asText(row.report_date),
    // `draft` is the status a report has before any decision; it is only the
    // fallback for a payload that recorded no status at all.
    status: oneOf(row.status, REPORT_STATUSES, "draft"),
    title: asText(row.title),
    markdown: asText(row.markdown),
    submitted_markdown: asTextOrNull(row.submitted_markdown),
    metrics: row.metrics && typeof row.metrics === "object" ? (row.metrics as Record<string, unknown>) : null,
    manager_notes: asTextOrNull(row.manager_notes),
    submitted_at: asIsoOrNull(row.submitted_at),
    reviewed_at: asIsoOrNull(row.reviewed_at),
    created_at: asText(row.created_at),
    person: person
      ? { id: asText(person.id), display_name: asText(person.display_name, "Unmapped person"), email: asTextOrNull(person.email) }
      : null,
    versions: Array.isArray(row.versions)
      ? (row.versions as unknown[]).map((version) => {
          const entry = asRecord(version);
          return { id: asText(entry.id), version_kind: asText(entry.version_kind, "version"), created_at: asText(entry.created_at) };
        })
      : [],
  };
}

export function normalizeReports(raw: unknown): ReportsResponse {
  const source = asRecord(raw);
  const reports = asRows(source.reports).map(normalizeReportRow);
  const countsSource = asRecord(source.counts);
  const recordedCounts = ["draft", "pending_review", "approved", "rejected", "total"].some((key) => typeof countsSource[key] === "number");
  // The API always counts every status; only when a payload omits the counts
  // object is the counts derived from the rows it did return.
  const counts = recordedCounts
    ? {
        draft: asNumber(countsSource.draft),
        pending_review: asNumber(countsSource.pending_review),
        approved: asNumber(countsSource.approved),
        rejected: asNumber(countsSource.rejected),
        total: asNumber(countsSource.total, reports.length),
      }
    : {
        draft: reports.filter((report) => report.status === "draft").length,
        pending_review: reports.filter((report) => report.status === "pending_review").length,
        approved: reports.filter((report) => report.status === "approved").length,
        rejected: reports.filter((report) => report.status === "rejected").length,
        total: reports.length,
      };
  return {
    reports,
    counts,
    series: Array.isArray(source.series) ? (source.series as ReportsResponse["series"]) : undefined,
  };
}

function normalizeEvidenceRow(row: Loose): EvidenceRow {
  const person = row.person && typeof row.person === "object" ? asRecord(row.person) : null;
  const task = row.task && typeof row.task === "object" ? asRecord(row.task) : null;
  const event = row.event && typeof row.event === "object" ? asRecord(row.event) : null;
  return {
    ...row,
    id: asText(row.id),
    person_id: asTextOrNull(row.person_id),
    task_id: asTextOrNull(row.task_id),
    evidence_date: asText(row.evidence_date),
    source: asText(row.source, "unknown"),
    title: asText(row.title, "Evidence"),
    summary: asText(row.summary),
    url: asTextOrNull(row.url),
    metrics: row.metrics && typeof row.metrics === "object" ? (row.metrics as Record<string, unknown>) : null,
    created_at: asText(row.created_at),
    person: person ? { id: asText(person.id), display_name: asText(person.display_name, "Unmapped person") } : null,
    task: task ? { id: asText(task.id), title: asText(task.title, "Task") } : null,
    event: event
      ? {
          correction_status: asText(event.correction_status, "none"),
          evidence_class: asText(event.evidence_class),
          metadata: asRecord(event.metadata),
          screenshot: event.screenshot ?? null,
        }
      : null,
  };
}

export function normalizeEvidence(raw: unknown): EvidenceResponse {
  const source = asRecord(raw);
  const summary = source.summary && typeof source.summary === "object" ? asRecord(source.summary) : null;
  return {
    evidence: asRows(source.evidence).map(normalizeEvidenceRow),
    summary: summary
      ? {
          sources: asRows(summary.sources).map((entry) => ({ source: asText(entry.source, "unknown"), count: asNumber(entry.count) })),
          days: asRows(summary.days).map((entry) => ({ date: asText(entry.date), count: asNumber(entry.count) })),
        }
      : undefined,
  };
}

export interface AdminIntervalListResponse {
  intervals: Array<ActivityIntervalView & { personId: string; personName: string | null }>;
}

export function normalizeIntervals(raw: unknown): AdminIntervalListResponse {
  const source = asRecord(raw);
  return {
    intervals: asRows(source.intervals).map((row) => ({
      ...row,
      id: asText(row.id),
      windowStart: asText(row.windowStart),
      windowEnd: asText(row.windowEnd),
      label: asText(row.label, "Interval"),
      promptKind: row.promptKind === "hourly_fallback" ? "hourly_fallback" : "follow_up",
      generationStatus: asText(row.generationStatus, "ready"),
      reviewStatus: oneOf(row.reviewStatus, INTERVAL_REVIEW_STATUSES, "inferred"),
      headline: asTextOrNull(row.headline),
      detail: asTextOrNull(row.detail),
      recordedActivity: asRows(row.recordedActivity).map((entry) => ({
        description: asText(entry.description),
        relation: entry.relation === "triggered" ? "triggered" : "performed",
        url: asTextOrNull(entry.url),
      })),
      employeeFeedback: asTextOrNull(row.employeeFeedback),
      failureReason: asTextOrNull(row.failureReason),
      generatedAt: asIsoOrNull(row.generatedAt),
      reviewedAt: asIsoOrNull(row.reviewedAt),
      evidenceExpired: asBoolean(row.evidenceExpired),
      evidenceCount: asNumber(row.evidenceCount),
      evidence: asRows(row.evidence).map((entry) => ({
        id: asText(entry.id),
        kind: asText(entry.kind, "frame"),
        summary: asTextOrNull(entry.summary),
        capturedAt: asIsoOrNull(entry.capturedAt),
      })),
      personId: asText(row.personId),
      personName: asTextOrNull(row.personName),
    })),
  };
}

export interface AdminTaskListResponse {
  tasks: AdminTaskRow[];
  nextOffset: number | null;
  summary?: { open: number; overdue: number; completedWeek: number };
}

function normalizeTaskRow(row: Loose): AdminTaskRow {
  const project = row.project && typeof row.project === "object" ? asRecord(row.project) : null;
  return {
    ...row,
    id: asText(row.id),
    title: asTextOrNull(row.title),
    name: asTextOrNull(row.name),
    completed: typeof row.completed === "boolean" ? row.completed : null,
    due_date: asTextOrNull(row.due_date),
    description: asTextOrNull(row.description),
    priority: asTextOrNull(row.priority),
    status: asTextOrNull(row.status),
    labels: asTextArray(row.labels),
    updated_at: asTextOrNull(row.updated_at),
    project: project ? { id: asText(project.id), name: asTextOrNull(project.name) } : null,
    // Assignee rows are rendered by name; a sparse embed must not hand the
    // page a null it would dereference.
    assignees: asRows(row.assignees).map((assignee) => ({ ...assignee, displayName: asText(assignee.displayName ?? assignee.display_name, "Unassigned") })),
  };
}

export function normalizeAdminTaskList(raw: unknown): AdminTaskListResponse {
  const source = asRecord(raw);
  const summary = source.summary && typeof source.summary === "object" ? asRecord(source.summary) : null;
  return {
    tasks: asRows(source.tasks).map(normalizeTaskRow),
    nextOffset: source.nextOffset == null ? null : asNumber(source.nextOffset),
    summary: summary
      ? { open: asNumber(summary.open), overdue: asNumber(summary.overdue), completedWeek: asNumber(summary.completedWeek) }
      : undefined,
  };
}

export function normalizeAdminTaskDetails(raw: unknown): { task: AdminTaskRow; subtasks: AdminTaskRow[] } {
  const source = asRecord(raw);
  return { task: normalizeTaskRow(asRecord(source.task)), subtasks: asRows(source.subtasks).map(normalizeTaskRow) };
}

export function normalizeProjects(raw: unknown): { projects: Array<Record<string, any>> } {
  const source = asRecord(raw);
  return { projects: asRows(source.projects).map((project) => ({ ...project, id: asText(project.id), name: asTextOrNull(project.name) })) };
}

export function normalizeOrganization(raw: unknown): OrganizationResponse {
  const source = asRecord(raw);
  const organization = asRecord(source.organization);
  return {
    organization: {
      id: asText(organization.id),
      name: asText(organization.name, "Workspace"),
      slug: asText(organization.slug),
      feature_flags: organization.feature_flags && typeof organization.feature_flags === "object" ? (organization.feature_flags as Record<string, boolean>) : null,
      created_at: asText(organization.created_at),
    },
    memberships: asRows(source.memberships).map((row) => {
      const person = row.person && typeof row.person === "object" ? asRecord(row.person) : null;
      return {
        id: asText(row.id),
        user_id: asText(row.user_id),
        person_id: asTextOrNull(row.person_id),
        role: asText(row.role, "employee"),
        active: asBoolean(row.active, true),
        feature_flags: row.feature_flags && typeof row.feature_flags === "object" ? (row.feature_flags as Record<string, boolean>) : null,
        person: person ? { id: asText(person.id), display_name: asTextOrNull(person.display_name), email: asTextOrNull(person.email) } : null,
      };
    }),
    teams: asRows(source.teams).map((team) => ({ ...team, id: asText(team.id), name: asText(team.name, "Team") })),
    teamMembers: asRows(source.teamMembers).map((member) => ({
      ...member,
      team_id: asText(member.team_id),
      person_id: asText(member.person_id),
      is_manager: asBoolean(member.is_manager),
    })),
  };
}

export function normalizeConnections(raw: unknown): ConnectionsResponse {
  const source = asRecord(raw);
  return {
    connections: asRows(source.connections).map((connection) => ({
      ...connection,
      id: asText(connection.id),
      provider: asText(connection.provider, "provider"),
      active: connection.active !== false,
      external_workspace_id: asTextOrNull(connection.external_workspace_id),
    })),
    accounts: asRows(source.accounts).map((account) => ({
      ...account,
      id: asText(account.id),
      provider: asText(account.provider, "provider"),
      person_id: asTextOrNull(account.person_id),
    })),
  };
}

export function normalizeGithubActors(raw: unknown): GithubIntegrationActorsResponse {
  const source = asRecord(raw);
  const totals = asRecord(source.totals);
  const configuration = asRecord(source.configuration);
  return {
    actors: asRows(source.actors).map((actor) => {
      const suggestion = actor.suggestion && typeof actor.suggestion === "object" ? asRecord(actor.suggestion) : null;
      return {
        key: asText(actor.key),
        id: asTextOrNull(actor.id),
        login: asTextOrNull(actor.login),
        events: asNumber(actor.events),
        firstSeen: asIsoOrNull(actor.firstSeen),
        lastSeen: asIsoOrNull(actor.lastSeen),
        titles: asTextArray(actor.titles),
        suggestion: suggestion
          ? { personId: asText(suggestion.personId), displayName: asText(suggestion.displayName, "Unknown"), githubUsername: asText(suggestion.githubUsername) }
          : null,
      };
    }),
    people: asRows(source.people).map((person) => ({
      id: asText(person.id),
      displayName: asText(person.displayName, "Unknown"),
      githubUsername: asTextOrNull(person.githubUsername),
    })),
    totals: { unattributedEvents: asNumber(totals.unattributedEvents), lastEventAt: asIsoOrNull(totals.lastEventAt) },
    configuration: {
      webhookReceiverReady: asBoolean(configuration.webhookReceiverReady),
      repositoryManagementReady: asBoolean(configuration.repositoryManagementReady),
    },
  };
}

export function normalizeGithubRepos(raw: unknown): GithubIntegrationReposResponse {
  const source = asRecord(raw);
  const connection = source.connection && typeof source.connection === "object" ? asRecord(source.connection) : null;
  const configuration = asRecord(source.configuration);
  return {
    connection: connection ? { id: asText(connection.id), workspace: asText(connection.workspace) } : null,
    organization: asTextOrNull(source.organization),
    repos: asRows(source.repos).map((repo) => ({
      full_name: asText(repo.full_name),
      private: asBoolean(repo.private),
      default_branch: asText(repo.default_branch, "main"),
      pushed_at: asIsoOrNull(repo.pushed_at),
    })),
    connectedRepos: asRows(source.connectedRepos).map((repo) => ({
      full_name: asText(repo.full_name),
      hook_id: asTextOrNull(repo.hook_id),
      created_at: asText(repo.created_at),
    })),
    webhookUrl: asText(source.webhookUrl),
    configuration: {
      repositoryManagementReady: asBoolean(configuration.repositoryManagementReady),
      webhookReceiverReady: asBoolean(configuration.webhookReceiverReady),
      orgWebhook: asBoolean(configuration.orgWebhook),
      reason: asTextOrNull(configuration.reason),
    },
  };
}

export function normalizeFieldMappings(raw: unknown): FieldMappingsResponse {
  return { mappings: asRows(asRecord(raw).mappings) };
}

export function normalizeBlueprints(raw: unknown): BlueprintsResponse {
  return { blueprints: asRows(asRecord(raw).blueprints) };
}

export function normalizeSystemStatus(raw: unknown): SystemStatusResponse {
  const source = asRecord(raw);
  const schema = asRecord(source.schema);
  const nifty = asRecord(source.nifty);
  return {
    schema: { ready: asBoolean(schema.ready), migration: asText(schema.migration), ...(asTextOrNull(schema.error) ? { error: asText(schema.error) } : {}) },
    nifty: { canCallApi: asBoolean(nifty.canCallApi), hasRefreshToken: asBoolean(nifty.hasRefreshToken), hasAccessToken: asBoolean(nifty.hasAccessToken) },
  };
}

/* --- Small formatters shared by the pages ------------------------------- */

export function shortDate(value: string | null | undefined) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Date(parsed).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function dayLabel(value: string) {
  const parsed = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return value;
  return new Date(parsed).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function relativeTime(value: string | null | undefined, now = Date.now()) {
  const parsed = Date.parse(String(value ?? ""));
  if (!Number.isFinite(parsed)) return "—";
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return shortDate(new Date(parsed).toISOString());
}

export function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.round((safe % 3600) / 60);
  if (!hours) return `${minutes}m`;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function formatMinutes(minutes: number) {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function statusLabel(value: string | null | undefined) {
  const text = String(value ?? "").replaceAll("_", " ").trim();
  return text ? text.replace(/^./, (char) => char.toUpperCase()) : "—";
}

export function evidenceSourceLabel(source: string) {
  if (source === "worktivity") return "Worktivity (activity)";
  if (source === "github") return "GitHub";
  return statusLabel(source);
}

export function attendanceLabel(state: string) {
  if (state === "active") return "On shift";
  if (state === "paused") return "Paused";
  if (state === "off_shift") return "Off shift";
  return "Not observed";
}

export function attendanceTone(state: string): "ok" | "warn" | "neutral" {
  if (state === "active") return "ok";
  if (state === "paused") return "warn";
  return "neutral";
}

export function reportTone(status: string): "ok" | "info" | "err" | "neutral" {
  if (status === "approved") return "ok";
  if (status === "pending_review") return "info";
  if (status === "rejected") return "err";
  return "neutral";
}

export function todayIso(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function isoDaysAgo(days: number, now = new Date()) {
  const date = new Date(now.getTime() - days * 24 * 60 * 60_000);
  return todayIso(date);
}
