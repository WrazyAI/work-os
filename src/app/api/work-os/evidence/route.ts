import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateOnly } from "@/lib/work-os-internal";
import { createEvidence } from "@/lib/work-os";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsAdmin, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVIDENCE_SELECT =
  "*, person:work_people(id,display_name), task:work_tasks(id,title), event:work_evidence_events(correction_status,evidence_class,metadata,screenshot:work_screenshot_summaries(id,processing_status,summary,confidence,storage_path,deleted_at))";

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
    // The query shim cannot filter on embedded columns, so a correction filter
    // resolves the matching event ids first and filters evidence by event id.
    const correction = sp.get("correction");
    let correctionEventIds: string[] | null = null;
    if (correction) {
      const events = await createAdminClient().from("work_evidence_events")
        .select("id")
        .eq("organization_id", auth.access.organizationId)
        .eq("correction_status", correction)
        .limit(500);
      if (events.error) throw new Error(`load ${correction} evidence events: ${events.error.message}`);
      correctionEventIds = (events.data ?? []).map((row: Record<string, unknown>) => String(row.id));
      if (!correctionEventIds.length) return NextResponse.json({ evidence: [] });
    }
    let query = createAdminClient().from("work_evidence")
      .select(EVIDENCE_SELECT)
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
    if (correctionEventIds) query = query.in("evidence_event_id", correctionEventIds);
    const rawLimit = sp.get("limit");
    const limitParam = rawLimit == null || rawLimit === "" ? Number.NaN : Number(rawLimit);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(500, Math.floor(limitParam))) : 200;
    const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`load Work OS evidence: ${error.message}`);
    // Optional summary for the Evidence page's lead visual: source mix and a
    // daily volume series over the same filters, computed from date/source
    // columns only so the payload stays small.
    if (sp.get("summary") === "1") {
      let summaryQuery = createAdminClient().from("work_evidence")
        .select("source,evidence_date")
        .eq("organization_id", auth.access.organizationId);
      if (personIds) summaryQuery = summaryQuery.in("person_id", personIds);
      if (date) {
        summaryQuery = summaryQuery.eq("evidence_date", date);
      } else {
        const from = sp.get("from");
        const to = sp.get("to");
        if (from) summaryQuery = summaryQuery.gte("evidence_date", from);
        if (to) summaryQuery = summaryQuery.lte("evidence_date", to);
      }
      if (sp.get("source")) summaryQuery = summaryQuery.eq("source", sp.get("source"));
      const summaryResult = await summaryQuery.limit(2000);
      if (summaryResult.error) throw new Error(`summarize Work OS evidence: ${summaryResult.error.message}`);
      const sources = new Map<string, number>();
      const days = new Map<string, number>();
      for (const row of (summaryResult.data ?? []) as Array<Record<string, unknown>>) {
        const source = String(row.source ?? "unknown");
        sources.set(source, (sources.get(source) ?? 0) + 1);
        const day = dateOnly(row.evidence_date) ?? "";
        if (day) days.set(day, (days.get(day) ?? 0) + 1);
      }
      return NextResponse.json({
        evidence: data ?? [],
        summary: {
          sources: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((left, right) => right.count - left.count),
          days: [...days.entries()].map(([day, count]) => ({ date: day, count })).sort((left, right) => left.date.localeCompare(right.date)),
        },
      });
    }
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
