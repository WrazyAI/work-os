import { NextResponse } from "next/server";
import { createTask, getWorkOsOrganizationOwnerId, listTasks } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const sp = new URL(req.url).searchParams;
    const tasks = await listTasks(ownerId, {
      completed: sp.get("completed"),
      personId: sp.get("personId"),
      projectId: sp.get("projectId"),
    });
    return NextResponse.json({ tasks });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const task = await createTask(ownerId, await req.json());
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    return jsonError(err, 502);
  }
}
