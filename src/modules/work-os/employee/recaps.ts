/** Activity recap generation parity with the companion.
 *
 * The companion builds the evidence-backed recap for a due progress prompt
 * *before* it claims the prompt, so the check-in has a recap ready. The web
 * surface does the same: when a follow-up/hourly prompt is due and no recap
 * exists for that slot yet, it ensures one once per prompt slot. */

export interface RecapPromptShape {
  kind: string | null;
  nextPromptAt: string | null;
}

const PROGRESS_PROMPT_KINDS = new Set(["follow_up", "hourly_fallback"]);

/** The stable key for the prompt slot that still needs its recap, or null when
 * the prompt is not a due progress prompt. One ensure per returned key. */
export function recapEnsureSlot(prompt: RecapPromptShape | null | undefined, nowMs: number): string | null {
  if (!prompt?.nextPromptAt || !prompt.kind || !PROGRESS_PROMPT_KINDS.has(prompt.kind)) return null;
  const dueAt = Date.parse(prompt.nextPromptAt);
  if (!Number.isFinite(dueAt) || dueAt > nowMs) return null;
  return `${prompt.kind}:${prompt.nextPromptAt}`;
}

/** Milliseconds until a not-yet-due progress prompt becomes due, or null when
 * there is nothing to schedule (not a progress prompt, no due time, or due
 * already). The mounted page schedules its ensure at the due moment with it. */
export function recapPromptDueInMs(prompt: RecapPromptShape | null | undefined, nowMs: number): number | null {
  if (!prompt?.nextPromptAt || !prompt.kind || !PROGRESS_PROMPT_KINDS.has(prompt.kind)) return null;
  const dueAt = Date.parse(prompt.nextPromptAt);
  if (!Number.isFinite(dueAt) || dueAt <= nowMs) return null;
  return dueAt - nowMs;
}

/** A ready or amended recap for the slot means the ensure can be skipped. */
export function hasRecapForSlot(intervals: Array<{ windowStart: string; windowEnd: string; generationStatus: string }>, slot: string): boolean {
  const separators = slot.indexOf(":");
  if (separators < 0) return false;
  const dueAt = Date.parse(slot.slice(separators + 1));
  if (!Number.isFinite(dueAt)) return false;
  return intervals.some((interval) => {
    const start = Date.parse(interval.windowStart);
    const end = Date.parse(interval.windowEnd);
    return Number.isFinite(start) && Number.isFinite(end) && dueAt >= start && dueAt <= end && interval.generationStatus !== "failed";
  });
}
