import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEvidence } from "@/lib/work-os";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsAdmin, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id") });
    if (auth.response) return auth.response;
    const sp = new URL(req.url).searchParams;
    const requestedPersonId = sp.get("personId");
    if (requestedPersonId) {
      const denied = await requireWorkOsPersonAccess(auth.access, requestedPersonId);
      if (denied) return denied;
    }
    const personIds = requestedPersonId ? [requestedPersonId] : await accessibleWorkOsPersonIds(auth.access);
    if (personIds && !personIds.length) return NextResponse.json({ evidence: [] });
    let query = createAdminClient().from("work_evidence")
      .select("*, person:work_people(id,display_name), task:work_tasks(id,title), event:work_evidence_events(correction_status,evidence_class,metadata,screenshot:work_screenshot_summaries(id,processing_status,summary,confidence,storage_path,deleted_at))")
      .eq("organization_id", auth.access.organizationId);
    if (personIds) query = query.in("person_id", personIds);
    if (sp.get("taskId")) query = query.eq("task_id", sp.get("taskId"));
    if (sp.get("date")) query = query.eq("evidence_date", sp.get("date"));
    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(`load Work OS evidence: ${error.message}`);
    return NextResponse.json({ evidence: data ?? [] });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin();
  if ("response" in auth) return auth.response;
  try {
    const body = await req.json();
    body.idempotency_key = req.headers.get("idempotency-key") || body.idempotency_key;
    const evidence = await createEvidence(auth.ctx.profile.id, body, auth.access.organizationId);
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (err) {
    return jsonError(err);
  }
}
