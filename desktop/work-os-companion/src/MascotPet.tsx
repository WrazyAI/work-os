import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { MASCOT } from "./mascot";
import { deriveMascotVisualState, type MascotAgentActivity, type MascotWorkdayState } from "./mascotState";
import { useMascotRuntimeSnapshot } from "./mascotRuntimeStore";
import { cx } from "./chat/cx";
import { useAttentionSequence } from "./attentionSequence";
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
}

/** All live full-size surfaces consume one resolved presentation per window.
 * The isolated path also keeps server rendering and fixture tests deterministic. */
export function MascotPet({ agent = "idle", workday = "active", className, artClassName, style,
  isolated = false, reducedMotion = false, replayKey = 0 }: MascotPetProps) {
  const snapshot = useMascotRuntimeSnapshot();
  const runtime = isolated ? null : snapshot;
  const visual = runtime ?? deriveMascotVisualState({ agent, workday });
  const reduced = reducedMotion || runtime?.reducedMotion === true;
  const attention = useAttentionSequence(visual.pose === "alert", reduced, replayKey);
  const Pet = MASCOT.Pet;
  const updateGaze = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (reduced || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
    <Pet key={runtime?.replay ?? replayKey} pose={visual.pose} tone={visual.tone} crop="full"
      className={cx("mascot-pet-art", artClassName)} style={style}
      ariaLabel={`${MASCOT.name}, ${MASCOT.role}, ${visual.label}`} />
  </span>;
}

/** Visible status, not a replacement for the platform's operational notices. */
export function MascotStatus({ fallback }: { fallback: string }) {
  const state = useMascotRuntimeSnapshot();
  return <span className="mascot-live-label">{state ? `${state.source === "scenario" ? "Preview: " : ""}${state.label}` : fallback}</span>;
}
