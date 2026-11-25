import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteWorkOsEodDraft, saveWorkOsEodComposition } from "@/lib/work-os-companion";
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

/** Saves the employee's structured composition without submitting it. */
export async function PATCH(req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
      requirePerson: true,
      feature: "employee_companion",
    });
    if (auth.response) return auth.response;
    const { reportId } = await params;
    const { data: report, error } = await createAdminClient()
      .from("work_reports")
      .select("person_id")
      .eq("organization_id", auth.access.organizationId)
      .eq("id", reportId)
      .maybeSingle();
    if (error) throw new Error(`load report access: ${error.message}`);
    if (!report) return NextResponse.json({ error: "report not found" }, { status: 404 });
    if (!report.person_id) return NextResponse.json({ error: "report has no person" }, { status: 409 });
    const denied = await requireWorkOsPersonAccess(auth.access, report.person_id);
    if (denied) return denied;
    return NextResponse.json({ report: await saveWorkOsEodComposition(auth.access, reportId, await req.json()) });
  } catch (error) {
    return jsonError(error);
  }
}
