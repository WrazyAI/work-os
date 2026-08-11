import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["manager", "admin"] });
    if (auth.response) return auth.response;
    const personIds = await accessibleWorkOsPersonIds(auth.access);
    if (personIds && !personIds.length) return NextResponse.json({ reports: [] });
    let query = createAdminClient().from("work_reports")
      .select("*, person:work_people(id,display_name,email), versions:work_report_versions(id,version_kind,created_at)")
      .eq("organization_id", auth.access.organizationId);
    if (personIds) query = query.in("person_id", personIds);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(`load Work OS reports: ${error.message}`);
    return NextResponse.json({ reports: data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}
