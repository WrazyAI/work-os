"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useRouter } from "next/navigation";
import {
  AlertCircle,
  BriefcaseBusiness,
  CheckCircle2,
  ClipboardList,
  FileSearch,
  Layers3,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import type { WorkOsNiftyStatus } from "./types";
import EmployeeWorkOsHome from "./EmployeeWorkOsHome";
import ManagerWorkOsHome from "./ManagerWorkOsHome";
import { supportedTimezones, timezoneLabel } from "./timezones";

type AnyRow = Record<string, any>;
type WorkOsSession = { organizationId: string; role: "employee" | "manager" | "admin"; personId: string | null; userId: string; featureFlags: Record<string, boolean> };
type Tab = "today" | "tasks" | "people" | "schedules" | "blueprints" | "evidence" | "reports" | "settings";
type WorkOsSystemStatus = {
  schema: { ready: boolean; migration: string; error?: string };
  nifty: WorkOsNiftyStatus["status"];
};

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "tasks", label: "Tasks" },
  { id: "people", label: "People" },
  { id: "schedules", label: "Schedules" },
  { id: "blueprints", label: "Blueprints" },
  { id: "evidence", label: "Evidence" },
  { id: "reports", label: "Reports" },
  { id: "settings", label: "Settings" },
];

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed: ${res.status}`);
  return body as T;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function cls(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(" ");
}

function Notice({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warn" | "err" }) {
  const color = tone === "err" ? "var(--status-err)" : tone === "warn" ? "var(--status-warn)" : "var(--accent)";
  return (
    <div className="rounded-lg border px-3 py-2 text-[12px] leading-5" style={{ borderColor: color, background: "var(--bg-card)", color }}>
      {children}
    </div>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={cls("rounded-lg border p-4 shadow-sm", className)} style={{ borderColor: "var(--border)", background: "var(--bg-card)" }}>
      {children}
    </section>
  );
}

function Pill({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "ok" | "warn" | "neutral" }) {
  const color = tone === "ok" ? "var(--status-ok)" : tone === "warn" ? "var(--status-warn)" : "var(--text-tertiary)";
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--border)", color }}>
      {children}
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">
      {label}
      {children}
    </label>
  );
}

const inputClass = "rounded-lg border bg-transparent px-3 py-2 text-[12px] text-[var(--text-primary)] outline-none";

export default function WorkOsHome() {
  const qc = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("today");
  // Deep links: ?tab=today|tasks|people|schedules|blueprints|evidence|reports|settings
  // (from the sidebar sub-navigation) — keep the URL and the tab selector in sync.
  const searchParams = useSearchParams();
  const deepLinkTab = searchParams.get("tab") as Tab | null;
  useEffect(() => {
    if (deepLinkTab && ["today", "tasks", "people", "schedules", "blueprints", "evidence", "reports", "settings"].includes(deepLinkTab)) {
      setTab(deepLinkTab);
    }
  }, [deepLinkTab]);
  const tabWriteSkipped = useRef(false);
  useEffect(() => {
    // Skip the first run so a deep link (?tab=…) is not overwritten with the
    // default tab before the URL has been read.
    if (!tabWriteSkipped.current) { tabWriteSkipped.current = true; return; }
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    if (window.location.search !== url.search) {
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const [personId, setPersonId] = useState("");
  const [completed, setCompleted] = useState("false");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskGroupId, setTaskGroupId] = useState("");
  const [taskParentId, setTaskParentId] = useState("");
  const [taskProjectId, setTaskProjectId] = useState("");
  const [taskMilestoneId, setTaskMilestoneId] = useState("");
  const [taskStartDate, setTaskStartDate] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskPriority, setTaskPriority] = useState("");
  const [taskLabels, setTaskLabels] = useState("");
  const [taskStoryPoints, setTaskStoryPoints] = useState("");
  const [taskExpectedOutcome, setTaskExpectedOutcome] = useState("");
  const [taskDefinitionOfDone, setTaskDefinitionOfDone] = useState("");
  const [taskProviderStatus, setTaskProviderStatus] = useState("");
  const [evidenceText, setEvidenceText] = useState("");
  const [clientName, setClientName] = useState("");
  const [scheduleTimezone, setScheduleTimezone] = useState("UTC");
  const [scheduleStart, setScheduleStart] = useState("09:00");
  const [scheduleEnd, setScheduleEnd] = useState("17:00");
  const [scheduleBreakStart, setScheduleBreakStart] = useState("");
  const [scheduleBreakEnd, setScheduleBreakEnd] = useState("");
  const [scheduleDays, setScheduleDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [exceptionDate, setExceptionDate] = useState(todayIso());
  const [exceptionKind, setExceptionKind] = useState("leave");
  const [exceptionStart, setExceptionStart] = useState("09:00");
  const [exceptionEnd, setExceptionEnd] = useState("17:00");
  const [exceptionNote, setExceptionNote] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState("employee");
  const [teamName, setTeamName] = useState("");
  const [teamId, setTeamId] = useState("");
  const [teamPersonId, setTeamPersonId] = useState("");
  const [teamManager, setTeamManager] = useState(false);
  const [connectorProvider, setConnectorProvider] = useState("github");
  const [connectorWorkspaceId, setConnectorWorkspaceId] = useState("");
  const [connectorAccountId, setConnectorAccountId] = useState("");
  const [connectorPersonId, setConnectorPersonId] = useState("");
  const [mappingField, setMappingField] = useState("priority");
  const [mappingProviderFieldId, setMappingProviderFieldId] = useState("");

  const session = useQuery<WorkOsSession>({
    queryKey: ["work-os", "session"],
    queryFn: () => fetchJson("/api/work-os/session"),
    staleTime: 30_000,
  });
  const isAdmin = session.data?.role === "admin";
  const system = useQuery<WorkOsSystemStatus>({
    queryKey: ["work-os", "system-status"],
    queryFn: () => fetchJson("/api/work-os/status"),
    staleTime: 30_000,
    enabled: isAdmin,
  });
  const schemaReady = system.data?.schema.ready === true;
  const readiness = useQuery<{
    status: "ready" | "needs_setup" | "blocked";
    ready: boolean;
    issues: Array<{ code: string; severity: "needs_setup" | "blocked"; count: number; message: string }>;
    checks: { people: { active: number }; tasks: { open: number }; organization: { activeTeams: number; activeSchedules: number } };
  }>({
    queryKey: ["work-os", "readiness"],
    queryFn: () => fetchJson("/api/work-os/readiness"),
    staleTime: 30_000,
    enabled: schemaReady && isAdmin,
  });
  const status = useQuery<WorkOsNiftyStatus>({
    queryKey: ["work-os", "status"],
    queryFn: () => fetchJson("/api/work-os/nifty/status"),
    staleTime: 30_000,
    enabled: isAdmin,
  });
  const people = useQuery<{ people: AnyRow[]; roleProfiles: AnyRow[] }>({
    queryKey: ["work-os", "people"],
    queryFn: () => fetchJson("/api/work-os/people"),
    enabled: schemaReady,
  });
  const schedules = useQuery<{ schedules: AnyRow[]; exceptions: AnyRow[] }>({
    queryKey: ["work-os", "schedules", personId],
    queryFn: () => fetchJson(`/api/work-os/schedules${personId ? `?personId=${personId}` : ""}`),
    enabled: schemaReady && tab === "schedules",
  });
  const organization = useQuery<{ organization: AnyRow; memberships: AnyRow[]; teams: AnyRow[]; teamMembers: AnyRow[] }>({
    queryKey: ["work-os", "organization"],
    queryFn: () => fetchJson("/api/work-os/organization"),
    enabled: schemaReady && tab === "settings",
  });
  const connections = useQuery<{ connections: AnyRow[]; accounts: AnyRow[] }>({
    queryKey: ["work-os", "connections"],
    queryFn: () => fetchJson("/api/work-os/integrations/connections"),
    enabled: schemaReady && tab === "settings",
  });
  const fieldMappings = useQuery<{ mappings: AnyRow[] }>({
    queryKey: ["work-os", "field-mappings"],
    queryFn: () => fetchJson("/api/work-os/field-mappings"),
    enabled: schemaReady && tab === "settings",
  });
  const projects = useQuery<{ projects: AnyRow[] }>({
    queryKey: ["work-os", "projects"],
    queryFn: () => fetchJson("/api/work-os/projects"),
    enabled: schemaReady,
  });
  const tasks = useQuery<{ tasks: AnyRow[] }>({
    queryKey: ["work-os", "tasks", completed, personId],
    queryFn: () => fetchJson(`/api/work-os/tasks?completed=${completed}${personId ? `&personId=${personId}` : ""}`),
    enabled: schemaReady,
  });
  const todayTasks = useQuery<{ tasks: AnyRow[] }>({
    queryKey: ["work-os", "today", personId],
    queryFn: () => fetchJson(`/api/work-os/tasks/today${personId ? `?personId=${personId}` : ""}`),
    enabled: schemaReady,
  });
  const evidence = useQuery<{ evidence: AnyRow[] }>({
    queryKey: ["work-os", "evidence", personId],
    queryFn: () => fetchJson(`/api/work-os/evidence?date=${todayIso()}${personId ? `&personId=${personId}` : ""}`),
    enabled: schemaReady,
  });
  const reports = useQuery<{ reports: AnyRow[] }>({
    queryKey: ["work-os", "reports"],
    queryFn: () => fetchJson("/api/work-os/reports"),
    enabled: schemaReady,
  });
  const blueprints = useQuery<{ blueprints: AnyRow[] }>({
    queryKey: ["work-os", "blueprints"],
    queryFn: () => fetchJson("/api/work-os/blueprints"),
    enabled: schemaReady,
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["work-os"] });
  };

  const sync = useMutation({
    mutationFn: () => fetchJson("/api/work-os/nifty/sync", { method: "POST" }),
    onSuccess: refresh,
  });
  const saveSchedule = useMutation({
    mutationFn: () => fetchJson("/api/work-os/schedules", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: personId, timezone: scheduleTimezone, shift_start: scheduleStart, shift_end: scheduleEnd, days_of_week: scheduleDays, effective_from: todayIso(), break_windows: authoritativeBreaks ? [] : scheduleBreakStart && scheduleBreakEnd ? [{ start: scheduleBreakStart, end: scheduleBreakEnd }] : [] }),
    }),
    onSuccess: refresh,
  });
  const saveException = useMutation({
    mutationFn: () => fetchJson("/api/work-os/schedules", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        person_id: personId,
        exception_date: exceptionDate,
        kind: exceptionKind,
        shift_start: exceptionKind === "leave" ? null : exceptionStart,
        shift_end: exceptionKind === "leave" ? null : exceptionEnd,
        note: exceptionNote || null,
      }),
    }),
    onSuccess: () => { setExceptionNote(""); refresh(); },
  });
  const organizationAction = useMutation({
    mutationFn: (body: AnyRow) => fetchJson("/api/work-os/organization", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: () => { setMemberEmail(""); setTeamName(""); refresh(); },
  });
  const updatePerson = useMutation({
    mutationFn: (body: AnyRow) => fetchJson("/api/work-os/people", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const updateFeatures = useMutation({
    mutationFn: (feature_flags: Record<string, boolean>) => fetchJson("/api/work-os/organization", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ feature_flags }) }),
    onSuccess: refresh,
  });
  const updateMembership = useMutation({
    mutationFn: (body: AnyRow) => fetchJson("/api/work-os/organization", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const saveConnection = useMutation({
    mutationFn: () => fetchJson("/api/work-os/integrations/connections", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: connectorProvider, external_workspace_id: connectorWorkspaceId, accounts: connectorAccountId ? [{ external_account_id: connectorAccountId, person_id: connectorPersonId || null, verified: !!connectorPersonId }] : [] }),
    }),
    onSuccess: () => { setConnectorWorkspaceId(""); setConnectorAccountId(""); setConnectorPersonId(""); refresh(); },
  });
  const saveFieldMapping = useMutation({
    mutationFn: () => fetchJson("/api/work-os/field-mappings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "nifty", semantic_field: mappingField, provider_field_id: mappingProviderFieldId }),
    }),
    onSuccess: () => { setMappingProviderFieldId(""); refresh(); },
  });
  const syncEvidence = useMutation({
    mutationFn: () => fetchJson("/api/work-os/evidence/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: todayIso(), person_id: personId || undefined }),
    }),
    onSuccess: refresh,
  });
  const createTaskMutation = useMutation({
    mutationFn: () => fetchJson<{ providerStatus: string; mirrorStatus: string }>("/api/work-os/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: taskTitle, description: taskDescription, task_group_id: taskGroupId,
        task_id: taskParentId || undefined, project_id: taskProjectId || undefined, milestone_id: taskMilestoneId || undefined,
        start_date: taskStartDate || undefined, due_date: taskDueDate || undefined, priority: taskPriority || undefined,
        labels: taskLabels.split(",").map((item) => item.trim()).filter(Boolean),
        story_points: taskStoryPoints ? Number(taskStoryPoints) : undefined,
        expected_outcome: taskExpectedOutcome || undefined, definition_of_done: taskDefinitionOfDone || undefined,
      }),
    }),
    onSuccess: (result) => {
      setTaskTitle("");
      setTaskDescription(""); setTaskParentId(""); setTaskStartDate(""); setTaskDueDate(""); setTaskPriority(""); setTaskLabels(""); setTaskStoryPoints(""); setTaskExpectedOutcome(""); setTaskDefinitionOfDone("");
      setTaskProviderStatus(`Nifty confirmed · mirror ${result.mirrorStatus}`);
      refresh();
    },
  });
  const completeTaskMutation = useMutation({
    mutationFn: (id: string) => fetchJson(`/api/work-os/tasks/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    }),
    onSuccess: refresh,
  });
  const addEvidenceMutation = useMutation({
    mutationFn: () => fetchJson("/api/work-os/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: personId || null, evidence_date: todayIso(), source: "manual", title: "Manual context", summary: evidenceText }),
    }),
    onSuccess: () => {
      setEvidenceText("");
      refresh();
    },
  });
  const eodMutation = useMutation({
    mutationFn: () => fetchJson("/api/work-os/reports/eod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person_id: personId, date: todayIso() }),
    }),
    onSuccess: refresh,
  });
  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) => fetchJson(`/api/work-os/reports/${id}/review`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }),
    onSuccess: refresh,
  });
  const generateBlueprint = useMutation({
    mutationFn: (blueprintId: string) => fetchJson(`/api/work-os/blueprints/${blueprintId}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_name: clientName, task_group_id: taskGroupId, start_date: todayIso() }),
    }),
    onSuccess: refresh,
  });

  const selectedPerson = useMemo(() => (people.data?.people ?? []).find((p) => p.id === personId), [people.data, personId]);
  const authoritativeBreaks = organization.data?.organization?.feature_flags?.worktivity_authoritative_breaks === true;
  if (session.isLoading) {
    return <div className="grid min-h-[50vh] place-items-center text-[12px] text-[var(--text-tertiary)]"><RefreshCw size={18} className="animate-spin" /></div>;
  }
  if (session.error) {
    return (
      <div className="mx-auto mt-8 max-w-xl">
        <Notice tone="err">{(session.error as Error).message}</Notice>
      </div>
    );
  }
  if (session.data?.role === "manager") {
    return <ManagerWorkOsHome />;
  }
  if (session.data?.role === "employee") {
    return <EmployeeWorkOsHome />;
  }

  const taskRows = tasks.data?.tasks ?? [];
  const todayRows = todayTasks.data?.tasks ?? [];
  const evidenceRows = evidence.data?.evidence ?? [];
  const reportRows = reports.data?.reports ?? [];
  const openToday = todayRows.filter((task) => !task.completed).length;
  const completedCount = taskRows.filter((task) => task.completed).length;

  return (
    <div className="min-h-[calc(100vh-8rem)] overflow-hidden border-y bg-[var(--bg-primary)]" style={{ borderColor: "var(--border)" }}>
      <header className="border-b px-5 py-5" style={{ borderColor: "var(--border)" }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--accent)" }}>
              <BriefcaseBusiness size={15} /> Work OS
            </div>
            <h1 className="mt-2 text-xl font-semibold text-[var(--text-primary)]">Work OS administration</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <button disabled={!schemaReady} onClick={() => sync.mutate()} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>
              <RefreshCw size={14} className={sync.isPending ? "animate-spin" : ""} /> Sync Nifty
            </button>
            <button onClick={refresh} aria-label="Refresh" title="Refresh" className="grid size-9 place-items-center rounded-lg border" style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}>
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <nav className="mt-5 flex gap-2 overflow-auto">
          {tabs.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="rounded-lg border px-3 py-2 text-[12px] font-semibold transition"
              style={{
                borderColor: tab === item.id ? "var(--accent)" : "var(--border)",
                background: tab === item.id ? "var(--accent-subtle)" : "var(--bg-card)",
                color: tab === item.id ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="grid gap-4 p-5 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Users size={15} style={{ color: "var(--accent)" }} /> Worker context</h2>
            <Field label="Worker">
              <select value={personId} onChange={(e) => setPersonId(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}>
                <option value="">All mapped people</option>
                {(people.data?.people ?? []).map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}
              </select>
            </Field>
            {selectedPerson ? (
              <div className="mt-3 space-y-2 text-[12px] text-[var(--text-secondary)]">
                <p>Role: <b className="text-[var(--text-primary)]">{selectedPerson.role_profile?.name ?? "Unmapped"}</b></p>
                <p>Nifty: <span className="font-mono">{selectedPerson.nifty_member_id ?? "none"}</span></p>
                <p>Worktivity: <span className="font-mono">{selectedPerson.worktivity_employee_id ?? "none"}</span></p>
              </div>
            ) : (
              <p className="mt-3 text-[12px] leading-5 text-[var(--text-secondary)]">Select a person to scope tasks, evidence, and EOD reports.</p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={15} style={{ color: "var(--accent)" }} /> Connection state</h2>
            <div className="grid gap-2">
              <Pill tone={schemaReady ? "ok" : "warn"}>{schemaReady ? "Work OS schema ready" : "Migration required"}</Pill>
              <Pill tone={status.data?.status.canCallApi ? "ok" : "warn"}>{status.data?.status.canCallApi ? "Nifty API ready" : "Nifty missing token"}</Pill>
              <Pill tone={status.data?.status.hasRefreshToken ? "ok" : "warn"}>{status.data?.status.hasRefreshToken ? "Refresh token present" : "No refresh token"}</Pill>
              <Pill tone="neutral">{projects.data?.projects?.length ?? 0} synced projects</Pill>
              <Pill tone="neutral">{people.data?.people?.length ?? 0} mapped people</Pill>
            </div>
            {(sync.error || syncEvidence.error || createTaskMutation.error || completeTaskMutation.error || eodMutation.error || generateBlueprint.error) && (
              <div className="mt-3">
                <Notice tone="err">{((sync.error || syncEvidence.error || createTaskMutation.error || completeTaskMutation.error || eodMutation.error || generateBlueprint.error) as Error).message}</Notice>
              </div>
            )}
          </Card>
          {readiness.data && (
            <Card>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList size={15} style={{ color: "var(--accent)" }} /> Pilot readiness</h2>
                  <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">Configuration gaps that must be resolved before enabling the full employee workflow.</p>
                </div>
                <Pill tone={readiness.data.ready ? "ok" : "warn"}>{readiness.data.status.replace("_", " ")}</Pill>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}><strong>{readiness.data.checks.people.active}</strong><span className="mt-1 block text-[var(--text-tertiary)]">people</span></div>
                <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}><strong>{readiness.data.checks.organization.activeTeams}</strong><span className="mt-1 block text-[var(--text-tertiary)]">teams</span></div>
                <div className="rounded border p-2" style={{ borderColor: "var(--border)" }}><strong>{readiness.data.checks.tasks.open}</strong><span className="mt-1 block text-[var(--text-tertiary)]">open tasks</span></div>
              </div>
              {readiness.data.issues.length ? (
                <ul className="mt-3 space-y-2 text-[11px] leading-4 text-[var(--text-secondary)]">
                  {readiness.data.issues.slice(0, 6).map((issue) => <li key={issue.code} className="border-l-2 pl-2" style={{ borderColor: issue.severity === "blocked" ? "var(--status-err)" : "var(--status-warn)" }}><strong>{issue.count}</strong> {issue.message}</li>)}
                  {readiness.data.issues.length > 6 && <li className="text-[var(--text-tertiary)]">+ {readiness.data.issues.length - 6} more checks</li>}
                </ul>
              ) : <p className="mt-3 text-[11px] text-[var(--status-ok)]">Pilot configuration is complete.</p>}
            </Card>
          )}
          {readiness.error && <Notice tone="err">Pilot readiness check failed: {(readiness.error as Error).message}</Notice>}
        </aside>

        <div className="space-y-4">
          {!schemaReady && (
            <MigrationRequired
              loading={system.isLoading}
              error={system.error ? (system.error as Error).message : system.data?.schema.error}
              migration={system.data?.schema.migration ?? "supabase/migrations/0008_work_os.sql"}
            />
          )}

          {schemaReady && tab === "today" && (
            <>
              <div className="grid gap-3 md:grid-cols-4">
                <Metric label="Open today" value={openToday} />
                <Metric label="Visible tasks" value={taskRows.length} />
                <Metric label="Completed in filter" value={completedCount} />
                <Metric label="Evidence today" value={evidenceRows.length} />
              </div>
              <Card>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-sm font-semibold"><ClipboardList size={15} style={{ color: "var(--accent)" }} /> Today queue</h2>
                  <div className="flex gap-2">
                    <button onClick={() => syncEvidence.mutate()} className="rounded-lg border px-3 py-2 text-[12px] font-semibold" style={{ borderColor: "var(--border)" }}>Sync Worktivity evidence</button>
                    <button disabled={!personId} onClick={() => eodMutation.mutate()} className="rounded-lg px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Draft EOD</button>
                  </div>
                </div>
                <TaskList tasks={todayRows} onComplete={(id) => completeTaskMutation.mutate(id)} />
              </Card>
              <Card>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><FileSearch size={15} style={{ color: "var(--accent)" }} /> Today evidence</h2>
                <EvidenceList rows={evidenceRows} />
              </Card>
            </>
          )}

          {schemaReady && tab === "tasks" && (
            <Card>
              <div className="mb-4 grid gap-3 md:grid-cols-3">
                <Field label="Task title"><input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Create a Nifty task" /></Field>
                <Field label="Description"><textarea value={taskDescription} onChange={(e) => setTaskDescription(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Context, links, or acceptance notes" rows={2} /></Field>
                <Field label="Nifty task group ID"><input value={taskGroupId} onChange={(e) => setTaskGroupId(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Required by Nifty" /></Field>
                <Field label="Parent task / subtask"><select value={taskParentId} onChange={(e) => setTaskParentId(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="">Top-level task</option>{taskRows.filter((task) => !task.parent_task_id).map((task) => <option key={task.provider_task_id || task.id} value={task.provider_task_id || task.id}>{task.title}</option>)}</select></Field>
                <Field label="Project"><select value={taskProjectId} onChange={(e) => setTaskProjectId(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="">Provider default</option>{(projects.data?.projects ?? []).map((project) => <option key={project.id} value={project.provider_project_id || project.id}>{project.name}</option>)}</select></Field>
                <Field label="Milestone ID"><input value={taskMilestoneId} onChange={(e) => setTaskMilestoneId(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Optional" /></Field>
                <Field label="Start date"><input type="date" value={taskStartDate} onChange={(e) => setTaskStartDate(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                <Field label="Due date"><input type="date" value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                <Field label="Priority"><input value={taskPriority} onChange={(e) => setTaskPriority(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Optional" /></Field>
                <Field label="Labels"><input value={taskLabels} onChange={(e) => setTaskLabels(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="comma, separated" /></Field>
                <Field label="Story points"><input type="number" min="0" value={taskStoryPoints} onChange={(e) => setTaskStoryPoints(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                <Field label="Expected outcome"><input value={taskExpectedOutcome} onChange={(e) => setTaskExpectedOutcome(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                <Field label="Definition of done"><input value={taskDefinitionOfDone} onChange={(e) => setTaskDefinitionOfDone(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                <Field label="Status filter">
                  <select value={completed} onChange={(e) => setCompleted(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}>
                    <option value="false">Open</option>
                    <option value="true">Completed</option>
                    <option value="">All</option>
                  </select>
                </Field>
                <button onClick={() => createTaskMutation.mutate()} disabled={!taskTitle || !taskGroupId || createTaskMutation.isPending} className="rounded-lg px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>{createTaskMutation.isPending ? "Submitting…" : taskParentId ? "Create subtask" : "Create task"}</button>
              </div>
              {taskProviderStatus && <Notice tone="info">{taskProviderStatus}</Notice>}
              <TaskList tasks={taskRows} onComplete={(id) => completeTaskMutation.mutate(id)} />
            </Card>
          )}

          {schemaReady && tab === "people" && (
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Users size={15} style={{ color: "var(--accent)" }} /> People mappings</h2>
              <div className="overflow-auto">
                <table className="w-full min-w-[760px] text-left text-[12px]">
                  <thead className="text-[var(--text-tertiary)]"><tr><th className="py-2">Name</th><th>Role</th><th>Nifty</th><th>Worktivity</th><th>Email</th></tr></thead>
                  <tbody>
                    {(people.data?.people ?? []).map((person) => (
                      <tr key={person.id} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="py-2 font-semibold">{person.display_name}</td>
                        <td><select aria-label={`Role profile for ${person.display_name}`} value={person.role_profile_id ?? ""} onChange={(event) => updatePerson.mutate({ id: person.id, role_profile_id: event.target.value || null })} className="border bg-transparent px-2 py-1" style={{ borderColor: "var(--border)" }}><option value="">Unmapped</option>{(people.data?.roleProfiles ?? []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></td>
                        <td className="font-mono text-[11px]">{person.nifty_member_id ?? "-"}</td>
                        <td className="font-mono text-[11px]">{person.worktivity_employee_id ?? "-"}</td>
                        <td>{person.email ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {schemaReady && tab === "schedules" && (
            <div className="space-y-4">
              <Card>
                <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><ClipboardList size={15} style={{ color: "var(--accent)" }} /> Recurring schedule</h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Field label="Timezone"><input role="combobox" aria-autocomplete="list" list="work-os-timezones" value={scheduleTimezone} onChange={(event) => setScheduleTimezone(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Search IANA timezone" /><datalist id="work-os-timezones">{supportedTimezones().map((zone) => <option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}</datalist></Field>
                  <Field label="Shift start"><input type="time" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                  <Field label="Shift end"><input type="time" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                  {!authoritativeBreaks && <><Field label="Break start"><input type="time" value={scheduleBreakStart} onChange={(event) => setScheduleBreakStart(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                  <Field label="Break end"><input type="time" value={scheduleBreakEnd} onChange={(event) => setScheduleBreakEnd(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field></>}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, day) => (
                    <button key={label} onClick={() => setScheduleDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort())} className="size-9 border text-[11px] font-semibold" style={{ borderColor: scheduleDays.includes(day) ? "var(--accent)" : "var(--border)", color: scheduleDays.includes(day) ? "var(--accent)" : "var(--text-tertiary)", background: scheduleDays.includes(day) ? "var(--accent-subtle)" : "transparent" }}>{label.slice(0, 1)}</button>
                  ))}
                  <button disabled={!personId || !scheduleDays.length || saveSchedule.isPending} onClick={() => saveSchedule.mutate()} className="ml-auto px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Save schedule</button>
                </div>
                {!personId ? <p className="mt-3 text-[12px] text-[var(--status-warn)]">Select a worker before saving a schedule.</p> : null}
                {saveSchedule.error ? <div className="mt-3"><Notice tone="err">{(saveSchedule.error as Error).message}</Notice></div> : null}
              </Card>
              <Card>
                <h2 className="mb-4 text-sm font-semibold">Schedule exception</h2>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Field label="Date"><input type="date" value={exceptionDate} onChange={(event) => setExceptionDate(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                  <Field label="Type"><select value={exceptionKind} onChange={(event) => setExceptionKind(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="leave">Leave</option><option value="changed_shift">Changed shift</option><option value="working_day">Working day</option></select></Field>
                  <Field label="Shift start"><input type="time" disabled={exceptionKind === "leave"} value={exceptionStart} onChange={(event) => setExceptionStart(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                  <Field label="Shift end"><input type="time" disabled={exceptionKind === "leave"} value={exceptionEnd} onChange={(event) => setExceptionEnd(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                  <Field label="Note"><input value={exceptionNote} onChange={(event) => setExceptionNote(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field>
                </div>
                <div className="mt-4 flex justify-end"><button disabled={!personId || !exceptionDate || saveException.isPending} onClick={() => saveException.mutate()} className="px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Save exception</button></div>
                {saveException.error ? <div className="mt-3"><Notice tone="err">{(saveException.error as Error).message}</Notice></div> : null}
              </Card>
              <Card>
                <h2 className="mb-3 text-sm font-semibold">Configured schedules</h2>
                <div className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {(schedules.data?.schedules ?? []).map((schedule) => (
                    <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-[12px]">
                      <div><p className="font-semibold text-[var(--text-primary)]">{schedule.person?.display_name}</p><p className="text-[var(--text-tertiary)]">{schedule.timezone}</p></div>
                      <p className="text-[var(--text-secondary)]">{String(schedule.shift_start).slice(0, 5)} - {String(schedule.shift_end).slice(0, 5)}</p>
                      <p className="text-[var(--text-tertiary)]">{(schedule.days_of_week ?? []).map((day: number) => ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][day]).join(" ")}</p>
                    </div>
                  ))}
                  {!schedules.data?.schedules?.length ? <p className="py-3 text-[12px] text-[var(--text-tertiary)]">No schedules configured for this selection.</p> : null}
                </div>
                {!!schedules.data?.exceptions?.length && <div className="mt-4 border-t pt-3" style={{ borderColor: "var(--border)" }}><h3 className="mb-2 text-[12px] font-semibold">Upcoming exceptions</h3>{schedules.data.exceptions.map((exception) => <div key={exception.id} className="flex flex-wrap justify-between gap-2 py-2 text-[12px]"><span>{exception.person?.display_name}</span><span>{exception.exception_date}</span><span className="text-[var(--text-tertiary)]">{String(exception.kind).replaceAll("_", " ")}</span></div>)}</div>}
              </Card>
            </div>
          )}

          {schemaReady && tab === "blueprints" && (
            <Card>
              <div className="mb-4 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
                <Field label="Client name"><input value={clientName} onChange={(e) => setClientName(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Client / account" /></Field>
                <Field label="Nifty task group ID"><input value={taskGroupId} onChange={(e) => setTaskGroupId(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="Where generated tasks go" /></Field>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {(blueprints.data?.blueprints ?? []).map((blueprint) => (
                  <div key={blueprint.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><Layers3 size={14} /> {blueprint.name}</h3>
                    <p className="mt-2 text-[12px] leading-5 text-[var(--text-secondary)]">{blueprint.description}</p>
                    <button onClick={() => generateBlueprint.mutate(blueprint.id)} disabled={!clientName || !taskGroupId} className="mt-3 rounded-lg px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Generate Nifty tasks</button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {schemaReady && tab === "evidence" && (
            <Card>
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <Field label="Manual context"><input value={evidenceText} onChange={(e) => setEvidenceText(e.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="What happened?" /></Field>
                <button disabled={!evidenceText} onClick={() => addEvidenceMutation.mutate()} className="rounded-lg px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Add evidence</button>
              </div>
              <EvidenceList rows={evidenceRows} />
            </Card>
          )}

          {schemaReady && tab === "reports" && (
            <Card>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sparkles size={15} style={{ color: "var(--accent)" }} /> Manager review</h2>
              <div className="grid gap-3">
                {reportRows.map((report) => (
                  <div key={report.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold">{report.title}</h3>
                        <p className="text-[12px] text-[var(--text-secondary)]">{report.person?.display_name ?? "Unknown"} · {report.status}</p>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => reviewMutation.mutate({ id: report.id, status: "approved" })} className="rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: "var(--status-ok)", color: "var(--status-ok)" }}>Approve</button>
                        <button onClick={() => reviewMutation.mutate({ id: report.id, status: "rejected" })} className="rounded-lg border px-2 py-1 text-[11px]" style={{ borderColor: "var(--status-err)", color: "var(--status-err)" }}>Reject</button>
                      </div>
                    </div>
                    <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg p-3 text-[11px] leading-5" style={{ background: "var(--bg-secondary)", color: "var(--text-secondary)" }}>{report.markdown}</pre>
                  </div>
                ))}
                {!reportRows.length && <Notice>No EOD reports drafted yet.</Notice>}
              </div>
            </Card>
          )}

          {schemaReady && tab === "settings" && (
            <Card>
              <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><AlertCircle size={15} style={{ color: "var(--accent)" }} /> Organization settings</h2>
              {(organization.error || organizationAction.error || updateFeatures.error) && <Notice tone="err">{((organization.error || organizationAction.error || updateFeatures.error) as Error).message}</Notice>}
              <div className="grid gap-6">
                <section className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-[12px] font-semibold">Pilot features</h3>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {[
                      ["employee_companion", "Employee check-ins"], ["desktop_companion", "Windows companion"],
                      ["github_evidence", "GitHub evidence"], ["ghl_evidence", "GHL evidence"], ["screenshot_summaries", "Screenshot summaries"],
                    ["seo_mission_control", "SEO Mission Control"],
                    ].map(([key, label]) => <label key={key} className="flex min-h-10 items-center justify-between border px-3 text-[12px]" style={{ borderColor: "var(--border)" }}><span>{label}</span><input type="checkbox" checked={organization.data?.organization?.feature_flags?.[key] === true} onChange={(event) => updateFeatures.mutate({ [key]: event.target.checked })} /></label>)}
                  </div>
                </section>
                <section className="border-b pb-5" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-[12px] font-semibold">Memberships</h3>
                  <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="User email"><input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} placeholder="employee@company.com" /></Field><Field label="Work OS role"><select value={memberRole} onChange={(event) => setMemberRole(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="employee">Employee</option><option value="manager">Manager</option><option value="admin">Admin</option></select></Field><button disabled={!memberEmail || organizationAction.isPending} onClick={() => organizationAction.mutate({ type: "membership", email: memberEmail, role: memberRole })} className="px-3 py-2 text-[12px] font-semibold" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Add or update</button></div>
                  <div className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>{(organization.data?.memberships ?? []).map((member) => <div key={member.id} className="grid items-center gap-3 py-2 text-[12px] md:grid-cols-[minmax(0,1fr)_auto_auto_auto]"><span>{member.person?.display_name || member.person?.email || member.user_id}</span><span className="uppercase text-[10px] text-[var(--text-tertiary)]">{member.role}</span>{[["employee_companion", "Companion"], ["desktop_companion", "Desktop"]].map(([key, label]) => <label key={key} className="flex items-center gap-2 text-[11px]"><input type="checkbox" checked={member.feature_flags?.[key] ?? organization.data?.organization?.feature_flags?.[key] === true} onChange={(event) => updateMembership.mutate({ membership_id: member.id, feature_flags: { ...(member.feature_flags ?? {}), [key]: event.target.checked } })} />{label}</label>)}</div>)}</div>
                </section>
                <section>
                  <h3 className="text-[12px] font-semibold">Teams</h3>
                  <div className="mt-3 flex items-end gap-2"><Field label="Team name"><input value={teamName} onChange={(event) => setTeamName(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field><button disabled={!teamName || organizationAction.isPending} onClick={() => organizationAction.mutate({ type: "team", name: teamName })} className="px-3 py-2 text-[12px] font-semibold" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Create team</button></div>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]"><Field label="Team"><select value={teamId} onChange={(event) => setTeamId(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="">Select</option>{(organization.data?.teams ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></Field><Field label="Person"><select value={teamPersonId} onChange={(event) => setTeamPersonId(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="">Select</option>{(people.data?.people ?? []).map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></Field><label className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={teamManager} onChange={(event) => setTeamManager(event.target.checked)} /> Manager</label><button disabled={!teamId || !teamPersonId || organizationAction.isPending} onClick={() => organizationAction.mutate({ type: "team_member", team_id: teamId, person_id: teamPersonId, is_manager: teamManager })} className="self-end px-3 py-2 text-[12px] font-semibold" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Assign</button></div>
                  <div className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>{(organization.data?.teams ?? []).map((team) => <div key={team.id} className="py-2 text-[12px]"><strong>{team.name}</strong><span className="ml-2 text-[var(--text-tertiary)]">{(organization.data?.teamMembers ?? []).filter((member) => member.team_id === team.id).map((member) => `${member.person?.display_name}${member.is_manager ? " (manager)" : ""}`).join(", ") || "No members"}</span></div>)}</div>
                </section>
                <section className="border-t pt-5" style={{ borderColor: "var(--border)" }}>
                  <div className="flex items-center justify-between gap-3"><h3 className="text-[12px] font-semibold">Provider connections</h3><a href="/api/work-os/nifty/oauth/start" className="border px-3 py-2 text-[11px] font-semibold" style={{ borderColor: "var(--border)" }}>Connect Nifty</a></div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5"><Field label="Provider"><select value={connectorProvider} onChange={(event) => setConnectorProvider(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="github">GitHub</option><option value="ghl">GHL</option><option value="worktivity">Worktivity</option></select></Field><Field label="Workspace ID"><input value={connectorWorkspaceId} onChange={(event) => setConnectorWorkspaceId(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field><Field label="Account ID"><input value={connectorAccountId} onChange={(event) => setConnectorAccountId(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field><Field label="Mapped person"><select value={connectorPersonId} onChange={(event) => setConnectorPersonId(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="">Unattributed</option>{(people.data?.people ?? []).map((person) => <option key={person.id} value={person.id}>{person.display_name}</option>)}</select></Field><button className="self-end px-3 py-2 text-[12px] font-semibold disabled:opacity-50" disabled={!connectorWorkspaceId || saveConnection.isPending} onClick={() => saveConnection.mutate()} style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Save connection</button></div>
                  <div className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>{(connections.data?.connections ?? []).map((connection) => <div key={connection.id} className="flex justify-between gap-3 py-2 text-[12px]"><span className="font-semibold">{connection.provider}</span><span className="font-mono text-[11px] text-[var(--text-tertiary)]">{connection.external_workspace_id}</span></div>)}</div>
                  {!!connections.data?.accounts?.length && <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>{connections.data.accounts.map((account) => <div key={account.id} className="grid gap-2 py-2 text-[11px] md:grid-cols-[80px_minmax(0,1fr)_minmax(0,1fr)_auto]"><span className="font-semibold">{account.provider}</span><span className="font-mono">{account.external_account_id}</span><span>{account.person?.display_name || "Unattributed"}</span><span className="text-[var(--text-tertiary)]">{account.verified ? "Verified" : "Unverified"}</span></div>)}</div>}
                  {saveConnection.error ? <Notice tone="err">{(saveConnection.error as Error).message}</Notice> : null}
                </section>
                <section className="border-t pt-5" style={{ borderColor: "var(--border)" }}>
                  <h3 className="text-[12px] font-semibold">Nifty custom fields</h3>
                  <div className="mt-3 flex flex-wrap items-end gap-2"><Field label="Work OS field"><select value={mappingField} onChange={(event) => setMappingField(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }}><option value="priority">Priority</option><option value="blocked_reason">Blocked reason</option><option value="estimated_effort_minutes">Estimated effort</option><option value="expected_outcome">Expected outcome</option><option value="definition_of_done">Definition of done</option></select></Field><Field label="Nifty field ID"><input value={mappingProviderFieldId} onChange={(event) => setMappingProviderFieldId(event.target.value)} className={inputClass} style={{ borderColor: "var(--border)" }} /></Field><button disabled={!mappingProviderFieldId || saveFieldMapping.isPending} onClick={() => saveFieldMapping.mutate()} className="px-3 py-2 text-[12px] font-semibold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--text-inverse)" }}>Save mapping</button></div>
                  <div className="mt-3 divide-y" style={{ borderColor: "var(--border)" }}>{(fieldMappings.data?.mappings ?? []).map((mapping) => <div key={mapping.id} className="flex justify-between gap-3 py-2 text-[12px]"><span>{String(mapping.semantic_field).replaceAll("_", " ")}</span><span className="font-mono text-[11px] text-[var(--text-tertiary)]">{mapping.provider_field_id}</span></div>)}</div>
                  {saveFieldMapping.error ? <Notice tone="err">{(saveFieldMapping.error as Error).message}</Notice> : null}
                </section>
              </div>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-tertiary)]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
    </Card>
  );
}

function MigrationRequired({ loading, error, migration }: { loading: boolean; error?: string; migration: string }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <div className="rounded-lg p-3" style={{ background: "rgba(176,107,21,.12)", color: "var(--status-warn)" }}>
          <AlertCircle size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {loading ? "Checking Work OS database..." : "Work OS migration required"}
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-[var(--text-secondary)]">
            The Work OS app code is deployed, but normalized persistence needs the Work OS tables before sync, evidence, blueprints, and reports can run.
          </p>
          <div className="mt-3 rounded-lg border p-3 text-[12px] leading-5" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
            Apply this migration in Supabase SQL editor or with a valid Postgres DB password:
            <div className="mt-2 font-mono text-[var(--text-primary)]">{migration}</div>
          </div>
          {error && <p className="mt-3 text-[12px] leading-5" style={{ color: "var(--status-warn)" }}>{error}</p>}
        </div>
      </div>
    </Card>
  );
}

function TaskList({ tasks, onComplete }: { tasks: AnyRow[]; onComplete: (id: string) => void }) {
  if (!tasks.length) return <Notice>No tasks found. Run Nifty sync or change the filters.</Notice>;
  return (
    <div className="grid gap-2">
      {tasks.map((task) => (
        <div key={task.id} className="rounded-lg border p-3" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{task.title}</h3>
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                {task.project?.name ?? task.provider_project_id ?? "No project"} · due {task.due_date ?? "unset"} · evidence {task.evidence?.length ?? 0}
              </p>
            </div>
            {task.completed ? <Pill tone="ok"><CheckCircle2 size={12} /> Complete</Pill> : (
              <button onClick={() => onComplete(task.id)} className="rounded-lg border px-2 py-1 text-[11px] font-semibold" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Complete</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EvidenceList({ rows }: { rows: AnyRow[] }) {
  if (!rows.length) return <Notice tone="warn">No evidence found for this filter. Sync Worktivity or add manual/agent context.</Notice>;
  return (
    <div className="grid gap-2">
      {rows.map((item) => (
        <div key={item.id} className="rounded-lg border p-3 text-[12px]" style={{ borderColor: "var(--border)", background: "var(--bg-secondary)" }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-[var(--text-primary)]">{item.title}</h3>
            <Pill tone={item.source === "worktivity" ? "ok" : "neutral"}>{item.source}</Pill>
          </div>
          <p className="mt-1 leading-5 text-[var(--text-secondary)]">{item.summary || "No summary"}</p>
          {item.metrics?.totalMinutes != null && <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">Tracked minutes: {item.metrics.totalMinutes}</p>}
        </div>
      ))}
    </div>
  );
}
