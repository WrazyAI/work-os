import { NextResponse } from "next/server";
import { generateBlueprintTasks, getWorkOsOrganizationOwnerId } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ blueprintId: string }> }) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const { blueprintId } = await params;
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const result = await generateBlueprintTasks(ownerId, blueprintId, await req.json());
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return jsonError(err, 502);
  }
}
