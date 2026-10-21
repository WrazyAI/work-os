import {
  listEvidence,
  listPersonTasks,
} from "@/lib/work-os";
import { localDateForTimezone, resolveShiftWindow, resolveShiftWindowForDate } from "@/modules/work-os/companion";
import { getWorkday } from "@/lib/work-os-workday";
import { loadPersistedWorktivityAttendance, observeWorktivityAttendance } from "@/lib/work-os-attendance";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";
import { db, dateOnly, loadShiftData, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { suppressPromptForSubmittedEod } from "@/modules/work-os/workday";

export async function getWorkOsDay(
  access: WorkOsAccess,
  personId: string,
  at = new Date(),
  options: { refreshNifty?: boolean; refreshAttendance?: boolean; compact?: boolean; localDate?: string | null } = {},
) {
  // External provider calls are started immediately but never block the
  // response: the dashboard renders current (timestamped, truthful) data and
  // the provider refresh lands in the background.
  const attendancePromise = options.refreshAttendance
    // An explicit attendance refresh is a request for fresh provider truth, so
    // it bypasses the short observer cache the background cadence relies on.
    ? observeWorktivityAttendance(access, at, { forceRefresh: true })
    : loadPersistedWorktivityAttendance(access, at).then((attendance) => ({ attendance, session: null }));
  const ownerIdPromise = organizationOwnerId(access.organizationId);
  const [attendance, authoritativeBreaks] = await Promise.all([
    attendancePromise,
    worktivityAuthoritativeBreaks(access.organizationId),
  ]);
  const { rules, exceptions, timezone } = await loadShiftData(access, personId, at);
  const shift = resolveShiftWindow(rules, exceptions, at);
  // Upcoming-shift display must not advance task/history attribution into the
  // next day after the current shift ends.
  const shiftDate = options.localDate ?? localDateForTimezone(at, timezone);
  // The EOD wrap-up window is anchored to the shift's scheduled end, which
  // must survive clock-out and the roll to tomorrow's shift. Resolve it for the
  // day itself; an overnight shift that ends on this date is covered by the
  // previous local date.
  const previousShiftDate = new Date(`${shiftDate}T12:00:00Z`);
  previousShiftDate.setUTCDate(previousShiftDate.getUTCDate() - 1);
  const dayShift = resolveShiftWindowForDate(rules, exceptions, shiftDate)
    ?? resolveShiftWindowForDate(rules, exceptions, previousShiftDate.toISOString().slice(0, 10));
  const ownerId = await ownerIdPromise;
  const latestTaskResult = await db().from("work_tasks")
    .select("updated_at")
    .eq("organization_id", access.organizationId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestTaskResult.error) throw new Error(`load task freshness: ${latestTaskResult.error.message}`);
  // Tasks are local now: the record's own last write is the freshness that
  // matters. Nifty is a read-only backup, never a refresh source.
  const localSavedAt = latestTaskResult.data?.updated_at as string | undefined;
  const niftySync: Json = {
    fresh: true,
    syncing: false,
    syncedAt: localSavedAt ?? null,
    authority: "work_os",
  };
  const [taskHistory, evidence, proposalsResult, reportResult, workspace] = await Promise.all([
    options.compact ? Promise.resolve([]) : listPersonTasks(ownerId, personId, { includeCompleted: true, includeLedgerHistory: true, limit: 50 }),
    options.compact ? Promise.resolve([]) : listEvidence(ownerId, { personId, date: shiftDate }),
    options.compact ? Promise.resolve({ data: [], error: null }) : db().from("work_task_proposals").select("*").eq("organization_id", access.organizationId).eq("person_id", personId).in("status", ["pending", "needs_review", "failed", "stale"]).order("created_at", { ascending: false }),
    db().from("work_reports").select(options.compact ? "submitted_at" : "*").eq("organization_id", access.organizationId).eq("person_id", personId).eq("report_date", shiftDate).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    resolveDailyWorkspace(access, shiftDate, { limit: options.compact ? 24 : 50, now: at }),
  ]);
  if (proposalsResult.error) throw new Error(`load task proposals: ${proposalsResult.error.message}`);
  if (reportResult.error) throw new Error(`load current EOD report: ${reportResult.error.message}`);
  const workday = await getWorkday(access, at);
  const taskRows = workspace.tasks;
  const historyRows = taskHistory ?? [];
  const evidenceRows = evidence ?? [];
  const signals = {
    employeeUpdates: 0,
    outputEvidence: evidenceRows.filter((item: any) => item.source !== "worktivity").length,
    activityContext: evidenceRows.filter((item: any) => item.source === "worktivity").length || (attendance.attendance.state === "active" || attendance.attendance.state === "paused" ? 1 : 0),
    completedTasks: historyRows.filter((item) => item.completed === true && dateOnly(item.completed_at) === shiftDate).length,
    openTasks: taskRows.filter((item) => item.completed !== true).length,
  };
  const workdayPrompt = suppressPromptForSubmittedEod(workday.prompt, reportResult.data?.submitted_at as string | null | undefined);
  return { at: at.toISOString(), shiftDate, shift, dayShift, prompt: workdayPrompt, session: workday.session, plan: workday.plan, attendance: attendance.attendance, breakPolicy: { worktivityAuthoritative: authoritativeBreaks }, niftySync, signals, tasks: workspace.tasks, taskHistory: taskHistory ?? [], workspaceSummary: workspace, evidence: evidenceRows, proposals: proposalsResult.data ?? [], report: reportResult.data };
}
