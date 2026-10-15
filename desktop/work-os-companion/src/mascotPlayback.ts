import type { MascotPose } from "./mascotTypes";

export const PET_CLIPS = {
  idle: { row: 0, frames: 6, durations: [2600, 160, 80, 80, 80, 160], loop: true },
  "running-right": { row: 1, frames: 8, durations: [100], loop: true },
  "running-left": { row: 2, frames: 8, durations: [100], loop: true },
  waving: { row: 3, frames: 4, durations: [180], loop: false },
  jumping: { row: 4, frames: 5, durations: [130], loop: false },
  failed: { row: 5, frames: 8, durations: [140], loop: false },
  waiting: { row: 6, frames: 6, durations: [140], loop: true },
  running: { row: 7, frames: 6, durations: [125], loop: true },
  review: { row: 8, frames: 6, durations: [180], loop: true },
} as const;
export type PetClip = keyof typeof PET_CLIPS;
export type PetMovement = "left" | "right" | null;
export type PetAnimation = PetClip | "look";

/** Clockwise in screen coordinates: 0 up, 4 right, 8 down, 12 left. */
export function lookDirection(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) < 18) return null;
  return (Math.round(Math.atan2(x, -y) * 8 / Math.PI) + 16) % 16;
}
export function movementDirection(deltaX: number): PetMovement {
  return !Number.isFinite(deltaX) || Math.abs(deltaX) < 3 ? null : deltaX < 0 ? "left" : "right";
}
export function resolvePetClip({ pose, movement, look }: { pose: MascotPose; movement?: PetMovement; look?: number | null }): PetAnimation | null {
  if (pose === "sleep" || pose === "rest") return null;
  if (pose === "think") return "running";
  if (pose === "review") return "review";
  if (pose === "wave") return "waving";
  if (pose === "alert") return "waiting";
  if (pose === "recover") return "failed";
  if (pose === "celebrate") return "jumping";
  if (movement) return `running-${movement}`;
  if (look != null) return "look";
  return "idle";
}
export function samplePetFrame(clip: PetClip, elapsed: number, playing = true): number {
  const spec = PET_CLIPS[clip];
  if (!playing) return clip === "waiting" || !spec.loop ? spec.frames - 1 : 0;
  const durations = Array.from({ length: spec.frames }, (_, index) => spec.durations[index] ?? spec.durations[0]);
  const total = durations.reduce((sum, value) => sum + value, 0);
  let time = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  if (!spec.loop && time >= total) return spec.frames - 1;
  time %= total;
  for (let frame = 0; frame < durations.length; frame++) {
    if (time < durations[frame]) return frame;
    time -= durations[frame];
  }
  return spec.frames - 1;
}
