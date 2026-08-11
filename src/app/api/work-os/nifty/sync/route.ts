import { NextResponse } from "next/server";
import { requireWorkOsAdmin, jsonError } from "@/lib/work-os-api";
import { getWorkOsOrganizationOwnerId, syncNifty, syncWorktivityRoster } from "@/lib/work-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const ownerId = await getWorkOsOrganizationOwnerId(auth.access.organizationId);
    const nifty = await syncNifty(ownerId);
    const worktivity = await syncWorktivityRoster(ownerId);
    return NextResponse.json({ nifty, worktivity });
  } catch (err) {
    return jsonError(err, 502);
  }
}
