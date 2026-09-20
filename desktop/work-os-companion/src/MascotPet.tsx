import type { CSSProperties } from "react";
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
 * motion. The current Pet renderer is still Otto; replacing it later should be
 * a mascot.ts change rather than a surface-by-surface rewrite.
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

  return (
    <span
      className={cx("mascot-pet", className)}
      data-activity={visual.activity}
      data-workday={visual.workday}
      data-attention={visual.attention ? "true" : "false"}
      data-transient={visual.transient ? "true" : "false"}
      aria-hidden="true"
    >
      <Pet
        pose={visual.pose}
        tone={visual.tone}
        crop="full"
        className={cx("mascot-pet-art", artClassName)}
        style={style}
      />
    </span>
  );
}
