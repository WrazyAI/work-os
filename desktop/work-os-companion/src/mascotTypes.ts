import type { CSSProperties, ComponentType } from "react";
import type { PetAnimation } from "./mascotPlayback";

export const MASCOT_POSES = ["idle", "sleep", "focus", "alert", "rest", "think", "celebrate", "recover", "review", "wave"] as const;

export type MascotPose = (typeof MASCOT_POSES)[number];
export type MascotTone = "signal" | "late";
export type MascotCrop = "full" | "head";

export interface MascotRendererProps {
  pose?: MascotPose;
  tone?: MascotTone;
  crop?: MascotCrop;
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
  motion?: { clip: PetAnimation; row: number; frame: number; src: string } | null;
}

export type MascotRenderer = ComponentType<MascotRendererProps>;
