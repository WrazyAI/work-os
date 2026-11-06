export type ViewPopoverAnchor = { left: number; right: number; top: number; bottom: number };
export type ViewPopoverSize = { width: number; height: number };
export type ViewPopoverViewport = { width: number; height: number };
export type ViewPopoverPlacement = "below" | "above";

const INSET = 8;
const GAP = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** Place the mascot view menu inside the viewport. Below the trigger unless it
 * would clip, then above; a menu taller than the viewport is capped and scrolls
 * internally by CSS. */
export function placeViewPopover(input: {
  anchor: ViewPopoverAnchor;
  size: ViewPopoverSize;
  viewport: ViewPopoverViewport;
}): { left: number; top: number; width: number; height: number; placement: ViewPopoverPlacement } {
  const width = Math.min(Math.max(1, input.size.width), Math.max(1, input.viewport.width - INSET * 2));
  const height = Math.min(Math.max(1, input.size.height), Math.max(1, input.viewport.height - INSET * 2));
  const left = clamp(input.anchor.left, INSET, Math.max(INSET, input.viewport.width - width - INSET));
  const below = input.anchor.bottom + GAP;
  const above = input.anchor.top - GAP - height;
  const belowFits = below + height <= input.viewport.height - INSET;
  const aboveFits = above >= INSET;
  const placement: ViewPopoverPlacement = belowFits || !aboveFits ? "below" : "above";
  const top = placement === "below"
    ? clamp(below, INSET, Math.max(INSET, input.viewport.height - height - INSET))
    : clamp(above, INSET, Math.max(INSET, input.viewport.height - height - INSET));
  return { left, top, width, height, placement };
}
