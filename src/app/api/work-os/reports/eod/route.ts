import { NextResponse } from "next/server";
import { draftWorkOsEod } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const body = await req.json();
    body.draft_idempotency_key = req.headers.get("idempotency-key") || body.draft_idempotency_key;
    const requestedPersonId = typeof body.person_id === "string" && body.person_id.trim() ? body.person_id.trim() : null;
    const personId = auth.access.role === "employee" ? auth.access.personId : (requestedPersonId ?? auth.access.personId);
    if (!personId) return NextResponse.json({ error: "person_id is required" }, { status: 400 });
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    const report = await draftWorkOsEod(auth.access, personId, body);
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
