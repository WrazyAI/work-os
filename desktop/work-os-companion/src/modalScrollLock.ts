import { useEffect } from "react";

export type ModalDocument = Pick<Document, "documentElement" | "body">;

let activeLocks = 0;
let htmlAlreadyLocked = false;
let bodyAlreadyLocked = false;
let previousBodyStyle: { position: string; top: string; width: string } | null = null;
let lockedScroll = { x: 0, y: 0 };

/** Keep viewport scrolling disabled while any modal surface is mounted. */
export function acquireModalScrollLock(target: ModalDocument = document) {
  if (activeLocks === 0) {
    htmlAlreadyLocked = target.documentElement.classList.contains("modal-open");
    bodyAlreadyLocked = target.body.classList.contains("modal-open");
    previousBodyStyle = { position: target.body.style.position, top: target.body.style.top, width: target.body.style.width };
    lockedScroll = { x: typeof window === "undefined" ? 0 : window.scrollX, y: typeof window === "undefined" ? 0 : window.scrollY };
    target.documentElement.classList.add("modal-open");
    target.body.classList.add("modal-open");
    target.body.style.position = "fixed";
    target.body.style.top = `-${lockedScroll.y}px`;
    target.body.style.width = "100%";
  }
  activeLocks += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeLocks = Math.max(0, activeLocks - 1);
    if (activeLocks !== 0) return;
    if (previousBodyStyle) {
      target.body.style.position = previousBodyStyle.position;
      target.body.style.top = previousBodyStyle.top;
      target.body.style.width = previousBodyStyle.width;
    }
    if (!htmlAlreadyLocked) target.documentElement.classList.remove("modal-open");
    if (!bodyAlreadyLocked) target.body.classList.remove("modal-open");
    if (typeof window !== "undefined") window.scrollTo(lockedScroll.x, lockedScroll.y);
    previousBodyStyle = null;
  };
}

export function useModalScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    return acquireModalScrollLock();
  }, [active]);
}
