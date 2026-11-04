import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { createAdminClient } from "@/lib/supabase/admin";
import { observedSecondsForSession } from "@/lib/work-os-admin-time-series";
import { addDaysIso, todayIso } from "@/lib/work-os-dates";
import { dateOnly } from "@/lib/work-os-internal";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Person detail for the admin People drawer: identity, team membership,
 * current schedule, recent sessions/reports/updates/recaps, and a seven-day
 * evidence summary. Bounded reads only — no raw screenshot paths. */
export async function GET(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
      authorization: req.headers.get("authorization"),
      organizationId: req.headers.get("x-work-os-organization-id"),
      roles: ["manager", "admin"],
    });
    if (auth.response) return auth.response;
    const { personId } = await params;
    const denied = await requireWorkOsPersonAccess(auth.access, personId);
    if (denied) return denied;
    const db = createAdminClient();
    const organizationId = auth.access.organizationId;
    const today = todayIso();
    const evidenceFrom = addDaysIso(today, -6);

    const [personResult, teamsResult, schedulesResult, exceptionsResult, sessionsResult, reportsResult, updatesResult, intervalsResult, recapDaysResult, evidenceSummaryResult] = await Promise.all([
      db.from("work_people")
        .select("*, role_profile:work_role_profiles(id,name)")
        .eq("organization_id", organizationId).eq("id", personId).maybeSingle(),
      db.from("work_team_members")
        .select("team_id,is_manager,team:work_teams(id,name,active)")
        .eq("person_id", personId),
      db.from("work_schedules")
        .select("id,timezone,shift_start,shift_end,days_of_week,break_windows,effective_from,effective_to,active,screenshot_analysis_enabled,screenshot_analysis_interval_minutes,screenshot_analysis_start,screenshot_analysis_end,screenshot_analysis_eod_lead_minutes")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .order("effective_from", { ascending: false }).limit(6),
      db.from("work_schedule_exceptions")
        .select("id,exception_date,kind,shift_start,shift_end,note")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .gte("exception_date", addDaysIso(today, -7))
        .order("exception_date", { ascending: false }).limit(20),
      db.from("work_sessions")
        .select("id,shift_date,state,clocked_in_at,clocked_out_at,paused_seconds,attendance_status,attendance_observed_at,correction_status,correction_reason,last_substantive_update_at")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .gte("shift_date", addDaysIso(today, -13))
        .order("shift_date", { ascending: false }).limit(100),
      db.from("work_reports")
        .select("id,report_date,status,title,submitted_at,reviewed_at,manager_notes,metrics")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .order("report_date", { ascending: false }).limit(10),
      db.from("work_check_ins")
        .select("id,shift_date,kind,substantive,input_text,update_kind,occurred_at,created_at")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .order("occurred_at", { ascending: false }).limit(12),
      db.from("work_activity_intervals")
        .select("id,local_date,window_start,window_end,prompt_kind,generation_status,review_status,headline,ai_detail,final_detail,employee_feedback,timezone")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .eq("generation_status", "ready")
        .gte("local_date", addDaysIso(today, -13)).lte("local_date", today)
        .order("window_end", { ascending: false }).limit(80),
      // The drawer reads a workday, not a capped recap list, so the per-day
      // counts come from the database and cannot be truncated by the visible
      // list's limit.
      getPool().query<{ local_date: unknown; total: number | string; reviewed: number | string }>(`
        SELECT i.local_date,
          count(*)::int AS total,
          count(*) FILTER (WHERE i.review_status IN ('confirmed', 'amended'))::int AS reviewed
        FROM work_activity_intervals i
        WHERE i.organization_id = $1 AND i.person_id = $2 AND i.generation_status = 'ready'
          AND i.local_date >= $3 AND i.local_date <= $4
        GROUP BY i.local_date
        ORDER BY i.local_date DESC
      `, [organizationId, personId, addDaysIso(today, -13), today]),
      // Exact seven-day evidence totals. Counting the bounded display read
      // capped every total at 100 and made the drawer disagree with the
      // Overview's today count.
      getPool().query<{ total: number | string; activity: number | string; output: number | string; disputed: number | string }>(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE e.source = 'worktivity')::int AS activity,
          count(*) FILTER (WHERE e.source IS DISTINCT FROM 'worktivity')::int AS output,
          count(*) FILTER (WHERE ev.correction_status = 'disputed')::int AS disputed
        FROM work_evidence e
        LEFT JOIN work_evidence_events ev ON ev.id = e.evidence_event_id
        WHERE e.organization_id = $1 AND e.person_id = $2
          AND e.evidence_date >= $3 AND e.evidence_date <= $4
      `, [organizationId, personId, evidenceFrom, today]),
    ]);
    for (const [label, result] of [
      ["person", personResult], ["teams", teamsResult], ["schedules", schedulesResult], ["exceptions", exceptionsResult],
      ["sessions", sessionsResult], ["reports", reportsResult], ["updates", updatesResult], ["intervals", intervalsResult],
    ] as const) {
      if (result.error) throw new Error(`load person detail ${label}: ${result.error.message}`);
    }
    if (!personResult.data) return NextResponse.json({ error: "person not found" }, { status: 404 });

    const now = new Date();
    const sessions = (sessionsResult.data ?? []).map((session) => ({
      ...session,
      observed_seconds: observedSecondsForSession(session, now),
    }));
    const recapDays = recapDaysResult.rows.map((row) => ({
      date: dateOnly(row.local_date) ?? "",
      total: Number(row.total ?? 0) || 0,
      reviewed: Number(row.reviewed ?? 0) || 0,
    })).filter((row) => row.date);
    const summary = evidenceSummaryResult.rows[0];
    const evidenceSummary = {
      total: Number(summary?.total ?? 0) || 0,
      activity: Number(summary?.activity ?? 0) || 0,
      output: Number(summary?.output ?? 0) || 0,
      disputed: Number(summary?.disputed ?? 0) || 0,
    };

    return NextResponse.json({
      person: personResult.data,
      teams: teamsResult.data ?? [],
      schedules: schedulesResult.data ?? [],
      exceptions: exceptionsResult.data ?? [],
      sessions,
      reports: reportsResult.data ?? [],
      updates: updatesResult.data ?? [],
      intervals: intervalsResult.data ?? [],
      recapDays,
      evidenceSummary,
    });
  } catch (error) {
    return jsonError(error);
  }
}
