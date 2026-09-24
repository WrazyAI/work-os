import type { CSSProperties, ComponentType } from "react";

export const MASCOT_POSES = ["idle", "sleep", "focus", "alert", "rest", "think", "celebrate", "recover"] as const;

export type MascotPose = (typeof MASCOT_POSES)[number];
export type MascotTone = "signal" | "late";
export type MascotCrop = "full" | "orb" | "head";

export interface MascotRendererProps {
  pose?: MascotPose;
  tone?: MascotTone;
  crop?: MascotCrop;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export type MascotRenderer = ComponentType<MascotRendererProps>;
