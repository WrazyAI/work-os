import { useLayoutEffect, useRef, type RefObject } from "react";

/** Motion preference for list shifts: reduced motion removes all of it. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface ListPosition {
  x: number;
  y: number;
}

/** Layout position of every keyed row. `offsetTop`/`offsetLeft` ignore
 * transforms, so a FLIP animation that is already running can never corrupt
 * the measurement the way `getBoundingClientRect` does (reading a rect at
 * animation time 0 returns the from-keyframe position, which re-records the
 * old layout and makes every later render think the row moved again). */
export function captureListPositions(container: HTMLElement | null): Map<string, ListPosition> {
  const positions = new Map<string, ListPosition>();
  if (!container) return positions;
  for (const element of container.querySelectorAll<HTMLElement>("[data-list-key]")) {
    const key = element.dataset.listKey;
    if (key) positions.set(key, { x: element.offsetLeft, y: element.offsetTop });
  }
  return positions;
}

/** The FLIP animations this helper owns, per row, so a new shift cancels the
 * previous one instead of overriding it mid-flight. */
const runningShifts = new WeakMap<HTMLElement, Animation>();

export function cancelListShift(element: HTMLElement): void {
  const running = runningShifts.get(element);
  if (!running) return;
  running.cancel();
  runningShifts.delete(element);
}

/** One shift per changed list: rows that moved animate from their previous
 * layout position, rows that appeared fade in. Rows already playing their
 * exit are skipped — that animation owns them — and any previous shift on a
 * row is cancelled first so two animations can never fight over `transform`. */
export function animateListShift(container: HTMLElement | null, previous: Map<string, ListPosition>, reducedMotion: boolean): void {
  if (!container || reducedMotion || typeof container.animate !== "function") return;
  for (const element of container.querySelectorAll<HTMLElement>("[data-list-key]")) {
    if (element.classList.contains("is-leaving")) continue;
    const key = element.dataset.listKey;
    if (!key) continue;
    cancelListShift(element);
    const before = previous.get(key);
    if (!before) {
      runningShifts.set(element, element.animate(
        [{ opacity: 0, transform: "translateY(-4px)" }, { opacity: 1, transform: "none" }],
        { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
      ));
      continue;
    }
    const dx = before.x - element.offsetLeft;
    const dy = before.y - element.offsetTop;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    runningShifts.set(element, element.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: 220, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    ));
  }
}

/** FLIP for a keyed list: positions are captured after every commit and a
 * shift only plays when the list's key signature actually changed. Unrelated
 * renders — a completion spinning, a menu opening, a cache patch that keeps
 * the same rows — must never restart the animation. A different container
 * (view switch) and the first paint never animate, so a page load does not
 * slide the whole list in. */
export function useListShift<T extends HTMLElement>(ref: RefObject<T | null>): void {
  const positions = useRef<Map<string, ListPosition>>(new Map());
  const container = useRef<HTMLElement | null>(null);
  const signature = useRef("");
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      positions.current = new Map();
      container.current = null;
      signature.current = "";
      return;
    }
    const keys = [...element.querySelectorAll<HTMLElement>("[data-list-key]")]
      .map((row) => row.dataset.listKey ?? "")
      .join("|");
    if (container.current === element && signature.current !== keys) {
      animateListShift(element, positions.current, prefersReducedMotion());
    }
    container.current = element;
    positions.current = captureListPositions(element);
    signature.current = keys;
  });
}
