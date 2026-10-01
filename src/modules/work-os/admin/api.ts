"use client";

import type { ActivityIntervalView } from "@/lib/work-os-activity-intervals";
import type { AdminInsights, AdminInsightRange } from "@/lib/work-os-admin-insights";
import type { AdminOverview } from "@/lib/work-os-admin-overview";

export type { AdminInsights, AdminInsightRange, AdminOverview, ActivityIntervalView };

export async function adminFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string })?.error || `Request failed: ${response.status}`);
  return body as T;
}

export const adminKeys = {
  overview: (date: string) => ["work-os", "admin", "overview", date] as const,
  insights: (range: AdminInsightRange, personId: string) => ["work-os", "admin", "insights", range, personId] as const,
  intervals: (from: string, to: string, personId: string) => ["work-os", "admin", "intervals", from, to, personId] as const,
  reports: (filters: Record<string, string>) => ["work-os", "admin", "reports", filters] as const,
  evidence: (filters: Record<string, string>) => ["work-os", "admin", "evidence", filters] as const,
  person: (personId: string) => ["work-os", "admin", "person", personId] as const,
  githubActors: () => ["work-os", "admin", "github", "actors"] as const,
  githubRepos: () => ["work-os", "admin", "github", "repos"] as const,
  people: () => ["work-os", "people"] as const,
  projects: () => ["work-os", "projects"] as const,
  tasks: (filters: Record<string, string>) => ["work-os", "tasks", filters] as const,
  organization: () => ["work-os", "organization"] as const,
  connections: () => ["work-os", "connections"] as const,
  fieldMappings: () => ["work-os", "field-mappings"] as const,
  blueprints: () => ["work-os", "blueprints"] as const,
  schedules: (personId: string) => ["work-os", "schedules", personId] as const,
  status: () => ["work-os", "system-status"] as const,
};

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
  person?: { id: string; display_name: string } | null;
  task?: { id: string; title: string } | null;
  event?: {
    correction_status?: string;
    evidence_class?: string;
    metadata?: Record<string, unknown>;
    screenshot?: {
      id: string;
      processing_status: string;
      summary: string | null;
      confidence: number | null;
      storage_path: string | null;
      deleted_at: string | null;
    } | null;
  } | null;
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
  configuration: { repositoryManagementReady: boolean; webhookReceiverReady: boolean; reason?: string | null };
}

export interface PersonDetailResponse {
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
  reports: Array<Record<string, unknown>>;
  updates: Array<Record<string, unknown>>;
  intervals: Array<Record<string, unknown>>;
  evidenceSummary: { total: number; activity: number; output: number; disputed: number };
}

export interface SessionResponse {
  organizationId: string;
  role: "employee" | "manager" | "admin";
  personId: string | null;
  userId: string;
  featureFlags: Record<string, boolean>;
}

export interface SystemStatusResponse {
  schema: { ready: boolean; migration: string; error?: string };
  nifty: { canCallApi: boolean; hasRefreshToken: boolean; hasAccessToken?: boolean };
}
