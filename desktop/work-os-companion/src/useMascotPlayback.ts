import { useEffect, useRef, useState, type RefObject } from "react";
import { lookDirection, PET_CLIPS, resolvePetClip, samplePetFrame, type PetAnimation, type PetMovement } from "./mascotPlayback";
import type { MascotPose } from "./mascotTypes";

/** Pointer events carry presentation coordinates only; no global OS polling. */
export function useMascotInteraction(ref: RefObject<HTMLSpanElement | null>, enabled: boolean) {
  const [look, setLook] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const reset = () => { cancelAnimationFrame(frame); frame = 0; setLook(null); };
    const move = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) setLook(lookDirection(event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height * .48));
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    return () => {
      reset();
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
    };
  }, [ref, enabled]);
  return enabled ? look : null;
}

export function useMascotVisibility(ref: RefObject<HTMLSpanElement | null>) {
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let intersecting = true;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { setVisible(intersecting && !document.hidden); setReduced(media.matches); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => { intersecting = entry.isIntersecting; update(); });
    if (ref.current) observer?.observe(ref.current);
    update();
    document.addEventListener("visibilitychange", update);
    media.addEventListener("change", update);
    return () => { observer?.disconnect(); document.removeEventListener("visibilitychange", update); media.removeEventListener("change", update); };
  }, [ref]);
  return { visible, reduced };
}

/** One clock controls sprite frames. Hiding pauses rendering, not event time:
 * returning to a window cannot replay an expired success/failure gesture. */
export function useMascotPlayback({ pose, movement, look, reduced, visible, attention, replay, preview }: {
  pose: MascotPose; movement?: PetMovement; look: number | null; reduced: boolean;
  visible: boolean; attention: boolean; replay: string; preview?: PetAnimation;
}) {
  const clip = preview ?? resolvePetClip({ pose, movement, look });
  const key = `${clip}:${replay}`;
  const clock = useRef({ key, started: Date.now() });
  const [sample, setSample] = useState({ key, frame: 0 });
  useEffect(() => {
    if (clock.current.key !== key) clock.current = { key, started: Date.now() };
    if (!clip || clip === "look" || reduced || !visible) return;
    const update = () => {
      const frame = samplePetFrame(clip, Date.now() - clock.current.started, clip !== "waiting" || attention);
      setSample(previous => previous.key === key && previous.frame === frame ? previous : { key, frame });
    };
    update();
    const timer = window.setInterval(update, 50);
    return () => window.clearInterval(timer);
  }, [clip, key, reduced, visible, attention]);
  if (!clip) return null;
  const frame = clip === "look" ? Math.max(0, Math.min(15, look ?? 0))
    : reduced ? samplePetFrame(clip, 0, false) : sample.key === key ? sample.frame : 0;
  return { clip, row: clip === "look" ? 9 + Math.floor(frame / 8) : PET_CLIPS[clip].row, frame: clip === "look" ? frame % 8 : frame };
}
