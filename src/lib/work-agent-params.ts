/** Query-parameter parsing for the agent routes. `Number(null)` is 0, not
 * NaN, so an absent parameter must fall back explicitly instead of clamping
 * to the minimum page size. */
export function agentLimitParam(value: string | null | undefined, fallback: number, max: number): number {
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}
