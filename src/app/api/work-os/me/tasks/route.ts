import { NextResponse } from "next/server";
import { listPersonOpenTasks, listPersonTasks, type TaskListOrder } from "@/lib/work-os";
import { createWorkOsEmployeeTask, getWorkOsTaskCreationOptions, listWorkOsEmployeeTaskSelection } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";
import { validateWorkOsDate } from "@/lib/work-os-schedule-validation";

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

/** Serve employee task views, validating workspace sort parameters before querying mirrored tasks. */
export async function GET(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const params = new URL(req.url).searchParams;
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const limit = Math.min(100, Math.max(1, integer(params.get("limit"), 50, 100)));
    const offset = integer(params.get("offset"), 0, 100000);
    const requestedDate = date(params.get("date"));
    const sortDate = params.has("sortDate") ? validateWorkOsDate(params.get("sortDate"), "sortDate") : null;
    const view = params.get("view") ?? "today";
    if (view === "options") return NextResponse.json(await getWorkOsTaskCreationOptions(auth.access));
    if (view === "pending" || view === "overdue") return NextResponse.json(await listWorkOsEmployeeTaskSelection(auth.access, view, limit));
    // The exact open backlog: small enough to return whole, so both the
    // dashboard carry-over tabs and the Tasks Unfinished view can be complete
    // instead of counted from the paginated history window.
    if (view === "open") return NextResponse.json(await listPersonOpenTasks(ownerId, auth.access.personId as string));
    if (view === "today" || view === "day" || params.has("cursor")) {
      const workspace = await resolveDailyWorkspace(auth.access, requestedDate, {
        cursor: params.get("cursor"),
        limit,
      });
      return NextResponse.json({
        tasks: workspace.tasks,
        view,
        date: workspace.date,
        workspace,
        cursor: workspace.cursor,
        nextOffset: null,
      });
    }
    const sortKey = params.get("sort");
    const sortDirection = params.get("direction");
    const order = sortKey && ["title", "due", "status"].includes(sortKey) && (sortDirection === "asc" || sortDirection === "desc")
      ? `${sortKey}_${sortDirection}` as TaskListOrder
      : undefined;
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
      order,
      sortDate,
    })) ?? [];
    return NextResponse.json({ tasks, view, date: requestedDate, offset, nextOffset: tasks.length === limit ? offset + tasks.length : null, cursor: { next: null } });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await access(req);
    if (auth.response) return auth.response;
    const task = await createWorkOsEmployeeTask(auth.access, await req.json());
    return NextResponse.json({ task, providerStatus: "work_os_confirmed", mirrorStatus: "local" }, { status: 201 });
  } catch (error) {
    return jsonError(error, 502);
  }
}
