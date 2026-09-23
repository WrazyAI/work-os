import { NextResponse } from "next/server";
import { jsonError, requireWorkOsAccess } from "@/lib/work-os-api";
import { controlWorktivityAttendance } from "@/lib/work-os-worktivity-control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const authorization = req.headers.get("authorization");
    if (!authorization?.match(/^Bearer\s+\S+$/i) || req.headers.get("x-work-os-desktop-control") !== "companion") {
      return NextResponse.json({ error: "Worktivity clock controls require a connected Windows Companion." }, { status: 403 });
    }
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization,
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const key = req.headers.get("idempotency-key");
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "A Worktivity control request object is required." }, { status: 400 });
    }
    if (!key || key !== body.operation_id) return NextResponse.json({ error: "Idempotency-Key must match operation_id." }, { status: 400 });
    return NextResponse.json(await controlWorktivityAttendance(auth.access, body));
  } catch (error) {
    return jsonError(error);
  }
}
