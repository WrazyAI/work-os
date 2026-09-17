import { Otto, type OttoPose } from "./Otto";

/** The agent's identity and art, in one place.
 *
 * Change the mascot here and every surface follows: chat turns, the composer
 * welcome, the thinking trace, and the floating companion. Never hardcode
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
  chatPose: "focus" as OttoPose,
  /** Pose while the agent is working (thinking trace). */
  thinkingPose: "think" as OttoPose,
  /** Pose for idle or welcome surfaces. */
  idlePose: "idle" as OttoPose,
  /** The one component every surface renders. */
  Mark: Otto,
  /** Bundled art for surfaces that need a raster or file reference. */
  assets: {
    mark: "/work-os-mark.svg",
    companion: "/work-os-companion.png",
  },
} as const;

export type MascotConfig = typeof MASCOT;
