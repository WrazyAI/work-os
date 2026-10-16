import { todayIso as today } from "@/lib/work-os-dates";
import { resolveProviderAttribution } from "@/lib/work-os-attribution";

export type WorkOsReadinessStatus = "ready" | "needs_setup" | "blocked";
export type WorkOsReadinessSeverity = "needs_setup" | "blocked";
export type WorkOsProvider = "nifty" | "worktivity" | "github" | "ghl";

export interface WorkOsReadinessIssue {
  code: string;
  severity: WorkOsReadinessSeverity;
  count: number;
  message: string;
}

export interface WorkOsReadinessInput {
  organization: {
    id: string;
    name: string;
    slug: string;
    featureFlags?: Record<string, unknown> | null;
  };
  people: Array<{
    id: string;
    active?: boolean | null;
    authUserId?: string | null;
    niftyMemberId?: string | null;
    worktivityEmployeeId?: string | null;
    roleProfileId?: string | null;
  }>;
  memberships: Array<{
    personId?: string | null;
    role: "employee" | "manager" | "admin" | string;
    active?: boolean | null;
  }>;
  teams: Array<{ id: string; active?: boolean | null }>;
  teamMembers: Array<{
    teamId: string;
    personId: string;
    isManager?: boolean | null;
    active?: boolean | null;
  }>;
  schedules: Array<{
    personId: string;
    active?: boolean | null;
    effectiveFrom?: string | null;
    effectiveTo?: string | null;
  }>;
  roleProfiles: Array<{ id: string }>;
  connections: Array<{ provider: string; active?: boolean | null }>;
  credentials: Array<{ provider: string; expiresAt?: string | null }>;
  sourceAccounts: Array<{
    provider: string;
    personId?: string | null;
    verified?: boolean | null;
    metadata?: Record<string, unknown> | null;
  }>;
  tasks: Array<{
    completed?: boolean | null;
    assigneePersonIds?: string[] | null;
    dueDate?: string | null;
    priority?: string | null;
    estimatedEffort?: number | null;
    estimatedEffortMinutes?: number | null;
    expectedOutcome?: string | null;
    definitionOfDone?: string | null;
    taskGroupId?: string | null;
  }>;
  providerReady: Partial<Record<WorkOsProvider, boolean>>;
  runtime: {
    openAiConfigured: boolean;
    providerSecretConfigured: boolean;
    providerCredentialsPresent: boolean;
    screenshotEncryptionConfigured: boolean;
    cronSecretConfigured: boolean;
    worktivityConfigured: boolean;
    falConfigured: boolean;
    githubWebhookConfigured: boolean;
    ghlWebhookConfigured: boolean;
  };
}

export interface WorkOsReadinessReport {
  organization: WorkOsReadinessInput["organization"];
  status: WorkOsReadinessStatus;
  ready: boolean;
  issues: WorkOsReadinessIssue[];
  checks: {
    features: Record<string, boolean>;
    people: {
      active: number;
      withoutWorkOsAccount: number;
      withoutNiftyMapping: number;
      withoutWorktivityMapping: number;
      withoutRoleProfile: number;
      withoutTeam: number;
      withoutSchedule: number;
      employeesWithoutManager: number;
    };
    organization: {
      activeTeams: number;
      activeManagers: number;
      activeRoleProfiles: number;
      activeSchedules: number;
    };
    providers: {
      activeConnections: Record<string, number>;
      validCredentials: Record<string, number>;
      verifiedAccounts: Record<string, number>;
      ready: Record<string, boolean>;
    };
    tasks: {
      open: number;
      withoutAssignee: number;
      withoutDueDate: number;
      withoutPriority: number;
      withoutEstimatedEffort: number;
      withoutExpectedOutcome: number;
      withoutDefinitionOfDone: number;
      withoutTaskGroup: number;
    };
    runtime: WorkOsReadinessInput["runtime"];
  };
}

const providers: WorkOsProvider[] = ["nifty", "worktivity", "github", "ghl"];

function nonEmpty(value: string | number | null | undefined) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function active(value: boolean | null | undefined) {
  return value !== false;
}

function asFlag(value: unknown) {
  return value === true;
}

export function evaluateWorkOsReadiness(input: WorkOsReadinessInput): WorkOsReadinessReport {
  const flags = Object.fromEntries(
    Object.entries(input.organization.featureFlags ?? {}).map(([key, value]) => [key, asFlag(value)]),
  );
  const activePeople = input.people.filter((person) => active(person.active));
  const activeMemberships = input.memberships.filter((membership) => active(membership.active));
  const membershipByPerson = new Map(activeMemberships.filter((membership) => membership.personId).map((membership) => [membership.personId as string, membership]));
  const employeePeople = activePeople.filter((person) => {
    const role = membershipByPerson.get(person.id)?.role;
    return role !== "manager" && role !== "admin";
  });
  const activeTeams = input.teams.filter((team) => active(team.active));
  const activeTeamIds = new Set(activeTeams.map((team) => team.id));
  const teamMembers = input.teamMembers.filter((member) => active(member.active) && activeTeamIds.has(member.teamId));
  const teamsByPerson = new Map<string, Set<string>>();
  const managerTeamIds = new Set<string>();
  for (const member of teamMembers) {
    const personTeams = teamsByPerson.get(member.personId) ?? new Set<string>();
    personTeams.add(member.teamId);
    teamsByPerson.set(member.personId, personTeams);
    if (member.isManager) managerTeamIds.add(member.teamId);
  }
  const activeSchedules = input.schedules.filter((schedule) => {
    if (!active(schedule.active)) return false;
    const current = !schedule.effectiveFrom || schedule.effectiveFrom <= today();
    const notExpired = !schedule.effectiveTo || schedule.effectiveTo >= today();
    return current && notExpired;
  });
  const scheduledPeople = new Set(activeSchedules.map((schedule) => schedule.personId));
  const teamPeople = new Set(teamMembers.map((member) => member.personId));
  const employeesWithoutManager = employeePeople.filter((person) => {
    const personTeams = teamsByPerson.get(person.id) ?? new Set<string>();
    return ![...personTeams].some((teamId) => managerTeamIds.has(teamId));
  });
  const organizationPeople = new Set(input.people.map((person) => person.id));
  const verifiedAccounts = Object.fromEntries(providers.map((provider) => [
    provider,
    input.sourceAccounts.filter((account) => account.provider === provider && organizationPeople.has(account.personId ?? "") && resolveProviderAttribution(account).personId !== null).length,
  ]));
  const activeConnections = Object.fromEntries(providers.map((provider) => [
    provider,
    input.connections.filter((connection) => connection.provider === provider && active(connection.active)).length,
  ]));
  const validCredentials = Object.fromEntries(providers.map((provider) => [
    provider,
    input.credentials.filter((credential) => {
      if (credential.provider !== provider) return false;
      return !credential.expiresAt || new Date(credential.expiresAt).getTime() > Date.now() + 60_000;
    }).length,
  ]));
  const providerReady = Object.fromEntries(providers.map((provider) => [provider, input.providerReady[provider] === true]));
  const openTasks = input.tasks.filter((task) => task.completed !== true);
  const taskChecks = {
    open: openTasks.length,
    withoutAssignee: openTasks.filter((task) => !task.assigneePersonIds?.length).length,
    withoutDueDate: openTasks.filter((task) => !nonEmpty(task.dueDate)).length,
    withoutPriority: openTasks.filter((task) => !nonEmpty(task.priority)).length,
    withoutEstimatedEffort: openTasks.filter((task) => task.estimatedEffort == null && task.estimatedEffortMinutes == null).length,
    withoutExpectedOutcome: openTasks.filter((task) => !nonEmpty(task.expectedOutcome)).length,
    withoutDefinitionOfDone: openTasks.filter((task) => !nonEmpty(task.definitionOfDone)).length,
    withoutTaskGroup: openTasks.filter((task) => !nonEmpty(task.taskGroupId)).length,
  };
  const peopleChecks = {
    active: activePeople.length,
    withoutWorkOsAccount: employeePeople.filter((person) => !nonEmpty(person.authUserId) || !membershipByPerson.has(person.id)).length,
    withoutNiftyMapping: employeePeople.filter((person) => !nonEmpty(person.niftyMemberId)).length,
    withoutWorktivityMapping: employeePeople.filter((person) => !nonEmpty(person.worktivityEmployeeId)).length,
    withoutRoleProfile: employeePeople.filter((person) => !nonEmpty(person.roleProfileId)).length,
    withoutTeam: employeePeople.filter((person) => !teamPeople.has(person.id)).length,
    withoutSchedule: employeePeople.filter((person) => !scheduledPeople.has(person.id)).length,
    employeesWithoutManager: employeesWithoutManager.length,
  };
  const features = {
    employee_companion: asFlag(flags.employee_companion),
    desktop_companion: asFlag(flags.desktop_companion),
    github_evidence: asFlag(flags.github_evidence),
    ghl_evidence: asFlag(flags.ghl_evidence),
    screenshot_summaries: asFlag(flags.screenshot_summaries),
    voice_input: asFlag(flags.voice_input),
  };
  const issues: WorkOsReadinessIssue[] = [];
  const addIssue = (code: string, severity: WorkOsReadinessSeverity, count: number, message: string) => {
    if (count > 0) issues.push({ code, severity, count, message });
  };

  addIssue("feature.employee_companion_disabled", "blocked", features.employee_companion ? 0 : 1, "Employee Companion is disabled for this organization.");
  addIssue("feature.desktop_companion_disabled", "needs_setup", features.desktop_companion ? 0 : 1, "Desktop Companion is disabled for this organization.");
  addIssue("people.none", "needs_setup", peopleChecks.active ? 0 : 1, "No active Work OS people are configured.");
  addIssue("people.work_os_account_missing", "needs_setup", peopleChecks.withoutWorkOsAccount, "Active employees need a WrazyOS account mapping and active membership.");
  addIssue("people.worktivity_mapping_missing", "needs_setup", peopleChecks.withoutWorktivityMapping, "Active employees need a Worktivity employee mapping for activity evidence.");
  addIssue("people.role_profile_missing", "needs_setup", peopleChecks.withoutRoleProfile, "Active employees need a role profile before the pilot can define expected outputs.");
  addIssue("people.team_missing", "needs_setup", peopleChecks.withoutTeam, "Active employees need an active team assignment.");
  addIssue("people.schedule_missing", "needs_setup", peopleChecks.withoutSchedule, "Active employees need a current effective schedule.");
  addIssue("people.manager_missing", "needs_setup", peopleChecks.employeesWithoutManager, "Employees need a team with an assigned manager/reviewer.");

  const requiredProviders: WorkOsProvider[] = [];
  if (features.screenshot_summaries || employeePeople.some((person) => nonEmpty(person.worktivityEmployeeId))) requiredProviders.push("worktivity");
  if (features.github_evidence) requiredProviders.push("github");
  if (features.ghl_evidence) requiredProviders.push("ghl");
  for (const provider of [...new Set(requiredProviders)]) {
    addIssue(`provider.${provider}.unavailable`, provider === "nifty" ? "blocked" : "needs_setup", providerReady[provider] ? 0 : 1, `${provider} is required by the current pilot configuration but is not ready.`);
  }
  if (features.github_evidence) addIssue("provider.github.identity_unverified", "needs_setup", verifiedAccounts.github ? 0 : 1, "At least one verified GitHub identity is required before GitHub evidence is attributable.");
  if (features.ghl_evidence) addIssue("provider.ghl.identity_unverified", "needs_setup", verifiedAccounts.ghl ? 0 : 1, "At least one verified GoHighLevel identity is required before CRM evidence is attributable.");
  addIssue("runtime.openai_missing", "blocked", features.employee_companion && !input.runtime.openAiConfigured ? 1 : 0, "OPENAI_API_KEY is required for Work OS proposal generation.");
  addIssue("runtime.provider_secret_missing", "blocked", input.runtime.providerCredentialsPresent && !input.runtime.providerSecretConfigured ? 1 : 0, "WORK_OS_PROVIDER_SECRET_KEY is required to decrypt stored provider credentials.");
  addIssue("runtime.worktivity_key_missing", "needs_setup", requiredProviders.includes("worktivity") && !input.runtime.worktivityConfigured ? 1 : 0, "WORKTIVITY_API_KEY is required for Worktivity evidence synchronization.");
  addIssue("runtime.fal_key_missing", "needs_setup", features.voice_input && !input.runtime.falConfigured ? 1 : 0, "FAL_API_KEY is required for Work OS voice input and for reading recaps aloud.");
  addIssue("runtime.github_webhook_missing", "needs_setup", features.github_evidence && !input.runtime.githubWebhookConfigured ? 1 : 0, "WORK_OS_GITHUB_WEBHOOK_SECRET is required for GitHub evidence ingestion.");
  addIssue("runtime.ghl_webhook_missing", "needs_setup", features.ghl_evidence && !input.runtime.ghlWebhookConfigured ? 1 : 0, "WORK_OS_GHL_WEBHOOK_PUBLIC_KEY is required for GoHighLevel evidence ingestion.");
  addIssue("runtime.screenshot_encryption_missing", "blocked", features.screenshot_summaries && !input.runtime.screenshotEncryptionConfigured ? 1 : 0, "WORK_OS_SCREENSHOT_ENCRYPTION_KEY is required for retained screenshots.");
  addIssue("runtime.retention_secret_missing", "blocked", features.screenshot_summaries && !input.runtime.cronSecretConfigured ? 1 : 0, "CRON_SECRET is required for scheduled screenshot retention deletion.");
  addIssue("tasks.assignee_missing", "needs_setup", taskChecks.withoutAssignee, "Open tasks need mapped assignees before task evidence can be attributed.");
  addIssue("tasks.due_date_missing", "needs_setup", taskChecks.withoutDueDate, "Open tasks need due dates for schedule-aware My Day planning.");
  addIssue("tasks.priority_missing", "needs_setup", taskChecks.withoutPriority, "Open tasks need normalized priority metadata.");
  addIssue("tasks.effort_missing", "needs_setup", taskChecks.withoutEstimatedEffort, "Open tasks need estimated effort metadata.");
  addIssue("tasks.expected_outcome_missing", "needs_setup", taskChecks.withoutExpectedOutcome, "Open tasks need an expected outcome.");
  addIssue("tasks.definition_of_done_missing", "needs_setup", taskChecks.withoutDefinitionOfDone, "Open tasks need a definition of done.");
  addIssue("tasks.task_group_missing", "needs_setup", taskChecks.withoutTaskGroup, "Open tasks need a normalized task group.");

  const status: WorkOsReadinessStatus = issues.some((issue) => issue.severity === "blocked")
    ? "blocked"
    : issues.length ? "needs_setup" : "ready";
  return {
    organization: input.organization,
    status,
    ready: status === "ready",
    issues,
    checks: {
      features,
      people: peopleChecks,
      organization: {
        activeTeams: activeTeams.length,
        activeManagers: new Set(teamMembers.filter((member) => member.isManager).map((member) => member.personId)).size,
        activeRoleProfiles: input.roleProfiles.length,
        activeSchedules: activeSchedules.length,
      },
      providers: { activeConnections, validCredentials, verifiedAccounts, ready: providerReady },
      tasks: taskChecks,
      runtime: input.runtime,
    },
  };
}
