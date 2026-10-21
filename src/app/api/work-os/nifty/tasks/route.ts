import { NextResponse } from "next/server";
import { listNiftyTasks, withNiftyOrganization } from "@/lib/integrations/nifty";
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
  const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
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

export async function POST() {
  // Work OS owns task creation now. Nifty stays readable as a backup, never a
  // write target: a provider task would be invisible to the local record.
  return NextResponse.json({ error: "Nifty task creation is retired; create the task in Work OS." }, { status: 410 });
}
