import { useRef, type CSSProperties } from "react";
import { MASCOT } from "./mascot";
import { deriveMascotVisualState, type MascotAgentActivity, type MascotWorkdayState } from "./mascotState";
import { useMascotRuntimeSnapshot } from "./mascotRuntimeStore";
import { cx } from "./chat/cx";
import { useAttentionSequence } from "./attentionSequence";
import { useMascotInteraction, useMascotPlayback, useMascotVisibility } from "./useMascotPlayback";
import type { PetAnimation, PetMovement } from "./mascotPlayback";
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
  movement?: PetMovement;
  /** DEV lab only: inspect authored clips without inventing product activity. */
  previewAnimation?: PetAnimation;
}

/** All live full-size surfaces consume one resolved presentation per window.
 * The isolated path also keeps server rendering and fixture tests deterministic. */
export function MascotPet({ agent = "idle", workday = "active", className, artClassName, style,
  isolated = false, reducedMotion = false, replayKey = 0, movement, previewAnimation }: MascotPetProps) {
  const snapshot = useMascotRuntimeSnapshot();
  const runtime = isolated ? null : snapshot;
  const visual = runtime ?? deriveMascotVisualState({ agent, workday });
  const ref = useRef<HTMLSpanElement>(null);
  const visibility = useMascotVisibility(ref);
  const reduced = reducedMotion || runtime?.reducedMotion === true || visibility.reduced;
  const replay = `${runtime?.replay ?? 0}:${runtime?.receiptRevision ?? 0}:${replayKey}`;
  const attention = useAttentionSequence(visual.pose === "alert", reduced, replay);
  const look = useMascotInteraction(ref, !reduced && visibility.visible && (visual.pose === "idle" || visual.pose === "focus"));
  const motion = useMascotPlayback({ pose: visual.pose, movement, look, reduced, visible: visibility.visible,
    attention: attention.playing || (isolated && previewAnimation === "waiting"), replay, preview: isolated ? previewAnimation : undefined });
  const Pet = MASCOT.Pet;
  return <span ref={ref} className={cx("mascot-pet", className)} data-motion="renderer"
    data-activity={visual.activity} data-workday={visual.workday}
    data-source={runtime?.source ?? "isolated"} data-reduced-motion={reduced ? "true" : "false"}
    data-attention-playing={attention.playing ? "true" : undefined}
    data-attention-cycle={attention.playing ? attention.cycle : undefined}
    data-attention={visual.attention ? "true" : "false"} data-transient={visual.transient ? "true" : "false"}
    data-look={look ?? undefined} data-movement={movement ?? undefined} data-visible={visibility.visible}
    aria-hidden="true">
    <Pet key={replay} pose={visual.pose} tone={visual.tone} crop="full" motion={motion ? { ...motion, src: MASCOT.assets.atlas } : null}
      className={cx("mascot-pet-art", artClassName)} style={style}
      ariaLabel={`${MASCOT.name}, ${MASCOT.role}, ${visual.label}`} />
  </span>;
}

/** Visible status, not a replacement for the platform's operational notices. */
export function MascotStatus({ fallback }: { fallback: string }) {
  const state = useMascotRuntimeSnapshot();
  return <span className="mascot-live-label">{state ? `${state.source === "scenario" ? "Preview: " : ""}${state.label}` : fallback}</span>;
}
