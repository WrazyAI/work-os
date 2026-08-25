import { NextResponse } from "next/server";
import { addTaskProgress } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ taskId: string }> }) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const { taskId } = await params;
    const body = await req.json();
    body.idempotency_key = req.headers.get("idempotency-key") || body.idempotency_key;
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const evidence = await addTaskProgress(ownerId, taskId, body);
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
