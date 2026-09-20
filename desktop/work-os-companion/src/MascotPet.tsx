import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { MASCOT } from "./mascot";
import {
  deriveMascotVisualState,
  type MascotAgentActivity,
  type MascotWorkdayState,
} from "./mascotState";
import { cx } from "./chat/cx";

export interface MascotPetProps {
  agent?: MascotAgentActivity;
  workday?: MascotWorkdayState;
  className?: string;
  artClassName?: string;
  style?: CSSProperties;
}

/** Full-size, behavior-aware mascot renderer.
 *
 * Unlike MascotMark, this component is allowed to express product state and
 * motion. The current renderer is Studio Otto; the eventual Rive version
 * keeps this same contract so mascot.ts remains the only renderer switch.
 */
export function MascotPet({
  agent = "idle",
  workday = "active",
  className,
  artClassName,
  style,
}: MascotPetProps) {
  const visual = deriveMascotVisualState({ agent, workday });
  const Pet = MASCOT.Pet;

  const updateGaze = (event: ReactPointerEvent<HTMLSpanElement>) => {
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

  return (
    <span
      className={cx("mascot-pet", className)}
      data-motion="renderer"
      data-activity={visual.activity}
      data-workday={visual.workday}
      data-attention={visual.attention ? "true" : "false"}
      data-transient={visual.transient ? "true" : "false"}
      aria-hidden="true"
      onPointerMove={updateGaze}
      onPointerLeave={resetGaze}
    >
      <Pet
        pose={visual.pose}
        tone={visual.tone}
        crop="full"
        className={cx("mascot-pet-art", artClassName)}
        style={style}
        ariaLabel={`${MASCOT.name}, ${MASCOT.role}, ${visual.label}`}
      />
    </span>
  );
}
