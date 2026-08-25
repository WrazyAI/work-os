import {
  listEvidence,
  listPersonTasks,
  syncNifty,
  syncNiftyPersonTasks,
} from "@/lib/work-os";
import {
  decideWorkOsPrompt,
  localDateForTimezone,
  resolveShiftWindow,
  type WorkOsCheckInState,
} from "@/modules/work-os/companion";
import { getWorkday } from "@/lib/work-os-workday";
import { observeWorktivityAttendance } from "@/lib/work-os-attendance";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";
import { db, loadShiftData, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";

const NIFTY_FRESH_MS = 5 * 60_000;
const niftyRefreshes = new Map<string, Promise<void>>();

function refreshNiftyMirror(organizationId: string, ownerId: string) {
  const existing = niftyRefreshes.get(organizationId);
  if (existing) return existing;
  const refresh = (async () => {
    try {
      await syncNifty(ownerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nifty sync failed";
      console.error("[work-os] background Nifty refresh failed", { organizationId, message });
      await db().from("work_organizations").update({
        nifty_sync_error: message,
        updated_at: new Date().toISOString(),
      }).eq("id", organizationId);
      throw error;
    } finally {
      niftyRefreshes.delete(organizationId);
    }
  })();
  niftyRefreshes.set(organizationId, refresh);
  return refresh;
}

export async function getWorkOsDay(
  access: WorkOsAccess,
  personId: string,
  at = new Date(),
  options: { refreshNifty?: boolean } = {},
) {
  const [attendance, authoritativeBreaks] = await Promise.all([
    observeWorktivityAttendance(access, at),
    worktivityAuthoritativeBreaks(access.organizationId),
  ]);
  const { rules, exceptions, timezone } = await loadShiftData(access, personId, at);
  const shift = resolveShiftWindow(rules, exceptions, at);
  // Upcoming-shift display must not advance task/history attribution into the
  // next day after the current shift ends.
  const shiftDate = localDateForTimezone(at, timezone);
  const { data: checkIns, error: checkInError } = await db()
    .from("work_check_ins")
    .select("substantive, confirmed_existing_tasks, occurred_at, snoozed_until")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .eq("shift_date", shiftDate)
    .order("occurred_at", { ascending: true });
  if (checkInError) throw new Error(`load shift check-ins: ${checkInError.message}`);
  const prompt = decideWorkOsPrompt(shift, (checkIns ?? []) as WorkOsCheckInState[], at);
  const ownerId = await organizationOwnerId(access.organizationId);
  const [latestTaskResult, latestProjectResult, organizationSyncResult] = await Promise.all([
    db().from("work_tasks").select("synced_at").eq("organization_id", access.organizationId).order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("work_projects").select("synced_at").eq("organization_id", access.organizationId).order("synced_at", { ascending: false }).limit(1).maybeSingle(),
    db().from("work_organizations").select("nifty_synced_at,nifty_sync_error").eq("id", access.organizationId).single(),
  ]);
  if (latestTaskResult.error) throw new Error(`load Nifty task freshness: ${latestTaskResult.error.message}`);
  if (latestProjectResult.error) throw new Error(`load Nifty project freshness: ${latestProjectResult.error.message}`);
  if (organizationSyncResult.error) throw new Error(`load Nifty organization freshness: ${organizationSyncResult.error.message}`);
  const latestTask = latestTaskResult.data;
  const latestProject = latestProjectResult.data;
  const lastSyncedAt = [latestTask?.synced_at, latestProject?.synced_at, organizationSyncResult.data.nifty_synced_at].filter(Boolean).sort().at(-1) as string | undefined;
  let effectiveLastSyncedAt = lastSyncedAt;
  let niftyFresh = !!effectiveLastSyncedAt && Date.now() - new Date(effectiveLastSyncedAt).getTime() < NIFTY_FRESH_MS;
  if (options.refreshNifty) {
    const refreshed = await syncNiftyPersonTasks(ownerId, personId);
    effectiveLastSyncedAt = refreshed.syncedAt;
    niftyFresh = true;
    void refreshNiftyMirror(access.organizationId, ownerId).catch(() => undefined);
  } else if (!niftyFresh) {
    void refreshNiftyMirror(access.organizationId, ownerId).catch(() => undefined);
  }
  const niftySync: Json = {
    fresh: niftyFresh,
    syncing: !niftyFresh && !options.refreshNifty,
    syncedAt: effectiveLastSyncedAt ?? null,
    authority: "nifty",
    ...(!options.refreshNifty && organizationSyncResult.data.nifty_sync_error ? { error: organizationSyncResult.data.nifty_sync_error } : {}),
  };
  const [tasks, taskHistory, evidence] = await Promise.all([
    listPersonTasks(ownerId, personId, { todayOnly: true, todayDate: shiftDate, limit: 1000 }),
    listPersonTasks(ownerId, personId, { includeCompleted: true, includeLedgerHistory: true, limit: 100 }),
    listEvidence(ownerId, { personId, date: shiftDate }),
  ]);
  const { data: proposals, error: proposalError } = await db()
    .from("work_task_proposals")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .in("status", ["pending", "needs_review", "failed", "stale"])
    .order("created_at", { ascending: false });
  if (proposalError) throw new Error(`load task proposals: ${proposalError.message}`);
  const { data: report, error: reportError } = await db()
    .from("work_reports")
    .select("*")
    .eq("organization_id", access.organizationId)
    .eq("person_id", personId)
    .eq("report_date", shiftDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reportError) throw new Error(`load current EOD report: ${reportError.message}`);
  const workday = await getWorkday(access, at);
  const workspace = await resolveDailyWorkspace(access, shiftDate, { limit: 100, now: at });
  const taskRows = tasks ?? [];
  const historyRows = taskHistory ?? [];
  const evidenceRows = evidence ?? [];
  const signals = {
    employeeUpdates: (checkIns ?? []).filter((item) => item.substantive === true).length,
    outputEvidence: evidenceRows.filter((item) => item.source !== "worktivity").length,
    activityContext: evidenceRows.filter((item) => item.source === "worktivity").length || (attendance.attendance.state === "active" || attendance.attendance.state === "paused" ? 1 : 0),
    completedTasks: historyRows.filter((item) => item.completed === true && String(item.completed_at ?? "").slice(0, 10) === shiftDate).length,
    openTasks: taskRows.filter((item) => item.completed !== true).length,
  };
  return { at: at.toISOString(), shiftDate, shift, prompt: workday.session ? workday.prompt : prompt, session: workday.session, plan: workday.plan, attendance: attendance.attendance, breakPolicy: { worktivityAuthoritative: authoritativeBreaks }, niftySync, signals, tasks: workspace.tasks, taskHistory: taskHistory ?? [], workspaceSummary: workspace, evidence: evidenceRows, proposals: proposals ?? [], report };
}
