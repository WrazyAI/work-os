import { NextResponse } from "next/server";
import { archiveWorkOsEmployeeTask, getWorkOsEmployeeTaskDetails, moveWorkOsEmployeeSubtask } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

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
    return NextResponse.json(await archiveWorkOsEmployeeTask(auth.access, taskId));
  } catch (error) {
    return jsonError(error, 502);
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ taskId: string }> }) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const { taskId } = await context.params;
    return NextResponse.json(await moveWorkOsEmployeeSubtask(auth.access, taskId, await req.json()));
  } catch (error) {
    return jsonError(error, 502);
  }
}
