import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateOnly } from "@/lib/work-os-internal";
import { createEvidence } from "@/lib/work-os";
import { embeddedRow } from "@/lib/work-os-embed-shape";
import { canViewGhlOrganizationContext, ghlEvidenceRow } from "@/lib/work-os-ghl-evidence-view";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsAdmin, requireWorkOsPersonAccess } from "@/lib/work-os-api";
import { summarizeEvidence, type EvidenceSummaryInput } from "@/lib/work-os-evidence-summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUMMARY_ROW_LIMIT = 20_000;

const EVIDENCE_SELECT =
  "*, person:work_people(id,display_name), task:work_tasks(id,title), event:work_evidence_events(occurred_at,correction_status,evidence_class,metadata,screenshot:work_screenshot_summaries(id,processing_status,summary,confidence,storage_path,deleted_at))";

/** A search term is used inside a PostgREST `or` expression. Strip the
 * separators the expression parser owns so a person's search text can never
 * change the query shape. */
function evidenceSearchTerm(value: string | null) {
  return String(value ?? "").replace(/[%,()]/g, " ").replace(/\s+/g, " ").trim();
}

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
    const unattributed = sp.get("unattributed") === "1";
    if (unattributed && !canViewGhlOrganizationContext(auth.access)) {
      return NextResponse.json({ error: "Unattributed evidence is admin-only." }, { status: 403 });
    }
    const personIds = requestedPersonId ? [requestedPersonId] : unattributed ? null : await accessibleWorkOsPersonIds(auth.access);
    if (personIds && !personIds.length) return NextResponse.json({ evidence: [] });
    const search = evidenceSearchTerm(sp.get("q"));
    const kind = sp.get("kind");
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
    else if (unattributed) query = query.is("person_id", null);
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
    if (kind === "calls") query = query.ilike("title", "Call %");
    else if (kind === "emails") query = query.ilike("title", "%email%");
    else if (kind === "texts") query = query.ilike("title", "Text message%");
    else if (kind === "context") query = query.or("title.ilike.%opportunity%,source.eq.loom,source.eq.nifty");
    else if (kind === "work") query = query.in("source", ["github", "worktivity"]);
    if (search) query = query.or(`title.ilike.%${search}%,summary.ilike.%${search}%`);
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
    const includeGhlContextBase = !requestedPersonId
      && !sp.get("taskId")
      && canViewGhlOrganizationContext(auth.access)
      && (!sp.get("source") || sp.get("source") === "ghl");
    const includeGhlContext = includeGhlContextBase
      && (!kind || kind === "all" || kind === "calls" || kind === "emails" || kind === "texts" || kind === "context");
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
      if (kind === "calls") ghlQuery = ghlQuery.ilike("title", "Call %");
      else if (kind === "emails") ghlQuery = ghlQuery.ilike("title", "%email%");
      else if (kind === "texts") ghlQuery = ghlQuery.ilike("title", "Text message%");
      else if (kind === "context") ghlQuery = ghlQuery.ilike("title", "%opportunity%");
      if (search) ghlQuery = ghlQuery.or(`title.ilike.%${search}%,summary.ilike.%${search}%`);
      const ghlResult = await ghlQuery.order("occurred_at", { ascending: false }).limit(limit);
      if (ghlResult.error) throw new Error(`load GHL organization evidence: ${ghlResult.error.message}`);
      const ghlEvents = (ghlResult.data ?? []) as Record<string, unknown>[];
      // An event stays organization context, but when its acting account or
      // its owner is already mapped to a person the row should say who that is.
      // Resolving every referenced identity once keeps this to two queries
      // regardless of page size, and lets an assigned-only row name its owner
      // without ever crediting that owner as the actor.
      const identityIds = [...new Set(ghlEvents.flatMap((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const ghlMeta = (metadata.ghl ?? {}) as Record<string, unknown>;
        const actor = (metadata.actor ?? {}) as Record<string, unknown>;
        const actorId = ghlMeta.actorId ?? actor.id;
        const assigneeIds = Array.isArray(ghlMeta.assigneeIds) ? ghlMeta.assigneeIds : [];
        return [actorId, ...assigneeIds]
          .map((id) => typeof id === "string" ? id.trim() : "")
          .filter(Boolean);
      }))];
      const identityPeople = new Map<string, { id: string; displayName: string }>();
      if (identityIds.length) {
        const accounts = await createAdminClient().from("work_source_accounts")
          .select("external_account_id,person:work_people(id,display_name)")
          .eq("organization_id", auth.access.organizationId)
          .eq("provider", "ghl")
          .eq("verified", true)
          .in("external_account_id", identityIds);
        for (const account of (accounts.data ?? []) as Record<string, unknown>[]) {
          const person = account.person as { id?: unknown; display_name?: unknown } | null;
          const externalId = String(account.external_account_id ?? "");
          if (!externalId || !person?.id || !person.display_name) continue;
          identityPeople.set(externalId, { id: String(person.id), displayName: String(person.display_name) });
        }
      }
      ghlRows = ghlEvents.map((row) => {
        const metadata = (row.metadata ?? {}) as Record<string, unknown>;
        const ghlMeta = (metadata.ghl ?? {}) as Record<string, unknown>;
        const actor = (metadata.actor ?? {}) as Record<string, unknown>;
        const actorId = ghlMeta.actorId ?? actor.id;
        const mapped = typeof actorId === "string" ? identityPeople.get(actorId.trim()) ?? null : null;
        return ghlEvidenceRow(row, mapped, identityPeople);
      });
    }
    // The event occurrence is the authoritative time for provider evidence. The
    // mirror row's created_at is when the sync wrote it, which for a backfill
    // can be hours or days after the call actually happened.
    const evidenceRows = ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const event = embeddedRow<{ occurred_at?: string | null }>(row.event);
      return {
        ...row,
        recorded_at: event?.occurred_at ?? row.created_at ?? null,
      };
    });
    const merged = [...evidenceRows, ...ghlRows]
      .sort((left, right) => {
        const leftAt = (left as Record<string, unknown>).recorded_at ?? (left as Record<string, unknown>).created_at;
        const rightAt = (right as Record<string, unknown>).recorded_at ?? (right as Record<string, unknown>).created_at;
        return String(rightAt ?? "").localeCompare(String(leftAt ?? ""));
      })
      .slice(0, limit);
    // Optional summary for the Evidence page's lead visual: source mix, daily
    // volume, exact kind counts, and (on request) the bounded coverage matrix.
    // The provider occurrence day is used for GHL context so an uncredited
    // inbound call is visible in the same pulse as a linked outbound call.
    if (sp.get("summary") === "1") {
      const coverageRequested = sp.get("coverage") === "1";
      let summaryQuery = createAdminClient().from("work_evidence")
        .select("source,evidence_date,title,person_id")
        .eq("organization_id", auth.access.organizationId);
      if (personIds) summaryQuery = summaryQuery.in("person_id", personIds);
      else if (unattributed) summaryQuery = summaryQuery.is("person_id", null);
      if (date) {
        summaryQuery = summaryQuery.eq("evidence_date", date);
      } else {
        const from = sp.get("from");
        const to = sp.get("to");
        if (from) summaryQuery = summaryQuery.gte("evidence_date", from);
        if (to) summaryQuery = summaryQuery.lte("evidence_date", to);
      }
      if (sp.get("source")) summaryQuery = summaryQuery.eq("source", sp.get("source"));
      if (sp.get("taskId")) summaryQuery = summaryQuery.eq("task_id", sp.get("taskId"));
      if (correctionEventIds) summaryQuery = summaryQuery.in("evidence_event_id", correctionEventIds);
      if (search) summaryQuery = summaryQuery.or(`title.ilike.%${search}%,summary.ilike.%${search}%`);
      const summaryResult = await summaryQuery.limit(SUMMARY_ROW_LIMIT);
      if (summaryResult.error) throw new Error(`summarize Work OS evidence: ${summaryResult.error.message}`);
      const linkedSummaryRows: EvidenceSummaryInput[] = (summaryResult.data ?? []).map((row: Record<string, unknown>) => ({
        source: String(row.source ?? "unknown"),
        evidence_date: dateOnly(row.evidence_date) ?? "",
        title: String(row.title ?? ""),
        person_id: row.person_id ? String(row.person_id) : null,
      }));
      const contextSummaryRows: EvidenceSummaryInput[] = [];
      if (includeGhlContextBase) {
        let ghlSummaryQuery = createAdminClient().from("work_evidence_events")
          .select("occurred_at,title")
          .eq("organization_id", auth.access.organizationId)
          .eq("provider", "ghl")
          .is("person_id", null);
        if (date) ghlSummaryQuery = ghlSummaryQuery.gte("occurred_at", `${date}T00:00:00.000Z`).lt("occurred_at", `${date}T23:59:59.999Z`);
        else {
          const summaryFrom = sp.get("from");
          const summaryTo = sp.get("to");
          if (summaryFrom) ghlSummaryQuery = ghlSummaryQuery.gte("occurred_at", `${summaryFrom}T00:00:00.000Z`);
          if (summaryTo) ghlSummaryQuery = ghlSummaryQuery.lt("occurred_at", `${summaryTo}T23:59:59.999Z`);
        }
        if (correction) ghlSummaryQuery = ghlSummaryQuery.eq("correction_status", correction);
        if (search) ghlSummaryQuery = ghlSummaryQuery.or(`title.ilike.%${search}%,summary.ilike.%${search}%`);
        const ghlSummaryResult = await ghlSummaryQuery.order("occurred_at", { ascending: false }).limit(SUMMARY_ROW_LIMIT);
        if (ghlSummaryResult.error) throw new Error(`summarize GHL organization evidence: ${ghlSummaryResult.error.message}`);
        for (const row of (ghlSummaryResult.data ?? []) as Array<Record<string, unknown>>) {
          contextSummaryRows.push({
            source: "ghl",
            evidence_date: String(row.occurred_at ?? "").slice(0, 10),
            title: String(row.title ?? ""),
            person_id: null,
          });
        }
      }
      const summary = summarizeEvidence([...linkedSummaryRows, ...contextSummaryRows], coverageRequested);
      if (linkedSummaryRows.length >= SUMMARY_ROW_LIMIT || contextSummaryRows.length >= SUMMARY_ROW_LIMIT) summary.capped = true;
      return NextResponse.json({ evidence: merged, summary });
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
