import { NextResponse } from "next/server";
import { completeWorkOsTask } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const { taskId } = await params;
    const body = await req.json().catch(() => ({}));
    const task = await completeWorkOsTask(auth.access, taskId, body?.completed !== false);
    return NextResponse.json({ task });
  } catch (err) {
    return jsonError(err, 502);
  }
}
