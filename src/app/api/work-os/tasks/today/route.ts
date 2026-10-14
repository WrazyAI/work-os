import { NextResponse } from "next/server";
import { listPersonTasks, listTasks } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const personId = new URL(req.url).searchParams.get("personId");
    const tasks = personId
      ? await listPersonTasks(ownerId, personId, { todayOnly: true })
      : await listTasks(ownerId, { todayOnly: true });
    return NextResponse.json({ tasks });
  } catch (err) {
    return jsonError(err);
  }
}
