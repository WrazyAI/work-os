import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { reviewWorkOsEod } from "@/lib/work-os-companion";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ reportId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      roles: ["manager", "admin"],
    });
    if (auth.response) return auth.response;
    const { reportId } = await params;
    const { data: report, error } = await createAdminClient()
      .from("work_reports")
      .select("person_id")
      .eq("organization_id", auth.access.organizationId)
      .eq("id", reportId)
      .single();
    if (error) throw new Error(`load report access: ${error.message}`);
    if (!report.person_id) return NextResponse.json({ error: "report has no person" }, { status: 409 });
    const denied = await requireWorkOsPersonAccess(auth.access, report.person_id);
    if (denied) return denied;
    return NextResponse.json({ report: await reviewWorkOsEod(auth.access, reportId, await req.json()) });
  } catch (error) {
    return jsonError(error);
  }
}
