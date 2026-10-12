/** Chat message timing: the local clock beside an agent turn's hover actions,
 * and the centered session divider that marks a conversation's opening and any
 * pause longer than twenty minutes. Times come only from recorded turn
 * timestamps — a turn without one never receives an invented time. */

export const CHAT_DIVIDER_GAP_MS = 20 * 60 * 1000;

/** The minimum a rendered turn must expose for timing. */
export interface ChatTimedEntry {
  role: string;
  createdAt?: string | null;
}

export interface ChatTimeOptions {
  /** Testing seam. Production always formats in the employee's local zone. */
  timeZone?: string;
}

function parseTime(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateParts(date: Date, timeZone?: string): { year: number; month: number; day: number } | null {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const year = value("year");
    const month = value("month");
    const day = value("day");
    return Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day) ? { year, month, day } : null;
  } catch {
    return null;
  }
}

/** Local calendar-day ordinal, so "today"/"yesterday" comparisons survive DST. */
function dayOrdinal(parts: { year: number; month: number; day: number }) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86_400_000);
}

/** "5:48 PM" — the 12-hour clock in the employee's local timezone, or null when
 * the value is missing or malformed. */
export function formatChatClock(value?: string | null, options: ChatTimeOptions = {}): string | null {
  const date = parseTime(value);
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: options.timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(date);
  } catch {
    return null;
  }
}

/** "Today 5:48 PM" / "Yesterday 9:03 AM" / "Wednesday 9:03 PM" /
 * "September 30, 5:48 PM" — the centered session-divider label. */
export function formatChatDividerLabel(value?: string | null, now: Date = new Date(), options: ChatTimeOptions = {}): string | null {
  const date = parseTime(value);
  const clock = formatChatClock(value, options);
  if (!date || !clock) return null;
  const parts = localDateParts(date, options.timeZone);
  const today = localDateParts(now, options.timeZone);
  if (!parts || !today) return null;
  const days = dayOrdinal(today) - dayOrdinal(parts);
  if (days <= 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  const label = dayLabel(date, now, days, options);
  return label ? `${label} ${clock}` : null;
}

/** Full tooltip for a hover time: "Wednesday, October 7, 9:03 AM" (the year
 * suffix appears only when it differs from the current year). */
export function formatChatTimeTitle(value?: string | null, now: Date = new Date(), options: ChatTimeOptions = {}): string | null {
  const date = parseTime(value);
  const clock = formatChatClock(value, options);
  if (!date || !clock) return null;
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: options.timeZone, weekday: "long" }).format(date);
    const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: options.timeZone, month: "long", day: "numeric" }).format(date);
    return `${weekday}, ${monthDay}${yearSuffix(date, now, options.timeZone)}, ${clock}`;
  } catch {
    return null;
  }
}

function yearOf(date: Date, timeZone?: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(date);
  } catch {
    return null;
  }
}

function yearSuffix(date: Date, now: Date, timeZone?: string): string {
  const year = yearOf(date, timeZone);
  const current = yearOf(now, timeZone);
  return year && current && year !== current ? ` ’${year.slice(-2)}` : "";
}

/** Weekday for the last six days, month/day beyond, with a year suffix when the
 * year differs from the current one. */
function dayLabel(date: Date, now: Date, days: number, options: ChatTimeOptions): string | null {
  try {
    if (days <= 6) return new Intl.DateTimeFormat("en-US", { timeZone: options.timeZone, weekday: "long" }).format(date);
    const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: options.timeZone, month: "long", day: "numeric" }).format(date);
    return `${monthDay}${yearSuffix(date, now, options.timeZone)},`;
  } catch {
    return null;
  }
}

/** Whether the employee message at `index` opens a session: the conversation's
 * first employee message always carries its time marker, and every later one
 * carries one when it follows the nearest timestamped turn by more than twenty
 * minutes. Agent turns never receive a divider. */
export function shouldShowChatDivider(entries: readonly ChatTimedEntry[], index: number): boolean {
  const turn = entries[index];
  if (!turn || turn.role !== "user") return false;
  const time = parseTime(turn.createdAt);
  if (!time) return false;
  let previousUser = false;
  let previousTime: Date | null = null;
  for (let i = 0; i < index; i += 1) {
    const entry = entries[i]!;
    if (entry.role === "user") previousUser = true;
    const candidate = parseTime(entry.createdAt);
    if (candidate) previousTime = candidate;
  }
  if (!previousUser || !previousTime) return true;
  return time.getTime() - previousTime.getTime() > CHAT_DIVIDER_GAP_MS;
}
