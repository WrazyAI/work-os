import { createAdminClient } from "@/lib/supabase/admin";
import {
  assignNiftyTask,
  archiveNiftyTask,
  completeNiftyTask,
  createNiftyTask,
  deleteNiftyTask,
  getNiftyTask,
  listNiftyMembers,
  listNiftyProjects,
  listNiftyTasks,
  normalizeNiftyTaskPayload,
  updateNiftyTask,
  updateNiftyTaskField,
  withNiftyOrganization,
  type NiftyTaskSummary,
} from "@/lib/integrations/nifty";
import { attachTaskAssigneeIdentities } from "@/lib/work-os-task-assignees";
import { employeeName, wtPost, worktivityConfigured, type WtEmployee, type WtPaged } from "@/lib/worktivity";
import { fetchAppsSummary } from "@/lib/worktivityAudit";
import { employeeTrackingConsent } from "@/lib/work-os-onboarding";
import { localDateForTimezone } from "@/modules/work-os/companion";

type Json = Record<string, unknown>;
type Db = ReturnType<typeof createAdminClient>;

export class WorkOsMigrationRequiredError extends Error {
  constructor(message = "Work OS database tables are not installed. Run npm run db:apply:work-os, then retry.") {
    super(message);
    this.name = "WorkOsMigrationRequiredError";
  }
}

export function isWorkOsMigrationRequired(err: unknown) {
  return err instanceof WorkOsMigrationRequiredError;
}

function missingWorkOsSchema(message: string) {
  return (
    /relation "work_[^"]+" does not exist/i.test(message) ||
    /Could not find the table 'public\.work_/i.test(message) ||
    /schema cache/i.test(message) && /work_/i.test(message)
  );
}

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

function db() {
  return createAdminClient();
}

export async function getWorkOsOrganizationOwnerId(organizationId: string) {
  const organization = await ensureNoError(
    db().from("work_organizations").select("legacy_owner_id,created_by").eq("id", organizationId).single(),
    "load Work OS organization owner",
  ) as Json;
  const ownerId = organization.legacy_owner_id || organization.created_by;
  if (!ownerId) throw new Error("Work OS organization has no owner");
  return ownerId as string;
}

async function niftyForOwner<T>(userId: string, operation: () => Promise<T>) {
  const { data, error } = await db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (error) throw new Error(`load Nifty organization scope: ${error.message}`);
  if (!data) throw new Error("Work OS organization is required before accessing Nifty");
  return withNiftyOrganization(data.id, operation);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(base: string, days: number) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateOnly(value?: string | null) {
  if (!value) return null;
  const m = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function section(description: string | null | undefined, heading: string) {
  if (!description) return null;
  const match = description.match(new RegExp(`(?:^|\\n)## ${heading}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i"));
  return match?.[1]?.trim() || null;
}

function structuredDescription(description: string | null, expectedOutcome: unknown, definitionOfDone: unknown) {
  const base = (description || "")
    .replace(/(?:^|\n)## Expected outcome\s*\n[\s\S]*?(?=\n## |$)/i, "")
    .replace(/(?:^|\n)## Definition of done\s*\n[\s\S]*?(?=\n## |$)/i, "")
    .trim();
  const outcome = nonEmptyString(expectedOutcome);
  const done = nonEmptyString(definitionOfDone);
  return [base, outcome ? `## Expected outcome\n${outcome}` : "", done ? `## Definition of done\n${done}` : ""].filter(Boolean).join("\n\n") || null;
}

async function applyMappedFields(userId: string, providerTaskId: string, values: Json) {
  const supabase = db();
  const { data: organization, error: organizationError } = await supabase.from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (organizationError) throw new Error(`load Nifty field organization: ${organizationError.message}`);
  if (!organization) return;
  const keys = Object.keys(values);
  if (!keys.length) return;
  const { data: mappings, error } = await supabase.from("work_provider_field_mappings").select("semantic_field,provider_field_id,config")
    .eq("organization_id", organization.id).eq("provider", "nifty").in("semantic_field", keys);
  if (error) throw new Error(`load Nifty field mappings: ${error.message}`);
  for (const mapping of mappings ?? []) {
    const config = (mapping.config ?? {}) as Json;
    const valueMap = (config.valueMap ?? config.value_map ?? {}) as Json;
    const raw = values[mapping.semantic_field];
    const mapped = typeof raw === "string" && raw in valueMap ? valueMap[raw] : raw;
    await niftyForOwner(userId, () => updateNiftyTaskField(providerTaskId, mapping.provider_field_id, mapped));
  }
}

async function mappedSemanticFields(userId: string, fields: string[]) {
  const { data: organization, error: organizationError } = await db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (organizationError) throw new Error(`load Nifty field organization: ${organizationError.message}`);
  if (!organization || !fields.length) return new Set<string>();
  const { data, error } = await db().from("work_provider_field_mappings").select("semantic_field")
    .eq("organization_id", organization.id).eq("provider", "nifty").in("semantic_field", fields);
  if (error) throw new Error(`load Nifty field mappings: ${error.message}`);
  return new Set((data ?? []).map((mapping) => mapping.semantic_field as string));
}

async function mirrorExtendedTaskFields(taskId: string, values: Json) {
  const patch: Json = { updated_at: new Date().toISOString() };
  for (const key of ["priority", "estimated_effort", "estimated_effort_minutes", "effort_unit", "expected_outcome", "definition_of_done", "dependency_task_ids", "blocked", "blocked_reason"]) {
    if (key in values) patch[key] = values[key];
  }
  if (Object.keys(patch).length === 1) return null;
  return selectFirst(db().from("work_tasks").update(patch).eq("id", taskId).select("*"), "mirror extended task fields");
}

async function mirrorMappedTaskFields(userId: string, taskId: string, rawTask: Json) {
  const { data: organization, error: organizationError } = await db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle();
  if (organizationError) throw new Error(`load mapped task organization: ${organizationError.message}`);
  if (!organization) return;
  const { data: mappings, error: mappingError } = await db().from("work_provider_field_mappings")
    .select("semantic_field,provider_field_id").eq("organization_id", organization.id).eq("provider", "nifty");
  if (mappingError) throw new Error(`load mapped Nifty task fields: ${mappingError.message}`);
  if (!mappings?.length) return;
  const candidates = [rawTask.custom_fields, rawTask.customFields, rawTask.fields, rawTask.task_fields]
    .find(Array.isArray) as Json[] | undefined;
  if (!candidates) return;
  const values = new Map(candidates.map((field) => [
    String(field.id ?? field.field_id ?? field.fieldId ?? ""),
    field.value ?? field.selected_value ?? field.selectedValue ?? null,
  ]));
  const patch: Json = {};
  for (const mapping of mappings) {
    if (!values.has(mapping.provider_field_id)) continue;
    const rawValue = values.get(mapping.provider_field_id);
    const value = rawValue && typeof rawValue === "object"
      ? (rawValue as Json).name ?? (rawValue as Json).label ?? (rawValue as Json).value ?? (rawValue as Json).id ?? null
      : rawValue;
    if (mapping.semantic_field === "estimated_effort_minutes") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) patch.estimated_effort_minutes = numeric;
    } else {
      patch[mapping.semantic_field] = value == null ? null : String(value);
    }
    if (mapping.semantic_field === "blocked_reason") patch.blocked = typeof value === "string" && !!value.trim();
  }
  if (Object.keys(patch).length) {
    const { error } = await db().from("work_tasks").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", taskId);
    if (error) throw new Error(`mirror mapped Nifty task fields: ${error.message}`);
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRateLimitRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!/429|rate limit/i.test(message)) break;
      await wait(1_200 * (attempt + 1));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

async function ensureNoError<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>, label: string): Promise<T> {
  const { data, error } = await query;
  if (error) {
    if (missingWorkOsSchema(error.message)) throw new WorkOsMigrationRequiredError();
    throw new Error(`${label}: ${error.message}`);
  }
  return data;
}

async function selectFirst<T = Json>(query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string): Promise<T> {
  const rows = await ensureNoError(query, label);
  if (!rows?.[0]) throw new Error(`${label}: no row returned`);
  return rows[0];
}

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

async function mapAssigneePeople(supabase: Db, userId: string, assigneeIds: string[]) {
  if (!assigneeIds.length) return [];
  const people = await ensureNoError(
    supabase.from("work_people").select("id,nifty_member_id").eq("user_id", userId).in("nifty_member_id", assigneeIds),
    "map task assignees",
  );
  return (people ?? []).map((person: { id: string }) => person.id);
}

export async function upsertNiftyProject(userId: string, project: { id: string; name: string; archived?: boolean; raw: Json }) {
  return selectFirst(
    db().from("work_projects").upsert({
      user_id: userId,
      provider: "nifty",
      provider_project_id: project.id,
      name: project.name,
      archived: project.archived ?? null,
      raw: project.raw,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,provider_project_id" }).select("*"),
    "upsert Nifty project",
  );
}

export async function upsertNiftyMember(userId: string, member: { id: string; name: string; email?: string | null; raw: Json }) {
  const supabase = db();
  const email = member.email?.trim() || null;
  if (email) {
    const existing = await ensureNoError(
      supabase
        .from("work_people")
        .select("*")
        .eq("user_id", userId)
        .ilike("email", email)
        .maybeSingle(),
      "find existing Nifty member by email",
    );
    if (existing) {
      return selectFirst(
        supabase.from("work_people").update({
          display_name: existing.display_name || member.name,
          email,
          nifty_member_id: member.id,
          raw: { ...(existing.raw ?? {}), nifty: member.raw },
          active: true,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select("*"),
        "merge Nifty member by email",
      );
    }
  }

  return selectFirst(
    supabase.from("work_people").upsert({
      user_id: userId,
      display_name: member.name,
      email,
      nifty_member_id: member.id,
      raw: { nifty: member.raw },
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,nifty_member_id" }).select("*"),
    "upsert Nifty member",
  );
}

export async function upsertWorktivityEmployee(userId: string, employee: WtEmployee) {
  const supabase = db();
  const email = employee.Invitation?.Email?.trim() || null;
  if (email) {
    const existing = await ensureNoError(
      supabase
        .from("work_people")
        .select("*")
        .eq("user_id", userId)
        .ilike("email", email)
        .maybeSingle(),
      "find existing Worktivity employee by email",
    );
    if (existing) {
      return selectFirst(
        supabase.from("work_people").update({
          display_name: existing.display_name || employeeName(employee),
          email,
          worktivity_employee_id: employee.ID,
          worktivity_user_id: employee.UserId,
          raw: { ...(existing.raw ?? {}), worktivity: employee },
          active: existing.active === true || (employee.IsActive && !employee.Blocked),
          updated_at: new Date().toISOString(),
        }).eq("id", existing.id).select("*"),
        "merge Worktivity employee by email",
      );
    }
  }

  return selectFirst(
    supabase.from("work_people").upsert({
      user_id: userId,
      display_name: employeeName(employee),
      email,
      worktivity_employee_id: employee.ID,
      worktivity_user_id: employee.UserId,
      raw: { worktivity: employee },
      active: employee.IsActive && !employee.Blocked,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,worktivity_employee_id" }).select("*"),
    "upsert Worktivity employee",
  );
}

export async function upsertNiftyTask(userId: string, task: NiftyTaskSummary) {
  const supabase = db();
  const previous = await ensureNoError(
    supabase.from("work_tasks").select("id,completed").eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.id).maybeSingle(),
    "load previous Nifty task state",
  );
  let projectId: string | null = null;
  if (task.projectId) {
    const project = await ensureNoError(
      supabase.from("work_projects").select("id").eq("user_id", userId).eq("provider", "nifty").eq("provider_project_id", task.projectId).maybeSingle(),
      "load task project",
    );
    projectId = project?.id ?? null;
  }

  const assigneePersonIds = await mapAssigneePeople(supabase, userId, task.assignees);
  const saved = await selectFirst(
    supabase.from("work_tasks").upsert({
      user_id: userId,
      provider: "nifty",
      provider_task_id: task.id,
      provider_project_id: task.projectId ?? null,
      project_id: projectId,
      title: task.name,
      description: task.description ?? null,
      task_group_id: task.taskGroupId ?? null,
      milestone_id: task.milestoneId ?? null,
      priority: task.priority ?? null,
      labels: task.labels,
      story_points: task.storyPoints,
      dependency_provider_ids: task.dependencyIds,
      parent_provider_task_id: task.parentTaskId ?? null,
      expected_outcome: section(task.description, "Expected outcome"),
      definition_of_done: section(task.description, "Definition of done"),
      status: task.status ?? (task.completed ? "completed" : "open"),
      completed: task.completed === true,
      assignee_provider_ids: task.assignees,
      assignee_person_ids: assigneePersonIds,
      due_date: dateOnly(task.dueDate),
      start_date: dateOnly(task.startDate),
      ...(task.completedAt ? { completed_at: task.completedAt } : {}),
      provider_created_at: task.createdAt,
      provider_updated_at: task.updatedAt,
      raw: task.raw,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,provider,provider_task_id" }).select("*"),
    "upsert Nifty task",
  );
  await mirrorMappedTaskFields(userId, (saved as Json).id as string, task.raw);
  await mirrorNiftyTaskDayEvents(supabase, saved as Json, task, assigneePersonIds, previous?.completed === true);
  if (task.parentTaskId) {
    const parent = await ensureNoError(
      supabase.from("work_tasks").select("id").eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.parentTaskId).maybeSingle(),
      "load Nifty parent task",
    );
    if (parent) await ensureNoError(
      supabase.from("work_tasks").update({ parent_task_id: parent.id, updated_at: new Date().toISOString() }).eq("id", (saved as Json).id as string).select("id"),
      "mirror Nifty parent task",
    );
  }
  return saved;
}

function niftyIdentity(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of ["id", "_id", "user_id", "member_id"]) if (typeof row[key] === "string" && row[key]) return row[key] as string;
  return null;
}

export function canonicalNiftyEventTimestamp(value: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Nifty event timestamp must be a valid instant");
  return instant.toISOString();
}

export function niftyTaskEventIdempotencyKey(eventType: "created" | "completed" | "reopened", providerTaskId: string, timestamp: string) {
  return `nifty:${eventType}:${providerTaskId}:${canonicalNiftyEventTimestamp(timestamp)}`;
}

async function mirrorNiftyTaskDayEvents(supabase: Db, saved: Json, task: NiftyTaskSummary, assigneePersonIds: string[], wasCompleted: boolean) {
  const organizationId = typeof saved.organization_id === "string" ? saved.organization_id : null;
  if (!organizationId) return;
  let personId = assigneePersonIds[0] ?? null;
  if (!personId) {
    const raw = task.raw as Record<string, unknown>;
    const identities = [niftyIdentity(raw.created_by), niftyIdentity(raw.creator), ...(Array.isArray(raw.subscribers) ? raw.subscribers.map(niftyIdentity) : [])].filter((value): value is string => !!value);
    if (identities.length) {
      const people = await ensureNoError(supabase.from("work_people").select("id").eq("organization_id", organizationId).in("nifty_member_id", [...new Set(identities)]).limit(1), "resolve Nifty task event person");
      personId = people?.[0]?.id ?? null;
    }
  }
  if (!personId) {
    const existingEvent = await ensureNoError(supabase.from("work_task_day_events").select("person_id").eq("organization_id", organizationId).eq("task_id", saved.id).order("observed_at", { ascending: true }).limit(1).maybeSingle(), "resolve existing Nifty task event person");
    personId = existingEvent?.person_id ?? null;
  }
  if (!personId) return;
  const onboarding = await ensureNoError(supabase.from("work_employee_onboarding").select("timezone").eq("organization_id", organizationId).eq("person_id", personId).maybeSingle(), "load Nifty task event timezone");
  const timezone = onboarding?.timezone || "UTC";
  const snapshot = { title: task.name, completed: task.completed, status: task.status, dueDate: dateOnly(task.dueDate) };
  const events: Json[] = [];
  if (task.createdAt) events.push({ organization_id: organizationId, person_id: personId, task_id: saved.id, provider: "nifty", provider_task_id: task.id, local_date: localDateForTimezone(new Date(task.createdAt), timezone), event_type: "creation_observed", provenance: "provider_observed", exact_at: task.createdAt, observed_at: task.createdAt, task_snapshot: snapshot, metadata: { sourceField: "provider_created_at" }, idempotency_key: niftyTaskEventIdempotencyKey("created", task.id, task.createdAt) });
  if (task.completed && task.completedAt) events.push({ organization_id: organizationId, person_id: personId, task_id: saved.id, provider: "nifty", provider_task_id: task.id, local_date: localDateForTimezone(new Date(task.completedAt), timezone), event_type: "completed", provenance: "nifty_exact", exact_at: task.completedAt, observed_at: task.completedAt, task_snapshot: { ...snapshot, completed: true }, metadata: { sourceField: "raw.completed_on" }, idempotency_key: niftyTaskEventIdempotencyKey("completed", task.id, task.completedAt) });
  if (wasCompleted && !task.completed && task.updatedAt) events.push({ organization_id: organizationId, person_id: personId, task_id: saved.id, provider: "nifty", provider_task_id: task.id, local_date: localDateForTimezone(new Date(task.updatedAt), timezone), event_type: "reopened", provenance: "provider_observed", exact_at: null, observed_at: task.updatedAt, task_snapshot: { ...snapshot, completed: false }, metadata: { sourceField: "provider_updated_at" }, idempotency_key: niftyTaskEventIdempotencyKey("reopened", task.id, task.updatedAt) });
  if (!events.length) return;
  const { error } = await supabase.from("work_task_day_events").upsert(events, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true });
  if (error) throw new Error(`mirror Nifty task day events: ${error.message}`);
}

export async function syncNifty(userId: string) {
  await ensureWorkOsDefaults(userId);
  const pageSize = 100;
  const projects = [] as Awaited<ReturnType<typeof listNiftyProjects>>["projects"];
  const tasks = [] as Awaited<ReturnType<typeof listNiftyTasks>>["tasks"];
  const seenProjects = new Set<string>();
  const seenTasks = new Set<string>();
  const { members } = await niftyForOwner(userId, () => listNiftyMembers());
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const page = await niftyForOwner(userId, () => listNiftyProjects({ limit: String(pageSize), offset: String(offset), archived: "false" }));
    const fresh = page.projects.filter((project) => !seenProjects.has(project.id));
    fresh.forEach((project) => seenProjects.add(project.id));
    projects.push(...fresh);
    if (page.projects.length < pageSize || !fresh.length) break;
  }

  for (const project of projects) await upsertNiftyProject(userId, project);
  for (const member of members) await upsertNiftyMember(userId, member);

  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const page = await niftyForOwner(userId, () => listNiftyTasks({ limit: String(pageSize), offset: String(offset), include_subtasks: "true", include_archived: "false" }));
    const fresh = page.tasks.filter((task) => !seenTasks.has(task.id));
    fresh.forEach((task) => seenTasks.add(task.id));
    tasks.push(...fresh);
    if (page.hasMore === false || (page.hasMore !== true && page.tasks.length < pageSize) || !fresh.length) break;
  }
  for (const task of tasks) await upsertNiftyTask(userId, task);
  for (const task of tasks.filter((item) => item.parentTaskId)) {
    const parent = await db().from("work_tasks").select("id").eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.parentTaskId as string).maybeSingle();
    if (parent.error) throw new Error(`map Nifty parent task: ${parent.error.message}`);
    if (parent.data) {
      const { error } = await db().from("work_tasks").update({ parent_task_id: parent.data.id, parent_provider_task_id: task.parentTaskId, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("provider_task_id", task.id);
      if (error) throw new Error(`mirror Nifty parent relationship: ${error.message}`);
    }
  }
  for (const task of tasks.filter((item) => item.dependencyIds.length)) {
    const { data: dependencies, error: dependencyError } = await db().from("work_tasks").select("id")
      .eq("user_id", userId).eq("provider", "nifty").in("provider_task_id", task.dependencyIds);
    if (dependencyError) throw new Error(`map Nifty task dependencies: ${dependencyError.message}`);
    const { error: taskError } = await db().from("work_tasks").update({
      dependency_task_ids: (dependencies ?? []).map((dependency) => dependency.id),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider", "nifty").eq("provider_task_id", task.id);
    if (taskError) throw new Error(`mirror Nifty task dependencies: ${taskError.message}`);
  }

  const syncedAt = new Date().toISOString();
  const { error: syncStateError } = await db().from("work_organizations").update({ nifty_synced_at: syncedAt, nifty_sync_error: null, updated_at: syncedAt })
    .eq("legacy_owner_id", userId);
  if (syncStateError) throw new Error(`record Nifty sync state: ${syncStateError.message}`);
  return { projects: projects.length, members: members.length, tasks: tasks.length, syncedAt };
}

async function forEachConcurrent<T>(items: T[], concurrency: number, run: (item: T) => Promise<unknown>) {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await run(item);
    }
  }));
}

/** Refresh only the Nifty slice that can affect one employee's workspace. */
export async function syncNiftyPersonTasks(userId: string, personId: string) {
  const person = await ensureNoError(
    db().from("work_people").select("nifty_member_id").eq("user_id", userId).eq("id", personId).maybeSingle(),
    "load employee Nifty identity",
  );
  const niftyMemberId = person?.nifty_member_id as string | null | undefined;
  if (!niftyMemberId) throw new Error("Employee Nifty mapping is required for provider refresh");
  const currentRows = await listPersonTasks(userId, personId, { limit: 1000, includeCompleted: true, includeLedgerHistory: true });
  const currentProviderIds = new Set(currentRows.map((task) => String(task.provider_task_id ?? "")).filter(Boolean));
  const tasks = [] as Awaited<ReturnType<typeof listNiftyTasks>>["tasks"];
  const seen = new Set<string>();
  const pageSize = 100;
  for (let offset = 0; offset < 10_000; offset += pageSize) {
    const page = await niftyForOwner(userId, () => listNiftyTasks({ limit: String(pageSize), offset: String(offset), include_subtasks: "true", include_archived: "false" }));
    const fresh = page.tasks.filter((task) => !seen.has(task.id));
    fresh.forEach((task) => seen.add(task.id));
    tasks.push(...fresh);
    if (page.hasMore === false || (page.hasMore !== true && page.tasks.length < pageSize) || !fresh.length) break;
  }
  const relevant = tasks.filter((task) => {
    if (currentProviderIds.has(task.id) || task.assignees.includes(niftyMemberId)) return true;
    const raw = task.raw && typeof task.raw === "object" ? task.raw as Record<string, unknown> : {};
    const creatorIds = [niftyIdentity(raw.created_by), niftyIdentity(raw.creator)];
    const subscriberIds = Array.isArray(raw.subscribers) ? raw.subscribers.map(niftyIdentity) : [];
    return [...creatorIds, ...subscriberIds].includes(niftyMemberId);
  });
  await forEachConcurrent(relevant, 8, (task) => upsertNiftyTask(userId, task));
  return { scanned: tasks.length, tasks: relevant.length, syncedAt: new Date().toISOString() };
}

/** Refresh one provider task before an employee reads or changes it. Nifty is
 * authoritative for assignment and task state; the local row is only a mirror. */
export async function syncNiftyTask(userId: string, providerTaskId: string) {
  const payload = await niftyForOwner(userId, () => getNiftyTask(providerTaskId));
  const task = normalizeNiftyTaskPayload(payload);
  if (!task || task.id === "unknown") throw new Error("Nifty task not found");
  return upsertNiftyTask(userId, task);
}

export async function syncWorktivityRoster(userId: string) {
  if (!worktivityConfigured()) return { employees: 0, skipped: true };
  const data = await wtPost<WtPaged<WtEmployee>>("/Employee/List", { page: 1, pageSize: 200 });
  const employees = data.Items ?? [];
  for (const employee of employees) await upsertWorktivityEmployee(userId, employee);
  return { employees: employees.length, skipped: false };
}

export async function syncWorktivityEvidence(userId: string, date = today(), personId?: string) {
  if (!worktivityConfigured()) return { evidence: 0, skipped: true };
  const supabase = db();
  let peopleQuery = supabase
    .from("work_people")
    .select("id, organization_id, display_name, worktivity_employee_id")
    .eq("user_id", userId)
    .not("worktivity_employee_id", "is", null);
  if (personId) peopleQuery = peopleQuery.eq("id", personId);
  const people = await ensureNoError(peopleQuery, "load Worktivity mapped people");
  let count = 0;
  let skippedWithoutConsent = 0;
  for (const person of people ?? []) {
    const personRow = person as { id: string; organization_id: string | null; display_name: string };
    if (!personRow.organization_id) throw new Error("Work OS person has no organization mapping");
    const consent = await employeeTrackingConsent(personRow.organization_id, personRow.id);
    if (!consent.tracking) {
      skippedWithoutConsent += 1;
      continue;
    }
    const employeeId = (person as { worktivity_employee_id: string }).worktivity_employee_id;
    await wait(250);
    const apps = await withRateLimitRetry(
      () => fetchAppsSummary({ employeeId, start: date, end: date }),
      "sync Worktivity evidence",
    );
    const totalMinutes = apps.reduce((sum, app) => sum + app.minutes, 0);
    const categories = new Map<string, number>();
    for (const app of apps) categories.set(app.category || "Other", (categories.get(app.category || "Other") ?? 0) + app.minutes);
    const event = await selectFirst(
      supabase.from("work_evidence_events").upsert({
        organization_id: personRow.organization_id,
        provider: "worktivity",
        external_event_id: `activity:${employeeId}:${date}`,
        person_id: personRow.id,
        evidence_class: "activity_observation",
        title: `Worktivity activity: ${personRow.display_name}`,
        summary: `${Math.round(totalMinutes)} tracked minutes across ${apps.length} apps/sites.`,
        attribution_method: "merged_worktivity_person",
        attribution_confidence: 1,
        occurred_at: `${date}T12:00:00Z`,
        metadata: { totalMinutes, categories: [...categories.entries()] },
        raw: { apps },
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,provider,external_event_id" }).select("*"),
      "upsert Worktivity activity event",
    );
    await ensureNoError(
      supabase.from("work_evidence").upsert({
        user_id: userId,
        organization_id: personRow.organization_id,
        person_id: personRow.id,
        evidence_event_id: event.id,
        evidence_date: date,
        source: "worktivity",
        title: `Worktivity activity: ${(person as { display_name: string }).display_name}`,
        summary: `${Math.round(totalMinutes)} tracked minutes across ${apps.length} apps/sites.`,
        metrics: {
          totalMinutes,
          topApps: apps.slice(0, 10),
          categories: [...categories.entries()].map(([category, minutes]) => ({ category, minutes })),
        },
        raw: { apps },
        updated_at: new Date().toISOString(),
      }, { onConflict: "evidence_event_id" }),
      "insert Worktivity evidence",
    );
    count += 1;
  }
  return { evidence: count, skipped: false, skippedWithoutConsent };
}

export async function listPeople(userId: string) {
  await ensureWorkOsDefaults(userId);
  return ensureNoError(
    db().from("work_people").select("*, role_profile:work_role_profiles(*)").eq("user_id", userId).order("display_name"),
    "load people",
  );
}

export async function updatePerson(userId: string, personId: string, patch: Json) {
  if (typeof patch.role_profile_id === "string") {
    const profile = await ensureNoError(
      db().from("work_role_profiles").select("id").eq("user_id", userId).eq("id", patch.role_profile_id).maybeSingle(),
      "validate person role profile",
    );
    if (!profile) throw new Error("role profile must belong to the organization");
  }
  const allowed: Json = {};
  for (const key of ["display_name", "email", "role_profile_id", "nifty_member_id", "worktivity_employee_id", "active"]) {
    if (key in patch) allowed[key] = patch[key];
  }
  allowed.updated_at = new Date().toISOString();
  return selectFirst(
    db().from("work_people").update(allowed).eq("user_id", userId).eq("id", personId).select("*"),
    "update person",
  );
}

export async function listProjects(userId: string) {
  return ensureNoError(
    db().from("work_projects").select("*").eq("user_id", userId).order("name"),
    "load projects",
  );
}

export interface TaskListOptions {
  completed?: string | null;
  personId?: string | null;
  projectId?: string | null;
  providerProjectId?: string | null;
  todayOnly?: boolean;
  todayDate?: string | null;
  fromDate?: string | null;
  toDate?: string | null;
  offset?: number;
  limit?: number;
  includeCompleted?: boolean;
  includeLedgerHistory?: boolean;
}

const DEFAULT_NIFTY_LEDGER_PROJECT_ID = "czFZk9928z";

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function isNiftyTaskAttributableToMember(task: Record<string, any>, niftyMemberId: string | null | undefined) {
  if (!niftyMemberId) return false;
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Record<string, unknown> : {};
  return stringValues(task.assignee_provider_ids).includes(niftyMemberId)
    || raw.created_by === niftyMemberId
    || stringValues(raw.subscribers).includes(niftyMemberId);
}

export async function listTasks(userId: string, opts: TaskListOptions = {}) {
  let query = db()
    .from("work_tasks")
    .select("*, project:work_projects(*), evidence:work_evidence(id, source, title, evidence_date)")
    .eq("user_id", userId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 100) - 1);
  query = query.not("status", "in", "(archived,deleted)");
  if (opts.completed === "true") query = query.eq("completed", true);
  if (opts.completed === "false") query = query.eq("completed", false);
  if (opts.projectId) query = query.eq("project_id", opts.projectId);
  if (opts.providerProjectId) query = query.eq("provider_project_id", opts.providerProjectId);
  if (opts.personId) query = query.contains("assignee_person_ids", [opts.personId]);
  if (opts.todayOnly) {
    const d = opts.todayDate ?? today();
    const previous = new Date(`${d}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const prior = previous.toISOString().slice(0, 10);
    query = query.or(`due_date.lte.${d},provider_created_at.gte.${prior}T00:00:00Z`);
    if (opts.includeCompleted !== true) query = query.eq("completed", false);
  }
  if (opts.fromDate) query = query.gte("provider_created_at", `${opts.fromDate}T00:00:00Z`);
  if (opts.toDate) query = query.lt("provider_created_at", `${opts.toDate}T00:00:00Z`);
  return ensureNoError(query, "load tasks");
}

export async function hydrateTaskAssignees(userId: string, tasks: Record<string, any>[]) {
  const personIds = [...new Set(tasks.flatMap((task) => stringValues(task.assignee_person_ids)))];
  if (!personIds.length) return attachTaskAssigneeIdentities(tasks, []);
  const people = await ensureNoError(
    db().from("work_people").select("id,display_name,email").eq("user_id", userId).in("id", personIds),
    "load task assignee identities",
  );
  return attachTaskAssigneeIdentities(tasks, people ?? []);
}

/**
 * Loads work attributable to a person. Nifty's API permits creator-owned ledger
 * tasks without assignees, so strict assignee filtering alone hides the agent's
 * daily status updates. Include only ledger rows attributable through Nifty's
 * creator/subscriber metadata; unrelated unassigned project work stays hidden.
 */
export async function listPersonTasks(userId: string, personId: string, opts: Omit<TaskListOptions, "personId"> = {}): Promise<Record<string, any>[]> {
  const offset = opts.offset ?? 0;
  const limit = opts.limit ?? 100;
  const candidateLimit = Math.min(1000, offset + limit);
  const baseOptions = { ...opts, offset: 0, limit: candidateLimit };
  const personResult = await db().from("work_people").select("nifty_member_id").eq("user_id", userId).eq("id", personId).maybeSingle();
  if (personResult.error) throw new Error(`load task person mapping: ${personResult.error.message}`);
  const niftyMemberId = personResult.data?.nifty_member_id as string | null | undefined;
  const ledgerProjectId = process.env.WORK_OS_NIFTY_LEDGER_PROJECT_ID?.trim() || DEFAULT_NIFTY_LEDGER_PROJECT_ID;
  const ledgerOptions: TaskListOptions = { ...baseOptions, providerProjectId: ledgerProjectId };
  if (opts.todayOnly || (!opts.includeLedgerHistory && !opts.fromDate && !opts.toDate)) {
    const date = opts.todayDate ?? today();
    const previous = new Date(`${date}T12:00:00Z`);
    previous.setUTCDate(previous.getUTCDate() - 1);
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    ledgerOptions.todayOnly = false;
    ledgerOptions.fromDate = previous.toISOString().slice(0, 10);
    ledgerOptions.toDate = next.toISOString().slice(0, 10);
    if (opts.includeCompleted !== true && !opts.completed) ledgerOptions.completed = "false";
  }
  const [assigned, ledger] = await Promise.all([
    listTasks(userId, { ...baseOptions, personId }),
    niftyMemberId ? listTasks(userId, ledgerOptions) : Promise.resolve([]),
  ]);
  const rows = new Map<string, Record<string, any>>();
  for (const task of assigned ?? []) rows.set(String(task.id), task);
  for (const task of ledger ?? []) {
    if (isNiftyTaskAttributableToMember(task, niftyMemberId)) rows.set(String(task.id), task);
  }
  const selected = [...rows.values()]
    .sort((left, right) => {
      const leftDue = String(left.due_date ?? "9999-12-31");
      const rightDue = String(right.due_date ?? "9999-12-31");
      return leftDue.localeCompare(rightDue) || String(right.provider_created_at ?? right.created_at ?? "").localeCompare(String(left.provider_created_at ?? left.created_at ?? ""));
    })
    .slice(offset, offset + limit);
  const parentProviderIds = selected
    .filter((task) => !task.parent_provider_task_id && task.provider_task_id)
    .map((task) => String(task.provider_task_id));
  const childrenResult = parentProviderIds.length
    ? await db().from("work_tasks").select("parent_provider_task_id,completed").eq("user_id", userId).not("status", "in", "(archived,deleted)").in("parent_provider_task_id", parentProviderIds)
    : { data: [], error: null };
  if (childrenResult.error) throw new Error(`load task subtask progress: ${childrenResult.error.message}`);
  const progress = new Map<string, { total: number; completed: number }>();
  for (const child of childrenResult.data ?? []) {
    const parentId = String(child.parent_provider_task_id);
    const current = progress.get(parentId) ?? { total: 0, completed: 0 };
    current.total += 1;
    if (child.completed === true) current.completed += 1;
    progress.set(parentId, current);
  }
  const withProgress = selected.map((task): Record<string, any> => {
    const counts = progress.get(String(task.provider_task_id)) ?? { total: 0, completed: 0 };
    return { ...task, subtask_total: counts.total, subtask_completed: counts.completed };
  });
  return hydrateTaskAssignees(userId, withProgress);
}

export async function createTask(userId: string, body: Json) {
  const name = nonEmptyString(body.name);
  const taskGroupId = nonEmptyString(body.task_group_id);
  if (!name) throw new Error("name is required");
  if (!taskGroupId) throw new Error("task_group_id is required for Nifty tasks");
  const payload: Json = { name, task_group_id: taskGroupId };
  for (const key of ["task_id", "project_id", "milestone_id", "due_date", "start_date", "assignees", "labels", "story_points", "priority", "dependencies"]) if (key in body) payload[key] = body[key];
  const structuredMappings = await mappedSemanticFields(userId, ["expected_outcome", "definition_of_done"]);
  payload.description = structuredDescription(
    nonEmptyString(body.description),
    structuredMappings.has("expected_outcome") ? null : body.expected_outcome,
    structuredMappings.has("definition_of_done") ? null : body.definition_of_done,
  );
  const result = await niftyForOwner(userId, () => createNiftyTask(payload));
  const initial = normalizeNiftyTaskPayload(result);
  if (initial) {
    const requestedAssignees = stringValues(body.assignees);
    if (requestedAssignees.length) {
      await niftyForOwner(userId, () => assignNiftyTask(initial.id, requestedAssignees));
    }
    await applyMappedFields(userId, initial.id, body);
    let normalized = initial;
    for (let attempt = 0; attempt < (requestedAssignees.length ? 6 : 1); attempt += 1) {
      normalized = normalizeNiftyTaskPayload(await niftyForOwner(userId, () => getNiftyTask(initial.id))) ?? normalized;
      if (requestedAssignees.every((assignee) => normalized.assignees.includes(assignee))) break;
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const missingAssignees = requestedAssignees.filter((assignee) => !normalized.assignees.includes(assignee));
    if (missingAssignees.length) throw new Error(`Nifty did not confirm ${missingAssignees.length} requested assignee${missingAssignees.length === 1 ? "" : "s"}`);
    const task = await upsertNiftyTask(userId, normalized) as Json;
    return await mirrorExtendedTaskFields(task.id as string, body) ?? task;
  }
  await syncNifty(userId);
  return { providerResult: result };
}

export async function updateTask(userId: string, taskId: string, patch: Json) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const providerTaskId = task.provider_task_id as string;
  const allowed: Json = {};
  for (const key of ["name", "description", "milestone_id", "due_date", "start_date", "task_group_id", "assignees", "labels", "story_points", "priority", "dependencies"]) {
    if (key in patch) allowed[key] = patch[key];
  }
  if ("expected_outcome" in patch || "definition_of_done" in patch) {
    const structuredMappings = await mappedSemanticFields(userId, ["expected_outcome", "definition_of_done"]);
    allowed.description = structuredDescription(
      nonEmptyString(patch.description) ?? nonEmptyString(task.description),
      structuredMappings.has("expected_outcome") ? null : patch.expected_outcome ?? task.expected_outcome,
      structuredMappings.has("definition_of_done") ? null : patch.definition_of_done ?? task.definition_of_done,
    );
  }
  const result = Object.keys(allowed).length
    ? await niftyForOwner(userId, () => updateNiftyTask(providerTaskId, allowed))
    : null;
  await applyMappedFields(userId, providerTaskId, patch);
  const normalized = normalizeNiftyTaskPayload(result) ?? normalizeNiftyTaskPayload(await niftyForOwner(userId, () => getNiftyTask(providerTaskId)));
  if (normalized) {
    const mirrored = await upsertNiftyTask(userId, normalized) as Json;
    return await mirrorExtendedTaskFields(mirrored.id as string, patch) ?? mirrored;
  }
  return task;
}

export async function completeTask(userId: string, taskId: string, completed = true) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const providerTaskId = task.provider_task_id as string;
  const result = await niftyForOwner(userId, () => completeNiftyTask(providerTaskId, completed));
  const normalized = normalizeNiftyTaskPayload(result) ?? normalizeNiftyTaskPayload(await niftyForOwner(userId, () => getNiftyTask(providerTaskId)));
  if (normalized) {
    const mirrored = await upsertNiftyTask(userId, normalized) as Json;
    if (!completed) {
      return selectFirst(
        db().from("work_tasks").update({ completed_at: null, updated_at: new Date().toISOString() })
          .eq("user_id", userId).eq("id", mirrored.id as string).select("*"),
        "clear reopened task completion timestamp",
      );
    }
    return mirrored;
  }
  return selectFirst(
    db().from("work_tasks").update({
      completed,
      status: completed ? "completed" : "open",
      completed_at: completed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("id", task.id).select("*"),
    "mark task complete",
  );
}

export async function archiveTask(userId: string, taskId: string) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const providerTaskId = task.provider_task_id as string;
  await niftyForOwner(userId, () => archiveNiftyTask(providerTaskId, true));
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Json : {};
  return selectFirst(
    db().from("work_tasks").update({
      status: "archived",
      raw: { ...raw, archived: true },
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider_task_id", providerTaskId).select("*"),
    "archive task mirror",
  );
}

export async function deleteTask(userId: string, taskId: string) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const providerTaskId = task.provider_task_id as string;
  await niftyForOwner(userId, () => deleteNiftyTask(providerTaskId));
  const raw = task.raw && typeof task.raw === "object" ? task.raw as Json : {};
  return selectFirst(
    db().from("work_tasks").update({
      status: "deleted",
      raw: { ...raw, deleted: true, deleted_at: new Date().toISOString() },
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider_task_id", providerTaskId).select("*"),
    "tombstone deleted task mirror",
  );
}

export async function moveTaskToParent(userId: string, taskId: string, parentTaskId: string) {
  const [task, parent] = await Promise.all([
    getTaskByLocalOrProviderId(userId, taskId),
    getTaskByLocalOrProviderId(userId, parentTaskId),
  ]);
  if (task.id === parent.id) throw new Error("A task cannot be its own parent");
  if (!task.parent_provider_task_id) throw new Error("Only subtasks can be moved to another task");
  if (parent.parent_provider_task_id) throw new Error("Subtasks can only be moved beneath a top-level task");
  if (task.organization_id !== parent.organization_id || task.provider_project_id !== parent.provider_project_id) {
    throw new Error("Subtasks can only be moved between tasks in the same Nifty project");
  }
  const providerTaskId = task.provider_task_id as string;
  const providerParentId = parent.provider_task_id as string;
  if (task.parent_provider_task_id === providerParentId) return task;
  await niftyForOwner(userId, () => updateNiftyTask(providerTaskId, { task_id: providerParentId }));
  let providerConfirmed = false;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const children = await niftyForOwner(userId, () => listNiftyTasks({ task_id: providerParentId, include_subtasks: "true", limit: "100", offset: "0" }));
    if (children.tasks.some((candidate) => candidate.id === providerTaskId && candidate.parentTaskId === providerParentId)) {
      providerConfirmed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!providerConfirmed) throw new Error("Nifty did not confirm the subtask move");
  return selectFirst(
    db().from("work_tasks").update({
      parent_task_id: parent.id,
      parent_provider_task_id: providerParentId,
      provider_project_id: parent.provider_project_id,
      project_id: parent.project_id,
      milestone_id: parent.milestone_id,
      task_group_id: parent.task_group_id,
      synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId).eq("provider_task_id", providerTaskId).select("*"),
    "move task beneath parent",
  );
}

export async function addTaskProgress(userId: string, taskId: string, body: Json) {
  const task = await getTaskByLocalOrProviderId(userId, taskId);
  const idempotencyKey = nonEmptyString(body.idempotency_key) ?? nonEmptyString(body.client_request_id);
  const personId = nonEmptyString(body.person_id);
  if (personId) {
    const person = await ensureNoError(
      db().from("work_people").select("id").eq("organization_id", task.organization_id).eq("id", personId).maybeSingle(),
      "validate task progress person",
    );
    if (!person) throw new Error("person must belong to the task organization");
  }
  if (idempotencyKey) {
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", task.organization_id).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "load idempotent task progress evidence",
    );
    if (existing) return existing;
  }
  const payload = {
    user_id: userId,
    organization_id: task.organization_id,
    task_id: task.id,
    person_id: personId,
    evidence_date: dateOnly(nonEmptyString(body.evidence_date)) ?? today(),
    source: body.source === "manual" ? "manual" : "agent",
    title: nonEmptyString(body.title) ?? `Progress: ${task.title}`,
    summary: nonEmptyString(body.summary) ?? "",
    url: nonEmptyString(body.url),
    metrics: typeof body.metrics === "object" && body.metrics ? body.metrics : {},
    idempotency_key: idempotencyKey,
    raw: { note: body, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) },
  };
  try {
    return await selectFirst(
      db().from("work_evidence").insert(payload).select("*"),
      "add task progress evidence",
    );
  } catch (error) {
    if (!idempotencyKey) throw error;
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", task.organization_id).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "reconcile idempotent task progress evidence",
    );
    if (existing) return existing;
    throw error;
  }
}

export async function getTaskByLocalOrProviderId(userId: string, taskId: string) {
  const localId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId);
  const row = await ensureNoError(
    db().from("work_tasks").select("*").eq("user_id", userId).eq(localId ? "id" : "provider_task_id", taskId).maybeSingle(),
    "load task",
  );
  if (!row) throw new Error("Task not found");
  return row as Json;
}

export async function listEvidence(userId: string, opts: { personId?: string | null; taskId?: string | null; date?: string | null } = {}) {
  let query = db()
    .from("work_evidence")
    .select("*, person:work_people(id, display_name), task:work_tasks(id, title), event:work_evidence_events(correction_status,evidence_class)")
    .eq("user_id", userId)
    .order("evidence_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.personId) query = query.eq("person_id", opts.personId);
  if (opts.taskId) query = query.eq("task_id", opts.taskId);
  if (opts.date) query = query.eq("evidence_date", opts.date);
  return ensureNoError(query, "load evidence");
}

async function resolveEvidenceScope(userId: string, body: Json, requestedOrganizationId?: string | null) {
  const suppliedOrganizationId = nonEmptyString(requestedOrganizationId) ?? nonEmptyString(body.organization_id);
  const taskId = nonEmptyString(body.task_id);
  const personId = nonEmptyString(body.person_id);
  let task: Json | null = null;
  let person: Json | null = null;

  if (taskId) {
    if (suppliedOrganizationId) {
      task = await ensureNoError(
        db().from("work_tasks").select("*").eq("organization_id", suppliedOrganizationId).eq("id", taskId).maybeSingle(),
        "load evidence task",
      ) as Json | null;
      if (!task) {
        task = await ensureNoError(
          db().from("work_tasks").select("*").eq("organization_id", suppliedOrganizationId).eq("provider_task_id", taskId).maybeSingle(),
          "load evidence task",
        ) as Json | null;
      }
      if (!task) throw new Error("task must belong to the evidence organization");
    } else {
      task = await getTaskByLocalOrProviderId(userId, taskId);
    }
  }

  let organizationId = suppliedOrganizationId ?? (task?.organization_id as string | null | undefined) ?? null;
  if (personId) {
    let personQuery = db().from("work_people").select("id,organization_id").eq("id", personId);
    if (organizationId) personQuery = personQuery.eq("organization_id", organizationId);
    else personQuery = personQuery.eq("user_id", userId);
    person = await ensureNoError(personQuery.maybeSingle(), "load evidence person") as Json | null;
    if (!person) throw new Error("person must belong to the evidence organization");
    if (organizationId && person.organization_id !== organizationId) throw new Error("person must belong to the evidence organization");
    organizationId = person.organization_id as string;
  }
  if (task && organizationId && task.organization_id !== organizationId) throw new Error("task must belong to the evidence organization");

  if (!organizationId) {
    const organization = await ensureNoError(
      db().from("work_organizations").select("id").eq("legacy_owner_id", userId).maybeSingle(),
      "load evidence organization",
    ) as Json | null;
    if (!organization) throw new Error("Work OS organization is required before creating evidence");
    organizationId = organization.id as string;
  }

  const organization = await ensureNoError(
    db().from("work_organizations").select("id,legacy_owner_id,created_by").eq("id", organizationId).single(),
    "load evidence organization",
  ) as Json;
  return {
    organizationId,
    ownerId: (organization.legacy_owner_id || organization.created_by || userId) as string,
    task,
    person,
  };
}

export async function createEvidence(userId: string, body: Json, requestedOrganizationId?: string | null) {
  const scope = await resolveEvidenceScope(userId, body, requestedOrganizationId);
  const idempotencyKey = nonEmptyString(body.idempotency_key) ?? nonEmptyString(body.client_request_id);
  if (idempotencyKey) {
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", scope.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "load idempotent evidence",
    );
    if (existing) return existing;
  }
  const payload = {
    user_id: scope.ownerId,
    organization_id: scope.organizationId,
    person_id: scope.person?.id ?? null,
    task_id: scope.task?.id ?? null,
    evidence_date: dateOnly(nonEmptyString(body.evidence_date)) ?? today(),
    source: nonEmptyString(body.source) ?? "manual",
    title: nonEmptyString(body.title) ?? "Manual evidence",
    summary: nonEmptyString(body.summary) ?? "",
    url: nonEmptyString(body.url),
    metrics: typeof body.metrics === "object" && body.metrics ? body.metrics : {},
    idempotency_key: idempotencyKey,
    raw: typeof body.raw === "object" && body.raw ? body.raw : {},
  };
  try {
    return await selectFirst(db().from("work_evidence").insert(payload).select("*"), "create evidence");
  } catch (error) {
    if (!idempotencyKey) throw error;
    const existing = await ensureNoError(
      db().from("work_evidence").select("*").eq("organization_id", scope.organizationId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      "reconcile idempotent evidence",
    );
    if (existing) return existing;
    throw error;
  }
}

export async function listBlueprints(userId: string) {
  await ensureWorkOsDefaults(userId);
  return ensureNoError(
    db().from("work_blueprints").select("*").eq("user_id", userId).order("name"),
    "load blueprints",
  );
}

export async function generateBlueprintTasks(userId: string, blueprintId: string, body: Json) {
  const blueprint = await ensureNoError(
    db().from("work_blueprints").select("*").eq("user_id", userId).eq("id", blueprintId).maybeSingle(),
    "load blueprint",
  ) as Json | null;
  if (!blueprint) throw new Error("Blueprint not found");
  const taskGroupId = nonEmptyString(body.task_group_id);
  if (!taskGroupId) throw new Error("task_group_id is required to create Nifty tasks");
  const clientName = nonEmptyString(body.client_name) ?? "New client";
  const start = dateOnly(nonEmptyString(body.start_date)) ?? today();
  const assignees = Array.isArray(body.assignees) ? body.assignees : undefined;
  const phases = Array.isArray(blueprint.phases) ? blueprint.phases as Array<{ name?: string; tasks?: Array<{ name?: string; offsetDays?: number; evidence?: string[] }> }> : [];
  const created = [];
  for (const phase of phases) {
    for (const item of phase.tasks ?? []) {
      const due = addDaysIso(start, Number(item.offsetDays ?? 0));
      const result = await createTask(userId, {
        name: `${clientName}: ${item.name ?? "Onboarding task"}`,
        description: `Blueprint: ${blueprint.name}\nPhase: ${phase.name ?? "General"}\nRequired evidence: ${(item.evidence ?? []).join(", ") || "task update"}`,
        task_group_id: taskGroupId,
        due_date: due,
        assignees,
      });
      created.push(result);
    }
  }
  return { created: created.length, tasks: created };
}

export async function createEodReport(userId: string, body: Json) {
  const reportDate = dateOnly(nonEmptyString(body.date)) ?? today();
  const personId = nonEmptyString(body.person_id);
  if (!personId) throw new Error("person_id is required");
  const supabase = db();
  const person = await ensureNoError(
    supabase.from("work_people").select("*, role_profile:work_role_profiles(*)").eq("user_id", userId).eq("id", personId).maybeSingle(),
    "load report person",
  ) as Json | null;
  if (!person) throw new Error("Person not found");

  const tasks = await listTasks(userId, { personId });
  const dayTasks = (tasks as Json[]).filter((task) => {
    const due = task.due_date as string | null;
    const completedAt = task.completed_at as string | null;
    return due === reportDate || (completedAt && completedAt.slice(0, 10) === reportDate) || (!task.completed && (!due || due <= reportDate));
  });
  const evidence = await listEvidence(userId, { personId, date: reportDate }) as Json[];
  const evidenceClass = (item: Json) => (item.metrics as Json | undefined)?.evidenceClass;
  const substantiveEvidence = evidence.filter((item) => item.source !== "worktivity" && evidenceClass(item) !== "activity_observation");
  const taskEvidenceIds = new Set(substantiveEvidence.map((e) => e.task_id).filter(Boolean));
  const missing = dayTasks.filter((task) => !task.completed && !taskEvidenceIds.has(task.id)).map((task) => ({
    taskId: task.id,
    title: task.title,
    reason: "Open or due task has no evidence for the report date.",
  }));
  const completed = dayTasks.filter((task) => task.completed).length;
  const open = dayTasks.length - completed;
  const activityEvidence = evidence.filter((item) => item.source === "worktivity" || evidenceClass(item) === "activity_observation");
  const outputEvidence = evidence.filter((item) =>
    evidenceClass(item) === "output_evidence" || (!!item.url && evidenceClass(item) !== "activity_observation"),
  );
  const workClaims = evidence.filter((item) => !activityEvidence.includes(item) && !outputEvidence.includes(item));
  const completedTasks = dayTasks.filter((task) => task.completed);
  const openTasks = dayTasks.filter((task) => !task.completed);
  const blockedTasks = dayTasks.filter((task) => task.blocked || task.blocked_reason);
  const title = `EOD Report: ${person.display_name} - ${reportDate}`;
  const role = person.role_profile as Json | null;
  const markdown = [
    `# ${title}`,
    "",
    `Role profile: ${role?.name ?? "Unmapped"}`,
    "",
    "## Summary",
    `- Tasks reviewed: ${dayTasks.length}`,
    `- Completed: ${completed}`,
    `- Still open / needs follow-up: ${open}`,
    `- Evidence records: ${evidence.length}`,
    "",
    "## Completed Work",
    ...(completedTasks.length ? completedTasks.map((task) => `- ${task.title}`) : ["- No completed Nifty tasks matched this report date."]),
    "",
    "## Progress On Open Tasks",
    ...(openTasks.length ? openTasks.map((task) => `- ${task.title}`) : ["- No open Nifty tasks matched this report date."]),
    ...(workClaims.length ? workClaims.map((item) => `- Employee update: ${item.title}: ${item.summary}`) : []),
    "",
    "## Output Evidence",
    ...(outputEvidence.length ? outputEvidence.map((item) => `- ${item.title}: ${item.summary}`) : ["- No output evidence recorded for this date."]),
    "",
    "## Activity Evidence",
    ...(activityEvidence.length ? activityEvidence.map((item) => `- ${item.title}: ${item.summary}`) : ["- No Worktivity activity evidence synced for this date."]),
    "",
    "## Blockers And Dependencies",
    ...(blockedTasks.length ? blockedTasks.map((task) => `- ${task.title}: ${task.blocked_reason || "Blocked"}`) : ["- No blockers recorded."]),
    "",
    "## Missing Or Ambiguous Evidence",
    ...(missing.length ? missing.map((item) => `- ${item.title}: ${item.reason}`) : ["- No missing evidence detected."]),
    "",
    "## Needs Manager Review",
    ...(missing.length || blockedTasks.length ? ["- Review the missing evidence and blockers listed above."] : ["- No specific review flags were generated."]),
  ].join("\n");

  return selectFirst(
    supabase.from("work_reports").insert({
      user_id: userId,
      person_id: personId,
      report_date: reportDate,
      kind: "eod",
      status: "draft",
      title,
      markdown,
      metrics: { taskCount: dayTasks.length, completed, open, evidenceCount: evidence.length },
      missing_evidence: missing,
      draft_idempotency_key: nonEmptyString(body.draft_idempotency_key),
    }).select("*"),
    "create EOD report",
  );
}

export async function listReports(userId: string) {
  return ensureNoError(
    db().from("work_reports").select("*, person:work_people(id, display_name)").eq("user_id", userId).order("created_at", { ascending: false }).limit(100),
    "load reports",
  );
}

export async function reviewReport(userId: string, reportId: string, reviewerId: string, body: Json) {
  const action = nonEmptyString(body.status);
  if (action !== "approved" && action !== "rejected") throw new Error("status must be approved or rejected");
  const patch: Json = {
    status: action,
    reviewed_by: reviewerId,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (typeof body.markdown === "string") patch.markdown = body.markdown;
  if (typeof body.manager_notes === "string") patch.manager_notes = body.manager_notes;
  const rows = await ensureNoError(
    db().from("work_reports").update(patch).eq("user_id", userId).eq("id", reportId).eq("status", "pending_review").select("*"),
    "review report",
  );
  if (!rows?.[0]) throw new Error("report is no longer pending review");
  return rows[0];
}
