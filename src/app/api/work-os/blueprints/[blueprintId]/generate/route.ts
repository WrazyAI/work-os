import { NextResponse } from "next/server";
import { generateBlueprintTasks } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin, workOsOrganizationOwnerId } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ blueprintId: string }> }) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"));
  if ("response" in auth) return auth.response;
  try {
    const { blueprintId } = await params;
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const result = await generateBlueprintTasks(ownerId, blueprintId, await req.json());
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return jsonError(err, 502);
  }
}
