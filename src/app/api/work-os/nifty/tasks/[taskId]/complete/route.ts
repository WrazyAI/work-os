import { NextResponse } from "next/server";
import { completeWorkOsTask } from "@/lib/work-os-companion";
import { requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id"), roles: ["admin"] });
  if (auth.response) return auth.response;

  const { taskId } = await params;
  const body = await req.json().catch(() => ({}));
  const completed = body?.completed !== false;

  try {
    const result = await completeWorkOsTask(auth.access, taskId, completed);
    return NextResponse.json({ task: result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
