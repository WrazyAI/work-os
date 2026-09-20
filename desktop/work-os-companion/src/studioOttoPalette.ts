import type { MascotPose, MascotTone } from "./mascotTypes";

export const STUDIO_PALETTES = {
  neutral: { phosphor: "#edf4ee", accent: "#cbd9d3", wash: "#eeeae1" },
  working: { phosphor: "#f5d278", accent: "#e5b94b", wash: "#f1e7cc" },
  ready: { phosphor: "#a8ecc1", accent: "#63c58c", wash: "#ddebe0" },
  blocked: { phosphor: "#ff9c8d", accent: "#df7162", wash: "#f0dfd8" },
} as const;

export type StudioPalette = keyof typeof STUDIO_PALETTES;

/** Agent activity wins over secondary workday tone. Late remains visible as a
 * separate clock badge, without turning successful work into a red failure. */
export function studioOttoPalette(pose: MascotPose, tone: MascotTone): StudioPalette {
  if (pose === "recover") return "blocked";
  if (pose === "celebrate") return "ready";
  if (pose === "think" || pose === "alert") return "working";
  return tone === "late" ? "blocked" : "neutral";
}
