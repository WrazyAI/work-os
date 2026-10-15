import { useSyncExternalStore } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function mediaQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION_QUERY)
    : null;
}

/** Read the preference synchronously so autoplay cannot start on the first render. */
export function prefersReducedGuideMotion(): boolean {
  return mediaQuery()?.matches ?? false;
}

export function subscribeToGuideMotion(onChange: () => void): () => void {
  const query = mediaQuery();
  if (!query) return () => undefined;
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Keep the guide film in sync if the OS preference changes while it is open. */
export function useGuideReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToGuideMotion, prefersReducedGuideMotion, prefersReducedGuideMotion);
}

/** Manual playback can happen under reduced motion, but never automatic playback. */
export function guideMayAutoplay(requested: boolean, reducedMotion: boolean): boolean {
  return requested && !reducedMotion;
}
