import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTaskByLocalOrProviderId, updateTask } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const { taskId } = await params;
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
    // work_tasks names its title column `title`; there is no `name` column. The
    // drawer renders the task's project name, so resolve the project embed for
    // the returned task as well (the row's own `project_id` stays untouched).
    const project = task.project_id
      ? await createAdminClient().from("work_projects").select("id,name")
        .eq("organization_id", auth.access.organizationId).eq("id", task.project_id as string).maybeSingle()
      : { data: null, error: null };
    if (project.error) throw new Error(`load task project: ${project.error.message}`);
    const providerTaskId = String(task.provider_task_id ?? task.id);
    const subtasksQuery = createAdminClient().from("work_tasks")
      .select("id,title,completed,due_date,status,priority,project:work_projects(id,name)")
      .eq("organization_id", auth.access.organizationId)
      .not("status", "in", "(archived,deleted)")
      .order("completed", { ascending: true })
      .limit(100);
    const { data: subtasks, error } = task.provider === "local"
      ? await subtasksQuery.eq("parent_task_id", task.id as string)
      : await subtasksQuery.eq("parent_provider_task_id", providerTaskId);
    if (error) throw new Error(`load task subtasks: ${error.message}`);
    return NextResponse.json({ task: { ...task, project: project.data ?? null }, subtasks: subtasks ?? [] });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const { taskId } = await params;
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const task = await updateTask(ownerId, taskId, await req.json());
    return NextResponse.json({ task });
  } catch (err) {
    return jsonError(err, 502);
  }
}
