import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { submitWorkOsEod } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const { data: report, error: reportError } = await createAdminClient()
      .from("work_reports")
      .select("person_id")
      .eq("organization_id", auth.access.organizationId)
      .eq("id", reportId)
      .maybeSingle();
    if (reportError) throw new Error(`load report access: ${reportError.message}`);
    if (!report) return NextResponse.json({ error: "report not found" }, { status: 404 });
    if (!report.person_id) return NextResponse.json({ error: "report has no person" }, { status: 409 });
    const denied = await requireWorkOsPersonAccess(auth.access, report.person_id);
    if (denied) return denied;
    const body = await req.json();
    body.submission_idempotency_key = req.headers.get("idempotency-key") || body.submission_idempotency_key;
    return NextResponse.json({ report: await submitWorkOsEod(auth.access, reportId, body) });
  } catch (error) {
    return jsonError(error);
  }
}
