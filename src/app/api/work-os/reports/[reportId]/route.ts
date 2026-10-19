import { NextResponse } from "next/server";
import { deleteWorkOsEodDraft } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Removes an unsubmitted EOD draft. A report that is already with a manager
 * is never removed here. */
export async function DELETE(req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const personId = auth.access.personId;
    if (!personId) return NextResponse.json({ error: "person_id is required" }, { status: 400 });
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    const { reportId } = await params;
    return NextResponse.json(await deleteWorkOsEodDraft(auth.access, personId, reportId));
  } catch (error) {
    return jsonError(error);
  }
}
