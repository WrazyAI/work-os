import { SignalSpirit } from "./SignalSpirit";
import type { MascotCrop, MascotPose } from "./mascotTypes";

/** The agent's identity and art, in one place.
 *
 * Change the mascot here and every surface follows: chat turns, the thinking
 * trace, and the floating companion. Never hardcode
 * mascot art, its name, or a generic sparkle where the agent is speaking — a
 * feature icon (Insights synthesis, onboarding suggestions) is not an agent
 * identity. `test/work-os-companion-mascot.test.mts` fails the build on drift. */
export const MASCOT = {
  /** Stable id for storage keys and diagnostics. */
  id: "otto",
  /** Display name shown to employees. */
  name: "Otto",
  /** Plain-language role used in accessible names. */
  role: "Work OS companion",
  /** Pose while answering in chat. */
  chatPose: "focus" as MascotPose,
  /** Crop used for the chat identity mark (the head fills a small badge). */
  chatCrop: "head" as MascotCrop,
  /** Pose while the agent is working (thinking trace). */
  thinkingPose: "think" as MascotPose,
  /** Pose for idle or welcome surfaces. */
  idlePose: "idle" as MascotPose,
  /** Compact identity renderer for chat turns, badges, and tiny surfaces. */
  Mark: SignalSpirit,
  /** Full-figure renderer used by behavior-aware MascotPet surfaces. */
  Pet: SignalSpirit,
  /** Bundled art for surfaces that need a raster or file reference. */
  assets: {
    mark: "/signal-spirit-mark.svg",
    companion: "/signal-spirit.svg",
  },
} as const;

export type MascotConfig = typeof MASCOT;
export type { MascotCrop, MascotPose, MascotTone } from "./mascotTypes";
