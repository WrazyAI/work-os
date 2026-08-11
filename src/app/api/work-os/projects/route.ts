import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";
import { getWorkOsOrganizationOwnerId, listProjects } from "@/lib/work-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    return NextResponse.json({ projects: await listProjects(ownerId) });
  } catch (err) {
    return jsonError(err);
  }
}
