/** The person drawer's record view.
 *
 * The API returns sessions (one row per work interval) and recap counts (one
 * row per local workday). The drawer reads a workday, not a session, so this
 * seam owns the grouping, the observed-time sum, and the one report a day
 * should open. Keeping it here keeps the renderer from inventing a second set
 * of rules for "today" and "recent workdays". */

export interface PersonRecapDay {
  date: string;
  total: number;
  reviewed: number;
}

export interface PersonWorkday {
  date: string;
  state: string;
  observedSeconds: number;
  recapCount: number;
  recapReviewed: number;
}

/** Recorded calendar dates arrive as plain dates, or as instants at UTC
 * midnight. Both keep the calendar day the record holds. */
export function recordDate(value: unknown): string {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString().slice(0, 10) : "";
  }
  const text = String(value ?? "").trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match?.[1] ?? "";
}

function sessionStart(session: Record<string, any>): number {
  return Date.parse(String(session.clocked_in_at ?? "")) || 0;
}

/** A session's observed time.
 *
 * Current servers send `observed_seconds`. Older responses (the live
 * administration route before the workday fields landed) send only the clock
 * boundaries and the paused total, so the drawer derives the same reading
 * instead of printing an empty dash forever. A session with no usable start
 * stays at zero rather than inventing time. */
export function observedSecondsOfSession(session: Record<string, any>, now = Date.now()): number {
  const recorded = Number(session.observed_seconds);
  if (Number.isFinite(recorded) && recorded > 0) return Math.max(0, Math.round(recorded));
  const start = Date.parse(String(session.clocked_in_at ?? ""));
  if (!Number.isFinite(start) || start <= 0) return 0;
  const closed = Date.parse(String(session.clocked_out_at ?? ""));
  const end = Number.isFinite(closed) && closed > 0 ? closed : now;
  const paused = Math.max(0, Number(session.paused_seconds ?? 0) || 0);
  return Math.max(0, Math.round((end - start) / 1000 - paused));
}

/** Ready recap counts by recorded local day. A server that predates
 * `recapDays` still returns the ready intervals, so the drawer counts those
 * instead of showing every workday as zero updates. */
export function recapDaysFromIntervals(intervals: Array<Record<string, any>>): PersonRecapDay[] {
  const byDate = new Map<string, { total: number; reviewed: number }>();
  for (const interval of intervals) {
    if (String(interval.generation_status ?? "ready") !== "ready") continue;
    const date = recordDate(interval.local_date);
    if (!date) continue;
    const entry = byDate.get(date) ?? { total: 0, reviewed: 0 };
    entry.total += 1;
    if (["confirmed", "amended"].includes(String(interval.review_status ?? ""))) entry.reviewed += 1;
    byDate.set(date, entry);
  }
  return [...byDate.entries()].map(([date, counts]) => ({ date, ...counts }));
}

/** One row per workday. Observed seconds are summed across the day's sessions,
 * the latest session owns the state, and the day's recap count comes from the
 * exact grouped count rather than from the visible recap list. */
export function buildPersonWorkdays(
  sessions: Array<Record<string, any>>,
  recapDays: PersonRecapDay[],
  limit = 6,
  now = Date.now(),
): PersonWorkday[] {
  const byDate = new Map<string, {
    sessions: Array<Record<string, any>>;
    recapCount: number;
    recapReviewed: number;
  }>();

  for (const session of sessions) {
    const date = recordDate(session.shift_date);
    if (!date) continue;
    const entry = byDate.get(date) ?? { sessions: [], recapCount: 0, recapReviewed: 0 };
    entry.sessions.push(session);
    byDate.set(date, entry);
  }

  for (const day of recapDays) {
    const date = recordDate(day.date);
    if (!date) continue;
    const entry = byDate.get(date) ?? { sessions: [], recapCount: 0, recapReviewed: 0 };
    entry.recapCount += Number(day.total ?? 0) || 0;
    entry.recapReviewed += Number(day.reviewed ?? 0) || 0;
    byDate.set(date, entry);
  }

  return [...byDate.entries()]
    .map(([date, entry]) => {
      const latest = [...entry.sessions].sort((left, right) => sessionStart(right) - sessionStart(left))[0];
      const observedSeconds = entry.sessions.reduce((sum, session) => sum + observedSecondsOfSession(session, now), 0);
      return {
        date,
        state: String(latest?.state ?? "unknown"),
        observedSeconds: Math.max(0, Math.round(observedSeconds)),
        recapCount: entry.recapCount,
        recapReviewed: entry.recapReviewed,
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, limit);
}

/** Ready interval recaps whose recorded local date is the requested day. */
export function recapsForDay(intervals: Array<Record<string, any>>, date: string): Array<Record<string, any>> {
  return intervals.filter((interval) => (
    recordDate(interval.local_date) === date
    && String(interval.generation_status ?? "ready") === "ready"
  ));
}

const REPORT_RANK: Record<string, number> = {
  approved: 4,
  pending_review: 3,
  rejected: 2,
  draft: 1,
};

/** The day's report to open: the furthest-along record when more than one was
 * written for the same date, then the most recently submitted. */
export function reportForDay(reports: Array<Record<string, any>>, date: string): Record<string, any> | null {
  return reports
    .filter((report) => recordDate(report.report_date) === date)
    .sort((left, right) => {
      const rank = (REPORT_RANK[String(right.status ?? "")] ?? 0) - (REPORT_RANK[String(left.status ?? "")] ?? 0);
      if (rank) return rank;
      return (Date.parse(String(right.submitted_at ?? "")) || 0) - (Date.parse(String(left.submitted_at ?? "")) || 0);
    })[0] ?? null;
}

export function recapReviewLabel(status: unknown): string {
  if (status === "confirmed") return "Confirmed";
  if (status === "amended") return "Updated";
  return "Not reviewed";
}
