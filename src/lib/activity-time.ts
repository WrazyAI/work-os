/**
 * Splitting a model-written activity line into its clock time and the activity
 * itself.
 *
 * The activity prompt asks for the clock time first ("7:21 PM Reviewed the
 * cursor-pagination code") so the card can set the time as a quiet pill and the
 * spoken line can carry only the activity. The companion has the same rule in
 * `desktop/work-os-companion/src/ActivityIntervalCard.tsx` (it renders the
 * pill); `test/work-os-recap-speech.test.mts` fails if the two regexes drift,
 * because a split that succeeds on one side and fails on the other would show
 * one thing and say another.
 */

const ACTIVITY_TIME_PREFIX =
  /^(\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s*[–—-]\s*\d{1,2}:\d{2}(?:\s*[AP]M)?)?)(.*)$/i;

/** The shared expression, exported so the drift guard can compare it. */
export const ACTIVITY_TIME_PREFIX_SOURCE = ACTIVITY_TIME_PREFIX.source;

export function splitActivityTime(activity: string): { time: string | null; text: string } {
  const whole = { time: null as string | null, text: activity.trim() };
  const prefix = activity.trim().match(ACTIVITY_TIME_PREFIX);
  if (!prefix) return whole;
  const rest = prefix[2].match(/^\s*(?:[–—:-]\s*|\s+)([\p{L}\p{N}].*)$/iu);
  if (!rest) return whole;
  const time = prefix[1].replace(/\s+/g, " ").trim();
  const text = rest[1].trim();
  return time && text ? { time, text } : whole;
}
