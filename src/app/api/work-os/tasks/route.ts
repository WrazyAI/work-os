import { NextResponse } from "next/server";
import { countAdminTaskRecord } from "@/lib/work-os-admin-otto-reads";
import { getTaskByLocalOrProviderId, listPersonTasks, listTasks } from "@/lib/work-os";
import { createLocalWorkOsTask, defaultWorkOsTaskProjectId } from "@/lib/work-os-local-tasks";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { withTaskCapabilities } from "@/lib/work-os-task-capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const sp = new URL(req.url).searchParams;
    const options = {
      completed: sp.get("completed"),
      projectId: sp.get("projectId"),
      todayOnly: sp.get("today") === "true",
      todayDate: sp.get("date"),
      fromDate: sp.get("from"),
      toDate: sp.get("to"),
      offset: Math.max(0, Number(sp.get("offset") ?? 0) || 0),
      limit: Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50) || 50)),
      includeCompleted: sp.get("includeCompleted") === "true",
      includeLedgerHistory: sp.get("today") !== "true" && !sp.get("from") && !sp.get("to"),
      order: "created_desc" as const,
      organizationId: auth.access.organizationId,
    };
    const personId = sp.get("personId")?.trim() || null;
    const tasks = (personId
      ? await listPersonTasks(ownerId, personId, options)
      : await listTasks(ownerId, options)) ?? [];
    // Exact workload counts share the row attribution and effective-due rule:
    // a task with no recorded due date is due one day after it was created, and
    // the same stated day drives the visible overdue status.
    const requestedDate = sp.get("date");
    const today = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
      ? requestedDate
      : new Date().toISOString().slice(0, 10);
    const summary = await countAdminTaskRecord(auth.access, { ownerId, personId, today });
    return NextResponse.json({
      tasks: withTaskCapabilities(tasks, { role: auth.access.role, personId: auth.access.personId }, new Date().toISOString().slice(0, 10)),
      nextOffset: tasks.length === Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50) || 50)) ? Math.max(0, Number(sp.get("offset") ?? 0) || 0) + tasks.length : null,
      summary,
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const body = await req.json() as Record<string, any>;
    const parent = typeof body.parent_task_id === "string" && body.parent_task_id.trim()
      ? await getTaskByLocalOrProviderId(ownerId, body.parent_task_id.trim())
      : null;
    const requestedProjectId = typeof body.project_id === "string" && body.project_id.trim() ? body.project_id.trim() : null;
    const task = await createLocalWorkOsTask(auth.access, {
      title: String(body.name ?? ""),
      description: typeof body.description === "string" ? body.description : null,
      dueDate: typeof body.due_date === "string" ? body.due_date : null,
      startDate: typeof body.start_date === "string" ? body.start_date : null,
      priority: typeof body.priority === "string" ? body.priority : null,
      labels: Array.isArray(body.labels) ? body.labels.filter((value: unknown): value is string => typeof value === "string") : [],
      storyPoints: typeof body.story_points === "number" ? body.story_points : null,
      expectedOutcome: typeof body.expected_outcome === "string" ? body.expected_outcome : null,
      definitionOfDone: typeof body.definition_of_done === "string" ? body.definition_of_done : null,
      projectId: requestedProjectId ?? (parent ? null : await defaultWorkOsTaskProjectId(auth.access.organizationId)),
      assigneePersonIds: Array.isArray(body.assignee_person_ids) ? body.assignee_person_ids.filter((value: unknown): value is string => typeof value === "string") : [],
      parent,
      raw: { source: "work_os_admin" },
    });
    return NextResponse.json({ task: withTaskCapabilities([task], { role: auth.access.role, personId: auth.access.personId }, new Date().toISOString().slice(0, 10))[0], providerStatus: "work_os_confirmed", mirrorStatus: "local" }, { status: 201 });
  } catch (err) {
    return jsonError(err, 502);
  }
}
