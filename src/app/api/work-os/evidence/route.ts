import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEvidence } from "@/lib/work-os";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsAdmin, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVIDENCE_SELECT =
  "*, person:work_people(id,display_name), task:work_tasks(id,title), event:work_evidence_events(correction_status,evidence_class,metadata,screenshot:work_screenshot_summaries(id,processing_status,summary,confidence,storage_path,deleted_at))";
const EVIDENCE_SELECT_DISPUTED =
  "*, person:work_people(id,display_name), task:work_tasks(id,title), event:work_evidence_events!inner(correction_status,evidence_class,metadata,screenshot:work_screenshot_summaries(id,processing_status,summary,confidence,storage_path,deleted_at))";

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
    const correction = sp.get("correction");
    let query = createAdminClient().from("work_evidence")
      .select(correction ? EVIDENCE_SELECT_DISPUTED : EVIDENCE_SELECT)
      .eq("organization_id", auth.access.organizationId);
    if (personIds) query = query.in("person_id", personIds);
    if (sp.get("taskId")) query = query.eq("task_id", sp.get("taskId"));
    const date = sp.get("date");
    if (date) {
      query = query.eq("evidence_date", date);
    } else {
      const from = sp.get("from");
      const to = sp.get("to");
      if (from) query = query.gte("evidence_date", from);
      if (to) query = query.lte("evidence_date", to);
    }
    if (sp.get("source")) query = query.eq("source", sp.get("source"));
    if (correction) query = query.eq("event.correction_status", correction);
    const limitParam = Number(sp.get("limit"));
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, Math.floor(limitParam))) : 200;
    const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`load Work OS evidence: ${error.message}`);
    return NextResponse.json({ evidence: data ?? [] });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"));
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
