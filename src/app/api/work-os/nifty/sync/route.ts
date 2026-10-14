import { NextResponse } from "next/server";
import { requireWorkOsAdmin, jsonError, workOsOrganizationOwnerId } from "@/lib/work-os-api";
import { syncNifty, syncWorktivityRoster } from "@/lib/work-os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
  if ("response" in auth) return auth.response;
  try {
    const ownerId = workOsOrganizationOwnerId(auth.access);
    const nifty = await syncNifty(ownerId);
    const worktivity = await syncWorktivityRoster(ownerId);
    return NextResponse.json({ nifty, worktivity });
  } catch (err) {
    return jsonError(err, 502);
  }
}
