import { NextResponse } from "next/server";
import { listPersonTaskPage, listPersonTasks, type TaskListOrder } from "@/lib/work-os";
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
  return value ? validateWorkOsDate(value, "date") : null;
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
    const requestedLimit = Math.min(100, Math.max(1, integer(params.get("limit"), 50, 100)));
    const limit = Math.min(50, requestedLimit);
    const offset = integer(params.get("offset"), 0, 100000);
    const requestedDate = date(params.get("date"));
    const sortDate = params.has("sortDate") ? validateWorkOsDate(params.get("sortDate"), "sortDate") : null;
    const fromDate = date(params.get("from"));
    const toDate = date(params.get("to"));
    const search = params.get("search")?.trim() ?? "";
    if (search.length > 200) return NextResponse.json({ error: "search must be 200 characters or fewer" }, { status: 400 });
    const view = params.get("view") ?? "today";
    if (view === "options") return NextResponse.json(await getWorkOsTaskCreationOptions(auth.access));
    if (view === "pending" || view === "overdue") return NextResponse.json(await listWorkOsEmployeeTaskSelection(auth.access, view, requestedLimit));
    const sortKey = params.get("sort");
    const sortDirection = params.get("direction");
    const order = sortKey && ["title", "due", "status"].includes(sortKey) && (sortDirection === "asc" || sortDirection === "desc")
      ? `${sortKey}_${sortDirection}` as TaskListOrder
      : view === "open" ? "status_asc" : "due_desc";
    if (view === "open") {
      let excludeTaskIds: string[] = [];
      if (params.get("excludeToday") === "true") {
        const todayWorkspace = await resolveDailyWorkspace(auth.access, requestedDate, { limit: 50, includeAllTaskIds: true });
        excludeTaskIds = todayWorkspace.taskIds ?? [];
      }
      const page = await listPersonTaskPage(ownerId, auth.access.organizationId, auth.access.personId as string, {
        completed: "false",
        order,
        sortDate: sortDate ?? requestedDate,
        search,
        fromDate,
        toDate,
        cursor: params.get("cursor"),
        limit,
        excludeTaskIds,
        overdueFirst: true,
      });
      return NextResponse.json({ ...page, view, cursor: { next: page.nextCursor } });
    }
    if (view === "today" || view === "day") {
      const workspace = await resolveDailyWorkspace(auth.access, requestedDate, {
        cursor: params.get("cursor"),
        limit,
        search,
        fromDate,
        toDate,
        order,
      });
      return NextResponse.json({
        tasks: workspace.tasks,
        view,
        date: workspace.date,
        workspace,
        totalCount: workspace.totalCount,
        counts: workspace.counts,
        cursor: workspace.cursor,
        nextOffset: null,
      });
    }
    if (view === "history") {
      const page = await listPersonTaskPage(ownerId, auth.access.organizationId, auth.access.personId as string, {
        completed: params.get("completed"),
        projectId: params.get("projectId"),
        fromDate,
        toDate,
        search,
        cursor: params.get("cursor"),
        limit,
        order,
        sortDate: sortDate ?? requestedDate,
      });
      return NextResponse.json({ ...page, view, date: requestedDate, cursor: { next: page.nextCursor }, nextOffset: null });
    }
    const tasks = (await listPersonTasks(ownerId, auth.access.personId as string, {
      completed: params.get("completed"),
      projectId: params.get("projectId"),
      todayOnly: false,
      todayDate: requestedDate,
      fromDate,
      toDate,
      offset,
      limit,
      includeCompleted: params.get("includeCompleted") === "true",
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
