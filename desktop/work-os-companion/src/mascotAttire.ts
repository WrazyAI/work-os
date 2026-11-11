import type { MascotAttireTransition, MascotMode } from "./mascotTypes";

// Covers the jacket's 280ms settle and the glasses' 100ms beat + 220ms fold.
export const MASCOT_ATTIRE_MS = 360;

export function nextAttireTransition(previous: MascotMode, next: MascotMode): MascotAttireTransition {
  return previous === next ? null : next === "admin" ? "on" : "off";
}

/** The live pet owns this bounded lifecycle; renderers and static marks do not.
 * Remember disabled changes, too: expanding/collapsing is never a dress replay. */
export function createMascotAttireController(initial: MascotMode, onChange: (transition: MascotAttireTransition) => void) {
  let previous = initial;
  let transition: MascotAttireTransition = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const publish = (next: MascotAttireTransition) => {
    if (transition === next) return;
    transition = next;
    onChange(next);
  };
  return {
    transition: () => transition,
    update(mode: MascotMode, enabled: boolean, reducedMotion: boolean) {
      if (disposed) return;
      const next = nextAttireTransition(previous, mode);
      previous = mode;
      if (!enabled || reducedMotion) {
        cancel();
        publish(null);
      } else if (next) {
        cancel();
        publish(next);
        timer = setTimeout(() => { timer = undefined; publish(null); }, MASCOT_ATTIRE_MS);
      }
    },
    dispose() { disposed = true; cancel(); },
  };
}
