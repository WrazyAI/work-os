/** Human duration for a lesson: short films read in seconds, long ones as m:ss. */
export function formatTutorialDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "25s";
  const total = Math.floor(seconds + 0.0001);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}

/** Chapter starts always read as m:ss so 0 is a real start, not a fallback. */
export function formatChapterTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + 0.0001));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
