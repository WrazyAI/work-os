import type { ActivityInterval, MemoryFact } from "./types";

/** Review notifications derive from live query data only. The panel always
 * reflects what is waiting right now; the seen registries below only decide
 * whether a NEW arrival may pop a flyout or a system toast, so a reload never
 * re-announces something the employee already saw. */
export const MEMORY_SEEN_KEY = "work-os.notifications.memory-seen.v1";
export const RECAP_NOTIFIED_KEY = "work-os.notifications.recap-notified.v1";
export const OVERDUE_NOTIFIED_KEY = "work-os.notifications.overdue-notified.v1";

/** Cap on retained seen ids so the registry cannot grow without bound. */
const SEEN_LIMIT = 120;

export function memoryCandidateIds(facts: readonly MemoryFact[] | undefined): string[] {
  return (facts ?? [])
    .filter((fact) => fact.review_status === "candidate")
    .map((fact) => fact.id)
    .sort();
}

/** The current candidate ids that were never announced before. */
export function unseenMemoryIds(candidateIds: readonly string[], seenIds: readonly string[]): string[] {
  const seen = new Set(seenIds);
  return candidateIds.filter((id) => !seen.has(id));
}

/** Merge the current candidate ids into the seen registry, newest last. */
export function mergeSeenIds(seenIds: readonly string[], candidateIds: readonly string[]): string[] {
  const merged = [...seenIds];
  const known = new Set(merged);
  for (const id of candidateIds) {
    if (!known.has(id)) {
      known.add(id);
      merged.push(id);
    }
  }
  return merged.slice(-SEEN_LIMIT);
}

/** The recap the employee has not decided yet: the newest ready interval whose
 * review is still inferred. Confirmed, amended, preparing, or failed intervals
 * are never surfaced as a review notification. */
export function readyRecap(intervals: readonly ActivityInterval[] | undefined): ActivityInterval | null {
  const ready = (intervals ?? [])
    .filter((interval) => interval.generationStatus === "ready" && interval.reviewStatus === "inferred")
    .sort((left, right) => String(right.windowStart).localeCompare(String(left.windowStart)));
  return ready[0] ?? null;
}

export function recapNotifyKey(intervalId: string): string {
  return `recap:${intervalId}`;
}

/** One key per overdue task and due date: the same overdue state is announced
 * once, while a task that moves its due date can announce itself again. */
export function overdueNotifyKey(task: { id: string; dueDate: string }): string {
  return `overdue:${task.id}:${task.dueDate}`;
}

/** "3 tasks are overdue" / "1 task is overdue". */
export function overdueSummary(count: number): string {
  return count === 1 ? "1 task is overdue" : `${count} tasks are overdue`;
}

/** The current overdue keys that were never announced before. */
export function unseenOverdueKeys(keys: readonly string[], seenIds: readonly string[]): string[] {
  const seen = new Set(seenIds);
  return keys.filter((key) => !seen.has(key));
}

/** Merge the current overdue keys into the seen registry. Unlike the general
 * cap, every current key survives: a key that rotated out would look new and
 * re-announce a task that never stopped being overdue. Older keys still age
 * out, so the registry stays bounded. */
export function mergeOverdueKeys(seenIds: readonly string[], currentKeys: readonly string[]): string[] {
  const current = new Set(currentKeys);
  const older = seenIds.filter((id) => !current.has(id));
  const keepOlder = Math.max(0, Math.max(SEEN_LIMIT, currentKeys.length) - currentKeys.length);
  return [...older.slice(-keepOlder), ...currentKeys].slice(-Math.max(SEEN_LIMIT, currentKeys.length));
}

/** Everything the badge counts: memories waiting for review, one recap slot,
 * overdue tasks, and the outstanding EOD days the bell already tracked. */
export function notificationsBadgeCount(input: {
  memoryCandidates: number;
  recapReady: boolean;
  overdueTasks: number;
  outstandingEodDays: number;
}): number {
  return Math.max(0, input.memoryCandidates) + (input.recapReady ? 1 : 0) + Math.max(0, input.overdueTasks) + Math.max(0, input.outstandingEodDays);
}

/** The panel's one-line description of what is waiting. */
export function notificationsSummary(input: {
  memoryCandidates: number;
  recapReady: boolean;
  overdueTasks: number;
  outstandingEodDays: number;
}): string {
  const parts: string[] = [];
  if (input.memoryCandidates > 0) parts.push(`${input.memoryCandidates} memor${input.memoryCandidates === 1 ? "y" : "ies"} to review`);
  if (input.recapReady) parts.push("a recap to review");
  if (input.overdueTasks > 0) parts.push(`${input.overdueTasks} overdue task${input.overdueTasks === 1 ? "" : "s"}`);
  if (input.outstandingEodDays > 0) parts.push(`${input.outstandingEodDays} prior EOD${input.outstandingEodDays === 1 ? "" : "s"}`);
  if (!parts.length) return "You're caught up";
  return parts.join(" · ");
}
