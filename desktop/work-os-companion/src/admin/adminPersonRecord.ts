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

/** One row per workday. Observed seconds are summed across the day's sessions,
 * the latest session owns the state, and the day's recap count comes from the
 * exact grouped count rather than from the visible recap list. */
export function buildPersonWorkdays(
  sessions: Array<Record<string, any>>,
  recapDays: PersonRecapDay[],
  limit = 6,
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
      const observedSeconds = entry.sessions.reduce((sum, session) => sum + (Number(session.observed_seconds ?? 0) || 0), 0);
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
