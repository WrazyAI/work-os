import { db, ensureNoError, selectFirst, type Json } from "@/lib/work-os-internal";
import { ensureWorkOsDefaults } from "@/lib/work-os-bootstrap";

export { WorkOsMigrationRequiredError, isWorkOsMigrationRequired } from "@/lib/work-os-internal";
export {
  DEFAULT_ONBOARDING_BLUEPRINT,
  DEFAULT_ROLE_PROFILES,
  checkWorkOsSchemaReady,
  ensureWorkOsDefaults,
  listRoleProfiles,
} from "@/lib/work-os-bootstrap";
export {
  canonicalNiftyEventTimestamp,
  niftyTaskEventIdempotencyKey,
  syncNifty,
  upsertNiftyMember,
  upsertNiftyProject,
  upsertNiftyTask,
} from "@/lib/work-os-nifty";
export { syncNiftyPersonTasks, syncNiftyTask } from "@/lib/work-os-nifty-sync";
export { syncWorktivityEvidence, syncWorktivityRoster, upsertWorktivityEmployee } from "@/lib/work-os-worktivity";
export {
  addTaskProgress,
  adoptProviderTask,
  archiveTask,
  compareTaskRecency,
  completeTask,
  createTask,
  deleteTask,
  DEFAULT_NIFTY_LEDGER_PROJECT_ID,
  findNiftyTaskByMarker,
  getTaskByLocalOrProviderId,
  hydrateTaskAssignees,
  isNiftyTaskAttributableToMember,
  listPersonOpenTasks,
  listPersonTaskPage,
  listPersonTasks,
  isTaskAttributableToPerson,
  listTasks,
  moveTaskToParent,
  providerCreateFailureDefinite,
  taskRecencyStamp,
  updateTask,
} from "@/lib/work-os-tasks";
export type { TaskListOptions, TaskListOrder } from "@/lib/work-os-tasks";
export { createEvidence, listEvidence } from "@/lib/work-os-evidence-log";
export { generateBlueprintTasks, listBlueprints } from "@/lib/work-os-blueprints";
export { createEodReport, listReports, reviewReport } from "@/lib/work-os-reports";

export async function getWorkOsOrganizationOwnerId(organizationId: string) {
  const organization = await ensureNoError(
    db().from("work_organizations").select("legacy_owner_id,created_by").eq("id", organizationId).single(),
    "load Work OS organization owner",
  ) as Json;
  const ownerId = organization.legacy_owner_id || organization.created_by;
  if (!ownerId) throw new Error("Work OS organization has no owner");
  return ownerId as string;
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
