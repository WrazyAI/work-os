#!/usr/bin/env tsx

import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { evaluateWorkOsReadiness } from "@/lib/work-os-readiness";

type Db = pg.Client;

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try { process.loadEnvFile(file); } catch { /* explicit process.env remains authoritative */ }
  }
}

function connectionString() {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!password || !supabaseUrl) return null;
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  return `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres`;
}

function args() {
  const values = process.argv.slice(2);
  const organizationIndex = values.indexOf("--organization");
  return {
    organizationId: organizationIndex >= 0 ? values[organizationIndex + 1] || null : null,
    strict: values.includes("--strict"),
  };
}

function isValidCredential(expiresAt: string | null) {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now() + 60_000;
}

async function auditOrganization(db: Db, organization: { id: string; name: string; slug: string; legacy_owner_id: string | null; feature_flags: Record<string, unknown> | null }) {
  const id = organization.id;
  const [people, memberships, teams, schedules, roleProfiles, connections, credentials, sourceAccounts, tasks, teamMembers] = await Promise.all([
    db.query("select id,active,auth_user_id,nifty_member_id,worktivity_employee_id,role_profile_id from work_people where organization_id=$1", [id]),
    db.query("select person_id,role,active from work_org_members where organization_id=$1", [id]),
    db.query("select id,active from work_teams where organization_id=$1", [id]),
    db.query("select person_id,active,effective_from,effective_to from work_schedules where organization_id=$1", [id]),
    db.query("select id from work_role_profiles where organization_id=$1", [id]),
    db.query("select provider,active from work_provider_connections where organization_id=$1", [id]),
    db.query("select provider,expires_at from work_provider_credentials where organization_id=$1", [id]),
    db.query("select provider,person_id,verified,metadata from work_source_accounts where organization_id=$1", [id]),
    db.query("select completed,assignee_person_ids,due_date,priority,estimated_effort,estimated_effort_minutes,expected_outcome,definition_of_done,task_group_id from work_tasks where organization_id=$1 and completed=false", [id]),
    db.query("select tm.team_id,tm.person_id,tm.is_manager from work_team_members tm join work_teams t on t.id=tm.team_id where t.organization_id=$1", [id]),
  ]);
  const connectionRows = connections.rows as Array<{ provider: string; active: boolean }>;
  const credentialRows = credentials.rows as Array<{ provider: string; expires_at: string | null }>;
  const activeNiftyConnection = connectionRows.some((row) => row.provider === "nifty" && row.active !== false);
  const validNiftyCredential = credentialRows.some((row) => row.provider === "nifty" && isValidCredential(row.expires_at));
  const legacyNiftyConfigured = Boolean(process.env.NIFTY_ACCESS_TOKEN || (process.env.NIFTY_REFRESH_TOKEN && process.env.NIFTY_CLIENT_ID && process.env.NIFTY_CLIENT_SECRET));
  const legacyNiftyAllowed = process.env.WORK_OS_LEGACY_NIFTY_OWNER_USER_ID
    ? process.env.WORK_OS_LEGACY_NIFTY_OWNER_USER_ID === organization.legacy_owner_id
    : legacyNiftyConfigured;
  const worktivityReady = Boolean(process.env.WORKTIVITY_API_KEY);
  const providerReady = {
    nifty: (activeNiftyConnection && validNiftyCredential) || legacyNiftyAllowed,
    worktivity: worktivityReady,
    github: connectionRows.some((row) => row.provider === "github" && row.active !== false) && Boolean(process.env.WORK_OS_GITHUB_WEBHOOK_SECRET),
    ghl: connectionRows.some((row) => row.provider === "ghl" && row.active !== false) && Boolean(process.env.WORK_OS_GHL_WEBHOOK_PUBLIC_KEY),
  };
  return evaluateWorkOsReadiness({
    organization: { id: organization.id, name: organization.name, slug: organization.slug, featureFlags: organization.feature_flags },
    people: people.rows.map((row) => ({ id: row.id, active: row.active, authUserId: row.auth_user_id, niftyMemberId: row.nifty_member_id, worktivityEmployeeId: row.worktivity_employee_id, roleProfileId: row.role_profile_id })),
    memberships: memberships.rows.map((row) => ({ personId: row.person_id, role: row.role, active: row.active })),
    teams: teams.rows.map((row) => ({ id: row.id, active: row.active })),
    teamMembers: teamMembers.rows.map((row) => ({ teamId: row.team_id, personId: row.person_id, isManager: row.is_manager })),
    schedules: schedules.rows.map((row) => ({ personId: row.person_id, active: row.active, effectiveFrom: row.effective_from, effectiveTo: row.effective_to })),
    roleProfiles: roleProfiles.rows.map((row) => ({ id: row.id })),
    connections: connectionRows,
    credentials: credentialRows.map((row) => ({ provider: row.provider, expiresAt: row.expires_at })),
    sourceAccounts: sourceAccounts.rows.map((row) => ({ provider: row.provider, personId: row.person_id, verified: row.verified, metadata: row.metadata })),
    tasks: tasks.rows.map((row) => ({ completed: row.completed, assigneePersonIds: row.assignee_person_ids, dueDate: row.due_date, priority: row.priority, estimatedEffort: row.estimated_effort, estimatedEffortMinutes: row.estimated_effort_minutes, expectedOutcome: row.expected_outcome, definitionOfDone: row.definition_of_done, taskGroupId: row.task_group_id })),
    providerReady,
    runtime: {
      aiConfigured: Boolean(process.env.OPENROUTER_API_KEY),
      providerSecretConfigured: Boolean(process.env.WORK_OS_PROVIDER_SECRET_KEY),
      providerCredentialsPresent: credentialRows.length > 0,
      screenshotEncryptionConfigured: Boolean(process.env.WORK_OS_SCREENSHOT_ENCRYPTION_KEY),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      worktivityConfigured: worktivityReady,
      falConfigured: Boolean(process.env.FAL_API_KEY),
      githubWebhookConfigured: Boolean(process.env.WORK_OS_GITHUB_WEBHOOK_SECRET),
      ghlWebhookConfigured: Boolean(process.env.WORK_OS_GHL_WEBHOOK_PUBLIC_KEY),
    },
  });
}

export async function runPilotAudit() {
  loadEnv();
  const options = args();
  const connection = connectionString();
  if (!connection) throw new Error("Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD + NEXT_PUBLIC_SUPABASE_URL before running the pilot audit.");
  const db = new pg.Client({ connectionString: connection, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10_000 });
  try {
    await db.connect();
    const organizations = await db.query(
      options.organizationId
        ? "select id,name,slug,legacy_owner_id,feature_flags from work_organizations where id=$1 order by name"
        : "select id,name,slug,legacy_owner_id,feature_flags from work_organizations order by name",
      options.organizationId ? [options.organizationId] : [],
    );
    if (!organizations.rows.length) throw new Error(options.organizationId ? `No Work OS organization found for ${options.organizationId}.` : "No Work OS organizations found.");
    const reports = [];
    for (const organization of organizations.rows) reports.push(await auditOrganization(db, organization));
    const summary = {
      organizations: reports.length,
      ready: reports.filter((report) => report.status === "ready").length,
      needsSetup: reports.filter((report) => report.status === "needs_setup").length,
      blocked: reports.filter((report) => report.status === "blocked").length,
    };
    return { generatedAt: new Date().toISOString(), strict: options.strict, summary, organizations: reports };
  } finally {
    await db.end().catch(() => undefined);
  }
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  void runPilotAudit().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    if (report.strict && (report.summary.needsSetup > 0 || report.summary.blocked > 0)) process.exitCode = 1;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
