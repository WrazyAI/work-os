import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db/pool";
import { readPayrollSourceToken } from "@/lib/work-os-payroll-freshness";
import { localDateForTimezone, resolveShiftWindowForDate, type WorkOsScheduleException, type WorkOsScheduleRule } from "@/modules/work-os/companion";
import { recapReviewSource } from "@/modules/work-os/recap-review";
import type {
  PayrollDayInput, PayrollPeriod, PayrollProviderInput, PayrollSourceManifest, PayrollScope,
  PayrollWeekSources, Span,
} from "@/modules/work-os/payroll/contracts";

const POLICY_VERSION = "payroll-sources-v1";
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

function stable(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return "null";
}
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");

/** Canonical source hash. Freshness tokens, observation time and raw-image
 * expiry are deliberately outside the calculation identity: an expired image
 * does not rewrite what the recap/activity evidence said. */
export function hashPayrollSources(manifest: PayrollSourceManifest): string {
  const calculation = { ...manifest } as Partial<PayrollSourceManifest>;
  delete calculation.hash;
  delete calculation.asOf;
  delete calculation.sourceToken;
  delete calculation.rawImageExpiry;
  return hash(calculation);
}

function instant(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function dateKey(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
  const match = typeof value === "string" ? value.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return match ? match[0] : null;
}
function addDays(date: string, days: number): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
function eachDate(from: string, through: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= through; date = addDays(date, 1)) dates.push(date);
  return dates;
}
function span(startMs: number | null, endMs: number | null): Span | null {
  return startMs !== null && endMs !== null && endMs > startMs ? { startMs, endMs } : null;
}
function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function breakWindows(value: unknown): { span: Span; source: string }[] {
  const list = Array.isArray(value) ? value : [];
  return list.flatMap((item) => {
    const row = jsonObject(item);
    if (typeof row.startsAt === "string" && typeof row.endsAt === "string") {
      const at = instant(row.startsAt);
      const end = instant(row.endsAt);
      return at !== null && end !== null && end > at ? [{ span: { startMs: at, endMs: end }, source: "scheduled" }] : [];
    }
    return [];
  });
}

type SessionRow = Record<string, unknown>;
type IntervalRow = Record<string, unknown>;

function dayWindow(rules: WorkOsScheduleRule[], exceptions: WorkOsScheduleException[], date: string) {
  return resolveShiftWindowForDate(rules, exceptions, date);
}

async function sessionBreaks(client: PoolClient, scope: PayrollScope, sessionIds: number[]): Promise<{ breaks: { span: Span; source: string }[]; residualMs: number }> {
  if (!sessionIds.length) return { breaks: [], residualMs: 0 };
  const { rows } = await client.query(`SELECT session_id,event_type,observed_at FROM work_session_events
    WHERE organization_id=$1 AND person_id=$2 AND session_id=ANY($3::int[])
      AND lower(event_type) IN ('pause','resume','paused','resumed')
    ORDER BY session_id, observed_at`, [scope.organizationId, scope.personId, sessionIds]);
  const open = new Map<number, number>();
  const breaks: { span: Span; source: string }[] = [];
  for (const row of rows as SessionRow[]) {
    const type = String(row.event_type).toLowerCase();
    const at = instant(row.observed_at);
    const sessionId = Number(row.session_id);
    if (at === null) continue;
    if (type === "pause" || type === "paused") open.set(sessionId, at);
    else {
      const start = open.get(sessionId);
      if (start !== undefined && at > start) breaks.push({ span: { startMs: start, endMs: at }, source: "session_pause" });
      open.delete(sessionId);
    }
  }
  return { breaks, residualMs: 0 };
}

export async function loadPayrollSources(scope: PayrollScope, period: PayrollPeriod, asOf: Date): Promise<PayrollSourceManifest> {
  if (!Number.isFinite(asOf.getTime())) throw new Error("Payroll source observation instant is invalid");
  const pool = getPool();
  const person = await pool.query(`SELECT p.timezone,
      coalesce((SELECT max(o.timezone) FROM work_employee_onboarding o
        WHERE o.organization_id=p.organization_id AND o.person_id=p.id), p.timezone, 'UTC') AS effective_timezone
    FROM work_people p WHERE p.organization_id=$1 AND p.id=$2`, [scope.organizationId, scope.personId]);
  if (!person.rows.length) throw new Error("Payroll person not found");
  const scheduleQuery = await pool.query(`SELECT * FROM work_schedules
    WHERE organization_id=$1 AND person_id=$2
      AND effective_from <= $3::date AND (effective_to IS NULL OR effective_to >= $4::date)
    ORDER BY effective_from DESC`, [scope.organizationId, scope.personId, period.through, period.from]);
  const exceptionQuery = await pool.query(`SELECT * FROM work_schedule_exceptions
    WHERE organization_id=$1 AND person_id=$2 AND exception_date BETWEEN $3::date AND $4::date`,
  [scope.organizationId, scope.personId, period.from, period.through]);
  const sessionQuery = await pool.query(`SELECT * FROM work_sessions
    WHERE organization_id=$1 AND person_id=$2 AND shift_date BETWEEN $3::date AND $4::date
    ORDER BY shift_date, clocked_in_at`, [scope.organizationId, scope.personId, period.from, period.through]);
  const intervalQuery = await pool.query<IntervalRow>(`SELECT i.*,
      (SELECT max(r.version)::int FROM work_recap_reviews r
        WHERE r.organization_id=i.organization_id AND r.interval_id=i.id) AS review_version
    FROM work_activity_intervals i
    WHERE i.organization_id=$1 AND i.person_id=$2 AND i.local_date::date BETWEEN $3::date AND $4::date
    ORDER BY i.local_date, i.window_start`, [scope.organizationId, scope.personId, period.from, period.through]);
  const rules = (scheduleQuery.rows as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    effective_from: dateKey(row.effective_from) ?? String(row.effective_from ?? ""),
    effective_to: dateKey(row.effective_to),
  })) as WorkOsScheduleRule[];
  const exceptions = (exceptionQuery.rows as Array<Record<string, unknown>>).map((row) => ({
    ...row,
    exception_date: dateKey(row.exception_date) ?? String(row.exception_date ?? ""),
  })) as WorkOsScheduleException[];
  const sessions = sessionQuery.rows as SessionRow[];
  const intervals = intervalQuery.rows;
  const sessionsByDate = new Map<string, SessionRow[]>();
  for (const session of sessions) {
    const date = dateKey(session.shift_date);
    if (!date) continue;
    sessionsByDate.set(date, [...(sessionsByDate.get(date) ?? []), session]);
  }
  const intervalsByDate = new Map<string, IntervalRow[]>();
  for (const interval of intervals) {
    const date = dateKey(interval.local_date);
    if (!date) continue;
    intervalsByDate.set(date, [...(intervalsByDate.get(date) ?? []), interval]);
  }
  const sessionIds = sessions.map((session) => Number(session.id)).filter((id) => Number.isFinite(id));
  const pauses = await sessionBreaks(pool as unknown as PoolClient, scope, sessionIds);
  const days: PayrollDayInput[] = [];
  for (const date of eachDate(period.from, period.through)) {
    const window = dayWindow(rules, exceptions, date);
    const exception = exceptions.find((item) => dateKey(item.exception_date) === date);
    const daySessions = sessionsByDate.get(date) ?? [];
    const dayIntervals = intervalsByDate.get(date) ?? [];
    if (!window && !daySessions.length && !dayIntervals.length) continue;
    if (exception?.kind === "leave" && !daySessions.length && !dayIntervals.length) continue;
    const blockers: string[] = [];
    if (!window && (daySessions.length || dayIntervals.length)) blockers.push("No eligible schedule is available for recorded work");
    if (exception?.kind === "leave" && daySessions.length) blockers.push("Leave day has recorded work");
    if (rules.some((rule) => rule.arrangement === "flexible" && (dateKey(rule.effective_from) ?? "") <= date && (!rule.effective_to || (dateKey(rule.effective_to) ?? "") >= date))) {
      blockers.push("Flexible work arrangement has no fixed payroll window");
    }
    const breaks: { span: Span; source: string }[] = [...breakWindows(window?.breaks)];
    let pauseResidualMs = 0;
    const normalizedSessions: PayrollDayInput["sessions"] = [];
    for (const session of daySessions) {
      const starts = instant(session.scheduled_starts_at);
      const ends = instant(session.scheduled_ends_at);
      const windowStart = window ? instant(window.startsAt) : null;
      const windowEnd = window ? instant(window.endsAt) : null;
      if (starts !== null && ends !== null && windowStart !== null && windowEnd !== null && (starts !== windowStart || ends !== windowEnd)) {
        blockers.push("Session schedule stamp conflicts with the historical schedule; correct the attendance record");
      }
      const clockedIn = instant(session.clocked_in_at);
      const clockedOut = instant(session.clocked_out_at);
      const recorded = span(clockedIn, clockedOut ?? (clockedOut === null && clockedIn !== null ? asOf.getTime() : null));
      const eligible = starts !== null && ends !== null ? span(starts, ends + 60 * 60_000)
        : window ? { startMs: instant(window.startsAt)!, endMs: instant(window.endsAt)! + 60 * 60_000 } : null;
      if (!session.clocked_out_at && clockedIn !== null) blockers.push("Open session requires clock-out or correction");
      if (session.correction_status && String(session.correction_status) !== "original") {
        blockers.push("Session correction is not reconciled into the payroll source");
      }
      normalizedSessions.push({
        id: String(session.id), recorded, eligible, closed: !!session.clocked_out_at,
        scheduleSource: session.schedule_id ? "session_stamp" : window ? "historical_schedule" : "none",
        correctionStatus: String(session.correction_status ?? "original"),
      });
      const providerBreakMs = Math.max(0, Number(session.provider_break_seconds ?? 0)) * 1000;
      const sessionPauses = pauses.breaks.filter((item) => !recorded || (item.span.startMs >= recorded.startMs && item.span.endMs <= recorded.endMs));
      pauseResidualMs += Math.max(0, providerBreakMs - sessionPauses.reduce((sum, item) => sum + item.span.endMs - item.span.startMs, 0));
    }
    breaks.push(...pauses.breaks);
    const base = { date, window, sessions: normalizedSessions, breaks, pauseResidualMs, blockers, intervalIds: dayIntervals.map((row) => String(row.id)) };
    days.push({
      scope, date, week: date <= period.weeks[0].through ? 1 : 2, timezone: period.timezone,
      sessions: normalizedSessions, breaks, pauseResidualMs, captures: [], exceptions: [], frameSignals: [],
      frameCandidates: [], blockers, sourceHash: hash(base),
    });
  }

  const weekRows = [1, 2].map((week) => {
    const definition = period.weeks[week - 1];
    const rows = intervals.filter((row) => {
      const date = dateKey(row.local_date);
      return date !== null && date >= definition.from && date <= definition.through;
    });
    const recaps: PayrollWeekSources["recaps"] = rows.flatMap((row) => {
      const detail = String(row.final_detail ?? row.ai_detail ?? "");
      if (!detail.trim()) return [];
      const source = recapReviewSource(row.review_status, row.review_source);
      const reviewVersion = Math.max(0, Number(row.review_version ?? 0));
      return [{
        id: String(row.id), revision: Math.max(1, Number(row.revision ?? 1)), reviewVersion,
        reviewSource: source, headline: String(row.headline ?? ""), detail,
        citations: [{ type: "interval" as const, id: String(row.id), revision: reviewVersion }],
      }];
    });
    return {
      scope, week: week as 1 | 2, from: definition.from, through: definition.through,
      sourceHash: hash(rows.map((row) => ({ id: row.id, revision: row.revision, reviewVersion: row.review_version, source: row.review_source, status: row.review_status, detail: row.final_detail ?? row.ai_detail }))),
      recaps, outcomes: [], gaps: recaps.length ? [] : ["No recap text is available for this week."],
    };
  });
  const weekSources: [PayrollWeekSources, PayrollWeekSources] = [weekRows[0], weekRows[1]];

  const rawImageQuery = await pool.query(`SELECT id,expires_at FROM work_screenshot_summaries
    WHERE organization_id=$1 AND person_id=$2`, [scope.organizationId, scope.personId]);
  const rawImageExpiry = Object.fromEntries((rawImageQuery.rows as Array<Record<string, unknown>>)
    .map((row) => [String(row.id), row.expires_at instanceof Date ? row.expires_at.toISOString() : row.expires_at ? String(row.expires_at) : null]));
  const manifest: PayrollSourceManifest = {
    scope, period, asOf: asOf.toISOString(), sourceToken: await readPayrollSourceToken(scope),
    policyVersion: POLICY_VERSION, days, weekSources, hash: "", rawImageExpiry,
  };
  manifest.hash = hashPayrollSources(manifest);
  return manifest;
}

/** Attach provider observations to their shift day. A capture inside a session
 * belongs to that session's shift_date; otherwise it follows the employee-local
 * date. Provider rows outside the period are dropped. */
export function buildPayrollDayInputs(manifest: PayrollSourceManifest, provider: PayrollProviderInput): PayrollDayInput[] {
  const days = manifest.days.map((day) => ({ ...day, captures: [] as PayrollDayInput["captures"] }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  for (const capture of provider.logs) {
    const at = capture.span ? capture.span.startMs : Date.parse(capture.capturedAt);
    if (!Number.isFinite(at)) continue;
    let target = days.find((day) => day.sessions.some((session) =>
      (session.recorded && at >= session.recorded.startMs && at < session.recorded.endMs)
      || (session.eligible && at >= session.eligible.startMs && at < session.eligible.endMs)));
    if (!target) target = byDate.get(localDateForTimezone(new Date(at), manifest.period.timezone));
    if (!target) continue;
    target.captures.push(capture);
  }
  return days.map((day) => ({
    ...day,
    blockers: provider.complete ? day.blockers : [...day.blockers, "Provider paging is incomplete; payroll publication is blocked"],
    captures: day.captures.sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id)),
    sourceHash: hash({ base: day.sourceHash, provider: provider.watermark, captureIds: day.captures.map((capture) => capture.id) }),
  }));
}

export { ZERO_UUID as PAYROLL_ZERO_UUID };
