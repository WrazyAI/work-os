/**
 * How much room the next-steps bubble needs.
 *
 * The compact companion is a fixed window with the mascot anchored to the
 * bottom. A decision list may be taller than the resting bubble, so the window
 * grows upward by exactly the extra the list asks for — the same contract as
 * the read-aloud prompter: the bottom edge never moves, so Otto and the
 * elapsed pill stay where the employee left them.
 *
 * Beyond three items the list scrolls instead of pushing the window further
 * up; a scrollable decision list keeps the whole companion on screen and keeps
 * every button reachable.
 */

import {
  RECAP_BUBBLE_READING_WIDTH,
  RECAP_BUBBLE_RESTING,
  grownWindowFor,
  type WindowPosition,
  type WindowSize,
} from "./recapSpeech";
import type { RecapNextStepsMoment } from "./RecapNextStepsCard";

/** The bubble's header: title, source line, and the listen/close controls. */
export const NEXT_STEPS_HEADER_HEIGHT = 58;
/** One decision row: kind, title, reason, and its three controls. */
export const NEXT_STEPS_ITEM_HEIGHT = 104;
/** Rows before the list scrolls instead of growing the window. */
export const NEXT_STEPS_MAX_VISIBLE_ITEMS = 3;
/** The tallest the bubble may become, scroll included. */
export const NEXT_STEPS_MAX_HEIGHT = NEXT_STEPS_HEADER_HEIGHT + NEXT_STEPS_ITEM_HEIGHT * NEXT_STEPS_MAX_VISIBLE_ITEMS + 8;
/** The space above the orb inside the resting window. Anything taller than
 * this is what the window has to add. */
export const NEXT_STEPS_RESTING_ROOM = 88;
/** Drafting, empty, and failed states need a single quiet block. */
export const NEXT_STEPS_WAIT_HEIGHT = 132;

/** The bubble's height for this moment: fixed for the wait states, item-driven
 * once the suggestions are ready, and capped so four or more items scroll. */
export function nextStepsBubbleHeight(
  moment: Pick<RecapNextStepsMoment, "status" | "items"> | null | undefined,
): number {
  if (!moment) return 0;
  if (moment.status !== "ready" && moment.status !== "done") return NEXT_STEPS_WAIT_HEIGHT;
  if (!moment.items.length) return NEXT_STEPS_WAIT_HEIGHT;
  const visible = Math.min(moment.items.length, NEXT_STEPS_MAX_VISIBLE_ITEMS);
  return Math.min(NEXT_STEPS_MAX_HEIGHT, NEXT_STEPS_HEADER_HEIGHT + visible * NEXT_STEPS_ITEM_HEIGHT);
}

/** The window target for a showing next-steps moment.
 *
 * `measuredHeight` is the rendered card's natural height. The row estimate is
 * only a fallback: a long title or a three-line reason makes a row taller than
 * the fixed estimate, and growing the window for the estimate left the card
 * clipped at the top. Measuring makes the window fit what the card actually
 * draws; the clamp in `avatar.css` keeps the header visible when the monitor
 * cannot give it the full height. */
export function nextStepsWindow(
  moment: Pick<RecapNextStepsMoment, "status" | "items">,
  monitor: WindowSize,
  position: WindowPosition,
  measuredHeight?: number | null,
): { size: WindowSize; position: WindowPosition } {
  const height = measuredHeight && measuredHeight > 0 ? measuredHeight : nextStepsBubbleHeight(moment);
  const extra = Math.max(0, height - NEXT_STEPS_RESTING_ROOM);
  return grownWindowFor(RECAP_BUBBLE_RESTING, extra, monitor, position);
}

/** The comfortable measure the bubble uses, kept next to the growth math so a
 * test can assert it matches the reading bubble. */
export const NEXT_STEPS_BUBBLE_WIDTH = RECAP_BUBBLE_READING_WIDTH;
