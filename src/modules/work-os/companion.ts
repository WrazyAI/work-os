export type WorkOsPromptKind = "follow_up" | "hourly_fallback" | "optional" | "eod";

export interface WorkOsScheduleRule {
  id: string;
  timezone: string;
  days_of_week: number[];
  shift_start: string;
  shift_end: string;
  break_windows?: Array<{ start: string; end: string }>;
  effective_from: string;
  effective_to?: string | null;
}

export interface WorkOsScheduleException {
  exception_date: string;
  kind: "leave" | "changed_shift" | "working_day";
  shift_start?: string | null;
  shift_end?: string | null;
  break_windows?: Array<{ start: string; end: string }>;
}

export interface WorkOsCheckInState {
  substantive: boolean;
  confirmed_existing_tasks: boolean;
  occurred_at: string;
  snoozed_until?: string | null;
}

export function isTaskOutcomeEvidence(item: Record<string, unknown>) {
  if (item.source === "worktivity") return false;
  const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics as Record<string, unknown> : {};
  return metrics.evidenceClass === "output_evidence" || (typeof item.url === "string" && !!item.url.trim());
}

export interface WorkOsShiftWindow {
  scheduleId: string;
  timezone: string;
  shiftDate: string;
  startsAt: string;
  endsAt: string;
  breaks: Array<{ startsAt: string; endsAt: string }>;
}

export interface WorkOsPromptDecision {
  kind: WorkOsPromptKind | null;
  nextPromptAt: string | null;
  required: boolean;
  reason: string;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** Date columns arrive as Date objects from the Postgres client; compare as
 * plain YYYY-MM-DD keys instead of stringifying Date instances. */
function dateKey(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime())
      ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
      : null;
  }
  const match = typeof value === "string" ? value.match(/^\d{4}-\d{2}-\d{2}/) : null;
  return match ? match[0] : null;
}

function localParts(at: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(at);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
    weekday,
  };
}

function shiftDate(date: string, days: number) {  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function timeParts(value: string) {
  const [hour, minute, second] = value.split(":").map(Number);
  return { hour: hour || 0, minute: minute || 0, second: second || 0 };
}

// Convert a wall-clock time in an IANA timezone to an instant. Iterating the
// observed timezone offset handles DST without introducing a date library.
export function zonedDateTimeToUtc(date: string, time: string, timezone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const clock = timeParts(time);
  const desired = Date.UTC(year, month - 1, day, clock.hour, clock.minute, clock.second);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = localParts(new Date(candidate), timezone);
    const observedWall = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const correction = desired - observedWall;
    candidate += correction;
    if (correction === 0) break;
  }
  return new Date(candidate);
}

function ruleApplies(rule: WorkOsScheduleRule, date: string, weekday: number) {
  // `effective_from`/`effective_to` are Postgres date columns, and the client
  // can hand them back as Date objects: `Date <= "YYYY-MM-DD"` is always
  // false, which silently disables every rule. Compare normalized date keys.
  const from = dateKey(rule.effective_from);
  const to = dateKey(rule.effective_to);
  return rule.days_of_week.includes(weekday) &&
    from !== null && from <= date &&
    (to === null || to >= date);
}

function buildWindow(
  rule: WorkOsScheduleRule,
  date: string,
  exception?: WorkOsScheduleException,
): WorkOsShiftWindow | null {
  if (exception?.kind === "leave") return null;
  const startTime = exception?.shift_start || rule.shift_start;
  const endTime = exception?.shift_end || rule.shift_end;
  const start = zonedDateTimeToUtc(date, startTime, rule.timezone);
  let end = zonedDateTimeToUtc(date, endTime, rule.timezone);
  if (end <= start) end = zonedDateTimeToUtc(shiftDate(date, 1), endTime, rule.timezone);
  const breakWindows = exception?.break_windows ?? rule.break_windows ?? [];
  const breaks = breakWindows.map((item) => {
    const breakStart = zonedDateTimeToUtc(date, item.start, rule.timezone);
    let breakEnd = zonedDateTimeToUtc(date, item.end, rule.timezone);
    if (breakEnd <= breakStart) breakEnd = zonedDateTimeToUtc(shiftDate(date, 1), item.end, rule.timezone);
    if (breakStart < start) {
      const nextStart = zonedDateTimeToUtc(shiftDate(date, 1), item.start, rule.timezone);
      const nextEnd = zonedDateTimeToUtc(shiftDate(date, 1), item.end, rule.timezone);
      return { startsAt: nextStart.toISOString(), endsAt: nextEnd.toISOString() };
    }
    return { startsAt: breakStart.toISOString(), endsAt: breakEnd.toISOString() };
  });
  return {
    scheduleId: rule.id,
    timezone: rule.timezone,
    shiftDate: date,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    breaks,
  };
}

function candidateShiftWindows(
  rules: WorkOsScheduleRule[],
  exceptions: WorkOsScheduleException[],
  at = new Date(),
) {
  const candidates: WorkOsShiftWindow[] = [];
  for (const offset of [-1, 0, 1]) {
    for (const rule of rules) {
      const local = localParts(at, rule.timezone);
      const date = shiftDate(local.date, offset);
      const weekday = (local.weekday + offset + 7) % 7;
      const exception = exceptions.find((item) => dateKey(item.exception_date) === date);
      if (!exception && !ruleApplies(rule, date, weekday)) continue;
      if (exception && exception.kind !== "leave" && !ruleApplies(rule, date, weekday) && exception.kind !== "working_day") continue;
      const window = buildWindow(rule, date, exception);
      if (!window) continue;
      candidates.push(window);
    }
  }
  return candidates.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));
}

/** Current shift when active, otherwise the next schedule window for display. */
export function resolveUpcomingShiftWindow(
  rules: WorkOsScheduleRule[],
  exceptions: WorkOsScheduleException[],
  at = new Date(),
) {
  const now = at.getTime();
  const candidates = candidateShiftWindows(rules, exceptions, at);
  return candidates.find((window) => now >= Date.parse(window.startsAt) && now < Date.parse(window.endsAt))
    ?? candidates.find((window) => now < Date.parse(window.startsAt))
    ?? null;
}

/** A schedule may own a clock-in only inside the explicit startable window. */
export function resolveStartableShiftWindow(
  rules: WorkOsScheduleRule[],
  exceptions: WorkOsScheduleException[],
  at = new Date(),
  earlyGraceMinutes = 30,
) {
  const now = at.getTime();
  const grace = Math.max(0, earlyGraceMinutes) * 60_000;
  return candidateShiftWindows(rules, exceptions, at).find((window) =>
    now >= Date.parse(window.startsAt) - grace && now < Date.parse(window.endsAt)
  ) ?? null;
}

function weekdayForLocalDate(date: string, timezone: string) {
  return localParts(zonedDateTimeToUtc(date, "12:00", timezone), timezone).weekday;
}

/** The schedule window for one employee-local date, independent of where the
 * clock sits relative to it. The EOD wrap-up window is anchored to this value,
 * which must survive clock-out and the roll to tomorrow's shift. */
export function resolveShiftWindowForDate(
  rules: WorkOsScheduleRule[],
  exceptions: WorkOsScheduleException[],
  date: string,
): WorkOsShiftWindow | null {
  const exception = exceptions.find((item) => dateKey(item.exception_date) === date);
  if (exception?.kind === "leave") return null;
  for (const rule of rules) {
    const weekday = weekdayForLocalDate(date, rule.timezone);
    if (!ruleApplies(rule, date, weekday) && exception?.kind !== "working_day") continue;
    const window = buildWindow(rule, date, exception);
    if (window) return window;
  }
  return null;
}

// Compatibility for existing display/check-in callers. New lifecycle code must
// explicitly choose upcoming or startable semantics.
export const resolveShiftWindow = resolveUpcomingShiftWindow;

function inBreak(window: WorkOsShiftWindow, at: Date) {
  const value = at.getTime();
  return window.breaks.some((item) => value >= new Date(item.startsAt).getTime() && value < new Date(item.endsAt).getTime());
}

export function decideWorkOsPrompt(
  window: WorkOsShiftWindow | null,
  checkIns: WorkOsCheckInState[],
  at = new Date(),
): WorkOsPromptDecision {
  if (!window) return { kind: null, nextPromptAt: null, required: false, reason: "No scheduled shift." };
  const now = at.getTime();
  const starts = new Date(window.startsAt).getTime();
  const ends = new Date(window.endsAt).getTime();
  if (now < starts) return { kind: null, nextPromptAt: null, required: false, reason: "Clock in to begin the workday." };
  if (now >= ends) return { kind: null, nextPromptAt: null, required: false, reason: "Shift ended." };
  if (inBreak(window, at)) {
    const activeBreak = window.breaks.find((item) => now >= new Date(item.startsAt).getTime() && now < new Date(item.endsAt).getTime());
    return { kind: null, nextPromptAt: activeBreak?.endsAt ?? null, required: false, reason: "Scheduled break." };
  }
  const snoozedUntil = checkIns.map((item) => item.snoozed_until).filter(Boolean).sort().at(-1);
  if (snoozedUntil && new Date(snoozedUntil).getTime() > now) {
    return { kind: null, nextPromptAt: snoozedUntil, required: false, reason: "Check-in snoozed." };
  }

  const eodAt = ends - 10 * 60_000;
  if (now >= eodAt) return { kind: "eod", nextPromptAt: new Date(eodAt).toISOString(), required: false, reason: "EOD review window." };
  if (ends - now <= 60 * 60_000) return { kind: null, nextPromptAt: new Date(eodAt).toISOString(), required: false, reason: "Final-hour planning suppression." };

  const valid = checkIns.some((item) => item.substantive);
  if (!valid) {
    const followUpAt = starts + 30 * 60_000;
    return { kind: "follow_up", nextPromptAt: new Date(followUpAt).toISOString(), required: false, reason: "The first follow-up is independent of goal entry." };
  }

  const elapsedHours = Math.floor((now - starts) / 3_600_000) + 1;
  const nextHourly = Math.min(starts + elapsedHours * 3_600_000, eodAt);
  return { kind: "optional", nextPromptAt: new Date(nextHourly).toISOString(), required: false, reason: "Quiet optional check-in." };
}

export function localDateForTimezone(at: Date, timezone: string) {
  return localParts(at, timezone).date;
}

/** Half-open UTC bounds for one local calendar day: [local midnight, next
 * local midnight). Every day-scoped Worktivity read and write uses these so a
 * frame captured near local midnight belongs to the employee's workday rather
 * than to whichever UTC date it happens to fall in. */
export function localDayBounds(date: string, timezone: string): { startIso: string; endIso: string } {
  if (!isCalendarDate(date)) return { startIso: "", endIso: "" };
  const next = dateOnlyAfter(date);
  try {
    const start = startOfLocalDay(date, timezone || "UTC");
    const end = startOfLocalDay(next, timezone || "UTC");
    if (start.getTime() < end.getTime()) return { startIso: start.toISOString(), endIso: end.toISOString() };
  } catch {
    // An unknown timezone must not fail the run; keep the day usable in UTC.
  }
  return { startIso: `${date}T00:00:00.000Z`, endIso: `${next}T00:00:00.000Z` };
}

/** Rejects dates the regex accepts but the calendar does not (2026-02-30). */
function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
}

/** The first instant whose local date is `date`. Some zones skip local
 * midnight on DST-start days (America/Santiago); the naive conversion then
 * lands on the previous local day, so walk forward to the real boundary. */
function startOfLocalDay(date: string, timezone: string): Date {
  let candidate = zonedDateTimeToUtc(date, "00:00", timezone);
  for (let attempt = 0; attempt < 8 && localDateForTimezone(candidate, timezone) !== date; attempt += 1) {
    candidate = new Date(candidate.getTime() + 15 * 60_000);
  }
  return candidate;
}

function dateOnlyAfter(date: string) {
  const at = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(at.getTime())) return date;
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

export function formatLocalShift(window: WorkOsShiftWindow) {
  const start = localParts(new Date(window.startsAt), window.timezone);
  const end = localParts(new Date(window.endsAt), window.timezone);
  return `${pad(start.hour)}:${pad(start.minute)}-${pad(end.hour)}:${pad(end.minute)}`;
}
