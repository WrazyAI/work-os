// Worktivity audit engine — Layer 1 (metadata, no vision).
//
// Pulls a worker's ActivityLogs for a date range, collapses them into work
// sessions, and computes a metadata rollup that answers ~70% of "what did this
// person do" for ~$0 — before any screenshot is looked at. The rollup is what we
// hand to the Codex orchestrator for the narrative summary, and the same
// `representativeLogId` per session is what Layer 2 will sample for vision.
//
// Pure functions (sessionize/buildRollup) + one IO function (fetchAllLogs).

import { wtPost, type WtPaged, type WtActivityLog } from "./worktivity";
import type { AuditWindow, WorkSession, WorktivityRollup } from "./worktivityAuditTypes";
import { normalizeActivityLevel } from "./worktivityScreenshotRuns";

// Re-export so existing importers of this module keep working.
export type { AuditWindow, WorkSession, WorktivityRollup } from "./worktivityAuditTypes";

// Best-effort Worktivity productivity enum (same caveat as the UI — confirm via
// Definition/ListEnums before trusting the labels for pay decisions).
export const PRODUCTIVITY_LABELS: Record<number, string> = {
  1: "productive",
  2: "neutral",
  3: "unproductive",
};

const IDLE_ACTIVITY = 5;        // ≤ this counts as idle
const DEAD_RUN_MINUTES = 20;    // a run of idle logs this long is a "dead stretch"

const ts = (iso: string) => new Date(iso).getTime();
const minutesBetween = (aIso: string, bIso: string) => Math.abs(ts(bIso) - ts(aIso)) / 60000;
const dayOf = (iso: string) => iso.slice(0, 10);

function appLabel(l: WtActivityLog): string {
  return (l.Url || l.Title || "unknown").toLowerCase();
}

/** Median gap between consecutive logs → the screenshot cadence (robust to outliers/gaps). */
export function inferCadenceMinutes(sorted: WtActivityLog[]): number {
  if (sorted.length < 2) return 5; // sane default
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const g = minutesBetween(sorted[i - 1].CreateDate, sorted[i].CreateDate);
    if (g > 0 && g <= 30) gaps.push(g); // ignore overnight/clock-out gaps
  }
  if (gaps.length === 0) return 5;
  gaps.sort((a, b) => a - b);
  const med = gaps[Math.floor(gaps.length / 2)];
  return Math.min(15, Math.max(1, Math.round(med)));
}

/** Collapse consecutive same-app logs (with no big time gap) into work sessions. */
export function sessionize(logs: WtActivityLog[], cadenceMin: number): WorkSession[] {
  const sorted = [...logs].sort((a, b) => ts(a.CreateDate) - ts(b.CreateDate));
  const gapBreak = Math.max(cadenceMin * 2.5, cadenceMin + 5); // minutes
  const out: WorkSession[] = [];
  let cur: WtActivityLog[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    const first = cur[0];
    const last = cur[cur.length - 1];
    const span = minutesBetween(first.CreateDate, last.CreateDate);
    const activitySum = cur.reduce((s, l) => s + (l.ActivityLevel || 0), 0);
    // dominant productivity = the enum with the most logs
    const counts = new Map<number, number>();
    for (const l of cur) if (l.Productivity != null) counts.set(l.Productivity, (counts.get(l.Productivity) ?? 0) + 1);
    let dom: number | null = null, best = -1;
    for (const [k, v] of counts) if (v > best) { best = v; dom = k; }
    // representative frame = highest-activity log (most likely to show real work)
    const rep = cur.reduce((a, b) => (b.ActivityLevel > a.ActivityLevel ? b : a), cur[0]);
    out.push({
      app: appLabel(first),
      startIso: first.CreateDate,
      endIso: last.CreateDate,
      minutes: Math.round(span + cadenceMin), // +1 cadence so a single-log session ≈ cadence
      logCount: cur.length,
      screenshots: cur.reduce((s, l) => s + (l.ScreenCount || 0), 0),
      avgActivity: normalizeActivityLevel(activitySum / cur.length),
      productivity: dom,
      representativeLogId: rep.ID,
    });
    cur = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    if (cur.length === 0) { cur.push(l); continue; }
    const prev = cur[cur.length - 1];
    const gap = minutesBetween(prev.CreateDate, l.CreateDate);
    if (appLabel(l) === appLabel(prev) && gap <= gapBreak) cur.push(l);
    else { flush(); cur.push(l); }
  }
  flush();
  return out;
}

/** Build the full metadata rollup from a worker's logs. */
export function buildRollup(logs: WtActivityLog[], win: AuditWindow): WorktivityRollup {
  const sorted = [...logs].sort((a, b) => ts(a.CreateDate) - ts(b.CreateDate));
  const cadence = inferCadenceMinutes(sorted);
  const sessions = sessionize(sorted, cadence);

  // Time is measured in distinct cadence-sized buckets, NOT raw log count — a single
  // capture can emit several logs (multi-app / multi-screen) in the same minute, and
  // counting each as a full cadence would inflate the worked-hours number.
  const bucketMs = cadence * 60_000;
  const bucketOf = (l: WtActivityLog) => Math.floor(ts(l.CreateDate) / bucketMs);

  // Per-bucket aggregates: max activity (was anyone working this minute?) + dominant app/productivity/status.
  const bucketMax = new Map<number, number>();          // bucket → max activity
  const bucketApps = new Map<string, Set<number>>();    // app → set of buckets
  const bucketProd = new Map<number, Map<number, number>>(); // bucket → (prodEnum → logCount)
  const bucketStatus = new Map<number, Map<number, number>>(); // bucket → (EmployeeActivityLogStatus → logCount)
  for (const l of sorted) {
    const b = bucketOf(l);
    bucketMax.set(b, Math.max(bucketMax.get(b) ?? 0, l.ActivityLevel || 0));
    const app = appLabel(l);
    (bucketApps.get(app) ?? bucketApps.set(app, new Set()).get(app)!).add(b);
    const k = l.Productivity ?? -1;
    const pm = bucketProd.get(b) ?? bucketProd.set(b, new Map()).get(b)!;
    pm.set(k, (pm.get(k) ?? 0) + 1);
    const sm = bucketStatus.get(b) ?? bucketStatus.set(b, new Map()).get(b)!;
    sm.set(l.Status, (sm.get(l.Status) ?? 0) + 1);
  }

  // A bucket is a "break" bucket when its dominant Worktivity status is OnBreak (2).
  const STATUS_ONBREAK = 2;
  const isBreakBucket = (b: number) => {
    const sm = bucketStatus.get(b); if (!sm) return false;
    let dom = -1, best = -1;
    for (const [k, v] of sm) if (v > best) { best = v; dom = k; }
    return dom === STATUS_ONBREAK;
  };

  const trackedBuckets = bucketMax.size;
  const trackedMinutes = trackedBuckets * cadence;
  const breakBuckets = [...bucketMax.keys()].filter(isBreakBucket).length;
  const breakMinutes = breakBuckets * cadence;
  // Active/idle are computed on NON-break time so a break isn't miscounted as idle.
  const activeBuckets = [...bucketMax.entries()].filter(([b, a]) => a > IDLE_ACTIVITY && !isBreakBucket(b)).length;
  const activeMinutes = activeBuckets * cadence;
  const idleMinutes = Math.max(0, trackedMinutes - activeMinutes - breakMinutes);
  const avgActivity = sorted.length
    ? normalizeActivityLevel(sorted.reduce((s, l) => s + (l.ActivityLevel || 0), 0) / sorted.length)
    : 0;

  // productivity split (by bucket's dominant enum → minutes)
  const prodBuckets = new Map<number, number>();
  for (const pm of bucketProd.values()) {
    let dom = -1, best = -1;
    for (const [k, v] of pm) if (v > best) { best = v; dom = k; }
    prodBuckets.set(dom, (prodBuckets.get(dom) ?? 0) + 1);
  }
  const productivitySplit = [...prodBuckets.entries()]
    .map(([k, buckets]) => ({
      label: k === -1 ? "unrated" : (PRODUCTIVITY_LABELS[k] ?? `enum:${k}`),
      enum: k === -1 ? null : k,
      minutes: buckets * cadence,
      pct: trackedBuckets ? Math.round((buckets / trackedBuckets) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  // top apps (by distinct buckets the app appears in)
  const appActivity = new Map<string, { act: number; n: number }>();
  for (const l of sorted) {
    const a = appActivity.get(appLabel(l)) ?? { act: 0, n: 0 };
    a.act += l.ActivityLevel || 0; a.n += 1;
    appActivity.set(appLabel(l), a);
  }
  const topApps = [...bucketApps.entries()]
    .map(([app, buckets]) => ({
      app,
      minutes: buckets.size * cadence,
      pct: trackedBuckets ? Math.round((buckets.size / trackedBuckets) * 100) : 0,
      avgActivity: normalizeActivityLevel((appActivity.get(app)?.act ?? 0) / (appActivity.get(app)?.n ?? 1)),
    }))
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 12);

  // dead stretches: consecutive idle logs spanning ≥ DEAD_RUN_MINUTES
  const deadStretches: WorktivityRollup["deadStretches"] = [];
  let runStart: WtActivityLog | null = null, runPrev: WtActivityLog | null = null;
  const closeRun = () => {
    if (runStart && runPrev) {
      const m = minutesBetween(runStart.CreateDate, runPrev.CreateDate) + cadence;
      if (m >= DEAD_RUN_MINUTES) deadStretches.push({ startIso: runStart.CreateDate, endIso: runPrev.CreateDate, minutes: Math.round(m) });
    }
    runStart = runPrev = null;
  };
  for (const l of sorted) {
    const idle = (l.ActivityLevel || 0) <= IDLE_ACTIVITY;
    const contiguous = runPrev ? minutesBetween(runPrev.CreateDate, l.CreateDate) <= cadence * 2.5 : true;
    if (idle && (runStart === null || contiguous)) { if (!runStart) runStart = l; runPrev = l; }
    else closeRun();
  }
  closeRun();

  // per-day (tracked time = distinct buckets that day, so it matches the totals)
  const dayAgg = new Map<string, { buckets: Set<number>; act: number; n: number; sess: number }>();
  for (const l of sorted) {
    const d = dayOf(l.CreateDate);
    const a = dayAgg.get(d) ?? { buckets: new Set<number>(), act: 0, n: 0, sess: 0 };
    a.buckets.add(bucketOf(l)); a.act += (l.ActivityLevel || 0); a.n += 1;
    dayAgg.set(d, a);
  }
  for (const s of sessions) {
    const d = dayOf(s.startIso);
    const a = dayAgg.get(d); if (a) a.sess += 1;
  }
  const perDay = [...dayAgg.entries()]
    .map(([date, a]) => ({ date, trackedMinutes: a.buckets.size * cadence, avgActivity: normalizeActivityLevel(a.act / a.n), sessions: a.sess }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    employeeId: win.employeeId,
    range: { start: win.start, end: win.end },
    generatedAt: new Date().toISOString(),
    cadenceMinutes: cadence,
    totals: {
      logs: sorted.length,
      screenshots: sorted.reduce((s, l) => s + (l.ScreenCount || 0), 0),
      trackedMinutes,
      activeMinutes,
      idleMinutes,
      breakMinutes,
      avgActivity,
      activeDays: perDay.length,
    },
    productivitySplit,
    topApps,
    deadStretches: deadStretches.sort((a, b) => b.minutes - a.minutes).slice(0, 15),
    sessions,
    perDay,
  };
}

/**
 * Page through ALL ActivityLogs for one employee in a date range.
 * Filters by EmployeeId (the only field Worktivity honours — see worktivity.ts).
 * Gently paced (≤5 req/s limit). `onProgress` lets the runner stream "pulled N/M".
 */
export async function fetchAllLogs(
  win: AuditWindow,
  onProgress?: (pulled: number, total: number) => void,
): Promise<WtActivityLog[]> {
  const pageSize = 100;
  const body = (page: number) => ({
    startDate: `${win.start}T00:00:00Z`,
    endDate: `${win.end}T23:59:59Z`,
    EmployeeId: win.employeeId,
    page,
    pageSize,
  });

  const first = await wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", body(1));
  const all: WtActivityLog[] = [...(first.Items ?? [])];
  const pageCount = first.PageCount ?? 1;
  onProgress?.(all.length, first.TotalCount ?? all.length);

  for (let p = 2; p <= pageCount; p++) {
    await new Promise((r) => setTimeout(r, 300)); // leave headroom under the shared 5 req/s limit
    const pg = await wtPost<WtPaged<WtActivityLog>>("/ActivityLogs/List", body(p));
    all.push(...(pg.Items ?? []));
    onProgress?.(all.length, first.TotalCount ?? all.length);
  }
  // The provider has historically returned cross-employee duplicates at page
  // boundaries. Never let those affect attendance or screenshot processing.
  const deduped = new Map<string, WtActivityLog>();
  for (const log of all) {
    if (log.EmployeeId !== win.employeeId || !log.ID) continue;
    deduped.set(log.ID, log);
  }
  return [...deduped.values()].sort((left, right) => left.CreateDate.localeCompare(right.CreateDate));
}

// Real app/site usage with names, icons and AI categories — Insights/AppsSummary
// resolves what ActivityLogs.Url leaves as "unknown" (desktop apps have no URL).
export interface AppUsage { name: string; category: string | null; icon: string | null; minutes: number; productivity: number | null }
interface WtAppsSummaryItem {
  Working?: number; Idle?: number; Productivity?: number | null;
  OrganizationApp?: { ActivityApp?: { Name?: string | null; Icon?: string | null; AICategory?: string | null; Url?: string | null } | null } | null;
}
export async function fetchAppsSummary(opts: { employeeId?: string; start: string; end: string }): Promise<AppUsage[]> {
  const body: Record<string, unknown> = { startDate: `${opts.start}T00:00:00Z`, endDate: `${opts.end}T23:59:59Z`, page: 1, pageSize: 100 };
  if (opts.employeeId) body.EmployeeId = opts.employeeId; // omitted → org-wide
  const data = await wtPost<WtPaged<WtAppsSummaryItem>>("/Insights/AppsSummary", body);
  return (data.Items ?? [])
    .map((i) => {
      const aa = i.OrganizationApp?.ActivityApp ?? {};
      return { name: aa.Name || aa.Url || "unknown", category: aa.AICategory ?? null, icon: aa.Icon ?? null, minutes: Math.round((i.Working ?? 0) + (i.Idle ?? 0)), productivity: i.Productivity ?? null };
    })
    .filter((a) => a.minutes > 0 && a.name !== "unknown")
    .sort((a, b) => b.minutes - a.minutes);
}

/** Convenience: pull + rollup in one call. */
export async function runMetadataAudit(
  win: AuditWindow,
  onProgress?: (pulled: number, total: number) => void,
): Promise<WorktivityRollup> {
  const logs = await fetchAllLogs(win, onProgress);
  return buildRollup(logs, win);
}
