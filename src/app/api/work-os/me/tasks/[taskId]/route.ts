import { NextResponse } from "next/server";
import { archiveWorkOsEmployeeTask, deleteWorkOsEmployeeTask, getWorkOsEmployeeTaskDetails, moveWorkOsEmployeeSubtask, setWorkOsEmployeeTaskCompletion, updateWorkOsEmployeeTask } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { updateWorkOsEmployeeTaskStatus } from "@/lib/work-os-employee-tasks";
import { isWorkflowStatus } from "@/lib/work-os-task-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
}

export async function GET(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { taskId } = await context.params;
    return NextResponse.json(await getWorkOsEmployeeTaskDetails(auth.access, taskId));
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { taskId } = await context.params;
    const mode = new URL(req.url).searchParams.get("mode") ?? "archive";
    if (mode !== "archive" && mode !== "delete") return NextResponse.json({ error: "mode must be archive or delete" }, { status: 400 });
    return NextResponse.json(mode === "delete"
      ? await deleteWorkOsEmployeeTask(auth.access, taskId)
      : await archiveWorkOsEmployeeTask(auth.access, taskId));
  } catch (error) {
    // A missing or already-removed task is a 404, not an upstream failure.
    return jsonError(error);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { taskId } = await context.params;
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Task patch must be an object" }, { status: 400 });
    if ("workflow_status" in body) {
      if (!isWorkflowStatus(body.workflow_status) || Object.keys(body).some((key) => key !== "workflow_status")) {
        return NextResponse.json({ error: "Provide only workflow_status, set to pending or in_progress" }, { status: 400 });
      }
      return NextResponse.json(await updateWorkOsEmployeeTaskStatus(auth.access, taskId, body.workflow_status));
    }
    return NextResponse.json(
      typeof body.completed === "boolean"
        ? await setWorkOsEmployeeTaskCompletion(auth.access, taskId, body.completed)
        : body.parent_task_id
          ? await moveWorkOsEmployeeSubtask(auth.access, taskId, body)
          : await updateWorkOsEmployeeTask(auth.access, taskId, body),
    );
  } catch (error) {
    return jsonError(error);
  }
}
