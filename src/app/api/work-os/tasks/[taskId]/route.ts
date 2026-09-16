import { NextResponse } from "next/server";
import { updateTask } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"));
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
