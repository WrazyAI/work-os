import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateOnly } from "@/lib/work-os-internal";
import { createEvidence } from "@/lib/work-os";
import { canViewGhlOrganizationContext, ghlEvidenceRow } from "@/lib/work-os-ghl-evidence-view";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsAdmin, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVIDENCE_SELECT =
  "*, person:work_people(id,display_name), task:work_tasks(id,title), event:work_evidence_events(correction_status,evidence_class,metadata,screenshot:work_screenshot_summaries(id,processing_status,summary,confidence,storage_path,deleted_at))";

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id") });
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

    // Organization-scoped GHL records that are not attributable to one person
    // (shared accounts, automation, assigned-only context) are admin-only and
    // never appear behind a person filter.
    let ghlRows: Record<string, unknown>[] = [];
    const includeGhlContext = !requestedPersonId
      && !sp.get("taskId")
      && canViewGhlOrganizationContext(auth.access)
      && (!sp.get("source") || sp.get("source") === "ghl");
    if (includeGhlContext) {
      let ghlQuery = createAdminClient().from("work_evidence_events")
        .select("id,person_id,occurred_at,title,summary,evidence_class,correction_status,metadata")
        .eq("organization_id", auth.access.organizationId)
        .eq("provider", "ghl")
        .is("person_id", null);
      if (sp.get("date")) {
        ghlQuery = ghlQuery.gte("occurred_at", `${sp.get("date")}T00:00:00.000Z`).lt("occurred_at", `${sp.get("date")}T23:59:59.999Z`);
      } else {
        if (sp.get("from")) ghlQuery = ghlQuery.gte("occurred_at", `${sp.get("from")}T00:00:00.000Z`);
        if (sp.get("to")) ghlQuery = ghlQuery.lt("occurred_at", `${sp.get("to")}T23:59:59.999Z`);
      }
      if (correction) ghlQuery = ghlQuery.eq("correction_status", correction);
      const ghlResult = await ghlQuery.order("occurred_at", { ascending: false }).limit(limit);
      if (ghlResult.error) throw new Error(`load GHL organization evidence: ${ghlResult.error.message}`);
      const ghlEvents = (ghlResult.data ?? []) as Record<string, unknown>[];
      // An event stays organization context, but when its acting account is
      // already mapped to a person the row should say who that is. Resolving
      // the actor ids once keeps this to two queries regardless of page size.
      const actorIds = [...new Set(ghlEvents
        .map((row) => {
          const metadata = (row.metadata ?? {}) as Record<string, unknown>;
          const ghlMeta = (metadata.ghl ?? {}) as Record<string, unknown>;
          const actor = (metadata.actor ?? {}) as Record<string, unknown>;
          const id = ghlMeta.actorId ?? actor.id;
          return typeof id === "string" && id.trim() ? id.trim() : null;
        })
        .filter((id): id is string => !!id))];
      const actorPeople = new Map<string, { id: string; displayName: string }>();
      if (actorIds.length) {
        const accounts = await createAdminClient().from("work_source_accounts")
          .select("external_account_id,person:work_people(id,display_name)")
          .eq("organization_id", auth.access.organizationId)
          .eq("provider", "ghl")
          .eq("verified", true)
          .in("external_account_id", actorIds);
        for (const account of (accounts.data ?? []) as Record<string, unknown>[]) {
          const person = account.person as { id?: unknown; display_name?: unknown } | null;
          const externalId = String(account.external_account_id ?? "");
          if (!externalId || !person?.id || !person.display_name) continue;
          actorPeople.set(externalId, { id: String(person.id), displayName: String(person.display_name) });
        }
      }
      ghlRows = ghlEvents.map((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const ghlMeta = (metadata.ghl ?? {}) as Record<string, unknown>;
        const actor = (metadata.actor ?? {}) as Record<string, unknown>;
        const actorId = ghlMeta.actorId ?? actor.id;
        const mapped = typeof actorId === "string" ? actorPeople.get(actorId.trim()) ?? null : null;
        return ghlEvidenceRow(row, mapped);
      });
    }
    const merged = [...(data ?? []), ...ghlRows]
      .sort((left, right) => String((right as Record<string, unknown>).created_at ?? "").localeCompare(String((left as Record<string, unknown>).created_at ?? "")))
      .slice(0, limit);
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
      let ghlContextCount = 0;
      if (includeGhlContext) {
        let ghlCount = createAdminClient().from("work_evidence_events")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", auth.access.organizationId)
          .eq("provider", "ghl")
          .is("person_id", null);
        if (date) ghlCount = ghlCount.gte("occurred_at", `${date}T00:00:00.000Z`).lt("occurred_at", `${date}T23:59:59.999Z`);
        else {
          const summaryFrom = sp.get("from");
          const summaryTo = sp.get("to");
          if (summaryFrom) ghlCount = ghlCount.gte("occurred_at", `${summaryFrom}T00:00:00.000Z`);
          if (summaryTo) ghlCount = ghlCount.lt("occurred_at", `${summaryTo}T23:59:59.999Z`);
        }
        if (correction) ghlCount = ghlCount.eq("correction_status", correction);
        const ghlCountResult = await ghlCount;
        if (ghlCountResult.error) throw new Error(`count GHL organization evidence: ${ghlCountResult.error.message}`);
        ghlContextCount = ghlCountResult.count ?? 0;
        if (ghlContextCount) sources.set("ghl", (sources.get("ghl") ?? 0) + ghlContextCount);
      }
      for (const row of (summaryResult.data ?? []) as Array<Record<string, unknown>>) {
        const source = String(row.source ?? "unknown");
        sources.set(source, (sources.get(source) ?? 0) + 1);
        const day = dateOnly(row.evidence_date) ?? "";
        if (day) days.set(day, (days.get(day) ?? 0) + 1);
      }
      return NextResponse.json({
        evidence: merged,
        summary: {
          sources: [...sources.entries()].map(([source, count]) => ({ source, count })).sort((left, right) => right.count - left.count),
          days: [...days.entries()].map(([day, count]) => ({ date: day, count })).sort((left, right) => left.date.localeCompare(right.date)),
        },
      });
    }
    return NextResponse.json({ evidence: merged });
  } catch (err) {
    return jsonError(err);
  }
}

export async function POST(req: Request) {
  const auth = await requireWorkOsAdmin(req.headers.get("x-work-os-organization-id"), req.headers.get("authorization"));
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
