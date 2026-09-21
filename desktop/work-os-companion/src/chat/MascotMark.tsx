import { MASCOT, type MascotCrop, type MascotPose, type MascotTone } from "../mascot";
import { cx } from "./cx";
import { useMascotRuntimeSnapshot } from "../mascotRuntimeStore";

/** The agent's identity mark for chat surfaces. It renders the mascot from the
 * single `MASCOT` config, so a global mascot change propagates everywhere the
 * agent speaks without editing individual surfaces. */
export function MascotMark({ pose = MASCOT.chatPose, tone = "signal", crop = MASCOT.chatCrop, className, live = false }: { pose?: MascotPose; tone?: MascotTone; crop?: MascotCrop; className?: string; live?: boolean }) {
  const runtime = useMascotRuntimeSnapshot();
  const Mark = MASCOT.Mark;
  return (
    <span className={cx("chat-mascot-mark", className)} aria-hidden="true">
      <Mark pose={live && runtime ? runtime.pose : pose} tone={live && runtime ? runtime.tone : tone} crop={crop} className="chat-mascot-art" ariaLabel={`${MASCOT.name}, ${MASCOT.role}`} />
    </span>
  );
}
