import { NextResponse } from "next/server";
import { createTask, listPersonTasks, listTasks } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireWorkOsAdmin();
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
    return NextResponse.json({ tasks, nextOffset: tasks.length === Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50) || 50)) ? Math.max(0, Number(sp.get("offset") ?? 0) || 0) + tasks.length : null });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const ownerId = workOsOrganizationOwnerId(auth.access);
  const task = await createTask(ownerId, await req.json());
    return NextResponse.json({ task, providerStatus: "nifty_confirmed", mirrorStatus: "mirrored" }, { status: 201 });
  } catch (err) {
    return jsonError(err, 502);
  }
}
