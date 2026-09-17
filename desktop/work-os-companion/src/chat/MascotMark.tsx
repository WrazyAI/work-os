import { MASCOT } from "../mascot";
import type { OttoPose } from "../Otto";
import { cx } from "./cx";

/** The agent's identity mark for chat surfaces. It renders the mascot from the
 * single `MASCOT` config, so a global mascot change propagates everywhere the
 * agent speaks without editing individual surfaces. */
export function MascotMark({ pose = MASCOT.chatPose, className }: { pose?: OttoPose; className?: string }) {
  const Mark = MASCOT.Mark;
  return (
    <span className={cx("chat-mascot-mark", className)} aria-hidden="true">
      <Mark pose={pose} className="chat-mascot-art" />
    </span>
  );
}
