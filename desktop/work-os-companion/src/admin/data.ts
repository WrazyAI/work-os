import { apiRequest } from "../api";
import type {
  AdminInsights,
  AdminInsightRange,
  AdminOverview,
  ActivityIntervalView,
  ConnectionsResponse,
  EvidenceResponse,
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
  AdminOverview,
  ActivityIntervalView,
  ConnectionsResponse,
  EvidenceResponse,
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

export const fetchSession = () => get<SessionResponse>("/api/work-os/session");
export const fetchAdminOverview = (date?: string) => get<AdminOverview>(`/api/work-os/admin/overview${buildQuery({ date })}`);
export const fetchAdminInsights = (range: AdminInsightRange, personId: string, through?: string) =>
  get<AdminInsights>(`/api/work-os/admin/insights${buildQuery({ range, personId, through })}`);
export const fetchPeople = () => get<PeopleResponse>("/api/work-os/people");
export const fetchProjects = () => get<{ projects: Array<Record<string, any>> }>("/api/work-os/projects");
export const fetchPersonDetail = (personId: string) => get<PersonDetailResponse>(`/api/work-os/admin/people/${encodeURIComponent(personId)}`);
export const fetchAdminTasks = (filters: Record<string, string>) => get<{ tasks: Array<Record<string, any>>; nextOffset: number | null; summary?: { open: number; overdue: number; completedWeek: number } }>(`/api/work-os/tasks${buildQuery(filters)}`);
export const fetchAdminTaskDetails = (taskId: string) => get<{ task: Record<string, any>; subtasks: Array<Record<string, any>> }>(`/api/work-os/tasks/${encodeURIComponent(taskId)}`);
export const fetchAdminReports = (filters: Record<string, string>) => get<ReportsResponse>(`/api/work-os/reports${buildQuery({ ...filters, limit: filters.limit ?? "200" })}`);
export const fetchReportEvidence = (personId: string, date: string) => get<EvidenceResponse>(`/api/work-os/evidence${buildQuery({ personId, date, limit: "100" })}`);
export const fetchReportIntervals = (personId: string, date: string) =>
  get<{ intervals: Array<ActivityIntervalView & { personId: string; personName: string | null }> }>(`/api/work-os/admin/activity-intervals${buildQuery({ personId, from: date, to: date, limit: "40" })}`);
export const fetchAdminEvidence = (filters: Record<string, string>) => get<EvidenceResponse>(`/api/work-os/evidence${buildQuery(filters)}`);
export const fetchAdminIntervals = (filters: Record<string, string>) =>
  get<{ intervals: Array<ActivityIntervalView & { personId: string; personName: string | null }> }>(`/api/work-os/admin/activity-intervals${buildQuery(filters)}`);
export const fetchGithubActors = () => get<GithubIntegrationActorsResponse>("/api/work-os/admin/integrations/github/actors");
export const fetchGithubRepos = () => get<GithubIntegrationReposResponse>("/api/work-os/admin/integrations/github/repos");
export const fetchOrganization = () => get<OrganizationResponse>("/api/work-os/organization");
export const fetchConnections = () => get<ConnectionsResponse>("/api/work-os/integrations/connections");
export const fetchFieldMappings = () => get<FieldMappingsResponse>("/api/work-os/field-mappings");
export const fetchBlueprints = () => get<BlueprintsResponse>("/api/work-os/blueprints");
export const fetchSystemStatus = () => get<SystemStatusResponse>("/api/work-os/status");

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
