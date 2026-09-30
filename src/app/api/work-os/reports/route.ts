import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
    const auth = await requireWorkOsAccess({ organizationId: req.headers.get("x-work-os-organization-id"), roles: ["manager", "admin"] });
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
    const limitParam = Number(sp.get("limit"));
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
    return NextResponse.json({ reports: listResult.data ?? [], counts });
  } catch (error) {
    return jsonError(error);
  }
}

function emptyCounts() {
  return { draft: 0, pending_review: 0, approved: 0, rejected: 0, total: 0 };
}
