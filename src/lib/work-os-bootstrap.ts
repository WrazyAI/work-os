import { db, ensureNoError, isWorkOsMigrationRequired } from "@/lib/work-os-internal";

export const DEFAULT_ROLE_PROFILES = [
  {
    slug: "crm_sales",
    name: "CRM / Sales",
    description: "Assessed from assigned Nifty work and actor-attributed CRM outcomes, with activity retained only as supporting context.",
    productivity_rules: {
      expectedOutcomes: ["timely follow-ups", "documented client communication", "appointments", "qualified pipeline movement"],
      primarySignals: ["ghl_notes", "completed_calls", "outbound_messages", "appointments", "pipeline_changes"],
      qualitySignals: ["CRM notes attached", "next action recorded", "task outcome evidence"],
      validBlockers: ["missing lead data", "client unavailable", "approval required", "CRM outage"],
      prohibitedInferences: ["screen time equals productivity", "CRM usage alone proves output", "assigned lead equals contacted lead"],
    },
    evidence_requirements: ["actor-attributed GHL event", "client communication record", "appointment or pipeline change", "Nifty task linkage when available"],
  },
  {
    slug: "media_editor",
    name: "Media / Creative",
    description: "Measured by deliverables, revisions completed, asset movement, and tool activity aligned with assigned client work.",
    productivity_rules: { primarySignals: ["deliverables", "asset_exports", "review_cycles"], avoid: ["app time without output"] },
    evidence_requirements: ["asset link or export", "revision note", "client/project task"],
  },
  {
    slug: "ops_support",
    name: "Operations / Support",
    description: "Measured by ticket resolution, blocker removal, response time, and operational reliability evidence.",
    productivity_rules: { primarySignals: ["tickets_resolved", "sla_response", "ops_updates"], avoid: ["busywork without resolved state"] },
    evidence_requirements: ["resolved ticket", "ops note", "customer/internal response"],
  },
  {
    slug: "engineer",
    name: "Engineering",
    description: "Assessed from assigned Nifty outcomes and verified engineering artifacts, reviews, deployments, and resolved incidents.",
    productivity_rules: {
      expectedOutcomes: ["working changes", "reviewed code", "reliable deployments", "resolved incidents", "technical decisions"],
      primarySignals: ["merged_prs", "submitted_reviews", "successful_ci", "deployments", "resolved_incidents", "technical_documents"],
      qualitySignals: ["tests and CI", "review outcome", "deployment result", "definition-of-done evidence"],
      validBlockers: ["dependency unavailable", "review required", "environment failure", "unclear acceptance criteria"],
      prohibitedInferences: ["commit count equals productivity", "lines of code measure value", "IDE time proves output", "activity alone proves completion"],
    },
    evidence_requirements: ["verified GitHub account", "PR/review/deployment artifact", "Nifty task or explicit work claim", "technical blocker when incomplete"],
  },
  {
    slug: "manager",
    name: "Manager",
    description: "Measured by team throughput, review quality, unblock decisions, and approved reports.",
    productivity_rules: { primarySignals: ["reviews", "planning", "approvals", "unblocked_work"], avoid: ["meetings without decisions"] },
    evidence_requirements: ["review note", "decision log", "team report"],
  },
  {
    slug: "admin",
    name: "Admin",
    description: "System administrator profile for setup, mappings, syncs, and audits.",
    productivity_rules: { primarySignals: ["configuration", "audit", "integrations"], avoid: ["untracked manual changes"] },
    evidence_requirements: ["change note", "sync result", "audit trail"],
  },
] as const;

export const DEFAULT_ONBOARDING_BLUEPRINT = {
  slug: "client-onboarding",
  name: "Client Onboarding",
  description: "Blueprint for converting a newly onboarded client into a fully set up account with CRM, media, launch, and handoff steps.",
  phases: [
    {
      name: "Intake",
      tasks: [
        { name: "Collect client intake details", evidence: ["intake form", "CRM account"], offsetDays: 0 },
        { name: "Confirm scope, owner, and success metric", evidence: ["scope note"], offsetDays: 0 },
      ],
    },
    {
      name: "CRM Setup",
      tasks: [
        { name: "Create/update CRM company and contacts", evidence: ["CRM record"], offsetDays: 1 },
        { name: "Set pipeline stage and next follow-up", evidence: ["CRM activity"], offsetDays: 1 },
      ],
    },
    {
      name: "Media Setup",
      tasks: [
        { name: "Create media workspace and asset folders", evidence: ["folder link"], offsetDays: 2 },
        { name: "Attach brand assets and campaign references", evidence: ["asset link"], offsetDays: 2 },
      ],
    },
    {
      name: "Launch",
      tasks: [
        { name: "Prepare campaign launch checklist", evidence: ["checklist"], offsetDays: 3 },
        { name: "Run launch QA and record blockers", evidence: ["QA note"], offsetDays: 4 },
      ],
    },
    {
      name: "Handoff",
      tasks: [
        { name: "Send onboarding handoff report", evidence: ["report"], offsetDays: 5 },
      ],
    },
  ],
};

export async function ensureWorkOsDefaults(userId: string) {
  const supabase = db();
  await ensureNoError(
    supabase.from("work_role_profiles").upsert(
      DEFAULT_ROLE_PROFILES.map((profile) => ({ ...profile, user_id: userId })),
      { onConflict: "user_id,slug" },
    ),
    "seed role profiles",
  );

  await ensureNoError(
    supabase.from("work_blueprints").upsert(
      { ...DEFAULT_ONBOARDING_BLUEPRINT, user_id: userId, active: true },
      { onConflict: "user_id,slug" },
    ),
    "seed onboarding blueprint",
  );
}

export async function checkWorkOsSchemaReady() {
  try {
    await ensureNoError(db().from("work_role_profiles").select("id").limit(1), "check Work OS schema");
    await ensureNoError(db().from("work_task_proposals").select("id").limit(1), "check Work OS companion schema");
    await ensureNoError(db().from("work_employee_onboarding").select("id").limit(1), "check Work OS onboarding schema");
    return { ready: true, migration: "supabase/migrations/0011_work_os_employee_onboarding.sql" };
  } catch (err) {
    if (isWorkOsMigrationRequired(err)) {
      return {
        ready: false,
        migration: "supabase/migrations/0011_work_os_employee_onboarding.sql",
        error: (err as Error).message,
      };
    }
    throw err;
  }
}

export async function listRoleProfiles(userId: string) {
  await ensureWorkOsDefaults(userId);
  return ensureNoError(
    db().from("work_role_profiles").select("*").eq("user_id", userId).order("name"),
    "load role profiles",
  );
}
