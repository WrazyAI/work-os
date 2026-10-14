import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dateOnly } from "@/lib/work-os-internal";
import { accessibleWorkOsPersonIds, jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_STATUSES = ["draft", "pending_review", "approved", "rejected"] as const;

interface ReportFilters {
  personIds: string[] | null;
  status?: string | null;
  from?: string | null;
  to?: string | null;
}

// The Supabase query builder narrows its type after each filter; a small
// untyped seam keeps the filter logic in one place for the list and the counts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withReportFilters(query: any, filters: ReportFilters): any {
  let next = query;
  if (filters.personIds) next = next.in("person_id", filters.personIds);
  if (filters.status) next = next.eq("status", filters.status);
  if (filters.from) next = next.gte("report_date", filters.from);
  if (filters.to) next = next.lte("report_date", filters.to);
  return next;
}

export async function GET(req: Request) {
  try {
    const auth = await requireWorkOsAccess({ authorization: req.headers.get("authorization"), organizationId: req.headers.get("x-work-os-organization-id"), roles: ["manager", "admin"] });
    if (auth.response) return auth.response;
    const sp = new URL(req.url).searchParams;
    const requestedPersonId = sp.get("personId");
    if (requestedPersonId) {
      const denied = await requireWorkOsPersonAccess(auth.access, requestedPersonId);
      if (denied) return denied;
    }
    const personIds = requestedPersonId ? [requestedPersonId] : await accessibleWorkOsPersonIds(auth.access);
    if (personIds && !personIds.length) return NextResponse.json({ reports: [], counts: emptyCounts() });
    const db = createAdminClient();
    const statusParam = sp.get("status");
    const filters: ReportFilters = {
      personIds,
      status: statusParam && (REPORT_STATUSES as readonly string[]).includes(statusParam) ? statusParam : null,
      from: sp.get("from"),
      to: sp.get("to"),
    };
    const rawLimit = sp.get("limit");
    const limitParam = rawLimit == null || rawLimit === "" ? Number.NaN : Number(rawLimit);
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(300, Math.floor(limitParam))) : 100;

    const listQuery = withReportFilters(
      db.from("work_reports")
        .select("*, person:work_people(id,display_name,email), versions:work_report_versions(id,version_kind,created_at)")
        .eq("organization_id", auth.access.organizationId),
      filters,
    );
    const countQueries = REPORT_STATUSES.map((value) =>
      withReportFilters(
        db.from("work_reports").select("id", { count: "exact", head: true })
          .eq("organization_id", auth.access.organizationId),
        { ...filters, status: value },
      ),
    );

    const [listResult, ...countResults] = await Promise.all([
      listQuery.order("created_at", { ascending: false }).limit(limit),
      ...countQueries,
    ]);
    if (listResult.error) throw new Error(`load Work OS reports: ${listResult.error.message}`);
    const counts = emptyCounts();
    REPORT_STATUSES.forEach((value, index) => {
      const result = countResults[index];
      if (result.error) throw new Error(`count Work OS reports: ${result.error.message}`);
      counts[value] = result.count ?? 0;
      counts.total += result.count ?? 0;
    });
    // Fourteen-day submission cadence for the review page's lead visual.
    const seriesFrom = new Date(Date.now() - 13 * 24 * 60 * 60_000).toISOString().slice(0, 10);
    const seriesQuery = withReportFilters(
      db.from("work_reports").select("report_date,status,submitted_at,person_id")
        .eq("organization_id", auth.access.organizationId),
      { personIds, status: null, from: seriesFrom, to: null },
    );
    const seriesResult = await seriesQuery.limit(2000);
    if (seriesResult.error) throw new Error(`load Work OS report cadence: ${seriesResult.error.message}`);
    const seriesRows = (seriesResult.data ?? []) as Array<Record<string, unknown>>;
    // The chart stacks each day by teammate, so resolve the names for the
    // people who actually submitted in the window.
    const seriesPersonIds = [...new Set(seriesRows.map((row) => String(row.person_id ?? "")).filter(Boolean))];
    const seriesNames = new Map<string, string>();
    if (seriesPersonIds.length) {
      const peopleResult = await db.from("work_people").select("id,display_name").in("id", seriesPersonIds).limit(500);
      if (peopleResult.error) throw new Error(`load report cadence people: ${peopleResult.error.message}`);
      for (const person of (peopleResult.data ?? []) as Array<Record<string, unknown>>) {
        seriesNames.set(String(person.id), String(person.display_name ?? "Unnamed"));
      }
    }
    const seriesBuckets = new Map<string, { date: string; submitted: number; drafted: number; people: Array<{ personId: string; name: string; submitted: number }> }>();
    for (let index = 0; index < 14; index += 1) {
      const date = new Date(Date.now() - (13 - index) * 24 * 60 * 60_000).toISOString().slice(0, 10);
      seriesBuckets.set(date, { date, submitted: 0, drafted: 0, people: [] });
    }
    for (const row of seriesRows) {
      const bucket = seriesBuckets.get(dateOnly(row.report_date) ?? "");
      if (!bucket) continue;
      if (["pending_review", "approved"].includes(String(row.status))) {
        bucket.submitted += 1;
        const personId = String(row.person_id ?? "");
        if (personId) {
          const entry = bucket.people.find((person) => person.personId === personId);
          if (entry) entry.submitted += 1;
          else bucket.people.push({ personId, name: seriesNames.get(personId) ?? "Unmapped person", submitted: 1 });
        }
      } else if (String(row.status) === "draft") bucket.drafted += 1;
    }
    for (const bucket of seriesBuckets.values()) bucket.people.sort((left, right) => right.submitted - left.submitted);
    return NextResponse.json({ reports: listResult.data ?? [], counts, series: [...seriesBuckets.values()] });
  } catch (error) {
    return jsonError(error);
  }
}

function emptyCounts() {
  return { draft: 0, pending_review: 0, approved: 0, rejected: 0, total: 0 };
}
