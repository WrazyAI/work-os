import { useEffect, useState } from "react";
import type { Window as NativeWindow } from "@tauri-apps/api/window";
import { createMascotMovement } from "./mascotMovement";
import type { PetMovement } from "./mascotPlayback";

export function useAvatarMascotMovement(win: NativeWindow | null, expanded: boolean) {
  const [movement, setMovement] = useState<PetMovement>(null);
  useEffect(() => {
    if (!win || expanded) { setMovement(null); return; }
    let disposed = false;
    let off: (() => void) | undefined;
    const tracker = createMascotMovement(value => { if (!disposed) setMovement(value); });
    const begin = (event: PointerEvent) => {
      if (event.button === 0 && event.target instanceof Element && event.target.closest("[data-tauri-drag-region]")) tracker.start();
    };
    const end = () => tracker.stop();
    document.addEventListener("pointerdown", begin, true);
    window.addEventListener("pointerup", end);
    void win.outerPosition().then(position => { if (!disposed) tracker.move(position.x); }).catch(() => undefined);
    void win.onMoved(({ payload }) => { if (!disposed) tracker.move(payload.x); })
      .then(unlisten => { if (disposed) unlisten(); else off = unlisten; }).catch(() => undefined);
    return () => {
      disposed = true; tracker.stop(); off?.();
      document.removeEventListener("pointerdown", begin, true);
      window.removeEventListener("pointerup", end);
    };
  }, [win, expanded]);
  return movement;
}
