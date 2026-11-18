import type { ActivityInterval, MemoryFact } from "./types";

/** Review notifications derive from live query data only. The panel always
 * reflects what is waiting right now; the seen registries below only decide
 * whether a NEW arrival may pop a flyout or a system toast, so a reload never
 * re-announces something the employee already saw. */
export const MEMORY_SEEN_KEY = "work-os.notifications.memory-seen.v1";
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
  const latest = latestReadyRecap(intervals);
  return latest?.reviewStatus === "inferred" ? latest : null;
}

export type RecapWatermark = Pick<ActivityInterval, "windowEnd" | "id">;
function compareRecaps(a: RecapWatermark, b: RecapWatermark) {
  return Date.parse(a.windowEnd) - Date.parse(b.windowEnd) || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0);
}

/** The newest ready recap regardless of review state. Launch surfacing uses
 * this so an approved newest recap suppresses older unapproved ones instead of
 * cascading down the queue. */
export function latestReadyRecap(intervals: readonly ActivityInterval[] | undefined): ActivityInterval | null {
  const ready = (intervals ?? [])
    .filter((interval) => interval.generationStatus === "ready")
    .sort((left, right) => compareRecaps(right, left));
  return ready[0] ?? null;
}

/** Decides whether the latest recap should replace the mascot card. The
 * watermark is the highest window this app session already surfaced; it keeps
 * an older recap from appearing after the newer one is approved. */
export function recapSurfaceDecision(input: {
  latest: Pick<ActivityInterval, "id" | "windowEnd" | "reviewStatus"> | null;
  watermark: RecapWatermark | null;
  pendingRecap: RecapWatermark | null;
}): { surface: boolean; watermark: RecapWatermark | null; reason: "surface" | "approved" | "not_newer" | "already_pending" | "none" } {
  const { latest, watermark, pendingRecap } = input;
  const later = (candidate: RecapWatermark) => watermark && compareRecaps(watermark, candidate) >= 0 ? watermark : { windowEnd: candidate.windowEnd, id: candidate.id };
  if (!latest) return { surface: false, watermark, reason: "none" };
  if (watermark && compareRecaps(watermark, latest) > 0) return { surface: false, watermark, reason: "not_newer" };
  if (latest.reviewStatus !== "inferred") return { surface: false, watermark: later(latest), reason: "approved" };
  if (pendingRecap && compareRecaps(pendingRecap, latest) >= 0) {
    return { surface: false, watermark: later(pendingRecap), reason: "already_pending" };
  }
  if (watermark && compareRecaps(watermark, latest) >= 0) return { surface: false, watermark, reason: "not_newer" };
  return { surface: true, watermark: later(latest), reason: "surface" };
}

/** One compact bubble state for the post-approval queue. The approved recap
 * event never clears a bubble that is already showing; only an empty queue,
 * opening the queue, or a newer recap does. */
export type RecapQueueBubbleState = { prompt: boolean; awaitingBeat: boolean };
export type RecapQueueBubbleEvent =
  | { type: "approved" }
  | { type: "celebration-ended"; pendingCount: number }
  | { type: "pending-count"; pendingCount: number }
  | { type: "opened" }
  | { type: "surfaced" };

export function reduceRecapQueueBubble(state: RecapQueueBubbleState, event: RecapQueueBubbleEvent): RecapQueueBubbleState {
  switch (event.type) {
    case "approved":
      return { ...state, awaitingBeat: true };
    case "celebration-ended":
      return {
        prompt: event.pendingCount > 0 && (state.prompt || state.awaitingBeat),
        awaitingBeat: false,
      };
    case "pending-count":
      return event.pendingCount <= 0 ? { ...state, prompt: false } : state;
    case "opened":
    case "surfaced":
      return { ...state, prompt: false };
    default:
      return state;
  }
}

export function unapprovedRecapsBubbleVisible(state: RecapQueueBubbleState, pendingCount: number, bubble: string | null) {
  return state.prompt && pendingCount > 0 && bubble === null;
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
