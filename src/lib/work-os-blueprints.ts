import { addDaysIso, todayIso as today } from "@/lib/work-os-dates";
import { dateOnly, db, ensureNoError, nonEmptyString, type Json } from "@/lib/work-os-internal";
import { ensureWorkOsDefaults } from "@/lib/work-os-bootstrap";
import { createLocalWorkOsTask } from "@/lib/work-os-local-tasks";
import type { WorkOsAccess } from "@/lib/work-os-api";

export async function listBlueprints(userId: string) {
  await ensureWorkOsDefaults(userId);
  return ensureNoError(
    db().from("work_blueprints").select("*").eq("user_id", userId).order("name"),
    "load blueprints",
  );
}

export async function generateBlueprintTasks(access: WorkOsAccess, blueprintId: string, body: Json) {
  const userId = access.organizationOwnerId;
  if (!userId) throw new Error("Work OS organization has no owner");
  const blueprint = await ensureNoError(
    db().from("work_blueprints").select("*").eq("user_id", userId).eq("id", blueprintId).maybeSingle(),
    "load blueprint",
  ) as Json | null;
  if (!blueprint) throw new Error("Blueprint not found");
  const clientName = nonEmptyString(body.client_name) ?? "New client";
  const start = dateOnly(nonEmptyString(body.start_date)) ?? today();
  const assigneePersonIds = Array.isArray(body.assignee_person_ids)
    ? body.assignee_person_ids.filter((value): value is string => typeof value === "string" && !!value.trim())
    : access.personId ? [access.personId] : [];
  const phases = Array.isArray(blueprint.phases) ? blueprint.phases as Array<{ name?: string; tasks?: Array<{ name?: string; offsetDays?: number; evidence?: string[] }> }> : [];
  const created = [];
  for (const phase of phases) {
    for (const item of phase.tasks ?? []) {
      const due = addDaysIso(start, Number(item.offsetDays ?? 0));
      const result = await createLocalWorkOsTask(access, {
        title: `${clientName}: ${item.name ?? "Onboarding task"}`,
        description: `Blueprint: ${blueprint.name}\nPhase: ${phase.name ?? "General"}\nRequired evidence: ${(item.evidence ?? []).join(", ") || "task update"}`,
        dueDate: due,
        assigneePersonIds,
        raw: { source: "work_os_blueprint", blueprintId },
      });
      created.push(result);
    }
  }
  return { created: created.length, tasks: created };
}
