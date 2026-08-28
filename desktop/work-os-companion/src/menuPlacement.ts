export interface MenuPlacementInput {
  trigger: { top: number; bottom: number; left: number; right: number };
  menu: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
  margin?: number;
}

export interface MenuPlacement {
  placement: "down" | "up";
  align: "right" | "left";
  top: number;
  left: number;
}

/**
 * Computes where an anchored menu should render so it never clips the
 * viewport. Prefers opening below the trigger aligned to its right edge;
 * flips above when there is not enough room and clamps horizontally.
 */
export function computeMenuPlacement({ trigger, menu, viewport, gap = 6, margin = 8 }: MenuPlacementInput): MenuPlacement {
  const spaceBelow = viewport.height - margin - trigger.bottom;
  const spaceAbove = trigger.top - margin;
  const placement: MenuPlacement["placement"] = menu.height <= spaceAbove && menu.height > spaceBelow ? "up" : "down";
  const top = placement === "down" ? trigger.bottom + gap : Math.max(margin, trigger.top - gap - menu.height);
  const align: MenuPlacement["align"] = trigger.right - menu.width >= margin || viewport.width - trigger.left <= menu.width + margin ? "right" : "left";
  const unclampedLeft = align === "right" ? trigger.right - menu.width : trigger.left;
  const left = Math.min(Math.max(margin, unclampedLeft), Math.max(margin, viewport.width - margin - menu.width));
  return { placement, align, top, left };
}
