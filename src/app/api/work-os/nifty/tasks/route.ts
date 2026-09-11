import { NextResponse } from "next/server";
import { listNiftyTasks, withNiftyOrganization } from "@/lib/integrations/nifty";
import { createTask, getWorkOsOrganizationOwnerId } from "@/lib/work-os";
import { requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "project_id",
  "task_group_id",
  "task_id",
  "member_id",
  "meeting_id",
  "milestone_id",
  "completed_by",
  "archived",
  "include_archived",
  "completed",
  "limit",
  "offset",
  "order",
  "from",
  "to",
  "archived_from",
  "archived_to",
  "completed_from",
  "completed_to",
  "include_subtasks",
  "sort",
  "project_ids",
]);

export async function GET(req: Request) {
  const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
  if (auth.response) return auth.response;

  const sp = new URL(req.url).searchParams;
  const params: Record<string, string | string[]> = {};
  for (const key of ALLOWED) {
    const value = sp.get(key);
    if (value) params[key] = value;
  }
  const assignees = sp.getAll("assignee_ids[]").filter(Boolean);
  if (assignees.length) params.assignee_ids = assignees;
  params.limit ??= "50";
  params.offset ??= "0";
  params.include_subtasks ??= "true";

  try {
    const data = await withNiftyOrganization(auth.access.organizationId, () => listNiftyTasks(params));
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
  if (auth.response) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "JSON body required" }, { status: 400 });
  }

  const record = body as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof record.task_group_id !== "string" || !record.task_group_id.trim()) {
    return NextResponse.json({ error: "task_group_id is required" }, { status: 400 });
  }

  try {
    // Do not expose an unmirrored provider write. The orchestration layer reads
    // Nifty back and upserts the local task record before confirming success.
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const result = await createTask(ownerId, record);
    return NextResponse.json({ task: result, providerStatus: "nifty_confirmed", mirrorStatus: "mirrored" }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
