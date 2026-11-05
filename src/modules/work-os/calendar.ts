/** Calendar helpers shared by the web and companion charts. Work weeks are
 * Monday through Friday for chart series; the underlying range totals keep
 * every recorded day. */

export function isWeekendDate(date: string): boolean {
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  const weekday = parsed.getUTCDay();
  return weekday === 0 || weekday === 6;
}

function nextDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** Inclusive Monday-Friday dates between two YYYY-MM-DD values. Invalid
 * values yield an empty list instead of an unbounded loop. */
export function workdayDates(from: string, through: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(through) || through < from) return [];
  const dates: string[] = [];
  for (let date = from; date <= through; date = nextDate(date)) {
    if (!isWeekendDate(date)) dates.push(date);
  }
  return dates;
}
