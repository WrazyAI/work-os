import { dateOnly } from "@/lib/work-os-internal";

type Json = Record<string, any>;

export interface AdminTimeSeriesPerson {
  personId: string;
  name: string;
  minutes: number;
}

export interface AdminTimeSeriesPoint {
  date: string;
  totalMinutes: number;
  people: AdminTimeSeriesPerson[];
}

/** Observed seconds for one session: clock-in to clock-out (or `now` while the
 * session is still open), minus recorded pauses, never negative. */
export function observedSecondsForSession(session: Json, now: Date): number {
  const start = Date.parse(String(session.clocked_in_at ?? ""));
  if (!Number.isFinite(start)) return 0;
  const rawEnd = session.clocked_out_at ? Date.parse(String(session.clocked_out_at)) : now.getTime();
  if (!Number.isFinite(rawEnd)) return 0;
  const paused = Number(session.paused_seconds ?? 0) || 0;
  return Math.max(0, Math.round((rawEnd - start) / 1000) - paused);
}

/** Buckets observed session time into one point per day and teammate for the
 * stacked time chart. `shift_date` is normalized with the canonical `dateOnly`
 * helper because pg returns DATE columns as JS Date objects (never string
 * slicing); sessions outside `dates` are ignored, minutes are whole numbers,
 * and each day lists its people strongest first. */
export function timeSeriesFromSessions(
  sessions: Json[],
  dates: string[],
  now: Date,
  nameFor: (personId: string) => string | null | undefined,
): AdminTimeSeriesPoint[] {
  const buckets = new Map<string, Map<string, number>>();
  for (const date of dates) buckets.set(date, new Map());
  for (const session of sessions) {
    const date = dateOnly(session.shift_date);
    if (!date) continue;
    const bucket = buckets.get(date);
    if (!bucket) continue;
    const personId = String(session.person_id ?? "");
    if (!personId) continue;
    const minutes = Math.round(observedSecondsForSession(session, now) / 60);
    if (minutes <= 0) continue;
    bucket.set(personId, (bucket.get(personId) ?? 0) + minutes);
  }
  return dates.map((date) => {
    const people = [...(buckets.get(date) ?? new Map<string, number>()).entries()]
      .map(([personId, minutes]) => ({ personId, name: nameFor(personId)?.trim() || "Former teammate", minutes }))
      .sort((left, right) => right.minutes - left.minutes || left.name.localeCompare(right.name));
    return {
      date,
      totalMinutes: people.reduce((sum, person) => sum + person.minutes, 0),
      people,
    };
  });
}
