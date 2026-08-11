import { NextResponse } from "next/server";
import { getWorkOsOrganizationOwnerId, listTasks } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const personId = new URL(req.url).searchParams.get("personId");
    const tasks = await listTasks(ownerId, { personId, todayOnly: true });
    return NextResponse.json({ tasks });
  } catch (err) {
    return jsonError(err);
  }
}
