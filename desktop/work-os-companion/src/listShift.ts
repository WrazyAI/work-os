import { useLayoutEffect, useRef, type RefObject } from "react";

/** Motion preference for list shifts: reduced motion removes all of it. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Row positions for a keyed list container, keyed by `data-list-key`. */
export function captureListPositions(container: HTMLElement | null): Map<string, DOMRect> {
  const positions = new Map<string, DOMRect>();
  if (!container) return positions;
  for (const element of container.querySelectorAll<HTMLElement>("[data-list-key]")) {
    const key = element.dataset.listKey;
    if (key) positions.set(key, element.getBoundingClientRect());
  }
  return positions;
}

/** FLIP: animate every moved row from its previous position, and fade in rows
 * that were not present in the previous frame (a fresh optimistic task). */
export function animateListShift(container: HTMLElement | null, previous: Map<string, DOMRect>, reducedMotion: boolean): void {
  if (!container || reducedMotion || typeof container.animate !== "function") return;
  for (const element of container.querySelectorAll<HTMLElement>("[data-list-key]")) {
    const key = element.dataset.listKey;
    if (!key) continue;
    const after = element.getBoundingClientRect();
    const before = previous.get(key);
    if (!before) {
      element.animate(
        [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      );
      continue;
    }
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
  }
}

/** FLIP for a keyed list: positions are captured after every commit and
 * compared on the next one. A different container (view switch) and the first
 * paint never animate, so a page load does not slide the whole list in. */
export function useListShift<T extends HTMLElement>(ref: RefObject<T | null>): void {
  const positions = useRef<Map<string, DOMRect>>(new Map());
  const container = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      positions.current = new Map();
      container.current = null;
      return;
    }
    if (container.current === element) animateListShift(element, positions.current, prefersReducedMotion());
    container.current = element;
    positions.current = captureListPositions(element);
  });
}
