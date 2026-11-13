import type { Pool } from "pg";
import { getPool } from "@/lib/db/pool";
import { WorkOsConflictError, WorkOsValidationError, type WorkOsAccess } from "@/lib/work-os-api";
import { normalizeWorkArrangement } from "@/modules/work-os/work-arrangement";
import { localDateForTimezone } from "@/modules/work-os/companion";
import { validateWorkOsTimezone } from "@/lib/work-os-schedule-validation";


/** Lock the submitted proposal so a stale tab cannot approve a newer revision. */
export async function reviewWorkArrangement(access: WorkOsAccess, personId: string, body: Record<string, unknown>, pool: Pick<Pool, "connect"> = getPool()) {
  if (access.role !== "admin") throw new WorkOsValidationError("Only workspace administrators can review work arrangements.");
  if (body.action !== "approve" && body.action !== "request_changes") throw new WorkOsValidationError("Choose approve or request_changes.");
  if (!Number.isInteger(body.revision) || Number(body.revision) < 0 || typeof body.submittedAt !== "string" || !Number.isFinite(Date.parse(body.submittedAt))) throw new WorkOsValidationError("Refresh the proposal before reviewing it.");
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (note.length > 1000) throw new WorkOsValidationError("Review notes must be 1000 characters or fewer.");
  if (body.action === "request_changes" && !note) throw new WorkOsValidationError("Explain the changes needed.");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const membership = await client.query("select id from work_org_members where organization_id=$1 and user_id=$2 and active=true and role='admin'", [access.organizationId, access.ctx.user.id]);
    if (!membership.rows.length) throw new WorkOsValidationError("Administrator membership is no longer active.");
    const person = await client.query("select id from work_people where organization_id=$1 and id=$2 for update", [access.organizationId, personId]);
    if (!person.rows.length) throw new WorkOsValidationError("Person not found in this workspace.");
    const loaded = await client.query("select * from work_employee_onboarding where organization_id=$1 and person_id=$2 for update", [access.organizationId, personId]);
    const proposal = loaded.rows[0];
    // The submission timestamp identifies the proposal the administrator saw.
    // Focused tests and same-millisecond retries use the immutable submission
    // identity rather than a client-visible revision that legitimate settings
    // saves also advance.
    if (!proposal || proposal.status !== "submitted" || !proposal.employee_submitted_at || new Date(proposal.employee_submitted_at).toISOString() !== new Date(body.submittedAt).toISOString()) throw new WorkOsConflictError("This proposal changed or was already reviewed. Refresh before deciding.");
    let scheduleId: string | null = null;
    let effectiveFrom: string | null = null;
    let approvedSchedule: ReturnType<typeof normalizeWorkArrangement> | null = null;
    let approvedTimezone: string | null = null;
    if (body.action === "approve") {
      const open = await client.query("select id from work_sessions where organization_id=$1 and person_id=$2 and state in ('clocked_in','active','paused','eod_due') limit 1", [access.organizationId, personId]);
      if (open.rows.length) throw new WorkOsConflictError("Wait until this person's current work session has closed before approving a new arrangement.");
      const schedule = normalizeWorkArrangement(body.schedule ?? proposal.schedule_proposal);
      const organization = await client.query("select feature_flags from work_organizations where id=$1", [access.organizationId]);
      if (organization.rows[0]?.feature_flags?.worktivity_authoritative_breaks === true) schedule.breaks = [];
      const timezone = validateWorkOsTimezone(body.timezone ?? proposal.timezone);
      approvedSchedule = schedule;
      approvedTimezone = timezone;
      const today = localDateForTimezone(new Date(), timezone);
      const existing = await client.query("select id,screenshot_analysis_enabled,screenshot_analysis_interval_minutes,screenshot_analysis_start,screenshot_analysis_end,screenshot_analysis_eod_lead_minutes from work_schedules where organization_id=$1 and person_id=$2 and active=true and (effective_to is null or effective_to >= $3::date) order by effective_from desc for update", [access.organizationId, personId, today]);
      const next = new Date(`${today}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
      // Replacements start tomorrow; today's recorded work keeps its policy.
      effectiveFrom = existing.rows.length ? next.toISOString().slice(0, 10) : today;
      await client.query("update work_schedules set effective_to=$3::date - 1, updated_at=now() where organization_id=$1 and person_id=$2 and active=true and effective_from < $3::date and (effective_to is null or effective_to >= $3::date)", [access.organizationId, personId, effectiveFrom]);
      await client.query("update work_schedules set active=false, updated_at=now() where organization_id=$1 and person_id=$2 and active=true and effective_from >= $3::date", [access.organizationId, personId, effectiveFrom]);
      const prior = existing.rows[0] ?? {};
      const inserted = await client.query("insert into work_schedules (organization_id,person_id,arrangement,timezone,days_of_week,shift_start,shift_end,break_windows,effective_from,active,created_by,screenshot_analysis_enabled,screenshot_analysis_interval_minutes,screenshot_analysis_start,screenshot_analysis_end,screenshot_analysis_eod_lead_minutes) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::date,true,$10,$11,$12,$13,$14,$15) returning id", [access.organizationId, personId, schedule.arrangement, timezone, schedule.daysOfWeek, schedule.shiftStart, schedule.shiftEnd, JSON.stringify(schedule.breaks), effectiveFrom, access.ctx.user.id, prior.screenshot_analysis_enabled ?? true, prior.screenshot_analysis_interval_minutes ?? 60, prior.screenshot_analysis_start ?? null, prior.screenshot_analysis_end ?? null, prior.screenshot_analysis_eod_lead_minutes ?? 30]);
      scheduleId = inserted.rows[0].id;
    }
    await client.query("update work_employee_onboarding set status=$3,reviewed_by=$4,reviewed_at=now(),review_note=$5,draft_revision=draft_revision+1,updated_at=now(),schedule_proposal=case when $6::jsonb is null then schedule_proposal else $6::jsonb end,timezone=coalesce($7,timezone) where organization_id=$1 and person_id=$2", [access.organizationId, personId, body.action === "approve" ? "confirmed" : "changes_requested", access.ctx.user.id, note || null, approvedSchedule ? JSON.stringify(approvedSchedule) : null, approvedTimezone]);
    await client.query("insert into work_audit_log (organization_id,actor_user_id,action,target_type,target_id,metadata) values ($1,$2,$3,'person',$4,$5::jsonb)", [access.organizationId, access.ctx.user.id, `onboarding.arrangement_${body.action === "approve" ? "approved" : "changes_requested"}`, personId, JSON.stringify({ scheduleId, effectiveFrom, revision: body.revision, submittedAt: body.submittedAt, note: note || null })]);
    await client.query("commit");
    return { status: body.action === "approve" ? "confirmed" : "changes_requested", scheduleId, effectiveFrom };
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
