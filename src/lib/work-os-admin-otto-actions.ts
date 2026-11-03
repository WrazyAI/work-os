import type { AdminOttoOperation, AdminOttoPendingAction } from "@/modules/work-os/admin-otto/contracts";
import type { AdminAgentAccess } from "@/lib/work-admin-agent-auth";
import { previewAdminAction, defaultAdminAgentActionServices } from "@/lib/work-admin-agent-actions";
import { createAdminPreview } from "@/lib/work-admin-action-previews";
import { listAdminAgentTasks } from "@/lib/work-admin-agent-tasks";
import { resolveAdminOttoPeople } from "@/lib/work-os-admin-otto-reads";
import { ADMIN_AGENT_TOKEN_SCOPES } from "@/lib/work-agent-tokens";
import { WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";

export type AdminOttoOperationResult = {
  reply: string;
  pendingAction?: AdminOttoPendingAction;
};

function ottoAgent(access: WorkOsAccess): AdminAgentAccess {
  return {
    access,
    tokenId: "otto",
    tokenName: "Admin Otto",
    tokenPrefix: "otto",
    expiresAt: null,
    scopes: [...ADMIN_AGENT_TOKEN_SCOPES],
    reviewerPersonId: access.personId ?? null,
  };
}

async function resolveTask(access: WorkOsAccess, query: string) {
  const page = await listAdminAgentTasks(access, {
    personIds: null,
    query,
    completed: null,
    overdue: null,
    status: "active",
    projectId: null,
    dueFrom: null,
    dueTo: null,
    updatedSince: null,
    limit: 6,
    cursor: null,
  });
  const exact = page.tasks.filter((task) => String(task.title ?? "").trim().toLowerCase() === query.trim().toLowerCase());
  if (exact.length === 1) return { task: exact[0] };
  if (page.tasks.length === 1) return { task: page.tasks[0] };
  if (!page.tasks.length) {
    return { reply: `No active task matches “${query}”. Give me a more specific task title.` };
  }
  const titles = page.tasks.slice(0, 5).map((task) => `“${String(task.title ?? "Untitled")}”`).join(", ");
  return { reply: `More than one task matches “${query}”: ${titles}. Give me a more specific title.` };
}

export async function executeAdminOttoOperation(
  access: WorkOsAccess,
  operation: AdminOttoOperation,
): Promise<AdminOttoOperationResult> {
  if (access.featureFlags.admin_agent_api !== true) {
    return { reply: "Task actions are not enabled for this workspace yet." };
  }
  const agent = ottoAgent(access);
  const services = defaultAdminAgentActionServices;

  let action: Parameters<typeof previewAdminAction>[1];
  let payload: Record<string, unknown>;

  if (operation.action === "create_task") {
    if (!operation.title) throw new WorkOsValidationError("A task title is required");
    let people: string[] = [];
    if (operation.person_names.length) {
      const resolved = await resolveAdminOttoPeople(access, { kind: "names", names: operation.person_names });
      if (resolved.kind !== "resolved") {
        const names = resolved.kind === "ambiguous"
          ? resolved.choices.map((person) => person.displayName).join(", ")
          : resolved.name;
        return { reply: `I couldn't uniquely resolve ${names}. Name the person more specifically.` };
      }
      people = resolved.people.map((person) => person.id);
    }
    action = "task.create";
    payload = {
      name: operation.title,
      ...(people.length ? { assignee_person_ids: people } : {}),
      ...(operation.due_date ? { due_date: operation.due_date } : {}),
    };
  } else {
    const query = operation.task_query?.trim();
    if (!query) throw new WorkOsValidationError("A task title is required");
    const resolvedTask = await resolveTask(access, query);
    if (!resolvedTask.task) return { reply: resolvedTask.reply ?? "I couldn't find that task." };
    const taskId = String(resolvedTask.task.id);

    if (operation.action === "complete_task" || operation.action === "reopen_task") {
      action = operation.action === "complete_task" ? "task.complete" : "task.reopen";
      payload = { task_id: taskId };
    } else {
      const resolvedPeople = await resolveAdminOttoPeople(access, { kind: "names", names: operation.person_names });
      if (resolvedPeople.kind !== "resolved") {
        const names = resolvedPeople.kind === "ambiguous"
          ? resolvedPeople.choices.map((person) => person.displayName).join(", ")
          : resolvedPeople.name;
        return { reply: `I couldn't uniquely resolve ${names}. Name the person more specifically.` };
      }
      action = "task.assign";
      payload = {
        task_id: taskId,
        mode: operation.action === "add_contributor"
          ? "add"
          : operation.action === "remove_contributor"
            ? "remove"
            : "replace",
        person_ids: resolvedPeople.people.map((person) => person.id),
      };
    }
  }

  const preview = await previewAdminAction(agent.access, action, payload, services, {
    reviewerPersonId: agent.reviewerPersonId,
  });
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const created = await createAdminPreview({
    organizationId: access.organizationId,
    userId: access.ctx.user.id,
    tokenId: null,
    source: "otto",
    action,
    targetType: preview.targetType,
    targetId: preview.targetId,
    request: preview.request,
    preview: {
      action,
      summary: preview.summary,
      changes: preview.changes,
      warnings: preview.warnings,
      state: preview.state,
      expiresAt: expiresAt.toISOString(),
    },
    state: preview.state,
    expiresAt,
  });
  return {
    reply: preview.summary,
    pendingAction: {
      previewId: created.id,
      action,
      summary: preview.summary,
      changes: preview.changes,
      warnings: preview.warnings,
      expiresAt: created.expiresAt,
    },
  };
}
