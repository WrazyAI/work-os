import { voiceInputConfigured } from "@/lib/aiTranscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateWorkOsReadiness } from "@/lib/work-os-readiness";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { worktivityConfigured } from "@/lib/worktivity";

/** Loads the live readiness inputs for an organization and evaluates the
 * canonical readiness report. Shared by the readiness route and the admin
 * overview so both surfaces report the same configuration truth. */
export async function loadWorkOsReadinessReport(access: WorkOsAccess) {
  const db = createAdminClient();
  const organizationId = access.organizationId;
  const [organization, people, memberships, teams, schedules, roleProfiles, connections, credentials, sourceAccounts, tasks] = await Promise.all([
    db.from("work_organizations").select("id,name,slug,feature_flags").eq("id", organizationId).single(),
    db.from("work_people").select("id,active,auth_user_id,nifty_member_id,worktivity_employee_id,role_profile_id").eq("organization_id", organizationId),
    db.from("work_org_members").select("person_id,role,active").eq("organization_id", organizationId),
    db.from("work_teams").select("id,active").eq("organization_id", organizationId),
    db.from("work_schedules").select("person_id,active,effective_from,effective_to").eq("organization_id", organizationId),
    db.from("work_role_profiles").select("id").eq("organization_id", organizationId),
    db.from("work_provider_connections").select("provider,active").eq("organization_id", organizationId),
    db.from("work_provider_credentials").select("provider,expires_at").eq("organization_id", organizationId),
    db.from("work_source_accounts").select("provider,person_id,verified,metadata").eq("organization_id", organizationId),
    db.from("work_tasks").select("completed,assignee_person_ids,due_date,priority,estimated_effort,estimated_effort_minutes,expected_outcome,definition_of_done,task_group_id").eq("organization_id", organizationId).eq("completed", false),
  ]);
  const activeTeamIds = (teams.data ?? []).filter((team: any) => team.active !== false).map((team: any) => team.id as string);
  const teamMembers = activeTeamIds.length
    ? await db.from("work_team_members").select("team_id,person_id,is_manager").in("team_id", activeTeamIds)
    : { data: [], error: null };
  for (const result of [organization, people, memberships, teams, schedules, roleProfiles, connections, credentials, sourceAccounts, tasks, teamMembers]) {
    if (result.error) throw result.error;
  }
  if (!organization.data) throw new Error("Work OS organization not found");
  const connectionRows = connections.data ?? [];
  const providerReady = {
    worktivity: worktivityConfigured(),
    github: connectionRows.some((row: any) => row.provider === "github" && row.active !== false) && !!process.env.WORK_OS_GITHUB_WEBHOOK_SECRET,
    ghl: connectionRows.some((row: any) => row.provider === "ghl" && row.active !== false) && !!process.env.WORK_OS_GHL_WEBHOOK_PUBLIC_KEY,
  };
  return evaluateWorkOsReadiness({
    organization: {
      id: organization.data.id,
      name: organization.data.name,
      slug: organization.data.slug,
      featureFlags: organization.data.feature_flags,
    },
    people: (people.data ?? []).map((person: any) => ({
      id: person.id,
      active: person.active,
      authUserId: person.auth_user_id,
      worktivityEmployeeId: person.worktivity_employee_id,
      roleProfileId: person.role_profile_id,
    })),
    memberships: (memberships.data ?? []).map((membership: any) => ({ personId: membership.person_id, role: membership.role, active: membership.active })),
    teams: (teams.data ?? []).map((team: any) => ({ id: team.id, active: team.active })),
    teamMembers: (teamMembers.data ?? []).map((member: any) => ({ teamId: member.team_id, personId: member.person_id, isManager: member.is_manager })),
    schedules: (schedules.data ?? []).map((schedule: any) => ({ personId: schedule.person_id, active: schedule.active, effectiveFrom: schedule.effective_from, effectiveTo: schedule.effective_to })),
    roleProfiles: (roleProfiles.data ?? []).map((profile: any) => ({ id: profile.id })),
    connections: connectionRows.map((connection: any) => ({ provider: connection.provider, active: connection.active })),
    credentials: (credentials.data ?? []).map((credential: any) => ({ provider: credential.provider, expiresAt: credential.expires_at })),
    sourceAccounts: (sourceAccounts.data ?? []).map((account: any) => ({ provider: account.provider, personId: account.person_id, verified: account.verified, metadata: account.metadata as Record<string, unknown> | null })),
    tasks: (tasks.data ?? []).map((task: any) => ({
      completed: task.completed,
      assigneePersonIds: task.assignee_person_ids,
      dueDate: task.due_date,
      priority: task.priority,
      estimatedEffort: task.estimated_effort,
      estimatedEffortMinutes: task.estimated_effort_minutes,
      expectedOutcome: task.expected_outcome,
      definitionOfDone: task.definition_of_done,
      taskGroupId: task.task_group_id,
    })),
    providerReady,
    runtime: {
      aiConfigured: !!process.env.OPENROUTER_API_KEY,
      providerSecretConfigured: !!process.env.WORK_OS_PROVIDER_SECRET_KEY,
      providerCredentialsPresent: (credentials.data ?? []).length > 0,
      screenshotEncryptionConfigured: !!process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY,
      cronSecretConfigured: !!process.env.CRON_SECRET,
      worktivityConfigured: worktivityConfigured(),
      falConfigured: voiceInputConfigured(),
      githubWebhookConfigured: !!process.env.WORK_OS_GITHUB_WEBHOOK_SECRET,
      ghlWebhookConfigured: !!process.env.WORK_OS_GHL_WEBHOOK_PUBLIC_KEY,
    },
  });
}
