import { NextResponse } from "next/server";
import { getWorkOsOrganizationOwnerId, syncWorktivityEvidence } from "@/lib/work-os";
import { jsonError, requireWorkOsAdmin } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const result = await syncWorktivityEvidence(ownerId, body?.date, body?.person_id);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(err, 502);
  }
}
