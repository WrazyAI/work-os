import { addDaysIso, todayIso as today } from "@/lib/work-os-dates";
import { dateOnly, db, ensureNoError, nonEmptyString, type Json } from "@/lib/work-os-internal";
import { ensureWorkOsDefaults } from "@/lib/work-os-bootstrap";
import { createTask } from "@/lib/work-os-tasks";

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
