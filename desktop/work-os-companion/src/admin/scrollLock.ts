/** Reference-counted page scroll lock for the administration drawers.
 *
 * The window is the only scroller in this shell (`.workspace` is min-height:
 * 100vh), so a drawer freezes the page by hiding the body's overflow. Locks are
 * counted instead of captured per instance: the first holder records the body's
 * inline value and the last release restores exactly that value. Two drawers
 * open at once therefore can never capture each other's `hidden` and leave a
 * stale lock behind after both close. Each acquire returns an idempotent
 * release, which keeps rapid open/close and unmount-while-open safe. */

export type ScrollLockTarget = Pick<Document, "body">;

let activeLocks = 0;
let capturedOverflow: string | null = null;

export function acquirePageScrollLock(target: ScrollLockTarget = document): () => void {
  if (activeLocks === 0) {
    capturedOverflow = target.body.style.overflow;
    target.body.style.overflow = "hidden";
  }
  activeLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks > 0) return;
    target.body.style.overflow = capturedOverflow ?? "";
    capturedOverflow = null;
  };
}
