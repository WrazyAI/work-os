import { voiceInputConfigured } from "@/lib/aiTranscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPool } from "@/lib/db/pool";
import { evaluateWorkOsReadiness } from "@/lib/work-os-readiness";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { worktivityConfigured } from "@/lib/worktivity";

/** Loads the live readiness inputs for an organization and evaluates the
 * canonical readiness report. Setup has its own authenticated endpoint and
 * client lifecycle, not a process-global stale configuration cache. */
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
    // Match String.trim() in the canonical evaluator, including non-ASCII
    // ECMAScript whitespace. Zero effort is present metadata, not missing.
    getPool().query(`select
      count(*)::int as "open",
      count(*) filter (where coalesce(cardinality(assignee_person_ids), 0) = 0)::int as "withoutAssignee",
      count(*) filter (where due_date is null)::int as "withoutDueDate",
      count(*) filter (where priority is null or btrim(priority, $2) = '')::int as "withoutPriority",
      count(*) filter (where estimated_effort is null and estimated_effort_minutes is null)::int as "withoutEstimatedEffort",
      count(*) filter (where expected_outcome is null or btrim(expected_outcome, $2) = '')::int as "withoutExpectedOutcome",
      count(*) filter (where definition_of_done is null or btrim(definition_of_done, $2) = '')::int as "withoutDefinitionOfDone",
      count(*) filter (where task_group_id is null)::int as "withoutTaskGroup"
      from work_tasks where organization_id = $1 and completed = false
        and (status is null or status not in ('archived', 'deleted'))`,
    [organizationId, " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"]),
  ]);
  const activeTeamIds = (teams.data ?? []).filter((team: any) => team.active !== false).map((team: any) => team.id as string);
  const teamMembers = activeTeamIds.length
    ? await db.from("work_team_members").select("team_id,person_id,is_manager").in("team_id", activeTeamIds)
    : { data: [], error: null };
  for (const result of [organization, people, memberships, teams, schedules, roleProfiles, connections, credentials, sourceAccounts, teamMembers]) {
    if (result.error) throw result.error;
  }
  if (!organization.data) throw new Error("Work OS organization not found");
  const connectionRows = connections.data ?? [];
  // GHL readiness is its sync state, not a webhook secret: the pilot location is
  // read-only PIT polling, so a secret would report a healthy integration that
  // is actually not syncing.
  let ghlStates: Array<{ state: string }> = [];
  try {
    const syncStates = await db.from("work_ghl_sync_state").select("state").eq("organization_id", organizationId).limit(200);
    if (!syncStates.error) ghlStates = (syncStates.data ?? []) as Array<{ state: string }>;
  } catch {
    ghlStates = [];
  }
  const providerReady = {
    worktivity: worktivityConfigured(),
    github: connectionRows.some((row: any) => row.provider === "github" && row.active !== false) && !!process.env.WORK_OS_GITHUB_WEBHOOK_SECRET,
    ghl: connectionRows.some((row: any) => row.provider === "ghl" && row.active !== false)
      && ghlStates.length > 0
      && !ghlStates.some((row) => row.state === "failed"),
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
    tasks: [],
    taskChecks: tasks.rows[0] as import("@/lib/work-os-readiness").WorkOsReadinessReport["checks"]["tasks"],
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
