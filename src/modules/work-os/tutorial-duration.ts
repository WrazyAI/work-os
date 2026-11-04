/** Human duration for a lesson: short films read in seconds, long ones as m:ss. */
export function formatTutorialDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "25s";
  const total = Math.floor(seconds + 0.0001);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  return `${minutes}:${String(total % 60).padStart(2, "0")}`;
}
