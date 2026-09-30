import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDaysIso, todayIso } from "@/lib/work-os-dates";
import { jsonError, requireWorkOsAccess, requireWorkOsPersonAccess } from "@/lib/work-os-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Person detail for the admin People drawer: identity, team membership,
 * current schedule, recent sessions/reports/updates/recaps, and a seven-day
 * evidence summary. Bounded reads only — no raw screenshot paths. */
export async function GET(req: Request, { params }: { params: Promise<{ personId: string }> }) {
  try {
    const auth = await requireWorkOsAccess({
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

    const [personResult, teamsResult, schedulesResult, exceptionsResult, sessionsResult, reportsResult, updatesResult, intervalsResult, evidenceResult] = await Promise.all([
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
        .order("shift_date", { ascending: false }).limit(30),
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
        .order("window_end", { ascending: false }).limit(6),
      db.from("work_evidence")
        .select("id,evidence_date,source,title,created_at,event:work_evidence_events(correction_status)")
        .eq("organization_id", organizationId).eq("person_id", personId)
        .gte("evidence_date", evidenceFrom).lte("evidence_date", today)
        .order("created_at", { ascending: false }).limit(100),
    ]);
    for (const [label, result] of [
      ["person", personResult], ["teams", teamsResult], ["schedules", schedulesResult], ["exceptions", exceptionsResult],
      ["sessions", sessionsResult], ["reports", reportsResult], ["updates", updatesResult], ["intervals", intervalsResult],
      ["evidence", evidenceResult],
    ] as const) {
      if (result.error) throw new Error(`load person detail ${label}: ${result.error.message}`);
    }
    if (!personResult.data) return NextResponse.json({ error: "person not found" }, { status: 404 });

    const evidence = (evidenceResult.data ?? []) as Array<Record<string, any>>;
    const evidenceSummary = {
      total: evidence.length,
      activity: evidence.filter((row) => String(row.source) === "worktivity").length,
      output: evidence.filter((row) => String(row.source) !== "worktivity").length,
      disputed: evidence.filter((row) => {
        const event = Array.isArray(row.event) ? row.event[0] : row.event;
        return String(event?.correction_status ?? "") === "disputed";
      }).length,
    };

    return NextResponse.json({
      person: personResult.data,
      teams: teamsResult.data ?? [],
      schedules: schedulesResult.data ?? [],
      exceptions: exceptionsResult.data ?? [],
      sessions: sessionsResult.data ?? [],
      reports: reportsResult.data ?? [],
      updates: updatesResult.data ?? [],
      intervals: intervalsResult.data ?? [],
      evidenceSummary,
    });
  } catch (error) {
    return jsonError(error);
  }
}
