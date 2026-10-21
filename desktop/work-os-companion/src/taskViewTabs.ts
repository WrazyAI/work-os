/** The peer-view keyboard contract for the Tasks panel tabs.
 *
 * Returns the index the tablist should move to, or null when the key is not
 * part of the contract. The caller owns focus and activation so the same
 * arithmetic can be tested without a browser. */
export function taskViewTabIndex(current: number, key: string, count: number): number | null {
  if (count <= 0 || current < 0 || current >= count) return null;
  const last = count - 1;
  if (key === "ArrowRight") return current === last ? 0 : current + 1;
  if (key === "ArrowLeft") return current === 0 ? last : current - 1;
  if (key === "Home") return 0;
  if (key === "End") return last;
  return null;
}
