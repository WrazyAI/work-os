"use client";

import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import styles from "./landing.module.css";

const MotionContext = createContext({ paused: false, reduced: false, toggle: () => {} });
const serverMotion = () => false;
function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
function subscribeMotion(onChange: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useLandingMotion() { return useContext(MotionContext); }

/** Server-rendered content stays visible if animation code never arrives. */
export default function LandingMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, serverMotion);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    const started = performance.now();
    if (paused || reduced) {
      node.dataset.motionEntered = "true";
      return;
    }
    import("./landing-motion").then(({ startLandingMotion }) => {
      if (cancelled) return;
      // A late chunk must not pull already-read content off screen.
      if (performance.now() - started > 1500 || window.scrollY > 80) node.dataset.motionEntered = "true";
      dispose = startLandingMotion(node);
    }).catch(() => { if (!cancelled) node.dataset.motionEntered = "true"; });
    return () => { cancelled = true; dispose?.(); };
  }, [paused, reduced]);

  return (
    <MotionContext.Provider value={{ paused, reduced, toggle: () => setPaused((value) => !value) }}>
      <div ref={root} className={styles.page} data-landing data-motion-paused={paused || reduced ? "true" : "false"}>
        {children}
      </div>
    </MotionContext.Provider>
  );
}

export function LandingMotionControl() {
  const { paused, reduced, toggle } = useLandingMotion();
  return <button type="button" onClick={toggle} disabled={reduced} aria-pressed={paused}>
    {reduced ? "Reduced motion is on" : paused ? "Resume motion" : "Pause motion"}
  </button>;
}
