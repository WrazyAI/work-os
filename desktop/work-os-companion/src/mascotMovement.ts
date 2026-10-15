import { movementDirection, type PetMovement } from "./mascotPlayback";

/** Native move events also include edge snapping and programmatic positioning.
 * Only moves preceded by an explicit drag intent should make the pet travel. */
export function createMascotMovement(onChange: (value: PetMovement) => void) {
  let previous: number | null = null;
  let dragging = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    dragging = false;
    clearTimeout(timer);
    timer = undefined;
    onChange(null);
  };
  const settle = () => { timer = undefined; onChange(null); };
  return {
    start: () => { dragging = true; clearTimeout(timer); timer = setTimeout(stop, 1_000); },
    move: (x: number) => {
      if (!Number.isFinite(x)) return;
      const direction = previous == null ? null : movementDirection(x - previous);
      previous = x;
      if (!dragging || !direction) return;
      onChange(direction);
      clearTimeout(timer);
      timer = setTimeout(settle, 250);
    },
    stop,
  };
}
