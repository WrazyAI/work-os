import { NextResponse } from "next/server";
import { getWorkOsOrganizationOwnerId, listBlueprints } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    return NextResponse.json({ blueprints: await listBlueprints(ownerId) });
  } catch (err) {
    return jsonError(err);
  }
}
