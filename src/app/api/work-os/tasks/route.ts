import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTaskByLocalOrProviderId, listPersonTasks, listTasks } from "@/lib/work-os";
import { createLocalWorkOsTask, defaultWorkOsTaskProjectId } from "@/lib/work-os-local-tasks";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";

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
    };
    const personId = sp.get("personId");
    const tasks = (personId
      ? await listPersonTasks(ownerId, personId, options)
      : await listTasks(ownerId, options)) ?? [];
    // Exact workload counts for the lead visual. Counting the capped row list
    // would under-report a large backlog, so these are head-only counts, and a
    // person filter scopes them the same way the list is scoped.
    const db = createAdminClient();
    const openTasks = () => {
      const base = db.from("work_tasks").select("id", { count: "exact", head: true })
        .eq("organization_id", auth.access.organizationId).eq("completed", false).not("status", "in", "(archived,deleted)");
      return personId ? base.contains("assignee_person_ids", [personId]) : base;
    };
    const completedEvents = db.from("work_task_day_events").select("id", { count: "exact", head: true })
      .eq("organization_id", auth.access.organizationId).eq("event_type", "completed")
      .gte("local_date", new Date(Date.now() - 6 * 24 * 60 * 60_000).toISOString().slice(0, 10));
    const [open, overdue, completedWeek] = await Promise.all([
      openTasks(),
      openTasks().not("due_date", "is", null).lt("due_date", new Date().toISOString().slice(0, 10)),
      personId ? completedEvents.eq("person_id", personId) : completedEvents,
    ]);
    for (const result of [open, overdue, completedWeek]) {
      if (result.error) throw new Error(`count tasks: ${result.error.message}`);
    }
    return NextResponse.json({
      tasks,
      nextOffset: tasks.length === Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50) || 50)) ? Math.max(0, Number(sp.get("offset") ?? 0) || 0) + tasks.length : null,
      summary: { open: open.count ?? 0, overdue: overdue.count ?? 0, completedWeek: completedWeek.count ?? 0 },
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
    return NextResponse.json({ task, providerStatus: "work_os_confirmed", mirrorStatus: "local" }, { status: 201 });
  } catch (err) {
    return jsonError(err, 502);
  }
}
