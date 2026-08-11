import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      organizationId: req.headers.get("x-work-os-organization-id"),
      authorization: req.headers.get("authorization"),
    });
    if (auth.response) return auth.response;
    const { eventId } = await params;
    const body = await req.json();
    const status = typeof body.correction_status === "string" ? body.correction_status : "";
    const allowed = auth.access.role === "employee" ? ["disputed"] : ["disputed", "corrected", "retracted"];
    if (!allowed.includes(status)) return NextResponse.json({ error: `correction_status must be ${allowed.join(" or ")}` }, { status: 400 });
    if (status === "corrected" && (typeof body.summary !== "string" || !body.summary.trim())) {
      return NextResponse.json({ error: "summary is required for corrected evidence" }, { status: 400 });
    }
    const db = createAdminClient();
    const { data: event, error: loadError } = await db.from("work_evidence_events").select("*")
      .eq("organization_id", auth.access.organizationId).eq("id", eventId).single();
    if (loadError) throw new Error(`load evidence event: ${loadError.message}`);
    let personId = event.person_id as string | null;
    if (!personId && auth.access.role === "admin" && typeof body.person_id === "string") {
      const { data: person, error: personError } = await db.from("work_people").select("id")
        .eq("organization_id", auth.access.organizationId).eq("id", body.person_id).maybeSingle();
      if (personError) throw new Error(`validate evidence attribution: ${personError.message}`);
      personId = person?.id ?? null;
    }
    if (!personId) return NextResponse.json({ error: "unattributed evidence requires an admin person mapping" }, { status: 409 });
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    const summary = typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : event.summary;
    const correctedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await db.from("work_evidence_events").update({
      correction_status: status,
      person_id: personId,
      attribution_method: event.person_id ? event.attribution_method : "admin_confirmed",
      attribution_confidence: event.person_id ? event.attribution_confidence : 1,
      summary,
      corrected_by: auth.access.ctx.user.id,
      corrected_at: correctedAt,
      updated_at: correctedAt,
    }).eq("organization_id", auth.access.organizationId).eq("id", eventId).select("*").single();
    if (updateError) throw new Error(`correct evidence event: ${updateError.message}`);
    const { data: organization, error: organizationError } = await db.from("work_organizations").select("legacy_owner_id,created_by")
      .eq("id", auth.access.organizationId).single();
    if (organizationError) throw new Error(`load evidence organization: ${organizationError.message}`);
    const { error: mirrorError } = await db.from("work_evidence").upsert({
      user_id: organization.legacy_owner_id || organization.created_by,
      organization_id: auth.access.organizationId,
      person_id: personId,
      task_id: event.task_id,
      evidence_event_id: eventId,
      evidence_date: String(event.occurred_at).slice(0, 10),
      source: event.provider,
      title: event.title,
      summary,
      url: event.artifact_url,
      metrics: { evidenceClass: event.evidence_class, attributionMethod: event.person_id ? event.attribution_method : "admin_confirmed", attributionConfidence: event.person_id ? event.attribution_confidence : 1 },
      raw: { evidenceEventId: eventId },
      updated_at: correctedAt,
    }, { onConflict: "evidence_event_id" });
    if (mirrorError) throw new Error(`mirror evidence correction: ${mirrorError.message}`);
    const { error: auditError } = await db.from("work_audit_log").insert({
      organization_id: auth.access.organizationId,
      actor_user_id: auth.access.ctx.user.id,
      action: `evidence.${status}`,
      target_type: "evidence_event",
      target_id: eventId,
      reason: typeof body.reason === "string" ? body.reason.trim() || null : null,
      metadata: { previousStatus: event.correction_status },
    });
    if (auditError) throw new Error(`audit evidence correction: ${auditError.message}`);
    return NextResponse.json({ evidence: updated });
  } catch (error) {
    return jsonError(error);
  }
}
