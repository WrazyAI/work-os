import { useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { MASCOT } from "./mascot";
import { deriveMascotVisualState, type MascotAgentActivity, type MascotWorkdayState } from "./mascotState";
import { useMascotRuntimeSnapshot } from "./mascotRuntimeStore";
import { cx } from "./chat/cx";
import { useAttentionSequence } from "./attentionSequence";
import { createMascotAttireController } from "./mascotAttire";
import type { MascotAttireTransition, MascotMode } from "./mascotTypes";
import "./mascot-runtime.css";

export interface MascotPetProps {
  agent?: MascotAgentActivity;
  workday?: MascotWorkdayState;
  className?: string;
  artClassName?: string;
  style?: CSSProperties;
  /** Labs opt out of the application runtime so each sample is independent. */
  isolated?: boolean;
  reducedMotion?: boolean;
  replayKey?: number;
  /** Otto is reading aloud: the mouth moves, everything else stays put. */
  speaking?: boolean;
  mode?: MascotMode;
  /** Only the still-mounted collapsed orb (and explicit lab replay) opts in. */
  animateAttire?: boolean;
}

const motionQuery = "(prefers-reduced-motion: reduce)";
const osReducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(motionQuery).matches;
const serverReducedMotion = () => false;
const subscribeMotion = (onChange: () => void) => {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** All live full-size surfaces consume one resolved presentation per window.
 * The isolated path also keeps server rendering and fixture tests deterministic. */
export function MascotPet({ agent = "idle", workday = "active", className, artClassName, style,
  isolated = false, reducedMotion = false, replayKey = 0, speaking = false,
  mode = "employee", animateAttire = false }: MascotPetProps) {
  const snapshot = useMascotRuntimeSnapshot();
  const runtime = isolated ? null : snapshot;
  const visual = runtime ?? deriveMascotVisualState({ agent, workday });
  const osReduced = useSyncExternalStore(subscribeMotion, osReducedMotion, serverReducedMotion);
  const reduced = reducedMotion || runtime?.reducedMotion === true || osReduced;
  const replay = runtime?.replay ?? replayKey;
  const [initialMode] = useState(mode);
  const controller = useRef<ReturnType<typeof createMascotAttireController> | null>(null);
  const [attire, setAttire] = useState<{ mode: MascotMode; transition: MascotAttireTransition; replay: number } | null>(null);
  const onAttireChange = useEffectEvent((transition: MascotAttireTransition) => setAttire({ mode, transition, replay }));
  useLayoutEffect(() => {
    const current = createMascotAttireController(initialMode, (transition) => onAttireChange(transition));
    controller.current = current;
    return () => { current.dispose(); controller.current = null; };
  }, [initialMode]);
  useLayoutEffect(() => { controller.current?.update(mode, animateAttire, reduced); }, [mode, animateAttire, reduced]);
  // A pose replay can remount the SVG; it must never replay an accessory flourish.
  const attireTransition = animateAttire && !reduced && attire?.mode === mode && attire.replay === replay ? attire.transition : null;
  const attention = useAttentionSequence(visual.pose === "alert", reduced, replayKey);
  const Pet = MASCOT.Pet;
  const updateGaze = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
    event.currentTarget.style.setProperty("--mascot-look-x", `${Math.max(-1, Math.min(1, x)) * 2}px`);
    event.currentTarget.style.setProperty("--mascot-look-y", `${Math.max(-1, Math.min(1, y)) * 1.4}px`);
  };
  const resetGaze = (event: ReactPointerEvent<HTMLSpanElement>) => {
    event.currentTarget.style.setProperty("--mascot-look-x", "0px");
    event.currentTarget.style.setProperty("--mascot-look-y", "0px");
  };
  return <span className={cx("mascot-pet", className)} data-motion="renderer"
    data-activity={visual.activity} data-workday={visual.workday}
    data-source={runtime?.source ?? "isolated"} data-reduced-motion={reduced ? "true" : "false"}
    data-attention-playing={attention.playing ? "true" : undefined}
    data-attention-cycle={attention.playing ? attention.cycle : undefined}
    data-attention={visual.attention ? "true" : "false"} data-transient={visual.transient ? "true" : "false"}
    aria-hidden="true" onPointerMove={updateGaze} onPointerLeave={resetGaze}>
    <Pet key={replay} pose={visual.pose} tone={visual.tone} crop="full" speaking={speaking} mode={mode} attireTransition={attireTransition}
      className={cx("mascot-pet-art", artClassName)} style={style}
      ariaLabel={`${MASCOT.name}, ${MASCOT.role}, ${visual.label}`} />
  </span>;
}

/** Visible status, not a replacement for the platform's operational notices. */
export function MascotStatus({ fallback }: { fallback: string }) {
  const state = useMascotRuntimeSnapshot();
  return <span className="mascot-live-label">{state ? `${state.source === "scenario" ? "Preview: " : ""}${state.label}` : fallback}</span>;
}
