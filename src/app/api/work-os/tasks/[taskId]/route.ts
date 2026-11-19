import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPool } from "@/lib/db/pool";
import { getTaskByLocalOrProviderId } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { employeeTaskToday } from "@/lib/work-os-employee-tasks";
import { withTaskCapabilities } from "@/lib/work-os-task-capabilities";
import { loadTaskCompletionEvidence } from "@/lib/work-os-task-evidence";
import { removeWorkOsAdminTask, updateWorkOsAdminTask } from "@/lib/work-os-task-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Assignees arrive in two historical shapes: a person-id array from the
 * provider mirror and embedded person rows from the local record. Read both
 * without counting a person twice. */
function assigneeIds(task: Record<string, unknown>): string[] {
  const direct = Array.isArray(task.assignee_person_ids) ? task.assignee_person_ids : [];
  const embedded = Array.isArray(task.assignees)
    ? task.assignees.map((person) => (person && typeof person === "object"
      ? (person as Record<string, unknown>).id ?? (person as Record<string, unknown>).person_id
      : null))
    : [];
  return [...new Set([...direct, ...embedded]
    .map((value) => typeof value === "string" ? value.trim() : "")
    .filter(Boolean))];
}

export async function GET(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const { taskId } = await params;
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const task = await getTaskByLocalOrProviderId(ownerId, taskId);
    if (!task || task.organization_id !== auth.access.organizationId) return NextResponse.json({ error: "task not found" }, { status: 404 });
    // work_tasks names its title column `title`; there is no `name` column. The
    // drawer renders the task's project name, so resolve the project embed for
    // the returned task as well (the row's own `project_id` stays untouched).
    const project = task.project_id
      ? await createAdminClient().from("work_projects").select("id,name")
        .eq("organization_id", auth.access.organizationId).eq("id", task.project_id as string).maybeSingle()
      : { data: null, error: null };
    if (project.error) throw new Error(`load task project: ${project.error.message}`);
    const providerTaskId = String(task.provider_task_id ?? task.id);
    // Capabilities need each child's own assignment and workflow provenance,
    // not the parent's permissions or the old title-only projection.
    const subtasksQuery = createAdminClient().from("work_tasks")
      .select("*,project:work_projects(id,name)")
      .eq("organization_id", auth.access.organizationId)
      .not("status", "in", "(archived,deleted)")
      .order("completed", { ascending: true })
      .limit(100);
    const assignees = assigneeIds(task as Record<string, unknown>);
    const assigneeGhl = assignees.length
      ? getPool().query<{ person_id: string; display_name: string; performed: number | string; last_at: string | null }>(`
          SELECT e.person_id, p.display_name,
            count(*)::int AS performed,
            max(e.occurred_at) AS last_at
          FROM work_evidence_events e
          JOIN work_people p ON p.id = e.person_id
          WHERE e.organization_id = $1
            AND e.provider = 'ghl'
            AND e.correction_status <> 'retracted'
            AND e.person_id = ANY($2::uuid[])
            AND e.metadata->'ghl'->>'relation' = 'performed'
            AND e.metadata->'ghl'->>'occurredAt' IS NOT NULL
            AND coalesce(e.metadata->'ghl'->>'snapshot', 'false') <> 'true'
            AND e.occurred_at >= now() - interval '7 days'
          GROUP BY e.person_id, p.display_name
          ORDER BY performed DESC, p.display_name
        `, [auth.access.organizationId, assignees])
      : Promise.resolve({ rows: [] as Array<{ person_id: string; display_name: string; performed: number | string; last_at: string | null }> });
    const [subtasksResult, completionEvidence, assigneeGhlResult] = await Promise.all([
      task.provider === "local"
        ? subtasksQuery.eq("parent_task_id", task.id as string)
        : subtasksQuery.eq("parent_provider_task_id", providerTaskId),
      loadTaskCompletionEvidence(auth.access.organizationId, [String(task.id)]),
      assigneeGhl,
    ]);
    const { data: subtasks, error } = subtasksResult;
    if (error) throw new Error(`load task subtasks: ${error.message}`);
    const actor = { role: auth.access.role, personId: auth.access.personId };
    // The row and its children read the actor's workday, not UTC.
    const today = await employeeTaskToday(auth.access);
    return NextResponse.json({
      task: withTaskCapabilities([{
        ...task,
        project: project.data ?? null,
        completion_evidence: completionEvidence.map((row) => row.evidence),
      }], actor, today)[0],
      subtasks: withTaskCapabilities(subtasks ?? [], actor, today),
      assignee_ghl: assigneeGhlResult.rows.map((row) => ({
        personId: String(row.person_id),
        displayName: String(row.display_name),
        performed: Number(row.performed ?? 0) || 0,
        lastAt: row.last_at ? new Date(row.last_at).toISOString() : null,
      })),
    });
  } catch (err) {
    return jsonError(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const { taskId } = await params;
    return NextResponse.json(await updateWorkOsAdminTask(auth.access, taskId, await req.json()));
  } catch (err) {
    return jsonError(err, 502);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const { taskId } = await params;
    const mode = new URL(req.url).searchParams.get("mode") ?? "archive";
    if (mode !== "archive" && mode !== "delete") return NextResponse.json({ error: "mode must be archive or delete" }, { status: 400 });
    return NextResponse.json(await removeWorkOsAdminTask(auth.access, taskId, mode));
  } catch (err) {
    return jsonError(err);
  }
}
