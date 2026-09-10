import {
  listEvidence,
  listPersonTasks,
  syncNifty,
  syncNiftyPersonTasks,
} from "@/lib/work-os";
import { localDateForTimezone, resolveShiftWindow } from "@/modules/work-os/companion";
import { getWorkday } from "@/lib/work-os-workday";
import { loadPersistedWorktivityAttendance, observeWorktivityAttendance } from "@/lib/work-os-attendance";
import { worktivityAuthoritativeBreaks } from "@/lib/work-os-policy";
import { resolveDailyWorkspace } from "@/lib/work-os-daily-workspace";
import { db, loadShiftData, organizationOwnerId, type Json } from "@/lib/work-os-internal";
import type { WorkOsAccess } from "@/lib/work-os-api";
import { suppressPromptForSubmittedEod } from "@/modules/work-os/workday";

const NIFTY_FRESH_MS = 5 * 60_000;
const niftyRefreshes = new Map<string, Promise<void>>();

async function recordNiftySyncError(organizationId: string, message: string) {
  try {
    await db().from("work_organizations").update({
      nifty_sync_error: message,
      updated_at: new Date().toISOString(),
    }).eq("id", organizationId);
  } catch (error) {
    console.error("[work-os] could not record Nifty sync error", { organizationId, error });
  }
}

/** Runs one provider refresh per organization at a time. Never awaited by a
 * request path: the dashboard renders current (truthful, timestamped) data and
 * the refresh lands in the background. */
function dedupedProviderRefresh(organizationId: string, run: () => Promise<unknown>) {
  const existing = niftyRefreshes.get(organizationId);
  if (existing) return existing;
  const refresh = (async () => {
    try {
      await run();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nifty sync failed";
      console.error("[work-os] background Nifty refresh failed", { organizationId, message });
      await recordNiftySyncError(organizationId, message);
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
  options: { refreshNifty?: boolean; refreshAttendance?: boolean; compact?: boolean } = {},
) {
  // External provider calls are started immediately but never block the
  // response: the dashboard renders current (timestamped, truthful) data and
  // the provider refresh lands in the background.
  const attendancePromise = options.refreshAttendance
    ? observeWorktivityAttendance(access, at)
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
  const shiftDate = localDateForTimezone(at, timezone);
  const ownerId = await ownerIdPromise;
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
  const effectiveLastSyncedAt = lastSyncedAt;
  const niftyFresh = !!effectiveLastSyncedAt && Date.now() - new Date(effectiveLastSyncedAt).getTime() < NIFTY_FRESH_MS;
  const providerRefreshRunning = niftyRefreshes.has(access.organizationId);
  if (options.refreshNifty) {
    // Explicit refresh: targeted person sync, then the full org mirror.
    void dedupedProviderRefresh(access.organizationId, async () => {
      await syncNiftyPersonTasks(ownerId, personId);
      await syncNifty(ownerId);
    }).catch(() => undefined);
  } else if (!niftyFresh) {
    void dedupedProviderRefresh(access.organizationId, () => syncNifty(ownerId)).catch(() => undefined);
  }
  const niftySync: Json = {
    fresh: niftyFresh,
    syncing: options.refreshNifty || providerRefreshRunning || !niftyFresh,
    syncedAt: effectiveLastSyncedAt ?? null,
    authority: "nifty",
    ...(organizationSyncResult.data.nifty_sync_error ? { error: organizationSyncResult.data.nifty_sync_error } : {}),
  };
  const [taskHistory, evidence, proposalsResult, reportResult, workspace] = await Promise.all([
    options.compact ? Promise.resolve([]) : listPersonTasks(ownerId, personId, { includeCompleted: true, includeLedgerHistory: true, limit: 100 }),
    options.compact ? Promise.resolve([]) : listEvidence(ownerId, { personId, date: shiftDate }),
    options.compact ? Promise.resolve({ data: [], error: null }) : db().from("work_task_proposals").select("*").eq("organization_id", access.organizationId).eq("person_id", personId).in("status", ["pending", "needs_review", "failed", "stale"]).order("created_at", { ascending: false }),
    db().from("work_reports").select(options.compact ? "submitted_at" : "*").eq("organization_id", access.organizationId).eq("person_id", personId).eq("report_date", shiftDate).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    resolveDailyWorkspace(access, shiftDate, { limit: options.compact ? 24 : 100, now: at }),
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
    completedTasks: historyRows.filter((item) => item.completed === true && String(item.completed_at ?? "").slice(0, 10) === shiftDate).length,
    openTasks: taskRows.filter((item) => item.completed !== true).length,
  };
  const workdayPrompt = suppressPromptForSubmittedEod(workday.prompt, reportResult.data?.submitted_at as string | null | undefined);
  return { at: at.toISOString(), shiftDate, shift, prompt: workdayPrompt, session: workday.session, plan: workday.plan, attendance: attendance.attendance, breakPolicy: { worktivityAuthoritative: authoritativeBreaks }, niftySync, signals, tasks: workspace.tasks, taskHistory: taskHistory ?? [], workspaceSummary: workspace, evidence: evidenceRows, proposals: proposalsResult.data ?? [], report: reportResult.data };
}
