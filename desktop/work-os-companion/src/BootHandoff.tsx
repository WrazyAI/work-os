import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bench } from "./LoadingUi";
import { MascotPet } from "./MascotPet";
import type { BootSurface } from "./bootSurface";

/** Exact stage copy for the two loading phases; the apostrophe is U+2019
 * exactly as the boot screen has always used. */
export const BOOT_STAGE_COPY = {
  vault_loading: "Opening this device’s saved session",
  data_loading: "Reading your schedule and workday",
} as const;

const CONTENT_SURFACES: readonly BootSurface[] = ["connect", "onboarding", "admin", "workspace"];
const isContentSurface = (surface: BootSurface): boolean => CONTENT_SURFACES.includes(surface);
const isLoadingSurface = (surface: BootSurface | null): surface is "vault_loading" | "data_loading" => surface === "vault_loading" || surface === "data_loading";

/** Reduced-motion is read fresh at each handoff so a mid-boot preference change
 * is honored; the choice for one handoff is remembered on the state ref. */
function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** First Light loading surface (replaces LoadingScreen's non-failed branch):
 * Otto at a bench of light, the title, and the promoted truthful stage line
 * whose phase changes are announced in place. */
export function FirstLightSurface({ stage }: { stage: string }) {
  return <main className="loading"><div className="loading-shell">
    <MascotPet isolated agent="working" workday="active" className="mascot-loading" artClassName="mascot-loading-art" />
    <h1>Getting your day ready</h1>
    <Bench /><small className="loading-stage" role="status">{stage}</small>
  </div></main>;
}

/** Thin wrapper over bootRiseClass — App spreads it onto the workspace root so
 * only a loading→content handoff plays the one-shot rise. */
export function useBootRise(surface: BootSurface): string {
  const prevRef = useRef<BootSurface | null>(null);
  const [rise, setRise] = useState(false);
  useEffect(() => {
    const previous = prevRef.current;
    if (previous === surface) return;
    const isHandoff = isLoadingSurface(previous) && isContentSurface(surface);
    prevRef.current = surface;
    if (!isHandoff) return;
    setRise(true);
    const timer = setTimeout(() => setRise(false), 700);
    return () => clearTimeout(timer);
  }, [surface]);
  return rise ? "boot-rise" : "";
}

type BootExit = "idle" | "landing" | "exiting" | "done";

/** Persistent boot overlay: renders the First Light surface while the seam says
 * a loading phase is up; on a loading→content handoff plays Landing→Rise above
 * `children`. Never renders children while loading; never blocks them after. */
export function BootOverlay({ surface, children, onExitStart }: {
  surface: Exclude<BootSurface, "vault_failed">;
  /** Absent while the overlay itself is the screen; the loading phases render
   *  the First Light surface in their place. */
  children?: ReactNode;
  onExitStart?: () => void;
}) {
  const [exit, setExit] = useState<BootExit>("idle");
  const [reduced, setReduced] = useState(false);
  const prevSurfaceRef = useRef<BootSurface | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const lastStageRef = useRef<string>("");
  const loading = isLoadingSurface(surface);
  const stage = loading ? BOOT_STAGE_COPY[surface] : lastStageRef.current;
  const onExitStartRef = useRef(onExitStart);
  onExitStartRef.current = onExitStart;
  const timersRef = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timersRef.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    for (const timer of timersRef.current) clearTimeout(timer);
    timersRef.current = [];
  };
  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    if (loading) lastStageRef.current = BOOT_STAGE_COPY[surface];
  }, [loading, surface]);

  // The handoff detector. The pulse's landing beat is the only WAAPI work; the
  // night's exit is one CSS class applied to an already-stable overlay node.
  useEffect(() => {
    const previous = prevSurfaceRef.current;
    if (previous === surface) return;
    const isHandoff = isLoadingSurface(previous) && isContentSurface(surface);
    prevSurfaceRef.current = surface;
    if (!isHandoff) {
      if (loading) setExit("idle");
      return;
    }
    onExitStartRef.current?.();
    // If the boot replayed loading after content (debugger scenario), timers
    // from the previous handoff are stale.
    clearTimers();
    const isReduced = prefersReducedMotion();
    setReduced(isReduced);
    const startExit = () => setExit("exiting");
    if (isReduced) {
      setExit("exiting");
      later(() => setExit("done"), 400);
      return;
    }
    const pulse = overlayRef.current?.querySelector<HTMLElement>(".loading-bench-pulse") ?? null;
    const cssAnimation = pulse?.getAnimations()[0];
    const cycle = 3400;
    const time = cssAnimation?.currentTime;
    const phase = typeof time === "number" && Number.isFinite(time) ? time % cycle : null;
    const travelStart = 290; // keyframe 9% of the sweep: pulse fully lit
    const travelEnd = 2790;  // keyframe 82%: pulse faded back out
    if (!pulse || !cssAnimation || phase == null || phase < travelStart || phase > travelEnd) {
      // The bench is resting (or the landing cannot run): exit immediately —
      // the landing beat already happened visually.
      setExit("exiting");
      later(() => setExit("done"), 900);
      return;
    }
    setExit("landing");
    try {
      cssAnimation.cancel();
      const computed = window.getComputedStyle(pulse);
      const landedPulse = pulse.animate(
        [
          { left: computed.left, opacity: Number(computed.opacity) },
          { left: "100%", opacity: 1 },
        ],
        { duration: Math.min(300, Math.max(120, (travelEnd - phase) * 0.4)), easing: "cubic-bezier(0.2, 0.8, 0.2, 1)", fill: "forwards" },
      );
      landedPulse.finished.then(() => {
        later(startExit, 150);
      }, () => {
        startExit();
      });
    } catch {
      startExit();
    }
    // Safety: the landing never holds the overlay past its budget.
    later(startExit, 650);
  }, [surface, loading]);

  // The exit always reaches "done" even if an animationend never arrives.
  useEffect(() => {
    if (exit !== "exiting") return;
    const safe = setTimeout(() => {
      setExit((current) => current === "exiting" ? "done" : current);
    }, reduced ? 400 : 900);
    return () => clearTimeout(safe);
  }, [exit, reduced]);

  if (exit === "done") return <>{children}</>;
  const covering = !loading && (exit === "landing" || exit === "exiting");
  const exitClass = exit === "exiting" ? (reduced ? " boot-exit-reduced" : " boot-exit") : "";
  const overlayVisible = loading || covering;
  return <>
    {!loading ? children : null}
    {overlayVisible && <div
      ref={covering ? overlayRef : null}
      className={`boot-overlay${exitClass}${covering ? " boot-cover" : ""}`}
      aria-hidden={covering ? "true" : undefined}
      onAnimationEnd={covering ? () => setExit((current) => current === "exiting" ? "done" : current) : undefined}
    >
      <FirstLightSurface stage={stage} />
    </div>}
  </>;
}
