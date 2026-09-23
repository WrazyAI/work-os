import { FadeArc } from "./LoadingUi";
import type { WorktivityControlPhase } from "./worktivityControl";

export type WorktivityControlNoticeState =
  | { status: "starting"; phase: WorktivityControlPhase }
  | { status: "pending"; message: string };

const phaseMessage: Record<WorktivityControlPhase, string> = {
  preflight: "Checking current Worktivity attendance…",
  desktop: "Preparing Worktivity; it will open or restart if needed…",
  confirm: "Waiting for Worktivity to confirm the change…",
};

export function WorktivityControlNotice({ state, busy = false, onCheckStatus }: {
  state: WorktivityControlNoticeState;
  busy?: boolean;
  onCheckStatus?: () => void;
}) {
  if (state.status === "starting") {
    return <div className="notice worktivity-starting" role="status" aria-live="polite" aria-busy="true">
      <FadeArc size={15} />
      <span>{phaseMessage[state.phase]}</span>
    </div>;
  }

  return <div className="notice worktivity-pending" role="status" aria-live="polite">
    <span>{state.message}</span>
    <button type="button" disabled={busy || !onCheckStatus} onClick={onCheckStatus}>Check Worktivity status</button>
  </div>;
}
