import { NextResponse } from "next/server";
import { getWorkOsOrganizationOwnerId, listPersonTasks } from "@/lib/work-os";
import { createWorkOsEmployeeTask, getWorkOsTaskCreationOptions } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function integer(value: string | null, fallback: number, max: number) {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, Math.trunc(parsed))) : fallback;
}

function date(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function access(req: Request) {
  return requireWorkOsAccess({
    organizationId: req.headers.get("x-work-os-organization-id"),
    authorization: req.headers.get("authorization"),
    requirePerson: true,
    feature: "employee_companion",
  });
}

export async function GET(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const params = new URL(req.url).searchParams;
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const limit = Math.min(100, Math.max(1, integer(params.get("limit"), 50, 100)));
    const offset = integer(params.get("offset"), 0, 100000);
    const requestedDate = date(params.get("date")) ?? new Date().toISOString().slice(0, 10);
    const view = params.get("view") ?? "today";
    if (view === "options") return NextResponse.json(await getWorkOsTaskCreationOptions(auth.access));
    const tasks = (await listPersonTasks(ownerId, auth.access.personId as string, {
      completed: params.get("completed"),
      projectId: params.get("projectId"),
      todayOnly: view === "today",
      todayDate: requestedDate,
      fromDate: date(params.get("from")),
      toDate: date(params.get("to")),
      offset,
      limit,
      includeCompleted: params.get("includeCompleted") === "true" || view === "history",
      includeLedgerHistory: view === "history" && !params.get("from") && !params.get("to"),
    })) ?? [];
    return NextResponse.json({ tasks, view, date: requestedDate, offset, nextOffset: tasks.length === limit ? offset + tasks.length : null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const task = await createWorkOsEmployeeTask(auth.access, await req.json());
    return NextResponse.json({ task, providerStatus: "nifty_confirmed", mirrorStatus: "mirrored" }, { status: 201 });
  } catch (error) {
    return jsonError(error, 502);
  }
}
