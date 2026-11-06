import type { CSSProperties, ComponentType } from "react";

export const MASCOT_POSES = ["idle", "sleep", "focus", "alert", "rest", "think", "celebrate", "recover"] as const;

export type MascotPose = (typeof MASCOT_POSES)[number];
export type MascotTone = "signal" | "late";
export type MascotCrop = "full" | "head";
export type MascotMode = "employee" | "admin";
export type MascotAttireTransition = "on" | "off" | null;

export interface MascotRendererProps {
  pose?: MascotPose;
  tone?: MascotTone;
  crop?: MascotCrop;
  mode?: MascotMode;
  attireTransition?: MascotAttireTransition;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  /** Otto is reading aloud right now: the mouth moves, the pose stays as it is
   * (a reading is not a new posture, and the pose set never learns a special
   * case for it). */
  speaking?: boolean;
}

export type MascotRenderer = ComponentType<MascotRendererProps>;
